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

/* ================================================================== *
 * CTRL+D FACE AUX AUTRES MÉCANIQUES
 *
 * Ctrl+D est un raccourci de geste rapide, tapé sans regarder, en plein
 * direct. Il croise donc forcément les autres mécaniques d'Hexa — et c'est aux
 * croisements que les choses se cassent. Quatre croisements, quatre exigences.
 * ================================================================== */

/** Encre réellement peinte sur les canevas du moteur. */
const encrePeinte = () =>
  win.evaluate(() => {
    let n = 0
    for (const cv of document.querySelectorAll('.stage canvas')) {
      if (!cv.width || !cv.height) continue
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
    }
    return n
  })

/** Un trait franc, du point A au point B. */
const tracer = async (x0, y0, x1, y1) => {
  await win.mouse.move(x0, y0)
  await win.mouse.down()
  await win.mouse.move(x1, y1, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(250)
}

await rapport.test(win, 's14-7-ctrl-d-fondu', 'Ctrl+D ne touche pas à un trait DÉJÀ en train de disparaître', async () => {
  // Fondu court, par le vrai mécanisme de persistance.
  await etatDeDepart(win, { fadeDelay: 2000 })
  await toutEffacer(win)
  await win.keyboard.press('p')
  await win.waitForTimeout(150)
  await tracer(400, 300, 900, 460)
  const plein = await encrePeinte()

  /*
   * ⚠️ NI `exportSession()`, NI UNE MESURE EN DEUX TEMPS.
   *
   * `exportSession()` FILTRE volontairement les traits mourants
   * (`strokes.filter(s => !s.dying)`) : un trait en train de disparaître y est
   * déjà invisible, on ne peut donc rien y observer.
   *
   * Et « je constate l'état, puis j'appuie, puis je reconstate » ne prouve
   * rien non plus : une dissolution dure à peine plus d'une seconde, elle se
   * termine toute seule entre les deux mesures, et l'on ne saurait pas si le
   * trait est parti à cause du Ctrl+D ou de son propre fondu. Une première
   * version de ce test s'y est fait prendre.
   *
   * On rend donc la mesure ATOMIQUE : dans un seul aller-retour, on attend
   * l'état mourant, on appelle la suppression sous le curseur, et on lit sa
   * réponse. Aucun temps ne s'écoule entre les trois.
   */
  await win.mouse.move(650, 380)
  const verdict = await win.evaluate(
    () =>
      new Promise((res) => {
        const eng = window.hexaEngine
        const debut = performance.now()
        const guetter = () => {
          const l = eng?.strokes ?? []
          const mourants = l.filter((s) => !!s.dying).length
          if (mourants >= 1) {
            const avant = { total: l.length, mourants }
            // L'appel réel, à l'instant précis où le trait est mourant.
            const rendu = eng.supprimerSousLeCurseur()
            const apresL = eng.strokes ?? []
            res({
              saisi: true,
              avant,
              rendu,
              apres: { total: apresL.length, mourants: apresL.filter((s) => !!s.dying).length },
            })
            return
          }
          if (performance.now() - debut > 8000) {
            res({ saisi: false, avant: { total: l.length, mourants: 0 } })
            return
          }
          setTimeout(guetter, 25)
        }
        guetter()
      }),
  )

  // On laisse la dissolution finir : l'écran doit être net, sans reliquat.
  await win.waitForTimeout(2500)
  const apresFondu = await encrePeinte()

  // Et Ctrl+Z ne doit PAS ressusciter un trait que le fondu a emporté de
  // lui-même : le Ctrl+D n'a rien inscrit dans la pile d'annulation.
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(700)
  const apresZ = await encrePeinte()

  /*
   * L'EXIGENCE. Un trait qui s'efface DÉJÀ tout seul n'est pas une cible :
   * le supprimer par-dessus sa dissolution l'inscrirait dans la pile
   * d'annulation en plein fondu, et le Ctrl+Z suivant le ferait réapparaître
   * à moitié dissous — un fantôme à l'antenne.
   */
  const ok =
    plein > 2000 &&
    verdict.saisi === true &&
    verdict.rendu === false &&
    verdict.apres.total === verdict.avant.total &&
    apresFondu === 0 &&
    apresZ === 0
  return {
    statut: ok ? OK : KO,
    detail:
      `trait plein ${plein} px · saisi en dissolution : ${verdict.saisi} ` +
      `(${verdict.avant.total} vivant(s), ${verdict.avant.mourants} mourant(s)) · ` +
      `supprimerSousLeCurseur() a répondu ${verdict.rendu} (false exigé — une dissolution ` +
      `n'est pas une cible) · liste inchangée : ${verdict.apres?.total} trait(s) · ` +
      `fondu terminé : ${apresFondu} px · Ctrl+Z ensuite : ${apresZ} px (0 exigé — aucun ` +
      `fantôme ne doit revenir)`,
  }
})

await rapport.test(win, 's14-8-ctrl-d-apres-panique', 'Ctrl+D après la touche panique : rien, et surtout aucune erreur', async () => {
  await etatDeDepart(win)
  await toutEffacer(win)
  await win.keyboard.press('p')
  await win.waitForTimeout(150)
  await tracer(400, 300, 900, 460)
  const avant = (await traits()).length

  // Touche panique (Ctrl+Maj+X) : l'écran redevient net d'un coup.
  await win.keyboard.press('Control+Shift+x')
  await win.waitForTimeout(900)
  const apresPanique = await traits()

  // Ctrl+D exactement là où le trait se trouvait : il n'y a plus rien.
  await win.mouse.move(650, 380)
  await win.keyboard.press('Control+d')
  await win.waitForTimeout(300)
  const apresD = await traits()

  // Et Ctrl+Z doit toujours rendre ce que la panique avait pris — Ctrl+D dans
  // le vide ne doit pas s'être glissé dans l'historique.
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(600)
  const rendu = await encrePeinte()

  const ok = avant === 1 && apresPanique.length === 0 && apresD.length === 0 && rendu > 2000
  return {
    statut: ok ? OK : KO,
    detail:
      `${avant} trait posé · après la touche panique : ${apresPanique.length} · ` +
      `après Ctrl+D dans le vide : ${apresD.length} (0 exigé) · ` +
      `Ctrl+Z rend bien l’écran d’avant la panique : ${rendu} px (> 2000 exigé — Ctrl+D dans ` +
      `le vide ne doit pas s’être glissé dans l’historique)`,
  }
})

await rapport.test(win, 's14-9-ctrl-d-masquees', 'Ctrl+D ne supprime rien qu’on ne voit pas', async () => {
  await etatDeDepart(win)
  await toutEffacer(win)
  await win.keyboard.press('p')
  await win.waitForTimeout(150)
  await tracer(400, 300, 900, 460)
  const avant = (await traits()).length

  // Annotations masquées : « rien n'est perdu », dit l'info-bulle.
  await win.keyboard.press('Control+Shift+m')
  await win.waitForTimeout(700)
  const invisible = await encrePeinte()

  await win.mouse.move(650, 380)
  await win.keyboard.press('Control+d')
  await win.waitForTimeout(300)
  const pendant = (await traits()).length

  // On remontre : le trait doit être là, entier.
  await win.keyboard.press('Control+Shift+m')
  await win.waitForTimeout(800)
  const apres = (await traits()).length
  const revenu = await encrePeinte()

  /*
   * L'EXIGENCE, ET POURQUOI. Masquer, c'est mettre de côté sans rien perdre —
   * c'est ce que promet le bouton. Supprimer à l'aveugle une annotation qu'on
   * ne voit pas est le geste le plus irrattrapable de tout l'outil : rien ne
   * dit ce qui vient de partir, et en direct on ne s'en aperçoit qu'en
   * remontrant, trop tard. Ctrl+D ne vise donc QUE ce qui est à l'écran.
   */
  const ok = avant === 1 && invisible === 0 && pendant === 1 && apres === 1 && revenu > 2000
  return {
    statut: ok ? OK : KO,
    detail:
      `${avant} trait posé · masqué : ${invisible} px à l’écran · après Ctrl+D à l’aveugle : ` +
      `${pendant} trait(s) (1 exigé — on ne supprime pas ce qu’on ne voit pas) · ` +
      `remontré : ${apres} trait(s), ${revenu} px`,
  }
})

await rapport.test(win, 's14-10-jalon-annule', 'Annuler un jalon rend son numéro à la série', async () => {
  await etatDeDepart(win)
  await toutEffacer(win)
  await win.keyboard.press('y')
  await win.waitForTimeout(200)
  await poser(400, 300)
  await poser(520, 300)
  await poser(640, 300)
  const avant = (await traits()).map((s) => s.badge)

  await win.keyboard.press('Control+z')
  await win.waitForTimeout(500)
  const apresZ = (await traits()).map((s) => s.badge)

  // Le jalon suivant doit reprendre le numéro libéré, pas sauter à 4.
  await poser(760, 300)
  const apresPose = (await traits()).map((s) => s.badge)

  const ok =
    JSON.stringify(avant) === JSON.stringify([1, 2, 3]) &&
    JSON.stringify(apresZ) === JSON.stringify([1, 2]) &&
    JSON.stringify(apresPose) === JSON.stringify([1, 2, 3])
  return {
    statut: ok ? OK : KO,
    detail:
      `posés : ${JSON.stringify(avant)} · après Ctrl+Z : ${JSON.stringify(apresZ)} · ` +
      `jalon suivant : ${JSON.stringify(apresPose)} (1,2,3 attendus — le numéro annulé doit ` +
      `revenir, sinon la série trouerait à chaque hésitation)`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
