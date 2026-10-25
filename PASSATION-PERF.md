# Passation — performances Hexa + OBS (lag du PC pendant les lives)

Document de reprise pour une IA ou un développeur qui doit **continuer à optimiser Hexa**
et éviter que le PC ne rame pendant les lives Twitch. Rédigé le 25/10/2026 à partir de deux
nuits d'enquête (23-24/10 et 24-25/10) et de tests le 25/10.

## 1. Le problème

Pendant les lives (OBS 32.2.2, Windows 11, Ryzen 9 9950X3D, RTX 5080, 3 écrans dont un
LG 1920×1080 en 240 Hz), **tout le PC finit par ramer** : la souris saccade et l'interface ne
répond plus. Ça apparaît après 1 à 3 h de live.

**Signature mesurée :** le fil de composition de `dwm.exe` (le compositeur de Windows) est
bloqué à environ 100 % d'un cœur, alors que le processeur total reste à 10-20 % et la carte
graphique 3D à environ 13 %. OBS lui-même reste sain : 0,0 % d'images en retard. **Le lag est
dans Windows, pas dans OBS.**

## 2. Ce qui est établi

| Fait | Preuve |
|---|---|
| Passer sur une autre scène OBS puis revenir fait retomber dwm (environ 100 % → 25 %) | 24/10 21:51:49 → 21:53:26 ; 25/10 02:10:07 → 02:11:46 |
| Fermer OBS fait retomber dwm à 0 % | 24/10 04:22 |
| Fermer Hexa ne fait **pas** retomber dwm | 18:23, 20:06 et 01:20 : dwm reste saturé |
| Supprimer des sources, arrêter l'enregistrement, passer en 120 Hz : sans effet | 20:36, 01:20, 02:05, 20:43, etc. |
| Hexa ouvert **sans dessiner** est léger | dwm à 8 % avec OBS fermé (25/10 03:44) |
| Les 3 grosses séries de dessin Hexa précèdent les 3 saturations | 18:10 (51 actions), 19:50 (37), 01:00 (26) |

**Mécanisme le plus probable (non prouvé) :** une session de capture de fenêtre Windows
Graphics Capture (WGC) d'OBS se met dans un état coûteux pour DWM. Elle n'est libérée que
quand OBS détruit la capture : changement de scène (`wc_hide` → `winrt_capture_free`) ou
fermeture d'OBS. Le déclencheur exact n'est pas isolé. Le dessin intense dans Hexa,
l'ajout ou le reciblage de captures de fenêtre Chrome/VLC en plein live et le démarrage
d'un enregistrement arrivent toujours ensemble.

## 3. Ce qui a déjà été fait

### Hexa (branche `claude/hexa-allegement-dwm`, versions 0.1.52-allege.2 → .5)

Installée chez l'utilisateur : **0.1.52-allege.5** (25/10, 14:19, commit `74f94d4`). Sauvegardes de
chaque version précédente : `%LOCALAPPDATA%\Programs\Hexa-sauvegarde-2026-10-25-allege2` et
`…-allege3` (avec `desinstallation-hexa.reg`). Base de départ : `45c77f6` (branche
`ccr-0f5b38f3-a4wk3x`, version installée 0.1.52 du 16/10).

| Commit | Contenu | Version |
|---|---|---|
| `b88435b` | Overlays seulement sur l'écran d'annotation et celui de la barre ; occlusion et bridage Chromium réactivés hors dessin (`HEXA_BRIDAGE_COUPE=1` pour revenir) ; fenêtre d'encre vide CACHÉE (la réduction 8×8 « capturable par OBS » devient une option coupée d'usine) ; 60 images/s au plus ; source OBS rechargée dès que la clé change | allege |
| `04176aa` | Test s32 : Ctrl+Maj+1/3/2/X par le vrai clavier | allege |
| `f97543a` | Ctrl+Maj+E = tout effacer + souris rendue au jeu (l'export PNG passe sur Ctrl+Alt+Maj+E) | allege.2 |
| `8ecd6c3` | `forward:true` (crochet souris global WH_MOUSE_LL) seulement pour laser, projecteur, loupe, et la barre réduite à l'approche du pointeur (GetCursorPos 10 Hz) ; fenêtre « Hexa Clavier » cachée hors usage ; protection de capture reposée à chaque réapparition ; option « Barre d'outils seulement en mode dessin » ; profil « Stream léger » ; canevas live plus effacé quand vide ; anti-rebond de reassertTopmost ; avertissement si plusieurs vues OBS | allege.3 |
| `f653cb1`, `8dc5d3e` | **Ctrl+Maj+4 = petites pastilles** (minimap LoL, `Stroke.mini`, numérotation partagée, fil seulement entre pastilles de même taille) ; surligneur sur « S » | allege.4/.5 |
| `b503f90` | Journal : « la couche encre reste affichée, des annotations sont à l'écran » au retour au jeu | allege.5 |
| `6a0f5bc` | Trait en cours : Path2D et entrées du contour prolongés au lieu de 6 reconstructions par image (renderLive à 2 000 points : 1,4 → 0,9 ms ; 5 000 : 2,8 → 1,9 ms) ; flèche recalculée une fois par paquet de mouvements ; point-curseur caché figé | allege.5 |
| `74f94d4` | **Fondu 2 min par défaut ET au plus** (∞ retiré à la demande de l'utilisateur ; tout ∞ persisté ou de profil → 2 min ; les annotations épinglées restent) | allege.5 |

Tests (poste à 3 écrans) : s31 15/15, s32 12/12, t-obs-2 20/20, t-obs-5 5/5, s33 9/9 (hors écran). **Non
encore lancé sur allege.5 :** s32 complet (dont §6 : Ctrl+Maj+1, +4, S, Ctrl+Maj+E → couche retirée < 1 s) —
il envoie de vraies touches, à faire hors live, Hexa de l'utilisateur fermé. Couches, s10, s17, s27 : mêmes
KO que le code d'origine sur ce poste (campagnes écrites pour un seul écran sous Xvfb).

Défaut connu, sans gravité : après Ctrl+Maj+E, le journal écrit deux fois « la couche encre reste
affichée… » alors que les traits sont en train de disparaître (le message part avant la fin de la
dissolution ; la fenêtre se retire bien ensuite). À corriger dans `applyPassthrough` (`electron/main.ts`).

### OBS (fichier `%APPDATA%\obs-studio\basic\scenes\Sans_nom_2.json`, sauvegardes `.avant-*`)
- Les 14 captures de fenêtre de `Hexa.exe` sont masquées dans toutes les scènes, rien n'est
  supprimé. Hexa passe uniquement par la source navigateur `http://127.0.0.1:4787/obs.html?bare=1`.
- « Couper la source quand elle n'est pas visible » est activé sur toutes les sources navigateur.

## 4. À faire ensuite (pistes pour optimiser encore)

Classées de la plus prometteuse à la moins prometteuse. Aucune ne doit retirer de fonction
ni de donnée.

1. **Mesurer d'où viennent les 80-102 % d'un cœur pendant le dessin.** Le dessin lui-même ne
   coûte que quelques % ; le reste vient de la carte graphique, de la composition ou de l'IPC.
   Mesurer par processus (main, renderer d'encre, gpu-process, utility) pendant 30 s de
   gribouillage dans l'application réelle, hors live.
2. **Figer le début stabilisé du trait en cours** dans un bitmap et ne redessiner que les ~64
   derniers points. Attention : le dégradé de couleur couvre tout le trait, donc le rendu
   change ; à valider avec l'utilisateur. Objectif : `renderLive` < 2 ms à 5000 points.
3. **Effacer et clipper seulement la zone modifiée** au lieu de tout le canvas
   (`src/engine/engine.ts` ~3094 dans `renderLive` et ~2636 dans `renderStatic`). NB : `renderLive`
   ne vide déjà plus un canevas resté vide (`liveSale`).
4. **Fondu sans reconstruction de couche** (`src/engine/ink-fx.ts` ~1057-1082, branche `!keep` qui
   incrémente `fxStats.rebuilds` ; `noterCheckpoint` ~826 copie un canvas plein écran tous les 32
   ajouts). Repeindre seulement la boîte du trait qui part. Objectif : `fxStats.rebuilds` = 0 par fondu.
5. **Pastilles liées** (`src/engine/ink-fx.ts` ~1000-1006 ; `linkAnchor` dans `engine.ts` ~3067) :
   coût en O(n²) avec le nombre de pastilles (négligeable à 20 pastilles : ~400 comparaisons par
   image). Utiliser une Map id→trait si l'on vise des centaines de pastilles. Vérifier avec les
   petites pastilles Ctrl+Maj+4.
6. ~~Fondu réglé sur ∞~~ — **fait dans allege.5** : fondu 2 min par défaut et au plus.
   Reste possible : la couche encre reste affichée plein écran tant que des annotations (ou des
   annotations ÉPINGLÉES) sont à l'écran — c'est voulu, elles partent dans le direct.
7. **Crochet souris global** : déjà limité (allege.3) au laser, au projecteur, à la loupe et à la
   barre réduite survolée (`electron/main.ts` : `traverserEncre` ~1069, `poserSourisInterface`
   ~1084, `armerSuiviBarre` ~1136). Sur le poste de l'utilisateur, l'interface de l'écran
   d'annotation reste CACHÉE pendant le dessin (le curseur y est peint par l'encre), donc pas de
   `forward` plein écran. Piste restante : remplacer la lecture du pointeur à 10 Hz (~0,3 % d'un
   cœur dans le principal) par des événements, si ce coût compte.
8. **Long terme :** une fenêtre d'encre native en couche (`UpdateLayeredWindow`, mise à jour
   des seules zones sales), comme Epic Pen (WPF, une surface par écran, montrée ou cachée,
   jamais redimensionnée).

Pistes côté OBS et Windows (hors code Hexa) :
- Ne pas capturer de fenêtre VLC ou Chrome en plein live ; lire le flux SRT dans une
  **source Média** et les vidéos dans des **sources navigateur**.
- Pendant un live, rebondir 2 s par une scène **légère** (WINA INTEG ou FULL CAM FULL), pas
  par NORMAL, FULL CAM 2 ou MASTERCLASS, qui rallument 14 à 18 captures d'un coup.
- Ne pas faire tourner l'entraînement Dawnwall (17-22 `Dawnwall.exe`) ni
  `mute_ia_rapide.ps1` (environ 0,8 cœur en permanence) pendant les lives.
- Arrêter la macro Advanced Scene Switcher inutile, qui vérifie les fenêtres toutes les 300 ms.
- Une seule source webcam Cam Link (« Coller (référence) » ailleurs), sinon erreur DShow
  « Insufficient system resources ».

## 5. Comment mesurer (obligatoire avant de dire « c'est corrigé »)

Scripts dans `outils/diagnostic-dwm/` :
- `garde_dwm.ps1` : alarme. Échantillonne dwm toutes les 2 s et affiche une fenêtre « change
  de scène OBS 2 secondes puis reviens » si dwm ≥ 80 % pendant 45 s sur 60. Journal CSV à côté.
  Lancement : `powershell -NoProfile -ExecutionPolicy Bypass -File garde_dwm.ps1`
  (`-DryRun` pour tester sans fenêtre, `-TestPopup` pour voir l'alerte). Le CSV utilise des
  décimales à virgule : remplacer `,` par `.` avant de parser.
- `suivi_dessin.ps1 -Minutes N` : bilan par tranches de 30 s (dwm moyen/max, nombre de
  mesures saturées, CPU Hexa, fenêtres Hexa visibles, nombre d'actions dans `hexa.log`).

**Échelle :** 100 = un cœur plein (Win32_PerfFormattedData_PerfProc_Process). Normal : 10 à
40. Saturé : ≥ 80 en continu. Sous Windows en français, `Get-Counter` échoue (noms de
compteurs localisés) : utiliser les classes CIM `Win32_PerfFormattedData_*`.

**Critère de réussite :** un live ou une répétition d'au moins 3 h, dans les conditions
réelles (stream ou enregistrement, FULL CAM FULL, Hexa ouvert avec du dessin intense, captures
de fenêtre habituelles), avec dwm en moyenne < 40 et aucune fenêtre de 5 min dépassant 10 %
de mesures ≥ 80.

**Dernier test (25/10, 14:12-14:29) :** FULL CAM FULL, enregistrement, Hexa allege.5, peu de
dessin (7 actions), aucune capture de fenêtre visible. Résultat : pas de saturation, mais dwm
monte doucement de 16 à 43 % en 15 min, puis retombe à 5 % à la fermeture d'OBS. Il reste à
tester un dessin intense sur une longue durée.

## 6. Fichiers utiles sur le PC de l'utilisateur
- Journal Hexa : `%APPDATA%\Hexa\hexa.log` (lignes `action système jouée`, `[cycle]`, `[obs]`).
- Journaux OBS : `%APPDATA%\obs-studio\logs\` (`2026-10-24 17-44-06.txt` = la nuit du problème).
- Hexa installé : `%LOCALAPPDATA%\Programs\Hexa` ; sauvegardes `Hexa-sauvegarde-*` à côté.
