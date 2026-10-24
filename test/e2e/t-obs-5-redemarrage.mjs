#!/usr/bin/env node
/**
 * T-OBS-5 — LA SOURCE NAVIGATEUR REVIENT TOUTE SEULE APRÈS UN REDÉMARRAGE.
 *
 * Le journal de l'utilisateur (23 et 24/10) montre, à chaque lancement de Hexa,
 * une ligne « connexion refusée (… jeton absent ou faux) ». Le jeton du flux
 * OBS est tiré à chaque lancement : la page déjà ouverte dans OBS présente
 * l'ancien. La question : se reconnecte-t-elle avec le NOUVEAU, et en combien
 * de temps, sans que personne n'actualise la source ?
 *
 * Le rôle d'OBS est tenu par une seconde instance Electron, qui ouvre la page
 * exactement comme une source navigateur (même moteur Chromium que le CEF
 * d'OBS, aucun accès à Hexa autre que l'adresse http://127.0.0.1:PORT/obs.html).
 *
 * Ce que ce script prouve :
 *   1. la page se connecte au premier lancement ;
 *   2. Hexa relancé tout de suite (redémarrage, mise à jour) : refus de
 *      l'ancien jeton, puis reconnexion seule, avec le nouveau ;
 *   3. Hexa relancé après une longue absence (plantage pendant une partie) :
 *      même chose.
 *
 *   node test/e2e/t-obs-5-redemarrage.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

const electron = await chargerPilote()
const OUT = join(CAPTURES, 't-obs-5')
mkdirSync(OUT, { recursive: true })
const USER = join(OUT, '.user-data')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })
const USER_OBS = join(OUT, '.user-data-obs')
rmSync(USER_OBS, { recursive: true, force: true })

const R = []
const dit = (n, c, d) => {
  R.push([c ? 'OK' : 'KO', n, d])
  console.log(`  ${c ? 'OK ' : 'KO '}  ${n} — ${d}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const exe = join(RACINE, 'node_modules', 'electron', 'dist', 'electron')

async function lancerHexa() {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${USER}`], cwd: RACINE, executablePath: exe, timeout: 60000 })
  app.process().stderr?.on('data', () => {})
  let encre = null
  for (let i = 0; i < 40 && !encre; i++) {
    await pause(250)
    encre = app.windows().find((w) => w.url().includes('index.html'))
  }
  await encre.waitForSelector('.stage canvas', { timeout: 20000 })
  let st = null
  for (let i = 0; i < 40 && !st?.running; i++) {
    st = await encre.evaluate(() => window.hexa.obsStatus()).catch(() => null)
    if (!st?.running) await pause(250)
  }
  return { app, encre, port: st?.port, jeton: st?.url ? new URL(st.url).searchParams.get('k') : null }
}

/** Nombre de vues OBS connectées, vu par Hexa. */
const clients = (h) => h.encre.evaluate(() => window.hexa.obsStatus()).then((s) => s?.clients ?? 0).catch(() => 0)

async function attendreConnexion(h, maxMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    if ((await clients(h)) > 0) return Date.now() - t0
    await pause(100)
  }
  return null
}

/* --- « OBS » : une page, une seule, ouverte sur l'adresse de la source ---- */
const MAIN_OBS = join(OUT, 'faux-obs.cjs')
writeFileSync(
  MAIN_OBS,
  `const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 640, height: 360, show: false })
  w.loadURL(process.argv[process.argv.length - 1])
})
app.on('window-all-closed', () => {})
`,
)

const journalHexa = () => readFileSync(join(USER, 'hexa.log'), 'utf8')

let h = await lancerHexa()
console.log(`\n--- 1. Premier lancement (port ${h.port}) ---`)
const adresse = `http://127.0.0.1:${h.port}/obs.html`
const obs = await electron.launch({ args: [MAIN_OBS, `--user-data-dir=${USER_OBS}`, adresse], executablePath: exe, timeout: 60000 })
let page = null
for (let i = 0; i < 40 && !page; i++) {
  await pause(250)
  page = obs.windows()[0] ?? null
}
let rechargements = 0
page.on('load', () => rechargements++)
const t1 = await attendreConnexion(h, 10000)
dit('1.1 la source navigateur se connecte', t1 !== null, t1 === null ? 'jamais' : `en ${t1} ms`)

for (const [etape, absenceMs] of [
  ['2', 300],
  ['3', 20000],
]) {
  console.log(`\n--- ${etape}. Hexa relancé après ${absenceMs / 1000} s d’absence ---`)
  const ancien = h.jeton
  await h.app.close().catch(() => {})
  await pause(absenceMs)
  const avant = rechargements
  const lignesAvant = journalHexa().length
  h = await lancerHexa()
  const t = await attendreConnexion(h, 30000)
  const journal = journalHexa().slice(lignesAvant)
  const refus = (journal.match(/jeton absent ou faux/g) ?? []).length
  dit(`${etape}.1 nouveau jeton à ce lancement`, !!h.jeton && h.jeton !== ancien, `port ${h.port}`)
  dit(
    `${etape}.2 la source revient seule, avec le nouveau jeton`,
    t !== null && rechargements > avant,
    t === null ? 'jamais en 30 s' : `connectée ${t} ms après Hexa prêt · ${rechargements - avant} rechargement(s) · ${refus} refus au journal`,
  )
}

await obs.close().catch(() => {})
await h.app.close().catch(() => {})
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
