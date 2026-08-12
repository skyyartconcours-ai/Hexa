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
```

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
