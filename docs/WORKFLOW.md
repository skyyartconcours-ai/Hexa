# Workflow complet

De la vidéo brute au cours fusionné, avec les volumétries réelles.

---

## 0. Transcrire (en amont, dans `lol-transcribe`)

### Le piège de `run.ps1`

`run.ps1` écrit en dur dans `transcripts/` et `for_ai/`. Le relancer pour un
nouveau contenu **écrase le corpus de Kirei**. Les deux étapes se lancent à la
main avec un dossier de sortie dédié :

```powershell
cd "C:\Users\Skyyart\Documents\CLAUDE CODE CODE\lol-transcribe"
.venv\Scripts\python.exe transcribe.py "D:\videos\coach_x" --out transcripts_coach_x --language fr
.venv\Scripts\python.exe chunk_for_ai.py --transcripts transcripts_coach_x --out for_ai_coach_x
```

`tools/run_masterclass.ps1` fait ces deux appels avec un paramètre obligatoire
et refuse d'écrire dans un dossier existant, ce qui rend l'écrasement impossible.

```powershell
.\tools\run_masterclass.ps1 -Source "D:\videos\coach_x" -Name coach_x -Language fr
```

`--language fr` plutôt que `auto` quand tu connais la langue : le script rejette
alors les fichiers qui ne correspondent pas, au lieu de traduire en silence.

### Après la transcription

Relis `transcripts_coach_x/_corrections.md`. Une correction juste va dans
`overrides.json`, un nom de joueur ou d'équipe dans `protected.json`. Puis rejoue
la correction sans repasser par le GPU :

```powershell
.venv\Scripts\python.exe transcribe.py "D:\videos\coach_x" --out transcripts_coach_x --fix-only
```

N'active pas `--auto-fix`.

---

## 1. Ingérer chaque coach

```bash
python -m hexa ingest transcripts_kirei       --coach "Kirei"
python -m hexa ingest transcripts_masterclass --coach "Skyyart"
python -m hexa ingest transcripts_coach_x     --coach "Coach X"
```

Le nom passé à `--coach` apparaît dans le produit final : écris-le proprement dès
le départ.

Hexa lit `.raw.json` en priorité, puis `.srt`, `.vtt`, `.md`, `.txt`. Quand
plusieurs variantes d'une même leçon coexistent, il garde la plus riche. Les
fichiers commençant par `_` (dont `_corrections.md`) sont ignorés.

Ré-ingérer un coach remplace ses entrées et **ne touche pas aux autres**. Le
dossier source n'est jamais modifié.

> Sans timecodes (`.txt` brut), l'ingestion fonctionne mais les ancres seront
> approximatives — c'est signalé à l'écran.

## 2. Découper

```bash
python -m hexa blocks
```

Blocs de ~11 000 caractères (~3k tokens), jamais à cheval sur deux leçons, coupés
sur une fin de phrase ou un silence de plus de 2 s. Chaque paragraphe porte une
ancre `[source@mm:ss]`.

L'ancre est ce qui rend le produit vérifiable : elle permet de remonter d'une
phrase du cours au moment exact de la vidéo, sans demander au modèle de recopier
des timestamps — ce qu'il fait mal.

## 3. Extraire

```bash
python -m hexa packs
```

Un fichier autoportant par bloc dans `build/packs/`. Colle-le dans Claude, sauve
la réponse dans `build/claims_raw/<block_id>.json`. Le nom du fichier doit être
exactement le `block_id` : c'est lui qui relie les affirmations à leurs ancres.

Teste sur trois blocs d'abord (`--limit 3`), vérifie le résultat, puis enchaîne.

**Volumétrie** — pour 12 h de vidéo :

| | |
|---|---|
| transcript | ~500 000 caractères |
| blocs | ~45 |
| affirmations attendues | 400 à 900 |
| extraction | 1 à 2 h à la main, quelques minutes par script |

Pour automatiser, boucle sur `build/packs/*.md` avec l'API et écris la réponse
sous le bon nom. La consigne demande un tableau JSON nu ; `load` tolère un
`” ```json ” ` autour, rien de plus.

## 4. Charger et valider

```bash
python -m hexa load
```

Puis **lis `build/_rapport_claims.md`**. Il donne :

- les entrées rejetées, avec le motif et le bloc à relancer ;
- les blocs qui n'ont produit aucune affirmation — soit l'extrait ne contenait
  rien, soit le pack n'a pas été traité ;
- la répartition par coach et par domaine ;
- le nombre d'affirmations en confiance « incertain », à relire en priorité.

Un domaine à zéro alors que le coach en parle : c'est un sous-domaine manquant
dans la taxonomie, pas une erreur d'extraction.

Le dédoublonnage ne fusionne **que** les répétitions d'un même coach. Deux coachs
qui disent la même chose sont conservés séparément : c'est un consensus, et le
consensus doit rester visible.

## 5. Regrouper

```bash
python -m hexa cluster
```

Sortie : le nombre de notions, combien sont couvertes par plusieurs coachs
(fusion réelle) et combien sont l'apport unique d'un seul.

Seuil réglable par `--threshold` (défaut 0.34) :
- notions trop éclatées, redites d'une leçon à l'autre → **baisse** à 0.28
- notions fourre-tout mélangeant des sujets → **monte** à 0.42

## 6. Arbitrer les désaccords

```bash
python -m hexa conflicts
```

`build/_desaccords.md` présente chaque cas avec les deux positions, leurs
conditions, leurs timecodes. Trois issues :

1. **Conciliable** — les deux ont raison dans leur contexte. Meilleur contenu
   possible : la leçon devient « ça dépend, et voici de quoi ». Les cas marqués
   *contexte explicite des deux côtés* sont presque toujours de ceux-là.
2. **Une position domine** — plus juste, ou plus à jour.
3. **Faux positif** — les deux disent la même chose.

Pour arbitrer avec Claude plutôt qu'à la main, donne-lui `_desaccords.md` : il a
les deux formulations, les conditions et les sources, ce qu'il faut pour trancher
sur pièces. La décision reste la tienne.

Rien n'est modifié à cette étape. Les débats sont repris tels quels dans le cours.

## 7. Assembler et rendre

```bash
python -m hexa assemble
python -m hexa render --title "Le cours"
```

Modules ordonnés par profondeur de prérequis, leçons par niveau puis par nombre
de coachs. Sortie : `build/cours/*.md` et `build/COURS.html` — un seul fichier,
sans dépendance, avec recherche et filtres par coach, rôle et niveau.

## Ajouter un coach plus tard

```bash
python -m hexa ingest transcripts_coach_y --coach "Coach Y"
python -m hexa blocks --coach "Coach Y"     # ne retouche pas les blocs existants
python -m hexa packs  --coach "Coach Y"
# extraire, puis rejouer la fusion sur l'ensemble :
python -m hexa load && python -m hexa cluster && python -m hexa conflicts
python -m hexa assemble && python -m hexa render
```

Les étapes 5 à 8 sont rejouables à volonté et ne coûtent que quelques secondes :
elles ne relisent que `claims.jsonl`. Seules l'ingestion et l'extraction du
nouveau coach demandent du travail.

## Régler la taxonomie

`taxonomy/taxonomy.json` est le levier principal. Un sous-domaine manquant est un
angle mort : les affirmations correspondantes atterrissent dans le voisin le plus
proche, ou sortent en « incertain ».

Après modification, il faut **réextraire** les blocs concernés — les packs
embarquent la taxonomie. En revanche `cluster`, `conflicts`, `assemble` et
`render` se rejouent seuls, sans coût.
