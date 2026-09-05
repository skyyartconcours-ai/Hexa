# Campagne de tests bout en bout d'Hexa

Ces scripts lancent **la vraie application Electron** — pas une simulation, pas un
composant isolé — et exercent une par une les fonctionnalités promises à
l'utilisateur : chaque outil, chaque mécanique, chaque panneau, les deux jeux de
raccourcis, et la règle de performance (0 image par seconde au repos).

**La règle de la maison :** un test ne dit « ça marche » que si des **pixels ont
réellement bougé** sur les canevas. Une classe CSS `active` ne prouve rien.

## Lancer la campagne

```bash
npm run build && npm run build:main      # obligatoire : les tests lisent dist/
node test/e2e/hexa-e2e.mjs
```

Sur une machine sans écran (CI, conteneur Linux) :

```bash
xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/hexa-e2e.mjs
```

Une seule section à la fois, pendant une mise au point :

```bash
node test/e2e/hexa-e2e.mjs --only=outils
node test/e2e/hexa-e2e.mjs --only=mecaniques,performance
```

Sections disponibles : `demarrage`, `outils`, `mecaniques`, `panneaux`,
`raccourcis`, `performance`.

### Campagnes spécialisées

```bash
node test/e2e/s9-windows.mjs   # robustesse Windows : écrans à chaud, veille, arrêt
node test/e2e/s9-dpi.mjs       # le trait tombe-t-il sous le curseur à 100/125/150/200 % ?
node test/e2e/s10-obs.mjs      # la chaîne OBS : le trait arrive-t-il en stream, et personne d'autre ne l'écoute
node test/e2e/s17-bascule-ecran.mjs        # la bascule d'écran d'annotation SOUS CONTRAINTE
node test/e2e/s18-repos-deux-fenetres.mjs  # la règle du repos (§2.5) en VRAI mode deux fenêtres
node test/e2e/s19-demandes-utilisateur.mjs # les demandes de l'utilisateur, une par une
node test/e2e/s20-demarrage-froid.mjs      # démarrage à froid, y compris configuration abîmée
node test/e2e/s21-etat-abime-suite.mjs     # les clés persistées que §S20 ne couvrait pas
node test/e2e/s22-usage-reel.mjs           # martèlement en mode DEUX FENÊTRES, et la pente sur la durée
node test/e2e/s23-pannes-externes.mjs      # flux d'écran refusé, port OBS pris, export impossible
node test/e2e/s24-maj-forme.mjs            # Maj tenue au pinceau : la forme est reconnue même ouverte
node test/e2e/s25-coach-devoilement.mjs    # dévoilement pas à pas, calque fantôme, duo de couleurs (Tab)
node test/e2e/s26-trait-collant.mjs        # pointerup perdu : le trait ne doit plus suivre la souris
node test/e2e/s27-clavier.mjs              # la fenêtre clavier : les fenêtres transparentes ne prennent jamais le focus
node test/e2e/s28-clavier-deux-fenetres.mjs # le clavier en VRAI mode deux fenêtres (Tab, lettres nues, Ctrl+Maj+1)
node test/e2e/s29-actions-globales.mjs     # chaque raccourci global fait vraiment quelque chose dans la page
node test/e2e/s28-clavier-deux-fenetres.mjs # Tab et les lettres dans le VRAI mode à deux fenêtres
```

`s17-bascule-ecran.mjs` prend la suite de `s16` là où celui-ci s'arrête. §S16
prouve qu'un écran qui n'annote pas ne trace rien **au repos** ; §S17 le prouve
**pendant que quelque chose se passe** : bascule au milieu d'un tracé, pendant
une dissolution, avec un panneau ouvert, avec la loupe et son flux d'écran
ouverts, avec des masques flous figés. Sa première partie monte deux puis trois
écrans réels (vrais événements `screen`, comme §S9) et vérifie l'invariant qui
manquait : **un écran qui perd la désignation rend la souris au jeu**. Sans lui,
sa fenêtre restait affichée plein écran, avalait tous les clics, et son moteur
— devenu inerte — n'en dessinait aucun.

`s18-repos-deux-fenetres.mjs` est la seule campagne qui mesure la règle du repos
dans le mode que l'utilisateur emploie vraiment : **deux fenêtres par écran**,
sans `HEXA_FUSION`. Écran vide, trait posé en fondu ∞, annotations masquées,
veille système — à chaque fois, zéro image demandée dans l'une comme dans
l'autre couche, et la part d'écran réellement composée par Windows.

`s20-demarrage-froid.mjs` abîme la configuration persistée de six façons
différentes (JSON tronqué, fichier vide, listes nulles ou du mauvais type,
cartes sans leurs champs, valeurs absurdes) et exige à chaque fois que la barre
soit là, la scène montée, et **que le stylo dessine encore**. Le mode de panne
qu'il ferme est le pire du projet : le rendu lève, la fenêtre transparente reste
vide, et l'utilisateur ne voit rien — pas même un message d'erreur.

`s21-etat-abime-suite.mjs` termine le travail de §S20, qui n'avait assaini que
`clocks` et `notes` en les croyant « les seules valeurs persistées parcourues au
rendu ». Il en manquait quatre, et la pire était `keymapOverrides` : elle est
lue par la **barre d'outils**, montée en permanence, si bien qu'un seul override
mal typé donnait `n.split is not a function` puis **l'overlay entièrement vide
au lancement** — le défaut historique, intact. Les trois autres
(`lexiconCategories`, `lexiconWords`, `customProfiles`) tuaient l'application
à l'ouverture des réglages : barre, scène et stylo perdus d'un coup, en plein
direct. Aucun error boundary React n'existe dans le projet : toute levée au
rendu démonte l'arbre entier, et sur une fenêtre transparente il ne reste
littéralement rien à voir.

`s22-usage-reel.mjs` martèle Hexa dans le mode que l'utilisateur emploie
vraiment — **deux fenêtres par écran** — là où `couches.mjs` ne vérifie que la
structure et `s18` que le repos : deux cents changements d'outil, un thème
changé en plein trait, un panneau ouvert en plein trait, une bascule d'écran en
plein trait, trois écrans avec la barre sur le troisième, la couche encre
rechargée, la fenêtre d'interface détruite sous les pieds du principal, et trois
cents cycles pour chercher **la pente** que l'utilisateur décrit (« ça saccade de
plus en plus »). C'est lui qui a mis au jour l'invariant manquant : **un écran
qui vient d'être branché ne doit pas entrer en mode dessin**. Il naissait plein
écran, visible, opaque aux clics, avec un moteur inerte — le moniteur entier
devenait inutilisable et rien ne l'expliquait.

`s23-pannes-externes.mjs` exécute pour la première fois les trois pannes qui
viennent du dehors et qu'aucune campagne ne touchait : le **flux d'écran
refusé** (la loupe et les masques le disent, sans rafale de nouvelles
tentatives, et le stylo continue), le **port du serveur OBS déjà occupé** (un
vrai squatteur est posé sur le port avant le lancement), et l'**export qui ne
peut pas produire son fichier**. Aucune n'a le droit de coûter son outil à
l'utilisateur : elles peuvent le priver d'une fonction, pas de son stylo.

`s9-windows.mjs` émet les **vrais** événements système (`screen`, `powerMonitor`) sur
les objets du processus principal, puis regarde ce que les fenêtres et les canevas
sont réellement devenus : second écran branché puis débranché, passage à 125 %,
`workArea` seul qui doit être ignoré, veille, verrouillage de session, trois cycles
de branchement d'affilée (fuites), fermeture sans processus zombie.

`s9-dpi.mjs` relance l'application pour chaque échelle avec
`--force-device-scale-factor` et mesure l'écart entre le geste demandé et l'encre
réellement peinte, en pixels CSS.

`s10-obs.mjs` couvre le seul chemin qui n'était testé nulle part alors qu'il tourne
à chaque lancement : le serveur local de la source navigateur. Il pose un trait sur
l'overlay et va compter les pixels **dans la page OBS**, puis vérifie que personne
d'autre ne peut écouter — jeton de session exigé, iframe « sandbox » (origine
`null`) et site distant refusés, jeton jamais écrit dans le journal.

Les deux sortent en code 1 si un test casse, et écrivent leurs captures dans
`captures/s9/`.

### Capture OBS fiable et coût mesurable (deux fenêtres par écran, comme en usage réel)

```bash
xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/t-obs-1-disparition.mjs
xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/t-obs-2-capturable.mjs
xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/t-obs-3-sonde.mjs
```

`t-obs-1-disparition.mjs` instruit la piste « OBS affiche ma page Twitch » : avec le
réglage « Garder la fenêtre capturable par OBS » **coupé** (comportement hérité), il
prouve que la fenêtre d'encre est réellement **cachée** (`isVisible()` faux) dans chaque
état où l'utilisateur perd l'outil — au repos, annotations effacées, fondu terminé,
annotations masquées, veille — donc absente de la liste d'OBS. Il vérifie aussi que
les titres des fenêtres sont uniques et qu'un écran branché à chaud, non désigné,
reste inerte.

`t-obs-2-capturable.mjs` éprouve le comportement **par défaut** : vide, la fenêtre
d'encre reste visible mais **réduite à 8 × 8 px** dans le coin de son écran, reprend
l'écran entier au F8 (latence mesurée), ne se repose jamais au repos (0 `setBounds`
en 5 s), garde ses pixels après un cycle, se cache en veille, et le réglage se coupe à
chaud et survit au redémarrage.

`t-obs-3-sonde.mjs` couvre « ça prend combien de ressources ? » : le témoin OBS des
réglages qui passe seul à « source connectée », le témoin « Coût actuel » (une lecture
toutes les 2 s panneau ouvert, **zéro** panneau fermé), et la sonde de 30 s — fichiers
écrits, conclusion en français, trait vu pendant la mesure, et rien qui reste après
(ni minuterie, ni méthode de fenêtre enrobée, ni lecture périodique).

## Playwright

Playwright n'est **pas** une dépendance d'Hexa : l'application livrée ne doit pas
grossir d'un pilote de navigateur. Le harnais va le chercher tout seul dans
`node_modules`, puis dans l'installation globale de Node. S'il ne le trouve pas :

```bash
npm i -g playwright
# ou, si Playwright vit ailleurs :
HEXA_E2E_PLAYWRIGHT=/chemin/vers/playwright-core/index.js node test/e2e/hexa-e2e.mjs
```

## Ce que la campagne produit

Tout atterrit dans `test/e2e/captures/` (redirigeable avec `HEXA_E2E_OUT`) :

| Fichier | Contenu |
| --- | --- |
| `<id-du-test>.png` | une capture par test — la seule preuve qui compte |
| `resultats.txt` | le tableau FONCTIONNE / CASSÉ / ABSENT / NON TESTÉ |
| `resultats.json` | les mêmes résultats, exploitables par un script |

Le code de sortie vaut `1` dès qu'un test est **CASSÉ**, `0` sinon — donc
utilisable tel quel dans une intégration continue.

## Environnement de test

Chaque campagne repart d'une **installation vierge** : un dossier utilisateur neuf
est créé à chaque lancement, exactement comme au tout premier double-clic sur
l'icône. C'est ce qui rend les résultats reproductibles, et c'est ce qui permet de
vérifier que la découverte guidée s'affiche bien au premier lancement.

Après la section « démarrage », l'état est remis à zéro via `localStorage` — donc
via le **vrai** mécanisme de persistance de l'application — avec le fondu réglé
sur ∞ : sans ça, la moitié des mesures porterait sur des traits déjà effacés.

Les raccourcis **système** (ceux qu'Electron confisque à Windows) sont désactivés
pendant la campagne : sous Xvfb ils n'ont aucun sens. Le clavier de la page, lui,
est testé en entier, dans les deux presets.

## Les deux fichiers

- `harness.mjs` — lancement de l'application, comptage des pixels d'encre, boîtes
  englobantes, gestes de souris, écriture manuscrite de test, journal des
  résultats.
- `hexa-e2e.mjs` — la campagne elle-même, section par section.
- `s2-ecriture.mjs` — écriture manuscrite : la lecture des LETTRES, une par une
  (correcteur lexical coupé, pour ne mesurer que la reconnaissance).
- `s3-lexique.mjs` — écriture manuscrite : la devinette du MOT et sa réécriture
  (« SYNDRA » → « Syndra », « KAISA » → « Kai'Sa »), et surtout la prudence —
  un mot absent du lexique ne doit jamais être détourné.

## Écrire un test de plus

```js
await rapport.test(win, 'mec-truc', 'Ce que l’utilisateur attend', async () => {
  await toutEffacer(win)
  const avant = await encreTotale(win)
  // … le geste réel …
  const apres = await encreTotale(win)
  return { statut: apres > avant ? OK : KO, detail: `encre ${avant} → ${apres}` }
})
```

`rapport.test` prend la capture, attrape les exceptions et remplit le tableau
tout seul. Un test qu'on n'a pas pu écrire se marque `NON_TESTE` — **jamais**
`OK`.
