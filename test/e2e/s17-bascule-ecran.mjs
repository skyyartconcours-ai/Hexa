#!/usr/bin/env node
/**
 * Hexa — §S17 : LA BASCULE D'ÉCRAN D'ANNOTATION, SOUS CONTRAINTE.
 *
 * §S16 prouve qu'un écran qui n'annote pas ne trace rien et ne calcule rien.
 * Il le prouve AU REPOS. Ce fichier-ci prouve la même chose PENDANT QUE
 * QUELQUE CHOSE SE PASSE — c'est là que les bascules se cassent :
 *
 *   PARTIE 1, PROCESSUS PRINCIPAL, DEUX ÉCRANS RÉELS (émission des vrais
 *   événements `screen`, comme §S9). Le mode dessin est une propriété de la
 *   FENÊTRE, pas de la page : quand la désignation change d'écran, la fenêtre
 *   de l'ancien écran doit rendre la souris au jeu. Sinon elle reste affichée
 *   plein écran, elle AVALE TOUS LES CLICS, et son moteur — devenu inerte — ne
 *   dessine rien : l'utilisateur ne peut plus ni annoter ni cliquer dans son
 *   jeu, en plein direct. C'est le scénario le plus grave de tout le projet.
 *
 *   PARTIE 2, UNE PAGE, LA BASCULE EN PLEIN GESTE : au milieu d'un tracé,
 *   pendant une dissolution, avec un panneau ouvert, avec la loupe allumée et
 *   son flux d'écran ouvert, et avec des masques flous figés à l'écran. Chaque
 *   fois : zéro image, zéro pixel, zéro canevas, zéro flux — puis retour à la
 *   normale sans rien avoir perdu.
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { KO, OK, Rapport, CAPTURES, RACINE, chargerPilote, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const electron = await chargerPilote()

const USER = join(CAPTURES, '.user-data-s17')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })

const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
  // MODE FUSIONNÉ : une fenêtre par écran. On mesure ici le comportement des
  // FENÊTRES et de leur moteur ; la séparation encre/interface a ses propres
  // tests (couches.mjs).
  env: { ...process.env, HEXA_FUSION: '1' },
})

const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('.stage canvas', { timeout: 20000 })
await win.waitForTimeout(1000)

const journal = () => {
  const p = join(USER, 'hexa.log')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/** Les overlays vus depuis le processus principal (id, bounds, visibilité). */
const overlays = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && !w.webContents.getURL().startsWith('data:'))
      .map((w) => ({ id: w.id, bounds: w.getBounds(), visible: w.isVisible() })),
  )

/**
 * Une page est-elle en MODE DESSIN ? C'est l'observable qui compte : la classe
 * `passthrough` sur `body` est posée par le message 'set-draw' du processus
 * principal, donc elle dit exactement ce que la FENÊTRE fait de la souris.
 * Absente = la fenêtre avale les clics.
 */
const enDessin = (page) => page.evaluate(() => !document.body.classList.contains('passthrough'))

/** Cette page se croit-elle sur l'écran d'annotation ? */
const annote = (page) => page.evaluate(() => window.hexaEngine?.actif ?? null)

/** Retrouve la page d'un écran par l'abscisse de sa fenêtre. */
const pageDeLEcran = async (x) => {
  for (const p of app.windows()) {
    if (p.url().startsWith('data:')) continue
    const ok = await p.evaluate(() => window.screenX ?? -1).catch(() => -1)
    if (ok === x) return p
  }
  return null
}

const pause = (ms) => win.waitForTimeout(ms)

/* ================================================================== *
 * PARTIE 1 — DEUX ÉCRANS, LE PROCESSUS PRINCIPAL À L'ŒUVRE
 * ================================================================== */

// Second écran branché à chaud, exactement comme §S9 : on remplace
// `screen.getAllDisplays` puis on émet le VRAI événement 'display-added'.
await app.evaluate(({ screen }) => {
  const faux = {
    id: 990017,
    label: 'HEXA-S17-2',
    bounds: { x: 1600, y: 0, width: 1280, height: 720 },
    workArea: { x: 1600, y: 0, width: 1280, height: 680 },
    workAreaSize: { width: 1280, height: 680 },
    size: { width: 1280, height: 720 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    touchSupport: 'unknown',
    accelerometerSupport: 'unknown',
    colorDepth: 24,
    colorSpace: '{}',
    depthPerComponent: 8,
    displayFrequency: 60,
    monochrome: false,
    detected: true,
    maximumCursorSize: { width: 0, height: 0 },
    nativeOrigin: { x: 1600, y: 0 },
  }
  const troisieme = {
    ...faux,
    id: 990018,
    label: 'HEXA-S17-3',
    bounds: { x: 2880, y: 0, width: 1280, height: 720 },
    workArea: { x: 2880, y: 0, width: 1280, height: 680 },
    nativeOrigin: { x: 2880, y: 0 },
  }
  const vrai = screen.getAllDisplays.bind(screen)
  globalThis.__vrai = vrai
  globalThis.__faux = faux
  globalThis.__troisieme = troisieme
  globalThis.__actif = true
  globalThis.__trois = false
  globalThis.__vraiPrimaire = screen.getPrimaryDisplay.bind(screen)
  screen.getAllDisplays = () => {
    const l = vrai()
    if (globalThis.__actif) l.push(faux)
    if (globalThis.__trois) l.push(troisieme)
    return l
  }
  screen.emit('display-added', {}, faux)
})
await pause(1800)

await rapport.test(win, 's17-1-deux-ecrans', 'Deux écrans, une fenêtre chacun', async () => {
  const w = await overlays()
  const second = w.find((x) => x.bounds.x === 1600)
  return {
    statut: w.length === 2 && second ? OK : KO,
    detail: `${w.length} overlay(s) · second à ${JSON.stringify(second?.bounds ?? null)}`,
  }
})

/* ------------------------------------------------------------------ *
 * 1.1bis — TROIS ÉCRANS : LE MONTAGE RÉEL DE L'UTILISATEUR.
 *
 * « trois écrans, OBS ouvert en permanence ». La règle doit tenir à trois
 * exactement comme à deux : UN SEUL écran annote, UN SEUL porte la barre, et
 * les autres sont strictement inertes — moteur éteint, canevas rendus,
 * fenêtre retirée. C'est là que le coût se multipliait.
 * ------------------------------------------------------------------ */

await rapport.test(win, 's17-1b-trois-ecrans', 'Trois écrans : un seul annote, un seul porte la barre', async () => {
  await app.evaluate(({ screen }) => {
    globalThis.__trois = true
    screen.emit('display-added', {}, globalThis.__troisieme)
  })
  await pause(2600)

  const w = await overlays()
  const etats = []
  for (const x of [0, 1600, 2880]) {
    const p = await pageDeLEcran(x)
    if (!p) {
      etats.push({ x, page: false })
      continue
    }
    etats.push({
      x,
      page: true,
      annote: await annote(p),
      barre: await p.evaluate(() => !!document.querySelector('.toolbar')),
      canevas: await p.evaluate(() => {
        let n = 0
        for (const cv of document.querySelectorAll('canvas')) n += cv.width * cv.height
        return n
      }),
    })
  }
  const annotent = etats.filter((e) => e.annote === true)
  const barres = etats.filter((e) => e.barre === true)
  // Les écrans qui n'annotent pas n'ont plus un seul pixel de canevas.
  const inertesPropres = etats.filter((e) => e.annote === false).every((e) => e.canevas === 0)

  const ok =
    w.length === 3 &&
    etats.every((e) => e.page) &&
    annotent.length === 1 &&
    barres.length === 1 &&
    inertesPropres
  return {
    statut: ok ? OK : KO,
    detail:
      `${w.length} overlay(s) · ${annotent.length} écran(s) qui annotent (1 exigé) · ` +
      `${barres.length} écran(s) qui portent la barre (1 exigé) · ` +
      `canevas des écrans inertes tous à zéro : ${inertesPropres} · ` +
      `détail : ${JSON.stringify(etats)}`,
  }
})

// On redescend à deux écrans pour la suite : les tests de bascule ci-dessous
// veulent une topologie simple, et le débranchement est lui-même éprouvé.
await app.evaluate(({ screen }) => {
  globalThis.__trois = false
  screen.emit('display-removed', {}, globalThis.__troisieme)
})
await pause(2400)

/* ------------------------------------------------------------------ *
 * 1.2 — LA DÉSIGNATION CHANGE PENDANT LE MODE DESSIN.
 *
 * Le scénario réel : l'utilisateur annote sur l'écran principal (F8), puis la
 * désignation part ailleurs — parce qu'il a changé d'écran principal dans
 * Windows, ou qu'un jeu l'a fait pour lui. L'écran qu'il annotait cesse
 * d'annoter SANS QUE PERSONNE NE LUI RENDE LA SOURIS.
 * ------------------------------------------------------------------ */

/**
 * Met la page en MODE DESSIN et le vérifie. On passe par la touche réelle
 * (F8 = `mode.draw` dans les deux presets), donc par le vrai chemin
 * page → 'hexa:set-passthrough' → applyPassthrough : c'est l'état de la
 * FENÊTRE qu'on installe, pas une variable de test.
 */
const entrerEnDessin = async (page) => {
  for (let i = 0; i < 3; i++) {
    if (await enDessin(page)) return true
    await page.keyboard.press('F8')
    await page.waitForTimeout(600)
  }
  return enDessin(page)
}

await rapport.test(win, 's17-2-perte-designation', 'Perdre la désignation rend la souris au jeu', async () => {
  const dessinAvant = await entrerEnDessin(win)
  const annoteAvant = await annote(win)

  /*
   * LA MANŒUVRE, ET POURQUOI ELLE EST RÉALISTE. `annotationDisplayId()` se
   * replie sur l'écran PRINCIPAL de Windows tant que l'utilisateur n'a rien
   * désigné dans le menu de l'icône. Changer d'écran principal déplace donc la
   * désignation SANS qu'aucun écran ne soit branché ni débranché : c'est le
   * chemin le plus discret, et celui qu'aucun test ne couvrait.
   */
  await app.evaluate(({ screen }) => {
    screen.getPrimaryDisplay = () => globalThis.__faux
    screen.emit('display-metrics-changed', {}, globalThis.__faux, ['bounds'])
  })
  await pause(2600)

  const dessinApres = await enDessin(win)
  const annoteApres = await annote(win)
  const second = await pageDeLEcran(1600)
  const annoteSecond = second ? await annote(second) : null

  const ok =
    dessinAvant === true &&
    annoteAvant === true &&
    annoteApres === false &&
    annoteSecond === true &&
    dessinApres === false
  return {
    statut: ok ? OK : KO,
    detail:
      `avant : dessin ${dessinAvant}, moteur actif ${annoteAvant} · ` +
      `après changement d’écran principal : moteur actif ${annoteApres} (false exigé), ` +
      `moteur du nouvel écran actif ${annoteSecond} (true exigé — sinon F8 vise un moteur inerte ` +
      `et plus rien ne se dessine nulle part), mode dessin resté sur l’ancien écran : ${dessinApres} ` +
      `(false exigé — sinon sa fenêtre avale tous les clics du jeu sans rien dessiner)`,
  }
})

/* ------------------------------------------------------------------ *
 * 1.3 — L'ÉCRAN DE DESSIN EST DÉBRANCHÉ : LA MAIN DOIT REVENIR SUR
 *       L'ÉCRAN D'ANNOTATION, PAS SUR CELUI DU CURSEUR.
 *
 * Sous Xvfb le curseur est toujours sur l'écran RÉEL, tandis que l'écran
 * d'annotation est le FAUX : les deux réponses sont donc distinguables, et
 * c'est tout l'objet du test.
 * ------------------------------------------------------------------ */

await rapport.test(win, 's17-3-debranchement', 'Écran de dessin débranché : la main revient sur l’écran d’annotation', async () => {
  const second = await pageDeLEcran(1600)
  const dessinSecond = second ? await entrerEnDessin(second) : null

  await app.evaluate(({ screen }) => {
    globalThis.__actif = false
    screen.getPrimaryDisplay = globalThis.__vraiPrimaire
    screen.emit('display-removed', {}, globalThis.__faux)
  })
  await pause(2600)

  // Il ne reste qu'un écran : c'est forcément lui l'écran d'annotation.
  const annoteFinal = await annote(win)
  const dessinFinal = await enDessin(win)
  const w = await overlays()

  const ok = w.length === 1 && annoteFinal === true && dessinFinal === true
  return {
    statut: ok ? OK : KO,
    detail:
      `mode dessin sur le second avant débranchement : ${dessinSecond} · ` +
      `après : ${w.length} overlay(s), moteur actif ${annoteFinal} (true exigé), ` +
      `mode dessin ${dessinFinal} (true exigé — le mode dessin ne doit pas mourir avec l’écran, ` +
      `et il doit revenir sur l’écran D’ANNOTATION, pas sur celui du curseur)`,
  }
})

await rapport.test(win, 's17-4-journal-propre', 'Aucune erreur dans le journal pendant les bascules', async () => {
  const lignes = journal()
    .split('\n')
    .filter((l) => /ERREUR|Error:|impossible/i.test(l))
  return {
    statut: lignes.length === 0 ? OK : KO,
    detail: lignes.length === 0 ? 'journal propre' : lignes.slice(-3).join(' | '),
  }
})

await app.close()

/* ================================================================== *
 * PARTIE 2 — LA BASCULE EN PLEIN GESTE, SUR UNE PAGE
 * ================================================================== */

const app2 = await electron.launch({
  args: ['.', `--user-data-dir=${join(CAPTURES, '.user-data-s17b')}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
  env: { ...process.env, HEXA_FUSION: '1' },
})
const p = await app2.firstWindow({ timeout: 30000 })
await p.waitForSelector('.stage canvas', { timeout: 20000 })
await p.waitForTimeout(1000)

const etatDepart = {
  onboarded: true,
  fadeDelay: null,
  tool: 'pen',
  color: '#00e5ff',
  size: 6,
  theme: 'neon-nuit',
  sound: false,
  toolbarVisible: true,
  keymapPreset: 'epicpen',
  keymapPresetChosen: true,
  keymapOverrides: {},
}

const recharger = async (patch = {}) => {
  await p.evaluate(
    (e) => localStorage.setItem('hexa-ui', JSON.stringify({ state: e, version: 0 })),
    { ...etatDepart, ...patch },
  )
  await p.reload()
  await p.waitForSelector('.stage canvas', { timeout: 20000 })
  await p.waitForTimeout(900)
}

/** Images RÉELLEMENT demandées pendant `ms` — mesure passive, sans en créer. */
const imagesPendant = (ms) =>
  p.evaluate((duree) => {
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

/** Pixels peints et pixels alloués sur TOUS les canevas de la page. */
const pixels = () =>
  p.evaluate(() => {
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

const basculer = (v) => p.evaluate((x) => window.__hexaTestEcranAnnotation?.(x), v)
const fxEtat = () => p.evaluate(() => window.hexaFx?.state() ?? null)
const traits = () => p.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)

await recharger()

/* ---- 2.1 : bascule EN PLEIN TRACÉ ---- */
await rapport.test(p, 's17-5-bascule-en-plein-trace', 'Bascule au milieu d’un tracé : rien ne reste en l’air', async () => {
  await p.mouse.move(400, 300)
  await p.mouse.down()
  await p.mouse.move(700, 420, { steps: 10 })
  // …et la désignation part MAINTENANT, bouton encore enfoncé.
  await basculer(false)
  await p.waitForTimeout(300)
  await p.mouse.move(900, 500, { steps: 10 })
  await p.mouse.up()
  await p.waitForTimeout(400)

  const images = await imagesPendant(1000)
  const { peints, alloues } = await pixels()
  const n = await traits()
  const contenu = await p.evaluate(() => window.hexaEngine?.hasContent ?? null)

  // On rallume : la page doit repartir proprement, et accepter un nouveau tracé.
  await basculer(true)
  await p.waitForTimeout(600)
  await p.mouse.move(300, 600)
  await p.mouse.down()
  await p.mouse.move(700, 640, { steps: 10 })
  await p.mouse.up()
  await p.waitForTimeout(500)
  const apres = await traits()
  const pixApres = await pixels()

  const ok = images === 0 && peints === 0 && alloues === 0 && n === 0 && contenu === false &&
    apres === 1 && pixApres.peints > 1000
  return {
    statut: ok ? OK : KO,
    detail:
      `éteint en plein geste : ${images} image(s), ${peints} px peints, ${alloues} px alloués, ` +
      `${n} trait(s) enregistré(s) (0 exigé : un geste interrompu ne doit rien laisser), hasContent ${contenu} · ` +
      `rallumé : ${apres} trait(s) (1 exigé), ${pixApres.peints} px peints — le stylo doit remarcher tout de suite`,
  }
})

/* ---- 2.2 : bascule PENDANT UNE DISSOLUTION ---- */
await rapport.test(p, 's17-6-bascule-en-dissolution', 'Bascule pendant une dissolution : elle ne se rallume pas toute seule', async () => {
  await recharger({ fadeDelay: 2000 })
  await p.mouse.move(400, 300)
  await p.mouse.down()
  await p.mouse.move(900, 460, { steps: 12 })
  await p.mouse.up()
  await p.waitForTimeout(2400) // le fondu a commencé
  const enCours = (await pixels()).peints

  await basculer(false)
  await p.waitForTimeout(400)
  const images = await imagesPendant(1500)
  const { peints, alloues } = await pixels()
  const contenu = await p.evaluate(() => window.hexaEngine?.hasContent ?? null)

  await basculer(true)
  await p.waitForTimeout(1500)
  const finales = await pixels()

  // La dissolution était en route : une fois rallumé, elle doit être TERMINÉE
  // (le temps a passé) et l'écran net — pas figée à mi-chemin pour l'éternité.
  const ok = images === 0 && peints === 0 && alloues === 0 && contenu === false && finales.peints === 0
  return {
    statut: ok ? OK : KO,
    detail:
      `${enCours} px en cours de dissolution · éteint : ${images} image(s), ${peints} px, ${alloues} alloués, ` +
      `hasContent ${contenu} · rallumé 1,5 s plus tard : ${finales.peints} px (0 exigé — la dissolution ` +
      `doit se terminer, pas se figer)`,
  }
})

/* ---- 2.3 : bascule AVEC UN PANNEAU OUVERT ---- */
await rapport.test(p, 's17-7-bascule-panneau-ouvert', 'Bascule avec les Réglages ouverts : le panneau reste utilisable', async () => {
  await recharger()
  // Même chemin que la campagne principale : le bouton réel de la barre.
  const ouvrir = () =>
    p.evaluate(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
        (el.getAttribute('title') ?? '').startsWith('Réglages'),
      )
      b?.click()
    })
  const panneauOuvert = () => p.evaluate(() => !!document.querySelector('.hx-settings'))
  await ouvrir()
  await p.waitForTimeout(800)
  const ouvertAvant = await panneauOuvert()

  await basculer(false)
  await p.waitForTimeout(700)
  const ouvertEteint = await panneauOuvert()
  const images = await imagesPendant(1000)
  const { peints, alloues } = await pixels()

  await basculer(true)
  await p.waitForTimeout(700)
  const ouvertApres = await panneauOuvert()

  // Le panneau appartient à l'INTERFACE, pas à l'encre : il ne doit ni
  // disparaître ni empêcher l'écran de devenir inerte.
  const ok = ouvertAvant === true && ouvertEteint === true && ouvertApres === true &&
    images === 0 && peints === 0 && alloues === 0
  return {
    statut: ok ? OK : KO,
    detail:
      `panneau ouvert avant ${ouvertAvant} · pendant l’extinction ${ouvertEteint} (il ne doit pas se fermer tout seul) · ` +
      `après ${ouvertApres} · coût pendant l’extinction : ${images} image(s), ${peints} px, ${alloues} alloués`,
  }
})

/* ---- 2.4 : bascule AVEC LA LOUPE ALLUMÉE ---- */
await rapport.test(p, 's17-8-bascule-loupe', 'Bascule avec la loupe active : le flux d’écran se ferme', async () => {
  await recharger({ tool: 'magnifier' })
  // Flux de test : la capture d'écran n'existe pas sous xvfb, on injecte une
  // VRAIE MediaStream par le point d'entrée prévu — même chemin de code qu'en
  // production.
  await p.evaluate(() => {
    const cv = document.createElement('canvas')
    cv.width = 640
    cv.height = 360
    const c = cv.getContext('2d')
    let t = 0
    const peindre = () => {
      t += 1
      c.fillStyle = `hsl(${t % 360} 80% 55%)`
      c.fillRect(0, 0, 640, 360)
      setTimeout(peindre, 33)
    }
    peindre()
    window.hexaFx.useTestStream(cv.captureStream(30))
  })
  await p.mouse.move(600, 400)
  await p.mouse.down()
  await p.mouse.up()
  await p.waitForTimeout(800)
  const avant = await fxEtat()

  await basculer(false)
  await p.waitForTimeout(600)
  const eteint = await fxEtat()
  const images = await imagesPendant(1200)
  const { peints, alloues } = await pixels()

  await basculer(true)
  await p.waitForTimeout(800)
  const rallume = await fxEtat()

  const ok = avant?.feed === true && eteint?.feed === false && images === 0 &&
    peints === 0 && alloues === 0 && rallume?.tool === 'magnifier'
  return {
    statut: ok ? OK : KO,
    detail:
      `avant : flux ${avant?.feed ? 'ouvert' : 'fermé'} · éteint : flux ${eteint?.feed ? 'OUVERT (défaut)' : 'fermé'}, ` +
      `${images} image(s), ${peints} px, ${alloues} alloués · rallumé : outil « ${rallume?.tool} »`,
  }
})

/* ---- 2.5 : bascule AVEC DES MASQUES FLOUS FIGÉS ---- */
await rapport.test(p, 's17-9-bascule-masques', 'Bascule avec des masques figés : ils sont toujours là au retour', async () => {
  await recharger({ tool: 'blur' })
  await p.evaluate(() => {
    const cv = document.createElement('canvas')
    cv.width = 640
    cv.height = 360
    const c = cv.getContext('2d')
    let t = 0
    const peindre = () => {
      t += 1
      c.fillStyle = `hsl(${t % 360} 80% 55%)`
      c.fillRect(0, 0, 640, 360)
      setTimeout(peindre, 33)
    }
    peindre()
    window.hexaFx.useTestStream(cv.captureStream(30))
  })
  await p.waitForTimeout(300)
  // Deux masques, pour éprouver le cas « plusieurs plaques ».
  for (const [x0, y0, x1, y1] of [[300, 200, 560, 360], [700, 420, 950, 560]]) {
    await p.mouse.move(x0, y0)
    await p.mouse.down()
    await p.mouse.move(x1, y1, { steps: 8 })
    await p.mouse.up()
    await p.waitForTimeout(400)
  }
  // Stabilisation des plaques + extinction du flux.
  await p.waitForTimeout(3400)
  const avant = await fxEtat()
  const couvertAvant = (await pixels()).peints

  await basculer(false)
  await p.waitForTimeout(600)
  const images = await imagesPendant(1200)
  const eteintPix = await pixels()
  const eteint = await fxEtat()

  await basculer(true)
  await p.waitForTimeout(2200)
  const apres = await fxEtat()
  const couvertApres = (await pixels()).peints

  const ok =
    avant?.masks === 2 && avant?.feed === false && couvertAvant > 20000 &&
    images === 0 && eteintPix.peints === 0 && eteintPix.alloues === 0 && eteint?.feed === false &&
    apres?.masks === 2 && couvertApres > 20000
  return {
    statut: ok ? OK : KO,
    detail:
      `avant : ${avant?.masks} masque(s), flux ${avant?.feed ? 'ouvert' : 'fermé'}, ${couvertAvant} px couverts · ` +
      `éteint : ${images} image(s), ${eteintPix.peints} px, ${eteintPix.alloues} alloués, flux ${eteint?.feed ? 'OUVERT' : 'fermé'} · ` +
      `rallumé : ${apres?.masks} masque(s), ${couvertApres} px couverts (les zones sensibles doivent REDEVENIR couvertes)`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app2.close()
process.exit(rapport.codeSortie)
