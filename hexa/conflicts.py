"""Étape 6 - Détection des désaccords entre coachs.

Ce module SIGNALE, il ne tranche jamais.

C'est le point le plus délicat de la fusion. Deux coachs qui se contredisent
disent presque toujours vrai tous les deux, dans deux contextes différents :
l'un parle de soloQ Émeraude, l'autre de jeu en équipe. Trancher
automatiquement reviendrait à supprimer un contexte de validité — la même
erreur que `--auto-fix` remplaçant un champion mal transcrit par un autre :
ça ne dégrade pas l'information, ça la détruit.

Sortie : `_desaccords.md`, un dossier de relecture où chaque cas est présenté
avec les deux positions, leurs conditions et leurs timecodes, pour que tu
arbitres — ou que tu demandes à Claude d'arbitrer sur pièces.
"""
from __future__ import annotations

import argparse
import re
from itertools import combinations
from pathlib import Path

from .util import content_tokens, jaccard, read_jsonl, read_json, write_json

# Couples d'opposés du vocabulaire LoL. Sert à repérer des candidats, pas à conclure.
ANTONYMS = [
    ("freeze", "push"), ("freeze", "crash"), ("slow", "fast"),
    ("recule", "avance"), ("passif", "agressif"), ("safe", "risque"),
    ("split", "group"), ("groupe", "splitpush"), ("solo", "groupe"),
    ("invade", "farm"), ("early", "late"), ("avant", "apres"),
    ("prends", "laisse"), ("achete", "garde"), ("ward", "sweep"),
    ("engage", "disengage"), ("focus", "ignore"), ("first", "second"),
    ("toujours", "jamais"), ("obligatoire", "optionnel"),
]

NEGATIONS = re.compile(
    r"\b(ne\s+\w+\s+pas|jamais|surtout\s+pas|evite|eviter|ne\s+pas|il\s+ne\s+faut\s+pas|deconseille)\b"
)
NUMBER = re.compile(r"\b(\d{1,4})\s*(s|sec|secondes?|min|minutes?|%|po|golds?|niveaux?|lvl)?\b")


def _polarity(text: str) -> int:
    """+1 recommandation, -1 interdiction."""
    from .util import strip_accents
    return -1 if NEGATIONS.search(strip_accents(text.lower())) else 1


def _antonym_hit(a: str, b: str) -> str | None:
    from .util import strip_accents
    ta, tb = strip_accents(a.lower()), strip_accents(b.lower())
    for x, y in ANTONYMS:
        if (x in ta and y in tb) or (y in ta and x in tb):
            return f"{x} / {y}"
    return None


def _numeric_divergence(a: str, b: str) -> str | None:
    na = {(m.group(1), m.group(2) or "") for m in NUMBER.finditer(a)}
    nb = {(m.group(1), m.group(2) or "") for m in NUMBER.finditer(b)}
    if not na or not nb:
        return None
    units_a = {u for _, u in na if u}
    units_b = {u for _, u in nb if u}
    shared = units_a & units_b
    for unit in shared:
        va = {v for v, u in na if u == unit}
        vb = {v for v, u in nb if u == unit}
        if va and vb and not (va & vb):
            return f"valeurs différentes ({'/'.join(sorted(va))} vs {'/'.join(sorted(vb))} {unit})"
    return None


def find_conflicts(claims: list[dict], concepts: list[dict], min_similarity: float = 0.25) -> list[dict]:
    # La comparaison se fait par sous-domaine, pas par notion : deux affirmations
    # opposées se ressemblent peu lexicalement (« crash à 30 s » vs « crash à 45 s
    # pour rotate »), donc le clustering les sépare souvent. Chercher au niveau du
    # sous-domaine évite de dépendre du seuil de regroupement.
    concept_of: dict[str, str] = {}
    for concept in concepts:
        for claim_id in concept["claim_ids"]:
            concept_of[claim_id] = concept["concept_id"]

    by_sub: dict[tuple, list[dict]] = {}
    for claim in claims:
        by_sub.setdefault((claim["domain"], claim["subdomain"]), []).append(claim)

    flagged: list[dict] = []
    for (domain, subdomain), members in sorted(by_sub.items()):
        if len({c["coach"] for c in members}) < 2:
            continue
        for a, b in combinations(members, 2):
            if a["coach"] == b["coach"]:
                continue
            sim = jaccard(content_tokens(a["statement"]), content_tokens(b["statement"]))
            if sim < min_similarity:
                continue  # trop éloignés pour être en désaccord sur la même chose

            reasons = []
            if _polarity(a["statement"]) != _polarity(b["statement"]):
                reasons.append("polarité opposée (l'un recommande, l'autre déconseille)")
            hit = _antonym_hit(a["statement"], b["statement"])
            if hit:
                reasons.append(f"termes opposés : {hit}")
            num = _numeric_divergence(a["statement"], b["statement"])
            if num:
                reasons.append(num)
            if not reasons:
                continue

            # Un contexte explicite des deux côtés rend le désaccord souvent réconciliable.
            both_conditioned = bool(a["conditions"]) and bool(b["conditions"])
            flagged.append({
                "concept_id": concept_of.get(a["id"], f"{domain}.{subdomain}"),
                "domain": domain,
                "subdomain": subdomain,
                "similarity": round(sim, 3),
                "reasons": reasons,
                "likely_context_dependent": both_conditioned,
                "a": _side(a),
                "b": _side(b),
            })

    flagged.sort(key=lambda f: (-len(f["reasons"]), -f["similarity"]))
    return flagged


def _side(claim: dict) -> dict:
    return {
        "claim_id": claim["id"],
        "coach": claim["coach"],
        "statement": claim["statement"],
        "explanation": claim["explanation"],
        "conditions": claim["conditions"],
        "roles": claim["roles"],
        "phases": claim["phases"],
        "confidence": claim["confidence"],
        "anchors": claim["anchors"],
        "lesson": claim["lesson"],
    }


def build_conflicts(out: Path, min_similarity: float = 0.25) -> list[dict]:
    claims = read_jsonl(out / "claims.jsonl")
    concepts = read_json(out / "concepts.json")["concepts"]
    flagged = find_conflicts(claims, concepts, min_similarity)
    write_json(out / "conflicts.json", {"conflicts": flagged})
    _write_review(out, flagged, concepts)

    reconcilable = sum(1 for f in flagged if f["likely_context_dependent"])
    print(f"\n  {len(flagged)} désaccords candidats entre coachs")
    print(f"  {reconcilable} ont un contexte explicite des deux côtés (probablement conciliables)")
    print(f"  Rien n'a été tranché. Relis {out / '_desaccords.md'}")
    return flagged


def _write_review(out: Path, flagged: list[dict], concepts: list[dict]) -> None:
    lines = [
        "# Désaccords entre coachs — dossier de relecture",
        "",
        "Ces cas sont **signalés, pas tranchés**. Un désaccord apparent est le plus",
        "souvent une différence de contexte (elo, rôle, composition, format de jeu).",
        "",
        "Pour chaque cas, trois issues possibles :",
        "",
        "1. **Conciliable** — les deux ont raison dans leur contexte. C'est le meilleur",
        "   contenu pédagogique qui existe : la leçon devient « ça dépend, et voici de quoi ».",
        "2. **Une position domine** — l'une est plus juste, ou plus à jour. Note laquelle et pourquoi.",
        "3. **Faux positif** — les deux disent la même chose, l'outil s'est trompé.",
        "",
        f"**{len(flagged)} cas à relire.**",
        "",
        "---",
        "",
    ]
    if not flagged:
        lines.append("_Aucun désaccord détecté. Avec un seul coach dans le corpus, c'est normal._")

    titles = {c["concept_id"]: c["title"] for c in concepts}
    for i, conflict in enumerate(flagged, start=1):
        a, b = conflict["a"], conflict["b"]
        lines.append(f"## {i}. {conflict['domain']} / {conflict['subdomain']}")
        lines.append("")
        lines.append(f"> Notion : _{titles.get(conflict['concept_id'], conflict['concept_id'])}_")
        lines.append("")
        lines.append(f"- signaux : {', '.join(conflict['reasons'])}")
        lines.append(f"- proximité des formulations : {conflict['similarity']}")
        if conflict["likely_context_dependent"]:
            lines.append("- **contexte explicite des deux côtés → probablement conciliable**")
        lines.append("")
        for side in (a, b):
            lines.append(f"### {side['coach']}")
            lines.append("")
            lines.append(f"**{side['statement']}**")
            lines.append("")
            if side["explanation"]:
                lines.append(f"{side['explanation']}")
                lines.append("")
            if side["conditions"]:
                lines.append("- conditions : " + " · ".join(side["conditions"]))
            lines.append(f"- rôles : {', '.join(side['roles'])} — phases : {', '.join(side['phases'])}")
            lines.append(f"- confiance : {side['confidence']}")
            lines.append(f"- source : {side['lesson']} {' '.join(side['anchors'])}")
            lines.append("")
        lines.append("**Verdict :** _(à remplir : conciliable / domine / faux positif)_")
        lines.append("")
        lines.append("---")
        lines.append("")

    (out / "_desaccords.md").write_text("\n".join(lines), encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa conflicts", description="Signale les désaccords entre coachs.")
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument("--min-similarity", type=float, default=0.25)
    args = ap.parse_args(argv)
    build_conflicts(args.out, args.min_similarity)
    return 0
