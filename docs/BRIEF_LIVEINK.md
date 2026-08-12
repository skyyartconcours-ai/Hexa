# LiveInk, brief complet pour le dev

Outil d'annotation à l'écran en direct pour créateur de contenu, pensé pour remplacer Epic Pen et le ridiculiser.
Le nom LiveInk est provisoire.

Contexte : l'utilisateur est streamer et formateur League of Legends. Il annote en direct pendant qu'il joue ou pendant qu'il analyse des rushs. Il enregistre aussi une masterclass vidéo. L'outil doit servir aux deux usages.

Public visé : lui d'abord, mais l'outil doit être assez propre pour être distribué plus tard.

---

## 1. La promesse en une phrase

Tu appuies sur une touche, tu dessines par dessus n'importe quoi à l'écran, c'est magnifique, ça s'efface tout seul, et ça n'a jamais fait perdre une image par seconde à ton jeu.

Les trois choses qui tuent Epic Pen :
1. La qualité visuelle du trait et des effets. Epic Pen dessine comme Paint en 2009.
2. Les effets vidéo réels : loupe, spotlight, gel d'image, flou de masquage. Personne ne fait ça.
3. L'ergonomie sans regarder l'écran. Un menu radial sous le curseur, jamais de barre d'outils à chercher.

---

## 2. Architecture

### 2.1 La fenêtre
Electron, une fenêtre par écran physique :
1. `transparent: true`, `frame: false`, `backgroundColor: '#00000000'`
2. `alwaysOnTop` avec le niveau `screen-saver` sur Windows pour passer au dessus des autres overlays
3. `focusable: false` par défaut, sinon Alt Tab casse le jeu et le jeu perd le focus quand l'overlay apparaît
4. `skipTaskbar: true`, pas d'icône dans la barre des tâches
5. `resizable: false`, positionnée sur les bounds exactes de l'écran, en pixels physiques

### 2.2 Le clic traversant
`win.setIgnoreMouseEvents(true, { forward: true })`.
Le `forward: true` est la clé de tout : les clics partent dans le jeu, mais le renderer continue de recevoir les mouvements de souris. C'est ce qui permet à la loupe, au laser et au spotlight de suivre le curseur pendant que l'utilisateur joue normalement.

Quand on entre en mode dessin, on repasse à `setIgnoreMouseEvents(false)` et on donne le focus à la fenêtre. Quand on ressort, on rend le focus à la fenêtre précédente.

### 2.3 Le rendu
1. MVP en canvas 2D, c'est suffisant et ça se code vite.
2. V1 en WebGL via `pixi.js` v8, indispensable pour le halo néon, le flou, le spotlight et la loupe sans coût CPU.
3. Boucle en `requestAnimationFrame`, jamais de `setInterval`.
4. Cap à 60 images par seconde en jeu, l'overlay n'a aucune raison de tourner à 240.

### 2.4 L'état
Un store unique (Zustand fait très bien l'affaire) contenant les calques, les outils, la palette. Il est diffusé par un petit serveur websocket local, ce qui permet plus tard d'avoir une deuxième vue rendue dans une browser source OBS, parfaitement synchronisée, sans dupliquer la logique.

### 2.5 Le point de performance le plus important
Une fenêtre transparente plein écran force la composition permanente par le compositeur de Windows, et ça coûte des images par seconde au jeu même quand rien n'est dessiné.
La règle : quand la couche est vide et qu'aucun outil actif n'a besoin du curseur, on appelle `win.hide()`. Coût nul, garanti. On la réaffiche à la première touche.
Ne jamais laisser une fenêtre transparente plein écran affichée pour rien.

---

## 3. Le moteur de trait, là où se joue la beauté

C'est le point le plus sous estimé. Un bon trait suffit à donner l'impression d'un outil cher.

1. Capturer tous les points intermédiaires avec `event.getCoalescedEvents()`. Sur une souris à 1000 Hz ou une tablette graphique, sans ça on perd 80 pour cent des points et le trait devient anguleux.
2. Lisser avec un filtre One Euro, pas une simple moyenne glissante. La moyenne glissante ajoute de la latence et arrondit les intentions. One Euro lisse le tremblement sans retarder les gestes rapides.
3. Épaisseur variable : par la pression du stylet si disponible (`event.pressure`), sinon par la vitesse du geste. Rapide égale fin, lent égale épais. C'est ce qui donne l'aspect feutre au lieu de l'aspect tuyau.
4. Générer la géométrie du trait avec `perfect-freehand`, qui sort un polygone fermé, puis le remplir. Résultat très supérieur à un `lineTo` avec `lineWidth`.
5. Le halo néon : deuxième passe en mode additif, même géométrie élargie, flou gaussien, opacité 40 pour cent, couleur du trait désaturée vers le blanc au centre. C'est exactement la recette du néon.
6. Chaque trait reste un objet vectoriel dans son calque. Jamais rasterisé. On garde undo parfait, on peut changer la couleur après coup, on peut réexporter en 4K.

---

## 4. Les outils de dessin

1. Pinceau libre
2. Gomme, deux modes : gomme par trait entier au survol (bien plus rapide en direct) et gomme classique
3. Ligne droite, avec accroche aux angles de 15 degrés en maintenant Shift
4. Flèche
5. Rectangle et ellipse, remplis ou en contour
6. Texte, avec fond arrondi automatique derrière pour rester lisible sur n'importe quel fond
7. Surligneur, mode multiply, semi transparent
8. Numéroteur : chaque clic pose une pastille numérotée 1, 2, 3 qui s'incrémente. Parfait pour expliquer un ordre d'actions.
9. Règle de mesure, affiche la distance en pixels
10. Tampon d'image : coller un PNG depuis le presse papier ou une bibliothèque d'emotes, le poser, le redimensionner

### 4.1 Les formes intelligentes
La vraie différence avec Epic Pen. L'utilisateur dessine à main levée, l'outil redresse.
1. Trait quasi droit égale ligne parfaite
2. Boucle fermée égale cercle ou ellipse
3. Quatre angles égale rectangle
4. Trait avec un petit crochet au bout égale flèche
5. Toujours avec une animation de transition de 150 ms entre le tracé brut et la forme redressée, sinon ça surprend. Et toujours annulable par Ctrl Z pour revenir au tracé brut.

### 4.2 Les flèches, à soigner particulièrement
1. La pointe se dessine après le fût, avec un petit pop élastique
2. Flèche courbe par défaut si le geste est courbe, on ne force pas la ligne droite
3. Mode trajet : la flèche se dessine progressivement de A vers B en 400 ms, puis reste. Idéal pour montrer une rotation ou un déplacement sur la carte.
4. Mode boucle : la flèche pulse doucement en continu tant qu'elle est à l'écran

---

## 5. Les effets stream, le coeur du truc

### 5.1 La loupe
Voir la section 6, elle a droit à son chapitre.

### 5.2 Le spotlight
Tout l'écran s'assombrit à 70 pour cent sauf une zone. Trois variantes :
1. Cercle qui suit le curseur, taille à la molette
2. Zone dessinée à main levée, l'utilisateur entoure ce qu'il veut garder éclairé
3. Rectangle posé à la souris
Bord dégradé sur 40 pixels, jamais de bord net. Animation d'ouverture en 250 ms avec une courbe élastique douce.

### 5.3 Le laser pointeur
Une trainée qui suit le curseur et s'efface en une seconde, avec un dégradé d'opacité et un halo. Sert à suivre un déplacement à l'écran sans rien salir. Aucun clic nécessaire, ça marche en mode clic traversant, donc pendant qu'on joue.

### 5.4 Le ping
Un clic pose un cercle qui se contracte deux fois puis disparaît, façon ping de jeu. Son optionnel. Extrêmement lisible pour le viewer.

### 5.5 Le gel d'image
Touche appuyée : capture instantanée de l'écran, affichée comme un calque plein écran. Le jeu continue derrière, mais le viewer voit une image fixe sur laquelle on peut dessiner, zoomer, se balader. Puis dégel avec un fondu de 300 ms.
C'est l'outil pédagogique numéro un pour analyser une frame précise.

### 5.6 Le flou de masquage
Une boîte qu'on pose sur une zone de l'écran et qui la floute en direct. Sert à cacher un pseudo, un code, une notification, une info de jeu qu'on ne veut pas montrer. Aucune autre solution ne fait ça bien en direct.
Doit pouvoir être posée à l'avance et rester active toute la session.

### 5.7 L'avant après
Un curseur vertical qui coupe l'écran : à gauche une image gelée, à droite le direct. On fait glisser la ligne. Comparaison instantanée entre deux moments.

### 5.8 Le petit bonus
1. Grille et règle des tiers pour vérifier un cadrage
2. Compte à rebours et chronomètre posables à l'écran
3. Notes collantes qui restent visibles toute la session

---

## 6. La loupe, spécification détaillée

### 6.1 Principe
L'overlay est transparent, il ne peut pas grossir ce qui est en dessous tout seul. On récupère donc un flux vidéo de l'écran via `desktopCapturer` d'Electron plus `getUserMedia` avec la source `desktop`, on le pousse dans un élément `video` caché, et on le redessine dans le canvas avec `drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)`.
Source : un carré de 200 pixels autour du curseur. Destination : un disque de 400 pixels. Zoom deux fois, en direct, à 60 images par seconde, coût GPU quasi nul.

### 6.2 Le piège de la récursion, et sa solution
Si la loupe est dessinée pile sur la zone qu'elle grossit, elle se capture elle même et on obtient un effet tunnel infini.
Solution purement géométrique, aucune API exotique : la loupe flotte à côté du point visé, jamais dessus. Tant que la distance entre le centre de la loupe et le point visé dépasse le rayon de la loupe plus la moitié de la zone source, il n'y a aucune récursion.
Bonus, c'est plus lisible pour le viewer : il voit la zone d'origine et le zoom en même temps.

L'alternative `win.setContentProtection(true)` exclut la fenêtre de toute capture, ce qui règle aussi la récursion, mais rend l'overlay invisible pour OBS en capture d'écran. À ne pas utiliser par défaut.

### 6.3 Le suivi de souris
1. Le point visé suit le curseur au pixel près, sans lissage. Sinon le contenu de la loupe est en retard et ça se voit.
2. Le disque de la loupe suit avec un ressort amorti (raideur 0.15, amortissement 0.75 comme point de départ). Il glisse au lieu de sauter. C'est ce détail qui donne l'impression d'un outil cher.
3. Position par défaut en haut à droite du curseur, bascule automatique de côté quand on approche d'un bord d'écran, pour ne jamais sortir du cadre.
4. Molette : niveau de zoom de 1.5 à 8.
5. Une touche fige le disque sur place, mais le contenu continue de montrer la zone visée. Pratique pour parler sans bouger la souris.
6. Ça marche en mode clic traversant, donc pendant qu'on joue.

### 6.4 Le style
Anneau de 3 pixels aux couleurs de la marque, halo externe doux, ombre portée sous le disque, très léger effet de loupe optique sur les bords (déformation de 5 pour cent sur les 10 derniers pour cent du rayon). Ne pas surcharger.

### 6.5 Combinaisons
1. Loupe plus spotlight : tout s'assombrit, seul le contenu de la loupe reste éclairé
2. Loupe plus gel d'image : on gèle, puis on se balade dans l'image gelée en zoomant
3. Dessiner dans la loupe : le trait s'accroche aux coordonnées de la zone zoomée, donc il reste au bon endroit quand la loupe bouge

---

## 7. Hygiène à l'écran

Le vrai problème d'Epic Pen, c'est que l'écran finit sale et que le streamer perd dix secondes à tout effacer en direct.

1. Fondu automatique : chaque annotation a une durée de vie configurable, par défaut 8 secondes, avec un fondu de sortie de 400 ms. Réglable par outil, et désactivable pour les notes.
2. Touche panique : une seule touche efface tout instantanément, avec un fondu de 200 ms.
3. Effacement automatique au changement de scène OBS, via le websocket d'OBS.
4. Effacement automatique après 60 secondes d'inactivité, optionnel.

---

## 8. Ergonomie, le point qui décide de tout

En direct, on ne regarde pas une barre d'outils. Tout doit se faire à l'aveugle.

1. Une seule touche pour entrer et sortir du mode dessin. F8 par défaut, remappable.
2. Menu radial : maintenir le clic droit fait apparaître une roue d'outils sous le curseur, on glisse vers l'outil voulu, on relâche, l'outil est sélectionné. Zéro déplacement de souris vers un coin de l'écran. C'est la fonctionnalité d'ergonomie numéro un.
3. Touches 1 à 5 : les cinq couleurs de la palette. Molette : taille du pinceau.
4. Ctrl Z et Ctrl Y : annuler et rétablir, illimités.
5. Maintien de touche plutôt que bascule pour les outils momentanés (laser, loupe, spotlight) : on appuie, ça vit, on relâche, ça meurt. Bien plus naturel en direct.
6. Support Stream Deck : le plus simple est de laisser le Stream Deck envoyer des raccourcis clavier globaux. Pas besoin de plugin dédié pour la V1.
7. Support tablette graphique et stylet avec pression, ça marche nativement via les événements pointeur.
8. Sur plusieurs écrans : l'overlay sait sur quel écran est le curseur et n'active la couche que sur celui là.
9. Barre d'outils flottante, semi transparente, repliable, qui s'efface automatiquement pendant qu'on dessine. Elle existe pour la découverte, pas pour l'usage quotidien.

---

## 9. Le design de l'interface

1. Verre dépoli, coins arrondis de 16 pixels, ombres douces et diffuses, jamais d'ombre dure
2. Thème sombre par défaut, couleur d'accent configurable pour coller à la marque du créateur
3. Animations à ressort de 200 ms sur tout ce qui apparaît ou disparaît, jamais de linéaire
4. Aucun texte dans la barre d'outils, uniquement des icônes, texte au survol seulement
5. Curseur personnalisé pendant le mode dessin : un cercle qui montre la taille et la couleur réelles du pinceau
6. Petit indicateur discret en bas de l'écran quand on change d'outil, disparaît en 800 ms
7. Un liseré lumineux très fin sur tout le bord de l'écran quand le mode dessin est actif. C'est le seul repère visuel dont on a besoin pour savoir si on est en mode dessin ou en mode jeu, et ça évite de cliquer dans le vide.

---

## 10. Les deux sorties

### 10.1 Mode Écran, celui du MVP
L'overlay est visible sur l'écran, OBS le capture via une capture d'écran. Simple, aucune configuration.

### 10.2 Mode Stream seul, pour plus tard
L'overlay n'est pas rendu sur l'écran, mais dans une browser source OBS qui se connecte au serveur websocket local et rejoue exactement le même état. Le viewer voit les annotations, le streamer garde son écran propre.
Une seule base de code de rendu, deux vues.

### 10.3 Mode Coach, l'idée avancée
Deux couches distinctes, une visible uniquement par le streamer (via `setContentProtection`), une visible uniquement par le stream. Permet d'avoir ses propres repères à l'écran sans les montrer, et inversement.

---

## 11. Enregistrement et réutilisation, l'idée forte pour la masterclass

Toutes les annotations sont enregistrées en JSON avec leur horodatage : outil, points, couleur, épaisseur, temps de début et de fin.

Conséquences :
1. On peut rejouer une session d'annotations au montage, en 4K, en vectoriel propre, alors qu'elle a été faite en direct à l'arrache
2. On peut exporter la couche d'annotation seule en PNG transparent ou en séquence, à superposer sur la vidéo au montage
3. On peut corriger une faute de frappe dans un texte annoté trois semaines après
C'est ce qui transforme l'outil de gadget de stream en outil de production vidéo.

---

## 12. Les pièges Windows à connaître avant de commencer

1. Plein écran exclusif : aucun overlay logiciel ne s'affiche par dessus. Le jeu doit être en fenêtré sans bordure. League of Legends l'est par défaut, donc c'est bon, mais il faut le documenter.
2. Ne pas voler le focus. `focusable: false` en permanence sauf pendant le mode dessin actif. Un overlay qui prend le focus fait perdre des parties.
3. Mise à l'échelle DPI de Windows : travailler en pixels physiques partout, sinon la loupe et le dessin sont décalés sur un écran à 125 pour cent.
4. Le raccourci global ne doit pas entrer en conflit avec les raccourcis du jeu. Éviter F1 à F5 qui servent aux sorts des alliés dans League of Legends. F8 ou une combinaison est plus sûr.
5. Garder l'accélération matérielle activée. La désactiver rend l'overlay inutilisable pendant un jeu.
6. Les captures via `desktopCapturer` demandent la permission de partage d'écran sur certaines configurations, prévoir le cas.
7. Tester avec le jeu qui tourne, pas sur un bureau vide. Un overlay qui marche sur le bureau et qui coûte 20 images par seconde en jeu ne sert à rien.

---

## 13. Budget de performance à tenir

1. Moins de 2 pour cent de processeur au repos
2. Moins de 5 pour cent en dessin actif
3. Zéro image par seconde perdue en jeu quand la couche est vide, ce qui impose la règle de masquer la fenêtre
4. Latence entre le mouvement de souris et le trait affiché sous 16 ms
5. Démarrage de l'application sous 2 secondes

---

## 14. Roadmap

### Spike 0, une heure, à faire avant tout le reste
Prouver qu'une fenêtre Electron transparente, toujours au dessus, en clic traversant avec `forward: true`, affiche un rond rouge qui suit la souris par dessus League of Legends en fenêtré sans bordure, sans perte d'images par seconde et sans voler le focus.
Si ce spike passe, tout le reste est du travail de finition. S'il échoue, rien d'autre ne sert.

### MVP
Pinceau, gomme, flèche, rectangle, cinq couleurs, undo, touche panique, fondu automatique, entrée et sortie du mode dessin, masquage de la fenêtre quand vide.

### V1
Loupe qui suit la souris, spotlight, laser, ping, texte, formes intelligentes, menu radial, barre flottante, thème sombre soigné, gel d'image.

### V2
Flou de masquage, avant après, sortie browser source OBS, enregistrement JSON rejouable, tampon d'images, intégration au websocket d'OBS, mode Coach.

---

## 15. Stack conseillée

1. Electron avec Vite et TypeScript
2. `pixi.js` v8 pour le rendu, canvas 2D acceptable pour le MVP
3. `perfect-freehand` pour la géométrie des traits
4. Zustand pour l'état
5. React uniquement pour la barre d'outils et les réglages, jamais dans la boucle de rendu
6. Un serveur websocket local minimal pour la synchronisation avec OBS

---

## 16. Ce qu'il ne faut surtout pas faire

1. Ne pas partir sur Tauri pour le MVP. La transparence et le clic traversant sont bien plus fiables sur Electron sous Windows.
2. Ne pas rasteriser les traits dans un bitmap. On perd l'undo propre, le changement de couleur, et l'export haute définition.
3. Ne pas créer une fenêtre par outil.
4. Ne pas mettre de menus déroulants ni de boîtes de dialogue. En direct, personne n'ouvre un menu.
5. Ne pas exiger une configuration OBS pour que l'outil fonctionne. Il doit marcher tout seul dès le premier lancement.
6. Ne pas laisser la fenêtre transparente affichée quand elle est vide.
7. Ne pas mettre de son par défaut sur les effets. Optionnel et coupé au départ.

---

## 17. Prompt de démarrage à donner au dev

Voici un point de départ à copier tel quel :

> Lis le fichier `liveink/BRIEF_LIVEINK.md` en entier.
> Commence par le Spike 0 de la section 14, et rien d'autre. Crée une application Electron minimale avec une fenêtre transparente plein écran, sans cadre, toujours au dessus, non focusable, en clic traversant avec `setIgnoreMouseEvents(true, { forward: true })`, qui affiche un cercle rouge de 40 pixels suivant le curseur en `requestAnimationFrame`.
> Puis dis moi comment la tester par dessus un jeu en fenêtré sans bordure, et quoi observer pour valider ou invalider le spike.
> N'implémente aucune autre fonctionnalité tant que le spike n'est pas validé par moi.
