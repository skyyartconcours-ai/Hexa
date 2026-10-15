#!/usr/bin/env node
/**
 * Hexa — ENDURANCE : une soirée de cast, en accéléré, avec une vraie vue OBS.
 *
 * La vraie application (Electron) + la page OBS ouverte dans Chromium — le
 * même moteur que la source navigateur d'OBS. On pose des pastilles bleues et
 * rouges en alternant avec Tab, des traits, en mode ∞ (le pire cas : rien ne
 * s'efface), tour après tour. À chaque tour on relève ce que coûtent Hexa et
 * la page OBS. Ce qui compte : que le coût d'un tour NE MONTE PAS avec le
 * nombre d'annotations à l'écran, et qu'au repos les deux retombent à zéro.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x900x24" node test/e2e/soak-obs.mjs
 */
import { lancerHexa, etatDeDepart, chargerPilote } from './harness.mjs'

const TOURS = Number(process.env.TOURS ?? 12)
const PASTILLES_PAR_TOUR = 24
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const { app, win, journal } = await lancerHexa({ profil: 'soak' })
await etatDeDepart(win)
await win.waitForTimeout(800)

const st = await win.evaluate(() => window.hexa.obsStatus())
if (!st?.running) {
  console.log('serveur OBS absent', st)
  process.exit(1)
}

// La « source navigateur » : Chromium, comme le CEF d'OBS.
const pw = await import('/opt/node22/lib/node_modules/playwright/index.js')
const chromium = pw.chromium ?? pw.default.chromium
const nav = await chromium.launch()
const obs = await nav.newPage({ viewport: { width: 1920, height: 1080 } })
const obsErreurs = []
obs.on('pageerror', (e) => obsErreurs.push(String(e.message)))
// Compteur d'images de rendu demandées par la page : au repos, il doit rester à 0.
await obs.addInitScript(() => {
  const r = window.requestAnimationFrame.bind(window)
  window.__raf = 0
  window.requestAnimationFrame = (cb) => {
    window.__raf++
    return r(cb)
  }
})
await obs.goto(st.url)
const cdp = await obs.context().newCDPSession(obs)
await cdp.send('Performance.enable')
const metrique = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  return { tache: m.TaskDuration, tas: m.JSHeapUsedSize }
}
const hexaCpu = async () =>
  app.evaluate(({ app: a }) => {
    const ms = a.getAppMetrics()
    return {
      cpu: ms.reduce((s, p) => s + p.cpu.percentCPUUsage, 0),
      memMo: ms.reduce((s, p) => s + p.memory.workingSetSize, 0) / 1024,
    }
  })

const poser = async (x, y) => {
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.up()
  await win.waitForTimeout(40)
}
const trait = async (x, y) => {
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.move(x + 120, y + 40, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(40)
}

await pause(3000)
{
  // RÉFÉRENCE : page OBS vide, rien à l'écran — le coût de base de Chromium
  // et de la mesure elle-même.
  const a = await metrique()
  const ra = await obs.evaluate(() => window.__raf)
  await pause(10_000)
  const b = await metrique()
  const rb = await obs.evaluate(() => window.__raf)
  console.log(`RÉFÉRENCE vide 10 s : OBS ${((b.tache - a.tache) * 1000).toFixed(0)} ms de travail · ${rb - ra} image(s) de rendu`)
}
await hexaCpu()
let k = 0
console.log('tour | à l’écran | OBS : ms de travail du tour | OBS tas Mo | Hexa CPU % | Hexa mém Mo')
for (let t = 1; t <= TOURS; t++) {
  const m0 = await metrique()
  await win.keyboard.press('n') // numéroteur
  for (let i = 0; i < PASTILLES_PAR_TOUR; i++) {
    if (i % 4 === 0) await win.keyboard.press('Tab') // bascule d'équipe
    k++
    await poser(300 + ((k * 53) % 1200), 80 + ((k * 97) % 700))
  }
  await win.keyboard.press('p') // stylo
  for (let i = 0; i < 6; i++) await trait(300 + ((k * 31 + i * 173) % 1100), 100 + ((i * 113) % 650))
  await pause(1200) // que tout se pose et se consolide
  const m1 = await metrique()
  const h = await hexaCpu()
  const n = await win.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)
  console.log(
    `${String(t).padStart(4)} | ${String(n).padStart(9)} | ${((m1.tache - m0.tache) * 1000).toFixed(0).padStart(26)} | ${(m1.tas / 1048576).toFixed(1).padStart(10)} | ${h.cpu.toFixed(1).padStart(10)} | ${h.memMo.toFixed(0).padStart(11)}`,
  )
}

// REPOS : rien ne doit tourner, ni dans Hexa ni dans la page OBS.
await pause(3000)
await hexaCpu()
const r0 = await metrique()
const raf0 = await obs.evaluate(() => window.__raf)
await pause(10_000)
const r1 = await metrique()
const raf1 = await obs.evaluate(() => window.__raf)
console.log(`REPOS : images de rendu demandées par la page OBS en 10 s : ${raf1 - raf0}`)
const hr = await hexaCpu()
console.log(
  `REPOS 10 s : OBS ${((r1.tache - r0.tache) * 1000).toFixed(0)} ms de travail · Hexa CPU ${hr.cpu.toFixed(2)} %`,
)

// TOUCHE PANIQUE sur le tableau plein
const p0 = await metrique()
await win.keyboard.press('c')
await pause(2000)
const p1 = await metrique()
console.log(`PANIQUE : OBS ${((p1.tache - p0.tache) * 1000).toFixed(0)} ms de travail en 2 s`)

console.log(
  `erreurs : Hexa ${journal.erreurs.length + journal.consoleErreurs.length} · page OBS ${obsErreurs.length}`,
  [...journal.erreurs, ...journal.consoleErreurs, ...obsErreurs].slice(0, 5),
)
await nav.close()
await app.close()
process.exit(0)
