/**
 * S9 — ROBUSTESSE WINDOWS, vérifiée sur la VRAIE application Electron.
 *
 * C'est là que meurent les outils d'overlay : un écran branché en pleine
 * partie, Windows passé à 125 %, une mise en veille, une session verrouillée.
 * Chaque scénario est joué pour de bon dans l'application, pas simulé dans un
 * test unitaire : on émet les VRAIS événements système sur les VRAIS objets
 * `screen` et `powerMonitor` du processus principal, puis on regarde ce que
 * les fenêtres et les canevas sont réellement devenus.
 *
 *   node test/e2e/s9-windows.mjs
 *
 * Sortie 1 si un test casse. Les captures vont dans test/e2e/captures/s9/.
 * Prérequis : npm run build && npm run build:main
 */
import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
// On réutilise le harnais de la campagne e2e : même état de départ, même façon
// de compter l'encre — les mesures restent comparables d'une campagne à l'autre.
import { etatDeDepart, encre, toutEffacer, CAPTURES, RACINE, chargerPilote } from './harness.mjs'

// Playwright n'est pas une dépendance d'Hexa : le harnais sait où le trouver.
const electron = await chargerPilote()

const OUT = join(CAPTURES, 's9')
mkdirSync(OUT, { recursive: true })
const USER = join(OUT, '.user-data')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })

const R = []
const ok = (n, d) => { R.push(['OK', n, d]); console.log(`  OK   ${n} — ${d}`) }
const ko = (n, d) => { R.push(['KO', n, d]); console.log(`  KO   ${n} — ${d}`) }
const dit = (n, c, d) => (c ? ok(n, d) : ko(n, d))

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
  /**
   * MODE FUSIONNÉ, comme la campagne principale (voir harness.mjs).
   *
   * Depuis la séparation en deux fenêtres (§S11), Hexa ouvre PAR ÉCRAN une
   * couche encre et une couche interface. `firstWindow()` en attrapait une au
   * hasard : une fois sur deux, ce fichier mourait au premier test en
   * attendant un canevas dans la fenêtre de la barre d'outils — un FAUX ROUGE
   * qui condamnait tout le filet de sécurité Windows. Ici on veut mesurer le
   * comportement des FENÊTRES (bounds, topmost, veille, DPI) : une seule
   * fenêtre par écran, c'est exactement ce qu'il faut. La séparation elle-même
   * a ses propres tests (test/e2e/couches.mjs).
   */
  env: { ...process.env, HEXA_FUSION: '1' },
})

const win = await app.firstWindow({ timeout: 30000 })
const erreurs = []
win.on('pageerror', (e) => erreurs.push(String(e.message)))
await win.waitForSelector('.stage canvas', { timeout: 20000 })

/** état des fenêtres overlay vu depuis le processus principal */
const overlays = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      // le bandeau d'accueil est une page data: — seules les fenêtres qui
      // portent l'interface (file://…/index.html) sont des overlays
      .filter((w) => !w.isDestroyed() && !w.webContents.getURL().startsWith('data:'))
      .map((w) => ({
        id: w.id,
        bounds: w.getBounds(),
        visible: w.isVisible(),
        topmost: w.isAlwaysOnTop(),
      })),
  )

const journal = () => {
  const p = join(USER, 'hexa.log')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
const pause = (ms) => win.waitForTimeout(ms)

/* ================================================================== *
 * 1. Démarrage : une fenêtre par écran
 * ================================================================== */
console.log('\n--- 1. Démarrage ---')
let w = await overlays()
dit('1.1 une fenêtre par écran', w.length === 1, `${w.length} overlay(s) : ${JSON.stringify(w[0]?.bounds)}`)
dit('1.2 toujours au-dessus', w[0]?.topmost === true, `isAlwaysOnTop=${w[0]?.topmost}`)
dit('1.3 aucune erreur de page', erreurs.length === 0, erreurs.join(' | ') || 'aucune')
await win.screenshot({ path: `${OUT}/01-demarrage.png` })

// fondu ∞ pour que l'encre reste, découverte guidée déjà vue
await etatDeDepart(win)

/* ================================================================== *
 * 2. DPI : le trait tombe-t-il sous le curseur ?
 * ================================================================== */
console.log('\n--- 2. DPI (échelle du système) ---')
const mesureTrait = async (X0 = 500, Y = 400, X1 = 800) => {
  const m = win.mouse
  await m.move(X0, Y)
  await m.down()
  for (let i = 1; i <= 20; i++) await m.move(X0 + ((X1 - X0) * i) / 20, Y, { steps: 1 })
  await m.up()
  await pause(500)
  return win.evaluate(() => {
    const cv = document.querySelectorAll('.stage canvas')[1]
    const r = cv.getBoundingClientRect()
    const ctx = cv.getContext('2d')
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 60) {
          n++
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    // du fond de rendu (pixels physiques) vers les pixels CSS du curseur
    const kx = r.width / cv.width
    const ky = r.height / cv.height
    return {
      dpr: window.devicePixelRatio,
      cssW: Math.round(r.width),
      cssH: Math.round(r.height),
      cvW: cv.width,
      cvH: cv.height,
      pixels: n,
      css: n ? { x0: x0 * kx, x1: x1 * kx, y0: y0 * ky, y1: y1 * ky } : null,
    }
  })
}
const t = await mesureTrait()
const cx = t.css ? (t.css.x0 + t.css.x1) / 2 : NaN
const cy = t.css ? (t.css.y0 + t.css.y1) / 2 : NaN
dit(
  '2.1 fond de rendu = CSS × dpr',
  Math.abs(t.cvW - t.cssW * t.dpr) <= 1.5,
  `dpr=${t.dpr} · CSS ${t.cssW}×${t.cssH} · canvas ${t.cvW}×${t.cvH}`,
)
/*
 * ⚠️ POURQUOI LA TOLÉRANCE EST DE 12 px ET NON DE 6.
 *
 * Le lissage du tracé (filtre 1 € — c'est lui qui supprime le tremblement de
 * la main, et hexa-e2e/flc-lissage exige qu'il agisse) fait légèrement TRAÎNER
 * la fin du geste derrière le curseur. Le centre de l'encre est donc
 * systématiquement décalé d'environ 4,5 px vers l'arrière : mesuré 645,5 pour
 * 650 attendu ici, 445,0 pour 450 en §4.3. Ce n'est pas un défaut, c'est le
 * lissage qui travaille.
 *
 * Avec 6 px de tolérance, ces tests vivaient donc à 1,5 px de l'échec — et
 * l'un d'eux est effectivement tombé une fois sur quatre lancements, machine
 * chargée, pour un centre mesuré à 444,0 au lieu de 445,0. Un test qui joue à
 * pile ou face ne vérifie rien.
 *
 * 12 px laisse passer le lissage et rattrape TOUJOURS ce que ces tests
 * cherchent vraiment : une erreur de facteur d'échelle. À 125 %, un transform
 * faux place le trait à 0,8× ou 1,25× de sa position, soit 80 à 160 px
 * d'écart sur cette géométrie — dix fois la tolérance.
 */
const TOLERANCE_CURSEUR = 12
dit(
  '2.2 trait sous le curseur (attendu centre 650,400)',
  Math.abs(cx - 650) < TOLERANCE_CURSEUR && Math.abs(cy - 400) < TOLERANCE_CURSEUR,
  `centre mesuré ${cx.toFixed(1)},${cy.toFixed(1)} · ${t.pixels} px d’encre ` +
    `(tolérance ${TOLERANCE_CURSEUR} px : le lissage fait traîner la fin du geste)`,
)
await win.screenshot({ path: `${OUT}/02-dpi-trait.png` })

/* ================================================================== *
 * 3. Écran BRANCHÉ à chaud
 * ================================================================== */
console.log('\n--- 3. Second écran branché à chaud ---')
await app.evaluate(({ screen }) => {
  const faux = {
    id: 990001,
    label: 'HEXA-TEST-2',
    bounds: { x: 1600, y: 0, width: 1280, height: 720 },
    workArea: { x: 1600, y: 0, width: 1280, height: 680 },
    workAreaSize: { width: 1280, height: 680 },
    size: { width: 1280, height: 720 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    touchSupport: 'unknown',
    accelerometerSupport: 'unknown',
    colorDepth: 24,
    colorSpace: '{}',
    depthPerComponent: 8,
    displayFrequency: 60,
    monochrome: false,
    detected: true,
    maximumCursorSize: { width: 0, height: 0 },
    nativeOrigin: { x: 1600, y: 0 },
  }
  const vrai = screen.getAllDisplays.bind(screen)
  globalThis.__vrai = vrai
  globalThis.__faux = faux
  globalThis.__actif = true
  globalThis.__patch = (m) => {
    const l = vrai().map((d) => ({ ...d, ...(m?.[d.id] ?? {}) }))
    return globalThis.__actif ? [...l, faux] : l
  }
  globalThis.__mod = null
  screen.getAllDisplays = () => globalThis.__patch(globalThis.__mod)
  screen.emit('display-added', {}, faux)
  return screen.getAllDisplays().length
}).then((n) => console.log('  (écrans vus par le main :', n, ')'))

await pause(1500)
w = await overlays()
const second = w.find((x) => x.bounds.x === 1600)
dit('3.1 un overlay créé pour le nouvel écran', w.length === 2, `${w.length} overlay(s)`)
dit(
  '3.2 posé exactement sur ses bounds',
  !!second && second.bounds.width === 1280 && second.bounds.height === 720,
  JSON.stringify(second?.bounds),
)
dit('3.3 nouvel overlay topmost', second?.topmost === true, `isAlwaysOnTop=${second?.topmost}`)

/* ================================================================== *
 * 4. Changement d'ÉCHELLE (DPI) sans changement de taille
 * ================================================================== */
console.log('\n--- 4. Passage à 125 % (échelle seule) ---')
await win.evaluate(() => {
  window.__recal = 0
  window.addEventListener('resize', () => (window.__recal = (window.__recal || 0) + 1))
})
const idReel = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().id)
await app.evaluate(({ screen }, id) => {
  globalThis.__mod = { [id]: { scaleFactor: 1.25 } }
  const d = screen.getAllDisplays().find((x) => x.id === id)
  screen.emit('display-metrics-changed', {}, d, ['scaleFactor'])
}, idReel)
await pause(1500)
const recal = await win.evaluate(() => window.__recal)
dit(
  '4.1 la page est prévenue du changement d’échelle',
  recal >= 1,
  `${recal} recalibrage(s) déclenché(s) alors que la taille en pixels CSS n’a PAS bougé`,
)
dit(
  '4.2 journalisé côté processus principal',
  /reconfiguré : scaleFactor/.test(journal()),
  journal().split('\n').filter((l) => /scaleFactor/.test(l)).slice(-1)[0] || 'absent',
)
const capt = await win.evaluate(() => {
  const l = [...document.querySelectorAll('.stage canvas')].map((c) => `${c.width}×${c.height}`)
  return l.join(' ')
})
console.log('  canvas après recalibrage :', capt)

// 4bis — LE test qui compte pour l'utilisateur : après que l'écran a été
// reconfiguré et la fenêtre reposée, le trait tombe-t-il toujours pile sous
// le curseur ?
// on repart d'un écran propre, sinon la boîte englobante mêlerait les deux traits
await toutEffacer(win)
const t2 = await mesureTrait(300, 250, 600)
const c2x = t2.css ? (t2.css.x0 + t2.css.x1) / 2 : NaN
const c2y = t2.css ? (t2.css.y0 + t2.css.y1) / 2 : NaN
dit(
  '4.3 après reconfiguration, le trait tombe encore sous le curseur',
  Math.abs(c2x - 450) < TOLERANCE_CURSEUR && Math.abs(c2y - 250) < TOLERANCE_CURSEUR,
  `geste (300,250)→(600,250) · centre mesuré ${c2x.toFixed(1)},${c2y.toFixed(1)} · ${t2.pixels} px ` +
    `(tolérance ${TOLERANCE_CURSEUR} px — voir §2.2)`,
)
await win.screenshot({ path: `${OUT}/02b-apres-reconfiguration.png` })

/* ================================================================== *
 * 5. workArea seul : DOIT être ignoré (jeu plein écran, barre des tâches)
 * ================================================================== */
console.log('\n--- 5. workArea seul (barre des tâches, jeu) ---')
const avantWA = journal().length
await app.evaluate(({ screen }, id) => {
  const d = screen.getAllDisplays().find((x) => x.id === id)
  screen.emit('display-metrics-changed', {}, d, ['workArea'])
}, idReel)
await pause(1200)
const apresWA = journal().slice(avantWA)
dit(
  '5.1 aucun repositionnement pour un simple workArea',
  !/reconfiguré|topologie mise à jour/.test(apresWA),
  apresWA.trim().split('\n').slice(-1)[0] || '(rien du tout dans le journal)',
)

/* ================================================================== *
 * 6. Écran DÉBRANCHÉ
 * ================================================================== */
console.log('\n--- 6. Second écran débranché ---')
await app.evaluate(({ screen }) => {
  globalThis.__actif = false
  globalThis.__mod = null
  screen.emit('display-removed', {}, globalThis.__faux)
})
await pause(1500)
w = await overlays()
dit('6.1 overlay fantôme supprimé', w.length === 1, `${w.length} overlay(s) restant(s)`)
dit(
  '6.2 journalisé',
  /écran 990001 débranché — overlay libéré/.test(journal()),
  journal().split('\n').filter((l) => /990001/.test(l)).slice(-1)[0] || 'absent',
)
const encreApres = (await encre(win)).statique
dit(
  '6.3 les annotations ont survécu à toute la manœuvre',
  encreApres > 2000,
  `${encreApres} px d’encre encore présents`,
)
await win.screenshot({ path: `${OUT}/03-apres-debranchement.png` })

/* ================================================================== *
 * 7. Veille / verrouillage de session
 * ================================================================== */
console.log('\n--- 7. Veille et verrouillage ---')
const visAvant = (await overlays())[0]?.visible
await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
await pause(700)
const visVeille = (await overlays())[0]?.visible
dit(
  '7.1 mise en veille : la fenêtre est rentrée',
  visAvant === true && visVeille === false,
  `visible avant=${visAvant} · pendant la veille=${visVeille}`,
)
await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
await pause(1600)
const visReveil = (await overlays())[0]?.visible
dit('7.2 réveil : la fenêtre revient', visReveil === true, `visible=${visReveil}`)
dit(
  '7.3 raccourcis globaux réenregistrés au réveil',
  /retour de session \(réveil\)/.test(journal()) &&
    journal().lastIndexOf('enregistrement global') > journal().lastIndexOf('réveil du système'),
  journal().split('\n').filter((l) => /réveil|enregistrement global/.test(l)).slice(-2).join(' || '),
)
await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
await pause(600)
const visLock = (await overlays())[0]?.visible
await app.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'))
await pause(1500)
const visUnlock = (await overlays())[0]?.visible
dit(
  '7.4 verrouillage / déverrouillage de session',
  visLock === false && visUnlock === true,
  `verrouillé=${visLock} · déverrouillé=${visUnlock}`,
)
const encreFin = (await encre(win)).statique
dit('7.5 annotations intactes après veille + verrouillage', encreFin > 1000, `${encreFin} px`)
await win.screenshot({ path: `${OUT}/04-apres-veille.png` })

/* ================================================================== *
 * 9. Fuites : trois cycles branché / débranché d'affilée
 * ================================================================== *
 * Un écran qu'on rallume, une station d'accueil qu'on rebranche : chaque
 * cycle crée et détruit une fenêtre. Si un écouteur, une minuterie ou une
 * entrée de table survit à la destruction, ça finit en overlay fantôme —
 * une fenêtre encore composée que plus personne ne peut piloter.
 */
console.log('\n--- 9. Fuites : trois cycles branché/débranché ---')
const compte = () =>
  app.evaluate(({ screen, powerMonitor, BrowserWindow }) => ({
    ecrans: screen.listenerCount('display-metrics-changed'),
    ajouts: screen.listenerCount('display-added'),
    veille: powerMonitor.listenerCount('suspend'),
    fenetres: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
  }))
const avantCycles = await compte()
for (let i = 0; i < 3; i++) {
  await app.evaluate(({ screen }) => {
    globalThis.__actif = true
    screen.emit('display-added', {}, globalThis.__faux)
  })
  await pause(1300)
  await app.evaluate(({ screen }) => {
    globalThis.__actif = false
    screen.emit('display-removed', {}, globalThis.__faux)
  })
  await pause(1300)
}
const apresCycles = await compte()
dit(
  '9.1 aucun écouteur d’écran accumulé',
  apresCycles.ecrans === avantCycles.ecrans && apresCycles.ajouts === avantCycles.ajouts,
  `metrics ${avantCycles.ecrans}→${apresCycles.ecrans} · added ${avantCycles.ajouts}→${apresCycles.ajouts}`,
)
dit(
  '9.2 aucun écouteur de veille accumulé',
  apresCycles.veille === avantCycles.veille,
  `suspend ${avantCycles.veille}→${apresCycles.veille}`,
)
dit(
  '9.3 aucune fenêtre orpheline après 3 cycles',
  apresCycles.fenetres === avantCycles.fenetres,
  `${avantCycles.fenetres} fenêtre(s) avant · ${apresCycles.fenetres} après`,
)
dit(
  '9.4 les annotations tiennent toujours',
  (await encre(win)).statique > 2000,
  `${(await encre(win)).statique} px`,
)

/* ================================================================== *
 * 8. Fermeture propre
 * ================================================================== */
console.log('\n--- 8. Fermeture ---')
dit('8.1 aucune erreur de page sur toute la campagne', erreurs.length === 0, erreurs.join(' | ') || 'aucune')
const pid = app.process().pid
const t0 = Date.now()
await app.close()
const duree = Date.now() - t0
const j = journal()
dit('8.2 fermeture rapide', duree < 5000, `${duree} ms`)
dit('8.3 journal de fermeture complet', /Hexa fermé proprement/.test(j), 'trace « Hexa fermé proprement »')
let vivant = true
try { process.kill(pid, 0) } catch { vivant = false }
dit('8.4 aucun processus zombie', !vivant, `pid ${pid} ${vivant ? 'ENCORE VIVANT' : 'terminé'}`)

console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.filter((r) => r[0] === 'OK').length} OK · ${kos.length} KO`)
if (kos.length) for (const k of kos) console.log('  KO :', k[1], '—', k[2])
process.exit(kos.length ? 1 : 0)
