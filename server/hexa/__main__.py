"""Point d'entrée : `python -m hexa`."""

from __future__ import annotations

import argparse
import logging

from . import __version__, config as config_module
from .server import run


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="hexa",
        description="Serveur de sous-titres traduits en quasi-direct pour Twitch.",
    )
    parser.add_argument("--config", help="chemin d'un config.toml")
    parser.add_argument("--host", help="adresse d'écoute (défaut 127.0.0.1)")
    parser.add_argument("--port", type=int, help="port WebSocket (défaut 8765)")
    parser.add_argument("--source", help="langue source, ex. it")
    parser.add_argument("--target", help="langue cible, ex. fr")
    parser.add_argument("--stt", help="faster-whisper | groq | openai | mock")
    parser.add_argument("--model", help="modèle STT, ex. small ou large-v3")
    parser.add_argument("--translate", help="claude | deepl | none")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--version", action="version", version=f"hexa {__version__}")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # Le logger de websockets est très bavard en DEBUG et n'apporte rien ici.
    logging.getLogger("websockets").setLevel(logging.WARNING)

    cfg = config_module.load(args.config)
    if args.host:
        cfg.server.host = args.host
    if args.port:
        cfg.server.port = args.port
    if args.source:
        cfg.stt.language = args.source
        cfg.translate.source_lang = args.source
    if args.target:
        cfg.translate.target_lang = args.target
    if args.stt:
        cfg.stt.backend = args.stt
    if args.model:
        cfg.stt.model = args.model
    if args.translate:
        cfg.translate.backend = args.translate

    # Les options ci-dessus ont pu changer de backend : il faut re-résoudre les
    # clés et les URL d'API en conséquence.
    config_module.apply_credentials(cfg)

    run(cfg)


if __name__ == "__main__":
    main()
