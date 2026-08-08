# Hexa — roast IA vocal des subs Twitch

Pendant une session de ~30 minutes, chaque personne qui s'abonne ou qui offre des
subs se fait chambrer en vocal par une IA. Les vannes sont **personnalisées** :
elles s'appuient sur le pseudo, sur les habitudes de la personne dans le chat, et
sur son historique d'abonnement. Elles sont **gentilles par construction** — c'est
du roast entre potes, pas une machine à humilier.

```
Twitch EventSub ──► file d'attente ──► Claude ──► filtre sécurité ──► TTS ──► overlay OBS
   (sub / gift)                       (la vanne)   (déterministe)    (voix)   (audio + carte)
                        ▲
                        └── log du chat (SQLite) : la matière à vannes
```

---

## Ce que ça fait

| | |
|---|---|
| **Déclencheurs** | nouveaux subs, resubs (avec le message du viewer), sub gifters, receveurs de gifts |
| **Personnalisation** | pseudo, mots récurrents, longueur des messages, heure de connexion, ancienneté, ancienneté d'abonnement, nombre de subs offerts |
| **Sécurité** | prompt cadré + filtre déterministe + auto-notation du modèle + opt-out viewer + validation manuelle |
| **Sortie** | voix TTS + carte animée dans OBS, ou texte seul pour tester |
| **Régie** | panneau web : lancer/arrêter la session, valider chaque vanne, tester sur un pseudo |

---

## Installation

### 1. Prérequis

- **Node.js 20.11+**
- une **app Twitch** : https://dev.twitch.tv/console/apps
  → *Type de client* : **Public** (obligatoire, c'est ce qui autorise le login sans mot de passe)
  → *OAuth Redirect URL* : `http://localhost:3000` (le formulaire l'exige, on ne s'en sert pas)
- une **clé API Anthropic** : https://console.anthropic.com
- une **clé ElevenLabs** + un `voice_id` français (optionnel — sans ça, mode texte seul)

### 2. Mise en route

```bash
npm install
cp .env.example .env      # puis remplis .env
npm run login             # ouvre le flux Twitch : une URL + un code à taper
npm start
```

`npm run login` affiche une URL et un code à 6 caractères. Tu ouvres l'URL,
tu tapes le code, c'est fini — le token est stocké en local dans `data/hexa.db`
et se rafraîchit tout seul.

### 3. Dans OBS

Ajoute une **Source navigateur** :

- URL : `http://localhost:4747/overlay`
- Largeur / hauteur : la taille de ton canvas (1920 × 1080)
- ✅ *Arrêter la source quand elle n'est pas visible* : **décoché**
- ✅ *Rafraîchir le navigateur quand la scène devient active* : **décoché**

La régie est sur `http://localhost:4747/control` (à ouvrir sur ton second écran).

---

## Le point important : l'historique du chat

**Twitch ne fournit aucune API pour lire les messages passés d'un viewer.** Ni les
tiens, ni ceux des autres. C'est la contrainte structurelle du projet.

Hexa contourne ça en **loggant lui-même** le chat via EventSub, dans une base
SQLite locale (`data/hexa.db`). Conséquence directe :

> **Les premières sessions donneront des vannes basées surtout sur le pseudo.**
> Laisse tourner `npm start` en fond pendant quelques streams avant ta première
> session de roast — la qualité des vannes monte avec la quantité d'historique.

Ce qui est conservé : `user_id`, pseudo, texte du message, horodatage.
Ce qui est jeté à l'entrée : commandes (`!…`), messages contenant des liens.
Rétention : 30 jours par défaut (`CHAT_RETENTION_DAYS`), purge automatique.
Tout reste sur ta machine, rien n'est envoyé ailleurs que dans le prompt de la
vanne concernée.

---

## Comment on évite le dérapage

Cinq couches, du plus souple au plus strict. Aucune n'est suffisante seule.

**1. Le prompt** (`src/roast/prompt.ts`) — liste explicite de ce qui est hors
limites : physique, origine, religion, orientation, santé, famille, argent,
insultes, drames. Et un cadrage de ton : *« si la vanne pouvait blesser la
personne qui la relit seule chez elle le lendemain, elle est ratée »*.

**2. L'auto-notation** — le modèle rend une note de sévérité de 1 à 5 et la liste
des sujets sensibles qu'il a effleurés. Au-dessus de `MAX_SEVERITY` (3 par
défaut), ou si la liste n'est pas vide, la vanne est jetée sans passer.

**3. Le filtre déterministe** (`src/roast/safety.ts`) — un prompt n'est pas une
garantie, ce fichier l'est. Blocklist d'insultes et de termes dégradants,
résistante au leetspeak et aux accents (`c0nnard` est attrapé), plus des motifs
interdits : liens, commandes chat, mentions en masse, tentatives d'injection.

**4. L'opt-out viewer** — n'importe qui tape `!noroast` dans le chat et il ne sera
jamais visé ; ses vannes déjà en file sont supprimées. `!roastme` pour revenir.

**5. La validation manuelle** — `AUTO_PLAY=false` (défaut) : chaque vanne
s'affiche dans la régie et n'est jouée que si tu cliques ▶. **Garde ça pour ta
première session**, le temps de calibrer ton public.

Ce qui est filtré reste visible 20 secondes dans la régie avec le motif du rejet,
pour que tu voies ce qui a été bloqué.

---

## Réglages utiles

Tout est dans `.env` (voir `.env.example` pour la liste complète).

| Variable | Effet |
|---|---|
| `AUTO_PLAY` | `false` = tu valides chaque vanne. À laisser en `false` au début. |
| `MAX_SEVERITY` | `1` très gentil · `3` vanne de pote (défaut) · `5` aucune limite |
| `MIN_INTERVAL_SECONDS` | Silence minimum entre deux vannes (8 s). Évite la mitraillette sur un gift bomb. |
| `USER_COOLDOWN_MINUTES` | Ne pas re-viser la même personne avant N minutes (20). |
| `GIFT_RECIPIENTS` | `none` = seul le donateur est chambré · `limited` = + 3 receveurs max par vague |
| `ROAST_MODEL` | `claude-opus-5` (défaut, meilleures vannes) · `claude-sonnet-5` · `claude-haiku-4-5` |
| `ECHO_IN_CHAT` | Reposte aussi la vanne en texte dans le chat |

### Le gift bomb

C'est le cas qui casse ce genre d'outil : 100 subs offerts = 101 événements
Twitch en trois secondes. Hexa traite le **donateur** en priorité (c'est lui qu'on
veut remercier), puis au maximum `GIFT_RECIPIENTS_MAX` receveurs par fenêtre de
60 secondes. Le reste est ignoré silencieusement.

### Choix du modèle

`claude-opus-5` par défaut : c'est là que la différence s'entend le plus, parce
qu'une bonne vanne demande de repérer le détail drôle dans 25 messages de chat
banals — exactement ce que les modèles plus petits ratent. `claude-haiku-4-5`
fonctionne et coûte nettement moins cher, mais les vannes sont plus plates et
tombent plus souvent sur « ton pseudo est bizarre ».

Le prompt système (~750 tokens) est mis en cache côté Anthropic, donc il n'est
facturé plein tarif qu'à la première vanne de la session. Note : le cache ne
s'active qu'au-dessus d'un seuil qui dépend du modèle (512 tokens sur Opus 5,
1024 sur Sonnet 5) — sur Sonnet, le prompt actuel est en dessous du seuil et ne
sera pas mis en cache.

---

## Régler le ton

Si les vannes sont trop molles ou trop dures, dans l'ordre :

1. **`MAX_SEVERITY`** — le réglage le plus direct.
2. **La section `# Style` de `src/roast/prompt.ts`** — c'est là que se joue le
   registre. Ajouter des exemples de vannes que tu trouves réussies marche mieux
   que d'ajouter des interdits.
3. **`data/blocklist.txt`** — un mot ou une expression par ligne, `#` pour un
   commentaire. Rechargé au démarrage. Pour interdire les sujets propres à ta
   communauté sans toucher au code.

Le bouton **Tester une vanne** de la régie génère une vanne sur le pseudo de ton
choix sans attendre un vrai sub — utilise un pseudo qui a déjà parlé dans ton
chat pour voir la personnalisation à l'œuvre.

---

## Structure

```
src/
  index.ts            point d'entrée, câblage
  config.ts           lecture du .env
  db.ts               SQLite : chat, profils, opt-out, historique des vannes
  twitch/
    auth.ts           OAuth Device Code Flow + refresh
    login.ts          `npm run login`
    api.ts            appels Helix
    eventsub.ts       WebSocket EventSub (subs, gifts, chat) + reconnexion
  roast/
    prompt.ts         prompt système + construction du prompt utilisateur
    generator.ts      appel Claude, sortie structurée
    safety.ts         filtre déterministe
    queue.ts          session, file, cadence, lecture
  tts/                ElevenLabs
  server/             API HTTP + WebSocket
public/               overlay OBS + régie
```

**Pourquoi EventSub en WebSocket plutôt qu'en webhook :** le webhook impose une
URL HTTPS publique, donc un serveur en ligne et un certificat. Le WebSocket se
contente du token du broadcaster et tourne depuis ton PC, derrière n'importe
quelle box.

---

## État actuel

Testé : base de données et construction de profil, filtre de sécurité (blocklist,
leetspeak, sévérité, liens, sujets signalés), assemblage du prompt, format exact
de la requête Anthropic, garde-fou Haiku, serveur HTTP et pages.

**Pas testé faute d'identifiants dans l'environnement de développement :** l'appel
réel à l'API Anthropic, l'appel réel à ElevenLabs, et la connexion EventSub à
Twitch. Ces trois chemins sont écrits d'après les spécifications des API mais
n'ont pas encore vu de réponse réelle — prévois une session à blanc avant de
l'utiliser en direct.

---

## Limites connues

- **Aucun historique rétroactif.** Twitch ne le permet pas. La qualité des vannes
  dépend du temps de log accumulé.
- **Donateurs anonymes ignorés.** Pas de pseudo, pas d'historique, pas de matière.
- **Une seule chaîne** par instance.
- **Le TTS coûte au caractère.** Une session de 30 minutes avec beaucoup de subs
  peut représenter quelques milliers de caractères ElevenLabs.
