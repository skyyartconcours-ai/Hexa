# Mode d'emploi de Hexa

Hexa dessine par-dessus ton écran. Tout ton écran : ton jeu, ton navigateur, une vidéo, un tableur.
Il n'y a pas de fenêtre à déplacer, pas de zone de dessin à viser — c'est ton écran entier
qui devient une feuille.

Pas encore installé ? → **[Guide d'installation](INSTALLATION.md)**

---

## En trente secondes

1. **F8** — le mode dessin s'allume. Un **liseré lumineux** apparaît tout autour de l'écran.
2. **Tu dessines** avec la souris. Ça brille, et ça s'efface tout seul au bout de 4 secondes.
3. **F8** de nouveau — la souris repart dans ton jeu, comme si Hexa n'existait pas.

Le liseré lumineux est ton seul repère, et c'est voulu : allumé = tu dessines,
éteint = tes clics vont à ton jeu.

Perdu ? **Ctrl + Maj + X** efface tout, tout de suite, où que tu sois — même en pleine partie,
même si Hexa n'a pas le focus. C'est la touche panique.

---

## Les raccourcis Epic Pen, actifs dès le départ

Tu viens d'Epic Pen ? **Tes doigts n'ont rien à réapprendre.** Hexa démarre avec le clavier
d'Epic Pen déjà en place.

La colonne de droite dit la seule chose qui compte vraiment : est-ce que la touche répond
**pendant que ton jeu est au premier plan**, sans avoir à cliquer sur Hexa avant ?

| Ce que ça fait | La touche | Marche pendant que le jeu a le focus ? |
| --- | --- | --- |
| Stylo (dessiner) | **Ctrl + Maj + 3** | ✅ oui |
| Surligneur | **Ctrl + Maj + 4** | ✅ oui |
| Gomme | **Ctrl + Maj + 5** | ✅ oui |
| Curseur — rendre la souris au jeu | **Ctrl + Maj + 2** | ✅ oui |
| Annuler le dernier trait | **Ctrl + Maj + 6** | ✅ oui |
| Trait plus fin / plus épais | **Ctrl + Maj + 7** / **Ctrl + Maj + 8** | ✅ oui |
| Entrer et sortir du mode dessin | **F8** | ✅ oui |
| Tout effacer, même en pleine panique | **Ctrl + Maj + X** | ✅ oui |
| Tout effacer | **Ctrl + E** | ⬜ en mode dessin |
| Montrer ou cacher la barre d'outils | **Ctrl + H** | ⬜ en mode dessin |

**Pourquoi Ctrl + E et Ctrl + H sont à part.** Windows ne partage pas un raccourci : celui qui
le réserve le prend à *tous* les autres logiciels. Or Ctrl + E ouvre la recherche de ton
navigateur et Ctrl + H son historique — si Hexa les confisquait, ils cesseraient de marcher
dans Chrome, dans VLC et sur YouTube tant qu'il tourne. Hexa refuse de faire ça.
Ils fonctionnent donc dès que le mode dessin est allumé, c'est-à-dire au moment où tu annotes.
Pour nettoyer l'écran pendant que le jeu a le focus, c'est **Ctrl + Maj + X**.

Et les raccourcis maison de Hexa, plus rapides une fois le mode dessin allumé — une seule touche,
tout sous la main gauche :

| Les outils | | Les effets et les réglages | |
| --- | --- | --- | --- |
| Stylo | **P** | Laser (à maintenir) | **Z** |
| Surligneur | **S** | Projecteur (à maintenir) | **X** |
| Ligne droite | **L** | Repère qui bat (à maintenir) | **Q** |
| Flèche | **F** | Loupe (à maintenir) | **A** |
| Rectangle | **R** | Gel d'image | **V** |
| Ellipse | **O** | Masque flou | **B** |
| Texte | **T** | Avant / après | **U** |
| Numéroteur (1, 2, 3…) | **N** | Couleurs 1 à 7 | **1** … **7** |
| Règle de mesure | **M** | Durée avant effacement | **D** |
| Tampon d'image | **I** | Formes intelligentes | **W** |
| Coller une image | **Ctrl + V** | Guides magnétiques | **G** |
| Gomme | **E** | Écriture à la main | **J** |
| | | Tout effacer | **C** |
| | | Aide-mémoire des raccourcis | **?** |
| | | Réglages | **Ctrl + ,** |

Et trois combinaisons pour ce qu'on **pose** à l'écran : **Ctrl + Maj + G** grille / règle des
tiers, **Ctrl + Maj + Y** chrono, **Ctrl + Maj + B** note.

> **La différence entre les deux tableaux :** ceux du premier marchent pendant que tu joues.
> Ceux du second (une seule lettre) ne marchent que quand le mode dessin est allumé — sinon ils
> partiraient dans ton jeu et te feraient lancer un sort au lieu de changer de couleur.
> Pour sortir le laser en pleine partie : **Ctrl + Maj + 3** (ou **F8**) d'abord, puis **Z**.

**Tu as oublié une touche ?** Appuie sur **?** (Maj + ,) pendant le mode dessin : la liste
complète s'affiche à l'écran, lisible de loin.

**Tu veux d'autres touches ?** Tout est modifiable : icône près de l'horloge → **Réglages…** →
section **Raccourcis clavier**, tout en bas du panneau. Tu cliques sur un raccourci, tu appuies sur
la touche que tu veux, c'est enregistré immédiatement — rien à redémarrer.
Hexa refuse les combinaisons dangereuses (Alt+F4, Ctrl+Alt+Suppr…) et te prévient quand une touche
risque de gêner ton jeu.

---

## Dessiner

**Le stylo** (P) suit ta main et s'épaissit quand tu accélères, comme un vrai feutre.
Le trait n'est jamais une image : c'est une forme, donc il reste net même agrandi.

**Le surligneur** (S) pose un aplat translucide qui laisse lire ce qu'il y a dessous.

**Les formes** — ligne (L), flèche (F), rectangle (R), ellipse (O) — se tracent en appuyant à un
coin et en relâchant à l'autre.
Deux touches à connaître pendant que tu traces :

- **Maj** enfoncée → carré parfait, cercle parfait, ligne à l'angle pile.
- **Alt** enfoncée → la forme est remplie, et les guides se taisent.

**Les formes intelligentes** (activées par défaut) : dessine un rectangle *à la main*, à l'arrache,
Hexa le redresse tout seul en un petit fondu. Pareil pour les cercles et les flèches.
**Si tu préfères ton tracé d'origine, un seul Ctrl+Z te le rend** — Hexa ne te vole jamais ton geste.
Touche **W** pour désactiver.

**Le texte** (T) : clique où tu veux, tape, **Entrée** valide, **Échap** annule.

**L'écriture à la main** (J) : écris au stylo comme sur un carnet, et une demi-seconde après ton
dernier trait, Hexa retrace ton mot en typographie nette. **Entrée** transforme tout de suite,
**Ctrl+Z** rend ton gribouillis.

**Le numéroteur** (N) : chaque clic pose une pastille numérotée — 1, 2, 3 — et Hexa relie
automatiquement chaque pastille à la suivante par une flèche. Idéal pour raconter un déplacement.

**La règle** (M) : glisse d'un point à l'autre, Hexa affiche la distance et l'angle.

**Coller une image** : **Ctrl + V** colle l'image de ton presse-papier (une capture, un logo,
une carte). La **molette** la redimensionne.

### Les couleurs et l'épaisseur

Sept couleurs, touches **1** à **7** : cyan, rose, violet, vert, jaune, orange, blanc.
Elles sont aussi dans la barre d'outils, qui démarre à **gauche de l'écran**, à la verticale.
Tu peux l'attraper par sa poignée (l'hexagone, tout en haut) et la poser contre n'importe quel
bord : elle s'y aimante et se retourne toute seule.

L'épaisseur : la **molette de la souris** l'augmente et la diminue en direct, sans quitter ton
dessin. Au clavier, **Ctrl + Maj + 7** et **Ctrl + Maj + 8**.

---

## Effacer

Quatre façons, de la plus fine à la plus radicale :

| | |
| --- | --- |
| **Annuler le dernier geste** | Ctrl + Maj + 6 (ou Ctrl + Z quand Hexa a le focus) |
| **Gommer un trait précis** | Touche **E**, puis clique et passe sur le trait sans relâcher : il disparaît en entier |
| **Tout effacer** | **Ctrl + E** — en mode dessin |
| **Tout effacer en catastrophe** | **Ctrl + Maj + X** — marche même en pleine partie, sur tous les écrans |

Et surtout : **tu n'as presque jamais besoin d'effacer.** Par défaut, chaque annotation se dissout
toute seule au bout de **4 secondes**, en une petite traînée de comète.
C'est le vrai défaut d'Epic Pen — l'écran finit sale — et c'est réglé ici par défaut.

---

## Le mode ∞ — « ça reste jusqu'au nettoyage »

La touche **D** fait tourner la durée de vie des annotations :

**2 secondes → 4 secondes → 8 secondes → ∞**

Sur **∞**, plus rien ne s'efface tout seul : ton écran devient un tableau blanc.
Tes traits restent tant que tu ne dis pas le contraire. Pour repartir de zéro : **Ctrl + E**.

- **2 s** : tu montres un truc en passant, pendant que tu joues.
- **4 s** (par défaut) : le bon compromis pour commenter en direct.
- **8 s** : le temps d'expliquer une phrase entière.
- **∞** : analyse de replay, cours, schéma que tu construis pièce par pièce.

**Où le voir, où le changer.** La barre d'outils porte une pastille qui affiche en clair `2s`,
`4s`, `8s` ou `∞` : **clique dessus** et elle passe au réglage suivant, exactement comme la touche
**D**. Elle s'allume quand tu es sur ∞, pour que le tableau persistant ne soit jamais une surprise.
Et si tu as masqué la barre, la petite pastille d'état en bas de l'écran continue d'afficher le
réglage en cours — outil, couleur, épaisseur et fondu.

---

## Le clic droit : déplacer, et le menu qui tourne

**Clic droit sur une annotation → tu l'attrapes.** Tu la fais glisser où tu veux, tu relâches.
Pratique quand tu as entouré la mauvaise chose de deux centimètres, ou quand l'action bouge
et que ton cercle doit suivre.

**Clic droit maintenu dans le vide → le menu radial s'ouvre sous ton curseur.**
Une roue apparaît, avec les outils tout autour et les couleurs au centre.
Tu **glisses** vers ce que tu veux, tu **relâches**, c'est pris.

C'est le geste qui change tout quand tu joues : tu ne cherches plus la barre d'outils des yeux,
tu ne quittes pas l'action. La roue s'ouvre là où est déjà ta souris, et le mouvement finit par
devenir un réflexe — un petit coup en haut à droite, tu as le stylo, sans avoir regardé.

> La roue ne s'ouvre que si tu maintiens le clic droit **dans le vide**. Sur une annotation, le
> clic droit garde son rôle historique : tu attrapes le trait et tu le déplaces. Les deux gestes
> ne se marchent jamais dessus.
>
> Tu relâches au centre (ou tu appuies sur **Échap**) : rien n'est sélectionné, la roue se referme.

---

## Montrer un détail : loupe, gel d'image, masque flou, avant/après

Quatre outils qui ne dessinent pas : ils travaillent sur **l'image de ton écran**.
Ils sont surtout faits pour une analyse de partie, un débrief ou un cours.

**La loupe** — maintiens **A**. Un disque grossissant suit ta souris ; la **molette** règle le
grossissement. Appuie sur **V** pendant que la loupe est ouverte et le disque **se fige à sa
place** : le contenu, lui, continue de suivre ton curseur. C'est ce qui permet de garder la loupe
dans un coin propre de l'image pendant que tu montres autre chose.

**Le gel d'image** — **V**. Ton écran se fige sur une photo, et tu annotes tranquillement dessus
pendant que le jeu, lui, continue. Réappuie sur **V** (ou clique le bouton allumé de la barre)
pour rendre le direct. **Échap** le rend aussi.

**Le masque flou** — **B**. Trace un rectangle sur ce qu'il ne faut pas montrer : un pseudo, une
adresse, une notification. Le masque reste **volontairement en place** — ni le fondu, ni « tout
effacer », ni la touche panique ne l'enlèvent. Ce qui cache une information ne doit jamais sauter
par accident : la petite croix du masque le retire, et elle seule.

**L'avant / après** — **U**. Une photo de l'écran à gauche, le direct à droite, et une poignée à
glisser entre les deux. Si aucune photo n'a encore été prise, Hexa la prend lui-même : tu n'as pas
d'ordre à retenir.

> Ces quatre-là ont besoin du mode dessin, comme toutes les touches à une seule lettre.
> Dans la version overlay, ils lisent l'écran sans rien te demander ; dans la démo navigateur,
> le navigateur demande l'autorisation de partage au premier clic.

---

## Les 8 thèmes

Icône près de l'horloge → **Réglages…** → **Thème**. Le changement est immédiat.

| | |
| --- | --- |
| **Néon nuit** | Verre dépoli, halos cyan et violet. La signature Hexa. |
| **Glacier** | Clair et givré. Pour les fonds lumineux et les captures propres. |
| **Holo iris** | Nuit profonde, bordures irisées qui tournent lentement. |
| **Phosphore** | Terminal vert sur noir, angles droits. Esprit rétro. |
| **Sakura** | Pastel rose et lavande, tout en rondeurs. |
| **Royal** | Marine profond et filets dorés. Le ton masterclass. |
| **Toon** | Aplats criards, contours épais. Esprit bande dessinée. |
| **Stealth** | Monochrome quasi invisible, zéro halo. L'outil se fait oublier. |

Ce ne sont pas de simples changements de couleur : la barre d'outils change de forme, d'ombre
et d'animation. Ton overlay ne ressemble pas à celui de tout le monde.

---

## Les profils

Un profil, c'est **tous tes réglages d'un coup** : durée d'effacement, thème, effets, formes.
Dans **Réglages… → Profils d'usage**, quatre sont livrés :

- **Analyse LoL** — rien ne s'efface, formes redressées : on décortique une phase image par image.
- **Masterclass** — effacement en 8 s, tracé sobre : lisible au montage, sans distraction.
- **Coaching live** — effacement en 4 s, laser en avant : on montre, on commente, l'écran reste propre.
- **Discret** — thème sombre minimal, effets réduits : l'outil se fait oublier.

Tu peux **enregistrer le tien** : règle tout comme tu l'aimes, tape un nom dans le champ en bas de
la liste, puis clique sur **Enregistrer**. Ton profil apparaît avec les autres, à un clic.

---

## Pour ton stream

### Comment OBS voit les annotations

C'est la seule chose vraiment importante à comprendre, alors soyons précis.

| Ta source dans OBS | Est-ce que tes annotations passent à l'antenne ? |
| --- | --- |
| **Capture d'écran** (« Display Capture ») | ✅ **Oui.** C'est la solution la plus simple, rien à configurer. |
| **Capture de jeu** (« Game Capture ») | ❌ **Non.** Et ce n'est pas un bug de Hexa. |
| **Capture de fenêtre** (« Window Capture ») | ❌ **Non**, pour la même raison. |
| **Source navigateur** vers Hexa | ✅ **Oui**, et c'est la solution de luxe (voir plus bas). |

**Pourquoi la capture de jeu ne marche pas :** elle ne filme pas ton écran, elle va chercher les
images *à l'intérieur du jeu*, avant qu'elles n'arrivent à l'écran. Tout ce qui est posé par-dessus
— Hexa, mais aussi l'overlay Discord ou celui de Steam — n'existe pas encore à ce moment-là.
Aucun logiciel d'annotation ne peut contourner ça, Epic Pen pas davantage.

**Donc, deux solutions au choix.**

### Solution 1 — la capture d'écran (deux minutes)

Dans OBS, remplace ta source « Capture de jeu » par une **Capture d'écran** :
`+` → **Capture d'écran** → choisis ton écran principal.
Tes annotations apparaissent. C'est tout.

Si ton jeu était en **plein écran exclusif**, passe-le en **fenêtré sans bordure** dans ses options
vidéo : en plein écran exclusif, Windows n'autorise aucune couche par-dessus, et tu ne verrais
même pas Hexa sur ton propre écran.

### Solution 2 — la source navigateur (le mode « stream seul »)

Hexa peut envoyer tes annotations directement dans OBS, dans une couche à part.
Deux avantages énormes :

- tes annotations sont **au-dessus de tout**, indépendamment de la façon dont tu captures ton jeu ;
- tu peux garder **ton écran totalement propre** : toi tu ne vois rien, tes spectateurs voient tout.

**La marche à suivre :**

1. Icône Hexa près de l'horloge → **Réglages…** → section **OBS**.
2. Sous **Serveur local**, mets l'interrupteur **Actif**.
3. Une adresse s'affiche : `http://127.0.0.1:4787/obs.html`. Clique sur **Copier**.
4. Dans OBS : `+` → **Navigateur** → colle l'adresse dans le champ **URL**.
5. Mets **Largeur** et **Hauteur** aux dimensions de ta scène (souvent 1920 × 1080). Valide.

Dessine : les traits apparaissent dans OBS, identiques, sur fond transparent.
Il n'y a **rien à cocher** pour la transparence, elle est déjà là.

**Le mode « Stream seul »** est juste au-dessus, dans le réglage **Sortie** :

- **Écran** (par défaut) : tu vois tes annotations, OBS aussi.
- **Stream seul** : ton écran reste vierge, seuls tes spectateurs voient les traits.
  Parfait pour ne pas te gêner en jeu, ou pour annoter une information que tu as sous les yeux
  sans la masquer.

> L'adresse `127.0.0.1` veut dire « cet ordinateur, et personne d'autre ». Rien n'est publié sur
> Internet ni même sur ton réseau : ton voisin de wifi ne peut pas s'y connecter.

### Nettoyer l'écran au changement de scène

Toujours dans **Réglages… → OBS**, plus bas : **obs-websocket**.
Renseigne l'adresse et le mot de passe de ton OBS (dans OBS : Outils → Paramètres du serveur
WebSocket), et Hexa **efface automatiquement toutes les annotations quand tu changes de scène**.
Fini les traits d'il y a dix minutes qui réapparaissent sur ton écran de fin.

C'est facultatif : sans OBS, Hexa fonctionne exactement pareil et ne se plaint jamais.

### Rejouer une session

Toutes tes annotations sont horodatées. Dans **Réglages… → Session**, tu peux **rejouer** la
session à son rythme d'origine, trait après trait, pour un montage ou un débrief.
Tu peux aussi exporter un **PNG transparent** en 1×, 2× ou 4× (à poser sur une miniature, par
exemple), ou enregistrer la session pour la relire des semaines plus tard.

---

## Ça ne marche pas ?

### Je dessine et rien ne s'affiche

**Dans l'ordre, vérifie ça :**

1. **Le liseré lumineux est-il allumé** autour de ton écran ? Sinon, appuie sur **F8**.
   Sans lui, tes clics vont dans ton jeu, c'est normal, c'est fait pour.
2. **Ton jeu est-il en plein écran exclusif ?** Passe-le en **fenêtré sans bordure**.
   En plein écran exclusif, Windows interdit tout affichage par-dessus — aucun outil ne s'en sort.
   *Hexa le détecte maintenant tout seul :* si Windows lui refuse le premier plan deux fois de
   suite, il affiche un bandeau qui te dit exactement quelle option changer dans ton jeu
   (dans League of Legends : Options → Vidéo → Mode d'affichage → **Sans bordure**).
3. **Hexa est-il en veille ?** Clic droit sur l'icône près de l'horloge : si tu lis
   « Afficher Hexa », c'est qu'il est en pause. Clique dessus.
4. **La barre d'outils a disparu mais tu dessines quand même ?** C'est **Ctrl + H**,
   appuie de nouveau pour la revoir.

### Un raccourci ne répond pas

**La cause numéro un : Epic Pen tourne encore.** Les deux logiciels se disputent alors les mêmes
touches, et c'est le premier lancé qui gagne. Ferme complètement Epic Pen (clic droit sur son
icône près de l'horloge → Quitter), puis relance Hexa.

Autres voleurs de raccourcis fréquents : l'overlay de **GeForce Experience** / **NVIDIA App**,
celui de **Discord**, celui de **Xbox Game Bar**, ou un logiciel de macros.

**La solution qui marche à tous les coups :** change la touche.
Réglages… → **Raccourcis** → clique sur la ligne concernée → appuie sur la combinaison de ton
choix. C'est pris immédiatement, sans redémarrer quoi que ce soit.

**Cas particulier, et c'est volontaire :** **Ctrl + Z**, **Ctrl + E** et **Ctrl + H** ne répondent
que quand la fenêtre de Hexa a le focus, donc en mode dessin. Hexa refuse de confisquer à tout ton
ordinateur les combinaisons que les autres logiciels utilisent déjà — Ctrl+Z casserait l'annulation
dans Word et Photoshop, Ctrl+E la barre de recherche de ton navigateur, Ctrl+H son historique.
Windows ne sait pas partager un raccourci : celui qui le réserve le prend à tout le monde.
Les équivalents qui marchent pendant que tu joues : **Ctrl + Maj + 6** pour annuler,
**Ctrl + Maj + X** pour tout effacer.

### L'overlay bloque mes clics, je ne peux plus jouer

Le mode dessin est resté allumé. Trois façons d'en sortir, la plus rapide d'abord :

1. **F8**.
2. **Ctrl + Maj + 2** (le « curseur » d'Epic Pen : rend la souris au jeu).
3. Clic sur l'icône Hexa près de l'horloge.

Si vraiment plus rien ne répond : clic droit sur l'icône près de l'horloge →
**Masquer Hexa (mise en veille)**, ou **Quitter**.

### OBS ne voit pas mes annotations

Tu utilises une **Capture de jeu**. Elle ne peut pas les voir, par construction —
relis la section [Pour ton stream](#pour-ton-stream) juste au-dessus.
Passe en **Capture d'écran**, ou ajoute la **source navigateur**.

Autres pistes, si tu es déjà en capture d'écran :

- OBS capture-t-il **le bon écran** ? Si tu en as deux, vérifie lequel est sélectionné.
- Ta **source navigateur** affiche une page blanche ou vide ? Vérifie que **Serveur local** est
  bien sur **Actif** dans Réglages → OBS, et que l'adresse collée est exactement celle affichée.
- Ton **mode de sortie** est-il sur « Stream seul » alors que tu comptais sur la capture d'écran ?
  Dans ce mode, ton écran est volontairement vide.

### J'ai deux écrans

Hexa pose **une couche par écran**, automatiquement. Tu dessines sur celui où se trouve ta
souris quand tu appuies sur **F8** : c'est cet écran-là qui prend la main, les autres rendent
leurs clics au jeu. Pour dessiner sur l'autre écran, amène la souris dessus et appuie de nouveau
sur F8.

**Tu branches ou débranches un écran en pleine session ?** Rien à faire : Hexa s'en aperçoit
tout seul (une seconde environ), crée la couche du nouvel écran et retire celle de l'écran parti.
Tes annotations en cours ne bougent pas. Si tu dessinais justement sur l'écran débranché, la main
passe automatiquement à l'écran où est ta souris.

> **Pour ton stream :** quand tu as plusieurs écrans, la source navigateur d'OBS suit **l'écran
> où tu dessines**. Elle bascule d'elle-même dès que tu commences un trait sur l'autre écran.

### Windows est à 125 % (ou 150 %) et le trait semble décalé

La mise à l'échelle de Windows est gérée : à 100 %, 125 %, 150 % ou 200 %, le trait tombe sous ton
curseur au pixel près, et Hexa se recalibre tout seul si tu changes l'échelle sans redémarrer.

Si tu constates malgré tout un décalage, c'est presque toujours **un écran configuré à une échelle
différente des autres**, avec un changement fait pendant que Hexa tournait :
clic droit sur l'icône près de l'horloge → **Quitter**, puis relance Hexa. Et signale-le : ce cas
précis est le plus difficile à reproduire, le fichier journal (voir plus bas) nous dira tout.

### Mon ordinateur s'est mis en veille / j'ai verrouillé ma session

Hexa se met en retrait tout seul pendant la veille, le verrouillage ou un changement d'utilisateur,
et revient à l'identique au retour — **annotations comprises**. C'est volontaire : une couche
transparente laissée en place pendant que Windows change de bureau revient parfois en **rectangle
noir** plein écran. Hexa préfère se cacher une seconde et revenir propre.

Au retour, Hexa réenregistre aussi ses raccourcis auprès de Windows : **F8 remarche
immédiatement**, sans redémarrage.

### Je ne retrouve plus Hexa du tout

L'icône est près de l'horloge, parfois cachée derrière la **petite flèche ⌃** à gauche de l'heure.
Fais-la glisser à côté de l'horloge pour ne plus jamais la perdre.

Si l'icône n'y est pas non plus, Hexa n'est probablement pas lancé : double-clique sur l'icône du
bureau, ou tape `Hexa` dans le menu Démarrer. Tu peux aussi demander à Hexa de démarrer tout seul
avec Windows : clic droit sur son icône → **Lancer au démarrage de Windows**.

### Autre chose

Clic droit sur l'icône près de l'horloge → **À propos de Hexa** →
**Ouvrir le dossier du journal**. Hexa y écrit tout ce qu'il fait au démarrage.
C'est le fichier à joindre si tu signales un problème.

---

## Ce que Hexa ne fait pas (encore)

Par honnêteté, parce qu'un mode d'emploi qui promet du vent ne sert à rien :

- **le mode Coach** — annoter depuis un second ordinateur l'écran de quelqu'un d'autre — est
  prévu, pas commencé ;
- Hexa est un logiciel **Windows** : macOS et Linux ne sont pas pris en charge aujourd'hui ;
- il n'y a **aucune synchronisation en ligne**. Tes réglages et tes annotations restent sur ton
  ordinateur. Hexa ne se connecte à rien, jamais, et fonctionne entièrement hors ligne.
