#!/usr/bin/env node
/**
 * T-OBS-4 — ÉVALUATION ADVERSARIALE de « la fenêtre d'encre réduite à 8 × 8 ».
 *
 * La correction de « OBS affiche ma page Twitch » (t-obs-2) garde la couche
 * encre VISIBLE quand elle est vide, réduite à 8 × 8 pixels. Ce script cherche
 * ce que cette fenêtre minuscule casse AILLEURS, dans les combinaisons qu'un
 * streamer enchaîne sans y penser, en mode deux fenêtres, OBS branché :
 *
 *   1. le REPOS : 5 s d'immobilité, 0 image dans les deux couches, 0 méthode de
 *      fenêtre, 0 lecture de métriques, une seule taille (8 × 8) d'un bout à
 *      l'autre, des canevas de dessin qui ne réservent plus rien ;
 *   2. le MIROIR OBS : une page réduite à 8 × 8 est une page dont
 *      `window.innerWidth` vaut 8 — et c'est cette valeur que le miroir
 *      annonce comme « taille de l'écran annoté » (message `viewport`). Une vue
 *      OBS qui la reçoit met TOUT à l'échelle ×135. On espionne le fil
 *      WebSocket pour le prouver, et on photographie la vue OBS pendant que les
 *      annotations reviennent (annotations masquées puis réaffichées, session
 *      rechargée en mode jeu) pour voir ce que les spectateurs voient ;
 *   3. le F8 MARTELÉ : quinze bascules à 120 ms, puis un trait ;
 *   4. la LATENCE du réaffichage avec 150 annotations, réduite ou non : c'est le
 *      prix de la réallocation des canevas qu'impose le passage par 8 × 8 ;
 *   5. la RECONNEXION d'une vue OBS pendant que la fenêtre est réduite.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/t-obs-4-eval.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()
const OUT = join(CAPTURES, 't-obs-4')
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

/* --- espions dans le principal ------------------------------------------- */
await app.evaluate(({ BrowserWindow, app: electronApp }) => {
  const g = globalThis
  g.__t = { appels: [], metrics: 0 }
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
  const orig = electronApp.getAppMetrics.bind(electronApp)
  electronApp.getAppMetrics = () => {
    g.__t.metrics++
    return orig()
  }
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
const etatEncre = async () => {
  const f = await fenetres()
  const e = f.liste.find((w) => w.titre === 'Hexa Overlay')
  if (!e) return { visible: null, b: null, reduite: false, pleine: false, ecran: f.ecran }
  const reduite = e.visible && e.b.width === 8 && e.b.height === 8
  const pleine = e.b.width === f.ecran.width && e.b.height === f.ecran.height
  return { visible: e.visible, b: e.b, reduite, pleine, ecran: f.ecran }
}
const fmt = (e) => `visible=${e.visible} ${e.b ? `${e.b.width}×${e.b.height}@${e.b.x},${e.b.y}` : '?'}`
const attendreReduite = async (max = 4000) => {
  const t0 = Date.now()
  let e = await etatEncre()
  while (!e.reduite && Date.now() - t0 < max) {
    await pause(60)
    e = await etatEncre()
  }
  return e
}
const minuteries = () => app.evaluate(() => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length)

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
      sound: false,
    }
    localStorage.setItem('hexa-ui', JSON.stringify(s))
  })
}
await encre.reload()
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await inter.reload()
await inter.waitForSelector('.toolbar', { timeout: 20000 })
await pause(1000)

/** compteur d'images demandées par la page (enrobage de rAF, idempotent) */
const poserCompteur = (p) =>
  p.evaluate(() => {
    const w = window
    if (!w.__ev) {
      w.__ev = { n: 0 }
      const orig = w.requestAnimationFrame.bind(w)
      w.requestAnimationFrame = (cb) => {
        w.__ev.n++
        return orig(cb)
      }
    }
    const n = w.__ev.n
    w.__ev.n = 0
    return n
  })
const modeDessin = async (on) => {
  await encre.evaluate((v) => window.hexa.setPassthrough(!v), on)
  await pause(400)
}
const trait = async (y = 400, x0 = 400) => {
  const m = encre.mouse
  await m.move(x0, y)
  await m.down()
  for (let i = 1; i <= 20; i++) await m.move(x0 + i * 20, y + Math.sin(i / 3) * 40, { steps: 2 })
  await m.up()
  await pause(300)
}
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
const canevas = () =>
  encre.evaluate(() => [...document.querySelectorAll('.stage canvas')].map((c) => `${c.width}×${c.height}`).join(' '))

/* ================================================================== *
 * 1. Le repos, mesuré autrement
 * ================================================================== */
console.log('\n--- 1. Cinq secondes de repos (deux fenêtres, réglage par défaut) ---')
{
  const e0 = await attendreReduite(12000)
  dit('1.0 point de départ : fenêtre d’encre réduite', e0.reduite, fmt(e0))
  await poserCompteur(encre)
  await poserCompteur(inter)
  await app.evaluate(() => {
    globalThis.__t.appels.splice(0)
    globalThis.__t.metrics = 0
  })
  const t0 = await minuteries()
  const tailles = new Set()
  const t = Date.now()
  while (Date.now() - t < 5000) {
    const e = await etatEncre()
    tailles.add(`${e.visible}:${e.b?.width}×${e.b?.height}`)
    await pause(250)
  }
  const imgE = await poserCompteur(encre)
  const imgI = await poserCompteur(inter)
  const t1 = await minuteries()
  const s = await app.evaluate(() => globalThis.__t)
  const appelsEncre = s.appels.filter((a) => a.fen === 'Hexa Overlay')
  dit('1.1 0 image demandée en 5 s, couche encre ET couche interface', imgE === 0 && imgI === 0, `${imgE} + ${imgI} image(s)`)
  dit('1.2 une seule taille de fenêtre pendant 5 s : 8 × 8 visible', tailles.size === 1 && tailles.has('true:8×8'), [...tailles].join(' '))
  dit('1.3 0 méthode de fenêtre, 0 lecture de métriques', appelsEncre.length === 0 && s.metrics === 0, `${appelsEncre.length} appel(s), ${s.metrics} lecture(s)`)
  dit('1.4 pas de minuterie qui s’accumule dans le principal', t1 <= t0 + 1, `${t0} → ${t1} Timeout`)
  const cv = await canevas()
  dit('1.5 canevas de dessin réduits eux aussi (rien de réservé pour un écran vide)', /^(8×8|0×0) (8×8|0×0) (0×0|8×8)$/.test(cv), cv)
}

/* ================================================================== *
 * 2. Le miroir OBS reçoit-il un écran de 8 pixels ?
 * ================================================================== */
console.log('\n--- 2. Le miroir OBS et la fenêtre de 8 × 8 ---')
const st = await encre.evaluate(() => window.hexa.obsStatus())
const port = st?.port ?? 0
const jeton = st?.url ? new URL(st.url).searchParams.get('k') : null

/** Espion WebSocket : une vraie poignée de main, puis chaque trame texte décodée. */
const messages = []
const espionWs = await new Promise((res) => {
  const cle = randomBytes(16).toString('base64')
  const req = http.request({
    host: '127.0.0.1',
    port,
    path: `/?k=${jeton}`,
    headers: {
      host: `127.0.0.1:${port}`,
      origin: `http://127.0.0.1:${port}`,
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': cle,
      'sec-websocket-version': '13',
    },
  })
  req.on('upgrade', (r, s) => {
    const attendu = createHash('sha1').update(cle + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    let buf = Buffer.alloc(0)
    let frag = ''
    s.on('data', (c) => {
      buf = Buffer.concat([buf, c])
      for (;;) {
        if (buf.length < 2) return
        const fin = (buf[0] & 0x80) !== 0
        const op = buf[0] & 0x0f
        let len = buf[1] & 0x7f
        let off = 2
        if (len === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          off = 4
        } else if (len === 127) {
          if (buf.length < 10) return
          len = Number(buf.readBigUInt64BE(2))
          off = 10
        }
        if (buf.length < off + len) return
        const payload = buf.subarray(off, off + len)
        buf = buf.subarray(off + len)
        if (op === 0x1 || op === 0x0) {
          frag += payload.toString('utf8')
          if (fin) {
            const texte = frag
            frag = ''
            try {
              const j = JSON.parse(texte)
              const lot = Array.isArray(j) ? j : [j]
              for (const m of lot) messages.push({ ts: Date.now(), ...m })
            } catch {
              messages.push({ ts: Date.now(), brut: texte.slice(0, 60) })
            }
          }
        }
      }
    })
    res(r.headers['sec-websocket-accept'] === attendu ? s : null)
  })
  req.on('response', () => res(null))
  req.on('error', () => res(null))
  req.end()
})
dit('2.0 espion WebSocket branché sur le serveur local', !!espionWs, `port ${port}`)

/** La vraie page OBS, dans un vrai Chromium, gardée ouverte. */
await app.evaluate(async ({ BrowserWindow }, url) => {
  // Affichée et jamais bridée : la source navigateur d'OBS rend en continu, et
    // une fenêtre cachée de Chromium ne demanderait plus d'image (rAF suspendue),
    // ce qui fausserait chaque chronométrage de ce script.
    const w = new BrowserWindow({ width: 960, height: 540, show: true, webPreferences: { backgroundThrottling: false } })
  globalThis.__obs = w
  await w.loadURL(url)
}, st.url)
await pause(2500)
/** ce que la vue OBS montre : pixels peints et boîte englobante (en % de la scène) */
const vueObs = () =>
  app.evaluate(() =>
    globalThis.__obs.webContents.executeJavaScript(`(() => {
      const c = document.querySelector('canvas')
      if (!c || c.width === 0 || c.height === 0) return { n: -1 }
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        if (d[(y * c.width + x) * 4 + 3] > 8) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      }
      return { n: n * 4, w: c.width, h: c.height, boite: x1 >= 0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0, part: ((x1 - x0) * (y1 - y0)) / (c.width * c.height) } : null }
    })()`),
  )
const derniersViewports = (depuis) => messages.filter((m) => m.ts >= depuis && m.t === 'viewport')

{
  const depuis = Date.now()
  await modeDessin(true)
  await trait(400)
  await pause(400)
  const avant = await vueObs()
  dit('2.1 le trait du coach est dans la vue OBS', avant.n > 300 && avant.boite && avant.boite.part < 0.3, `${avant.n} px, boîte ${JSON.stringify(avant.boite)}`)
  await modeDessin(false)
  await pause(500)
  // annotations masquées : la fenêtre se réduit
  await modeDessin(true)
  await encre.keyboard.press('Control+Shift+m')
  await modeDessin(false)
  const masque = await attendreReduite()
  await pause(600) // le miroir regroupe les `resize` sur 250 ms
  const vps = derniersViewports(depuis)
  const nain = vps.filter((m) => m.w <= 16 || m.h <= 16)
  console.log(`  viewports reçus par la vue OBS : ${vps.map((m) => `${m.w}×${m.h}`).join(' ')}`)
  dit(
    '2.2 la vue OBS ne reçoit JAMAIS un écran de 8 × 8 comme taille de référence',
    masque.reduite && nain.length === 0,
    `${fmt(masque)} · ${vps.length} message(s) viewport, dont ${nain.length} minuscule(s) : ${nain.map((m) => `${m.w}×${m.h}`).join(' ') || 'aucun'}`,
  )
  const pendantMasque = await vueObs()
  console.log(`  vue OBS pendant le masquage : ${pendantMasque.n} px`)

  // réaffichage : on photographie la vue OBS toutes les 40 ms pendant 800 ms
  const t0 = Date.now()
  await modeDessin(true)
  await encre.keyboard.press('Control+Shift+m')
  const films = []
  while (Date.now() - t0 < 900) {
    const v = await vueObs()
    films.push({ t: Date.now() - t0, n: v.n, part: v.boite?.part ?? 0 })
    await pause(40)
  }
  const geants = films.filter((f) => f.part > 0.4)
  const fin = films[films.length - 1]
  console.log(`  film : ${films.map((f) => `${f.t}ms:${f.n}px/${Math.round(f.part * 100)}%`).join(' ')}`)
  dit(
    '2.3 réaffichées : la vue OBS ne montre jamais un trait géant (boîte > 40 % de la scène)',
    geants.length === 0 && fin.n > 300,
    `${geants.length} image(s) géante(s) sur ${films.length}, dernière : ${fin.n} px / boîte ${Math.round(fin.part * 100)} %`,
  )
  await app.evaluate(async () => {
    const png = (await globalThis.__obs.webContents.capturePage()).toPNG().toString('base64')
    globalThis.__png = png
  })
  writeFileSync(join(OUT, '02-vue-obs-reaffichage.png'), Buffer.from(await app.evaluate(() => globalThis.__png), 'base64'))
  await modeDessin(false)

  // session rechargée EN MODE JEU, fenêtre réduite : le cas du rejeu / import
  const session = await encre.evaluate(() => window.hexaEngine.exportSession())
  await modeDessin(true)
  await encre.keyboard.press('c')
  await modeDessin(false)
  const vide = await attendreReduite()
  await pause(600)
  const depuis2 = Date.now()
  await encre.evaluate((s) => window.hexaEngine.loadSession(s), session)
  const films2 = []
  while (Date.now() - depuis2 < 900) {
    const v = await vueObs()
    films2.push({ t: Date.now() - depuis2, n: v.n, part: v.boite?.part ?? 0 })
    await pause(40)
  }
  const e2 = await etatEncre()
  const geants2 = films2.filter((f) => f.part > 0.4)
  const fin2 = films2[films2.length - 1]
  const vps2 = derniersViewports(depuis2)
  console.log(`  film : ${films2.map((f) => `${f.t}ms:${f.n}px/${Math.round(f.part * 100)}%`).join(' ')}`)
  console.log(`  viewports après rechargement : ${vps2.map((m) => `${m.w}×${m.h}`).join(' ')}`)
  dit(
    '2.4 session rechargée en mode jeu, fenêtre réduite : plein écran retrouvé, rien de géant sur OBS',
    vide.reduite && e2.pleine && e2.visible && geants2.length === 0 && fin2.n > 300,
    `${fmt(vide)} → ${fmt(e2)} · ${geants2.length} image(s) géante(s), dernière ${fin2.n} px`,
  )
}

/* ================================================================== *
 * 3. F8 martelé
 * ================================================================== */
console.log('\n--- 3. Quinze bascules F8 à 120 ms ---')
{
  await modeDessin(true)
  await encre.keyboard.press('c')
  await modeDessin(false)
  await attendreReduite()
  await app.evaluate(() => globalThis.__t.appels.splice(0))
  const erreurs = []
  encre.on('pageerror', (e) => erreurs.push(String(e.message)))
  for (let i = 0; i < 15; i++) {
    await encre.evaluate(() => window.hexa.setPassthrough(false))
    await pause(120)
    await encre.evaluate(() => window.hexa.setPassthrough(true))
    await pause(120)
  }
  await pause(200)
  const enDessinFinal = await modeDessin(true)
  const e = await etatEncre()
  const appels = (await app.evaluate(() => globalThis.__t.appels)).filter((a) => a.fen === 'Hexa Overlay')
  const bounds = appels.filter((a) => a.m === 'setBounds').length
  await trait(500)
  const px = await pixels()
  const cv = await canevas()
  dit(
    '3.1 après le martèlement : plein écran en dessin, un trait se peint, aucune erreur de page',
    e.pleine && e.visible && px > 100 && erreurs.length === 0,
    `${fmt(e)} · ${px} échantillons d’encre · canevas ${cv} · ${erreurs.length} erreur(s)`,
  )
  dit('3.2 pas plus d’une pose de bounds par bascule (le délai de grâce absorbe le reste)', bounds <= 31, `${bounds} setBounds, ${appels.filter((a) => a.m === 'hide').length} hide, ${appels.filter((a) => /show/i.test(a.m)).length} show`)
  await modeDessin(false)
}

/* ================================================================== *
 * 4. Latence du réaffichage avec 150 annotations, réduite ou non
 * ================================================================== */
console.log('\n--- 4. 150 annotations masquées puis réaffichées : le prix du 8 × 8 ---')
{
  const base = await encre.evaluate(() => window.hexaEngine.exportSession())
  const modele = base.strokes[0]
  const grosse = {
    ...base,
    strokes: Array.from({ length: 150 }, (_, i) => ({
      ...structuredClone(modele),
      id: 1000 + i,
      points: modele.points.map((p) => ({ ...p, x: 60 + (i % 15) * 100 + (p.x - 400) * 0.25, y: 60 + Math.floor(i / 15) * 80 + (p.y - 500) * 0.25 })),
    })),
  }
  const latence = async () => {
    await modeDessin(true)
    await encre.keyboard.press('c')
    await pause(400)
    await encre.evaluate((s) => window.hexaEngine.loadSession(s), grosse)
    await pause(600)
    const n = await encre.evaluate(() => window.hexaEngine.exportSession().strokes.length)
    const avant = await pixels()
    await encre.keyboard.press('Control+Shift+m')
    await modeDessin(false)
    await pause(900)
    const cache = await etatEncre()
    const cvCache = await canevas()
    // réaffichage : chrono jusqu'aux premiers pixels sur le canevas statique
    await modeDessin(true)
    const t0 = Date.now()
    await encre.keyboard.press('Control+Shift+m')
    let apres = 0
    let dt = -1
    while (Date.now() - t0 < 3000) {
      apres = await pixels()
      if (apres >= avant * 0.9) {
        dt = Date.now() - t0
        break
      }
      await pause(5)
    }
    await modeDessin(false)
    return { n, avant, apres, dt, cache: fmt(cache), cvCache }
  }
  const reduite = await latence()
  await inter.evaluate(() => window.hexa.captureFenetre(false))
  await pause(400)
  const cachee = await latence()
  await inter.evaluate(() => window.hexa.captureFenetre(true))
  await pause(400)
  console.log(`  réduite : ${JSON.stringify(reduite)}\n  cachée  : ${JSON.stringify(cachee)}`)
  dit(
    '4.1 150 annotations reviennent à l’identique après un passage par 8 × 8',
    reduite.n === 150 && reduite.dt >= 0 && Math.abs(reduite.apres - reduite.avant) <= Math.max(3, reduite.avant * 0.02),
    `${reduite.avant} → ${reduite.apres} échantillons en ${reduite.dt} ms (canevas pendant le masquage : ${reduite.cvCache})`,
  )
  dit(
    '4.2 le réaffichage ne coûte pas plus de 150 ms de plus que la fenêtre simplement cachée',
    cachee.dt >= 0 && reduite.dt - cachee.dt <= 150,
    `réduite ${reduite.dt} ms · cachée ${cachee.dt} ms`,
  )
}

/* ================================================================== *
 * 5. Une vue OBS qui se (re)connecte pendant que la fenêtre est réduite
 * ================================================================== */
console.log('\n--- 5. Vue OBS reconnectée fenêtre réduite, puis un trait ---')
{
  await modeDessin(true)
  await encre.keyboard.press('c')
  await modeDessin(false)
  const vide = await attendreReduite()
  await pause(500)
  const depuis = Date.now()
  await app.evaluate(async ({ BrowserWindow }, url) => {
    try {
      globalThis.__obs.destroy()
    } catch {}
    // Affichée et jamais bridée : la source navigateur d'OBS rend en continu, et
    // une fenêtre cachée de Chromium ne demanderait plus d'image (rAF suspendue),
    // ce qui fausserait chaque chronométrage de ce script.
    const w = new BrowserWindow({ width: 960, height: 540, show: true, webPreferences: { backgroundThrottling: false } })
    globalThis.__obs = w
    await w.loadURL(url)
  }, st.url)
  await pause(2000)
  await modeDessin(true)
  // un trait tout de suite après le F8 — avant les 250 ms de regroupement du miroir
  await trait(300, 300)
  await pause(800)
  const v = await vueObs()
  const vps = derniersViewports(depuis)
  const nain = vps.filter((m) => m.w <= 16 || m.h <= 16)
  dit(
    '5.1 le trait arrive à la bonne échelle dans une vue connectée pendant la réduction',
    vide.reduite && v.n > 300 && v.boite && v.boite.part < 0.3 && nain.length === 0,
    `${v.n} px, boîte ${Math.round((v.boite?.part ?? 0) * 100)} % · viewports depuis la reconnexion : ${vps.map((m) => `${m.w}×${m.h}`).join(' ') || 'aucun'}`,
  )
  await modeDessin(false)
}

/* ================================================================== *
 * 6. La sonde lancée depuis le panneau des réglages, panneau laissé ouvert
 * ================================================================== */
console.log('\n--- 6. Sonde de 30 s, panneau des réglages ouvert (le témoin lit toutes les 2 s) ---')
{
  await app.evaluate(({ shell }) => {
    // sous Xvfb, ouvrir un dossier lancerait xdg-open : on l'enregistre seulement
    shell.showItemInFolder = () => {}
  })
  await modeDessin(true)
  await encre.keyboard.press('c')
  await pause(300)
  await inter.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar button')].find((x) =>
      (x.getAttribute('title') ?? '').toLowerCase().includes('réglage'),
    )
    b?.click()
  })
  await inter.waitForSelector('.hx-sec', { timeout: 8000 })
  await pause(600)
  const temoinTourne = await inter.evaluate(() => !!document.querySelector('.hx-cout'))
  // notre propre compteur, que personne d'autre ne remet à zéro
  await poserCompteur(encre)
  const promesse = inter.evaluate(() => window.hexa.lancerSonde())
  await pause(3800) // bandeau de lancement, puis relevé « à blanc »
  await poserCompteur(encre)
  for (let k = 0; k < 6; k++) {
    await trait(200 + k * 60, 200)
    await pause(1200)
  }
  const independant = await poserCompteur(encre)
  const r = await promesse
  const rapport = JSON.parse((await import('node:fs')).readFileSync(r.json, 'utf8'))
  const f = rapport.fenetres.find((x) => x.titre === 'Hexa Overlay')
  const ecart = f ? Math.abs(f.images - independant) / Math.max(1, independant) : 1
  dit(
    '6.1 la sonde compte les mêmes images que notre compteur indépendant, témoin actif à côté',
    temoinTourne && !!f && independant > 100 && ecart <= 0.08,
    `${independant} images comptées indépendamment · ${f?.images} attribuées par la sonde (écart ${Math.round(ecart * 100)} %, ≤ 8 % exigé) · témoin « Coût actuel » monté : ${temoinTourne}`,
  )
  await inter.keyboard.press('Escape')
  await pause(500)
  await modeDessin(false)
}

espionWs?.destroy()
await app.evaluate(() => {
  try {
    globalThis.__obs.destroy()
  } catch {}
})
writeFileSync(join(OUT, 'messages.json'), JSON.stringify(messages.map((m) => ({ ...m, strokes: undefined, stroke: undefined })), null, 1))
await app.close().catch(() => {})
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
