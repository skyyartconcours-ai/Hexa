# Hexa — Spyfall en français 🕵️

Une version web de **Spyfall** avec les lieux et les rôles **en français**, pour
jouer entre amis quand votre boîte physique est… dans une autre langue.
L'appli remplace uniquement les cartes : vous jouez autour de la table comme
d'habitude, chacun avec son téléphone.

- Les 27 lieux de **Spyfall 1** et les 25 lieux de **Spyfall 2** avec leurs
  rôles officiels, tout traduit en français
- Un paquet **Délire (RP)** : 70 lieux originaux taillés pour le roleplay
  (Kebab à 3 h du matin, Réunion secrète des Illuminati, Magasin de meubles
  suédois…), classés en 10 thématiques
- Choix du paquet au lancement de chaque manche : Spyfall 1, Spyfall 2,
  les deux, Délire, ou tout mélangé (122 lieux)
- En jeu, la liste des lieux est groupée par thème : on peut rayer un
  thème entier ou un lieu d'un simple toucher (pense-bête personnel,
  l'outil d'élimination de l'espion)
- Un espion tiré au hasard, les autres reçoivent le lieu + un rôle
- Chrono configurable (8 minutes par défaut), liste des lieux consultable en jeu
- Aucune dépendance : un seul fichier serveur en Node.js

## Lancer le jeu

```bash
node server.js
```

Puis ouvrez `http://localhost:3000`. L'hôte crée une partie, partage le code à
**2 lettres** (ou un lien / QR code), les autres rejoignent depuis leur
téléphone (3 joueurs minimum).

Pour protéger l'accès, lancez avec un mot de passe partagé :
`SPYFALL_PASSWORD=monmotdepasse node server.js` (un seul champ à l'entrée ;
vide = accès libre).

Pour jouer sur le même Wi-Fi sans hébergement : lancez le serveur sur un
ordinateur et donnez son adresse locale aux joueurs, par exemple
`http://192.168.1.42:3000`.

## Héberger en ligne

Le serveur est un simple processus Node sans base de données, il tourne
partout :

### Sur un VPS (Hetzner, OVH…)

Une seule commande, en SSH sur le serveur :

```bash
curl -fsSL https://raw.githubusercontent.com/skyyartconcours-ai/Hexa/claude/korean-speyfold-localization-14sse8/deploy/deploy.sh | sudo bash
```

Le script installe le jeu dans `/opt/spyfall` comme service systemd
`spyfall`, sur le **port 3210** uniquement : il ne touche à aucune autre
application déjà hébergée sur le serveur. Le jeu est ensuite accessible sur
`http://<ip-du-serveur>:3210` (ouvrez le port dans le pare-feu si besoin).
Relancez la même commande pour mettre à jour ; `SPYFALL_PORT=4000` avant le
`bash` change le port.

Pour une jolie adresse type `spyfall.mondomaine.com`, ajoutez à votre
reverse proxy existant (exemple Nginx) :

```nginx
server {
    server_name spyfall.mondomaine.com;
    location / { proxy_pass http://127.0.0.1:3210; }
}
```

### Sur spyfall.skyyarttools.fr (VPS Hetzner + Caddy)

Le sous-domaine est couvert par le wildcard DNS `*.skyyarttools.fr` : **aucune
entrée DNS à créer**. Le déploiement est *additif* — il n'installe que son
dossier (`/opt/spyfall`), son service systemd (`spyfall`), son port et son
propre bloc dans le Caddyfile. Les autres outils du serveur (olympe, poker,
lecercle…) ne sont jamais touchés : le script refuse d'écraser un dossier qui
ne porte pas son marqueur, refuse un port déjà pris par un autre service, et
restaure le Caddyfile si sa validation échoue.

Depuis le PC, dans le dossier du dépôt :

```bash
# 1. état du serveur, en lecture seule — ne modifie rien
bash deploy/deploy-hetzner.sh inventory

# 2. mise en ligne
SPYFALL_PASSWORD=spy bash deploy/deploy-hetzner.sh deploy
```

Le jeu est alors sur **https://spyfall.skyyarttools.fr** (HTTPS émis
automatiquement par Caddy, ~1 min la première fois).

- **Changer le mot de passe** : relancer avec `SPYFALL_PASSWORD=autrechose`.
  Le secret vit dans `/etc/spyfall.env` (chmod 600, lisible par root seul) et
  n'apparaît jamais dans un `ps` ni dans l'unité systemd.
- **Changer le port** : `SPYFALL_PORT=3211 bash deploy/deploy-hetzner.sh deploy`.
- **Logs** : `journalctl -u spyfall -n 50 -f`
- **Mettre à jour** : relancer la même commande `deploy`.
- **Tout retirer** : `bash deploy/deploy-hetzner.sh rollback` (supprime le
  service, le dossier, le secret et le bloc Caddy — et rien d'autre).

Derrière Caddy, le service tourne avec `TRUST_PROXY=1` et `HOST=127.0.0.1` :
Node n'est pas joignable directement depuis l'extérieur, et le rate-limit du
mot de passe voit la vraie IP de chaque joueur plutôt que celle du proxy.

#### Déploiement automatique par GitHub Actions

`.github/workflows/deploy-spyfall.yml` fait la même chose depuis un runner
GitHub, à chaque push ou à la demande. Créer d'abord les 4 secrets dans
**Settings → Secrets and variables → Actions** : `HETZNER_HOST`,
`HETZNER_USER`, `HETZNER_SSH_KEY`, `SPYFALL_PASSWORD`.

### Sur une plateforme (Render / Railway / Fly.io)

Offres gratuites : pointez le service sur ce dépôt avec la commande de
démarrage `node server.js`. Le port est lu depuis la variable
d'environnement `PORT` automatiquement.

Les parties sont stockées en mémoire et expirent après 3 h d'inactivité.

## Comment on joue (rappel des règles)

1. Chaque joueur regarde sa carte en secret. Tous voient le même lieu et un
   rôle, sauf **l'espion** (1 espion, ou 2 dès 7 joueurs), qui ne voit rien.
   Un joueur tiré au sort commence et choisit qui interroger.
2. À tour de rôle, on se pose des questions sur le lieu. Trop vague et l'espion
   passe inaperçu ; trop précis et il devine le lieu.
3. Tout se joue **dans l'appli** :
   - n'importe qui peut **accuser** un joueur ; les autres votent — à
     l'unanimité on révèle (espion démasqué = innocents gagnent ; innocent
     accusé = l'espion gagne) ;
   - l'**espion** peut **deviner le lieu** à tout moment pour tenter de gagner ;
   - à la fin du chrono (géré par le serveur), l'espion l'emporte s'il a tenu.
4. Le **score** se cumule sur plusieurs manches : un classement s'affiche.

**Barème** : espion qui devine le lieu, ou qui survit au chrono, ou victime
d'une accusation ratée → **+2 par espion**. Espion qui se trompe en devinant,
ou démasqué par un vote unanime → **+1 par innocent** (et **+1 bonus** pour
l'accusateur juste). En mode 2 espions (auto dès 7 joueurs), démasquer **un**
espion suffit à faire gagner les innocents.

Les lieux et les rôles sont **modifiables en ligne** depuis l'appli
(bouton « Modifier les lieux & rôles »), pour tous les joueurs.

Bon jeu ! 🎲
