"""Serveur WebSocket : reçoit l'audio, diffuse les sous-titres.

Protocole (un seul point d'entrée, le rôle est annoncé à la connexion) :

    client -> serveur   {"type":"hello","role":"producer"|"consumer",
                         "source_lang":"it","target_lang":"fr"}
    client -> serveur   trames binaires = PCM 16 kHz mono int16 (producteurs)
    client -> serveur   {"type":"flush"}   ferme le segment en cours

    serveur -> clients  {"type":"ready","stt":…,"translator":…,"source_lang":…,"target_lang":…}
    serveur -> clients  {"type":"segment","id":N,"state":"transcribing"}
    serveur -> clients  {"type":"segment","id":N,"state":"transcribed","original":…}
    serveur -> clients  {"type":"segment","id":N,"state":"delta","delta":…}
    serveur -> clients  {"type":"segment","id":N,"state":"done","original":…,
                         "translation":…,"latency_ms":…}
    serveur -> clients  {"type":"segment","id":N,"state":"dropped","reason":…}
    serveur -> clients  {"type":"error","message":…}

Tous les clients reçoivent les sous-titres, y compris les producteurs : l'extension
navigateur envoie l'audio et récupère les sous-titres sur la même connexion.
"""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import threading
import time
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import websockets

from . import stt as stt_module
from . import translate as translate_module
from .audio import Segment, Segmenter
from .config import Config

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"


class Hub:
    """Diffuse les événements de sous-titres à tous les clients connectés."""

    def __init__(self) -> None:
        self._clients: set = set()

    def add(self, ws) -> None:
        self._clients.add(ws)

    def discard(self, ws) -> None:
        self._clients.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        if not self._clients:
            return
        message = json.dumps(payload, ensure_ascii=False)
        await asyncio.gather(
            *(self._send(ws, message) for ws in list(self._clients)),
            return_exceptions=True,
        )

    @staticmethod
    async def _send(ws, message: str) -> None:
        try:
            await ws.send(message)
        except Exception:  # noqa: BLE001 — un client qui part ne doit pas casser les autres
            pass


class Pipeline:
    """Consomme les segments un par un : transcription puis traduction en streaming.

    Le traitement est séquentiel volontairement. Les segments arrivent au rythme de
    la parole (donc lentement), et les traiter en parallèle ferait arriver les
    sous-titres dans le désordre.
    """

    def __init__(self, cfg: Config, hub: Hub) -> None:
        self._cfg = cfg
        self._hub = hub
        self._queue: asyncio.Queue[tuple[Segment, float]] = asyncio.Queue(maxsize=8)
        self._context: deque[str] = deque(maxlen=max(0, cfg.translate.context_segments))
        self._task: asyncio.Task | None = None

        self.stt = stt_module.build(cfg.stt)
        self.translator = translate_module.build(cfg.translate)
        log.info("STT : %s — traduction : %s", self.stt.name, self.translator.name)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def retarget(self, source_lang: str | None, target_lang: str | None) -> bool:
        """Change les langues à chaud. Retourne True si quelque chose a bougé."""
        changed = False
        if source_lang and source_lang != self._cfg.translate.source_lang:
            self._cfg.translate.source_lang = source_lang
            self._cfg.stt.language = source_lang
            changed = True
        if target_lang and target_lang != self._cfg.translate.target_lang:
            self._cfg.translate.target_lang = target_lang
            changed = True
        if changed:
            self.translator = translate_module.build(self._cfg.translate)
            self._context.clear()
            log.info(
                "Langues : %s -> %s",
                self._cfg.translate.source_lang,
                self._cfg.translate.target_lang,
            )
        return changed

    async def submit(self, segment: Segment, *, batch: bool = False) -> None:
        """Met un segment en file d'attente.

        Deux régimes, parce que les priorités sont opposées :

        - direct (`batch=False`) : la fraîcheur prime. Si le pipeline prend du
          retard, on jette le segment le plus ancien plutôt que d'afficher des
          sous-titres de plus en plus décalés.
        - rattrapage (`batch=True`) : l'exhaustivité prime. On bloque, ce qui
          fait remonter la contre-pression jusqu'à la source (socket, puis
          ffmpeg) et évite de perdre la moitié d'un replay.
        """
        if batch:
            await self._queue.put((segment, time.monotonic()))
            return

        try:
            self._queue.put_nowait((segment, time.monotonic()))
        except asyncio.QueueFull:
            try:
                dropped, _ = self._queue.get_nowait()
                log.warning("Pipeline saturé, segment %d abandonné.", dropped.index)
            except asyncio.QueueEmpty:
                pass
            self._queue.put_nowait((segment, time.monotonic()))

    async def _run(self) -> None:
        while True:
            segment, started = await self._queue.get()
            try:
                await self._process(segment, started)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — un segment raté ne tue pas le flux
                log.exception("Échec du traitement du segment %d", segment.index)
                await self._hub.broadcast({"type": "error", "message": str(exc)})

    async def _process(self, segment: Segment, started: float) -> None:
        sid = segment.index
        await self._hub.broadcast({"type": "segment", "id": sid, "state": "transcribing"})

        original = await self.stt.transcribe(segment.pcm)
        if stt_module.looks_like_hallucination(original):
            await self._hub.broadcast(
                {"type": "segment", "id": sid, "state": "dropped", "reason": "no-speech"}
            )
            return

        await self._hub.broadcast(
            {"type": "segment", "id": sid, "state": "transcribed", "original": original}
        )

        pieces: list[str] = []
        async for delta in self.translator.translate(original, list(self._context)):
            pieces.append(delta)
            await self._hub.broadcast(
                {"type": "segment", "id": sid, "state": "delta", "delta": delta}
            )

        translation = translate_module.clean("".join(pieces))
        if translation == translate_module.UNINTELLIGIBLE or not translation:
            await self._hub.broadcast(
                {"type": "segment", "id": sid, "state": "dropped", "reason": "unintelligible"}
            )
            return

        if self._context.maxlen:
            self._context.append(original)

        await self._hub.broadcast(
            {
                "type": "segment",
                "id": sid,
                "state": "done",
                "original": original,
                "translation": translation,
                "duration_ms": segment.duration_ms,
                "latency_ms": int((time.monotonic() - started) * 1000),
            }
        )


class HexaServer:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._hub = Hub()
        self._pipeline = Pipeline(cfg, self._hub)

    async def serve(self) -> None:
        self._pipeline.start()
        http = _start_http(self._cfg)
        try:
            async with websockets.serve(
                self._handle,
                self._cfg.server.host,
                self._cfg.server.port,
                max_size=4 * 1024 * 1024,
                ping_interval=20,
            ):
                log.info(
                    "WebSocket : ws://%s:%d — overlay : http://%s:%d/",
                    self._cfg.server.host,
                    self._cfg.server.port,
                    self._cfg.server.host,
                    self._cfg.http_port,
                )
                await asyncio.Future()  # tourne jusqu'à Ctrl-C
        finally:
            http.shutdown()
            await self._pipeline.stop()

    async def _handle(self, ws, path: str | None = None) -> None:
        # Tout le monde reçoit les sous-titres ; seuls certains envoient de l'audio.
        self._hub.add(ws)
        segmenter: Segmenter | None = None
        batch = False
        try:
            await ws.send(
                json.dumps(
                    {
                        "type": "ready",
                        "stt": self._pipeline.stt.name,
                        "translator": self._pipeline.translator.name,
                        "source_lang": self._cfg.translate.source_lang,
                        "target_lang": self._cfg.translate.target_lang,
                    },
                    ensure_ascii=False,
                )
            )
            async for message in ws:
                if isinstance(message, bytes):
                    if segmenter is None:
                        segmenter = Segmenter(self._cfg.audio)
                    for segment in segmenter.push(message):
                        await self._pipeline.submit(segment, batch=batch)
                    continue

                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    continue

                kind = payload.get("type")
                if kind == "hello":
                    # "batch" : source plus rapide que le temps réel (replay tiré
                    # par streamlink). On préfère alors ralentir la source plutôt
                    # que de perdre des segments.
                    batch = payload.get("mode") == "batch"
                    if self._pipeline.retarget(
                        payload.get("source_lang"), payload.get("target_lang")
                    ):
                        await self._hub.broadcast(
                            {
                                "type": "ready",
                                "stt": self._pipeline.stt.name,
                                "translator": self._pipeline.translator.name,
                                "source_lang": self._cfg.translate.source_lang,
                                "target_lang": self._cfg.translate.target_lang,
                            }
                        )
                elif kind == "flush" and segmenter is not None:
                    if segment := segmenter.flush():
                        await self._pipeline.submit(segment, batch=batch)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self._hub.discard(ws)
            if segmenter is not None and (segment := segmenter.flush()):
                await self._pipeline.submit(segment, batch=batch)


def _start_http(cfg: Config) -> ThreadingHTTPServer:
    """Sert l'overlay autonome (fenêtre séparée ou source navigateur OBS)."""

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args) -> None:  # pas de bruit dans la console
            pass

    handler = functools.partial(QuietHandler, directory=str(STATIC_DIR))
    server = ThreadingHTTPServer((cfg.server.host, cfg.http_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run(cfg: Config) -> None:
    try:
        asyncio.run(HexaServer(cfg).serve())
    except KeyboardInterrupt:
        log.info("Arrêt.")
