#!/usr/bin/env node
/**
 * Hexa — §S18 : AU REPOS, HEXA EST GRATUIT — EN MODE DEUX FENÊTRES.
 *
 * POURQUOI CE FICHIER EXISTE. La règle du repos (§2.5) était éprouvée en mode
 * FUSIONNÉ, c'est-à-dire une seule fenêtre par écran : ni s6, ni s16, ni la
 * campagne principale ne la mesuraient dans le mode que l'utilisateur emploie
 * VRAIMENT, où Hexa ouvre deux fenêtres par écran — l'ENCRE (capturée par OBS)
 * et l'INTERFACE (exclue des captures). Or c'est précisément la moitié qui
 * coûte : chaque fenêtre transparente encore affichée est composée par Windows
 * à chaque image, à 0 % de processeur et pourtant au prix fort pour OBS. C'est
 * la plainte d'origine, mot pour mot : « OBS fait ramer le PC énormément, mais
 * c'est que quand j'utilise l'outil ».
 *
 * CE QU'ON EXIGE, DANS LES QUATRE ÉTATS DE REPOS DE L'UTILISATEUR :
 *   1. écran vide, mode jeu  → aucune image demandée nulle part, la fenêtre
 *      d'encre RETIRÉE, la fenêtre d'interface réduite au rectangle de la barre
 *      (jamais un calque plein écran), et pas un octet de canevas alloué ;
 *   2. une annotation posée, fondu ∞ → la fenêtre d'encre revient (le trait
 *      DOIT passer à l'antenne) mais plus rien ne s'anime une fois posé ;
 *   3. annotations masquées → la couche encre redéclare n'avoir aucun contenu,
 *      sa fenêtre se retire, et le coût retombe à zéro pendant toute la coupure ;
 *   4. veille système (vrai `powerMonitor.emit('suspend')`) → plus une seule
 *      fenêtre affichée, plus une seule image.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { KO, OK, Rapport, CAPTURES, RACINE, chargerPilote, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const electron = await chargerPilote()

const USER = join(CAPTURES, '.user-data-s18')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })

// PAS de HEXA_FUSION : c'est tout l'objet du fichier — le vrai mode de
// l'utilisateur, deux fenêtres par écran.
const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
await app.firstWindow({ timeout: 30000 })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
await pause(3500)

/* ------------------------------------------------------------------ *
 * Qui est qui : on ne mesure rien tant qu'on n'a pas les deux couches.
 * ------------------------------------------------------------------ */
let encre = null
let inter = null
for (const w of app.windows()) {
  const d = await w
    .evaluate(() => ({
      couche: [...document.body.classList].find((c) => c.startsWith('hexa-')) ?? '',
      canvas: document.querySelectorAll('canvas').length,
      barre: !!document.querySelector('.toolbar'),
    }))
    .catch(() => null)
  if (!d) continue
  if (d.couche === 'hexa-encre') encre = w
  if (d.couche === 'hexa-interface') inter = w
}

if (!encre || !inter) {
  process.stdout.write(
    `\nIMPOSSIBLE DE CONTINUER : couche encre ${encre ? 'trouvée' : 'ABSENTE'}, ` +
      `couche interface ${inter ? 'trouvée' : 'ABSENTE'}\n`,
  )
  await app.close()
  process.exit(1)
}

/**
 * Images RÉELLEMENT demandées par une page pendant `ms`. Mesure PASSIVE : on
 * enveloppe requestAnimationFrame pour compter, on ne le déclenche jamais.
 */
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

/** Les DEUX pages en même temps : le repos ne se démontre pas à moitié. */
const imagesDesDeux = async (ms) => {
  const [e, i] = await Promise.all([imagesPendant(encre, ms), imagesPendant(inter, ms)])
  return { encre: e, interface: i, total: e + i }
}

/**
 * Mémoire graphique réservée dans la couche encre, CANEVAS PAR CANEVAS.
 *
 * La distinction est tout le sujet. Deux familles cohabitent dans la scène :
 *
 *   · les canevas de DESSIN (`.stage > canvas` : le statique et le vif). Ils
 *     SONT la surface de dessin. Les rendre au repos ferait payer une
 *     allocation plein écran au premier appui du stylo, c'est-à-dire à
 *     l'instant précis que la campagne principale chronomètre (perf-latence).
 *     Ils restent donc alloués — et ça ne coûte rien au compositeur, puisque
 *     la fenêtre, elle, est retirée.
 *
 *   · les canevas OCCASIONNELS (voile du spotlight, plaques de flou, loupe,
 *     gel d'image). La plupart des sessions n'en ouvrent aucun. Eux DOIVENT
 *     retomber à 0×0 : c'est de 23 à 100 Mo pièce selon l'écran.
 */
const memoire = () =>
  encre.evaluate(() => {
    let dessin = 0
    let occasionnels = 0
    const detail = []
    for (const cv of document.querySelectorAll('canvas')) {
      const px = cv.width * cv.height
      const nom = cv.className || (cv.parentElement?.className ?? '?')
      const estDessin = cv.parentElement?.classList.contains('stage') && !cv.className
      if (estDessin) dessin += px
      else occasionnels += px
      if (px > 0) detail.push(`${nom || 'stage'}=${px}`)
    }
    return { dessin, occasionnels, detail, ecran: window.innerWidth * window.innerHeight }
  })

/** Ce que le compositeur de Windows doit réellement peindre, fenêtre par fenêtre. */
const fenetres = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const ecran = screen.getPrimaryDisplay().bounds
    const surfaceEcran = ecran.width * ecran.height
    return BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && !w.webContents.getURL().startsWith('data:'))
      .map((w) => {
        const b = w.getBounds()
        return {
          url: w.webContents.getURL().split('/').pop(),
          visible: w.isVisible(),
          part: w.isVisible() ? (b.width * b.height) / surfaceEcran : 0,
        }
      })
  })

/** Part de l'écran réellement composée, toutes fenêtres confondues. */
const partComposee = async () => (await fenetres()).reduce((s, f) => s + f.part, 0)

/** Le mode jeu : c'est l'état par défaut du streamer, celui qui doit être gratuit. */
const passerEnJeu = async () => {
  for (let i = 0; i < 3; i++) {
    const dessin = await encre.evaluate(() => !document.body.classList.contains('passthrough'))
    if (!dessin) return true
    await encre.keyboard.press('F8')
    await pause(700)
  }
  return encre.evaluate(() => document.body.classList.contains('passthrough'))
}

// État de départ : découverte guidée déjà vue, fondu ∞ (sinon les traits
// s'effaceraient sous la mesure), barre visible, sons coupés. On passe par le
// VRAI mécanisme de persistance, sur les DEUX pages, puis on recharge.
const etat = {
  onboarded: true,
  fadeDelay: null,
  tool: 'pen',
  color: '#00e5ff',
  size: 6,
  theme: 'neon-nuit',
  sound: false,
  sparkles: true,
  toolbarVisible: true,
  keymapPreset: 'epicpen',
  keymapPresetChosen: true,
  keymapOverrides: {},
  globalShortcutsOn: false,
  globalShortcutsChosen: true,
  annotationsHidden: false,
}
for (const p of [encre, inter]) {
  await p.evaluate((e) => localStorage.setItem('hexa-ui', JSON.stringify({ state: e, version: 0 })), etat)
  await p.reload()
}
await pause(2500)
await passerEnJeu()
await pause(1200)

/* ================================================================== *
 * 1. ÉCRAN VIDE, MODE JEU
 * ================================================================== */

await rapport.test(encre, 's18-1-ecran-vide', 'Écran vide en mode jeu : zéro image, et la fenêtre retirée', async () => {
  const img = await imagesDesDeux(3000)
  const m = await memoire()
  const f = await fenetres()
  const encreVisible = f.find((x) => /index\.html/.test(x.url ?? ''))?.visible
  // Les canevas de dessin : deux plein écran au maximum (statique + vif), pas
  // un de plus. Les occasionnels : zéro absolu.
  const ok =
    img.total === 0 &&
    encreVisible === false &&
    m.occasionnels === 0 &&
    m.dessin <= 2.2 * m.ecran
  return {
    statut: ok ? OK : KO,
    detail:
      `3 s d’immobilité : ${img.encre} image(s) couche encre + ${img.interface} couche interface ` +
      `(0 exigé de part et d’autre) · fenêtre d’encre visible : ${encreVisible} (false exigé — ` +
      `une fenêtre vide doit se retirer, sinon Windows la compose à chaque image et OBS la paie) · ` +
      `mémoire : ${m.occasionnels} px de canevas OCCASIONNELS (0 exigé : loupe, flou, gel, voile) · ` +
      `${m.dessin} px de canevas de DESSIN, soit ${(m.dessin / m.ecran).toFixed(2)} écran(s) ` +
      `(≤ 2,2 attendu : le statique et le vif, gardés pour que le premier trait soit instantané) · ` +
      `[${m.detail.join(' ')}]`,
  }
})

await rapport.test(inter, 's18-2-barre-pas-plein-ecran', 'La barre ne pose pas un calque plein écran sur le jeu', async () => {
  const f = await fenetres()
  const ui = f.find((x) => /ui\.html/.test(x.url ?? ''))
  const part = await partComposee()
  // §S12 : réduite au rectangle de la barre, la fenêtre d'interface doit rester
  // très en dessous du plein écran. On se donne 25 % de marge — la mesure
  // observée tourne autour de 7 %.
  const ok = ui != null && ui.part > 0 && ui.part < 0.25 && part < 0.25
  return {
    statut: ok ? OK : KO,
    detail:
      `fenêtre d’interface : ${(100 * (ui?.part ?? 0)).toFixed(1)} % de l’écran ` +
      `(plein écran = 100 %) · TOTAL composé par Windows au repos : ${(100 * part).toFixed(1)} %`,
  }
})

/* ================================================================== *
 * 2. UNE ANNOTATION POSÉE, FONDU ∞
 * ================================================================== */

await rapport.test(encre, 's18-3-annotation-posee', 'Un trait posé en fondu ∞ : il reste, et plus rien ne tourne', async () => {
  // On repasse en mode dessin pour poser le trait, puis on rend la main au jeu :
  // c'est exactement la manœuvre du streamer.
  await encre.keyboard.press('F8')
  await pause(700)
  await encre.mouse.move(400, 300)
  await encre.mouse.down()
  await encre.mouse.move(900, 500, { steps: 14 })
  await encre.mouse.up()
  await pause(800)
  await passerEnJeu()
  await pause(1500)

  const traits = await encre.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)
  const img = await imagesDesDeux(3000)
  const f = await fenetres()
  const encreVisible = f.find((x) => /index\.html/.test(x.url ?? ''))?.visible

  // La fenêtre d'encre DOIT être visible : le trait passe à l'antenne. Mais
  // rien ne doit plus s'animer — un trait immobile ne coûte pas une image.
  const ok = traits === 1 && img.total === 0 && encreVisible === true
  return {
    statut: ok ? OK : KO,
    detail:
      `${traits} trait(s) survivant(s) au retour en mode jeu (1 exigé — le fondu est sur ∞) · ` +
      `fenêtre d’encre visible : ${encreVisible} (true exigé : le trait doit partir dans le direct) · ` +
      `${img.encre}+${img.interface} image(s) en 3 s (0 exigé : un trait immobile ne coûte rien)`,
  }
})

/* ================================================================== *
 * 3. ANNOTATIONS MASQUÉES
 * ================================================================== */

await rapport.test(encre, 's18-4-annotations-masquees', 'Annotations masquées : la fenêtre d’encre se retire pour de bon', async () => {
  // Le vrai raccourci du preset : Ctrl+Maj+M (ui.hideInk).
  await encre.keyboard.press('Control+Shift+m')
  await pause(1500)

  const contenu = await encre.evaluate(() => window.hexaEngine?.hasContent ?? null)
  const img = await imagesDesDeux(2500)
  const f = await fenetres()
  const encreVisible = f.find((x) => /index\.html/.test(x.url ?? ''))?.visible
  const part = await partComposee()

  // …puis on les remontre : rien n'a été perdu.
  await encre.keyboard.press('Control+Shift+m')
  await pause(1500)
  const traits = await encre.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)
  const revenue = (await fenetres()).find((x) => /index\.html/.test(x.url ?? ''))?.visible

  const ok =
    contenu === false && img.total === 0 && encreVisible === false && part < 0.25 &&
    traits === 1 && revenue === true
  return {
    statut: ok ? OK : KO,
    detail:
      `masquées : hasContent ${contenu} (false exigé), fenêtre d’encre visible ${encreVisible} (false exigé), ` +
      `${img.encre}+${img.interface} image(s) en 2,5 s, ${(100 * part).toFixed(1)} % d’écran composé · ` +
      `remontrées : ${traits} trait(s) retrouvé(s) (1 exigé), fenêtre revenue ${revenue}`,
  }
})

/* ================================================================== *
 * 4. VEILLE SYSTÈME
 * ================================================================== */

await rapport.test(encre, 's18-5-veille', 'Veille du système : plus une fenêtre, plus une image', async () => {
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
  await pause(1500)
  const f = await fenetres()
  const visibles = f.filter((x) => x.visible)
  const img = await imagesDesDeux(2000)

  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
  await pause(2500)
  const apres = await fenetres()
  const encreApres = apres.find((x) => /index\.html/.test(x.url ?? ''))?.visible
  const traits = await encre.evaluate(() => window.hexaEngine?.exportSession?.().strokes.length ?? -1)

  const ok = visibles.length === 0 && img.total === 0 && encreApres === true && traits === 1
  return {
    statut: ok ? OK : KO,
    detail:
      `en veille : ${visibles.length} fenêtre(s) encore affichée(s) (0 exigé), ` +
      `${img.encre}+${img.interface} image(s) en 2 s · ` +
      `au réveil : fenêtre d’encre revenue ${encreApres}, ${traits} trait(s) intact(s)`,
  }
})

/* ================================================================== *
 * 5. AUCUNE ERREUR NULLE PART
 * ================================================================== */

const erreurs = []
for (const p of [encre, inter]) p.on('pageerror', (e) => erreurs.push(String(e.message)))
await pause(500)

await rapport.test(encre, 's18-6-aucune-erreur', 'Aucune erreur de page dans l’une ou l’autre couche', async () => ({
  statut: erreurs.length === 0 ? OK : KO,
  detail: erreurs.length === 0 ? 'aucune' : erreurs.slice(0, 3).join(' | '),
}))

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
