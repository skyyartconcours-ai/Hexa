#!/usr/bin/env node
/**
 * Hexa — §S13 : LE MASQUE NE TIENT PLUS L'ÉCRAN BRANCHÉ.
 *
 * LE DÉFAUT CORRIGÉ. Un masque flou relisait l'écran à CHAQUE image vidéo,
 * indéfiniment. Autrement dit : tant qu'un seul masque traînait à l'écran,
 * Hexa gardait une CAPTURE DE BUREAU PLEIN CADRE ouverte en permanence — un
 * second pipeline de capture, en plus de celui d'OBS. C'est exactement ce que
 * décrivait l'utilisateur : « OBS fait ramer le PC énormément, mais seulement
 * quand j'utilise l'outil ».
 *
 * CE QUE CE SCRIPT PROUVE, SUR LA VRAIE APPLICATION :
 *   1. le flux n'est PAS ouvert par le simple choix de l'outil flou ;
 *   2. il s'ouvre au geste de tracé, la plaque se forme normalement ;
 *   3. il s'ÉTEINT tout seul une fois la plaque stabilisée, alors que le
 *      masque est TOUJOURS à l'écran ;
 *   4. la zone reste couverte, au pixel près, après extinction ;
 *   5. plus une seule image n'est peinte ensuite (0 rAF sur 1,5 s) ;
 *   6. déplacer le masque rallume le flux, puis il se rendort.
 *
 * Le flux d'écran n'existant pas sous xvfb, on en INJECTE un
 * (`canvas.captureStream`) par le point d'entrée prévu — le chemin de code
 * exercé est rigoureusement celui de la production.
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's13' })

const fx = () => win.evaluate(() => window.hexaFx?.state() ?? null)

/** Pixels réellement peints par la couche du dessous (les plaques de masquage). */
const encreDessous = () =>
  win.evaluate(() => {
    const cv = document.querySelector('.fx-below canvas')
    if (!cv || !cv.width) return 0
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
    return n
  })

/** Images RÉELLEMENT demandées pendant `ms` — mesure passive, sans en créer. */
const imagesPendant = (ms) =>
  win.evaluate((duree) => {
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

await etatDeDepart(win)

// Flux de test : un canevas animé, donc une VRAIE MediaStream vivante.
await win.evaluate(() => {
  const cv = document.createElement('canvas')
  cv.width = 640
  cv.height = 360
  const c = cv.getContext('2d')
  let t = 0
  const peindre = () => {
    t += 1
    c.fillStyle = `hsl(${t % 360} 80% 55%)`
    c.fillRect(0, 0, 640, 360)
    c.fillStyle = '#fff'
    c.fillRect(t % 600, 40, 40, 40)
    setTimeout(peindre, 33)
  }
  peindre()
  window.hexaFx.useTestStream(cv.captureStream(30))
})
await win.waitForTimeout(400)

await rapport.test(win, 's13-1-choix-outil', 'Choisir l’outil flou n’ouvre pas l’écran', async () => {
  // On repart d'un état propre : pas de masque, outil pinceau.
  await win.keyboard.press('p')
  await win.waitForTimeout(250)
  await win.keyboard.press('b') // outil flou
  await win.waitForTimeout(1800) // au-delà du sursis d'extinction (1,2 s)
  const e = await fx()
  return {
    statut: e && e.tool === 'blur' && e.feed === false ? OK : KO,
    detail: `outil « ${e?.tool} » · flux ${e?.feed ? 'OUVERT (défaut)' : 'fermé'} — le flux ne doit s’ouvrir qu’au geste`,
  }
})

await rapport.test(win, 's13-2-plaque-puis-silence', 'La plaque se forme, puis l’écran se débranche', async () => {
  await win.mouse.move(420, 300)
  await win.mouse.down()
  await win.mouse.move(700, 460, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(350)
  const pendant = await fx()
  const pixPendant = await encreDessous()

  // Stabilisation (1,2 s) + sursis d'extinction du flux (1,2 s) + marge.
  await win.waitForTimeout(3200)
  const apres = await fx()
  const pixApres = await encreDessous()

  const ok =
    pendant?.masks === 1 &&
    pendant?.feed === true &&
    pixPendant > 20000 &&
    apres?.masks === 1 &&
    apres?.feed === false &&
    pixApres > 20000
  return {
    statut: ok ? OK : KO,
    detail:
      `pendant : ${pendant?.masks} masque, flux ${pendant?.feed ? 'ouvert' : 'FERMÉ'}, ${pixPendant} px couverts · ` +
      `après stabilisation : ${apres?.masks} masque TOUJOURS à l’écran, flux ${apres?.feed ? 'ENCORE OUVERT' : 'éteint'}, ${pixApres} px couverts`,
  }
})

await rapport.test(win, 's13-3-zero-image', 'Un masque posé ne coûte plus une seule image', async () => {
  const n = await imagesPendant(1500)
  return {
    statut: n === 0 ? OK : KO,
    detail: `${n} image(s) demandée(s) en 1,5 s avec un masque à l’écran (0 exigé)`,
  }
})

await rapport.test(win, 's13-4-deplacement', 'Déplacer le masque le refait vivre, puis il se rendort', async () => {
  await win.mouse.move(560, 380)
  await win.mouse.down({ button: 'right' })
  await win.mouse.move(620, 420, { steps: 6 })
  await win.waitForTimeout(120)
  const pendant = await fx()
  await win.mouse.up({ button: 'right' })
  await win.waitForTimeout(3400)
  const apres = await fx()
  const pixApres = await encreDessous()
  return {
    statut: pendant?.feed === true && apres?.feed === false && pixApres > 20000 ? OK : KO,
    detail:
      `pendant le déplacement : flux ${pendant?.feed ? 'rallumé' : 'ÉTEINT (la plaque resterait périmée)'} · ` +
      `après : flux ${apres?.feed ? 'ENCORE OUVERT' : 'éteint'}, ${pixApres} px couverts`,
  }
})

await rapport.test(win, 's13-5-retrait', 'Retirer le masque rend tout à zéro', async () => {
  await win.evaluate(() => window.hexaFx.clearMasks())
  await win.waitForTimeout(1800)
  const e = await fx()
  const pix = await encreDessous()
  return {
    statut: e?.masks === 0 && e?.feed === false && pix === 0 ? OK : KO,
    detail: `${e?.masks} masque · flux ${e?.feed ? 'OUVERT' : 'fermé'} · ${pix} px restants`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
