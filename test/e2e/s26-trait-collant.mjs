#!/usr/bin/env node
/**
 * Hexa — §S26 : LE TRAIT QUI SUIT LA SOURIS.
 *
 * Vu en vrai par le coach : il ouvre les réglages, revient, et « un trait suit
 * partout ma souris ». La fenêtre d'interface a pris la main pendant un tracé,
 * la fenêtre d'encre n'a JAMAIS reçu le pointerup, et le trait en cours est
 * resté accroché au curseur — chaque mouvement l'allongeait.
 *
 * La règle : dès qu'un mouvement arrive SANS bouton enfoncé, le tracé en cours
 * est refermé, quoi qu'il se soit passé entre-temps. Idem pour une annotation
 * attrapée au clic droit.
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures, toutEffacer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's26' })

const traits = () =>
  win.evaluate(() => (window.hexaEngine?.exportSession?.().strokes ?? []).map((s) => s.tool))
/** un tracé est-il encore accroché au curseur ? (`current` / `grabbed` du moteur) */
const accroche = () =>
  win.evaluate(() => ({
    current: !!window.hexaEngine?.current,
    grabbed: !!window.hexaEngine?.grabbed,
  }))
/** un mouvement de souris SANS bouton, tel que la fenêtre le reçoit après un pointerup perdu */
const mouvementSansBouton = (x, y) =>
  win.evaluate(
    ([cx, cy]) => {
      const cible = document.querySelector('.stage') ?? document.body
      cible.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          clientX: cx,
          clientY: cy,
          buttons: 0,
        }),
      )
    },
    [x, y],
  )

await etatDeDepart(win)

await rapport.test(win, 's26-1-pointerup-perdu', 'Un mouvement sans bouton referme le tracé en cours', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await win.mouse.move(300, 300)
  await win.mouse.down()
  await win.mouse.move(420, 360, { steps: 6 })
  const pendant = await accroche()
  // le pointerup n'arrive jamais ; à la place, la souris bouge sans bouton
  await mouvementSansBouton(430, 370)
  await win.waitForTimeout(120)
  const apres = await accroche()
  const nApres = (await traits()).length
  // la souris continue de se promener : rien ne doit s'ajouter ni s'allonger
  await mouvementSansBouton(600, 500)
  await mouvementSansBouton(700, 200)
  await win.waitForTimeout(160)
  await capturer('apres')
  const nFin = (await traits()).length
  const encore = await accroche()
  await win.mouse.up() // Playwright croit encore le bouton enfoncé : on le relâche
  await win.waitForTimeout(120)
  const ok = pendant.current && !apres.current && !encore.current && nApres === 1 && nFin === 1
  return {
    statut: ok ? OK : KO,
    detail: `accroché pendant le geste : ${pendant.current} · après un mouvement sans bouton : ${apres.current} · traits : ${nApres} puis ${nFin} (1 attendu)`,
  }
})

await rapport.test(win, 's26-2-noeud-attrape-lache', 'Une annotation attrapée au clic droit se dépose dès que le bouton est absent', async () => {
  await toutEffacer(win)
  await win.keyboard.press('n') // numéroteur
  await win.mouse.move(400, 400)
  await win.mouse.down()
  await win.mouse.up()
  await win.waitForTimeout(160)
  // clic droit maintenu : la pastille est attrapée
  await win.mouse.move(400, 400)
  await win.mouse.down({ button: 'right' })
  await win.mouse.move(460, 430, { steps: 4 })
  const pendant = await accroche()
  // le bouton droit est « perdu » : un mouvement sans aucun bouton arrive
  await mouvementSansBouton(470, 440)
  await win.waitForTimeout(120)
  const apres = await accroche()
  await mouvementSansBouton(800, 600)
  await win.waitForTimeout(120)
  const position = await win.evaluate(() => {
    const s = (window.hexaEngine?.exportSession?.().strokes ?? []).find((t) => t.tool === 'badge')
    const p = s?.points?.[0] ?? s?.pts?.[0] ?? null
    return p ? { x: Math.round(p.x ?? p[0]), y: Math.round(p.y ?? p[1]) } : null
  })
  await win.mouse.up({ button: 'right' })
  await win.waitForTimeout(120)
  const ok = pendant.grabbed && !apres.grabbed && position != null && position.x < 600
  return {
    statut: ok ? OK : KO,
    detail: `attrapée pendant le geste : ${pendant.grabbed} · encore attrapée après un mouvement sans bouton : ${apres.grabbed} · déposée en ${position ? `${position.x},${position.y}` : '?'} (loin de 800,600 attendu)`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
