#!/usr/bin/env node
/**
 * §S31 — CE QUE HEXA COÛTE À WINDOWS, SUR LE VRAI POSTE À PLUSIEURS ÉCRANS.
 *
 * Mesure du 23/10 : pendant un live, dwm.exe saturait un cœur. Hexa n'en était
 * pas la cause principale, mais il ajoutait sa part : trois fenêtres d'encre
 * plein écran, trois fenêtres d'interface, le bridage de Chromium coupé pour
 * toutes, une fenêtre de 8 × 8 au-dessus du jeu et 240 images par seconde
 * pendant un trait sur l'écran principal.
 *
 * Les autres campagnes tournent sous Xvfb, sur UN écran : elles ne voient rien
 * de tout ça. Celle-ci se lance sur le poste de l'utilisateur, tel quel, et
 * désigne les fenêtres par leur TITRE, jamais par leur rang :
 *   1. un overlay seulement sur l'écran d'annotation et celui de la barre ;
 *   2. au repos, la fenêtre d'encre est CACHÉE (pas réduite) et bridée ;
 *   3. en dessin : visible, débridée, le trait se peint ;
 *   4. pendant un trait, 60 images par seconde au plus ;
 *   5. retour au jeu, trait posé : la fenêtre reste, avec ses pixels ;
 *   6. tout effacé : cachée et bridée de nouveau ;
 *   7. elle revient dessiner après ça, sans perdre son premier trait.
 *
 *   node test/e2e/s31-ecrans-utiles.mjs
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()
const OUT = join(CAPTURES, 's31')
mkdirSync(OUT, { recursive: true })
const USER = join(OUT, '.user-data')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })

const R = []
const dit = (n, c, d) => {
  R.push([c ? 'OK' : 'KO', n, d])
  console.log(`  ${c ? 'OK ' : 'KO '}  ${n} — ${d}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
app.process().stderr?.on('data', () => {})

/** Toutes les fenêtres d'Hexa, vues par le processus principal. */
const fenetres = () =>
  app.evaluate(({ BrowserWindow, screen }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => {
        const b = w.getBounds()
        const d = screen.getDisplayMatching(b)
        return {
          titre: w.getTitle(),
          url: w.webContents.getURL().split('/').pop()?.split('?')[0] ?? '',
          visible: w.isVisible(),
          bride: w.webContents.getBackgroundThrottling(),
          b,
          ecran: d.id,
        }
      }),
  )
const encreAnnotation = async () => (await fenetres()).find((w) => w.titre === 'Hexa Overlay')

// La page de la couche encre de l'écran d'annotation. ⚠️ Ni le rang, ni
// l'URL (toutes les couches encre chargent la même), ni le titre (toutes
// s'appellent « Hexa Overlay » avant que retitrer() passe) : la page le sait
// elle-même, par son argument de lancement --hexa-annotation.
let encre = null
for (let i = 0; i < 60 && !encre; i++) {
  await pause(300)
  for (const p of app.windows()) {
    if (!p.url().includes('index.html')) continue
    if (await p.evaluate(() => window.hexa?.ecranAnnotation === true).catch(() => false)) encre = p
  }
}
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await encre.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
  s.state = { ...(s.state ?? {}), fadeDelay: null, onboarded: true, sounds: false }
  localStorage.setItem('hexa-ui', JSON.stringify(s))
})
await encre.reload()
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
// La page rechargée renvoie l'écho de son état initial : on le laisse passer.
await pause(1500)

const pixels = () =>
  encre.evaluate(() => {
    let total = 0
    for (const c of document.querySelectorAll('canvas')) {
      if (c.width === 0 || c.height === 0) continue
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < d.length; i += 4 * 53) if (d[i] > 8) total++
    }
    return total
  })
/** Amène l'écran d'annotation dans le mode voulu, d'après l'état RÉEL du principal. */
const modeDessin = async (voulu) => {
  const lire = () => encre.evaluate(() => window.hexa.modeDessin())
  for (let i = 0; i < 3; i++) {
    if ((await lire()) === voulu) return
    await encre.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })))
    const t0 = Date.now()
    while (Date.now() - t0 < 1500 && (await lire()) !== voulu) await pause(50)
  }
}
const attendreCachee = async (max = 4000) => {
  const t0 = Date.now()
  let e = await encreAnnotation()
  while (e?.visible && Date.now() - t0 < max) {
    await pause(150)
    e = await encreAnnotation()
  }
  return e
}

/* --- 1. un overlay là où il sert ------------------------------------------ */
console.log('\n--- 1. Écrans ---')
{
  // l'accueil (12 s au tout premier lancement) doit être passé ; le
  // rechargement a pu remettre la page en dessin, on la rend au jeu
  await attendreCachee(16000)
  await modeDessin(false)
  await attendreCachee()
  const ecrans = await app.evaluate(({ screen }) => screen.getAllDisplays().length)
  const f = await fenetres()
  const encres = f.filter((w) => w.url === 'index.html')
  const interfaces = f.filter((w) => w.url === 'ui.html')
  const ecransAvecOverlay = new Set(encres.map((w) => w.ecran)).size
  dit(
    '1.1 au plus deux écrans portent un overlay',
    ecransAvecOverlay <= Math.min(2, ecrans) && ecransAvecOverlay >= 1,
    `${ecrans} écran(s) · ${encres.length} encre(s) · ${interfaces.length} interface(s) · ${ecransAvecOverlay} écran(s) équipé(s)`,
  )
  const inactives = encres.filter((w) => w.titre !== 'Hexa Overlay')
  dit(
    '1.2 l’encre de l’écran de la barre (s’il diffère) : cachée, inactive, bridée',
    inactives.every((w) => !w.visible && w.bride && /inactif/.test(w.titre)),
    inactives.length ? inactives.map((w) => `« ${w.titre} » visible=${w.visible} bridée=${w.bride}`).join(' ; ') : 'aucune (même écran)',
  )
}

/* --- 2. au repos ---------------------------------------------------------- */
console.log('\n--- 2. Repos ---')
{
  const e = await attendreCachee()
  dit('2.1 fenêtre d’encre CACHÉE au repos (pas réduite à 8 × 8)', e && !e.visible, `visible=${e?.visible} ${e?.b.width}×${e?.b.height}`)
  dit('2.2 bridée au repos', e?.bride === true, `bridée=${e?.bride}`)
}

/* --- 3 et 4. en dessin ---------------------------------------------------- */
console.log('\n--- 3. Dessin ---')
{
  await modeDessin(true)
  await pause(300)
  const e = await encreAnnotation()
  dit('3.1 en dessin : visible et débridée', e?.visible === true && e?.bride === false, `visible=${e?.visible} bridée=${e?.bride}`)
  // On compte les images RÉELLEMENT peintes : chaque image du moteur commence
  // par effacer le canevas vivant.
  await encre.evaluate(() => {
    const g = window
    g.__peintes = []
    const vrai = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...a) {
      if (this.canvas.width > 0) g.__peintes.push(performance.now())
      return vrai.apply(this, a)
    }
  })
  const m = encre.mouse
  await m.move(300, 400)
  await m.down()
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < 2000) {
    i++
    await m.move(300 + (i % 200) * 3, 400 + Math.sin(i / 9) * 120)
  }
  await m.up()
  const images = await encre.evaluate(() => {
    const t = window.__peintes
    // une même image efface plusieurs canevas, à quelques dixièmes de
    // milliseconde d'écart : on regroupe ce qui tombe à moins de 3 ms
    const images = []
    for (const x of t) if (!images.length || x - images[images.length - 1] > 3) images.push(x)
    const duree = (images[images.length - 1] - images[0]) / 1000
    return { n: images.length, duree }
  })
  const ips = images.duree > 0 ? (images.n - 1) / images.duree : 0
  const hz = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().displayFrequency)
  dit('3.2 le trait se peint', (await pixels()) > 100, `${await pixels()} échantillons d’encre`)
  dit(
    '4.1 pendant le trait : 60 images par seconde au plus',
    ips > 20 && ips <= 66,
    `${Math.round(ips)} images/s (${images.n} en ${images.duree.toFixed(1)} s) sur un écran à ${hz} Hz · ${i} mouvements de souris`,
  )
}

/* --- 5. retour au jeu, trait posé ----------------------------------------- */
console.log('\n--- 5. Retour au jeu ---')
{
  await modeDessin(false)
  await pause(800)
  const e = await encreAnnotation()
  const px = await pixels()
  dit('5.1 le trait reste à l’écran (fenêtre visible, pixels intacts)', e?.visible === true && px > 100, `visible=${e?.visible} · ${px} échantillons`)
  dit('5.2 rebridée hors dessin', e?.bride === true, `bridée=${e?.bride}`)
  await encre.screenshot({ path: join(OUT, 's31-5-trait-pose.png') })
}

/* --- 6. tout effacé ------------------------------------------------------- */
console.log('\n--- 6. Tout effacé ---')
{
  await modeDessin(true)
  await encre.keyboard.press('c')
  await pause(300)
  await modeDessin(false)
  const e = await attendreCachee()
  dit('6.1 tout effacé : cachée et bridée', e && !e.visible && e.bride, `visible=${e?.visible} bridée=${e?.bride}`)
}

/* --- 7. et elle revient --------------------------------------------------- */
console.log('\n--- 7. Retour au dessin ---')
{
  await modeDessin(true)
  await pause(200)
  const m = encre.mouse
  await m.move(700, 300)
  await m.down()
  for (let k = 1; k <= 30; k++) await m.move(700 + k * 10, 300 + k * 4, { steps: 2 })
  await m.up()
  await pause(400)
  const px = await pixels()
  dit('7.1 après une mise en veille de la couche, le premier trait se peint', px > 50, `${px} échantillons`)
  await modeDessin(false)
}

await app.close().catch(() => {})
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
