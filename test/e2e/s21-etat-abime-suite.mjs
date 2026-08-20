#!/usr/bin/env node
/**
 * Hexa — §S21 : L'ÉTAT PERSISTÉ ABÎMÉ, LA SUITE — LES CLÉS QUE §S20 NE COUVRE
 * PAS.
 *
 * POURQUOI CE FICHIER EXISTE. §S20 a posé le bon principe — un état relu
 * illisible se jette, il ne se propage pas — mais ne l'a appliqué qu'à
 * `clocks` et `notes`, au motif que ce seraient « les seules valeurs
 * persistées parcourues au rendu ». CETTE AFFIRMATION EST FAUSSE, et elle
 * l'est là où ça coûte le plus cher :
 *
 *   · `keymapOverrides` est lu par Toolbar.tsx — resolveKeymap() → asList() →
 *     normalizeCombo(), qui fait `combo.split('+')`. La BARRE D'OUTILS est
 *     montée en permanence : une valeur d'override qui n'est pas une chaîne
 *     fait donc lever le rendu de TOUTE l'application, pas d'un panneau.
 *   · `lexiconCategories` / `lexiconWords` sont lus par SettingsPanel
 *     (`.includes`, `.length`, `.join`) et par le lexique du mode écriture
 *     (`[...o.categories]`, `o.perso.join`).
 *   · `customProfiles` est étalé par ProfilesPanel (`[...customProfiles]`).
 *
 * Et il n'existe AUCUN error boundary React dans le projet (vérifié : zéro
 * occurrence de componentDidCatch / getDerivedStateFromError dans src/). Toute
 * levée au rendu démonte donc l'arbre entier. Sur une fenêtre TRANSPARENTE,
 * cela ne donne pas un message d'erreur : cela donne le néant, en plein
 * direct, sans que l'utilisateur ait le moindre moyen de comprendre.
 *
 * Ce fichier exige, pour chaque clé et chaque forme d'abîmement : la barre est
 * là, la scène est là, LE STYLO DESSINE, zéro erreur de page — et pour les
 * panneaux, qu'ils s'ouvrent par le VRAI raccourci sans emporter
 * l'application.
 */
import { KO, OK, Rapport, lancerHexa, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's21' })

/**
 * Écrit un `hexa-ui` abîmé, recharge, et mesure ce qu'il en reste.
 *
 * Même protocole que §S20, et pour la même raison : on dessine AVEC L'ÉTAT
 * ABÎMÉ TOUJOURS EN PLACE. Une application qui ne repart qu'une fois sa
 * configuration effacée n'a pas été réparée — elle a été contournée, et
 * l'utilisateur, lui, n'a pas de console pour le faire à 21 h devant 400
 * personnes.
 */
const eprouver = async (etat, { ouvrirReglages = false } = {}) => {
  const erreurs = []
  const surErreur = (e) => erreurs.push(String(e.message))
  win.on('pageerror', surErreur)

  await win.evaluate(
    (v) => localStorage.setItem('hexa-ui', v),
    JSON.stringify({
      state: {
        onboarded: true,
        fadeDelay: null,
        // Les raccourcis système n'ont aucun sens sous Xvfb et pollueraient le
        // journal : même précaution que `etatDeDepart` du harnais.
        globalShortcutsOn: false,
        globalShortcutsChosen: true,
        ...etat,
      },
      version: 2,
    }),
  )
  await win.reload()

  const monte = await win
    .waitForSelector('.stage', { timeout: 12000 })
    .then(() => true)
    .catch(() => false)
  await win.waitForTimeout(1200)

  const vu = await win
    .evaluate(() => ({
      barre: !!document.querySelector('.toolbar'),
      canevas: document.querySelectorAll('.stage canvas').length,
      moteur: !!window.hexaEngine,
    }))
    .catch(() => ({ barre: false, canevas: 0, moteur: false }))

  /*
   * Un panneau ne se rend qu'ouvert : c'est en l'ouvrant, et seulement là,
   * qu'une liste abîmée qu'il parcourt fait tomber l'application. On passe par
   * le raccourci réel (Ctrl+,) et non par le store : c'est le geste de
   * l'utilisateur qu'on éprouve, pas une porte dérobée de test.
   */
  let panneau = null
  if (ouvrirReglages && vu.moteur) {
    await win.keyboard.press('Control+,').catch(() => {})
    await win.waitForTimeout(900)
    panneau = await win
      .evaluate(() => ({
        ouvert: !!document.querySelector('.hx-panel, .settings, .hx-settings'),
        barreEncore: !!document.querySelector('.toolbar'),
        sceneEncore: !!document.querySelector('.stage'),
      }))
      .catch(() => ({ ouvert: false, barreEncore: false, sceneEncore: false }))
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(400)
  }

  let peints = 0
  if (vu.moteur) {
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(250)
    if (await win.evaluate(() => document.body.classList.contains('passthrough')).catch(() => false)) {
      await win.keyboard.press('F8')
      await win.waitForTimeout(400)
    }
    await win.keyboard.press('p')
    await win.waitForTimeout(250)
    await win.mouse.move(400, 300)
    await win.mouse.down()
    await win.mouse.move(900, 500, { steps: 12 })
    await win.mouse.up()
    await win.waitForTimeout(400)
    peints = await win
      .evaluate(() => {
        let n = 0
        for (const cv of document.querySelectorAll('.stage canvas')) {
          if (!cv.width) continue
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
        }
        return n
      })
      .catch(() => 0)
  }

  win.off('pageerror', surErreur)
  return { monte, ...vu, panneau, peints, erreurs }
}

/** Une épreuve standard : tout doit tenir, et le stylo doit peindre. */
const exiger = (nom, titre, etat, options = {}) =>
  rapport.test(win, nom, titre, async () => {
    const r = await eprouver(etat, options)
    const panneauOk = r.panneau ? r.panneau.ouvert && r.panneau.barreEncore && r.panneau.sceneEncore : true
    const ok =
      r.monte && r.barre && r.canevas >= 2 && r.moteur && r.peints > 500 && panneauOk && r.erreurs.length === 0
    return {
      statut: ok ? OK : KO,
      detail:
        `scène ${r.monte} · barre ${r.barre} · ${r.canevas} canevas · moteur ${r.moteur} · ` +
        `${r.peints} px peints` +
        (r.panneau
          ? ` · réglages ouverts ${r.panneau.ouvert}, barre ${r.panneau.barreEncore}, scène ${r.panneau.sceneEncore}`
          : '') +
        ` · ${r.erreurs.length} erreur(s) : ${r.erreurs.slice(0, 2).join(' | ') || 'aucune'}`,
    }
  })

/* ------------------------------------------------------------------ *
 * 1. keymapOverrides — LE PIRE : lu par la BARRE, montée en permanence
 * ------------------------------------------------------------------ */

await exiger(
  's21-1-override-non-chaine',
  'Un override dont la valeur n’est pas une chaîne ne blanchit pas l’overlay',
  /*
   * normalizeCombo fait `combo.split('+')` : 42.split n'existe pas. Cette
   * valeur traverse resolveKeymap, appelé dans un useMemo de Toolbar.tsx.
   *
   * ⚠️ LA CLÉ DOIT ÊTRE UN VRAI IDENTIFIANT D'ACTION (`edit.clear`, et non
   * `clear`) : resolveKeymap ne lit que `overrides[entry.action]` pour les
   * actions qui existent. Une première version de ce test employait des noms
   * inventés — elle passait au VERT sans jamais lire la valeur abîmée, donc
   * sans rien éprouver du tout. Un test qui ne touche pas le code qu'il
   * prétend couvrir est pire qu'un test absent : il rassure.
   */
  { keymapPresetChosen: true, keymapPreset: 'epicpen', keymapOverrides: { 'edit.clear': 42 } },
)

await exiger(
  's21-2-override-liste-sale',
  'Un override liste contenant un non-chaîne ne blanchit pas l’overlay',
  { keymapPresetChosen: true, keymapOverrides: { 'edit.undo': ['ctrl+z', { a: 1 }] } },
)

await exiger(
  's21-3-overrides-non-objet',
  'keymapOverrides qui n’est pas un objet',
  { keymapPresetChosen: true, keymapOverrides: 'nimportequoi' },
)

await exiger(
  's21-4-preset-inconnu',
  'Un preset de clavier inconnu retombe sur un clavier réel',
  { keymapPresetChosen: true, keymapPreset: 'preset-qui-nexiste-pas', keymapOverrides: {} },
)

/* ------------------------------------------------------------------ *
 * 2. Le lexique — panneau des réglages, et mode écriture
 * ------------------------------------------------------------------ */

await exiger(
  's21-5-lexique-categories-nulles',
  'lexiconCategories à null : les réglages s’ouvrent quand même',
  { lexiconCategories: null, lexiconWords: [] },
  { ouvrirReglages: true },
)

await exiger(
  's21-6-lexique-mots-nuls',
  'lexiconWords à null : les réglages s’ouvrent quand même',
  { lexiconCategories: ['champions'], lexiconWords: null },
  { ouvrirReglages: true },
)

await exiger(
  's21-7-lexique-mots-sales',
  'lexiconWords contenant des non-chaînes',
  { lexiconWords: ['baron', 42, null, { a: 1 }], lexiconCategories: ['perso'] },
  { ouvrirReglages: true },
)

/* ------------------------------------------------------------------ *
 * 3. Le mode écriture consomme le lexique POUR DE VRAI
 *
 * Le panneau n'est qu'une des deux portes. L'autre est le reconnaisseur :
 * `cleOptions` fait `[...o.categories]` et `o.perso.join('')`. Un lexique
 * abîmé doit laisser le mode écriture fonctionner — c'est une demande
 * explicite de l'utilisateur, pas un décor.
 * ------------------------------------------------------------------ */

await rapport.test(win, 's21-8-ecriture-lexique-abime', 'Le mode écriture survit à un lexique abîmé', async () => {
  const erreurs = []
  const surErreur = (e) => erreurs.push(String(e.message))
  win.on('pageerror', surErreur)
  await win.evaluate((v) => localStorage.setItem('hexa-ui', v), JSON.stringify({
    state: {
      onboarded: true,
      fadeDelay: null,
      globalShortcutsOn: false,
      globalShortcutsChosen: true,
      handwriting: true,
      lexicon: true,
      lexiconCategories: null,
      lexiconWords: null,
    },
    version: 2,
  }))
  await win.reload()
  await win.waitForSelector('.stage', { timeout: 12000 }).catch(() => {})
  await win.waitForTimeout(1200)

  await win.keyboard.press('Escape').catch(() => {})
  if (await win.evaluate(() => document.body.classList.contains('passthrough')).catch(() => false)) {
    await win.keyboard.press('F8')
    await win.waitForTimeout(400)
  }
  await win.keyboard.press('p')
  await win.waitForTimeout(200)

  // Un mot écrit à la main : c'est ce geste qui appelle le reconnaisseur, donc
  // le lexique, donc la ligne qui lève si `categories` n'est pas itérable.
  for (const [x0, y0, x1, y1] of [
    [300, 300, 300, 380],
    [300, 380, 350, 380],
    [400, 300, 400, 380],
    [400, 340, 450, 340],
  ]) {
    await win.mouse.move(x0, y0)
    await win.mouse.down()
    await win.mouse.move(x1, y1, { steps: 8 })
    await win.mouse.up()
    await win.waitForTimeout(120)
  }
  await win.waitForTimeout(1500)

  const vu = await win
    .evaluate(() => ({ barre: !!document.querySelector('.toolbar'), moteur: !!window.hexaEngine }))
    .catch(() => ({ barre: false, moteur: false }))
  win.off('pageerror', surErreur)
  return {
    statut: vu.barre && vu.moteur && erreurs.length === 0 ? OK : KO,
    detail: `barre ${vu.barre} · moteur ${vu.moteur} · ${erreurs.length} erreur(s) : ${erreurs.slice(0, 2).join(' | ') || 'aucune'}`,
  }
})

/* ------------------------------------------------------------------ *
 * 4. Les profils
 * ------------------------------------------------------------------ */

await exiger(
  's21-9-profils-non-liste',
  'customProfiles qui n’est pas une liste',
  { customProfiles: 'aucun', profileId: 'defaut' },
  { ouvrirReglages: true },
)

await exiger(
  's21-10-profils-entrees-nulles',
  'customProfiles contenant un null : les réglages s’ouvrent',
  { customProfiles: [null, { id: 'p1' }] },
  { ouvrirReglages: true },
)

/* ------------------------------------------------------------------ *
 * 5. Les scalaires numériques que §S20 n'a pas bornés
 *
 * §S20 a borné `size`, `fadeDelay`, `color`, `tool`, `gridMode`. Il en reste,
 * et ils vont tous au moteur ou au canevas : une valeur non finie qui arrive
 * dans un `ctx` empoisonne le tracé SANS LEVER, donc sans rien dire.
 * ------------------------------------------------------------------ */

/*
 * ⚠️ CELUI-CI NE SE CONTENTE PAS DE « ça ne lève pas ».
 *
 * Une intensité d'effets non numérique ne fait pas tomber le rendu : elle
 * éteint les halos EN SILENCE. Avant bornage, le même trait peignait 9 243 px
 * au lieu de 11 896 — et rien, nulle part, ne le disait. C'est le mode de
 * panne le plus vicieux : l'outil a l'air normal et ne l'est pas. On exige
 * donc que le tracé retrouve son compte de pixels de référence.
 */
await rapport.test(win, 's21-11-intensite-non-finie', 'effectIntensity non numérique ne dégrade pas le tracé en silence', async () => {
  const sain = await eprouver({ effectIntensity: 1 })
  const abime = await eprouver({ effectIntensity: 'beaucoup' })
  // 8 % de marge : on veut voir revenir les halos, pas mesurer un antialiasing.
  const ecart = sain.peints > 0 ? Math.abs(abime.peints - sain.peints) / sain.peints : 1
  const ok = abime.peints > 500 && abime.erreurs.length === 0 && ecart < 0.08
  return {
    statut: ok ? OK : KO,
    detail:
      `référence ${sain.peints} px · intensité abîmée ${abime.peints} px · ` +
      `écart ${(ecart * 100).toFixed(1)} % (doit rester < 8 %) · ${abime.erreurs.length} erreur(s)`,
  }
})

await exiger('s21-12-rayon-spot-absurde', 'spotlightRadius absurde ne casse pas le tracé', {
  spotlightRadius: -4000,
})

await exiger('s21-13-volume-absurde', 'soundVolume hors bornes ne casse pas le tracé', {
  soundVolume: 99,
  sound: false,
})

await exiger('s21-14-opacite-grille-absurde', 'gridOpacity absurde ne casse pas le tracé', {
  gridOpacity: 42,
  gridMode: 'lignes',
})

/* ------------------------------------------------------------------ *
 * 6. L'ancrage de la barre — persisté, et consommé aussi par le principal
 * ------------------------------------------------------------------ */

await exiger('s21-15-ancrage-absurde', 'Un ancrage de barre inconnu laisse une barre utilisable', {
  toolbarEdge: 'nulle-part',
  toolbarOrientation: 'diagonale',
  toolbarOffset: 99999,
})

/* ------------------------------------------------------------------ *
 * 7. Un état entièrement illisible — le cas « fichier tronqué »
 * ------------------------------------------------------------------ */

await rapport.test(win, 's21-16-json-tronque', 'Un hexa-ui tronqué ne blanchit pas l’overlay', async () => {
  const erreurs = []
  const surErreur = (e) => erreurs.push(String(e.message))
  win.on('pageerror', surErreur)
  // Exactement ce que laisse une coupure de courant pendant l'écriture.
  await win.evaluate(() => localStorage.setItem('hexa-ui', '{"state":{"onboarded":true,"clo'))
  await win.reload()
  const monte = await win
    .waitForSelector('.stage', { timeout: 12000 })
    .then(() => true)
    .catch(() => false)
  await win.waitForTimeout(1000)
  const vu = await win
    .evaluate(() => ({
      barre: !!document.querySelector('.toolbar'),
      canevas: document.querySelectorAll('.stage canvas').length,
      moteur: !!window.hexaEngine,
    }))
    .catch(() => ({ barre: false, canevas: 0, moteur: false }))
  win.off('pageerror', surErreur)
  return {
    statut: monte && vu.barre && vu.moteur && erreurs.length === 0 ? OK : KO,
    detail: `scène ${monte} · barre ${vu.barre} · ${vu.canevas} canevas · moteur ${vu.moteur} · ${erreurs.length} erreur(s)`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
