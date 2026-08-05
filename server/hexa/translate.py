"""Traduction des segments transcrits, en streaming quand le backend le permet.

Le streaming compte : sur un overlay live, voir la phrase s'écrire au fur et à
mesure paraît nettement plus réactif qu'attendre la traduction complète, même à
latence totale identique.
"""

from __future__ import annotations

import logging
import re
from typing import AsyncIterator, Protocol

from .config import TranslateConfig

log = logging.getLogger(__name__)

# Réponse convenue du modèle quand le segment ne contient pas de parole exploitable.
UNINTELLIGIBLE = "∅"

# Filet de sécurité : on n'affiche jamais de balise interne dans l'overlay.
_TAGS = re.compile(r"</?(thinking|antml|system|internal)[^>]*>", re.IGNORECASE)

LANG_NAMES = {
    "fr": "français",
    "en": "anglais",
    "it": "italien",
    "es": "espagnol",
    "de": "allemand",
    "pt": "portugais",
    "nl": "néerlandais",
    "ja": "japonais",
    "ko": "coréen",
    "ru": "russe",
    "pl": "polonais",
    "tr": "turc",
}


def lang_name(code: str) -> str:
    return LANG_NAMES.get(code.lower(), code)


def clean(text: str) -> str:
    text = _TAGS.sub("", text)
    return text.strip().strip('"').strip()


class Translator(Protocol):
    name: str

    def translate(self, text: str, context: list[str]) -> AsyncIterator[str]: ...


class NullTranslator:
    """Pas de traduction : l'overlay affiche la transcription d'origine."""

    name = "none"

    async def translate(self, text: str, context: list[str]) -> AsyncIterator[str]:
        yield text


class DeepLTranslator:
    """DeepL. Très bon sur les paires européennes, une seule requête, pas de streaming."""

    def __init__(self, cfg: TranslateConfig) -> None:
        if not cfg.api_key:
            raise RuntimeError("Le backend 'deepl' a besoin de DEEPL_API_KEY.")
        self._cfg = cfg
        self.name = "deepl"
        self._url = (
            "https://api-free.deepl.com/v2/translate"
            if cfg.api_key.endswith(":fx")
            else "https://api.deepl.com/v2/translate"
        )

    async def translate(self, text: str, context: list[str]) -> AsyncIterator[str]:
        import httpx

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                self._url,
                headers={"Authorization": f"DeepL-Auth-Key {self._cfg.api_key}"},
                data={
                    "text": text,
                    "source_lang": self._cfg.source_lang.upper(),
                    "target_lang": self._cfg.target_lang.upper(),
                    # DeepL utilise le contexte pour désambiguïser sans le traduire.
                    "context": " ".join(context[-2:]),
                },
            )
            response.raise_for_status()
            payload = response.json()
        yield clean(payload["translations"][0]["text"])


class ClaudeTranslator:
    """Claude en streaming. Meilleur que la traduction automatique classique sur
    l'argot, les vannes et le jargon gaming, parce qu'il reçoit le contexte des
    segments précédents."""

    def __init__(self, cfg: TranslateConfig) -> None:
        from anthropic import AsyncAnthropic

        # Le SDK résout lui-même ANTHROPIC_API_KEY ou le profil `ant auth login`.
        self._client = AsyncAnthropic(api_key=cfg.api_key) if cfg.api_key else AsyncAnthropic()
        self._cfg = cfg
        self.name = f"claude:{cfg.model}"
        self._degraded = False  # passe à True si l'API refuse les options avancées
        self._system = self._build_system()

    def _build_system(self) -> str:
        source = lang_name(self._cfg.source_lang)
        target = lang_name(self._cfg.target_lang)
        return (
            f"Tu es traducteur en temps réel pour les sous-titres d'un live Twitch. "
            f"Tu traduis du {source} vers le {target}.\n\n"
            "Règles :\n"
            "- Réponds uniquement avec la traduction. Pas de préambule, pas "
            "d'explication, pas de guillemets autour.\n"
            "- Garde le registre parlé et le rythme de l'oral. C'est du direct, "
            "pas de la littérature.\n"
            "- Laisse tels quels les pseudos, les noms de jeux et de chaînes, les "
            "emotes (KEKW, PogChamp, LUL) et les commandes de chat.\n"
            "- Les termes de gaming ou de streaming qui restent en anglais dans la "
            "langue cible restent en anglais.\n"
            "- Le texte vient d'une reconnaissance vocale : il peut être tronqué ou "
            "mal découpé. Traduis ce qui est là, n'invente pas la suite.\n"
            f"- Si le segment ne contient pas de parole exploitable, réponds "
            f"exactement : {UNINTELLIGIBLE}\n"
            "- N'inclus jamais de balise XML interne ou système dans ta réponse."
        )

    def _request_kwargs(self, text: str, context: list[str]) -> dict:
        if context:
            joined = "\n".join(context)
            user = (
                f"<contexte>\n{joined}\n</contexte>\n\n"
                f"<segment>\n{text}\n</segment>"
            )
        else:
            user = f"<segment>\n{text}\n</segment>"

        kwargs: dict = {
            "model": self._cfg.model,
            "max_tokens": self._cfg.max_tokens,
            "system": self._system,
            "messages": [{"role": "user", "content": user}],
        }
        if self._degraded:
            return kwargs

        betas: list[str] = []
        kwargs["output_config"] = {"effort": self._cfg.effort}
        kwargs["thinking"] = {"type": self._cfg.thinking}
        if self._cfg.fast_mode:
            kwargs["speed"] = "fast"
            betas.append("fast-mode-2026-02-01")
        if self._cfg.server_side_fallback:
            # Si les classificateurs déclinent la requête, l'API la rejoue
            # elle-même sur un modèle de repli au lieu de nous rendre un refus.
            kwargs["fallbacks"] = "default"
            betas.append("server-side-fallback-2026-07-01")
        if betas:
            kwargs["betas"] = betas
        return kwargs

    async def translate(self, text: str, context: list[str]) -> AsyncIterator[str]:
        from anthropic import BadRequestError

        emitted = False
        try:
            async for chunk in self._stream(text, context):
                emitted = True
                yield chunk
            return
        except BadRequestError as exc:
            # Ne jamais rejouer un segment déjà partiellement affiché : l'overlay
            # afficherait la traduction deux fois bout à bout.
            if self._degraded or emitted:
                raise
            # Une option avancée (fast mode, fallbacks, effort) n'est pas acceptée
            # sur ce compte ou ce modèle : on repasse en requête minimale et on
            # n'y revient plus pour cette session.
            log.warning("Options avancées refusées par l'API (%s), repli minimal.", exc)
            self._degraded = True

        async for chunk in self._stream(text, context):
            yield chunk

    async def _stream(self, text: str, context: list[str]) -> AsyncIterator[str]:
        kwargs = self._request_kwargs(text, context)
        endpoint = self._client.messages if self._degraded else self._client.beta.messages

        async with endpoint.stream(**kwargs) as stream:
            async for delta in stream.text_stream:
                if delta:
                    yield delta
            message = await stream.get_final_message()

        # Sur Claude Opus 5, un refus est un HTTP 200 avec stop_reason "refusal" :
        # il faut le tester avant de faire confiance au contenu.
        if getattr(message, "stop_reason", None) == "refusal":
            details = getattr(message, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            log.warning("Traduction refusée par les classificateurs (catégorie : %s).", category)


def build(cfg: TranslateConfig) -> Translator:
    backend = cfg.backend.lower()
    if backend in ("none", "off", "whisper-en"):
        # "whisper-en" est géré en amont par le backend STT (tâche `translate` de
        # Whisper, vers l'anglais uniquement) : ici, il n'y a plus rien à faire.
        return NullTranslator()
    if backend == "deepl":
        return DeepLTranslator(cfg)
    if backend in ("claude", "anthropic"):
        return ClaudeTranslator(cfg)
    raise ValueError(f"Backend de traduction inconnu : {cfg.backend!r}")
