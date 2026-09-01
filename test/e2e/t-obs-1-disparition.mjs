#!/usr/bin/env node
/**
 * T-OBS-1 — « OBS AFFICHE MA PAGE TWITCH » : INSTRUCTION DE LA PISTE.
 *
 * Retour utilisateur, mot pour mot : « parfois quand je l'affiche en stream je
 * ne peux pas afficher l'outil et ça affiche ma page Twitch sur OBS ».
 *
 * La piste : la « Capture de fenêtre » d'OBS retrouve sa fenêtre par TITRE,
 * puis, à défaut, par CLASSE Win32 (règle par défaut « faire correspondre le
 * titre, sinon trouver une fenêtre du même type »). Toutes les fenêtres
 * Electron portent la classe « Chrome_WidgetWin_1 » — la même que Chrome et
 * Edge. Quand Hexa CACHE sa fenêtre d'encre parce qu'elle est vide (§2.5), OBS
 * perd « Hexa Overlay », cherche « une fenêtre du même type »… et tombe sur le
 * navigateur ouvert sur Twitch.
 *
 * Ce script ne peut pas lancer OBS ni lire une classe Win32 sous Linux. Il
 * prouve l'autre moitié de la chaîne, sur la VRAIE application : dans CHAQUE
 * état où l'utilisateur dit perdre l'outil, la fenêtre d'encre est-elle
 * réellement CACHÉE (isVisible() faux) ? C'est cette disparition qui déclenche
 * la recherche « par type » d'OBS.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/t-obs-1-disparition.mjs
 *
 * Sortie 0 si la piste est CONFIRMÉE (la fenêtre disparaît bien), 1 sinon.
 * Deux fenêtres par écran, comme en usage réel (pas de HEXA_FUSION).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()
const OUT = join(CAPTURES, 't-obs-1')
mkdirSync(OUT, { recursive: true })
const USER = join(OUT, '.user-data')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })
// Ce script diagnostique le comportement HÉRITÉ — la fenêtre vide CACHÉE —
// qu'on ne peut plus obtenir qu'en coupant « Garder la fenêtre capturable par
// OBS » (réglage du processus principal, relu au démarrage). Le comportement
// par défaut, lui, est éprouvé par t-obs-2-capturable.mjs.
writeFileSync(join(USER, 'reglages-principal.json'), JSON.stringify({ captureFenetre: false }))

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
  // Variable posée par ce script pour que l'application NE change PAS de
  // comportement : on mesure l'état livré, pas un mode de test.
  env: { ...process.env },
})
app.process().stderr?.on('data', () => {})

/* --- espion : comptage des appels de méthodes de fenêtre ------------------ */
await app.evaluate(({ BrowserWindow, app: electronApp }) => {
  const g = globalThis
  g.__t = { appels: [] }
  const espionner = (w) => {
    for (const m of ['hide', 'show', 'showInactive', 'setBounds', 'setAlwaysOnTop', 'setOpacity']) {
      const orig = w[m].bind(w)
      w[m] = (...a) => {
        g.__t.appels.push({ t: Date.now(), fen: w.getTitle(), m })
        return orig(...a)
      }
    }
  }
  BrowserWindow.getAllWindows().forEach(espionner)
  electronApp.on('browser-window-created', (_e, w) => espionner(w))
})

/** Fenêtres du processus principal : titre, visibilité, taille. */
const fenetres = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => ({
        titre: w.getTitle(),
        url: w.webContents.getURL().split('/').pop()?.split('?')[0] ?? '',
        visible: w.isVisible(),
        b: w.getBounds(),
      })),
  )
const encreVisible = async () => {
  const l = await fenetres()
  const e = l.filter((w) => w.url === 'index.html')
  return { visible: e.map((w) => w.visible), fenetres: l }
}

let encre = null
let inter = null
for (let i = 0; i < 40 && !(encre && inter); i++) {
  await pause(400)
  encre = app.windows().find((w) => w.url().includes('index.html'))
  inter = app.windows().find((w) => w.url().includes('ui.html'))
}
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await inter.waitForSelector('.toolbar', { timeout: 20000 })

// état de départ : découverte vue, fondu ∞, raccourcis système coupés
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
await pause(1200)

/* --- 0. les titres : un seul « Hexa Overlay » par écran ? ----------------- */
console.log('\n--- 0. Titres des fenêtres (ce qu’OBS lit) ---')
{
  const l = await fenetres()
  const titres = l.map((w) => `${w.titre} [${w.url || 'data:'}] ${w.visible ? 'visible' : 'cachée'}`)
  console.log('  ' + titres.join('\n  '))
  const overlays = l.filter((w) => w.titre === 'Hexa Overlay')
  dit('0.1 la couche encre s’appelle « Hexa Overlay »', overlays.length >= 1, `${overlays.length} fenêtre(s)`)
  const doublons = l.map((w) => w.titre).filter((t, i, a) => a.indexOf(t) !== i)
  dit('0.2 aucun titre en double', doublons.length === 0, doublons.join(', ') || 'aucun')
}

/* --- 1. après l'accueil, sans rien dessiner ------------------------------- */
console.log('\n--- 1. Au lancement, une fois l’accueil terminé ---')
{
  // l'accueil dure 4,2 s (12 s au tout premier lancement) : on attend qu'il
  // rende la main, puis le délai de grâce de 300 ms
  let v = null
  for (let i = 0; i < 40; i++) {
    v = await encreVisible()
    if (v.visible.every((x) => x === false)) break
    await pause(500)
  }
  dit(
    '1.1 fenêtre d’encre CACHÉE au repos (rien à afficher)',
    v.visible.every((x) => x === false),
    `isVisible = ${JSON.stringify(v.visible)} — OBS ne trouve plus « Hexa Overlay »`,
  )
}

/** F8 depuis la page (les raccourcis système sont coupés sous Xvfb). */
const f8 = async () => {
  await encre.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })))
  await pause(600)
}
/** Amène l'écran d'annotation dans le mode voulu, d'après l'état RÉEL du principal. */
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

/* --- 2. annotations effacées ---------------------------------------------- */
console.log('\n--- 2. Annotations effacées ---')
{
  await modeDessin(true)
  const enDessin = await encreVisible()
  dit('2.1 F8 : la fenêtre d’encre apparaît', enDessin.visible.some(Boolean), JSON.stringify(enDessin.visible))
  await trait()
  await modeDessin(false) // retour au jeu, le trait reste
  await pause(500)
  const avecTrait = await encreVisible()
  dit('2.2 un trait posé, retour au jeu : fenêtre visible', avecTrait.visible.some(Boolean), JSON.stringify(avecTrait.visible))
  await modeDessin(true)
  await encre.keyboard.press('c') // tout effacer (preset Epic Pen)
  await modeDessin(false)
  await pause(700)
  const efface = await encreVisible()
  dit(
    '2.3 tout effacé + retour au jeu : la fenêtre DISPARAÎT',
    efface.visible.every((x) => x === false),
    `isVisible = ${JSON.stringify(efface.visible)} après le délai de grâce (300 ms)`,
  )
}

/* --- 3. fondu terminé ----------------------------------------------------- */
console.log('\n--- 3. Fondu automatique terminé ---')
{
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
  const pendant = await encreVisible()
  await pause(4000)
  const apres = await encreVisible()
  dit(
    '3.1 pendant le fondu : visible · fondu fini : CACHÉE',
    pendant.visible.some(Boolean) && apres.visible.every((x) => x === false),
    `pendant ${JSON.stringify(pendant.visible)} → après ${JSON.stringify(apres.visible)}`,
  )
  await encre.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    s.state = { ...(s.state ?? {}), fadeDelay: null }
    localStorage.setItem('hexa-ui', JSON.stringify(s))
  })
  await encre.reload()
  await encre.waitForSelector('.stage canvas', { timeout: 20000 })
  await pause(800)
}

/* --- 4. annotations masquées (Ctrl+Maj+M) --------------------------------- */
console.log('\n--- 4. Annotations masquées (Ctrl+Maj+M) ---')
{
  await modeDessin(true)
  await trait(500)
  await encre.keyboard.press('Control+Shift+m')
  await pause(300)
  await modeDessin(false)
  await pause(700)
  const masque = await encreVisible()
  dit(
    '4.1 annotations masquées + jeu : la fenêtre DISPARAÎT (traits intacts, fenêtre absente)',
    masque.visible.every((x) => x === false),
    `isVisible = ${JSON.stringify(masque.visible)}`,
  )
  await modeDessin(true)
  await encre.keyboard.press('Control+Shift+m')
  await pause(300)
  await modeDessin(false)
  await pause(500)
  const revenu = await encreVisible()
  dit('4.2 annotations réaffichées : elle revient', revenu.visible.some(Boolean), JSON.stringify(revenu.visible))
}

/* --- 5. veille ------------------------------------------------------------ */
console.log('\n--- 5. Veille du système ---')
{
  await pause(500)
  const avant = await encreVisible()
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
  await pause(700)
  const veille = await encreVisible()
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
  await pause(1800)
  const reveil = await encreVisible()
  dit(
    '5.1 veille : fenêtre rentrée ; réveil : elle revient (trait présent)',
    avant.visible.some(Boolean) && veille.visible.every((x) => x === false) && reveil.visible.some(Boolean),
    `avant ${JSON.stringify(avant.visible)} · veille ${JSON.stringify(veille.visible)} · réveil ${JSON.stringify(reveil.visible)}`,
  )
}

/* --- 6. écran non désigné ------------------------------------------------- */
console.log('\n--- 6. Un second écran, non désigné pour l’annotation ---')
{
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
  await pause(1800)
  const l = await fenetres()
  const second = l.filter((w) => w.b.x === 1600 && w.url === 'index.html')
  dit(
    '6.1 l’écran non désigné a une fenêtre d’encre, JAMAIS visible',
    second.length === 1 && second[0].visible === false,
    `${second.length} fenêtre(s) « ${second[0]?.titre ?? '?'} » sur l’écran 2, visible=${second[0]?.visible}`,
  )
  const titres = l.filter((w) => w.url === 'index.html').map((w) => w.titre)
  dit(
    '6.2 les deux couches encre ont des titres DIFFÉRENTS (OBS identifie par titre)',
    new Set(titres).size === titres.length && titres.includes('Hexa Overlay'),
    titres.map((t) => `« ${t} »`).join(' · '),
  )
}

/* --- 7. combien de fois la fenêtre disparaît-elle en usage normal ? ------- */
{
  const appels = await app.evaluate(() => globalThis.__t.appels)
  const encreAppels = appels.filter((a) => a.fen === 'Hexa Overlay')
  const hides = encreAppels.filter((a) => a.m === 'hide').length
  const shows = encreAppels.filter((a) => a.m === 'showInactive' || a.m === 'show').length
  console.log(`\n  appels de méthodes sur « Hexa Overlay » pendant ce script : ${encreAppels.length}`)
  console.log(`    hide : ${hides} · show/showInactive : ${shows} · setAlwaysOnTop : ${encreAppels.filter((a) => a.m === 'setAlwaysOnTop').length} · setBounds : ${encreAppels.filter((a) => a.m === 'setBounds').length}`)
  dit('7.1 la fenêtre d’encre alterne cachée/visible en usage normal', hides >= 3 && shows >= 3, `${hides} hide(), ${shows} show() — autant d’occasions pour OBS de perdre la fenêtre`)
  writeFileSync(join(OUT, 'appels.json'), JSON.stringify(appels, null, 1))
}

await app.close().catch(() => {})
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
