"""Étape 5 - Regroupement en notions.

Les unités de tous les coachs sont regroupées par proximité de sens, sans tenir
compte de qui les a dites. C'est ici que la fusion a lieu : une notion contient
ce que Kirei en dit ET ce que les autres en disent.

Le regroupement est déterministe (pas d'API, pas d'embeddings) parce que
l'extraction est contrainte par un vocabulaire fermé : à l'intérieur d'un
sous-domaine, un simple recouvrement lexical suffit à séparer les notions.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path

from .conflicts import _polarity
from .util import content_tokens, jaccard, load_taxonomy, read_jsonl, write_json


def _is_positive(statement: str) -> bool:
    return _polarity(statement) > 0


def cluster_claims(claims: list[dict], threshold: float = 0.34) -> list[dict]:
    """Clustering agglomératif simple à l'intérieur de chaque sous-domaine."""
    by_sub: dict[tuple, list[dict]] = defaultdict(list)
    for claim in claims:
        by_sub[(claim["domain"], claim["subdomain"])].append(claim)

    concepts: list[dict] = []
    for (domain, subdomain), group in sorted(by_sub.items()):
        clusters: list[dict] = []
        # Les unités les plus « denses » servent de graines : elles attirent le reste.
        ordered = sorted(
            group,
            key=lambda c: (len(content_tokens(c["statement"])), c.get("occurrences", 1)),
            reverse=True,
        )
        for claim in ordered:
            tokens = content_tokens(claim["statement"] + " " + " ".join(claim.get("prereq_hint", [])))
            best = None
            best_score = threshold
            for cluster in clusters:
                score = jaccard(tokens, cluster["tokens"])
                if score >= best_score:
                    best, best_score = cluster, score
            if best is None:
                clusters.append({"tokens": set(tokens), "claims": [claim]})
            else:
                best["claims"].append(claim)
                # L'intersection garde le cluster cohérent ; l'union le ferait dériver.
                merged = best["tokens"] & tokens
                best["tokens"] = merged if len(merged) >= 3 else best["tokens"]

        for i, cluster in enumerate(clusters, start=1):
            members = cluster["claims"]
            coaches = sorted({c["coach"] for c in members})
            levels = [c["level"] for c in members]
            # Le titre vient de l'unité la plus consensuelle du groupe, en préférant
            # une formulation positive : intituler une leçon « il ne faut jamais X »
            # décrit la position d'un coach, pas le sujet de la leçon.
            representative = max(
                members,
                key=lambda c: (
                    _is_positive(c["statement"]),
                    c["confidence"] == "explicite",
                    c.get("occurrences", 1),
                    len(c["explanation"]),
                ),
            )
            concepts.append({
                "concept_id": f"{domain}.{subdomain}.{i:02d}",
                "domain": domain,
                "subdomain": subdomain,
                "title": representative["statement"],
                "level": round(sum(levels) / len(levels)),
                "coaches": coaches,
                "n_coaches": len(coaches),
                "n_claims": len(members),
                "claim_ids": [c["id"] for c in members],
                "roles": sorted({r for c in members for r in c["roles"]}),
                "phases": sorted({p for c in members for p in c["phases"]}),
                "types": sorted({c["type"] for c in members}),
                "prereq_hint": sorted({p for c in members for p in c.get("prereq_hint", [])})[:8],
            })
    return concepts


def build_concepts(out: Path, threshold: float = 0.34) -> list[dict]:
    claims = read_jsonl(out / "claims.jsonl")
    tax = load_taxonomy()
    concepts = cluster_claims(claims, threshold)

    # Ordonnancement pédagogique : niveau, puis profondeur de prérequis du domaine.
    depth = _domain_depth(tax)
    concepts.sort(key=lambda c: (c["level"], depth.get(c["domain"], 0), -c["n_coaches"], c["concept_id"]))
    for i, concept in enumerate(concepts, start=1):
        concept["order"] = i

    write_json(out / "concepts.json", {"concepts": concepts})

    multi = [c for c in concepts if c["n_coaches"] > 1]
    solo = [c for c in concepts if c["n_coaches"] == 1]
    print(f"\n  {len(concepts)} notions à partir de {len(claims)} unités")
    print(f"  {len(multi)} couvertes par plusieurs coachs (fusion réelle)")
    print(f"  {len(solo)} propres à un seul coach (apport unique)")
    by_domain = Counter(c["domain"] for c in concepts)
    for domain, n in by_domain.most_common():
        label = tax["domains"][domain]["label"]
        print(f"     {label:<26} {n:>3} notions")
    print(f"  -> {out / 'concepts.json'}")
    return concepts


def _domain_depth(tax: dict) -> dict[str, int]:
    """Profondeur dans le graphe de prérequis entre domaines."""
    depth: dict[str, int] = {}

    def resolve(did: str, seen: frozenset = frozenset()) -> int:
        if did in depth:
            return depth[did]
        if did in seen:
            return 0  # cycle : on coupe
        prereqs = tax["domains"].get(did, {}).get("prereq", [])
        value = 0 if not prereqs else 1 + max(resolve(p, seen | {did}) for p in prereqs)
        depth[did] = value
        return value

    for did in tax["domains"]:
        resolve(did)
    return depth


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa cluster", description="Regroupe les unités en notions.")
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument("--threshold", type=float, default=0.34)
    args = ap.parse_args(argv)
    build_concepts(args.out, args.threshold)
    return 0
