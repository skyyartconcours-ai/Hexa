#!/usr/bin/env node
/**
 * §S33 — CTRL+MAJ+4 : LES PETITES PASTILLES, POUR LA MINIMAP.
 *
 * Demande de l'utilisateur (25/10) : « quand j'appuie sur Ctrl + Maj + 4, que
 * ce soit comme Ctrl + Maj + 1 mais avec des ronds plus petits, adaptés à la
 * map de LoL ». Ctrl+Maj+4 était le surligneur : il garde « s ».
 *
 * La couche encre RÉELLE (dist/index.html) est chargée dans une fenêtre
 * Electron HORS ÉCRAN : rien ne s'affiche, aucun raccourci n'est réservé
 * auprès de Windows — ce script peut tourner pendant que l'utilisateur
 * dessine dans son Hexa. Il exige :
 *   1. Ctrl+Maj+4 sort le numéroteur en petites pastilles ;
 *   2. une petite pastille est réellement plus petite (un peu plus de la
 *      moitié du rayon — en dessous, le chiffre ne se lit plus) ;
 *   3. la numérotation est PARTAGÉE avec Ctrl+Maj+1 (1, 2 petites → 3 grande) ;
 *   4. une flèche ne relie que deux pastilles de MÊME taille ;
 *   5. Ctrl+Maj+1 revient aux grandes pastilles, « s » au surligneur ;
 *   6. Ctrl+Z retire une petite pastille et le numéro suivant suit.
 *
 *   npm run build && node test/e2e/s33-petites-pastilles.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()
const OUT = join(CAPTURES, 's33')
mkdirSync(OUT, { recursive: true })
const USER = join(OUT, '.user-data')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })
const MAIN = join(OUT, 'hors-ecran.cjs')
writeFileSync(
  MAIN,
  `const { app, BrowserWindow } = require('electron')
const path = require('path')
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1600, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
  w.webContents.setFrameRate(60)
  w.loadFile(path.join(process.env.HEXA_RACINE, 'dist', 'index.html'))
})
app.on('window-all-closed', () => {})
`,
)

const R = []
const dit = (n, c, d) => {
  R.push([c ? 'OK' : 'KO', n, d])
  console.log(`  ${c ? 'OK ' : 'KO '}  ${n} — ${d}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  args: [MAIN, `--user-data-dir=${USER}`],
  env: { ...process.env, HEXA_RACINE: RACINE },
  timeout: 60000,
})
const page = await app.firstWindow()
await page.waitForSelector('.stage canvas', { timeout: 20000 })
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
  s.state = { ...(s.state ?? {}), onboarded: true, sounds: false, fadeDelay: null, linkBadges: true, keymapPreset: 'epicpen' }
  localStorage.setItem('hexa-ui', JSON.stringify(s))
})
await page.reload()
await page.waitForSelector('.stage canvas', { timeout: 20000 })
await pause(1200)

const outil = () => page.evaluate(() => document.querySelector('.stage')?.dataset.tool ?? '?')
const pastilles = () =>
  page.evaluate(() =>
    (window.hexaEngine?.exportSession?.().strokes ?? [])
      .filter((s) => s.tool === 'badge')
      .map((s) => ({ n: s.badge, mini: s.mini === true, lien: s.linkFrom != null, id: s.id, x: s.points[0].x, y: s.points[0].y })),
  )
/** rayon réellement peint autour d'un centre : premier pixel transparent vers la droite */
const rayonPeint = (x, y) =>
  page.evaluate(([cx, cy]) => {
    const cv = document.querySelectorAll('.stage canvas')[1]
    const ctx = cv.getContext('2d')
    const dpr = cv.width / cv.getBoundingClientRect().width
    const ligne = ctx.getImageData(Math.round(cx * dpr), Math.round(cy * dpr), Math.round(60 * dpr), 1).data
    // le disque est opaque (alpha > 200) ; le halo, lui, est léger
    let r = 0
    for (let i = 0; i < ligne.length / 4; i++) if (ligne[i * 4 + 3] > 200) r = i
    return r / dpr
  }, [x, y])

/* --- 1. Ctrl+Maj+4 ---------------------------------------------------------- */
console.log('\n--- 1. Ctrl+Maj+4 ---')
await page.keyboard.press('Control+Shift+4')
await pause(200)
dit('1.1 Ctrl+Maj+4 sort le numéroteur', (await outil()) === 'badge', `outil ${await outil()}`)
await page.mouse.click(400, 300)
await pause(150)
await page.mouse.click(520, 330)
await pause(600)

/* --- 2 et 3. taille, numéros partagés ------------------------------------- */
console.log('\n--- 2. Petites, puis une grande ---')
await page.keyboard.press('Control+Shift+1')
await pause(200)
await page.mouse.click(900, 500)
await pause(600)
const p = await pastilles()
dit('2.1 deux petites pastilles puis une grande', p.length === 3 && p[0].mini && p[1].mini && !p[2].mini, JSON.stringify(p.map((x) => ({ n: x.n, mini: x.mini }))))
const rPetite = await rayonPeint(p[0].x, p[0].y)
const rGrande = await rayonPeint(p[2].x, p[2].y)
dit(
  '2.2 la petite est nettement plus petite (45 à 65 % du rayon peint)',
  rGrande > 0 && rPetite / rGrande >= 0.45 && rPetite / rGrande <= 0.65,
  `rayon peint : petite ${rPetite.toFixed(1)} px · grande ${rGrande.toFixed(1)} px (${Math.round((100 * rPetite) / rGrande)} %)`,
)
dit('3.1 numérotation partagée : 1, 2 (petites) puis 3 (grande)', p.map((x) => x.n).join(',') === '1,2,3', p.map((x) => x.n).join(','))

/* --- 4. les liens ---------------------------------------------------------- */
dit(
  '4.1 la 2e petite est reliée à la 1re ; la grande n’est PAS reliée à une petite',
  !p[0].lien && p[1].lien && !p[2].lien,
  `liens : ${p.map((x) => (x.lien ? 'oui' : 'non')).join(', ')}`,
)

/* --- 5. retour aux autres outils ------------------------------------------- */
console.log('\n--- 5. Retour ---')
await page.mouse.click(1000, 560)
await pause(400)
const p2 = await pastilles()
dit('5.1 après Ctrl+Maj+1, les pastilles sont grandes', p2.length === 4 && !p2[3].mini && p2[3].lien, JSON.stringify(p2[3]))
await page.keyboard.press('s')
await pause(200)
dit('5.2 « s » sort toujours le surligneur', (await outil()) === 'highlight', `outil ${await outil()}`)
await page.keyboard.press('Control+Shift+4')
await pause(200)
const mini = await page.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state.badgeMini)
dit('5.3 Ctrl+Maj+4 ne sort plus le surligneur', (await outil()) === 'badge', `outil ${await outil()} (badgeMini persisté : ${mini})`)

/* --- 6. annuler ------------------------------------------------------------ */
console.log('\n--- 6. Annuler ---')
await page.mouse.click(300, 700)
await pause(400)
const avant = (await pastilles()).length
await page.keyboard.press('Control+z')
await pause(400)
const apres = await pastilles()
await page.mouse.click(350, 720)
await pause(400)
const fin = await pastilles()
dit(
  '6.1 Ctrl+Z retire la petite pastille, et la suivante reprend son numéro',
  apres.length === avant - 1 && fin[fin.length - 1].n === avant && fin[fin.length - 1].mini,
  `avant ${avant} · après Ctrl+Z ${apres.length} · nouvelle n°${fin[fin.length - 1]?.n} mini=${fin[fin.length - 1]?.mini}`,
)
await page.screenshot({ path: join(OUT, 's33-pastilles.png') })

await app.close()
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
