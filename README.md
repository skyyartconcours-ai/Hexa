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
- une **clé TTS** : Fish Audio par défaut, ou ElevenLabs / Cartesia
  (optionnel — sans clé, l'outil tourne en mode texte seul)

### 2. Mise en route

```bash
npm install
cp .env.example .env      # puis remplis .env
npm run login             # ouvre le flux Twitch : une URL + un code à taper
npm run backfill          # importe le chat de tes VODs (voir plus bas)
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
- ✅ *Contrôler l'audio via OBS* : **coché** ← indispensable

**Le son ne part pas tout seul.** Sans « Contrôler l'audio via OBS », le son de la
source navigateur sort sur ton bureau et n'arrive au stream que si tu captures
l'audio du bureau — avec le jeu et Discord par-dessus. Une fois la case cochée,
la source apparaît dans ta table de mixage. Fais ensuite un clic droit dessus →
*Propriétés audio avancées* → colonne **Monitoring audio** → choisis
**« Monitoring et sortie »** pour l'entendre toi aussi dans ton casque.

Vérifie avant le live : lance une vanne de test depuis la régie et regarde le
vu-mètre de la source bouger dans la table de mixage. Si l'aiguille ne bouge pas,
les viewers n'entendront rien.

La régie est sur `http://localhost:4747/control` (à ouvrir sur ton second écran).
Le serveur n'écoute que sur ta machine — les deux adresses ne sont pas
accessibles depuis le réseau.

---

## Le point important : l'historique du chat

**Twitch ne fournit aucune API pour lire les messages passés d'un viewer, quel
que soit le niveau de permission du token.** Être le broadcaster ne change rien :
l'endpoint n'existe pas. Les « messages récents » que tu vois en cliquant sur un
pseudo dans l'interface Twitch sont une petite fenêtre servie par un endpoint
interne du site, pas quelque chose d'interrogeable.

Hexa a donc **deux** sources de messages, complémentaires — plus une troisième
donnée, qui n'est pas du chat mais qui vaut souvent mieux (voir
« L'ancienneté d'abonnement » plus bas).

### 1. Le log en direct (automatique)

Dès que `npm start` tourne, chaque message du chat est enregistré dans une base
SQLite locale (`data/hexa.db`) via EventSub. Ce qui est conservé : `user_id`,
pseudo, texte, horodatage. Ce qui est jeté à l'entrée : commandes (`!…`) et
messages contenant des liens. Rétention 30 jours (`CHAT_RETENTION_DAYS`), purge
automatique. Tout reste sur ta machine.

### 2. L'import de tes VODs (rétroactif) — `npm run backfill`

C'est le seul moyen de récupérer de l'historique **sans attendre**. Le rejeu de
chat de tes rediffusions contient l'intégralité des messages de chaque stream
passé ; l'import les verse dans la même base.

```bash
npm run backfill                  # les 20 dernières VODs
npm run backfill -- --vods 50     # les 50 dernières
npm run backfill -- --force       # réimporte celles déjà faites
```

Les VODs déjà importées sont mémorisées, donc relancer la commande ne compte
jamais deux fois les mêmes messages. Une poignée de VODs suffit généralement à
faire passer les vannes du registre « ton pseudo est bizarre » à quelque chose
qui vise juste.

> ⚠️ **Cet import ne passe pas par l'API officielle.** Il n'y en a pas pour ça. Il
> utilise l'API GraphQL interne du lecteur web Twitch — celle qu'utilisent tous
> les outils de téléchargement de chat de VOD. Elle n'est pas documentée et peut
> changer sans préavis. L'import est donc **manuel et ponctuel**, limité à tes
> propres VODs (dont le chat est déjà public dans le lecteur), et volontairement
> lent. S'il casse un jour, le reste de l'outil continue de tourner sur le log en
> direct.

**Prérequis :** les rediffusions doivent être activées sur ta chaîne. Sans VOD,
il n'y a rien à importer. Durée de conservation côté Twitch : 60 jours pour les
partenaires et affiliés, 14 jours sinon — les highlights, eux, sont permanents
mais ne sont pas des VODs de type `archive` et ne sont pas repris ici.

### L'ancienneté d'abonnement (gratuite, officielle, immédiate)

Ce n'est pas du chat, et c'est justement l'intérêt. **Twitch attache à chaque
message la liste des badges affichés, et le badge d'abonné porte le nombre exact
de mois d'abonnement** (champ `badges[].info` de `channel.chat.message`, `founder`
compris). Hexa le lit et le range à côté du profil.

Concrètement : **dès qu'un abonné écrit un seul message dans ton chat, tu sais
depuis combien de mois il est abonné.** Pas une estimation, le chiffre. C'est la
seule source d'ancienneté qui existe — aucun endpoint Helix ne l'expose, la liste
des abonnés ne la contient pas, et l'événement de resub ne la donne qu'au moment
précis du resub. Aucun scraping, aucune extension, rien à installer.

Deux détails qui comptent :

- Si le message est jeté par le filtre d'entrée (emote seule, lien, commande),
  l'ancienneté est quand même conservée — sans le message. C'est le cas de
  l'abonné discret, celui sur qui on n'a rien d'autre.
- Si la personne se désabonne, le badge disparaît de son message suivant et la
  valeur est effacée. L'import de VODs, lui, ne sait pas lire les badges : il ne
  peut donc ni écrire ni écraser cette donnée.

Sur un resub, c'est l'événement qui prime : son chiffre est exact à la seconde,
là où le badge date du dernier message de la personne.

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

### Choix de la voix

Le TTS est interchangeable : `TTS_PROVIDER` dans `.env`, rien d'autre à toucher.

| | **Fish Audio** (défaut) | ElevenLabs | Cartesia |
|---|---|---|---|
| Prix / 1M caractères | ~15 $ | 120–165 $ | ~15 $ |
| Jeu d'acteur | didascalies en ligne | la référence historique | correct, plus neutre |
| Latence | ~70 ms | 250–300 ms | ~100 ms |
| Clonage de voix | 5 s d'audio | oui | oui |

**Fish Audio S2.1 Pro est le choix par défaut**, pour une raison qui n'est pas le
prix : c'est le seul des trois à accepter des **didascalies de jeu en ligne**.
Le modèle qui écrit la vanne choisit aussi comment elle doit être dite —
pince-sans-rire, en riant, faussement grave — et la voix la joue. Une vanne
absurde dite *deadpan* et la même dite sur un ton enjoué ne font pas du tout le
même effet ; c'est le levier le plus rentable sur ce produit.

Les six tons possibles sont dans `DELIVERIES` (`src/tts/provider.ts`). La liste
est volontairement fermée : une didascalie inventée par le modèle serait lue à
voix haute à l'antenne, donc tout ce qui sort de la liste est jeté. Le filtre de
sécurité rejette aussi toute vanne dont le *texte* contient des crochets ou des
`*astérisques*`, pour la même raison. Le ton choisi s'affiche dans la régie.

Sur les autres fournisseurs, la didascalie est silencieusement retirée : la vanne
est simplement dite au naturel, rien ne casse.

**La latence n'est pas un critère ici**, contrairement à ce que vendent la
plupart de ces API : la vanne fait six secondes et elle est générée pendant que
la précédente passe à l'antenne. Ce qui compte, c'est l'intonation.

Sur la facturation Fish Audio : elle se fait à l'**octet UTF-8**, pas au
caractère. Plusieurs comparatifs en déduisent que le français coûte le double —
c'est faux. Mesuré sur un échantillon de vannes réelles : **+3,4 %**, parce que
les accents représentent quelques pourcents des caractères, pas la moitié.

Ajouter un autre fournisseur = un fichier d'une trentaine de lignes dans
`src/tts/` qui implémente l'interface `TtsProvider`, plus une ligne dans le
registre de `src/tts/index.ts`.

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
    vod.ts            import du chat des VODs (API interne, voir avertissement)
    backfill.ts       `npm run backfill`
  roast/
    prompt.ts         prompt système + construction du prompt utilisateur
    generator.ts      appel Claude, sortie structurée
    safety.ts         filtre déterministe
    queue.ts          session, file, cadence, lecture
  tts/
    provider.ts       interface commune + liste fermée des didascalies
    fishaudio.ts      · elevenlabs.ts · cartesia.ts
  server/             API HTTP + WebSocket
public/               overlay OBS + régie
```

**Pourquoi EventSub en WebSocket plutôt qu'en webhook :** le webhook impose une
URL HTTPS publique, donc un serveur en ligne et un certificat. Le WebSocket se
contente du token du broadcaster et tourne depuis ton PC, derrière n'importe
quelle box.

---

## État actuel

**Testé** : base de données et construction de profil, filtre de sécurité
(blocklist, leetspeak, sévérité, liens, sujets signalés), assemblage du prompt,
format exact de la requête Anthropic, garde-fou effort/Haiku, sélection du
fournisseur TTS, format de requête Fish Audio et Cartesia, acheminement des
didascalies (transmises à Fish Audio, retirées ailleurs) et rejet de celles qui
fuiraient dans le texte, pagination et filtrage de l'import de VODs, déduplication
des VODs, serveur HTTP et pages.

**Pas testé faute d'identifiants dans l'environnement de développement :** les
appels réseau réels vers Anthropic, Fish Audio, ElevenLabs, Cartesia, et Twitch
(EventSub comme GraphQL). Ces chemins sont écrits d'après les spécifications des
API et leur format de requête est vérifié contre des serveurs simulés, mais aucun
n'a encore vu de réponse réelle.
**Prévois une session à blanc, hors stream, avant le direct.**

---

## Limites connues

- **L'historique rétroactif dépend de tes VODs.** Pas de rediffusions activées,
  ou VODs expirées côté Twitch, et il ne reste que le log en direct.
- **L'import de VODs passe par une API non documentée** et peut casser sans
  préavis (voir l'avertissement plus haut).
- **Donateurs anonymes ignorés.** Pas de pseudo, pas d'historique, pas de matière.
- **Une seule chaîne** par instance.
- **Le TTS coûte au caractère.** Une soirée à beaucoup de subs représente
  quelques milliers de caractères — c'est là que le choix du fournisseur pèse.
