#!/usr/bin/env node
/**
 * Hexa — §S19 : LES DEMANDES DE L'UTILISATEUR QUE PERSONNE NE MESURAIT.
 *
 * En relisant la liste de ses demandes une par une, six d'entre elles étaient
 * implémentées mais n'étaient éprouvées PAR AUCUN TEST. Une fonction sans test
 * est une fonction qui marchera jusqu'au refactor suivant, et qui cassera en
 * direct sans prévenir. Les voici, dans ses mots :
 *
 *   1. « la loupe faisait trop gros, mets ×1,7 » — et pas seulement dans un
 *      champ d'état : c'est le GROSSISSEMENT RÉELLEMENT PEINT qu'on mesure ici,
 *      en comptant la période d'une mire de rayures dans le disque ;
 *   2. « les numéros doivent repartir à 1 quand je change de couleur » — avec
 *      l'option ∞ qui, elle, continue la série ;
 *   3. « je veux pouvoir régler la taille du texte » ;
 *   4. « le menu radial, juste les outils essentiels, et pas de son » ;
 *   5. « un bouton pour masquer les annotations et les remontrer » — le BOUTON,
 *      pas seulement le raccourci (que §S18 couvre) ;
 *   6. « relancer en administrateur », la seule parade quand Windows ne livre
 *      pas les touches par-dessus un jeu élevé.
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures, toutEffacer } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's19' })
await etatDeDepart(win)

/* ================================================================== *
 * 1. LA LOUPE GROSSIT VRAIMENT ×1,7
 * ================================================================== */

/**
 * Mire de rayures verticales, à la RÉSOLUTION EXACTE de l'écran : la source
 * fait alors un pixel pour un pixel CSS, et la période lue dans le disque est
 * donc directement la période d'origine multipliée par le grossissement. Sans
 * cette égalité de résolution il faudrait connaître l'échelle du flux, et la
 * mesure ne prouverait plus rien d'absolu.
 */
const PERIODE = 40
await win.evaluate((periode) => {
  const cv = document.createElement('canvas')
  cv.width = window.innerWidth
  cv.height = window.innerHeight
  const c = cv.getContext('2d')
  const peindre = () => {
    for (let x = 0; x < cv.width; x += periode) {
      c.fillStyle = (x / periode) % 2 === 0 ? '#000000' : '#ffffff'
      c.fillRect(x, 0, periode, cv.height)
    }
    setTimeout(peindre, 40)
  }
  peindre()
  window.hexaFx.useTestStream(cv.captureStream(30))
}, PERIODE)
await win.waitForTimeout(500)

/**
 * Période des rayures RÉELLEMENT peintes dans le disque de la loupe, en pixels
 * CSS. On lit une ligne horizontale passant par le centre du disque, bornée à
 * 70 % du rayon : au-delà, §6.4 applique volontairement une déformation
 * optique qui étire les bords, et la mesure n'y serait plus linéaire.
 */
const periodeDansLaLoupe = () =>
  win.evaluate(() => {
    const etat = window.hexaFx.state()
    if (!etat.disc) return null
    // Le disque de la loupe est peint sur le canevas de `.fx-hud` — le plan
    // AU-DESSUS des annotations (`.fx-below` porte le gel et les masques).
    const cv = document.querySelector('.fx-hud canvas')
    if (!cv || !cv.width) return null
    const dpr = cv.width / window.innerWidth
    const ctx = cv.getContext('2d')
    const y = Math.round(etat.disc.y * dpr)
    const rayon = 200 * 0.7 * dpr
    const x0 = Math.round(etat.disc.x * dpr - rayon)
    const largeur = Math.round(rayon * 2)
    const d = ctx.getImageData(x0, y, largeur, 1).data
    // Luminance, puis position des passages par le milieu : chaque paire de
    // fronts successifs vaut une demi-période.
    const fronts = []
    let precedent = null
    for (let i = 0; i < largeur; i++) {
      const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3
      const clair = l > 128
      if (precedent !== null && clair !== precedent) fronts.push(i)
      precedent = clair
    }
    if (fronts.length < 3) return { fronts: fronts.length, periode: null }
    const ecarts = []
    for (let i = 1; i < fronts.length; i++) ecarts.push(fronts[i] - fronts[i - 1])
    ecarts.sort((a, b) => a - b)
    const median = ecarts[Math.floor(ecarts.length / 2)]
    return { fronts: fronts.length, periode: (median * 2) / dpr }
  })

await rapport.test(win, 's19-1-loupe-1-7', 'La loupe grossit ×1,7 — mesuré sur les pixels peints', async (capturer) => {
  await win.keyboard.press('p')
  await win.waitForTimeout(200)
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
      (el.getAttribute('title') ?? '').startsWith('Loupe'),
    )
    b?.click()
  })
  await win.waitForTimeout(300)
  await win.mouse.move(800, 450)
  await win.mouse.down()
  await win.mouse.up()
  await win.waitForTimeout(1400)

  const etat = await win.evaluate(() => window.hexaFx.state())
  const m = await periodeDansLaLoupe()
  await capturer('loupe')

  /*
   * ⚠️ LA PÉRIODE DE LA MIRE VAUT DEUX RAYURES, PAS UNE. `PERIODE` est la
   * largeur d'UNE bande ; le motif complet (une noire + une blanche) fait donc
   * 2 × PERIODE = 80 px à l'écran. C'est cette valeur-là qui est la référence,
   * et l'oublier faisait lire ×3,40 là où la loupe grossit très exactement
   * ×1,70. Tolérance 8 % : interpolation, ressort du disque, arrondis.
   */
  const motifEcran = 2 * 40
  const attendu = motifEcran * 1.7
  const grossissementMesure = m?.periode ? m.periode / motifEcran : null
  const ok =
    etat.zoom === 1.7 &&
    m?.periode != null &&
    Math.abs(m.periode - attendu) / attendu < 0.08
  return {
    statut: ok ? OK : KO,
    detail:
      `état de la loupe : zoom ${etat.zoom} (1,7 exigé) · motif de ${motifEcran} px à l’écran, ` +
      `lu à ${m?.periode?.toFixed(1) ?? '—'} px dans le disque (${attendu} attendus) ` +
      `soit un grossissement RÉELLEMENT PEINT de ×${grossissementMesure?.toFixed(2) ?? '—'} ` +
      `sur ${m?.fronts ?? 0} fronts`,
  }
})

await rapport.test(win, 's19-2-loupe-molette', 'La molette change le grossissement, et le peint', async () => {
  const avant = await periodeDansLaLoupe()
  await win.mouse.move(800, 450)
  for (let i = 0; i < 6; i++) {
    await win.mouse.wheel(0, -100)
    await win.waitForTimeout(120)
  }
  await win.waitForTimeout(900)
  const etat = await win.evaluate(() => window.hexaFx.state())
  const apres = await periodeDansLaLoupe()

  // La période peinte doit suivre le zoom déclaré, dans le même rapport.
  const rapportPeint = apres?.periode && avant?.periode ? apres.periode / avant.periode : null
  const rapportDeclare = etat.zoom / 1.7
  const ok =
    etat.zoom > 1.7 &&
    rapportPeint != null &&
    Math.abs(rapportPeint - rapportDeclare) / rapportDeclare < 0.15
  return {
    statut: ok ? OK : KO,
    detail:
      `zoom ${1.7} → ${etat.zoom.toFixed(2)} (rapport déclaré ×${rapportDeclare.toFixed(2)}) · ` +
      `période peinte ${avant?.periode?.toFixed(1)} → ${apres?.periode?.toFixed(1)} px ` +
      `(rapport peint ×${rapportPeint?.toFixed(2) ?? '—'}) — les deux doivent coïncider`,
  }
})

/* ================================================================== *
 * 2. LE NUMÉROTEUR REPART À 1 AU CHANGEMENT DE COULEUR
 * ================================================================== */

/** Numéros des pastilles réellement posées, dans l'ordre. */
const numeros = () =>
  win.evaluate(
    () =>
      window.hexaEngine
        ?.exportSession?.()
        .strokes.filter((s) => s.tool === 'badge')
        .map((s) => s.badge) ?? [],
  )

const choisirCouleur = (index) =>
  win.evaluate((i) => {
    const sw = document.querySelectorAll('.toolbar .swatch, .toolbar .color, .toolbar [data-color]')
    sw[i]?.click()
  }, index)

await rapport.test(win, 's19-3-numeroteur-couleur', 'Les pastilles repartent à 1 au changement de couleur', async () => {
  await win.keyboard.press('Escape')
  await toutEffacer(win)
  await win.keyboard.press('n') // outil numéroteur (preset Epic Pen : la barre le sélectionne aussi)
  await win.waitForTimeout(250)
  const outil = await win.evaluate(() => window.hexaEngine?.exportSession?.() && document.querySelector('.stage')?.dataset.tool)

  // Trois pastilles dans la première couleur.
  for (const [x, y] of [[400, 300], [520, 300], [640, 300]]) {
    await win.mouse.move(x, y)
    await win.mouse.down()
    await win.mouse.up()
    await win.waitForTimeout(220)
  }
  const serie1 = await numeros()

  // Changement de couleur par le VRAI chemin : la touche « 3 » du clavier.
  await win.keyboard.press('3')
  await win.waitForTimeout(300)
  for (const [x, y] of [[400, 460], [520, 460]]) {
    await win.mouse.move(x, y)
    await win.mouse.down()
    await win.mouse.up()
    await win.waitForTimeout(220)
  }
  const tous = await numeros()
  const serie2 = tous.slice(serie1.length)

  const ok =
    outil === 'badge' &&
    JSON.stringify(serie1) === JSON.stringify([1, 2, 3]) &&
    JSON.stringify(serie2) === JSON.stringify([1, 2])
  return {
    statut: ok ? OK : KO,
    detail:
      `outil « ${outil} » · première couleur : ${JSON.stringify(serie1)} (1,2,3 attendus) · ` +
      `après changement de couleur : ${JSON.stringify(serie2)} (1,2 attendus — la série repart)`,
  }
})

await rapport.test(win, 's19-4-numeroteur-infini', 'L’option ∞ fait CONTINUER la série malgré la couleur', async () => {
  await toutEffacer(win)
  // L'interrupteur « 1|1 / 1→n » de la barre : c'est lui qui gouverne la règle,
  // et c'est son ÉTIQUETTE qui l'identifie (l'info-bulle, elle, décrit l'action
  // à venir et dit donc l'inverse de l'état courant).
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find(
      (el) => el.querySelector('.chip-label')?.textContent?.trim() === '1|1',
    )
    b?.click()
  })
  await win.waitForTimeout(300)
  const continu = await win.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    return raw?.state?.badgeContinuous ?? null
  })

  for (const [x, y] of [[400, 300], [520, 300]]) {
    await win.mouse.move(x, y)
    await win.mouse.down()
    await win.mouse.up()
    await win.waitForTimeout(220)
  }
  await win.keyboard.press('5') // autre couleur
  await win.waitForTimeout(300)
  for (const [x, y] of [[640, 300], [760, 300]]) {
    await win.mouse.move(x, y)
    await win.mouse.down()
    await win.mouse.up()
    await win.waitForTimeout(220)
  }
  const tous = await numeros()

  const ok = continu === true && JSON.stringify(tous) === JSON.stringify([1, 2, 3, 4])
  return {
    statut: ok ? OK : KO,
    detail:
      `option « série continue » : ${continu} (true exigé) · numéros posés : ${JSON.stringify(tous)} ` +
      `(1,2,3,4 attendus — la couleur ne doit RIEN remettre à zéro dans ce mode)`,
  }
})

/* ================================================================== *
 * 3. LA TAILLE DU TEXTE EST RÉGLABLE
 * ================================================================== */

await rapport.test(win, 's19-5-taille-texte', 'La taille du texte se règle, et le texte grandit vraiment', async () => {
  const ecrire = async (taille, mot) => {
    await toutEffacer(win)
    await win.evaluate((t) => {
      const raw = JSON.parse(localStorage.getItem('hexa-ui') ?? '{"state":{}}')
      raw.state = { ...raw.state, size: t, tool: 'text' }
      localStorage.setItem('hexa-ui', JSON.stringify(raw))
    }, taille)
    await win.reload()
    await win.waitForSelector('.stage canvas', { timeout: 15000 })
    await win.waitForTimeout(900)
    // Même geste que la campagne principale : un clic ouvre le champ flottant,
    // on tape, et c'est ENTRÉE qui pose le texte — Échap l'annule, et c'est ce
    // qui ne laissait rien à mesurer.
    await win.mouse.click(400, 400)
    await win.waitForSelector('.hexa-text-field', { timeout: 6000 })
    await win.keyboard.type(mot)
    await win.waitForTimeout(250)
    await win.keyboard.press('Enter')
    await win.waitForTimeout(700)
    return win.evaluate(() => {
      // ⚠️ Le trait de texte ne PORTE PAS de `fontSize` : il porte l'épaisseur
      // `size`, et la police est retraduite au rendu par textSizeOf, soit
      // clamp(size × 5,2 ; 14 ; 96). On refait ici le même calcul que le
      // moteur — lire un champ qui n'existe pas ne mesurerait rien.
      const t = window.hexaEngine?.exportSession?.().strokes.find((x) => x.tool === 'text')
      const s = t ? { fontSize: Math.min(96, Math.max(14, t.size * 5.2)) } : null
      // ⚠️ `.stage` porte TROIS canevas — voile · statique · vif — et le voile
      // est le PREMIER enfant. Il est rendu à 0×0 quand le spotlight ne sert
      // pas : le lire ferait lever `getImageData`. On mesure donc sur tous les
      // canevas réellement dimensionnés.
      let y0 = 1e9
      let y1 = -1
      let n = 0
      for (const cv of document.querySelectorAll('.stage canvas')) {
        if (!cv.width || !cv.height) continue
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) {
            if (d[(y * cv.width + x) * 4 + 3] > 60) {
              n++
              if (y < y0) y0 = y
              if (y > y1) y1 = y
            }
          }
        }
      }
      return { fontSize: s?.fontSize ?? null, hauteur: y1 >= y0 ? y1 - y0 : 0, pixels: n }
    })
  }

  const petit = await ecrire(4, 'HEXA')
  const grand = await ecrire(14, 'HEXA')

  // La taille demandée doit se retrouver dans la police ENREGISTRÉE et dans la
  // hauteur RÉELLEMENT peinte : un réglage qui ne change que l'état ne règle rien.
  const rapportPolice = grand.fontSize && petit.fontSize ? grand.fontSize / petit.fontSize : null
  const rapportPeint = petit.hauteur ? grand.hauteur / petit.hauteur : null
  const ok =
    petit.fontSize != null &&
    grand.fontSize != null &&
    grand.fontSize > petit.fontSize &&
    petit.hauteur > 4 &&
    rapportPeint != null &&
    rapportPeint > 1.8
  return {
    statut: ok ? OK : KO,
    detail:
      `épaisseur 4 → police ${petit.fontSize} px, texte peint sur ${petit.hauteur} px (${petit.pixels} px d’encre) · ` +
      `épaisseur 14 → police ${grand.fontSize} px, ${grand.hauteur} px (${grand.pixels}) · ` +
      `rapport police ×${rapportPolice?.toFixed(2)} · rapport RÉELLEMENT peint ×${rapportPeint?.toFixed(2)} ` +
      `(> 1,8 exigé : le réglage doit se voir à l’écran, pas seulement dans l’état)`,
  }
})

/* ================================================================== *
 * 4. LE MENU RADIAL : SEPT OUTILS, ET PAS UN SON
 * ================================================================== */

await rapport.test(win, 's19-6-radial-essentiels', 'La roue ne montre que les sept outils essentiels', async (capturer) => {
  await win.reload()
  await win.waitForSelector('.stage canvas', { timeout: 15000 })
  await etatDeDepart(win)
  await toutEffacer(win)
  await win.mouse.move(760, 450)
  await win.mouse.down({ button: 'right' })
  await win.waitForTimeout(800)
  const roue = await win.evaluate(() => {
    const r = document.querySelector('.radial')
    if (!r) return null
    return {
      outils: [...r.querySelectorAll('.sect-tool')].map(
        (e) => e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '?',
      ),
      couleurs: r.querySelectorAll('.sect-color').length,
    }
  })
  await capturer('roue')
  await win.mouse.up({ button: 'right' })
  await win.waitForTimeout(400)

  const ok = roue != null && roue.outils.length === 7
  return {
    statut: ok ? OK : KO,
    detail:
      `${roue?.outils.length ?? 0} secteur(s) d’outil (7 exigés : deux fois plus larges à viser, ` +
      `c'est ce qui permet de choisir sans regarder) · ${roue?.couleurs ?? 0} secteur(s) de couleur · ` +
      `outils : ${JSON.stringify(roue?.outils ?? [])}`,
  }
})

await rapport.test(win, 's19-7-radial-silencieux', 'Ouvrir la roue ne produit AUCUN son', async () => {
  // Preuve directe : on compte les AudioContext créés et les nœuds démarrés.
  // Un son ne peut pas sortir sans passer par là.
  await win.evaluate(() => {
    const g = window
    g.__audio = { contextes: 0, sources: 0 }
    for (const nom of ['AudioContext', 'webkitAudioContext']) {
      const Vrai = g[nom]
      if (!Vrai) continue
      g[nom] = class extends Vrai {
        constructor(...a) {
          super(...a)
          g.__audio.contextes++
        }
      }
    }
    const vraiStart = OscillatorNode.prototype.start
    OscillatorNode.prototype.start = function (...a) {
      g.__audio.sources++
      return vraiStart.apply(this, a)
    }
  })

  const sonActif = await win.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hexa-ui') ?? '{}')
    return raw?.state?.sound ?? null
  })

  await win.mouse.move(700, 400)
  await win.mouse.down({ button: 'right' })
  await win.waitForTimeout(700)
  // On survole plusieurs secteurs : c'est le « tick » qui sonnerait.
  for (const [x, y] of [[790, 350], [700, 300], [610, 400], [700, 500]]) {
    await win.mouse.move(x, y)
    await win.waitForTimeout(160)
  }
  await win.mouse.up({ button: 'right' })
  await win.waitForTimeout(600)

  const a = await win.evaluate(() => window.__audio)
  const ok = sonActif === false && a.contextes === 0 && a.sources === 0
  return {
    statut: ok ? OK : KO,
    detail:
      `réglage « sons » : ${sonActif} (false exigé par défaut) · ${a.contextes} contexte(s) audio créé(s) ` +
      `et ${a.sources} oscillateur(s) démarré(s) pendant l’ouverture de la roue et le survol de ` +
      `quatre secteurs (0 et 0 exigés — le direct n’a pas à entendre l’outil)`,
  }
})

/* ================================================================== *
 * 5. LE BOUTON MASQUER / REMONTRER
 * ================================================================== */

await rapport.test(win, 's19-8-bouton-masquer', 'Le bouton masque les annotations, et le même les remontre', async (capturer) => {
  await toutEffacer(win)
  await win.keyboard.press('p')
  await win.waitForTimeout(200)
  await win.mouse.move(400, 300)
  await win.mouse.down()
  await win.mouse.move(900, 500, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(600)

  const encrePeinte = () =>
    win.evaluate(() => {
      let n = 0
      for (const cv of document.querySelectorAll('.stage canvas')) {
        if (!cv.width) continue
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
      }
      return n
    })
  const bouton = () =>
    win.evaluate(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
        /Masquer les annotations|Annotations masquées/.test(el.getAttribute('title') ?? ''),
      )
      return b ? { trouve: true, actif: b.classList.contains('active') } : { trouve: false }
    })
  const cliquer = () =>
    win.evaluate(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
        /Masquer les annotations|Annotations masquées/.test(el.getAttribute('title') ?? ''),
      )
      b?.click()
    })

  const avant = await encrePeinte()
  const b0 = await bouton()
  await cliquer()
  await win.waitForTimeout(800)
  const masque = await encrePeinte()
  const b1 = await bouton()
  await capturer('masquees')
  const traitsPendant = await win.evaluate(
    () => window.hexaEngine?.exportSession?.().strokes.length ?? -1,
  )

  await cliquer()
  await win.waitForTimeout(800)
  const revenu = await encrePeinte()

  const ok =
    b0.trouve === true &&
    avant > 2000 &&
    masque === 0 &&
    b1.actif === true &&
    traitsPendant === 1 &&
    revenu > 2000
  return {
    statut: ok ? OK : KO,
    detail:
      `bouton présent : ${b0.trouve} · encre ${avant} → ${masque} px après le clic (0 exigé) · ` +
      `bouton marqué actif : ${b1.actif} · ${traitsPendant} trait(s) TOUJOURS en mémoire pendant ` +
      `la coupure (1 exigé : masquer n’efface pas) · après le second clic : ${revenu} px`,
  }
})

/* ================================================================== *
 * 6. RELANCER EN ADMINISTRATEUR
 * ================================================================== */

await rapport.test(win, 's19-9-admin-contrat', 'Le processus principal répond sur les privilèges', async () => {
  const p = await win.evaluate(() => window.hexa?.privileges?.() ?? null)
  // Sous Linux, `windows` DOIT valoir false : proposer une relance en
  // administrateur là où ça n'a aucun sens serait un mensonge à l'écran.
  const ok = p != null && typeof p.windows === 'boolean' && typeof p.eleve === 'boolean' && p.windows === false
  return {
    statut: ok ? OK : KO,
    detail:
      `réponse du processus principal : ${JSON.stringify(p)} · ` +
      `« windows » false exigé sur cette plateforme (l’élévation n’y veut rien dire)`,
  }
})

await rapport.test(win, 's19-10-admin-bouton', 'Sur Windows non élevé, l’éditeur propose la relance', async (capturer) => {
  /*
   * L'ÉLÉVATION EST UN MÉCANISME WINDOWS : on ne peut pas l'obtenir sous Xvfb.
   * Ce qu'on éprouve ici est la seule moitié qui vive dans la page, et c'est
   * celle qui casse en silence : la branche d'interface qui affiche
   * l'explication et le bouton quand le processus principal répond
   * « Windows, non élevé ».
   *
   * On remplace donc la RÉPONSE DU PROCESSUS PRINCIPAL, et rien d'autre :
   * `window.hexa` est exposé par contextBridge et n'est pas réinscriptible
   * depuis la page (une première version de ce test l'écrivait dans le vide et
   * ne mesurait donc rien). Tout le chemin réel — préchargement, pont,
   * useEffect de l'éditeur — est ainsi exercé tel quel.
   */
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('hexa:privileges')
    ipcMain.handle('hexa:privileges', () => ({ windows: true, eleve: false }))
  })
  // L'éditeur de raccourcis (.kme) vit DANS le panneau Réglages : c'est par là
  // qu'on l'atteint, exactement comme la campagne principale.
  await win.evaluate(() => {
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
      (el.getAttribute('title') ?? '').startsWith('Réglages'),
    )
    b?.click()
  })
  await win.waitForSelector('.kme', { timeout: 8000 }).catch(() => {})
  await win.waitForTimeout(1400)
  const vu = await win.evaluate(() => {
    const bouton = [...document.querySelectorAll('button')].find((b) =>
      /Relancer Hexa en administrateur/i.test(b.textContent ?? ''),
    )
    const kme = document.querySelector('.kme')
    const texte = kme ? kme.innerText : document.body.innerText
    return {
      editeur: !!kme,
      bouton: !!bouton,
      explique: /jeu lancé en administrateur/i.test(texte),
      altTab: /Alt\+Tab/i.test(texte),
    }
  })
  await capturer('admin')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)

  const ok = vu.editeur && vu.bouton && vu.explique && vu.altTab
  return {
    statut: ok ? OK : KO,
    detail:
      `éditeur de raccourcis ouvert : ${vu.editeur} · bouton « Relancer Hexa en administrateur » : ` +
      `${vu.bouton} · la cause est expliquée (jeu élevé) : ${vu.explique} · le symptôme de ` +
      `l’utilisateur est nommé (Alt+Tab) : ${vu.altTab}`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
