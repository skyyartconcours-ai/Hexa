# Hexa : giveaways de présence sur Twitch + notifications de live

Une **extension Twitch** et une **petite app web** reliées au même serveur :

- Sur le live, le viewer clique sur **« Je participe »** dans l'extension (sous la vidéo).
- L'extension vérifie **automatiquement** qu'il est toujours là, environ toutes les 15 min, à un moment aléatoire. Chaque vérification réussie lui donne **1 ticket** : plus il reste, plus il a de chances.
- Au bout de 1 h 30 (réglable), le serveur fait un **tirage au sort pondéré** parmi les viewers encore présents. Le gagnant a **60 s** pour cliquer « Je suis là ! », sinon le serveur tire quelqu'un d'autre.
- Le gagnant récupère son cadeau sur l'**app**. C'est aussi là que les viewers activent les **notifications « je suis en live »**.

```
 Extension Twitch ─┐                       ┌─ Twitch : « le live démarre » (EventSub)
 (Je participe,    ├──►  Serveur Node.js  ◄┘
  présence, tirage)│     (SQLite)          ──► Notifications push (téléphone / PC)
 App web (PWA) ────┘
 (notifs, mes gains)
```

## Règles du tirage (toutes réglables dans le tableau de bord)

| Réglage | Par défaut | Effet |
|---|---|---|
| Tirage au bout de | 90 min | Le tirage se fait automatiquement à la fin du délai (ou à la main). |
| Vérification toutes les | 15 min | 1 ticket par créneau où le viewer avait le live ouvert et pas en pause. Les vérifications **avant** le clic comptent aussi. |
| Tickets minimum | 2 | Impossible de gagner en arrivant juste avant le tirage. |
| Tickets maximum | 10 | Plafond, pour qu'un nouveau venu garde une chance. |
| Bonus fidélité | +2 tickets | Si le viewer a participé aux 3 derniers giveaways. |
| Multiplicateur sub | ×1 (désactivé) | Voir l'avertissement légal plus bas. Avec « alternative gratuite », les viewers fidèles ont droit au même multiplicateur. |
| Âge minimum du compte | 30 jours | Limite les comptes créés juste pour participer. |
| Temps pour confirmer | 60 s | Le tiré au sort doit cliquer « Je suis là ! ». |
| Lancement automatique | non | Démarre un giveaway tout seul quand le live commence. |

Pour être tiré au sort, il faut : avoir cliqué sur « Je participe », avoir au moins le minimum de tickets, et avoir été vu sur le live dans les ~30 dernières minutes.

## Contenu du dépôt

```
server/src/        serveur (Express + SQLite intégré à Node)
  giveaway.js      logique : présence, tickets, tirage, confirmation
  draw.js          calcul des tickets + tirage pondéré
  twitch.js        API Twitch (connexion, subs, EventSub, PubSub extension)
  routes/          ext (extension), api (app), admin (tableau de bord), auth
server/public/     app web (PWA), tableau de bord /admin/, règlement /reglement
extension/         extension Twitch (panel.html, mobile.html, config.html)
scripts/           génération des icônes, création du zip de l'extension
```

## Installation

Il te faut **Node.js 22.13 ou plus récent** et un hébergement avec une **URL HTTPS** et un **disque persistant** pour la base SQLite. Railway, Render ou Fly.io conviennent ; un `Dockerfile` est fourni. Le disque doit être monté sur `/data`.

### 1. Créer l'application Twitch (connexion + alerte « live démarré »)

1. Va sur <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. **OAuth Redirect URL** : `https://TON-SERVEUR/auth/callback`
3. Catégorie : *Website Integration*. Récupère le **Client ID** et génère un **Client Secret**.

### 2. Créer l'extension Twitch

1. Va sur <https://dev.twitch.tv/console/extensions> → **Create Extension**. Type : **Panel**.
2. **Asset Hosting** :
   - Panel Viewer Path : `panel.html` (hauteur conseillée : 420 px)
   - Mobile Viewer Path : `mobile.html`
   - Config Path : `config.html`
3. **Capabilities** :
   - coche **Request Identity Link** (pour savoir qui a gagné) ;
   - **Allowlist for URL Fetching Domains** : `https://TON-SERVEUR` ;
   - **Allowlist for Panel URLs** : `https://TON-SERVEUR`.
4. Dans **Extension Settings → Secret Keys**, copie le secret (il est déjà en base64), puis note le **Client ID** de l'extension.

### 3. Remplir la configuration

```bash
cp .env.example .env
npx web-push generate-vapid-keys   # → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

- `BROADCASTER_ID` : ton identifiant Twitch numérique. Des sites comme « Twitch username to ID » le donnent.
- `SESSION_SECRET` et `EVENTSUB_SECRET` : deux longues chaînes aléatoires, différentes.

Sur un hébergeur, mets ces variables dans ses réglages plutôt que dans un fichier `.env`.

### 4. Lancer le serveur

```bash
npm install
npm test     # vérifie que tout fonctionne
npm start
```

Ouvre ensuite `https://TON-SERVEUR/admin/` et connecte-toi avec le compte Twitch de ta chaîne. Dans **Notifications de live**, clique sur **« Vérifier / activer l'alerte live démarré »**, puis envoie une notification de test.

### 5. Envoyer l'extension sur Twitch

```bash
EBS_URL=https://TON-SERVEUR npm run ext:zip   # crée extension.zip
```

1. Dans la console Twitch, onglet **Files**, envoie `extension.zip`. Passe ensuite l'extension en **Hosted Test** et installe-la sur ta chaîne.
2. Teste tout sur un vrai live : participation, présence, tirage.
3. **Submit for review**. Twitch valide en quelques jours à quelques semaines.

### 6. Remplir le règlement

Complète tout ce qui est entre `[crochets]` dans `server/public/reglement.html`. Le règlement est accessible depuis l'extension et l'app.

## Au quotidien

1. Tu lances ton live → les viewers qui ont activé les notifs sont prévenus.
2. Dans `/admin/`, tu lances un giveaway, ou il démarre tout seul si l'option est cochée.
3. Le tirage se fait automatiquement. Tu vois en direct qui participe, combien de vérifications chacun a, et qui a été tiré.
4. Le gagnant laisse ses coordonnées dans l'app (pseudo Discord, e-mail…). Tu les vois dans le tableau de bord ; coche « Envoyé » une fois le cadeau remis.

## Légal (France) — à lire

- **La participation doit rester gratuite** : pas d'avantage lié aux subs, Bits ou dons, sauf avec une alternative gratuite équivalente (option fournie). Le multiplicateur sub est donc **désactivé par défaut**.
- Les **notifications ne sont pas obligatoires** pour participer : le RGPD exige un consentement libre.
- Le règlement doit préciser que **Twitch n'organise pas et ne sponsorise pas** le giveaway.
- Les viewers peuvent supprimer leurs coordonnées et leurs notifications depuis l'app.

Ce dépôt n'est pas un avis juridique. Pour des lots de valeur, fais relire le règlement.

## Limites connues

- Une seule chaîne et un seul serveur. SQLite suffit largement pour quelques milliers de viewers.
- La vérification de présence prouve que le live est ouvert et pas en pause, pas que la personne regarde l'écran. C'est la confirmation en 60 s au moment du tirage qui le vérifie.
- Sur iPhone, les notifications ne marchent qu'une fois l'app ajoutée à l'écran d'accueil (iOS 16.4+). L'app l'explique au viewer.
