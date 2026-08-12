"""Étape 1 - Ingestion.

Normalise n'importe quelle source (whisper .raw.json, .srt, .vtt, .txt, .md)
vers un format unique : corpus/<source_id>.jsonl + corpus/manifest.json

Principe repris de lol-transcribe : la source d'origine n'est JAMAIS modifiée.
On lit, on normalise ailleurs. Rien n'est réécrit en place.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from .util import fmt_ts, parse_ts, read_json, slugify, write_json, write_jsonl

SUPPORTED = {".json", ".srt", ".vtt", ".txt", ".md"}
# .raw.json d'abord : c'est la source de vérité quand elle existe.
PRIORITY = [".raw.json", ".json", ".srt", ".vtt", ".md", ".txt"]


def _segments_from_whisper(data) -> list[dict]:
    """Accepte les formes usuelles de sortie whisper / faster-whisper."""
    if isinstance(data, dict):
        for key in ("segments", "chunks", "results", "transcription"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            return []
    if not isinstance(data, list):
        return []

    out = []
    for seg in data:
        if not isinstance(seg, dict):
            continue
        text = (seg.get("text") or seg.get("sentence") or seg.get("content") or "").strip()
        if not text:
            continue
        start = seg.get("start", seg.get("begin", seg.get("from")))
        end = seg.get("end", seg.get("to"))
        # Certaines sorties encapsulent les bornes dans "timestamp": [start, end]
        if start is None and isinstance(seg.get("timestamp"), (list, tuple)):
            ts = seg["timestamp"]
            start = ts[0] if len(ts) > 0 else None
            end = ts[1] if len(ts) > 1 else None
        try:
            start = float(start)
        except (TypeError, ValueError):
            start = out[-1]["end"] if out else 0.0
        try:
            end = float(end)
        except (TypeError, ValueError):
            end = start
        out.append({"start": start, "end": max(end, start), "text": text})
    return out


_SRT_TIME = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})"
)


def _segments_from_srt(raw: str) -> list[dict]:
    out = []
    blocks = re.split(r"\n\s*\n", raw.strip())
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        match = None
        text_start = 0
        for i, line in enumerate(lines):
            match = _SRT_TIME.search(line)
            if match:
                text_start = i + 1
                break
        if not match:
            continue
        h1, m1, s1, ms1, h2, m2, s2, ms2 = (int(g) for g in match.groups())
        start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000
        end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000
        text = " ".join(lines[text_start:]).strip()
        # Retire les balises de style VTT/SRT.
        text = re.sub(r"</?[^>]+>", "", text).strip()
        if text:
            out.append({"start": start, "end": end, "text": text})
    return out


_MD_MARKER = re.compile(r"^#{0,6}\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*$")


def _segments_from_text(raw: str) -> list[dict]:
    """Texte sans timecodes fiables, ou markdown avec marqueurs de temps.

    Les marqueurs seuls sur leur ligne (ex: `## 12:00`) sont utilisés comme
    bornes. Sinon on découpe par paragraphe et on marque les temps comme
    inconnus (start = end = -1), ce qui reste exploitable pour l'extraction.
    """
    out = []
    current = -1.0
    buf: list[str] = []

    def flush():
        if buf:
            text = " ".join(buf).strip()
            if text:
                out.append({"start": current, "end": current, "text": text})
            buf.clear()

    for line in raw.splitlines():
        stripped = line.strip()
        marker = _MD_MARKER.match(stripped)
        if marker:
            flush()
            current = parse_ts(marker.group(1))
            continue
        if not stripped:
            flush()
            continue
        buf.append(stripped)
    flush()
    return out


def parse_file(path: Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    suffix = path.suffix.lower()
    if suffix == ".json":
        try:
            return _segments_from_whisper(read_json(path))
        except Exception:
            return []
    if suffix in (".srt", ".vtt"):
        return _segments_from_srt(raw)
    return _segments_from_text(raw)


def pick_best_file(files: list[Path]) -> Path:
    """Entre plusieurs fichiers d'une même leçon, garde la source la plus riche."""
    def rank(p: Path) -> int:
        name = p.name.lower()
        for i, ext in enumerate(PRIORITY):
            if name.endswith(ext):
                return i
        return len(PRIORITY)
    return sorted(files, key=rank)[0]


def group_by_lesson(paths: list[Path]) -> dict[str, list[Path]]:
    """Regroupe les variantes d'une même leçon (.raw.json / .srt / .txt / .md)."""
    groups: dict[str, list[Path]] = {}
    for p in paths:
        stem = p.name
        for ext in (".raw.json", ".json", ".srt", ".vtt", ".md", ".txt"):
            if stem.lower().endswith(ext):
                stem = stem[: -len(ext)]
                break
        groups.setdefault(stem, []).append(p)
    return groups


def ingest(src: Path, out: Path, coach: str, lang: str = "fr") -> dict:
    files = [
        p for p in sorted(src.rglob("*"))
        if p.is_file() and p.suffix.lower() in SUPPORTED and not p.name.startswith("_")
    ]
    if not files:
        raise SystemExit(f"Aucun fichier exploitable sous {src}")

    groups = group_by_lesson(files)
    corpus_dir = out / "corpus"
    corpus_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = out / "corpus" / "manifest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else {"sources": []}
    # Ré-ingérer un coach remplace ses entrées, sans toucher aux autres coachs.
    manifest["sources"] = [s for s in manifest["sources"] if s["coach"] != coach]

    coach_slug = slugify(coach, 24)
    added = []
    for order, (stem, variants) in enumerate(sorted(groups.items()), start=1):
        chosen = pick_best_file(variants)
        segments = parse_file(chosen)
        if not segments:
            print(f"  ! ignoré (illisible ou vide) : {chosen.name}")
            continue

        source_id = f"{coach_slug}-{order:03d}"
        rows = []
        for i, seg in enumerate(segments):
            rows.append({
                "i": i,
                "start": round(seg["start"], 2),
                "end": round(seg["end"], 2),
                "text": seg["text"],
            })
        write_jsonl(corpus_dir / f"{source_id}.jsonl", rows)

        timed = [s for s in segments if s["start"] >= 0]
        duration = max((s["end"] for s in timed), default=0.0)
        chars = sum(len(s["text"]) for s in segments)
        entry = {
            "source_id": source_id,
            "coach": coach,
            "title": stem,
            "order": order,
            "language": lang,
            "origin_file": str(chosen.relative_to(src)),
            "origin_format": chosen.suffix.lower(),
            "has_timecodes": bool(timed),
            "duration_s": round(duration, 1),
            "duration_h": round(duration / 3600, 2),
            "n_segments": len(rows),
            "n_chars": chars,
        }
        manifest["sources"].append(entry)
        added.append(entry)

    manifest["sources"].sort(key=lambda s: (s["coach"], s["order"]))
    write_json(manifest_path, manifest)

    total_h = sum(e["duration_h"] for e in added)
    total_chars = f"{sum(e['n_chars'] for e in added):,}".replace(",", " ")
    print(f"\n  {len(added)} leçons ingérées pour « {coach} »")
    print(f"  {total_h:.1f} h de contenu, {total_chars} caractères")
    no_tc = [e for e in added if not e["has_timecodes"]]
    if no_tc:
        print(f"  ! {len(no_tc)} sans timecodes : les ancres seront approximatives")
    print(f"  -> {corpus_dir}")
    return manifest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa ingest", description="Normalise une source vers le corpus Hexa.")
    ap.add_argument("src", type=Path, help="Dossier des transcripts (ex: transcripts_kirei)")
    ap.add_argument("--coach", required=True, help="Nom du coach / auteur de la masterclass")
    ap.add_argument("--out", type=Path, default=Path("build"), help="Dossier de travail Hexa (défaut: build)")
    ap.add_argument("--language", default="fr")
    args = ap.parse_args(argv)
    ingest(args.src, args.out, args.coach, args.language)
    return 0
