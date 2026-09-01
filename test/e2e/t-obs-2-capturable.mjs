#!/usr/bin/env node
/**
 * T-OBS-2 — LA FENÊTRE D'ENCRE RESTE CAPTURABLE PAR OBS, SANS COÛTER AU JEU.
 *
 * Réponse au « ça affiche ma page Twitch sur OBS » : vide, la couche encre
 * n'est plus CACHÉE (OBS la perdait, voir t-obs-1-disparition.mjs) mais
 * RÉDUITE à 8 × 8 pixels dans le coin de son écran — toujours visible pour
 * Windows, donc pour OBS, et 64 pixels à composer au lieu de 2 073 600.
 *
 * Ce que ce script prouve, sur la vraie application, deux fenêtres par écran :
 *   1. au repos, la fenêtre d'encre est VISIBLE et fait 8 × 8 ;
 *   2. elle reprend l'écran entier au F8, en quelques millisecondes, et la
 *      page suit (innerWidth) ; l'encre se peint au bon endroit ensuite ;
 *   3. effacement, fondu, annotations masquées : réduite, jamais cachée ;
 *   4. veille : cachée (surface à ne pas perdre), réveil : réduite et visible ;
 *   5. un écran branché à chaud, non désigné : caché, titré « inactif », et la
 *      fenêtre réduite n'est pas reposée en plein écran par l'événement ;
 *   6. AU REPOS, AUCUNE BOUCLE : 0 setBounds, 0 hide, 0 show en 5 s ;
 *   7. le réglage « Garder la fenêtre capturable » se coupe et se rétablit à
 *      chaud, et survit au redémarrage (fichier reglages-principal.json) ;
 *   8. les annotations survivent à un cycle réduit → plein écran (aucun pixel
 *      perdu après « annotations masquées » puis réaffichées).
 *
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/t-obs-2-capturable.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()
const OUT = join(CAPTURES, 't-obs-2')
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

await app.evaluate(({ BrowserWindow, app: electronApp }) => {
  const g = globalThis
  g.__t = { appels: [] }
  const espionner = (w) => {
    for (const m of ['hide', 'show', 'showInactive', 'setBounds', 'setAlwaysOnTop']) {
      const orig = w[m].bind(w)
      w[m] = (...a) => {
        g.__t.appels.push({ t: Date.now(), fen: w.getTitle(), m, a: m === 'setBounds' ? a[0] : undefined })
        return orig(...a)
      }
    }
  }
  BrowserWindow.getAllWindows().forEach(espionner)
  electronApp.on('browser-window-created', (_e, w) => espionner(w))
})

const fenetres = () =>
  app.evaluate(({ BrowserWindow, screen }) => ({
    ecran: screen.getPrimaryDisplay().bounds,
    liste: BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => ({
        titre: w.getTitle(),
        url: w.webContents.getURL().split('/').pop()?.split('?')[0] ?? '',
        visible: w.isVisible(),
        b: w.getBounds(),
      })),
  }))
/** État de la couche encre de l'écran d'annotation. */
const etatEncre = async () => {
  const f = await fenetres()
  const e = f.liste.find((w) => w.titre === 'Hexa Overlay')
  if (!e) return { visible: null, b: null, reduite: false, pleine: false, ecran: f.ecran }
  const reduite = e.visible && e.b.width === 8 && e.b.height === 8
  const pleine = e.b.width === f.ecran.width && e.b.height === f.ecran.height
  return { visible: e.visible, b: e.b, reduite, pleine, ecran: f.ecran }
}
const fmt = (e) => `visible=${e.visible} ${e.b ? `${e.b.width}×${e.b.height}@${e.b.x},${e.b.y}` : '?'}`

let encre = null
let inter = null
for (let i = 0; i < 40 && !(encre && inter); i++) {
  await pause(400)
  encre = app.windows().find((w) => w.url().includes('index.html'))
  inter = app.windows().find((w) => w.url().includes('ui.html'))
}
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await inter.waitForSelector('.toolbar', { timeout: 20000 })
for (const w of [encre, inter]) {
  await w.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    s.state = {
      ...(s.state ?? {}),
      onboarded: true,
      fadeDelay: null,
      toolbarVisible: true,
      globalShortcutsOn: false,
      globalShortcutsChosen: true,
      keymapPreset: 'epicpen',
      keymapPresetChosen: true,
    }
    localStorage.setItem('hexa-ui', JSON.stringify(s))
  })
}
await encre.reload()
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await inter.reload()
await inter.waitForSelector('.toolbar', { timeout: 20000 })
await pause(1000)

const f8 = async () => {
  await encre.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })))
  await pause(600)
}
const modeDessin = async (voulu) => {
  for (let i = 0; i < 3; i++) {
    const actuel = await encre.evaluate(() => window.hexa.modeDessin())
    if (actuel === voulu) return
    await f8()
  }
}
const trait = async (y = 400) => {
  const m = encre.mouse
  await m.move(400, y)
  await m.down()
  for (let i = 1; i <= 20; i++) await m.move(400 + i * 20, y + Math.sin(i / 3) * 40, { steps: 2 })
  await m.up()
  await pause(400)
}
/** pixels d'encre sur le canevas statique (annotations posées) */
const pixels = () =>
  encre.evaluate(() => {
    const cv = document.querySelectorAll('.stage canvas')[1]
    const ctx = cv?.getContext('2d')
    if (!ctx || cv.width === 0 || cv.height === 0) return 0
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 8) n++
    return n
  })
/** attend que la couche encre soit réduite (délai de grâce 300 ms compris) */
const attendreReduite = async (max = 3000) => {
  const t0 = Date.now()
  let e = await etatEncre()
  while (!e.reduite && Date.now() - t0 < max) {
    await pause(80)
    e = await etatEncre()
  }
  return e
}

/* --- 1. au repos : visible, 8 × 8, dans le coin ---------------------------- */
console.log('\n--- 1. Au repos, une fois l’accueil terminé ---')
{
  const e = await attendreReduite(12000)
  dit(
    '1.1 la fenêtre d’encre reste VISIBLE, réduite à 8 × 8',
    e.reduite,
    `${fmt(e)} — OBS la voit toujours (IsWindowVisible), 64 px composés`,
  )
  dit(
    '1.2 posée dans le coin inférieur droit de SON écran',
    !!e.b && e.b.x === e.ecran.x + e.ecran.width - 8 && e.b.y === e.ecran.y + e.ecran.height - 8,
    `@${e.b?.x},${e.b?.y} pour un écran ${e.ecran.width}×${e.ecran.height}`,
  )
  const page = await encre.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  dit('1.3 la page a suivi : viewport 8 × 8', page.w === 8 && page.h === 8, `innerWidth=${page.w} innerHeight=${page.h}`)
  const cv = await encre.evaluate(() => [...document.querySelectorAll('.stage canvas')].map((c) => `${c.width}×${c.height}`).join(' '))
  console.log(`  canevas pendant la réduction : ${cv}`)
}

/* --- 2. F8 : retour plein écran instantané --------------------------------- */
console.log('\n--- 2. F8 : retour au plein écran ---')
{
  const t0 = Date.now()
  await encre.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })))
  let e = await etatEncre()
  let tBounds = -1
  while (Date.now() - t0 < 3000) {
    if (e.pleine) {
      tBounds = Date.now() - t0
      break
    }
    await pause(5)
    e = await etatEncre()
  }
  let tPage = -1
  while (Date.now() - t0 < 3000) {
    const p = await encre.evaluate(() => window.innerWidth)
    if (p === e.ecran.width) {
      tPage = Date.now() - t0
      break
    }
    await pause(5)
  }
  dit(
    '2.1 bounds plein écran reposées au F8',
    tBounds >= 0 && tBounds < 400,
    `${tBounds} ms entre la touche et des bounds ${e.b?.width}×${e.b?.height} (mesure IPC comprise)`,
  )
  dit('2.2 la page a repris tout l’écran', tPage >= 0 && tPage < 600, `${tPage} ms jusqu’à innerWidth=${e.ecran.width}`)
  await pause(300)
  await trait(400)
  const px = await pixels()
  dit('2.3 un trait se peint normalement après le retour', px > 100, `${px} échantillons d’encre`)
  await encre.screenshot({ path: join(OUT, '02-apres-retour.png') })
}

/* --- 3. effacé, fondu, masqué : réduite, jamais cachée --------------------- */
console.log('\n--- 3. Vide de nouveau : réduite, pas cachée ---')
{
  await modeDessin(false)
  await pause(500)
  const avecTrait = await etatEncre()
  dit('3.1 trait à l’écran, retour au jeu : plein écran visible', avecTrait.visible && avecTrait.pleine, fmt(avecTrait))
  await modeDessin(true)
  await encre.keyboard.press('c')
  await modeDessin(false)
  const efface = await attendreReduite()
  dit('3.2 tout effacé : réduite (et non cachée)', efface.reduite, fmt(efface))

  // fondu 2 s
  await encre.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    s.state = { ...(s.state ?? {}), fadeDelay: 2000 }
    localStorage.setItem('hexa-ui', JSON.stringify(s))
  })
  await encre.reload()
  await encre.waitForSelector('.stage canvas', { timeout: 20000 })
  await pause(800)
  await modeDessin(true)
  await trait(300)
  await modeDessin(false)
  await pause(300)
  const pendant = await etatEncre()
  const apres = await attendreReduite(6000)
  dit('3.3 fondu : plein écran pendant, réduite après', pendant.pleine && pendant.visible && apres.reduite, `pendant ${fmt(pendant)} → après ${fmt(apres)}`)
  await encre.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    s.state = { ...(s.state ?? {}), fadeDelay: null }
    localStorage.setItem('hexa-ui', JSON.stringify(s))
  })
  await encre.reload()
  await encre.waitForSelector('.stage canvas', { timeout: 20000 })
  await pause(800)

  // annotations masquées, puis réaffichées : les pixels reviennent à l'identique
  await modeDessin(true)
  await trait(500)
  await pause(300)
  const avant = await pixels()
  await encre.keyboard.press('Control+Shift+m')
  await modeDessin(false)
  const masque = await attendreReduite()
  dit('3.4 annotations masquées + jeu : réduite', masque.reduite, fmt(masque))
  await modeDessin(true)
  await encre.keyboard.press('Control+Shift+m')
  await pause(700)
  const revenu = await etatEncre()
  const apresPx = await pixels()
  dit(
    '3.5 réaffichées : plein écran, et les mêmes pixels qu’avant le cycle 8×8',
    revenu.pleine && revenu.visible && avant > 100 && Math.abs(apresPx - avant) <= Math.max(3, avant * 0.02),
    `${fmt(revenu)} · encre ${avant} → ${apresPx}`,
  )
  await encre.screenshot({ path: join(OUT, '03-apres-cycle.png') })
  await modeDessin(false)
}

/* --- 4. veille ------------------------------------------------------------- */
console.log('\n--- 4. Veille et réveil ---')
{
  await modeDessin(true)
  await encre.keyboard.press('c')
  await modeDessin(false)
  await attendreReduite()
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
  await pause(700)
  const veille = await etatEncre()
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
  await pause(2500)
  const reveil = await attendreReduite()
  dit(
    '4.1 veille : CACHÉE (surface Direct3D à ne pas perdre) ; réveil : réduite et VISIBLE',
    veille.visible === false && reveil.reduite,
    `veille ${fmt(veille)} → réveil ${fmt(reveil)}`,
  )
}

/* --- 5. écran branché à chaud, non désigné --------------------------------- */
console.log('\n--- 5. Second écran, non désigné ---')
{
  await app.evaluate(() => globalThis.__t.appels.splice(0))
  await app.evaluate(({ screen }) => {
    const faux = {
      id: 424242,
      bounds: { x: 1600, y: 0, width: 1280, height: 720 },
      workArea: { x: 1600, y: 0, width: 1280, height: 720 },
      workAreaSize: { width: 1280, height: 720 },
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
    screen.getAllDisplays = () => [...vrai(), faux]
    screen.emit('display-added', {}, faux)
  })
  await pause(2200)
  const f = await fenetres()
  const second = f.liste.find((w) => w.b.x >= 1600 && w.url === 'index.html')
  dit(
    '5.1 l’écran non désigné : fenêtre d’encre CACHÉE, titrée « inactif »',
    !!second && second.visible === false && /inactif/.test(second.titre),
    second ? `« ${second.titre} » visible=${second.visible}` : 'aucune fenêtre créée',
  )
  const principale = await etatEncre()
  const poses = (await app.evaluate(() => globalThis.__t.appels)).filter((a) => a.fen === 'Hexa Overlay' && a.m === 'setBounds')
  dit(
    '5.2 l’événement d’écran n’a PAS reposé la fenêtre réduite en plein écran',
    principale.reduite && poses.length === 0,
    `${fmt(principale)} · ${poses.length} setBounds sur « Hexa Overlay » pendant le branchement`,
  )
}

/* --- 6. au repos : aucune boucle ------------------------------------------- */
console.log('\n--- 6. Cinq secondes d’immobilité ---')
{
  await app.evaluate(() => globalThis.__t.appels.splice(0))
  await pause(5000)
  const appels = (await app.evaluate(() => globalThis.__t.appels)).filter((a) => a.fen === 'Hexa Overlay')
  dit(
    '6.1 0 setBounds, 0 hide, 0 show sur la fenêtre d’encre en 5 s',
    appels.length === 0,
    appels.length === 0 ? 'rien — la réduction est un état, pas une boucle' : appels.map((a) => a.m).join(' '),
  )
}

/* --- 7. le réglage, à chaud et au redémarrage ------------------------------ */
console.log('\n--- 7. « Garder la fenêtre capturable par OBS » ---')
{
  const lu = await inter.evaluate(() => window.hexa.captureFenetre())
  dit('7.1 lecture depuis la fenêtre d’interface', lu?.on === true && lu?.titre === 'Hexa Overlay' && lu?.reduitPx === 8, JSON.stringify(lu))
  const off = await inter.evaluate(() => window.hexa.captureFenetre(false))
  await pause(500)
  const cachee = await etatEncre()
  dit('7.2 coupé : la fenêtre vide se cache (comportement hérité)', off?.on === false && cachee.visible === false, fmt(cachee))
  const on = await inter.evaluate(() => window.hexa.captureFenetre(true))
  await pause(500)
  const revenue = await attendreReduite()
  dit('7.3 rétabli : elle revient, réduite', on?.on === true && revenue.reduite, fmt(revenue))
  const fichier = join(USER, 'reglages-principal.json')
  const persist = existsSync(fichier) ? JSON.parse(readFileSync(fichier, 'utf8')) : null
  dit('7.4 persisté dans reglages-principal.json', persist?.captureFenetre === true, JSON.stringify(persist))
  // et la valeur « coupé » survit au redémarrage : on l'écrit, on relance
  await inter.evaluate(() => window.hexa.captureFenetre(false))
  await pause(300)
}
await app.close().catch(() => {})

{
  const app2 = await electron.launch({
    args: ['.', `--user-data-dir=${USER}`],
    cwd: RACINE,
    executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
    timeout: 60000,
  })
  app2.process().stderr?.on('data', () => {})
  let e2 = null
  for (let i = 0; i < 40 && !e2; i++) {
    await pause(400)
    e2 = app2.windows().find((w) => w.url().includes('index.html'))
  }
  await e2.waitForSelector('.stage canvas', { timeout: 20000 })
  // l'accueil (4,2 s) rend la main, puis la fenêtre vide doit être CACHÉE
  let cachee = null
  for (let i = 0; i < 30; i++) {
    cachee = await app2.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === 'Hexa Overlay')
      return w ? { visible: w.isVisible(), b: w.getBounds() } : null
    })
    if (cachee && !cachee.visible) break
    await pause(500)
  }
  dit('7.5 après redémarrage avec le réglage coupé : fenêtre vide cachée', cachee?.visible === false, JSON.stringify(cachee))
  writeFileSync(join(OUT, 'appels.json'), JSON.stringify(await app2.evaluate(() => 1)))
  await app2.close().catch(() => {})
}

console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
