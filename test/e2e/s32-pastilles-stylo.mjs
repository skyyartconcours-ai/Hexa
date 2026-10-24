#!/usr/bin/env node
/**
 * §S32 — LE CHEMIN QUE L'UTILISATEUR EMPRUNTE VRAIMENT : PASTILLES ET STYLO,
 * PAR LES RACCOURCIS DU SYSTÈME.
 *
 * Usage réel rapporté : Ctrl+Maj+1 (numéroteur, pastilles) et Ctrl+Maj+3
 * (stylo), retour au jeu par Ctrl+Maj+2, effacement par Ctrl+Maj+X — pendant
 * une partie, Hexa en arrière-plan. Ce script appuie sur ces touches comme un
 * clavier (SendInput, Windows uniquement : il faut un vrai bureau), et exige :
 *   1. chaque raccourci répond, Hexa n'ayant pas le premier plan ;
 *   2. pendant l'outil : couche encre visible et débridée ;
 *   3. de retour au jeu, annotations posées : la couche reste (elle part dans
 *      le direct) mais le moteur DORT — zéro image — et tout est bridé ;
 *      l'interface de l'écran d'annotation n'est plus composée ;
 *   4. après Ctrl+Maj+X : plus aucune fenêtre d'Hexa sur l'écran d'annotation.
 *
 *   node test/e2e/s32-pastilles-stylo.mjs
 *
 * ⚠️ Ferme le Hexa installé avant : deux instances se disputeraient les
 * raccourcis (Windows ne les donne qu'à une seule).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { CAPTURES, RACINE, chargerPilote } from './harness.mjs'

if (process.platform !== 'win32') {
  console.log('§S32 ne tourne que sous Windows (raccourcis système réels).')
  process.exit(0)
}

const electron = await chargerPilote()
const OUT = join(CAPTURES, 's32')
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

/** Ctrl+Maj+<touche>, envoyé au système comme par un clavier. */
const TOUCHE = join(OUT, 'touche.ps1')
writeFileSync(
  TOUCHE,
  `param([int]$vk)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class K { [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e); }
'@
[K]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [K]::keybd_event(0x10,0,0,[UIntPtr]::Zero)
[K]::keybd_event([byte]$vk,0,0,[UIntPtr]::Zero); [K]::keybd_event([byte]$vk,0,2,[UIntPtr]::Zero)
[K]::keybd_event(0x10,0,2,[UIntPtr]::Zero); [K]::keybd_event(0x11,0,2,[UIntPtr]::Zero)
`,
)
const ctrlMaj = async (car) => {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOUCHE, String(car.charCodeAt(0))])
  await pause(500)
}

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
app.process().stderr?.on('data', () => {})

let encre = null
for (let i = 0; i < 60 && !encre; i++) {
  await pause(300)
  for (const p of app.windows()) {
    if (p.url().includes('index.html') && (await p.evaluate(() => window.hexa?.ecranAnnotation === true).catch(() => false))) encre = p
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
await pause(14000) // accueil terminé

/** Fenêtres d'Hexa posées sur l'écran d'annotation, vues par le principal. */
const surEcranAnnotation = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const ecran = screen.getPrimaryDisplay()
    return BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.isVisible())
      .filter((w) => screen.getDisplayMatching(w.getBounds()).id === ecran.id)
      .map((w) => {
        const b = w.getBounds()
        return {
          titre: w.getTitle(),
          surface: Math.round((100 * b.width * b.height) / (ecran.bounds.width * ecran.bounds.height)),
          bride: w.webContents.getBackgroundThrottling(),
        }
      })
  })
const etat = () =>
  encre.evaluate(() => ({
    dessin: !document.body.classList.contains('passthrough'),
    outil: document.querySelector('.stage')?.dataset.tool ?? '?',
  }))
/** Images peintes par le moteur pendant `ms` (chaque image efface son canevas). */
const imagesPendant = (ms) =>
  encre.evaluate(async (duree) => {
    let n = 0
    const vrai = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...a) {
      n++
      return vrai.apply(this, a)
    }
    await new Promise((r) => setTimeout(r, duree))
    CanvasRenderingContext2D.prototype.clearRect = vrai
    return n
  }, ms)
const retourAuJeu = async (etiquette) => {
  await ctrlMaj('2')
  await pause(1200)
  const e = await etat()
  const fen = await surEcranAnnotation()
  const images = await imagesPendant(3000)
  const encreFen = fen.find((f) => f.titre === 'Hexa Overlay')
  const autres = fen.filter((f) => f.titre !== 'Hexa Overlay')
  dit(`${etiquette}.1 Ctrl+Maj+2 : retour au jeu`, e.dessin === false, `dessin=${e.dessin}`)
  dit(
    `${etiquette}.2 annotations à l’écran, moteur endormi : 0 image en 3 s`,
    !!encreFen && images === 0,
    `encre ${encreFen ? `visible ${encreFen.surface} %` : 'absente'} · ${images} image(s)`,
  )
  dit(`${etiquette}.3 tout est bridé hors dessin`, fen.every((f) => f.bride), JSON.stringify(fen))
  dit(
    `${etiquette}.4 aucune autre fenêtre d’Hexa composée sur l’écran d’annotation`,
    autres.length === 0,
    autres.length ? JSON.stringify(autres) : 'encre seule',
  )
}

/* --- 1. Ctrl+Maj+1 : pastilles -------------------------------------------- */
console.log('\n--- 1. Ctrl+Maj+1 : numéroteur ---')
{
  await ctrlMaj('1')
  const e = await etat()
  const fen = await surEcranAnnotation()
  const enc = fen.find((f) => f.titre === 'Hexa Overlay')
  dit('1.1 Ctrl+Maj+1 répond, Hexa en arrière-plan', e.dessin && e.outil === 'badge', `dessin=${e.dessin} outil=${e.outil}`)
  dit('1.2 couche encre visible et débridée', enc?.bride === false, JSON.stringify(enc ?? null))
  for (const [x, y] of [[400, 300], [600, 380], [800, 300]]) {
    await encre.mouse.click(x, y)
    await pause(350)
  }
  await retourAuJeu('2')
}

/* --- 3. Ctrl+Maj+3 : stylo ------------------------------------------------ */
console.log('\n--- 3. Ctrl+Maj+3 : stylo ---')
{
  await ctrlMaj('3')
  const e = await etat()
  dit('3.1 Ctrl+Maj+3 répond, Hexa en arrière-plan', e.dessin && e.outil === 'pen', `dessin=${e.dessin} outil=${e.outil}`)
  const m = encre.mouse
  await m.move(300, 600)
  await m.down()
  for (let k = 1; k <= 30; k++) await m.move(300 + k * 15, 600 - Math.sin(k / 5) * 80, { steps: 2 })
  await m.up()
  await pause(500)
  await retourAuJeu('4')
}

/* --- 5. Ctrl+Maj+X : tout effacer ----------------------------------------- */
console.log('\n--- 5. Ctrl+Maj+X ---')
{
  await ctrlMaj('X')
  await pause(2500)
  const fen = await surEcranAnnotation()
  dit('5.1 plus aucune fenêtre d’Hexa sur l’écran d’annotation', fen.length === 0, fen.length ? JSON.stringify(fen) : 'aucune')
}

await app.close().catch(() => {})
console.log('\n=========================================')
const kos = R.filter((r) => r[0] === 'KO')
console.log(`${R.length - kos.length} OK · ${kos.length} KO`)
process.exit(kos.length ? 1 : 0)
