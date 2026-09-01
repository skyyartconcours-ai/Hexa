#!/usr/bin/env node
/**
 * Hexa — §SB : UNE SESSION DE COACHING JOUÉE SUR LA VRAIE APPLICATION.
 *
 * Avant d'écrire une seule fonctionnalité, on JOUE la pratique du coach :
 * une carte (rectangle + ellipses), un parcours numéroté, un texte, une
 * flèche, une gomme, un Ctrl+Z, vingt changements d'outil, une roue. À
 * chaque étape on relève ce qui coûte deux gestes, ce qui n'a pas de retour
 * visuel, et ce que le moteur demande vraiment au processeur (images rAF).
 *
 * Ce script ne juge pas « bon / cassé » : il MESURE et NOTE les frictions.
 * Les corrections qu'il a motivées vivent dans sB-fonctionnalites.mjs.
 */
import { OK, Rapport, encre, etatDeDepart, lancerHexa, preparerCaptures, segment, toutEffacer, tracer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win, journal } = await lancerHexa({ profil: 'sB-session' })
await etatDeDepart(win)

const frictions = []
const noter = (f) => {
  frictions.push(f)
  process.stdout.write(`  · friction : ${f}\n`)
}

/** compteur d'images demandées (rAF) — la mesure de la règle §2.5 */
await win.evaluate(() => {
  window.__hexaFrames = 0
  const orig = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => {
    window.__hexaFrames++
    return orig(cb)
  }
})
const images = async (ms) => {
  await win.evaluate(() => (window.__hexaFrames = 0))
  await win.waitForTimeout(ms)
  return win.evaluate(() => window.__hexaFrames)
}
const outil = () => win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state.tool)
const traits = () =>
  win.evaluate(() => (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => s.tool))
const clic = async (x, y) => {
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.up()
  await win.waitForTimeout(90)
}

await rapport.test(win, 'sB-1-carte', 'Préparer une carte : rectangle, deux ellipses, un texte', async (capturer) => {
  await win.keyboard.press('r')
  await tracer(win, segment(300, 200, 900, 620, 10))
  await win.keyboard.press('o')
  await tracer(win, segment(380, 260, 520, 360, 10))
  await tracer(win, segment(700, 460, 840, 560, 10))
  await win.keyboard.press('t')
  await clic(420, 640)
  // un titre, comme un coach qui nomme la phase
  const t0 = Date.now()
  await win.keyboard.type('PLAN A')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(400)
  await capturer('carte')
  const e = await encre(win)
  const liste = await traits()
  // retour visuel du texte : il est posé sur une PLAQUE sombre par défaut.
  // Sur un jeu très contrasté, est-elle assez opaque ? (voir feature 3)
  noter('texte : aucun réglage de lisibilité (plaque fixe à 70 % d’opacité, pas de choix « sans plaque » pour un texte posé sur une zone déjà sombre)')
  return {
    statut: liste.length === 4 ? OK : 'CASSÉ',
    detail: `${liste.join(', ')} · ${e.statique} px d’encre · saisie du titre en ${Date.now() - t0} ms`,
  }
})

await rapport.test(win, 'sB-2-parcours', 'Numéroter un parcours, se tromper, revenir', async (capturer) => {
  await win.keyboard.press('n')
  await clic(400, 300)
  await clic(600, 400)
  await clic(760, 520)
  // « oups, la 3 n’est pas là » : Ctrl+Z puis repose
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(200)
  await clic(800, 300)
  await capturer('parcours')
  const liste = await traits()
  const badges = liste.filter((t) => t === 'badge').length
  noter('annuler : aucun retour visuel autre que la disparition du trait — sur une scène chargée on ne sait pas CE QUI est parti')
  return { statut: badges === 3 ? OK : 'CASSÉ', detail: `${badges} pastilles après Ctrl+Z + repose` }
})

await rapport.test(win, 'sB-3-montrer-puis-comparer', 'Montrer « ce qui s’est passé » par-dessus le plan', async (capturer) => {
  // Le coach veut garder le plan et montrer la réalité : aujourd’hui il n’a
  // que deux choix — dessiner PAR-DESSUS (illisible) ou TOUT EFFACER (le
  // plan est perdu). Il n’existe aucune notion de page.
  await win.keyboard.press('f')
  await tracer(win, segment(420, 320, 760, 500, 14))
  const avant = (await traits()).length
  await toutEffacer(win)
  const apres = (await traits()).length
  await capturer('apres-effacer')
  noter('aucune PAGE : pour montrer « ce qui s’est vraiment passé » il faut effacer le plan (perdu) ou dessiner par-dessus (illisible)')
  noter('« tout effacer » emporte aussi la légende/la carte qu’on voulait garder toute la session — pas d’épinglage')
  return { statut: avant > 0 && apres === 0 ? OK : 'CASSÉ', detail: `${avant} annotations → tout effacer → ${apres}` }
})

await rapport.test(win, 'sB-4-vingt-outils', 'Changer d’outil vingt fois au clavier', async () => {
  const touches = ['p', 's', 'l', 'f', 'r', 'o', 't', 'n', 'y', 'm', 'e', 'p', 'r', 'f', 'o', 'n', 'p', 'l', 't', 'p']
  const t0 = performance.now()
  let ok = 0
  for (const k of touches) {
    await win.keyboard.press(k)
    await win.waitForTimeout(40)
    const o = await outil()
    if (o) ok++
  }
  const dt = performance.now() - t0
  const n = await images(1500)
  noter('la barre reste PLEINE OPACITÉ pendant tout le dessin : en mode dessin sur une vidéo, elle masque en permanence un bord de l’écran')
  return { statut: ok === touches.length ? OK : 'CASSÉ', detail: `${ok}/${touches.length} bascules en ${Math.round(dt)} ms · ${n} image(s) rAF dans les 1,5 s qui suivent` }
})

await rapport.test(win, 'sB-5-gomme-et-texte', 'Gommer un mot, écrire un autre', async () => {
  await win.keyboard.press('t')
  await clic(500, 700)
  await win.keyboard.type('GANK BOT')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(300)
  await win.keyboard.press('e')
  await win.mouse.move(520, 700)
  await win.mouse.down()
  await win.mouse.move(560, 700, { steps: 3 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const liste = await traits()
  return { statut: liste.filter((t) => t === 'text').length === 0 ? OK : 'CASSÉ', detail: `textes restants : ${liste.filter((t) => t === 'text').length}` }
})

await rapport.test(win, 'sB-6-export', 'Exporter la carte en image : combien de gestes ?', async () => {
  // Aujourd’hui : bouton « Exporter » = JSON. Le PNG est dans Réglages →
  // Session → choisir l’échelle → « PNG ». Quatre gestes pour une miniature.
  const boutons = await win.evaluate(() =>
    [...document.querySelectorAll('.toolbar .tbtn')].map((b) => b.getAttribute('title') ?? ''),
  )
  const png = boutons.filter((t) => /png/i.test(t)).length
  noter(`export PNG : ${png} bouton dans la barre — il faut ouvrir les réglages (4 gestes) pour une miniature`)
  return { statut: OK, detail: `${boutons.length} boutons dans la barre, ${png} pour le PNG` }
})

await rapport.test(win, 'sB-7-repos', 'Au repos, avec la carte à l’écran : 0 image', async () => {
  await win.keyboard.press('r')
  await tracer(win, segment(300, 200, 900, 620, 10))
  await win.waitForTimeout(1200)
  const n = await images(3000)
  return { statut: n === 0 ? OK : 'CASSÉ', detail: `${n} image(s) rAF en 3 s avec une annotation posée (attendu 0)` }
})

process.stdout.write('\n--- frictions relevées ---\n' + frictions.map((f, i) => `${i + 1}. ${f}`).join('\n') + '\n')
process.stdout.write(`erreurs de page : ${journal.erreurs.length} · erreurs console : ${journal.consoleErreurs.length}\n`)
process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
