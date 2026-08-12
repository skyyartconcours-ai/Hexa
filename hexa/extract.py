"""Étape 3 - Génération des packs d'extraction.

Produit un fichier autoportant par bloc : consigne + taxonomie + contenu.
Tu le colles dans Claude, tu récupères du JSON, tu le sauves dans claims_raw/.

Le déterministe est fait en Python, le jugement est fait par le modèle, et
rien n'est appliqué automatiquement — même logique que `_corrections.md` :
l'outil propose, il n'écrase pas.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from .util import load_taxonomy, read_json

CONSIGNE = """# Consigne d'extraction — corpus Hexa

Tu extrais des **unités pédagogiques atomiques** d'un extrait de masterclass League of Legends.

## Ce que tu produis

Un tableau JSON. Rien d'autre : pas de préambule, pas de commentaire, pas de bloc
de code autour. Le premier caractère est `[`, le dernier est `]`.

## Ce qu'est une unité (claim)

UNE affirmation actionnable, autoportante, compréhensible sans l'extrait.

- ✅ « Il faut freeze la vague devant sa tour quand le jungler adverse est en haut de map et qu'on est en retard de niveau. »
- ❌ « Il explique le freeze. » (c'est un résumé, pas une affirmation)
- ❌ « Le freeze c'est important. » (pas actionnable)
- ❌ Une citation brute de 40 mots (reformule proprement)

Une phrase du coach peut donner 0, 1 ou 3 unités. Un bloc en donne typiquement
entre 8 et 25. N'en force pas : du bavardage, une anecdote sans contenu ou une
digression donnent 0 unité, et c'est un résultat valide.

## Règles non négociables

1. **N'invente jamais.** Si le coach ne dit pas *pourquoi*, laisse `explanation` vide.
   Ne complète pas avec tes propres connaissances de LoL. Le produit fusionne
   plusieurs coachs : une phrase que tu ajoutes serait attribuée à un humain qui
   ne l'a jamais dite.
2. **Ancre tout.** Chaque unité cite au moins une ancre `[source@mm:ss]` prise
   littéralement dans l'extrait, celle du paragraphe d'où vient l'affirmation.
3. **Vocabulaire contrôlé.** `domain` et `subdomain` viennent de la liste ci-dessous,
   à l'identique. Si rien ne colle vraiment, prends le plus proche et mets
   `confidence: "incertain"`. N'invente pas d'identifiant.
4. **Capture le contexte.** Le champ `conditions` est le plus important du corpus :
   elo visé, matchup, composition, état de la partie, rôle. Deux coachs qui se
   contredisent disent en général la même chose dans deux contextes différents —
   sans ce champ, on ne peut pas les départager.
5. **Nomme correctement.** Champions, joueurs, équipes : orthographe exacte. Si le
   transcript contient visiblement une erreur de reconnaissance vocale sur un nom,
   garde la forme du transcript et mets `confidence: "incertain"`.

## Schéma d'une unité

```json
{
  "statement": "string, 15-400 car, obligatoire",
  "explanation": "le POURQUOI selon le coach, vide s'il ne le donne pas",
  "type": "principe|regle|heuristique|seuil|sequence|erreur|exercice|exemple",
  "domain": "identifiant de la liste",
  "subdomain": "identifiant de la liste",
  "roles": ["top|jungle|mid|adc|support|tous"],
  "phases": ["pre_game|early|mid|late|toutes"],
  "conditions": ["contexte de validité, une par entrée"],
  "level": 1,
  "anchors": ["[source@mm:ss]"],
  "quote": "citation verbatim courte à l'appui",
  "confidence": "explicite|implicite|incertain",
  "prereq_hint": ["notions supposées connues"]
}
```

`level` : 1 fondation · 2 intermédiaire · 3 avancé (suppose macro et lecture de map) · 4 expert/compétitif.

"""


def render_taxonomy(tax: dict) -> str:
    lines = ["## Vocabulaire contrôlé", ""]
    for did, dom in tax["domains"].items():
        subs = ", ".join(f"`{s}`" for s in dom["subdomains"])
        lines.append(f"- **`{did}`** — {dom['label']} (niveau {dom['level']})")
        lines.append(f"  - sous-domaines : {subs}")
    lines.append("")
    lines.append("**Types** : " + " · ".join(f"`{k}` {v}" for k, v in tax["claim_types"].items()))
    lines.append("")
    return "\n".join(lines)


def build_packs(out: Path, coach: str | None = None, limit: int | None = None) -> int:
    index = read_json(out / "blocks" / "index.json")["blocks"]
    if coach:
        index = [b for b in index if b["coach"] == coach]
    if not index:
        raise SystemExit("Aucun bloc. Lance `hexa blocks` d'abord.")
    if limit:
        index = index[:limit]

    tax = load_taxonomy()
    taxonomy_md = render_taxonomy(tax)
    packs_dir = out / "packs"
    packs_dir.mkdir(parents=True, exist_ok=True)

    for block in index:
        content = (out / "blocks" / f"{block['block_id']}.md").read_text(encoding="utf-8")
        pack = "\n".join([
            CONSIGNE,
            taxonomy_md,
            "---",
            "",
            "## Extrait à traiter",
            "",
            content,
            "",
            "---",
            "",
            "Réponds uniquement avec le tableau JSON.",
            "",
        ])
        (packs_dir / f"{block['block_id']}.md").write_text(pack, encoding="utf-8")

    (out / "claims_raw").mkdir(parents=True, exist_ok=True)
    print(f"\n  {len(index)} packs générés -> {packs_dir}")
    print(f"  Colle chaque pack dans Claude, sauve la réponse JSON dans :")
    print(f"     {out / 'claims_raw'}/<block_id>.json")
    print(f"  Puis : hexa load")
    return len(index)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa packs", description="Génère les packs d'extraction.")
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument("--coach")
    ap.add_argument("--limit", type=int, help="N'en générer que N (test)")
    args = ap.parse_args(argv)
    build_packs(args.out, args.coach, args.limit)
    return 0
