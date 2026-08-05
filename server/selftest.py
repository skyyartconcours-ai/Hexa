#!/usr/bin/env python3
"""Test de bout en bout sans modèle ni clé d'API.

Lance un serveur avec les backends `mock` / `none`, y pousse de l'audio de
synthèse (parole simulée entrecoupée de silences), et vérifie que les segments
ressortent bien du pipeline avec le bon découpage.

    python selftest.py
"""

from __future__ import annotations

import asyncio
import json
import math
import struct
import sys

import websockets

from hexa import FRAME_BYTES, SAMPLE_RATE
from hexa.audio import Segmenter
from hexa.config import Config
from hexa.server import HexaServer

PORT = 8799


def tone(ms: int, freq: float = 220.0, amp: int = 9000) -> bytes:
    """Signal périodique bruité : passe pour de la parole auprès des deux VAD."""
    count = SAMPLE_RATE * ms // 1000
    out = bytearray()
    for i in range(count):
        t = i / SAMPLE_RATE
        # Deux harmoniques + une modulation lente : spectre assez riche pour que
        # webrtcvad ne le classe pas comme une tonalité pure.
        value = math.sin(2 * math.pi * freq * t) * 0.6
        value += math.sin(2 * math.pi * freq * 2.7 * t) * 0.3
        value *= 0.7 + 0.3 * math.sin(2 * math.pi * 3.0 * t)
        out += struct.pack("<h", int(value * amp))
    return bytes(out)


def silence(ms: int) -> bytes:
    return b"\x00\x00" * (SAMPLE_RATE * ms // 1000)


def test_segmenter() -> None:
    print("→ segmenter")
    cfg = Config().audio
    cfg.vad = "energy"  # déterministe, indépendant de l'installation de webrtcvad
    seg = Segmenter(cfg)

    closed = []
    closed += seg.push(silence(400))
    closed += seg.push(tone(1200))
    assert not closed, "un segment ne doit pas se fermer pendant la parole"

    closed += seg.push(silence(800))
    assert len(closed) == 1, f"attendu 1 segment, obtenu {len(closed)}"
    first = closed[0]
    assert 1100 <= first.duration_ms <= 1900, f"durée inattendue : {first.duration_ms} ms"

    closed += seg.push(tone(900) + silence(800))
    assert len(closed) == 2, f"attendu 2 segments, obtenu {len(closed)}"
    assert closed[1].index == 2

    # Un souffle trop court doit être jeté, pas transcrit.
    short = Segmenter(cfg)
    assert not short.push(tone(120) + silence(800))

    # Un flux ininterrompu doit être coupé de force.
    forced_cfg = Config().audio
    forced_cfg.vad = "energy"
    long_run = Segmenter(forced_cfg)
    produced = long_run.push(tone(12_000))
    assert produced, "la coupe forcée n'a pas eu lieu"
    assert produced[0].duration_ms <= forced_cfg.max_segment_ms + 100
    print("   ok — découpage, rejet des trop courts, coupe forcée")


def test_wav() -> None:
    print("→ emballage wav")
    from hexa.audio import pcm_to_wav

    wav = pcm_to_wav(tone(100))
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    print("   ok")


def test_hallucination_filter() -> None:
    print("→ filtre d'hallucinations")
    from hexa.stt import looks_like_hallucination

    assert looks_like_hallucination("Sottotitoli e revisione a cura di QTSS")
    assert looks_like_hallucination("   ")
    assert looks_like_hallucination("... ... ... ...")
    assert not looks_like_hallucination("Ragazzi guardate questo clip")
    print("   ok")


async def test_roundtrip() -> None:
    print("→ aller-retour websocket")
    cfg = Config()
    cfg.server.port = PORT
    cfg.server.http_port = PORT + 1
    cfg.audio.vad = "energy"
    cfg.stt.backend = "mock"
    cfg.translate.backend = "none"

    server = HexaServer(cfg)
    task = asyncio.create_task(server.serve())
    await asyncio.sleep(0.4)

    events: list[dict] = []
    try:
        async with websockets.connect(f"ws://127.0.0.1:{PORT}") as ws:
            hello = json.loads(await ws.recv())
            assert hello["type"] == "ready", hello
            assert hello["stt"] == "mock"

            await ws.send(json.dumps({"type": "hello", "role": "producer"}))

            audio = silence(300) + tone(1500) + silence(900)
            for offset in range(0, len(audio), FRAME_BYTES * 4):
                await ws.send(audio[offset : offset + FRAME_BYTES * 4])
                await asyncio.sleep(0.002)

            deadline = asyncio.get_running_loop().time() + 6
            while asyncio.get_running_loop().time() < deadline:
                remaining = deadline - asyncio.get_running_loop().time()
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                if msg.get("type") == "segment":
                    events.append(msg)
                    if msg["state"] in ("done", "dropped"):
                        break
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    states = [e["state"] for e in events]
    assert "transcribing" in states, states
    assert "done" in states, states
    done = events[-1]
    assert done["original"].startswith("[segment de"), done
    assert done["translation"] == done["original"], done
    assert done["latency_ms"] >= 0
    print(f"   ok — {len(events)} événements, latence {done['latency_ms']} ms")


class SlowStt:
    """STT artificiellement lent, pour saturer volontairement le pipeline."""

    name = "slow-mock"

    async def transcribe(self, pcm: bytes) -> str:
        await asyncio.sleep(0.1)
        return "ok"


async def _drain(mode: str, bursts: int) -> int:
    """Envoie `bursts` phrases d'un coup et compte celles qui ressortent.

    Une source plus rapide que le temps réel — un replay tiré par streamlink —
    remplit la file bien plus vite que le pipeline ne la vide. En mode "batch",
    la contre-pression doit tout préserver ; en mode "realtime", on jette
    volontairement pour ne pas dériver.
    """
    port = PORT + (2 if mode == "batch" else 4)
    cfg = Config()
    cfg.server.port = port
    cfg.server.http_port = port + 1
    cfg.audio.vad = "energy"
    cfg.stt.backend = "mock"
    cfg.translate.backend = "none"

    server = HexaServer(cfg)
    server._pipeline.stt = SlowStt()
    task = asyncio.create_task(server.serve())
    await asyncio.sleep(0.4)

    done = 0
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.recv()
            await ws.send(json.dumps({"type": "hello", "role": "producer", "mode": mode}))

            audio = b"".join(tone(400) + silence(700) for _ in range(bursts))
            for offset in range(0, len(audio), FRAME_BYTES * 8):
                await ws.send(audio[offset : offset + FRAME_BYTES * 8])
            await ws.send(json.dumps({"type": "flush"}))

            deadline = asyncio.get_running_loop().time() + 20
            while asyncio.get_running_loop().time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                if msg.get("type") == "segment" and msg["state"] in ("done", "dropped"):
                    done += 1
                    if done >= bursts:
                        break
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    return done


async def test_backpressure() -> None:
    print("→ contre-pression (replay plus rapide que le temps réel)")
    bursts = 15

    delivered = await _drain("batch", bursts)
    assert delivered == bursts, f"mode batch : {delivered}/{bursts} segments seulement"

    dropped_run = await _drain("realtime", bursts)
    assert dropped_run < bursts, (
        f"mode realtime : {dropped_run}/{bursts} — la file aurait dû déborder"
    )
    print(f"   ok — batch {delivered}/{bursts} conservés, realtime {dropped_run}/{bursts}")


def main() -> int:
    test_segmenter()
    test_wav()
    test_hallucination_filter()
    asyncio.run(test_roundtrip())
    asyncio.run(test_backpressure())
    print("\nTout est vert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
