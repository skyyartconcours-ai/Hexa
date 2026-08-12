# Hexa

Fusionne plusieurs masterclass en **un seul cours**, ordonné par prérequis, où
chaque affirmation reste attribuée à son auteur et traçable jusqu'au timecode.

`lol-transcribe` transforme des vidéos en texte. Hexa prend le relais : il
transforme plusieurs corpus de texte en un produit pédagogique unique.

---

## Le problème que ça résout

Mettre bout à bout cinq masterclass ne donne pas un cours, ça donne cinq
masterclass à la suite. Trois obstacles, qu'aucun résumé automatique ne franchit :

**L'ordre.** Chaque coach enseigne dans son ordre à lui, qui suppose déjà connu
ce qu'il a dit trois heures plus tôt. Recoller ces ordres produit un cours qui
utilise des notions avant de les avoir introduites.

**La redondance.** Cinq coachs expliquent tous le last hit. Les garder cinq fois
noie le lecteur ; n'en garder qu'un jette quatre angles d'explication.

**Les contradictions.** L'un dit de freeze en retard, l'autre dit de ne jamais le
faire. Trancher au hasard, ou pire, moyenner, fabrique un conseil que personne
n'a donné. Or dans presque tous les cas les deux ont raison — dans des contextes
différents. C'est même le contenu le plus précieux du corpus.

Balancer 60 heures de transcript dans un prompt en demandant « fais-moi un
cours » échoue sur les trois points à la fois, et en silence.

## L'idée

L'atome du produit n'est pas le paragraphe, c'est **l'affirmation attribuée** :

> « Il faut freeze la vague devant sa tour quand on est en retard de niveau »
> — Kirei, leçon 1, `[kirei-001@04:12]`
> *Conditions : soloQ jusqu'à Émeraude, adversaire qui ne track pas la jungle*

Une fois le corpus réduit à quelques milliers d'affirmations de cette forme,
tout devient mécanique : on les regroupe par sujet sans regarder qui parle, on
compte les coachs par groupe (plusieurs = consensus, un seul = apport unique), on
détecte les oppositions, et on ordonne par prérequis.

Le champ **conditions** porte tout le poids de la fusion. C'est lui qui
transforme « deux coachs se contredisent » en « ça dépend, et voici de quoi ».

## Le principe qui gouverne tout le reste

**L'outil propose, il n'écrase pas.**

C'est la leçon de `--auto-fix` dans `lol-transcribe` : la correction automatique
avait remplacé un nom de champion mal transcrit par un autre champion. Ça ne
dégrade pas l'information, ça la détruit — et sans laisser de trace.

Hexa applique la même règle partout :

- une affirmation mal formée est **rejetée et listée**, jamais rafistolée ;
- un désaccord entre coachs est **signalé**, jamais arbitré tout seul ;
- une ancre de timecode inexacte est recalée **à l'intérieur du bloc d'origine**,
  ce qui est borné et vérifiable, et l'opération est tracée dans le rapport ;
- rien n'écrit jamais dans le dossier source.

Deux rapports à relire à chaque passe : `_rapport_claims.md` (ce qui a été rejeté)
et `_desaccords.md` (ce qu'il faut arbitrer).

## Les huit étapes

| | Commande | Ce qui se passe |
|---|---|---|
| 1 | `ingest` | Normalise une source (`.raw.json`, `.srt`, `.vtt`, `.txt`, `.md`) vers un format unique |
| 2 | `blocks` | Découpe en extraits de ~3k tokens, chaque paragraphe préfixé d'une ancre `[source@mm:ss]` |
| 3 | `packs` | Génère un fichier autoportant par bloc : consigne + taxonomie + extrait |
| 4 | `load` | Valide les réponses, rejette le non conforme, dédoublonne par coach |
| 5 | `cluster` | Regroupe les affirmations de **tous** les coachs par sujet |
| 6 | `conflicts` | Signale les oppositions entre coachs |
| 7 | `assemble` | Ordonne par prérequis et construit modules et leçons |
| 8 | `render` | Produit un HTML autonome, cherchable, sans dépendance |

`python -m hexa status` dit où tu en es et quelle commande lancer ensuite.

Seule l'étape 3→4 demande un modèle. Tout le reste est déterministe : pas d'API,
pas de clé, pas de réseau, uniquement la bibliothèque standard Python.

## Pourquoi le regroupement marche sans embeddings

Parce que l'extraction est contrainte par un vocabulaire fermé
(`taxonomy/taxonomy.json` : 13 domaines, ~70 sous-domaines). Une fois les
affirmations rangées dans le bon sous-domaine, un recouvrement lexical suffit à
séparer les notions. Le vocabulaire fermé fait le gros du travail en amont.

Corollaire : **la taxonomie est le vrai levier de qualité**. Un sous-domaine
manquant devient un angle mort. Elle se modifie à la main, et le corpus se
recharge sans repasser par le GPU ni par le modèle.

## Démarrage

```bash
python -m hexa ingest transcripts_kirei      --coach "Kirei"
python -m hexa ingest transcripts_masterclass --coach "Skyyart"
python -m hexa blocks
python -m hexa packs
# → coller chaque build/packs/*.md dans Claude
# → sauver chaque réponse JSON dans build/claims_raw/<block_id>.json
python -m hexa load
python -m hexa cluster
python -m hexa conflicts     # relire build/_desaccords.md
python -m hexa assemble
python -m hexa render
```

Détail complet, volumétrie et automatisation : [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Ce que ça ne fait pas

- **Pas de transcription.** C'est le rôle de `lol-transcribe`, en amont.
- **Pas de vérification factuelle.** Si un coach se trompe, l'erreur traverse le
  pipeline avec son attribution. Hexa garantit la traçabilité, pas la justesse.
- **Pas de conscience du patch.** Un conseil de la saison 12 et un de la saison 15
  ne sont pas distingués tout seuls. Mets la version dans `conditions` à
  l'extraction si le coach la donne.
- **Pas d'arbitrage.** Les désaccords te sont rendus, avec leurs contextes et
  leurs timecodes. La décision reste humaine.
