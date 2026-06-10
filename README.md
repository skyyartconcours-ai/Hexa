# Hexa — Spyfall en français 🕵️

Une version web de **Spyfall** avec les lieux et les rôles **en français**, pour
jouer entre amis quand votre boîte physique est… dans une autre langue.
L'appli remplace uniquement les cartes : vous jouez autour de la table comme
d'habitude, chacun avec son téléphone.

- 27 lieux classiques de la première édition, 7 rôles chacun, tout traduit en français
- Un espion tiré au hasard, les autres reçoivent le lieu + un rôle
- Chrono configurable (8 minutes par défaut), liste des lieux consultable en jeu
- Aucune dépendance : un seul fichier serveur en Node.js

## Lancer le jeu

```bash
node server.js
```

Puis ouvrez `http://localhost:3000`. L'hôte crée une partie, partage le code à
4 lettres, les autres rejoignent depuis leur téléphone (3 joueurs minimum).

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

### Sur une plateforme (Render / Railway / Fly.io)

Offres gratuites : pointez le service sur ce dépôt avec la commande de
démarrage `node server.js`. Le port est lu depuis la variable
d'environnement `PORT` automatiquement.

Les parties sont stockées en mémoire et expirent après 3 h d'inactivité.

## Comment on joue (rappel des règles)

1. Chaque joueur regarde sa carte en secret. Tous voient le même lieu et un
   rôle, sauf **l'espion**, qui ne voit rien.
2. À tour de rôle, on se pose des questions sur le lieu. Trop vague et l'espion
   passe inaperçu ; trop précis et il devine le lieu.
3. Avant la fin du chrono : les joueurs peuvent accuser quelqu'un d'être
   l'espion, et l'espion peut à tout moment annoncer le lieu pour gagner.
4. L'hôte termine la manche pour révéler l'espion et le lieu.

Bon jeu ! 🎲
