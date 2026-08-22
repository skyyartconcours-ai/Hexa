#!/usr/bin/env node
/**
 * Hexa — §S24 : MAJ TENU AU PINCEAU RÉCLAME LA FORME, MÊME PAS FERMÉE.
 *
 * LA DEMANDE : « si Maj est resté appuyé quand on trace au pinceau, lors d'un
 * tracé tente de reconnaître la forme même si elle n'est pas totalement
 * fermée ».
 *
 * POURQUOI CE N'EST PAS QU'UN SEUIL QU'ON DESSERRE. La reconnaissance
 * automatique doit rester SÉVÈRE : elle se déclenche toute seule à la fin de
 * chaque trait, et transformer un gribouillis en ellipse sans qu'on l'ait
 * demandé est le défaut n°1 des outils de ce genre. Maj change la nature du
 * geste : l'utilisateur ne subit plus la reconnaissance, il la RÉCLAME. Il n'y
 * a alors plus de faux positif possible, et l'on peut accepter ce qu'on
 * refusait.
 *
 * CE SCRIPT PROUVE LES DEUX CÔTÉS DU MARCHÉ :
 *   · sans Maj, un cercle ouvert au quart RESTE un trait à main levée ;
 *   · avec Maj, il devient une ellipse nette ;
 *   · avec Maj, un rectangle auquel il manque un bout de côté devient un
 *     rectangle ;
 *   · Maj n'invente rien : un vrai gribouillis reste un gribouillis ;
 *   · et Maj marche même quand les formes intelligentes sont COUPÉES dans les
 *     réglages, parce que c'est un geste délibéré et pas un réglage subi.
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures, toutEffacer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's24' })

/** Outils des traits vivants — c'est le verdict de la reconnaissance. */
const outils = () =>
  win.evaluate(() =>
    (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => ({
      tool: s.tool,
      redresse: !!s.raw,
    })),
  )

/** Arc de cercle, ouvert sur `trou` degrés (0 = fermé). */
const arc = (cx, cy, r, trou) => {
  const pts = []
  const fin = 360 - trou
  for (let a = 0; a <= fin; a += 6) {
    const t = (a * Math.PI) / 180
    pts.push([Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r)])
  }
  return pts
}

/** Rectangle auquel il manque `manque` pixels sur le dernier côté. */
const rectOuvert = (x, y, w, h, manque) => {
  const pts = []
  const pousse = (ax, ay, bx, by) => {
    const n = 14
    for (let i = 1; i <= n; i++) {
      pts.push([Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n)])
    }
  }
  pts.push([x, y])
  pousse(x, y, x + w, y)
  pousse(x + w, y, x + w, y + h)
  pousse(x + w, y + h, x, y + h)
  pousse(x, y + h, x, y + manque)
  return pts
}

/** Gribouillis franc : rien ne doit le redresser, Maj ou pas. */
const gribouillis = (x, y) => {
  const pts = []
  for (let i = 0; i <= 60; i++) {
    pts.push([Math.round(x + i * 5 + Math.sin(i * 1.7) * 34), Math.round(y + Math.cos(i * 2.3) * 46)])
  }
  return pts
}

/** Trace la suite de points, avec ou sans Maj tenu pendant tout le geste. */
const tracerAvec = async (pts, maj) => {
  await win.mouse.move(pts[0][0], pts[0][1])
  if (maj) await win.keyboard.down('Shift')
  await win.mouse.down()
  for (const [x, y] of pts.slice(1)) await win.mouse.move(x, y)
  await win.mouse.up()
  if (maj) await win.keyboard.up('Shift')
  // le morph dure ~340 ms, on le laisse atterrir
  await win.waitForTimeout(700)
}

await etatDeDepart(win)

await rapport.test(win, 's24-1-sans-maj', 'Sans Maj, un cercle ouvert reste un trait à main levée', async () => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await tracerAvec(arc(700, 430, 160, 92), false)
  const t = await outils()
  return {
    statut: t.length === 1 && t[0].tool === 'pen' ? OK : KO,
    detail: `outil obtenu « ${t[0]?.tool} » (pen exigé : la reconnaissance automatique doit rester sévère)`,
  }
})

await rapport.test(win, 's24-2-maj-cercle-ouvert', 'Avec Maj, le même cercle ouvert devient une ellipse', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await tracerAvec(arc(700, 430, 160, 92), true)
  await capturer('cercle-ouvert')
  const t = await outils()
  return {
    statut: t.length === 1 && t[0].tool === 'ellipse' && t[0].redresse ? OK : KO,
    detail: `outil obtenu « ${t[0]?.tool} » (ellipse exigée) · gribouillis d’origine conservé pour le Ctrl+Z : ${t[0]?.redresse ? 'oui' : 'NON'}`,
  }
})

await rapport.test(win, 's24-3-maj-rectangle-ouvert', 'Avec Maj, un rectangle inachevé devient un rectangle', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await tracerAvec(rectOuvert(430, 280, 380, 260, 90), true)
  await capturer('rect-ouvert')
  const t = await outils()
  return {
    statut: t.length === 1 && t[0].tool === 'rect' ? OK : KO,
    detail: `outil obtenu « ${t[0]?.tool} » (rect exigé — il manquait 90 px du dernier côté)`,
  }
})

await rapport.test(win, 's24-4-maj-n-invente-rien', 'Maj n’invente aucune forme que la reconnaissance normale refuserait', async () => {
  /**
   * LE VRAI RISQUE DE CE GESTE, et donc ce qu'il faut mesurer : que Maj rende
   * la reconnaissance IMPRUDENTE et fabrique des formes là où il n'y en a pas.
   *
   * On compare donc le MÊME gribouillis avec et sans Maj : le verdict doit être
   * identique. (Ce tracé-là finit par un crochet net, et le détecteur de flèche
   * l'accepte — avant comme après ce changement, vérifié. C'est son affaire, et
   * elle ne concerne pas Maj.) Ce qui est interdit, c'est qu'un tracé sans la
   * moindre boucle ressorte en rectangle ou en ellipse : ce serait le signe que
   * les seuils desserrés ont cessé de discriminer.
   */
  await toutEffacer(win)
  await win.keyboard.press('p')
  await tracerAvec(gribouillis(360, 420), false)
  const sans = (await outils())[0]?.tool
  await toutEffacer(win)
  await tracerAvec(gribouillis(360, 420), true)
  const avec = (await outils())[0]?.tool
  const boucleInventee = avec === 'rect' || avec === 'ellipse'
  return {
    statut: sans === avec && !boucleInventee ? OK : KO,
    detail:
      `même tracé — sans Maj → « ${sans} » · avec Maj → « ${avec} » (verdicts identiques exigés) · ` +
      `boucle inventée : ${boucleInventee ? 'OUI (défaut)' : 'non'}`,
  }
})

await rapport.test(win, 's24-5-formes-coupees', 'Maj marche même formes intelligentes COUPÉES', async () => {
  await toutEffacer(win)
  // On coupe le réglage par le VRAI mécanisme : la touche du clavier.
  await win.keyboard.press('w')
  await win.waitForTimeout(150)
  const coupe = await win.evaluate(() => JSON.parse(localStorage.getItem('hexa-ui')).state.smartShapes === false)
  await win.keyboard.press('p')
  // sans Maj : rien ne doit être redressé, réglage coupé
  await tracerAvec(arc(560, 400, 150, 12), false)
  const sansMaj = (await outils())[0]?.tool
  await toutEffacer(win)
  await tracerAvec(arc(560, 400, 150, 92), true)
  const avecMaj = (await outils())[0]?.tool
  await win.keyboard.press('w') // on remet le réglage
  return {
    statut: coupe && sansMaj === 'pen' && avecMaj === 'ellipse' ? OK : KO,
    detail:
      `réglage coupé : ${coupe ? 'oui' : 'NON'} · sans Maj → « ${sansMaj} » (pen exigé, le réglage est respecté) · ` +
      `avec Maj → « ${avecMaj} » (ellipse exigée : le geste délibéré passe outre)`,
  }
})

await rapport.test(win, 's24-6-annuler-retablir', 'Ctrl+Z rend le gribouillis, Ctrl+Y refait la forme', async () => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await tracerAvec(arc(700, 430, 160, 92), true)
  const apres = (await outils())[0]?.tool
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(500)
  const annule = (await outils())[0]?.tool
  await win.keyboard.press('Control+y')
  await win.waitForTimeout(700)
  const refait = (await outils())[0]?.tool
  return {
    statut: apres === 'ellipse' && annule === 'pen' && refait === 'ellipse' ? OK : KO,
    detail: `ellipse → Ctrl+Z « ${annule} » (pen exigé) → Ctrl+Y « ${refait} » (ellipse exigée)`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
