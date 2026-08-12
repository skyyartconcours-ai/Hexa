"""Utilitaires partagés : chemins, chargement taxonomie, normalisation de texte."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAXONOMY_PATH = ROOT / "taxonomy" / "taxonomy.json"

# Mots vides français + anglais, pour la similarité lexicale.
STOPWORDS = {
    "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "et", "ou", "mais",
    "donc", "or", "ni", "car", "que", "qui", "quoi", "dont", "ou", "a", "as", "ai",
    "est", "sont", "etre", "avoir", "fait", "faire", "vais", "vas", "va", "on", "je",
    "tu", "il", "elle", "nous", "vous", "ils", "elles", "ce", "cet", "cette", "ces",
    "son", "sa", "ses", "leur", "leurs", "mon", "ma", "mes", "ton", "ta", "tes",
    "en", "dans", "sur", "sous", "pour", "par", "avec", "sans", "vers", "chez",
    "pas", "ne", "plus", "moins", "tres", "trop", "peu", "bien", "mal", "tout",
    "toute", "tous", "toutes", "meme", "aussi", "alors", "quand", "comme", "si",
    "y", "d", "l", "s", "n", "c", "j", "m", "t", "qu", "the", "a", "of", "to", "is",
    "it", "you", "your", "and", "or", "in", "on", "for", "with", "that", "this",
}


def load_taxonomy() -> dict:
    return json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))


def slugify(text: str, maxlen: int = 60) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:maxlen] or "sans-nom"


def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


# Suffixes flexionnels français, du plus long au plus court.
# Sans ça, « crash » et « crasher » sont deux mots distincts, et deux coachs qui
# se contredisent sur le même geste passent inaperçus.
_SUFFIXES = (
    "ements", "ement", "ations", "ation", "erions", "eraient", "erait", "eront",
    "erons", "erez", "aient", "antes", "ants", "ante", "ant", "ions", "iez",
    "ees", "ee", "es", "ent", "ons", "ez", "er", "ir", "s", "e",
)
_MIN_STEM = 4


def stem(word: str) -> str:
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= _MIN_STEM:
            return word[: -len(suffix)]
    return word


def content_tokens(text: str) -> set[str]:
    """Tokens signifiants d'un texte : minuscules, sans accents, sans mots vides, racinisés."""
    text = strip_accents(text.lower())
    words = re.findall(r"[a-z0-9]{2,}", text)
    return {stem(w) for w in words if w not in STOPWORDS}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def fmt_ts(seconds: float) -> str:
    """Secondes -> mm:ss (ou hh:mm:ss au-delà d'une heure)."""
    seconds = max(0, int(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def parse_ts(text: str) -> float:
    """mm:ss ou hh:mm:ss -> secondes."""
    parts = [int(p) for p in text.split(":")]
    total = 0
    for p in parts:
        total = total * 60 + p
    return float(total)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_jsonl(path: Path) -> list:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def write_jsonl(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
