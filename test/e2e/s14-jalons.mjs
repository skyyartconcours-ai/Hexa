#!/usr/bin/env node
/**
 * Hexa — §S14 : L'OUTIL JALONS et la SUPPRESSION SOUS LE CURSEUR.
 *
 * Deux demandes, deux vérifications sur la vraie application.
 *
 * LES JALONS. « J'ai besoin d'un autre outil pour afficher des 1 2 3 4 5 mais
 * sans les relier par des flèches, un autre symbole, un autre outil, et de même
 * si je clique sur une couleur ça reset, et je peux reprendre au nombre en
 * question si je fais clic droit sur un nombre. » Le numéroteur raconte un
 * PARCOURS (relié) ; les jalons désignent des ENDROITS (jamais reliés). Les
 * deux compteurs sont indépendants — c'est le point le plus facile à casser.
 *
 * CTRL+D. Supprime l'annotation sous le curseur sans changer d'outil, et le
 * Ctrl+Z suivant la rend.
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures, toutEffacer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's14' })

/** Traits vivants du moteur, réduits à ce qui nous intéresse. */
const traits = () =>
  win.evaluate(() =>
    (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => ({
      tool: s.tool,
      badge: s.badge ?? null,
      link: s.linkFrom ?? null,
      color: s.color,
      dying: !!s.dying,
    })),
  )

const poser = async (x, y) => {
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.up()
  await win.waitForTimeout(120)
}

await etatDeDepart(win)

await rapport.test(win, 's14-1-outil-existe', 'L’outil Jalons existe dans la barre et au clavier', async () => {
  const bouton = await win.evaluate(() =>
    [...document.querySelectorAll('.toolbar .tbtn')].some((el) =>
      (el.getAttribute('title') ?? '').startsWith('Jalons'),
    ),
  )
  await win.keyboard.press('y')
  await win.waitForTimeout(160)
  const outil = await win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state.tool)
  return {
    statut: bouton && outil === 'marker' ? OK : KO,
    detail: `bouton dans la barre : ${bouton ? 'oui' : 'NON'} · touche Y → outil « ${outil} »`,
  }
})

await rapport.test(win, 's14-2-jamais-relies', 'Les jalons ne sont JAMAIS reliés', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('y')
  await poser(420, 300)
  await poser(620, 340)
  await poser(520, 460)
  await capturer('jalons')
  const t = (await traits()).filter((s) => !s.dying)
  const jalons = t.filter((s) => s.tool === 'marker')
  const relies = jalons.filter((s) => s.link != null).length
  const numeros = jalons.map((s) => s.badge).join(',')
  return {
    statut: jalons.length === 3 && relies === 0 && numeros === '1,2,3' ? OK : KO,
    detail: `${jalons.length} jalon(s) numérotés ${numeros} · reliés par une flèche : ${relies} (0 exigé — c'est toute la raison d'être de l'outil)`,
  }
})

await rapport.test(win, 's14-3-compteurs-separes', 'Numéroteur et jalons ne se marchent pas dessus', async () => {
  await toutEffacer(win)
  await win.keyboard.press('n') // numéroteur
  await poser(300, 250)
  await poser(400, 250)
  await win.keyboard.press('y') // jalons
  await poser(300, 500)
  await win.keyboard.press('n')
  await poser(500, 250)
  const t = (await traits()).filter((s) => !s.dying)
  const past = t.filter((s) => s.tool === 'badge').map((s) => s.badge).join(',')
  const jal = t.filter((s) => s.tool === 'marker').map((s) => s.badge).join(',')
  const liens = t.filter((s) => s.tool === 'badge' && s.link != null).length
  return {
    statut: past === '1,2,3' && jal === '1' && liens === 2 ? OK : KO,
    detail: `pastilles ${past} (1,2,3 attendu) · jalons ${jal} (1 attendu) · liens du numéroteur : ${liens} (2 attendus — le parcours, lui, reste relié)`,
  }
})

await rapport.test(win, 's14-4-reset-couleur', 'Changer de couleur remet les jalons à 1', async () => {
  await toutEffacer(win)
  await win.keyboard.press('y')
  await poser(350, 300)
  await poser(450, 300)
  await win.keyboard.press('4') // autre couleur
  await win.waitForTimeout(140)
  await poser(550, 300)
  const t = (await traits()).filter((s) => !s.dying && s.tool === 'marker')
  const suite = t.map((s) => s.badge).join(',')
  const couleurs = new Set(t.map((s) => s.color)).size
  return {
    statut: suite === '1,2,1' && couleurs === 2 ? OK : KO,
    detail: `numéros posés : ${suite} (1,2,1 attendu) sur ${couleurs} couleur(s)`,
  }
})

await rapport.test(win, 's14-5-reprise-clic-droit', 'Clic droit bref sur un jalon : la série repart de là', async () => {
  await toutEffacer(win)
  await win.keyboard.press('y')
  await poser(350, 300)
  await poser(450, 300)
  await poser(550, 300)
  // clic droit BREF sur le jalon n°1 : « repars de 1 » → le suivant portera 2
  await win.mouse.move(350, 300)
  await win.mouse.down({ button: 'right' })
  await win.mouse.up({ button: 'right' })
  await win.waitForTimeout(220)
  await poser(650, 300)
  const t = (await traits()).filter((s) => !s.dying && s.tool === 'marker')
  const suite = t.map((s) => s.badge).join(',')
  return {
    statut: suite === '1,2,3,2' ? OK : KO,
    detail: `numéros posés : ${suite} (1,2,3 puis reprise après le n°1 → 2 attendu)`,
  }
})

await rapport.test(win, 's14-6-ctrl-d', 'Ctrl+D supprime l’annotation sous le curseur, Ctrl+Z la rend', async () => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  // trois traits bien séparés
  for (const y of [250, 350, 450]) {
    await win.mouse.move(300, y)
    await win.mouse.down()
    await win.mouse.move(600, y, { steps: 6 })
    await win.mouse.up()
    await win.waitForTimeout(90)
  }
  const outilAvant = await win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state.tool)
  const avant = (await traits()).filter((s) => !s.dying).length
  // on vise le trait du milieu
  await win.mouse.move(450, 350)
  await win.keyboard.press('Control+d')
  await win.waitForTimeout(400)
  const apres = (await traits()).filter((s) => !s.dying).length
  const outilApres = await win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state.tool)
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(400)
  const rendu = (await traits()).filter((s) => !s.dying).length
  // rien sous le curseur : la touche ne doit RIEN emporter d'autre
  await win.mouse.move(1200, 800)
  await win.keyboard.press('Control+d')
  await win.waitForTimeout(300)
  const vide = (await traits()).filter((s) => !s.dying).length
  return {
    statut: avant === 3 && apres === 2 && rendu === 3 && vide === 3 && outilApres === outilAvant ? OK : KO,
    detail:
      `3 traits → Ctrl+D sur celui du milieu : ${apres} restants (2 attendus) · Ctrl+Z : ${rendu} (3 attendus) · ` +
      `Ctrl+D dans le vide : ${vide} (3 — rien ne doit partir) · outil inchangé : ${outilApres === outilAvant ? 'oui' : `NON (${outilAvant}→${outilApres})`}`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
