"""Détection de parole et découpage du flux audio en segments traduisibles.

L'entrée est un flux continu de PCM 16 kHz mono int16. La sortie est une suite de
segments qui correspondent grosso modo à des phrases : on ouvre sur la parole, on
ferme sur le silence, et on coupe de force au bout de `max_segment_ms` pour les
streamers qui ne respirent jamais.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass

import numpy as np

from . import FRAME_BYTES, FRAME_MS, SAMPLE_RATE
from .config import AudioConfig

log = logging.getLogger(__name__)


class EnergyVad:
    """VAD de repli : énergie de la trame contre un plancher de bruit adaptatif.

    Moins bon que webrtcvad sur de la musique de fond, mais sans dépendance
    native — donc il marche partout, tout de suite.
    """

    def __init__(self, ratio: float, floor: float, recalibrate_ms: int = 8_000) -> None:
        self._ratio = ratio
        self._floor = floor
        # On part du plancher absolu, pas de la première trame : sinon un flux qui
        # démarre en pleine phrase calibre le bruit sur la voix et ne détecte
        # plus jamais rien.
        self._noise = floor
        self._speech_run = 0
        self._recalibrate_frames = max(1, recalibrate_ms // FRAME_MS)

    def is_speech(self, frame: bytes) -> bool:
        samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
        rms = float(np.sqrt(np.mean(samples * samples))) if samples.size else 0.0

        speech = rms > max(self._noise * self._ratio, self._floor)
        self._speech_run = self._speech_run + 1 if speech else 0

        if rms < self._noise:
            # Nouveau minimum : on redescend vite.
            self._noise = 0.90 * self._noise + 0.10 * rms
        elif not speech or self._speech_run > self._recalibrate_frames:
            # On ne laisse la parole tirer le plancher vers le haut que si elle
            # dure anormalement longtemps : c'est alors un fond sonore continu
            # mal calibré, pas quelqu'un qui parle.
            self._noise = 0.98 * self._noise + 0.02 * rms

        return speech


class WebRtcVad:
    """Enveloppe autour de webrtcvad, nettement plus fiable avec de la musique."""

    def __init__(self, aggressiveness: int) -> None:
        import webrtcvad  # import paresseux : la dépendance est optionnelle

        self._vad = webrtcvad.Vad(aggressiveness)

    def is_speech(self, frame: bytes) -> bool:
        return self._vad.is_speech(frame, SAMPLE_RATE)


def make_vad(cfg: AudioConfig):
    if cfg.vad in ("auto", "webrtc"):
        try:
            vad = WebRtcVad(cfg.vad_aggressiveness)
            log.info("VAD : webrtcvad (agressivité %d)", cfg.vad_aggressiveness)
            return vad
        except Exception as exc:  # noqa: BLE001 — on veut vraiment tout rattraper ici
            if cfg.vad == "webrtc":
                raise
            log.info("webrtcvad indisponible (%s), repli sur le VAD d'énergie", exc)
    log.info("VAD : énergie (ratio %.1f, plancher %.0f)", cfg.energy_ratio, cfg.energy_floor)
    return EnergyVad(cfg.energy_ratio, cfg.energy_floor, cfg.max_segment_ms)


@dataclass
class Segment:
    index: int
    pcm: bytes

    @property
    def duration_ms(self) -> int:
        return len(self.pcm) // 2 * 1000 // SAMPLE_RATE


class Segmenter:
    """Machine à états à deux positions : on attend la parole, ou on enregistre."""

    def __init__(self, cfg: AudioConfig) -> None:
        self._cfg = cfg
        self._vad = make_vad(cfg)
        self._tail = bytearray()

        self._start_frames = max(1, cfg.start_ms // FRAME_MS)
        self._end_frames = max(1, cfg.silence_ms // FRAME_MS)
        self._pre_roll = deque(maxlen=max(1, cfg.pre_roll_ms // FRAME_MS))

        self._recording = False
        self._buffer = bytearray()
        self._speech_run = 0
        self._silence_run = 0
        self._voiced_frames = 0
        self._index = 0

    def push(self, data: bytes) -> list[Segment]:
        """Consomme du PCM et retourne les segments qui viennent de se fermer."""
        self._tail += data
        closed: list[Segment] = []
        while len(self._tail) >= FRAME_BYTES:
            frame = bytes(self._tail[:FRAME_BYTES])
            del self._tail[:FRAME_BYTES]
            if segment := self._push_frame(frame):
                closed.append(segment)
        return closed

    def flush(self) -> Segment | None:
        """Ferme le segment en cours (fin de flux, ou déconnexion du producteur)."""
        self._tail.clear()
        if self._recording:
            return self._close(on_silence=False)
        return None

    def _push_frame(self, frame: bytes) -> Segment | None:
        speech = self._vad.is_speech(frame)

        if not self._recording:
            self._pre_roll.append(frame)
            if speech:
                self._speech_run += 1
                if self._speech_run >= self._start_frames:
                    self._recording = True
                    self._buffer = bytearray(b"".join(self._pre_roll))
                    self._pre_roll.clear()
                    self._silence_run = 0
                    self._voiced_frames = self._speech_run
            else:
                self._speech_run = 0
            return None

        self._buffer += frame
        self._silence_run = 0 if speech else self._silence_run + 1
        if speech:
            self._voiced_frames += 1

        elapsed_ms = len(self._buffer) // 2 * 1000 // SAMPLE_RATE
        if self._silence_run >= self._end_frames:
            return self._close(on_silence=True)
        if elapsed_ms >= self._cfg.max_segment_ms:
            # Coupe forcée en pleine parole : surtout ne rien rogner.
            return self._close(on_silence=False)
        return None

    def _close(self, *, on_silence: bool) -> Segment | None:
        pcm = bytes(self._buffer)
        voiced_ms = self._voiced_frames * FRAME_MS
        self._recording = False
        self._buffer = bytearray()
        self._speech_run = 0
        self._silence_run = 0
        self._voiced_frames = 0
        self._pre_roll.clear()

        # On rogne le silence de fin, mais on en garde 200 ms : Whisper transcrit
        # mieux quand le dernier mot n'est pas collé au bord du buffer.
        if on_silence:
            trim = self._silence_trim_bytes(pcm, keep_ms=200)
            if trim:
                pcm = pcm[:-trim]

        # Le seuil porte sur la parole réelle, pas sur la taille du buffer :
        # sinon le pre-roll et le silence conservé suffisent à faire passer un
        # simple claquement de clavier pour un segment valide.
        if voiced_ms < self._cfg.min_segment_ms:
            return None

        self._index += 1
        return Segment(index=self._index, pcm=pcm)

    def _silence_trim_bytes(self, pcm: bytes, *, keep_ms: int) -> int:
        silence_frames = self._end_frames - (keep_ms // FRAME_MS)
        if silence_frames <= 0:
            return 0
        trim = silence_frames * FRAME_BYTES
        return trim if len(pcm) - trim > 0 else 0


def pcm_to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Emballe du PCM brut dans un conteneur WAV, pour les backends STT distants."""
    import io
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()
