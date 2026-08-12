"""Étape 7 - Assemblage du cours.

Les notions sont ordonnées par prérequis, pas par l'ordre d'origine des
masterclasses. C'est toute la différence entre une compilation et un cours :
chaque coach enseigne dans SON ordre, qui suppose déjà connu ce qu'il a dit
ailleurs. Le produit fusionné doit avoir son propre ordre.

Chaque leçon expose :
  - le noyau : ce sur quoi les coachs s'accordent
  - les nuances : ce qu'un seul apporte
  - les débats : les désaccords, présentés comme tels
  - les exercices et les erreurs fréquentes
  - les sources, avec timecodes
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from .util import load_taxonomy, read_json, read_jsonl, write_json

SECTION_ORDER = ["principe", "regle", "heuristique", "seuil", "sequence", "erreur", "exercice", "exemple"]
SECTION_LABEL = {
    "principe": "Principes",
    "regle": "Règles",
    "heuristique": "Repères de décision",
    "seuil": "Repères chiffrés",
    "sequence": "Marche à suivre",
    "erreur": "Erreurs fréquentes",
    "exercice": "Exercices",
    "exemple": "Exemples",
}


def assemble(out: Path, min_claims: int = 1) -> dict:
    claims = {c["id"]: c for c in read_jsonl(out / "claims.jsonl")}
    concepts = read_json(out / "concepts.json")["concepts"]
    conflicts = read_json(out / "conflicts.json")["conflicts"] if (out / "conflicts.json").exists() else []
    tax = load_taxonomy()

    conflicts_by_concept = defaultdict(list)
    for conflict in conflicts:
        conflicts_by_concept[conflict["concept_id"]].append(conflict)

    concepts = [c for c in concepts if c["n_claims"] >= min_claims]

    modules: dict[str, dict] = {}
    for concept in concepts:
        domain = concept["domain"]
        if domain not in modules:
            info = tax["domains"][domain]
            modules[domain] = {
                "module_id": domain,
                "label": info["label"],
                "level": info["level"],
                "prereq": info.get("prereq", []),
                "lessons": [],
            }

        members = [claims[i] for i in concept["claim_ids"] if i in claims]
        by_type = defaultdict(list)
        for claim in members:
            by_type[claim["type"]].append(claim)

        coaches = concept["coaches"]
        # Noyau : ce qui est dit explicitement, et par plusieurs coachs si possible.
        core = [c for c in members if c["confidence"] == "explicite"]
        unique_contrib = defaultdict(list)
        if len(coaches) > 1:
            for claim in members:
                unique_contrib[claim["coach"]].append(claim)

        modules[domain]["lessons"].append({
            "concept_id": concept["concept_id"],
            "title": concept["title"],
            "subdomain": concept["subdomain"],
            "subdomain_label": tax["domains"][domain]["subdomains"].get(concept["subdomain"], concept["subdomain"]),
            "level": concept["level"],
            "order": concept["order"],
            "coaches": coaches,
            "consensus": len(coaches) > 1,
            "n_claims": len(members),
            "sections": [
                {
                    "type": t,
                    "label": SECTION_LABEL[t],
                    "claims": [_render_claim(c) for c in by_type[t]],
                }
                for t in SECTION_ORDER if by_type.get(t)
            ],
            "debates": [
                {
                    "reasons": conflict["reasons"],
                    "context_dependent": conflict["likely_context_dependent"],
                    "positions": [
                        {"coach": s["coach"], "statement": s["statement"],
                         "conditions": s["conditions"], "anchors": s["anchors"]}
                        for s in (conflict["a"], conflict["b"])
                    ],
                }
                for conflict in conflicts_by_concept.get(concept["concept_id"], [])
            ],
            "sources": sorted({
                (c["coach"], c["lesson"], anchor)
                for c in members for anchor in c["anchors"]
            }),
            "n_explicit": len(core),
        })

    ordered = sorted(modules.values(), key=lambda m: (m["level"], len(m["prereq"]), m["module_id"]))
    for module in ordered:
        module["lessons"].sort(key=lambda l: (l["level"], -len(l["coaches"]), l["order"]))

    course = {
        "modules": ordered,
        "stats": {
            "n_modules": len(ordered),
            "n_lessons": sum(len(m["lessons"]) for m in ordered),
            "n_claims": len(claims),
            "coaches": sorted({c["coach"] for c in claims.values()}),
            "n_debates": len(conflicts),
            "n_consensus_lessons": sum(
                1 for m in ordered for l in m["lessons"] if l["consensus"]
            ),
        },
    }
    write_json(out / "course.json", course)
    _write_markdown(out, course)

    stats = course["stats"]
    print(f"\n  {stats['n_modules']} modules, {stats['n_lessons']} leçons")
    print(f"  {stats['n_consensus_lessons']} leçons adossées à plusieurs coachs")
    print(f"  {stats['n_debates']} débats intégrés")
    print(f"  -> {out / 'course.json'} et {out / 'cours'}/")
    return course


def _render_claim(claim: dict) -> dict:
    return {
        "id": claim["id"],
        "statement": claim["statement"],
        "explanation": claim["explanation"],
        "conditions": claim["conditions"],
        "coach": claim["coach"],
        "roles": claim["roles"],
        "phases": claim["phases"],
        "confidence": claim["confidence"],
        "anchors": claim["anchors"],
        "quote": claim["quote"],
        "lesson": claim["lesson"],
    }


def _write_markdown(out: Path, course: dict) -> None:
    course_dir = out / "cours"
    course_dir.mkdir(parents=True, exist_ok=True)

    toc = ["# Cours fusionné", "",
           f"Sources : {', '.join(course['stats']['coaches'])}", ""]
    for i, module in enumerate(course["modules"], start=1):
        toc.append(f"{i}. [{module['label']}](module_{i:02d}_{module['module_id']}.md) "
                   f"— {len(module['lessons'])} leçons")
    (course_dir / "README.md").write_text("\n".join(toc) + "\n", encoding="utf-8")

    for i, module in enumerate(course["modules"], start=1):
        lines = [f"# {module['label']}", ""]
        if module["prereq"]:
            lines.append(f"_Prérequis : {', '.join(module['prereq'])}_")
            lines.append("")
        for j, lesson in enumerate(module["lessons"], start=1):
            lines.append(f"## {i}.{j} {lesson['title']}")
            lines.append("")
            badge = " · ".join(filter(None, [
                lesson["subdomain_label"],
                f"niveau {lesson['level']}",
                "consensus" if lesson["consensus"] else f"apport de {lesson['coaches'][0]}",
            ]))
            lines.append(f"_{badge}_")
            lines.append("")
            for section in lesson["sections"]:
                lines.append(f"### {section['label']}")
                lines.append("")
                for claim in section["claims"]:
                    lines.append(f"- **{claim['statement']}**")
                    if claim["explanation"]:
                        lines.append(f"  - {claim['explanation']}")
                    if claim["conditions"]:
                        lines.append(f"  - _Quand :_ {' · '.join(claim['conditions'])}")
                    lines.append(f"  - _{claim['coach']}_ {' '.join(claim['anchors'])}")
                lines.append("")
            if lesson["debates"]:
                lines.append("### Ce qui fait débat")
                lines.append("")
                for debate in lesson["debates"]:
                    if debate["context_dependent"]:
                        lines.append("Les deux positions tiennent, dans des contextes différents.")
                        lines.append("")
                    for pos in debate["positions"]:
                        cond = f" — _{' · '.join(pos['conditions'])}_" if pos["conditions"] else ""
                        lines.append(f"- **{pos['coach']}** : {pos['statement']}{cond}")
                    lines.append("")
            lines.append("")
        (course_dir / f"module_{i:02d}_{module['module_id']}.md").write_text(
            "\n".join(lines), encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa assemble", description="Assemble le cours fusionné.")
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument("--min-claims", type=int, default=1)
    args = ap.parse_args(argv)
    assemble(args.out, args.min_claims)
    return 0
