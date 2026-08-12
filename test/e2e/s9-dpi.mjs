/**
 * S9 — MISE À L'ÉCHELLE WINDOWS : le trait tombe-t-il EXACTEMENT sous le curseur
 * à 100 %, 125 %, 150 % et 200 % ?
 *
 * C'est la panne silencieuse la plus vicieuse d'un outil d'annotation : sur un
 * portable configuré à 125 % (le réglage d'usine de la plupart des PC vendus
 * aujourd'hui), un décalage de quelques pixels entre le curseur et l'encre rend
 * l'outil inutilisable — et l'utilisateur, incapable de nommer le problème,
 * conclut simplement que « ça dessine mal ».
 *
 * Protocole : chaque échelle relance une VRAIE application Electron avec
 * --force-device-scale-factor, trace un trait horizontal entre deux points
 * donnés en pixels CSS (exactement les coordonnées de la souris), puis relit
 * les pixels réellement peints dans le fond de rendu et les reconvertit en
 * pixels CSS. On compare au geste demandé.
 *
 *   node test/e2e/s9-dpi.mjs
 *
 * Sortie 1 si une échelle décale le trait. Prérequis :
 *   npm run build && npm run build:main
 */
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { etatDeDepart, CAPTURES, RACINE, chargerPilote } from './harness.mjs'

// Playwright n'est pas une dépendance d'Hexa : le harnais sait où le trouver.
const electron = await chargerPilote()

const OUT = join(CAPTURES, 's9')
mkdirSync(OUT, { recursive: true })

/** tolérance : le lissage One Euro raccourcit légèrement la fin du geste */
const TOLERANCE = 6

async function essai(echelle) {
  const suffixe = String(echelle).replace('.', '_')
  const USER = join(OUT, `.ud-dpi-${suffixe}`)
  rmSync(USER, { recursive: true, force: true })
  mkdirSync(USER, { recursive: true })

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${USER}`, `--force-device-scale-factor=${echelle}`],
    cwd: RACINE,
    executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
    timeout: 60000,
  })
  const win = await app.firstWindow({ timeout: 30000 })
  const err = []
  win.on('pageerror', (e) => err.push(String(e.message)))
  await win.waitForSelector('.stage canvas', { timeout: 20000 })
  await etatDeDepart(win)

  const ecran = await app.evaluate(({ screen }) => {
    const d = screen.getPrimaryDisplay()
    return { bounds: d.bounds, scaleFactor: d.scaleFactor }
  })

  // Coordonnées relatives au viewport : à 200 %, la page ne fait plus que
  // 800×450 pixels CSS et un point fixe finirait sur la barre d'outils.
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const X0 = Math.round(vp.w * 0.25)
  const X1 = Math.round(vp.w * 0.6)
  const Y = Math.round(vp.h * 0.28)
  const m = win.mouse
  await m.move(X0, Y)
  await m.down()
  for (let i = 1; i <= 20; i++) await m.move(X0 + ((X1 - X0) * i) / 20, Y, { steps: 1 })
  await m.up()
  await win.waitForTimeout(600)

  const mes = await win.evaluate(() => {
    // ordre du DOM : voile (spotlight) · STATIQUE (annotations) · vif (geste)
    const cv = document.querySelectorAll('.stage canvas')[1]
    const r = cv.getBoundingClientRect()
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let x0 = 1e9
    let y0 = 1e9
    let x1 = -1
    let y1 = -1
    let n = 0
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
    // du fond de rendu (pixels physiques) vers les pixels CSS de la souris
    const kx = r.width / cv.width
    const ky = r.height / cv.height
    return {
      dpr: window.devicePixelRatio,
      css: { w: Math.round(r.width), h: Math.round(r.height) },
      fond: { w: cv.width, h: cv.height },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      pixels: n,
      boite: n ? { x0: x0 * kx, x1: x1 * kx, y0: y0 * ky, y1: y1 * ky } : null,
    }
  })
  await win.screenshot({ path: join(OUT, `dpi-${suffixe}.png`) })
  await app.close()

  const cx = mes.boite ? (mes.boite.x0 + mes.boite.x1) / 2 : NaN
  const cy = mes.boite ? (mes.boite.y0 + mes.boite.y1) / 2 : NaN
  const dx = cx - (X0 + X1) / 2
  const dy = cy - Y
  // Le fond de rendu doit valoir la taille CSS multipliée par le rapport de
  // pixels : c'est CE rapport qui aligne l'encre sur le curseur.
  const fondJuste = Math.abs(mes.fond.w - mes.css.w * mes.dpr) <= 1.5
  const sousCurseur = Math.abs(dx) < TOLERANCE && Math.abs(dy) < TOLERANCE

  console.log(
    `\néchelle ${echelle} → devicePixelRatio ${mes.dpr} · écran ` +
      `${ecran.bounds.width}×${ecran.bounds.height} DIP (facteur ${ecran.scaleFactor}) · ` +
      `page ${mes.viewport.w}×${mes.viewport.h} CSS · fond de rendu ${mes.fond.w}×${mes.fond.h}`,
  )
  console.log(
    `   geste (${X0},${Y}) → (${X1},${Y}) · encre de x=${mes.boite?.x0.toFixed(1)} ` +
      `à x=${mes.boite?.x1.toFixed(1)} · ${mes.pixels} px peints`,
  )
  console.log(
    `   centre de l’encre ${cx.toFixed(1)},${cy.toFixed(1)} — écart ${dx.toFixed(1)},${dy.toFixed(1)} px CSS` +
      ` · ${fondJuste ? 'fond = CSS × dpr ✔' : 'FOND DE RENDU FAUX'}` +
      ` · ${sousCurseur ? 'SOUS LE CURSEUR ✔' : 'DÉCALÉ ✘'}` +
      `${err.length ? ' · ERREURS : ' + err.join(' | ') : ''}`,
  )
  return sousCurseur && fondJuste && err.length === 0
}

let tout = true
for (const e of [1, 1.25, 1.5, 2]) tout = (await essai(e)) && tout
console.log(
  tout
    ? '\nTOUTES LES ÉCHELLES : le trait tombe exactement sous le curseur.'
    : '\nÉCHEC : au moins une échelle décale le trait.',
)
process.exit(tout ? 0 : 1)
