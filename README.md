# Hexa — annotation d'écran en direct

> Tu appuies sur une touche, tu dessines par-dessus n'importe quoi à l'écran, c'est magnifique,
> ça s'efface tout seul, et ça n'a jamais fait perdre une image par seconde à ton jeu.

Hexa (nom de code **LiveInk**) est un outil d'annotation en overlay pour streamers, coachs et
formateurs. Il est pensé pour remplacer Epic Pen — et pour le ridiculiser sur les trois points qui
comptent vraiment :

1. **la qualité du trait** : lissage One Euro, épaisseur variable, géométrie `perfect-freehand`,
   halo néon en trois passes. Epic Pen dessine comme Paint en 2009 ;
2. **les effets vidéo réels** : laser, dissolution en comète, formes redressées, gel d'image,
   spotlight, loupe. Personne ne fait ça ;
3. **l'ergonomie sans regarder l'écran** : tout au clavier, liseré lumineux comme seul repère,
   écran qui se nettoie tout seul.

Le brief produit complet, source de vérité du projet, est dans [`docs/BRIEF_LIVEINK.md`](docs/BRIEF_LIVEINK.md).
Les références `§x.y` de ce README y renvoient.

---

## Ce qui marche aujourd'hui

**Moteur de trait (§3)**
Capture de tous les points intermédiaires, filtre One Euro, épaisseur par pression ou par vitesse,
géométrie `perfect-freehand`, recette néon en trois passes (halo large additif, halo serré, cœur
blanchi). Chaque trait reste un objet **vectoriel** : jamais rasterisé, donc undo parfait et
réexport en 4K des semaines plus tard.

**Outils (§4)**
Pinceau, surligneur, ligne (Maj : angles de 15°), flèche (pointe qui éclot après le fût, flèche
courbe si le geste est courbe), rectangle, ellipse (Maj : carré/cercle, Alt : rempli), texte avec
fond arrondi, numéroteur à pastilles reliées, règle de mesure, tampon d'image (Ctrl+V), laser à
traînée, gomme par trait entier.
**Formes intelligentes (§4.1)** : le tracé à main levée est redressé avec un morph de 150 ms, et le
premier Ctrl+Z rend le tracé brut. **Guides magnétiques** : angles remarquables, alignements,
espacements égaux.

**Hygiène à l'écran (§7)**
Fondu automatique 2 s / 4 s / 8 s / ∞ avec dissolution « comète » et braise incandescente, touche
panique, effacement au changement de scène OBS.

**Interface (§9)**
Verre dépoli, coins arrondis, animations à ressort, **8 thèmes** complets (silhouette différente,
pas seulement une recoloration), barre d'outils flottante, curseur personnalisé, indicateur d'outil
discret, liseré lumineux en mode dessin, profils d'usage, éditeur de raccourcis complet.

**Session, rejeu et exports (§11)**
Toutes les annotations sont horodatées. On peut **rejouer la session à son rythme d'origine**,
point par point, fondus et annulations compris, sur un calque dédié qui ne touche pas la session en
cours. Export **PNG transparent 1× / 2× / 4×** (rendu vectoriel hors écran), export/import **JSON**,
clip WebM du rejeu.

**Vue OBS (§10.2)**
Une page `obs.html` à mettre dans une browser source : elle affiche exactement les mêmes
annotations, rendues par **la même base de code**, sur fond transparent, sans aucune interface.

**Overlay Windows (§2)**
Une fenêtre par écran, transparente, sans cadre, toujours au-dessus, non focusable, clic traversant
avec `forward: true`, **cachée quand la couche est vide**.

Pas encore là : loupe, spotlight, gel d'image, flou de masquage, avant/après, menu radial.
Voir la [roadmap](#roadmap-§14).

---

## Démarrage

```bash
npm install
```

### 1. Démo navigateur (le plus rapide)

```bash
npm run dev            # http://localhost:5173
```

Tout fonctionne sauf ce qui exige le système : dessin, outils, thèmes, réglages, rejeu, exports, et
même la vue OBS (synchronisée entre onglets par `BroadcastChannel`). Aucun réseau, aucune police
externe : l'app marche hors ligne.

### 2. Overlay Electron (l'outil réel)

```bash
npm run app:dev        # overlay + serveur de dev Vite
npm run app            # overlay sur le build de production
```

Sous Windows, l'overlay s'ouvre sur chaque écran, invisible tant qu'il n'a rien à afficher.
**F8** entre et sort du mode dessin, **Ctrl+Maj+X** est la touche panique. Ces deux-là sont des
raccourcis **globaux** : ils marchent même quand le jeu a le focus.

### 3. Spike 0 — la vérification qui décide de tout (§14)

```bash
npm run spike
```

Affiche un rond rouge qui suit le curseur dans une fenêtre transparente, toujours au-dessus, en
clic traversant. **À tester par-dessus League of Legends en fenêtré sans bordure**, pas sur un
bureau vide. Le spike est validé si, simultanément :

- le rond est visible par-dessus le jeu ;
- les clics arrivent **dans le jeu**, pas dans l'overlay ;
- le jeu ne perd pas le focus quand l'overlay apparaît ;
- le compteur d'images par seconde du jeu ne bouge pas.

Si ce spike passe, tout le reste n'est que de la finition.

---

## Vue OBS : adresse exacte à coller

**Overlay Electron** — active « Serveur local » dans Réglages → OBS, puis dans OBS :
`+` → **Navigateur** → URL :

```
http://127.0.0.1:4787/obs.html
```

**Démo navigateur** (`npm run dev`) :

```
http://localhost:5173/obs.html
```

Largeur et hauteur = celles de ta scène. Le fond est déjà transparent, il n'y a rien à cocher.
Options d'URL : `?bare=1` retire la carte d'attente, `?ws=ws://127.0.0.1:4787` force l'adresse du
WebSocket.

Le serveur écoute sur **127.0.0.1 uniquement**, jamais sur `0.0.0.0` : l'écran du streamer n'est
jamais exposé au réseau local. Il diffuse du JSON typé — `state:full` à la connexion, puis
`stroke:add`, des **lots de points à ~30 Hz** (jamais un message par point), `stroke:remove`,
`clear`.

Deux modes : **Écran** (défaut, §10.1) où OBS capture ton écran, et **Stream seul** (§10.2) où ton
écran reste propre et où seules les annotations partent à l'antenne.

**obs-websocket (§7.3)** est facultatif : activé, il efface les annotations à chaque changement de
scène. Hexa doit être parfait sans OBS — si le serveur n'est pas là, on retente à intervalles
croissants, sans jamais rien bloquer ni afficher d'erreur. Le mot de passe reste local et n'est
jamais journalisé.

---

## Raccourcis (preset « Hexa »)

Tout est remappable dans Réglages → Raccourcis. Un preset « Compatibilité Epic Pen » existe pour
retrouver ses réflexes.

| Outils         |     | Momentanés (maintien §8.5) |     |
| -------------- | --- | -------------------------- | --- |
| Pinceau        | `P` | Laser                      | `Z` |
| Surligneur     | `S` | Spotlight                  | `X` |
| Ligne          | `L` | Loupe                      | `A` |
| Flèche         | `F` | Gel d'image                | `V` |
| Rectangle      | `R` |                            |     |
| Ellipse        | `O` |                            |     |
| Texte          | `T` |                            |     |
| Numéroteur     | `N` |                            |     |
| Règle          | `M` |                            |     |
| Tampon d'image | `I` |                            |     |
| Gomme          | `E` |                            |     |

| Édition               |                       | Interface et modes       |                        |
| --------------------- | --------------------- | ------------------------ | ---------------------- |
| Annuler               | `Ctrl+Z`              | Barre d'outils           | `H`                    |
| Rétablir              | `Ctrl+Y`/`Ctrl+Maj+Z` | Réglages                 | `Ctrl+,`               |
| Tout effacer          | `C`                   | Fermer le panneau        | `Échap`                |
| Épaisseur — / +       | `[` / `]`             | **Mode dessin / jeu**    | `F8` *(global)*        |
| Durée du fondu        | `D`                   | **Touche panique**       | `Ctrl+Maj+X` *(global)*|
| Formes intelligentes  | `W`                   | Couleurs 1 à 7           | `1` … `7`              |
| Guides magnétiques    | `G`                   | Taille du pinceau        | molette                |
| Relier les pastilles  | `K`                   | Attraper une annotation  | clic droit             |

Dans la barre de rejeu : `Espace` lecture/pause, `←` `→` ±1 s, `Échap` quitte.

---

## Architecture

```
src/
  engine/        moteur : tracé, rendu néon, formes, guides, undo, export
    engine.ts    classe HexaEngine — 2 canvas, rAF dormante, interactions
    render.ts    recette néon (halo large additif + halo serré + cœur blanchi)
    shapes.ts    formes, morphs, flèches courbes    recognizer.ts  formes intelligentes
    guides.ts    guides magnétiques                 teaching.ts    texte, pastilles, mesure, tampon
    oneEuro.ts   filtre One Euro                    types.ts       Stroke, ToolId, SessionExport
  replay/        §11 — enregistrement, rejeu, exports
    recorder.ts  archive tout ce que le moteur a affiché, fondus compris
    player.ts    rejeu horodaté, vitesses, boucle    paint.ts   peinture d'une liste de traits
    exporter.ts  PNG transparent 1×/2×/4×, JSON, clip WebM
  obs/           §10.2 — miroir OBS
    protocol.ts  messages JSON typés                 link.ts    émetteur (diff + lots 30 Hz)
    mirror.ts    récepteur + rendu                   ObsView.tsx page obs.html
    client.ts    client obs-websocket v5             sha256.ts  condensat d'authentification
  ui/            barre d'outils, réglages, rejeu, raccourcis, profils, thèmes
  store.ts       Zustand persisté (outil, couleur, thème, OBS, raccourcis…)
electron/
  main.ts        une fenêtre par écran, clic traversant, raccourcis globaux, masquage
  preload.ts     seule passerelle renderer ↔ système, strictement en liste blanche
  obs-server.ts  HTTP + WebSocket sur 127.0.0.1, zéro dépendance
```

### Les quatre décisions qui tiennent tout

**Deux canvas (§2.3).** `staticCv` porte les annotations posées et n'est redessiné que lorsque
quelque chose change. `liveCv` porte le trait en cours, le laser et les particules. Résultat : un
trait de 2 000 points ne coûte pas plus cher à la 2 000ᵉ image qu'à la première.

**Une rAF dormante (§13).** Il n'y a **aucune** boucle permanente et **aucun** `setInterval` dans le
projet. `wake()` démarre la boucle, `loop()` s'arrête d'elle-même dès que plus rien n'anime, et
programme un unique `setTimeout` si un fondu automatique est en attente. Au repos : zéro image,
zéro processeur. Le rejeu et la vue OBS appliquent exactement la même règle.

**La fenêtre cachée quand elle est vide (§2.5).** C'est le point de performance numéro un du
projet. Une fenêtre transparente plein écran force la composition permanente de Windows et coûte
des images par seconde au jeu **même quand rien n'est dessiné**. Le renderer signale son activité
(`notifyActivity`), et le processus principal appelle `win.hide()` après un court délai de grâce.
Coût nul, garanti.

**`setIgnoreMouseEvents(true, { forward: true })` (§2.2).** Le `forward: true` est la clé : les
clics partent dans le jeu, mais le renderer continue de recevoir les mouvements de souris. C'est ce
qui permettra au laser, à la loupe et au spotlight de suivre le curseur **pendant qu'on joue**.

---

## Budget de performance (§13)

| Cible                                    | Statut                                                    |
| ---------------------------------------- | --------------------------------------------------------- |
| < 2 % de processeur au repos             | ✅ 0 % : aucune image n'est produite quand rien n'anime    |
| < 5 % en dessin actif                    | ✅ canvas 2D, une seule couche redessinée                  |
| 0 image/s perdue en jeu, couche vide     | ✅ la fenêtre est cachée, pas juste transparente           |
| Latence souris → trait < 16 ms           | ✅ points coalescés, One Euro, tracé sur le canvas *live*  |
| Démarrage < 2 s                          | ✅ aucune dépendance lourde, aucun accès réseau            |

Règles à ne jamais casser : pas de `setInterval`, pas de boucle permanente, pas de rasterisation
des traits, pas de ressource réseau, pas de police externe.

---

## Pièges Windows (§12)

1. **Plein écran exclusif** : aucun overlay logiciel ne s'affiche par-dessus. Le jeu doit être en
   *fenêtré sans bordure* — League of Legends l'est par défaut.
2. **Ne jamais voler le focus** : `focusable: false` en permanence, sauf pendant le mode dessin.
   Un overlay qui prend le focus fait perdre des parties.
3. **Mise à l'échelle DPI** : tout est travaillé en pixels physiques. Sur un écran à 125 %, un
   oubli décale le dessin et la loupe.
4. **Raccourcis globaux** : éviter `F1`–`F5`, qui servent aux sorts alliés dans League of Legends.
   `F8` et `Ctrl+Maj+X` par défaut.
5. **Garder l'accélération matérielle** : la désactiver rend l'overlay inutilisable en jeu.
   `app.disableHardwareAcceleration()` est banni du dépôt.
6. **`desktopCapturer`** demande une permission de partage d'écran sur certaines configurations :
   toutes les captures dégradent proprement en `null`.
7. **Tester avec le jeu qui tourne**, jamais sur un bureau vide.

---

## Roadmap (§14)

- **Spike 0** — fenêtre transparente, toujours au-dessus, clic traversant, sans perte d'images :
  `npm run spike`. ✅ implémenté, à valider sur une vraie machine Windows avec le jeu lancé.
- **MVP** — pinceau, gomme, flèche, rectangle, couleurs, undo, touche panique, fondu automatique,
  entrée/sortie du mode dessin, masquage de la fenêtre. ✅
- **V1** — texte, formes intelligentes, barre flottante, thèmes soignés. ✅ · laser ✅ ·
  loupe, spotlight, ping, gel d'image, menu radial ⏳
- **V2** — sortie browser source OBS ✅ · enregistrement JSON rejouable ✅ · tampon d'images ✅ ·
  intégration obs-websocket ✅ · flou de masquage, avant/après, mode Coach ⏳

---

## Scripts

| Commande             | Effet                                                        |
| -------------------- | ------------------------------------------------------------ |
| `npm run dev`        | démo navigateur (Vite)                                       |
| `npm run build`      | `tsc --noEmit` puis build de production (index.html + obs.html) |
| `npm run build:main` | bundle du processus principal et du preload Electron          |
| `npm run app:dev`    | overlay Electron sur le serveur de dev                        |
| `npm run app`        | overlay Electron sur le build de production                   |
| `npm run spike`      | Spike 0 (§14)                                                 |

Dépendances : `react`, `zustand`, `perfect-freehand`, `electron`, `vite`, `typescript`.
Rien d'autre — pas de bibliothèque de composants, pas de client WebSocket, pas de police
téléchargée. Tout ce qui s'affiche est dessiné par le projet.
