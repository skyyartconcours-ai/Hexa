"""Transcription : Whisper local (faster-whisper) ou API compatible OpenAI."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Protocol

from .audio import pcm_to_wav
from .config import SttConfig

log = logging.getLogger(__name__)


# Whisper hallucine des génériques de sous-titrage sur les passages sans parole.
# Ce sont toujours les mêmes phrases : on les filtre au lieu de les afficher.
_HALLUCINATIONS = re.compile(
    r"""(
        sottotitoli\s+(e\s+revisione\s+)?a\s+cura\s+di
      | sottotitoli\s+creati\s+dalla\s+comunit
      | sous-titr(age|es)\s+(par|société|réalisé)
      | subtitles?\s+by
      | amara\.org
      | qtss
      | iscrivit[ie]\s+al\s+canale
      | grazie\s+per\s+(aver\s+guardato|l'attenzione)
      | thanks?\s+for\s+watching
      | merci\s+d'avoir\s+regardé
      | www\.
    )""",
    re.IGNORECASE | re.VERBOSE,
)


def looks_like_hallucination(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    if _HALLUCINATIONS.search(stripped):
        return True
    # "... ... ..." ou "ah ah ah ah ah" : Whisper boucle quand il n'entend rien.
    if len(set(stripped.replace(" ", ""))) <= 2 and len(stripped) > 6:
        return True
    return False


class SttBackend(Protocol):
    name: str

    async def transcribe(self, pcm: bytes) -> str: ...


class MockStt:
    """Backend de test : ne charge aucun modèle, renvoie la durée du segment.

    Sert à valider toute la plomberie (WebSocket, segmentation, overlay) sans
    modèle ni clé d'API.
    """

    name = "mock"

    async def transcribe(self, pcm: bytes) -> str:
        ms = len(pcm) // 2 * 1000 // 16_000
        return f"[segment de {ms} ms]"


class FasterWhisperStt:
    """Whisper local. Rapide sur CPU en `small`, excellent sur GPU en `large-v3`."""

    def __init__(self, cfg: SttConfig) -> None:
        from faster_whisper import WhisperModel

        # faster-whisper comprend "auto" pour le device, mais attend "default"
        # plutôt que "auto" pour le type de calcul.
        compute_type = "default" if cfg.compute_type == "auto" else cfg.compute_type

        log.info("Chargement de faster-whisper %s (%s)…", cfg.model, cfg.device)
        self._model = WhisperModel(cfg.model, device=cfg.device, compute_type=compute_type)
        self._cfg = cfg
        self.name = f"faster-whisper:{cfg.model}"

    async def transcribe(self, pcm: bytes) -> str:
        return await asyncio.to_thread(self._transcribe_sync, pcm)

    def _transcribe_sync(self, pcm: bytes) -> str:
        import numpy as np

        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _info = self._model.transcribe(
            audio,
            language=self._cfg.language or None,
            beam_size=self._cfg.beam_size,
            temperature=0.0,
            # Sans ça, Whisper se réamorce sur sa propre sortie et part en boucle
            # dès qu'un segment est ambigu.
            condition_on_previous_text=False,
            # On a déjà fait le VAD en amont, inutile de le refaire ici.
            vad_filter=False,
        )

        parts: list[str] = []
        for segment in segments:
            if getattr(segment, "no_speech_prob", 0.0) > self._cfg.max_no_speech_prob:
                continue
            if getattr(segment, "avg_logprob", 0.0) < self._cfg.min_avg_logprob:
                continue
            parts.append(segment.text.strip())
        return " ".join(p for p in parts if p).strip()


class OpenAiCompatibleStt:
    """Endpoint `/audio/transcriptions` compatible OpenAI (Groq, OpenAI, LocalAI…).

    Groq est le meilleur rapport latence/prix du lot avec whisper-large-v3-turbo.
    """

    def __init__(self, cfg: SttConfig) -> None:
        if not cfg.api_key:
            raise RuntimeError(
                f"Le backend STT '{cfg.backend}' a besoin d'une clé d'API "
                f"({'GROQ_API_KEY' if cfg.backend == 'groq' else 'OPENAI_API_KEY'})."
            )
        self._cfg = cfg
        self.name = f"{cfg.backend}:{cfg.model}"

    async def transcribe(self, pcm: bytes) -> str:
        import httpx

        wav = pcm_to_wav(pcm)
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self._cfg.api_base}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._cfg.api_key}"},
                files={"file": ("segment.wav", wav, "audio/wav")},
                data={
                    "model": self._cfg.model,
                    "language": self._cfg.language,
                    "response_format": "json",
                    "temperature": "0",
                },
            )
            response.raise_for_status()
            return (response.json().get("text") or "").strip()


def build(cfg: SttConfig) -> SttBackend:
    backend = cfg.backend.lower()
    if backend == "mock":
        return MockStt()
    if backend in ("faster-whisper", "whisper", "local"):
        return FasterWhisperStt(cfg)
    if backend in ("groq", "openai"):
        return OpenAiCompatibleStt(cfg)
    raise ValueError(f"Backend STT inconnu : {cfg.backend!r}")
