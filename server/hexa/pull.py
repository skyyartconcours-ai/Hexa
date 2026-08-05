"""Source audio alternative : tirer le flux Twitch directement, sans extension.

    python -m hexa.pull --channel nomdelachaine

Le serveur récupère l'audio via streamlink + ffmpeg au lieu de l'onglet du
navigateur. Aucune extension à installer, mais l'audio n'est plus synchronisé
avec ce que tu entends : les deux lectures bufferisent indépendamment. Utilise
`--offset-ms` pour rattraper le décalage, ou reste sur l'extension si la synchro
compte (c'est le cas pour suivre une conversation).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import shutil

import websockets

from . import FRAME_BYTES, SAMPLE_RATE

log = logging.getLogger("hexa.pull")

# 80 ms par envoi : assez gros pour ne pas saturer la socket, assez petit pour
# ne pas ajouter de latence perceptible.
CHUNK_BYTES = FRAME_BYTES * 4


def _build_command(channel: str, quality: str) -> str:
    url = channel if channel.startswith("http") else f"twitch.tv/{channel}"
    return (
        f"streamlink --twitch-low-latency --stdout {url} {quality} "
        f"| ffmpeg -hide_banner -loglevel error -i pipe:0 "
        f"-vn -ac 1 -ar {SAMPLE_RATE} -f s16le pipe:1"
    )


async def pump(channel: str, server: str, quality: str, source: str, target: str) -> None:
    for binary in ("streamlink", "ffmpeg"):
        if shutil.which(binary) is None:
            raise SystemExit(f"{binary} est introuvable dans le PATH.")

    command = _build_command(channel, quality)
    log.info("Lancement : %s", command)
    process = await asyncio.create_subprocess_shell(command, stdout=asyncio.subprocess.PIPE)
    assert process.stdout is not None

    try:
        async with websockets.connect(server, max_size=4 * 1024 * 1024) as ws:
            await ws.send(
                json.dumps(
                    {
                        "type": "hello",
                        "role": "producer",
                        "source_lang": source,
                        "target_lang": target,
                    }
                )
            )
            log.info("Connecté à %s, envoi de l'audio…", server)
            while True:
                chunk = await process.stdout.read(CHUNK_BYTES)
                if not chunk:
                    break
                await ws.send(chunk)
            await ws.send(json.dumps({"type": "flush"}))
    finally:
        if process.returncode is None:
            process.terminate()
            await process.wait()


def main() -> None:
    parser = argparse.ArgumentParser(prog="hexa.pull", description=__doc__)
    parser.add_argument("--channel", required=True, help="nom de chaîne ou URL Twitch")
    parser.add_argument("--server", default="ws://127.0.0.1:8765")
    parser.add_argument("--quality", default="audio_only", help="qualité streamlink")
    parser.add_argument("--source", default="it")
    parser.add_argument("--target", default="fr")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    try:
        asyncio.run(pump(args.channel, args.server, args.quality, args.source, args.target))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
