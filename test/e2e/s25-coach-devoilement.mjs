#!/usr/bin/env node
/**
 * Hexa — §S25 : DÉVOILEMENT PAS À PAS, CALQUE FANTÔME, DUO DE COULEURS.
 *
 * Trois demandes du coach, et pour chacune ce qui pourrait casser :
 *
 *  · DÉVOILEMENT : on dessine tout, puis Espace révèle une annotation à la
 *    fois dans l'ordre du tracé. Le miroir OBS doit suivre (les spectateurs
 *    découvrent au même rythme), les épinglées restent visibles, et la
 *    dernière révélée termine le mode.
 *  · FANTÔME : la page précédente en filigrane sous la courante. Des pixels
 *    SEMI-transparents là où la page 1 a dessiné, et rien si on l'éteint.
 *  · DUO : Tab échange la couleur courante et la précédente. LA RÈGLE QUI
 *    COMPTE, mot pour mot : « vérifie que ça continue bien sur le nœud que je
 *    déplace en clic droit quand c'est les nombres qui se suivent dans la
 *    couleur en question ». Donc : bleu 1, 2 → Tab → rouge 1, 2 → Tab → bleu
 *    reprend à 3 (pas à 1). Et un clic droit bref sur le nœud bleu 1 alors que
 *    le rouge est actif REVIENT au bleu et continue à 2.
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures, toutEffacer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's25' })

const traits = () =>
  win.evaluate(() =>
    (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => ({
      tool: s.tool,
      badge: s.badge ?? null,
      color: s.color,
      pinned: !!s.pinned,
    })),
  )
const etatStore = () => win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state)
const devoilement = () => win.evaluate(() => window.hexaEngine?.devoilement ?? null)
/** pixels du canevas statique : opaques (> 200) et semi-transparents (8..120) */
const pixels = () =>
  win.evaluate(() => {
    const cv = document.querySelector('.stage canvas')
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let opaques = 0
    let voiles = 0
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 200) opaques++
      else if (d[i] > 8 && d[i] < 120) voiles++
    }
    return { opaques, voiles }
  })
const poser = async (x, y) => {
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.up()
  await win.waitForTimeout(140)
}
const trait = async (x1, y1, x2, y2) => {
  await win.mouse.move(x1, y1)
  await win.mouse.down()
  await win.mouse.move(x2, y2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(160)
}
const attendreStatique = () => win.waitForTimeout(450)

await etatDeDepart(win)

/* ------------------------------------------------------------------ *
 * DUO DE COULEURS
 * ------------------------------------------------------------------ */

await rapport.test(win, 's25-1-tab-echange', 'Tab échange la couleur courante et la précédente', async () => {
  await toutEffacer(win)
  await win.keyboard.press('1') // cyan
  await win.keyboard.press('2') // magenta → précédente = cyan
  await win.waitForTimeout(120)
  const avant = await etatStore()
  await win.keyboard.press('Tab')
  await win.waitForTimeout(120)
  const apres = await etatStore()
  await win.keyboard.press('Tab')
  await win.waitForTimeout(120)
  const retour = await etatStore()
  const ok =
    avant.color !== avant.prevColor &&
    apres.color === avant.prevColor &&
    apres.prevColor === avant.color &&
    retour.color === avant.color
  return {
    statut: ok ? OK : KO,
    detail: `${avant.color}/${avant.prevColor} → Tab → ${apres.color}/${apres.prevColor} → Tab → ${retour.color}`,
  }
})

await rapport.test(win, 's25-2-series-par-couleur', 'Chaque couleur reprend sa numérotation là où elle en était', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('n') // numéroteur
  await win.keyboard.press('1')
  await poser(300, 300)
  await poser(400, 300) // bleu 1, 2
  await win.keyboard.press('2')
  await poser(300, 500)
  await poser(400, 500) // rouge 1, 2
  await win.keyboard.press('Tab') // retour au cyan
  await poser(500, 300) // doit être bleu 3
  await win.keyboard.press('Tab') // retour au magenta
  await poser(500, 500) // doit être rouge 3
  await capturer('series')
  const t = (await traits()).filter((s) => s.tool === 'badge')
  const cyan = t.filter((s) => s.color === '#00e5ff').map((s) => s.badge).join(',')
  const magenta = t.filter((s) => s.color === '#ff2d95').map((s) => s.badge).join(',')
  return {
    statut: cyan === '1,2,3' && magenta === '1,2,3' ? OK : KO,
    detail: `cyan ${cyan} (1,2,3 attendu) · magenta ${magenta} (1,2,3 attendu) — avant, revenir au cyan repartait à 1`,
  }
})

await rapport.test(win, 's25-3-reprise-noeud-autre-couleur', 'Clic droit bref sur un nœud bleu pendant que le rouge est actif : on repart en bleu', async () => {
  await toutEffacer(win)
  await win.keyboard.press('n')
  await win.keyboard.press('1')
  await poser(300, 300)
  await poser(400, 300)
  await poser(500, 300) // bleu 1, 2, 3
  await win.keyboard.press('2') // rouge actif
  await poser(300, 500) // rouge 1
  // clic droit BREF sur le nœud bleu n°1
  await win.mouse.move(300, 300)
  await win.mouse.down({ button: 'right' })
  await win.mouse.up({ button: 'right' })
  await win.waitForTimeout(260)
  const couleurApres = (await etatStore()).color
  await poser(650, 300) // doit être bleu 2
  const t = (await traits()).filter((s) => s.tool === 'badge')
  const dernier = t[t.length - 1]
  return {
    statut: couleurApres === '#00e5ff' && dernier?.color === '#00e5ff' && dernier?.badge === 2 ? OK : KO,
    detail: `couleur après la reprise : ${couleurApres} (cyan attendu) · pastille posée : ${dernier?.badge} en ${dernier?.color} (2 en cyan attendu)`,
  }
})

/* ------------------------------------------------------------------ *
 * DÉVOILEMENT
 * ------------------------------------------------------------------ */

await rapport.test(win, 's25-4-devoilement', 'Ctrl+Maj+R cache tout, Espace révèle une annotation à la fois', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await trait(300, 250, 600, 250)
  await trait(300, 350, 600, 350)
  await trait(300, 450, 600, 450)
  await attendreStatique()
  const plein = (await pixels()).opaques
  await win.keyboard.press('Control+Shift+r')
  await attendreStatique()
  const d0 = await devoilement()
  const p0 = (await pixels()).opaques
  await win.keyboard.press('Space')
  await attendreStatique()
  const d1 = await devoilement()
  const p1 = (await pixels()).opaques
  await capturer('un-sur-trois')
  await win.keyboard.press('Shift+Space')
  await attendreStatique()
  const d1b = await devoilement()
  await win.keyboard.press('Space')
  await win.keyboard.press('Space')
  await win.keyboard.press('Space')
  await attendreStatique()
  const dFin = await devoilement()
  const pFin = (await pixels()).opaques
  const ok =
    plein > 3000 &&
    d0?.montres === 0 && d0?.total === 3 && p0 === 0 &&
    d1?.montres === 1 && p1 > 900 && p1 < plein * 0.5 &&
    d1b?.montres === 0 &&
    dFin === null && pFin === plein
  return {
    statut: ok ? OK : KO,
    detail:
      `3 traits = ${plein} px · dévoilement ${d0?.montres}/${d0?.total} → ${p0} px · Espace → ${d1?.montres}/3, ${p1} px · ` +
      `Maj+Espace → ${d1b?.montres} · 3 Espaces → mode ${dFin === null ? 'terminé' : 'ENCORE ACTIF'}, ${pFin} px`,
  }
})

await rapport.test(win, 's25-5-devoilement-epingle', 'Une annotation épinglée reste visible pendant le dévoilement', async () => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await trait(300, 250, 600, 250) // sera épinglée
  await trait(300, 400, 600, 400)
  await attendreStatique()
  // Ctrl + clic droit : épingler la première
  await win.mouse.move(450, 250)
  await win.keyboard.down('Control')
  await win.mouse.down({ button: 'right' })
  await win.mouse.up({ button: 'right' })
  await win.keyboard.up('Control')
  await win.waitForTimeout(600)
  const t = await traits()
  await win.keyboard.press('Control+Shift+r')
  await attendreStatique()
  const d = await devoilement()
  const p = (await pixels()).opaques
  await win.keyboard.press('Control+Shift+r') // on sort
  await attendreStatique()
  const epinglees = t.filter((s) => s.pinned).length
  return {
    statut: epinglees === 1 && d?.total === 1 && p > 900 ? OK : KO,
    detail: `${epinglees} épinglée · dévoilement sur ${d?.total} trait (1 attendu : l'épinglée n'en fait pas partie) · ${p} px visibles à 0 révélé (l'épinglée)`,
  }
})

/* ------------------------------------------------------------------ *
 * CALQUE FANTÔME
 * ------------------------------------------------------------------ */

await rapport.test(win, 's25-6-fantome', 'Ctrl+Maj+F : la page précédente apparaît en filigrane, et disparaît quand on le coupe', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await trait(300, 300, 700, 300) // page 1
  await attendreStatique()
  await win.keyboard.press('Control+Shift+n') // page 2, vide
  await attendreStatique()
  const sans = await pixels()
  await win.keyboard.press('Control+Shift+f')
  await attendreStatique()
  const avec = await pixels()
  await capturer('fantome')
  await win.keyboard.press('Control+Shift+f')
  await attendreStatique()
  const retire = await pixels()
  const ok = sans.voiles < 50 && sans.opaques === 0 && avec.voiles > 800 && avec.opaques < 50 && retire.voiles < 50
  return {
    statut: ok ? OK : KO,
    detail: `page 2 vide : ${sans.voiles} px voilés · fantôme : ${avec.voiles} px voilés, ${avec.opaques} opaques (filigrane, pas plein) · retiré : ${retire.voiles} px`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
