# Installer Hexa sur ton PC

Trois étapes, cinq minutes, et tu dessines sur ton écran.
Tu n'as **rien** à installer d'autre : ni compte, ni logiciel supplémentaire.

Hexa fonctionne sur **Windows 10 et Windows 11** (64 bits).

---

## Étape 1 — Ouvrir la page de téléchargement

Clique sur ce lien, il ouvre la page des téléchargements de Hexa :

**https://github.com/skyyartconcours-ai/Hexa/releases/latest**

Tu arrives sur une page qui affiche la dernière version de Hexa.
Descends un peu : sous le titre **Assets** (ou « Fichiers »), il y a une petite liste de fichiers.

---

## Étape 2 — Télécharger le bon fichier

Dans cette liste, tu cherches celui-ci :

> **Hexa-Installateur-….exe**
> (les « … » sont le numéro de version, par exemple `Hexa-Installateur-0.1.0.exe`)

Clique dessus. Le téléchargement démarre.
Le fichier arrive dans ton dossier **Téléchargements**.

> **Il y a un deuxième fichier, `Hexa-portable-….exe`.**
> Celui-là ne s'installe pas : tu le télécharges, tu double-cliques, Hexa démarre. C'est tout.
> Pratique pour essayer, ou pour emmener Hexa sur une clé USB.
> Le seul défaut : pas de raccourci sur le bureau, il faut retrouver le fichier à chaque fois.
> **Si tu hésites, prends l'installateur.** Il te met une icône sur le bureau.

---

## Étape 3 — Lancer le fichier, et passer l'avertissement de Windows

Double-clique sur le fichier téléchargé.

### Windows va afficher un écran bleu qui fait peur. C'est normal.

Une fenêtre apparaît avec écrit **« Windows a protégé votre ordinateur »** ou
**« Microsoft Defender SmartScreen a empêché le démarrage d'une application non reconnue »**.

**Ce n'est pas un virus.** Windows dit simplement qu'il ne connaît pas encore l'auteur du
programme. Pour qu'il le reconnaisse, il faudrait acheter un certificat de signature à Microsoft
(plusieurs centaines d'euros par an). Hexa est gratuit, donc il n'en a pas.
Tous les petits logiciels indépendants ont exactement le même message.

**Voici quoi cliquer, dans cet ordre :**

1. Dans la fenêtre bleue, clique sur le petit texte **« Informations complémentaires »**.
   Il est discret, sous le message, juste au-dessus des boutons.
2. Une ligne apparaît en dessous, et un nouveau bouton avec elle :
   clique sur **« Exécuter quand même »**.

Et c'est fini. Windows ne te reposera plus la question pour ce fichier.

> Si tu ne vois pas « Informations complémentaires », c'est que ton navigateur bloque le fichier
> avant Windows. Dans la liste des téléchargements de ton navigateur, à côté de « Hexa-Installateur »,
> clique sur les trois points **⋯** puis sur **« Conserver »** ou **« Conserver quand même »**.

### Ensuite, l'installation

L'installateur s'ouvre en français. Tu peux tout laisser tel quel et cliquer sur **Suivant**,
puis **Installer**. À la fin, Hexa se lance et tu as une **icône Hexa sur ton bureau**.

---

## C'est installé. Et maintenant, il ne se passe rien ?

**Si, et c'est voulu.** Hexa n'a pas de fenêtre : c'est une couche invisible posée par-dessus tout
ton écran. Une fenêtre normale te cacherait ton jeu.

Au tout premier lancement, Hexa se montre quand même pendant une douzaine de secondes,
avec un petit bandeau en bas à droite qui te souhaite la bienvenue. Pendant ce temps, tu peux
déjà dessiner. Ensuite, Hexa s'efface tout seul et rend la souris à ton jeu.

### Où est Hexa, alors ?

**Près de l'horloge**, en bas à droite de ton écran, dans la rangée des petites icônes.
Cherche l'hexagone bleu.

**Tu ne le vois pas ?** Windows cache souvent les icônes récentes. Clique sur la **petite flèche
vers le haut ⌃** juste à gauche de l'heure : un carré s'ouvre avec les icônes cachées, Hexa est
dedans. Pour l'avoir en permanence sous les yeux, **attrape-le avec la souris et fais-le glisser**
à côté de l'horloge : Windows le laissera là pour toujours.

### Les trois gestes à connaître tout de suite

| Ce que tu veux | Ce que tu fais |
| --- | --- |
| Dessiner sur mon écran | Appuie sur **F8** (ou clique une fois sur l'icône près de l'horloge) |
| Tout effacer d'un coup | **Ctrl + Maj + X** — la touche panique, elle répond même en pleine partie |
| Arrêter de dessiner, rendre la souris au jeu | Appuie de nouveau sur **F8** |

*(Le **Ctrl + E** d'Epic Pen efface lui aussi, mais seulement quand le mode dessin est allumé :
Hexa refuse de confisquer cette touche à ton navigateur. Le mode d'emploi explique pourquoi.)*

Un **liseré lumineux** apparaît tout autour de ton écran quand le mode dessin est actif.
C'est ton seul repère : liseré allumé = ce que tu fais avec la souris dessine ; liseré éteint =
tes clics repartent normalement dans ton jeu.

**Clic droit sur l'icône près de l'horloge** ouvre un menu avec tout le reste :
mode dessin, tout effacer, réglages, lancer Hexa au démarrage de Windows, et quitter.

Pour la suite — les couleurs, les formes, OBS, les raccourcis — passe au
**[mode d'emploi](GUIDE.md)**.

---

## Petits soucis d'installation

**« Cette application ne peut pas s'exécuter sur votre PC »**
Ton Windows est en 32 bits, ou très ancien. Hexa demande un Windows 64 bits (tous les PC vendus
depuis une dizaine d'années le sont).

**Mon antivirus a supprimé le fichier**
Certains antivirus se méfient des programmes non signés, comme Windows. Rouvre ton antivirus,
cherche la « quarantaine » ou l'« historique », et restaure le fichier Hexa.

**J'ai perdu l'icône du bureau**
Ouvre le menu Démarrer et tape simplement `Hexa` : le raccourci est aussi là.

**Je veux désinstaller Hexa**
Menu Démarrer → Paramètres → Applications → cherche « Hexa » → Désinstaller.
Tes réglages et tes profils restent sur le disque, au cas où tu réinstalles plus tard.

**Rien du tout ne se passe quand je lance Hexa**
Regarde d'abord près de l'horloge (voir plus haut) : le plus souvent, Hexa tourne très bien,
il est juste discret. Si l'icône n'y est pas non plus, la section
**« Ça ne marche pas ? »** du [mode d'emploi](GUIDE.md#ça-ne-marche-pas-) te dit quoi faire.
