"""Étape 4 - Chargement, validation et dédoublonnage des unités extraites.

Ce module ne corrige rien tout seul. Il valide, il rejette, il rapporte.
Une unité mal formée n'est pas rattrapée en douce : elle est listée dans
`_rapport_claims.md` avec son bloc d'origine, pour que tu relances ce bloc-là.

C'est exactement la leçon de `--auto-fix` : une correction automatique
plausible mais fausse détruit l'information au lieu de la dégrader.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from .util import content_tokens, jaccard, load_taxonomy, read_json, write_json, write_jsonl

VALID_TYPES = {"principe", "regle", "heuristique", "seuil", "sequence", "erreur", "exercice", "exemple"}
VALID_CONF = {"explicite", "implicite", "incertain"}
ANCHOR_RE = re.compile(r"^\[[a-z0-9\-]+@(\d{1,2}:\d{2}(?::\d{2})?|\?\?:\?\?)\]$")


def _coerce_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


def _strip_json_fence(raw: str) -> str:
    """Tolère un ```json ... ``` autour de la réponse, mais rien de plus."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def _anchor_seconds(anchor: str) -> float | None:
    match = re.search(r"@(\d{1,2}:\d{2}(?::\d{2})?)\]", anchor)
    if not match:
        return None
    parts = [int(p) for p in match.group(1).split(":")]
    total = 0
    for p in parts:
        total = total * 60 + p
    return float(total)


def _snap_anchors(cited: list[str], block_anchors: list[str]) -> tuple[list[str], int]:
    """Remplace toute ancre absente du bloc par l'ancre réelle la plus proche en temps.

    Le fichier de réponse porte l'identifiant du bloc, donc on sait de façon
    certaine de quel extrait vient l'affirmation. Recaler à l'intérieur de cet
    extrait ne peut pas déplacer une citation vers un autre passage.
    """
    known = set(block_anchors)
    timed = [(a, _anchor_seconds(a)) for a in block_anchors]
    timed = [(a, t) for a, t in timed if t is not None]

    out: list[str] = []
    snapped = 0
    for anchor in cited:
        if anchor in known:
            out.append(anchor)
            continue
        target = _anchor_seconds(anchor)
        if target is None or not timed:
            continue
        nearest = min(timed, key=lambda item: abs(item[1] - target))[0]
        if nearest not in out:
            out.append(nearest)
        snapped += 1
    # Dernier recours : rattacher au début du bloc plutôt que de perdre l'unité.
    if not out and block_anchors:
        out.append(block_anchors[0])
        snapped += 1
    return list(dict.fromkeys(out)), snapped


def validate_claim(claim: dict, block: dict, tax: dict) -> tuple[dict | None, list[str]]:
    """Retourne (claim normalisée, erreurs). Une erreur bloquante -> None."""
    errors: list[str] = []
    if not isinstance(claim, dict):
        return None, ["l'entrée n'est pas un objet JSON"]

    statement = str(claim.get("statement", "")).strip()
    if len(statement) < 15:
        errors.append(f"statement trop court ou absent : {statement[:60]!r}")
    if len(statement) > 400:
        statement = statement[:400].rstrip()

    ctype = str(claim.get("type", "")).strip().lower()
    if ctype not in VALID_TYPES:
        errors.append(f"type inconnu : {ctype!r}")

    domain = str(claim.get("domain", "")).strip().lower()
    subdomain = str(claim.get("subdomain", "")).strip().lower()
    domains = tax["domains"]
    if domain not in domains:
        errors.append(f"domaine hors taxonomie : {domain!r}")
    elif subdomain not in domains[domain]["subdomains"]:
        errors.append(f"sous-domaine {subdomain!r} absent du domaine {domain!r}")

    anchors = _coerce_list(claim.get("anchors"))
    valid_anchors = [a for a in anchors if ANCHOR_RE.match(a)]
    if not valid_anchors:
        errors.append("aucune ancre valide")

    if errors:
        return None, errors

    warnings: list[str] = []
    # Le modèle cite souvent un timecode plausible plutôt que l'ancre exacte du bloc.
    # On recale sur l'ancre réelle la plus proche : le bloc borne déjà la position
    # vraie, donc la correction est encadrée et jamais inventée. Elle est tracée.
    real_anchors, snapped = _snap_anchors(valid_anchors, block.get("anchors", []))
    if snapped:
        warnings.append(f"{snapped} ancre(s) recalée(s) sur l'ancre réelle la plus proche")
    if not real_anchors:
        errors.append("le bloc ne contient aucune ancre exploitable")
        return None, errors
    roles = [r for r in _coerce_list(claim.get("roles")) if r in tax["roles"]] or ["tous"]
    phases = [p for p in _coerce_list(claim.get("phases")) if p in tax["phases"]] or ["toutes"]

    try:
        level = int(claim.get("level") or domains[domain]["level"])
    except (TypeError, ValueError):
        level = domains[domain]["level"]
    level = min(4, max(1, level))

    confidence = str(claim.get("confidence", "")).strip().lower()
    if confidence not in VALID_CONF:
        confidence = "incertain"
        warnings.append("confidence absente -> incertain")

    normalized = {
        "statement": statement,
        "explanation": str(claim.get("explanation") or "").strip()[:1200],
        "type": ctype,
        "domain": domain,
        "subdomain": subdomain,
        "roles": roles,
        "phases": phases,
        "conditions": _coerce_list(claim.get("conditions"))[:8],
        "level": level,
        "anchors": real_anchors[:6],
        "quote": str(claim.get("quote") or "").strip()[:500],
        "confidence": confidence,
        "prereq_hint": _coerce_list(claim.get("prereq_hint"))[:6],
        "coach": block["coach"],
        "source_id": block["source_id"],
        "block_id": block["block_id"],
        "lesson": block["title"],
    }
    return normalized, warnings


def dedupe(claims: list[dict], threshold: float = 0.82) -> tuple[list[dict], int]:
    """Fusionne les quasi-doublons d'un MÊME coach.

    Un coach répète beaucoup à l'oral. Deux coachs qui disent la même chose,
    en revanche, ne sont jamais fusionnés : c'est un consensus, et le consensus
    est une information qu'on veut garder visible.
    """
    by_key: dict[tuple, list[dict]] = defaultdict(list)
    for claim in claims:
        by_key[(claim["coach"], claim["domain"], claim["subdomain"])].append(claim)

    kept: list[dict] = []
    merged = 0
    for group in by_key.values():
        buckets: list[dict] = []
        for claim in group:
            tokens = content_tokens(claim["statement"])
            for other in buckets:
                if jaccard(tokens, other["_tokens"]) >= threshold:
                    # Garde la formulation la plus explicative, cumule les ancres.
                    other["anchors"] = list(dict.fromkeys(other["anchors"] + claim["anchors"]))[:8]
                    if len(claim["explanation"]) > len(other["explanation"]):
                        other["explanation"] = claim["explanation"]
                    if len(claim["conditions"]) > len(other["conditions"]):
                        other["conditions"] = claim["conditions"]
                    other["occurrences"] = other.get("occurrences", 1) + 1
                    merged += 1
                    break
            else:
                claim["_tokens"] = tokens
                claim["occurrences"] = 1
                buckets.append(claim)
        kept.extend(buckets)

    for claim in kept:
        claim.pop("_tokens", None)
    return kept, merged


def load_claims(out: Path, dedupe_threshold: float = 0.82) -> list[dict]:
    index = {b["block_id"]: b for b in read_json(out / "blocks" / "index.json")["blocks"]}
    tax = load_taxonomy()
    raw_dir = out / "claims_raw"
    files = sorted(raw_dir.glob("*.json"))
    if not files:
        raise SystemExit(f"Aucun fichier dans {raw_dir}. Génère les packs et colle les réponses.")

    claims: list[dict] = []
    rejected: list[dict] = []
    warnings: list[dict] = []
    unparsable: list[str] = []

    for path in files:
        block_id = path.stem
        block = index.get(block_id)
        if not block:
            unparsable.append(f"{path.name} : block_id inconnu dans blocks/index.json")
            continue
        try:
            data = json.loads(_strip_json_fence(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError as exc:
            unparsable.append(f"{path.name} : JSON invalide ligne {exc.lineno} ({exc.msg})")
            continue
        if isinstance(data, dict):
            data = data.get("claims", [])
        if not isinstance(data, list):
            unparsable.append(f"{path.name} : la racine n'est ni un tableau ni {{claims:[...]}}")
            continue

        for i, item in enumerate(data):
            normalized, issues = validate_claim(item, block, tax)
            if normalized is None:
                rejected.append({"block_id": block_id, "index": i, "errors": issues,
                                 "extrait": str(item)[:160]})
            else:
                claims.append(normalized)
                if issues:
                    warnings.append({"block_id": block_id, "index": i, "warnings": issues})

    before = len(claims)
    claims, merged = dedupe(claims, dedupe_threshold)
    for i, claim in enumerate(claims, start=1):
        claim["id"] = f"C{i:05d}"

    write_jsonl(out / "claims.jsonl", claims)
    _write_report(out, claims, before, merged, rejected, warnings, unparsable, index)

    print(f"\n  {before} unités valides, {merged} doublons fusionnés -> {len(claims)} retenues")
    if rejected or unparsable:
        print(f"  ! {len(rejected)} rejetées, {len(unparsable)} fichiers illisibles")
        print(f"  -> détail dans {out / '_rapport_claims.md'}")
    coverage = len({c['block_id'] for c in claims})
    print(f"  Couverture : {coverage}/{len(index)} blocs ont produit au moins une unité")
    return claims


def _write_report(out, claims, before, merged, rejected, warnings, unparsable, index) -> None:
    lines = ["# Rapport de chargement des unités", ""]
    lines.append(f"- unités valides avant dédoublonnage : **{before}**")
    lines.append(f"- doublons fusionnés (même coach) : **{merged}**")
    lines.append(f"- unités retenues : **{len(claims)}**")
    lines.append(f"- entrées rejetées : **{len(rejected)}**")
    lines.append(f"- fichiers illisibles : **{len(unparsable)}**")
    lines.append("")

    treated = {c["block_id"] for c in claims}
    missing = [b for b in index if b not in treated]
    if missing:
        lines += ["## Blocs sans aucune unité", "",
                  "Soit l'extrait ne contenait rien d'exploitable, soit le pack n'a pas été traité.", ""]
        lines += [f"- `{b}`" for b in sorted(missing)]
        lines.append("")

    if unparsable:
        lines += ["## Fichiers illisibles", ""] + [f"- {u}" for u in unparsable] + [""]

    if rejected:
        lines += ["## Entrées rejetées", "",
                  "Rien n'a été corrigé automatiquement. Relance le pack concerné.", ""]
        by_block = defaultdict(list)
        for r in rejected:
            by_block[r["block_id"]].append(r)
        for block_id, items in sorted(by_block.items()):
            lines.append(f"### `{block_id}` — {len(items)} rejet(s)")
            lines.append("")
            for item in items:
                lines.append(f"- entrée #{item['index']} : {'; '.join(item['errors'])}")
                lines.append(f"  - `{item['extrait']}`")
            lines.append("")

    if warnings:
        counts = Counter(w for item in warnings for w in item["warnings"])
        lines += ["## Avertissements (unités conservées)", ""]
        lines += [f"- {msg} — {n}×" for msg, n in counts.most_common()]
        lines.append("")

    if claims:
        lines += ["## Répartition", ""]
        by_coach = Counter(c["coach"] for c in claims)
        lines.append("| Coach | Unités |")
        lines.append("|---|---:|")
        for coach, n in by_coach.most_common():
            lines.append(f"| {coach} | {n} |")
        lines.append("")
        by_domain = Counter(c["domain"] for c in claims)
        lines.append("| Domaine | Unités |")
        lines.append("|---|---:|")
        for domain, n in by_domain.most_common():
            lines.append(f"| {domain} | {n} |")
        lines.append("")
        low = [c for c in claims if c["confidence"] == "incertain"]
        if low:
            lines.append(f"**{len(low)} unités en confiance « incertain »** — à relire en priorité.")
            lines.append("")

    (out / "_rapport_claims.md").write_text("\n".join(lines), encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa load", description="Charge et valide les unités extraites.")
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument("--dedupe", type=float, default=0.82, help="Seuil de similarité (0-1)")
    args = ap.parse_args(argv)
    load_claims(args.out, args.dedupe)
    return 0
