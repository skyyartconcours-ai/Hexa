"""État d'avancement : où en est le pipeline, et que faire ensuite."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from .util import read_json, read_jsonl


def status(out: Path) -> int:
    print(f"\n  Dossier de travail : {out.resolve()}\n")
    steps = []

    manifest_path = out / "corpus" / "manifest.json"
    if manifest_path.exists():
        sources = read_json(manifest_path)["sources"]
        by_coach = Counter(s["coach"] for s in sources)
        hours = sum(s["duration_h"] for s in sources)
        detail = ", ".join(f"{c} ({n})" for c, n in by_coach.most_common())
        steps.append(("ingest", True, f"{len(sources)} leçons · {hours:.1f} h · {detail}"))
    else:
        steps.append(("ingest", False, "aucun corpus"))

    blocks_path = out / "blocks" / "index.json"
    n_blocks = 0
    if blocks_path.exists():
        blocks = read_json(blocks_path)["blocks"]
        n_blocks = len(blocks)
        steps.append(("blocks", True, f"{n_blocks} blocs"))
    else:
        steps.append(("blocks", False, ""))

    packs_dir = out / "packs"
    n_packs = len(list(packs_dir.glob("*.md"))) if packs_dir.exists() else 0
    steps.append(("packs", n_packs > 0, f"{n_packs} packs générés"))

    raw_dir = out / "claims_raw"
    n_raw = len(list(raw_dir.glob("*.json"))) if raw_dir.exists() else 0
    pct = f" ({100 * n_raw // n_blocks}% des blocs)" if n_blocks else ""
    steps.append(("extraction", n_raw > 0, f"{n_raw}/{n_blocks or '?'} réponses déposées{pct}"))

    claims_path = out / "claims.jsonl"
    if claims_path.exists():
        claims = read_jsonl(claims_path)
        by_coach = Counter(c["coach"] for c in claims)
        detail = ", ".join(f"{c} ({n})" for c, n in by_coach.most_common())
        steps.append(("load", True, f"{len(claims)} unités · {detail}"))
    else:
        steps.append(("load", False, ""))

    concepts_path = out / "concepts.json"
    if concepts_path.exists():
        concepts = read_json(concepts_path)["concepts"]
        multi = sum(1 for c in concepts if c["n_coaches"] > 1)
        steps.append(("cluster", True, f"{len(concepts)} notions · {multi} multi-coachs"))
    else:
        steps.append(("cluster", False, ""))

    conflicts_path = out / "conflicts.json"
    if conflicts_path.exists():
        conflicts = read_json(conflicts_path)["conflicts"]
        steps.append(("conflicts", True, f"{len(conflicts)} désaccords signalés"))
    else:
        steps.append(("conflicts", False, ""))

    course_path = out / "course.json"
    if course_path.exists():
        stats = read_json(course_path)["stats"]
        steps.append(("assemble", True, f"{stats['n_modules']} modules · {stats['n_lessons']} leçons"))
    else:
        steps.append(("assemble", False, ""))

    steps.append(("render", (out / "COURS.html").exists(), str(out / "COURS.html")))

    width = max(len(name) for name, _, _ in steps)
    for name, done, detail in steps:
        mark = "✓" if done else "·"
        print(f"  {mark} {name:<{width}}  {detail}")

    nxt = next((name for name, done, _ in steps if not done), None)
    print()
    hints = {
        "ingest": "python -m hexa ingest <dossier> --coach <nom>",
        "blocks": "python -m hexa blocks",
        "packs": "python -m hexa packs",
        "extraction": f"colle les packs dans Claude, sauve les JSON dans {out / 'claims_raw'}",
        "load": "python -m hexa load",
        "cluster": "python -m hexa cluster",
        "conflicts": "python -m hexa conflicts",
        "assemble": "python -m hexa assemble",
        "render": "python -m hexa render",
    }
    if nxt:
        print(f"  Prochaine étape : {hints[nxt]}\n")
    else:
        print("  Pipeline complet.\n")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa status")
    ap.add_argument("--out", type=Path, default=Path("build"))
    args = ap.parse_args(argv)
    return status(args.out)
