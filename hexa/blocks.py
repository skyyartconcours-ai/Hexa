"""Étape 2 - Découpage en blocs ancrés.

Chaque bloc est un extrait contigu d'UNE seule source, découpé sur une frontière
de phrase, avec un en-tête d'identité et des ancres [source@mm:ss] devant chaque
paragraphe.

L'ancre est la pièce maîtresse : c'est elle qui permet à une affirmation extraite
de pointer vers le timecode exact, sans que le modèle ait à recopier des
timestamps complets (ce qu'il fait mal). Elle rend chaque affirmation du produit
final vérifiable dans la vidéo d'origine.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from .util import fmt_ts, read_json, read_jsonl, write_json

# Fin de phrase : ponctuation forte suivie d'un espace.
_SENT_END = re.compile(r"(?<=[.!?…])\s+")


def merge_into_paragraphs(rows: list[dict], target_chars: int = 700) -> list[dict]:
    """Recolle les segments whisper (souvent 3-8 s) en paragraphes lisibles.

    Coupe en priorité sur une fin de phrase, et force la coupe sur un silence
    de plus de 2 s, qui marque presque toujours un changement d'idée.
    """
    paragraphs: list[dict] = []
    buf: list[str] = []
    start = None
    end = None
    prev_end = None

    def flush():
        nonlocal buf, start, end
        if buf:
            text = " ".join(buf).strip()
            text = re.sub(r"\s+", " ", text)
            if text:
                paragraphs.append({"start": start, "end": end, "text": text})
        buf = []
        start = None
        end = None

    for row in rows:
        text = row["text"].strip()
        if not text:
            continue
        gap = (row["start"] - prev_end) if (prev_end is not None and row["start"] >= 0) else 0
        if buf and gap > 2.0 and len(" ".join(buf)) > target_chars * 0.4:
            flush()
        if start is None:
            start = row["start"]
        end = row["end"]
        buf.append(text)
        prev_end = row["end"]

        current = " ".join(buf)
        if len(current) >= target_chars and _SENT_END.search(current[-120:] + " "):
            flush()
    flush()
    return paragraphs


def build_blocks(
    out: Path,
    block_chars: int = 11000,
    para_chars: int = 700,
    coach: str | None = None,
) -> dict:
    manifest = read_json(out / "corpus" / "manifest.json")
    sources = manifest["sources"]
    if coach:
        sources = [s for s in sources if s["coach"] == coach]
    if not sources:
        raise SystemExit("Aucune source dans le manifest. Lance `hexa ingest` d'abord.")

    blocks_dir = out / "blocks"
    blocks_dir.mkdir(parents=True, exist_ok=True)
    # Créé dès maintenant : c'est là que se déposent les réponses d'extraction,
    # y compris quand on court-circuite `packs` (réponses déjà disponibles).
    (out / "claims_raw").mkdir(parents=True, exist_ok=True)
    index: list[dict] = []
    n_block = 0

    for src in sources:
        rows = read_jsonl(out / "corpus" / f"{src['source_id']}.jsonl")
        paragraphs = merge_into_paragraphs(rows, para_chars)

        # Regroupe les paragraphes en blocs sans jamais franchir une frontière de source.
        chunks: list[list[dict]] = []
        current: list[dict] = []
        size = 0
        for para in paragraphs:
            para_len = len(para["text"])
            if current and size + para_len > block_chars:
                chunks.append(current)
                current = []
                size = 0
            current.append(para)
            size += para_len
        if current:
            chunks.append(current)

        for part, chunk in enumerate(chunks, start=1):
            n_block += 1
            block_id = f"{src['source_id']}-b{part:02d}"
            first = chunk[0]["start"]
            last = chunk[-1]["end"]

            lines = [
                f"# {src['coach']} — {src['title']}",
                "",
                f"- bloc : {part}/{len(chunks)}",
                f"- source_id : `{src['source_id']}`",
                f"- plage : {fmt_ts(first) if first >= 0 else '?'} → {fmt_ts(last) if last >= 0 else '?'}",
                "",
                "---",
                "",
            ]
            anchors = []
            for para in chunk:
                ts = fmt_ts(para["start"]) if para["start"] >= 0 else "??:??"
                anchor = f"[{src['source_id']}@{ts}]"
                anchors.append(anchor)
                lines.append(f"{anchor} {para['text']}")
                lines.append("")

            (blocks_dir / f"{block_id}.md").write_text("\n".join(lines), encoding="utf-8")
            index.append({
                "block_id": block_id,
                "source_id": src["source_id"],
                "coach": src["coach"],
                "title": src["title"],
                "part": part,
                "of": len(chunks),
                "start": first,
                "end": last,
                "n_paragraphs": len(chunk),
                "n_chars": sum(len(p["text"]) for p in chunk),
                "anchors": anchors,
            })

    write_json(blocks_dir / "index.json", {"blocks": index})
    total_chars = sum(b["n_chars"] for b in index)
    fmt = lambda n: f"{n:,}".replace(",", " ")
    print(f"\n  {n_block} blocs générés ({fmt(total_chars)} caractères)")
    print(f"  ~{fmt(total_chars // 4)} tokens à extraire")
    print(f"  -> {blocks_dir}")
    return {"blocks": index}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa blocks", description="Découpe le corpus en blocs ancrés.")
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument("--block-chars", type=int, default=11000, help="Taille cible d'un bloc (défaut 11000 ≈ 3k tokens)")
    ap.add_argument("--para-chars", type=int, default=700)
    ap.add_argument("--coach", help="Ne traiter qu'un coach")
    args = ap.parse_args(argv)
    build_blocks(args.out, args.block_chars, args.para_chars, args.coach)
    return 0
