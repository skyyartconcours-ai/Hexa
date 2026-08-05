"""Source audio alternative : tirer le flux Twitch directement, sans extension.

    python -m hexa.pull --channel nomdelachaine                    # live
    python -m hexa.pull --channel https://twitch.tv/videos/123456  # replay

Le serveur récupère l'audio via streamlink + ffmpeg au lieu de l'onglet du
navigateur. Aucune extension à installer, mais l'audio n'est plus synchronisé
avec ce que tu entends : les deux lectures bufferisent indépendamment. Reste sur
l'extension si la synchro compte (c'est le cas pour suivre une conversation).

Deux régimes de débit, parce qu'un live et un replay ne se comportent pas pareil :

- **temps réel** (défaut) : on cadence l'envoi à 1x. Indispensable pour un
  replay, que streamlink télécharge sinon à pleine vitesse — sans cadençage, une
  heure d'audio arriverait en quelques secondes et le pipeline en jetterait la
  quasi-totalité. Sans effet sur un live, qui arrive déjà à 1x.
- **rattrapage** (`--no-realtime`) : on envoie aussi vite que possible et le
  serveur applique de la contre-pression au lieu de jeter. Pour transcrire un
  replay entier plus vite que sa durée, sans le regarder.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import shutil
import time

import websockets

from . import FRAME_BYTES, SAMPLE_RATE

log = logging.getLogger("hexa.pull")

# 80 ms par envoi : assez gros pour ne pas saturer la socket, assez petit pour
# ne pas ajouter de latence perceptible.
CHUNK_BYTES = FRAME_BYTES * 4
BYTES_PER_SECOND = SAMPLE_RATE * 2  # int16 mono


def _build_command(channel: str, quality: str) -> str:
    url = channel if channel.startswith("http") else f"twitch.tv/{channel}"
    return (
        f"streamlink --twitch-low-latency --stdout {url} {quality} "
        f"| ffmpeg -hide_banner -loglevel error -i pipe:0 "
        f"-vn -ac 1 -ar {SAMPLE_RATE} -f s16le pipe:1"
    )


async def pump(
    channel: str,
    server: str,
    quality: str,
    source: str,
    target: str,
    realtime: bool = True,
) -> None:
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
                        "mode": "realtime" if realtime else "batch",
                        "source_lang": source,
                        "target_lang": target,
                    }
                )
            )
            log.info(
                "Connecté à %s, envoi de l'audio en mode %s…",
                server,
                "temps réel" if realtime else "rattrapage",
            )

            started = time.monotonic()
            sent = 0
            while True:
                chunk = await process.stdout.read(CHUNK_BYTES)
                if not chunk:
                    break
                await ws.send(chunk)
                sent += len(chunk)

                if realtime:
                    # On se cale sur l'horloge audio : la n-ième seconde d'audio
                    # part à la n-ième seconde de lecture, pas avant.
                    ahead = (started + sent / BYTES_PER_SECOND) - time.monotonic()
                    if ahead > 0:
                        await asyncio.sleep(ahead)

            await ws.send(json.dumps({"type": "flush"}))
            log.info("Source épuisée (%.1f s d'audio envoyées).", sent / BYTES_PER_SECOND)
            # Laisse au serveur le temps de traiter ce qui reste en file.
            await asyncio.sleep(2)
    finally:
        if process.returncode is None:
            process.terminate()
            await process.wait()


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="hexa.pull",
        description="Alimente Hexa depuis un live ou un replay Twitch, sans extension.",
    )
    parser.add_argument("--channel", required=True, help="nom de chaîne ou URL Twitch (live ou VOD)")
    parser.add_argument("--server", default="ws://127.0.0.1:8765")
    parser.add_argument(
        "--quality",
        default="audio_only,worst",
        help="qualité streamlink ; les replays n'exposent pas toujours audio_only",
    )
    parser.add_argument("--source", default="it")
    parser.add_argument("--target", default="fr")
    parser.add_argument(
        "--no-realtime",
        dest="realtime",
        action="store_false",
        help="envoyer aussi vite que possible (transcrire un replay entier)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    try:
        asyncio.run(
            pump(
                args.channel,
                args.server,
                args.quality,
                args.source,
                args.target,
                realtime=args.realtime,
            )
        )
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
