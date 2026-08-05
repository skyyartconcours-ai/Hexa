"""Chargement de la configuration (config.toml + variables d'environnement)."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    # L'overlay autonome (OBS / fenêtre séparée) est servi en HTTP sur port + 1.
    http_port: int | None = None


@dataclass
class AudioConfig:
    # VAD : "auto" essaie webrtcvad puis retombe sur le détecteur d'énergie.
    vad: str = "auto"
    # Agressivité webrtcvad (0 = permissif, 3 = strict). 2 marche bien sur un live.
    vad_aggressiveness: int = 2
    # Durée de parole continue nécessaire pour ouvrir un segment.
    start_ms: int = 100
    # Silence nécessaire pour fermer un segment. C'est le principal levier de latence.
    silence_ms: int = 550
    # Coupe forcée : un streamer qui ne respire pas ne doit pas bloquer le pipeline.
    max_segment_ms: int = 8_000
    # En dessous, on jette : c'est du bruit de clavier ou un clic.
    min_segment_ms: int = 320
    # Audio conservé avant le déclenchement, pour ne pas manger la première syllabe.
    pre_roll_ms: int = 240
    # Seuils du détecteur d'énergie (utilisé seulement sans webrtcvad).
    energy_ratio: float = 2.8
    energy_floor: float = 180.0


@dataclass
class SttConfig:
    # "faster-whisper" (local), "groq", "openai", ou "mock" (tests sans modèle).
    backend: str = "faster-whisper"
    model: str = "small"
    language: str = "it"
    device: str = "auto"
    compute_type: str = "auto"
    beam_size: int = 1
    # Rejet des hallucinations de Whisper sur les passages sans parole.
    max_no_speech_prob: float = 0.6
    min_avg_logprob: float = -1.0
    api_key: str | None = None
    api_base: str | None = None


@dataclass
class TranslateConfig:
    # "claude", "deepl", "whisper-en" (traduction interne à Whisper, vers l'anglais
    # uniquement, sans appel supplémentaire), ou "none".
    backend: str = "claude"
    target_lang: str = "fr"
    source_lang: str = "it"
    model: str = "claude-opus-5"
    max_tokens: int = 400
    effort: str = "low"
    # "adaptive" (recommandé) ou "disabled" (latence minimale, voir README).
    thinking: str = "adaptive"
    # Mode rapide Claude : ~2,5x plus de tokens/s, tarif premium.
    fast_mode: bool = False
    # Repli serveur automatique si les classificateurs refusent la requête.
    server_side_fallback: bool = True
    # Nombre de segments précédents envoyés comme contexte (pronoms, sujet en cours).
    context_segments: int = 3
    api_key: str | None = None


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)
    stt: SttConfig = field(default_factory=SttConfig)
    translate: TranslateConfig = field(default_factory=TranslateConfig)

    @property
    def http_port(self) -> int:
        return self.server.http_port or self.server.port + 1


def _apply(section: Any, values: dict[str, Any], where: str) -> None:
    known = {f.name for f in fields(section)}
    for key, value in values.items():
        if key not in known:
            raise ValueError(f"Clé inconnue dans [{where}] : {key!r}")
        setattr(section, key, value)


def load(path: str | os.PathLike[str] | None = None) -> Config:
    """Charge config.toml (si présent) puis applique les variables d'environnement.

    Les clés d'API viennent en priorité de l'environnement : on évite de les
    écrire dans un fichier qui finira par être commité.
    """
    cfg = Config()

    candidates = [Path(path)] if path else [Path("config.toml"), Path("server/config.toml")]
    for candidate in candidates:
        if candidate.is_file():
            with candidate.open("rb") as handle:
                data = tomllib.load(handle)
            for name in ("server", "audio", "stt", "translate"):
                if name in data:
                    _apply(getattr(cfg, name), data[name], name)
            break

    if env := os.environ.get("HEXA_HOST"):
        cfg.server.host = env
    if env := os.environ.get("HEXA_PORT"):
        cfg.server.port = int(env)
    if env := os.environ.get("HEXA_STT_BACKEND"):
        cfg.stt.backend = env
    if env := os.environ.get("HEXA_STT_MODEL"):
        cfg.stt.model = env
    if env := os.environ.get("HEXA_TRANSLATE_BACKEND"):
        cfg.translate.backend = env
    if env := os.environ.get("HEXA_TARGET_LANG"):
        cfg.translate.target_lang = env
    if env := os.environ.get("HEXA_SOURCE_LANG"):
        cfg.translate.source_lang = env
        cfg.stt.language = env

    apply_credentials(cfg)
    return cfg


def apply_credentials(cfg: Config) -> None:
    """Résout clés et URL d'API en fonction des backends choisis.

    Appelée à la fin de `load()`, puis de nouveau après les options de ligne de
    commande : `--stt groq` change le backend après coup, et il faut alors
    récupérer la clé et l'URL qui vont avec.
    """
    if cfg.stt.backend == "groq":
        cfg.stt.api_key = os.environ.get("GROQ_API_KEY", cfg.stt.api_key)
        cfg.stt.api_base = cfg.stt.api_base or "https://api.groq.com/openai/v1"
    elif cfg.stt.backend == "openai":
        cfg.stt.api_key = os.environ.get("OPENAI_API_KEY", cfg.stt.api_key)
        cfg.stt.api_base = cfg.stt.api_base or "https://api.openai.com/v1"

    if cfg.translate.backend == "deepl":
        cfg.translate.api_key = os.environ.get("DEEPL_API_KEY", cfg.translate.api_key)
    elif cfg.translate.backend == "claude":
        # Le SDK Anthropic résout lui-même ANTHROPIC_API_KEY ou le profil
        # `ant auth login` : on ne force la clé que si elle est explicite.
        cfg.translate.api_key = os.environ.get("ANTHROPIC_API_KEY", cfg.translate.api_key)
