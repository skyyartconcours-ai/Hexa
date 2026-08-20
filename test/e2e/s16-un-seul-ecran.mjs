#!/usr/bin/env node
/**
 * Hexa — §S16 : RIEN N'EST TRACÉ NI CALCULÉ HORS DE L'ÉCRAN D'ANNOTATION.
 *
 * LE DÉFAUT CORRIGÉ, dans les mots de l'utilisateur : « y'a un bug sur le 2ème
 * écran, ça trace des traits en continu, et c'est peut-être pour ça qu'OBS
 * galère car ça calculait des tracés qui ne s'affichaient pas ».
 *
 * Il avait raison. Hexa monte une couche d'encre PAR ÉCRAN, et en mode jeu
 * Windows transmet les mouvements de souris à TOUTES les fenêtres
 * (`setIgnoreMouseEvents(true, { forward: true })` — c'est ce qui permet au
 * laser et à la loupe de suivre le curseur pendant qu'on joue). Le moteur du
 * deuxième écran empilait donc des points de traînée laser et réveillait sa
 * boucle d'affichage à chaque pixel parcouru. Et comme une couche qui a du
 * contenu cesse d'être cachée (§2.5), sa fenêtre redevenait COMPOSÉE par
 * Windows — un coût payé par OBS, qui capture l'écran.
 *
 * CE SCRIPT PILOTE LA VRAIE APPLICATION, avec la page forcée en « écran qui
 * n'annote pas » (?annotation=0, le même chemin de code que l'argument de
 * lancement --hexa-annotation=0), et exige des ZÉROS :
 *   1. aucune image demandée pendant que la souris traverse l'écran ;
 *   2. aucun pixel peint, quel que soit l'outil ;
 *   3. aucun canevas alloué (la mémoire est rendue) ;
 *   4. aucun flux de capture d'écran ouvert ;
 *   5. la couche déclare n'avoir aucun contenu — donc sa fenêtre se retire ;
 *   6. et l'écran d'annotation, lui, continue de tout faire normalement.
 */
import { KO, OK, Rapport, lancerHexa, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's16' })

/** Images RÉELLEMENT demandées pendant `ms` — mesure passive, sans en créer. */
const imagesPendant = (page, ms) =>
  page.evaluate((duree) => {
    const vrai = window.requestAnimationFrame
    let n = 0
    window.requestAnimationFrame = function (cb) {
      n++
      return vrai.call(window, cb)
    }
    return new Promise((res) => {
      setTimeout(() => {
        window.requestAnimationFrame = vrai
        res(n)
      }, duree)
    })
  }, ms)

/** Pixels peints sur TOUS les canevas de la page, et pixels alloués. */
const pixels = (page) =>
  page.evaluate(() => {
    let peints = 0
    let alloues = 0
    for (const cv of document.querySelectorAll('canvas')) {
      alloues += cv.width * cv.height
      if (!cv.width || !cv.height) continue
      const d = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data
      if (!d) continue
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) peints++
    }
    return { peints, alloues }
  })

/** Promène la souris comme un joueur qui traverse l'écran. */
const promener = async (page) => {
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(120 + i * 55, 200 + (i % 2 ? 180 : 40))
  }
}

const etatDepart = {
  onboarded: true,
  fadeDelay: null,
  color: '#00e5ff',
  size: 6,
  theme: 'neon-nuit',
  sound: false,
  toolbarVisible: true,
}

/** Recharge la page dans un rôle donné : écran d'annotation, ou non. */
const charger = async (page, annotation, tool) => {
  await page.evaluate(
    (p) => localStorage.setItem('hexa-ui', JSON.stringify({ state: { ...p.etat, tool: p.tool }, version: 0 })),
    { etat: etatDepart, tool },
  )
  const url = new URL(page.url())
  url.searchParams.set('annotation', annotation ? '1' : '0')
  await page.goto(url.toString())
  await page.waitForSelector('.stage', { timeout: 20000 })
  await page.waitForTimeout(900)
}

/* ------------------------------------------------------------------ *
 * 1. LE DÉFAUT HISTORIQUE, OUTIL PAR OUTIL
 * ------------------------------------------------------------------ */

const OUTILS = ['laser', 'spotlight', 'magnifier', 'ping', 'pen', 'eraser', 'blur']

for (const outil of OUTILS) {
  await rapport.test(win, `s16-1-${outil}`, `Écran secondaire, outil « ${outil} » : zéro`, async () => {
    await charger(win, false, outil)
    await promener(win)
    const images = await imagesPendant(win, 1200)
    await promener(win)
    const { peints, alloues } = await pixels(win)
    const fx = await win.evaluate(() => window.hexaFx?.state() ?? null)
    const contenu = await win.evaluate(() => window.hexaEngine?.hasContent ?? null)
    const ok = images === 0 && peints === 0 && alloues === 0 && fx?.feed === false && contenu === false
    return {
      statut: ok ? OK : KO,
      detail:
        `${images} image(s) demandée(s) en 1,2 s · ${peints} pixel(s) peint(s) · ` +
        `${alloues} pixel(s) de canevas alloué(s) · flux d’écran ${fx?.feed ? 'OUVERT' : 'fermé'} · ` +
        `hasContent = ${contenu} (false exigé, sinon la fenêtre reste composée par Windows)`,
    }
  })
}

/* ------------------------------------------------------------------ *
 * 2. LE CLIC LUI-MÊME NE DOIT RIEN TRACER
 * ------------------------------------------------------------------ */

await rapport.test(win, 's16-2-clic-inerte', 'Écran secondaire : même un vrai tracé ne pose rien', async () => {
  await charger(win, false, 'pen')
  await win.mouse.move(400, 300)
  await win.mouse.down()
  await win.mouse.move(900, 480, { steps: 14 })
  await win.mouse.up()
  await win.waitForTimeout(600)
  const { peints, alloues } = await pixels(win)
  const traits = await win.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)
  const images = await imagesPendant(win, 900)
  return {
    statut: peints === 0 && alloues === 0 && traits === 0 && images === 0 ? OK : KO,
    detail: `${traits} trait(s) posé(s) (0 exigé) · ${peints} pixel(s) peint(s) · ${alloues} alloué(s) · ${images} image(s)`,
  }
})

/* ------------------------------------------------------------------ *
 * 3. L'ÉCRAN D'ANNOTATION, LUI, FAIT TOUT NORMALEMENT
 * ------------------------------------------------------------------ */

await rapport.test(win, 's16-3-ecran-principal', 'Écran d’annotation : rien n’a été perdu', async () => {
  await charger(win, true, 'pen')
  await win.mouse.move(400, 300)
  await win.mouse.down()
  await win.mouse.move(900, 480, { steps: 14 })
  await win.mouse.up()
  await win.waitForTimeout(600)
  const { peints, alloues } = await pixels(win)
  const traits = await win.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)
  const contenu = await win.evaluate(() => window.hexaEngine?.hasContent ?? null)
  return {
    statut: traits === 1 && peints > 2000 && alloues > 0 && contenu === true ? OK : KO,
    detail: `${traits} trait posé · ${peints} pixel(s) peint(s) · ${alloues} alloué(s) · hasContent = ${contenu}`,
  }
})

/* ------------------------------------------------------------------ *
 * 4. LA BASCULE À CHAUD, DANS LES DEUX SENS
 * ------------------------------------------------------------------ */

await rapport.test(win, 's16-4-bascule-a-chaud', 'Changer d’écran d’annotation prend effet sur-le-champ', async () => {
  // On part de l'écran d'annotation, avec un VRAI trait à l'écran (le laser ne
  // laisse rien : c'est un effet, pas une annotation).
  await charger(win, true, 'pen')
  await win.mouse.move(400, 300)
  await win.mouse.down()
  await win.mouse.move(800, 420, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(400)

  // Le processus principal retire la désignation à cet écran.
  await win.evaluate(() => window.__hexaTestEcranAnnotation?.(false))
  await win.waitForTimeout(500)
  await promener(win)
  const imagesEteint = await imagesPendant(win, 1000)
  const eteint = await pixels(win)
  const contenuEteint = await win.evaluate(() => window.hexaEngine?.hasContent ?? null)

  // …puis la lui rend.
  await win.evaluate(() => window.__hexaTestEcranAnnotation?.(true))
  await win.waitForTimeout(600)
  const rallume = await pixels(win)
  const traits = await win.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)

  const ok =
    imagesEteint === 0 &&
    eteint.peints === 0 &&
    eteint.alloues === 0 &&
    contenuEteint === false &&
    rallume.alloues > 0 &&
    traits >= 1
  return {
    statut: ok ? OK : KO,
    detail:
      `éteint : ${imagesEteint} image(s), ${eteint.peints} pixel(s), ${eteint.alloues} alloué(s), hasContent ${contenuEteint} · ` +
      `rallumé : ${rallume.alloues} pixel(s) alloué(s), ${traits} trait(s) RETROUVÉ(S) (les annotations ne doivent pas être perdues)`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
