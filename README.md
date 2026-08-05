# Hexa

Sous-titres traduits en quasi-direct pour les lives Twitch, du côté du **spectateur**.

Tu regardes un streamer italien, Hexa écoute l'audio de ton onglet, le transcrit,
le traduit et affiche le résultat en overlay sur le lecteur. Le streamer n'a rien
à installer et ne voit rien : tout se passe chez toi.

---

## D'abord : est-ce que Twitch le fait ?

**Non.** Twitch n'a pas de sous-titrage automatique universel, et encore moins de
traduction. Il existe bien un support de closed captions, mais c'est au streamer
de le mettre en place, et ça ne traduit pas.

Il y a beaucoup d'outils qui ressemblent à une solution et n'en sont pas :
Subly, StreamTranslate, Akkadu, Maestra… sont des outils **pour streamers**. Ils
sous-titrent *ton propre* stream. Ils ne servent à rien pour regarder quelqu'un
d'autre — le streamer italien n'installera rien pour toi.

Ce qu'il te faut, c'est une solution **côté spectateur**, qui capte l'audio que
tu es déjà en train d'écouter. Deux familles :

| | Extensions prêtes à l'emploi | Hexa (ce dépôt) |
|---|---|---|
| Installation | 2 minutes, un clic | ~15 minutes, il faut lancer un serveur local |
| Coût | abonnement mensuel, ou quota gratuit très limité | tes propres clés d'API, ou 100 % local et gratuit |
| Confidentialité | ton audio part chez un tiers | reste sur ta machine si tu utilises Whisper en local |
| Qualité sur l'italien parlé | correcte, générique | réglable : modèle, contexte, jargon gaming |
| Latence | ~2 s | ~1,5–2,5 s, ajustable |

**Si tu veux juste que ça marche ce soir**, prends une extension existante et
oublie ce dépôt : [Whisperr](https://whisperr.co/use-cases/translate-twitch-stream/),
[TranslateSub](https://translatesub.com/en/extension) ou
[Maestra](https://maestra.ai/blogs/how-to-translate-live-streams-in-real-time)
font exactement ça, avec un abonnement.

Hexa existe pour le cas où tu veux que ce soit gratuit à l'usage, privé, et
réglable — notamment sur l'argot et le jargon gaming, là où la traduction
automatique générique décroche.

---

## Comment ça marche

```
onglet Twitch ──> extension Chrome ──WebSocket──> serveur local
   (audio)         (capture 16 kHz)                    │
                                                       ├─ VAD : découpe en phrases
                                                       ├─ Whisper : transcrit l'italien
                                                       └─ Claude : traduit en français
                                                           │
   overlay sur le lecteur <──── streaming des mots ────────┘
```

Deux points qui font la différence à l'usage :

- **La segmentation par VAD.** On ne traduit pas toutes les 3 secondes en
  aveugle : on attend une vraie pause dans la parole. Les phrases arrivent
  entières, pas hachées au milieu d'un mot.
- **Le streaming de la traduction.** Les mots s'écrivent au fur et à mesure que
  Claude les produit. À latence totale identique, ça paraît nettement plus vivant
  qu'une phrase qui apparaît d'un bloc.

---

## Installation

### 1. Le serveur

Python 3.11 ou plus.

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows : .venv\Scripts\activate
pip install -r requirements.txt
cp config.example.toml config.toml
```

Vérifie que la plomberie tient, sans modèle ni clé d'API :

```bash
python selftest.py
```

Puis choisis tes backends dans `config.toml` (voir plus bas) et lance :

```bash
python -m hexa
```

Au premier démarrage avec `faster-whisper`, le modèle se télécharge
(~500 Mo en `small`). Ensuite c'est instantané.

### 2. L'extension

1. `chrome://extensions` → active **Mode développeur** (en haut à droite)
2. **Charger l'extension non empaquetée** → choisis le dossier `extension/`
3. Ouvre un live Twitch, clique sur l'icône Hexa, règle les langues, **Démarrer**

L'extension marche à l'identique sur un **replay** (`twitch.tv/videos/…`) : elle
capte l'audio de l'onglet, peu importe qu'il soit en direct ou non. Et sur un
replay tu peux mettre en pause, revenir en arrière, mettre un plus gros modèle —
la contrainte de latence disparaît.

Chrome 116 minimum. Fonctionne aussi sur Edge, Brave, Opera et tout ce qui est
basé sur Chromium. Pas sur Firefox — l'API `tabCapture` de MV3 n'y existe pas
sous cette forme.

> Au démarrage, Chrome affiche que l'extension enregistre l'onglet. C'est normal,
> c'est le prix de `tabCapture`. Le son continue de sortir dans tes
> haut-parleurs : Hexa le réinjecte explicitement, parce que `tabCapture` coupe
> l'onglet par défaut.

---

## Choisir ses backends

### Transcription (`[stt]`)

| `backend` | Coût | Latence | Remarque |
|---|---|---|---|
| `faster-whisper` | gratuit | 0,3–1 s | **Par défaut.** 100 % local. `small` suffit en italien sur CPU ; `large-v3` si tu as un GPU. |
| `groq` | ~0,04 $/h d'audio | 0,2–0,4 s | Le meilleur compromis si ta machine rame. `model = "whisper-large-v3-turbo"`, `GROQ_API_KEY`. |
| `openai` | ~0,36 $/h d'audio | 0,4–0,8 s | `OPENAI_API_KEY`. |
| `mock` | — | — | Pour tester la plomberie sans rien installer. |

### Traduction (`[translate]`)

| `backend` | Coût | Remarque |
|---|---|---|
| `claude` | à l'usage | **Par défaut.** Le seul qui reçoit le contexte des phrases précédentes, donc le seul qui suit une vanne sur deux répliques et laisse le jargon gaming tranquille. Clé : `ANTHROPIC_API_KEY`, ou un profil `ant auth login`. |
| `deepl` | 500 k caractères/mois gratuits | Excellent sur it→fr, très rapide, mais pas de streaming et pas de mémoire d'une phrase à l'autre. `DEEPL_API_KEY`. |
| `none` | gratuit | Affiche la transcription italienne sans traduire. Utile pour apprendre la langue. |

Les clés se mettent dans l'environnement, jamais dans `config.toml` :

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GROQ_API_KEY=gsk_...      # seulement si backend = "groq"
```

**La combinaison la moins chère** — `stt = "faster-whisper"` + `translate =
"deepl"` : gratuit jusqu'à 500 k caractères par mois, soit largement plus que ce
que tu regarderas.

**La combinaison la plus confortable** — `stt = "groq"` + `translate = "claude"` :
latence minimale et traduction qui tient la route sur de l'oral rapide et
argotique.

---

## Régler la latence

Le curseur principal est `silence_ms` dans `[audio]` : la durée de silence qui
déclenche la fin d'une phrase.

| Valeur | Effet |
|---|---|
| `350` | Réactif, mais coupe au milieu des phrases quand le streamer hésite |
| `550` | Par défaut. Bon compromis. |
| `800` | Phrases toujours entières, ~250 ms de retard en plus |

Les autres leviers, par ordre d'impact :

- `[stt] model` — `small` → `base` fait gagner ~40 % de temps de transcription et
  perd nettement en qualité sur l'italien parlé vite. À n'utiliser qu'en dernier
  recours.
- `[translate] effort` — déjà à `low`, c'est le bon réglage pour du sous-titre.
- `[translate] fast_mode = true` — mode rapide de Claude, jusqu'à ~2,5× plus de
  tokens par seconde. Tarif premium, à activer seulement si la traduction est
  visiblement le goulot d'étranglement.
- `[translate] thinking = "disabled"` — retire la latence de réflexion, mais rend
  la sortie moins fiable (des balises internes peuvent fuiter ; Hexa les filtre,
  mais mieux vaut rester sur `"adaptive"` sauf si tu mesures un vrai gain).

Chaque sous-titre terminé porte son `latency_ms` dans le flux WebSocket : c'est
la mesure à regarder avant de tourner les boutons au jugé.

---

## Sans extension : l'overlay autonome

Le serveur sert aussi un overlay indépendant sur `http://127.0.0.1:8766/`,
utilisable comme **source navigateur dans OBS** ou dans une simple fenêtre à côté
du stream. Il se connecte tout seul au serveur.

Réglages par l'URL :

```
http://127.0.0.1:8766/?size=34&keep=8&lines=3&src=1&solid=1
```

| Paramètre | Effet |
|---|---|
| `size` | taille du texte en pixels |
| `keep` | durée d'affichage d'une ligne, en secondes |
| `lines` | nombre de lignes visibles |
| `src=1` | affiche aussi le texte original |
| `solid=1` | fond opaque (fenêtre séparée) plutôt que transparent (OBS) |

Pour alimenter cet overlay **sans extension du tout**, le serveur peut tirer le
flux lui-même — live comme replay :

```bash
pip install streamlink          # ffmpeg doit aussi être dans le PATH

python -m hexa.pull --channel nomdelachaine                     # live
python -m hexa.pull --channel https://twitch.tv/videos/123456   # replay
```

⚠️ Dans ce mode, l'audio analysé n'est **pas** synchronisé avec ce que tu
entends : ton lecteur Twitch et `streamlink` bufferisent chacun de leur côté, et
le décalage varie. C'est acceptable pour du contenu passif, pas pour suivre une
conversation. Si la synchro compte, reste sur l'extension.

### Transcrire un replay entier, plus vite que sa durée

```bash
python -m hexa.pull --channel https://twitch.tv/videos/123456 --no-realtime
```

Par défaut, `hexa.pull` cadence l'envoi à 1x. C'est indispensable sur un replay,
que `streamlink` télécharge sinon à pleine vitesse : sans cadençage, une heure
d'audio arriverait en quelques secondes et le pipeline en jetterait la plus
grande partie.

`--no-realtime` lève le cadençage et bascule le serveur en mode rattrapage : au
lieu de jeter les segments en trop, il applique de la contre-pression jusqu'à
`ffmpeg`, qui ralentit. Rien n'est perdu, ça va juste aussi vite que ta machine
le permet. Utile pour dépouiller un replay entier, inutile pour le regarder.

---

## Réglages fins

### Le jargon

Le prompt système de `ClaudeTranslator` (`server/hexa/translate.py`) dit déjà de
laisser tranquilles les pseudos, les noms de jeux et les emotes. Si tu suis une
communauté avec son vocabulaire propre, ajoute-le là : c'est trois lignes, et
c'est ce qui sépare une traduction correcte d'une traduction juste.

### Le contexte

`context_segments = 3` envoie les 3 phrases précédentes à chaque traduction.
C'est ce qui permet de résoudre les pronoms et de garder le fil. Monter à 5
améliore un peu la cohérence et coûte un peu plus. Descendre à 0 casse la
résolution des pronoms.

### Les hallucinations de Whisper

Sur les passages sans parole (musique, pause), Whisper invente des génériques de
sous-titrage — en italien, c'est presque toujours `Sottotitoli e revisione a cura
di…`. Hexa filtre les formulations connues dans `server/hexa/stt.py`. Si tu en
vois passer une autre, ajoute-la au motif `_HALLUCINATIONS`.

---

## Ce que ça ne fait pas

- **Le chat n'est pas traduit.** Hexa ne touche qu'à l'audio. Pour le chat, une
  extension de traduction de page comme Immersive Translate fait le travail.
- **Deux personnes qui parlent en même temps** donnent une bouillie. Whisper ne
  sépare pas les locuteurs.
- **Firefox n'est pas supporté** (voir plus haut).
- **La musique de fond forte dégrade la détection de parole.** Installe
  `webrtcvad-wheels` (c'est dans `requirements.txt`) : le détecteur d'énergie de
  secours s'en sort nettement moins bien dans ce cas.

---

## Structure

```
extension/          extension Chrome MV3
  background.js       service worker : orchestration
  offscreen.js        capture audio (deux contextes : lecture + 16 kHz)
  pcm-worklet.js      downmix mono + conversion int16
  content.js/css      overlay sur le lecteur Twitch
  popup.html/js       réglages

server/
  hexa/
    audio.py          VAD et découpage en segments
    stt.py            transcription (local ou API)
    translate.py      traduction (Claude en streaming, DeepL, aucune)
    server.py         hub WebSocket + serveur HTTP de l'overlay
    pull.py           source alternative via streamlink
    static/index.html overlay autonome (OBS / fenêtre séparée)
  selftest.py       test de bout en bout sans modèle ni clé
```

Le protocole WebSocket est documenté en tête de `server/hexa/server.py` — il est
volontairement simple, si tu veux brancher autre chose dessus (un lecteur VLC,
un bot, un autre site que Twitch).
