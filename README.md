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

- **Render / Railway / Fly.io** (offres gratuites) : pointez le service sur ce
  dépôt avec la commande de démarrage `node server.js`. Le port est lu depuis
  la variable d'environnement `PORT` automatiquement.
- **Un VPS ou un Raspberry Pi** : `node server.js` derrière un reverse proxy
  (Caddy, Nginx) suffit.

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
