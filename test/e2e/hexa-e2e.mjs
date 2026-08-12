#!/usr/bin/env node
/**
 * Hexa — campagne de tests bout en bout sur la VRAIE application Electron.
 *
 * Ce script lance Hexa comme le fait un double-clic sur l'icône, puis exerce
 * une par une les fonctionnalités promises à l'utilisateur : chaque outil,
 * chaque mécanique, chaque panneau, les deux jeux de raccourcis, et la règle
 * de performance (0 image par seconde au repos).
 *
 * La règle de la maison : un test ne dit « ça marche » que si des PIXELS ont
 * réellement bougé sur les canevas. Une classe CSS « active » ne prouve rien.
 *
 * Utilisation (depuis la racine du dépôt) :
 *   npm run build && npm run build:main
 *   node test/e2e/hexa-e2e.mjs                 # tout
 *   node test/e2e/hexa-e2e.mjs --only=outils   # une section
 *   HEXA_E2E_OUT=/tmp/captures node test/e2e/hexa-e2e.mjs
 *
 * Sous Linux sans écran (CI, conteneur) : préfixer par
 *   xvfb-run -a --server-args="-screen 0 1600x900x24"
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ABSENT,
  CAPTURES,
  KO,
  NON_TESTE,
  OK,
  Rapport,
  cliquerOutil,
  ecrireMot,
  encre,
  encreTotale,
  etat,
  etatDeDepart,
  lancerHexa,
  planeiteHaut,
  preparerCaptures,
  rectangleTremble,
  segment,
  toutEffacer,
  tracer,
} from './harness.mjs'

const SECTIONS = ['demarrage', 'outils', 'mecaniques', 'panneaux', 'raccourcis', 'performance']

const demande = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const aFaire = demande ? demande.split(',') : SECTIONS
const actif = (s) => aFaire.includes(s)

preparerCaptures()
const rapport = new Rapport()

const { app, win, journal } = await lancerHexa()

/* ================================================================== *
 * 1. DÉMARRAGE — l'utilisateur double-clique : que voit-il ?
 * ================================================================== */

if (actif('demarrage')) {
  await rapport.test(win, 'dem-01-fenetre', 'La fenêtre overlay existe', async () => {
    const nb = app.windows().length
    const titre = await win.title()
    const url = win.url()
    return {
      statut: nb >= 1 && url.includes('index.html') ? OK : KO,
      detail: `${nb} fenêtre(s), titre « ${titre} », page ${url.split('/').pop()}`,
    }
  })

  await rapport.test(win, 'dem-02-interface', 'L’interface React est montée', async () => {
    const d = await win.evaluate(() => ({
      root: !!document.querySelector('#root'),
      enfants: document.querySelector('#root')?.childElementCount ?? 0,
      canvas: document.querySelectorAll('.stage canvas').length,
    }))
    return {
      statut: d.root && d.enfants > 0 && d.canvas === 3 ? OK : KO,
      detail: `#root ${d.root ? 'présent' : 'ABSENT'}, ${d.enfants} enfant(s), ${d.canvas} canevas (voile + statique + vif)`,
    }
  })

  await rapport.test(win, 'dem-03-barre', 'La barre d’outils est là et complète', async () => {
    const d = await win.evaluate(() => {
      const barre = document.querySelector('.toolbar')
      if (!barre) return null
      const r = barre.getBoundingClientRect()
      return {
        boutons: barre.querySelectorAll('button').length,
        outils: barre.querySelector('.group')?.querySelectorAll('.tbtn').length ?? 0,
        couleurs: barre.querySelectorAll('.swatch').length,
        visible: r.width > 200 && r.height > 20,
      }
    })
    if (!d) return { statut: ABSENT, detail: 'aucun élément .toolbar dans la page' }
    return {
      statut: d.visible && d.outils >= 12 && d.couleurs === 7 ? OK : KO,
      detail: `${d.boutons} boutons dont ${d.outils} outils et ${d.couleurs} couleurs`,
    }
  })

  await rapport.test(win, 'dem-04-theme', 'Le thème est appliqué', async () => {
    const d = await win.evaluate(() => {
      const st = getComputedStyle(document.documentElement)
      const barre = document.querySelector('.toolbar')
      return {
        theme: document.documentElement.dataset.theme ?? '',
        logo: st.getPropertyValue('--logo-a').trim(),
        verre: st.getPropertyValue('--glass-bg').trim(),
        // la barre doit être réellement peinte, pas juste stylée sur le papier
        fond: barre ? getComputedStyle(barre).backgroundColor : '',
      }
    })
    const peinte = d.fond.length > 0 && d.fond !== 'rgba(0, 0, 0, 0)'
    return {
      statut: d.theme.length > 0 && d.logo.length > 0 && peinte ? OK : KO,
      detail: `data-theme="${d.theme}" · --logo-a ${d.logo || '(vide)'} · --glass-bg ${d.verre || '(vide)'} · fond réel de la barre ${d.fond || '(aucun)'}`,
    }
  })

  await rapport.test(win, 'dem-05-decouverte', 'La découverte guidée s’ouvre au 1er lancement', async () => {
    const d = await win.evaluate(() => {
      const c = document.querySelector('.onb-card')
      return { present: !!c, texte: c?.textContent?.slice(0, 60) ?? '' }
    })
    return {
      statut: d.present ? OK : ABSENT,
      detail: d.present ? `carte affichée : « ${d.texte.trim()}… »` : 'aucune carte .onb-card',
    }
  })

  await rapport.test(win, 'dem-06-erreurs', 'Aucune erreur JavaScript au démarrage', async () => {
    return {
      statut: journal.erreurs.length === 0 ? OK : KO,
      detail:
        journal.erreurs.length === 0
          ? `0 pageerror, ${journal.consoleErreurs.length} erreur(s) console`
          : `pageerror : ${journal.erreurs.join(' | ').slice(0, 200)}`,
    }
  })
}

// À partir d'ici on part d'un état propre et déterministe : découverte vue,
// fondu sur ∞ (sinon les traits s'effacent au milieu des mesures).
await etatDeDepart(win)

/* ================================================================== *
 * 2. OUTILS — chacun sélectionné au clavier ET au clic, puis utilisé
 * ================================================================== */

/**
 * Un outil = une touche, un libellé de bouton, un geste, et la preuve
 * qu'il pose de l'encre. `attendu` vaut false pour la gomme (elle en enlève).
 */
const OUTILS = [
  {
    id: 'pen',
    nom: 'Pinceau',
    touche: 'p',
    libelle: 'Pinceau',
    geste: (w) => tracer(w, [[420, 300], [520, 240], [620, 320], [720, 250], [820, 330]]),
  },
  {
    id: 'highlight',
    nom: 'Surligneur',
    touche: 's',
    libelle: 'Surligneur',
    geste: (w) => tracer(w, segment(420, 400, 860, 400, 14)),
  },
  {
    id: 'line',
    nom: 'Ligne',
    touche: 'l',
    libelle: 'Ligne',
    geste: (w) => tracer(w, segment(420, 300, 800, 460, 8)),
  },
  {
    id: 'arrow',
    nom: 'Flèche',
    touche: 'f',
    libelle: 'Flèche',
    geste: (w) => tracer(w, segment(420, 300, 820, 300, 8)),
  },
  {
    id: 'rect',
    nom: 'Rectangle',
    touche: 'r',
    libelle: 'Rectangle',
    geste: (w) => tracer(w, segment(420, 280, 800, 480, 8)),
  },
  {
    id: 'ellipse',
    nom: 'Ellipse',
    touche: 'o',
    libelle: 'Ellipse',
    geste: (w) => tracer(w, segment(420, 280, 800, 480, 8)),
  },
  {
    id: 'text',
    nom: 'Texte',
    touche: 't',
    libelle: 'Texte',
    geste: async (w) => {
      await w.mouse.click(500, 350)
      await w.waitForSelector('.hexa-text-field', { timeout: 4000 })
      await w.keyboard.type('Hexa')
      await w.keyboard.press('Enter')
      await w.waitForTimeout(500)
    },
  },
  {
    id: 'badge',
    nom: 'Numéroteur',
    touche: 'n',
    libelle: 'Numéroteur',
    geste: async (w) => {
      await w.mouse.click(500, 350)
      await w.waitForTimeout(250)
      await w.mouse.click(700, 430)
      await w.waitForTimeout(700)
    },
  },
  {
    id: 'measure',
    nom: 'Mesure',
    touche: 'm',
    libelle: 'Règle de mesure',
    geste: (w) => tracer(w, segment(420, 300, 780, 420, 8)),
  },
  {
    id: 'stamp',
    nom: 'Tampon',
    touche: 'i',
    libelle: null, // pas de bouton dédié dans la barre : sélection au clavier / au collage
    geste: async (w) => {
      // On simule un VRAI collage d'image (Ctrl+V) : le moteur doit basculer
      // tout seul sur le tampon, puis le clic pose l'image.
      await w.evaluate(async () => {
        const cv = document.createElement('canvas')
        cv.width = 140
        cv.height = 100
        const c = cv.getContext('2d')
        c.fillStyle = '#ff2d95'
        c.fillRect(0, 0, 140, 100)
        c.fillStyle = '#ffffff'
        c.fillRect(20, 20, 100, 60)
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'))
        const dt = new DataTransfer()
        dt.items.add(new File([blob], 'test.png', { type: 'image/png' }))
        window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
      })
      await w.waitForTimeout(500)
      await w.mouse.click(600, 380)
      await w.waitForTimeout(600)
    },
  },
  {
    id: 'laser',
    nom: 'Laser',
    touche: null, // outil momentané : se tient (Z), ne se « sélectionne » pas
    libelle: 'Laser',
    geste: async (w) => {
      await w.mouse.move(420, 300)
      for (let i = 1; i <= 16; i++) {
        await w.mouse.move(420 + i * 22, 300 + Math.sin(i / 2) * 60)
        await w.waitForTimeout(12)
      }
      await w.waitForTimeout(60)
    },
    ephemere: true,
  },
]

if (actif('outils')) {
  for (const o of OUTILS) {
    await rapport.test(win, `out-${o.id}`, `Outil ${o.nom} : sélection + tracé`, async (capturer) => {
      await toutEffacer(win)
      const notes = []

      // --- sélection au CLAVIER ---
      if (o.touche) {
        await win.keyboard.press('h') // on masque la barre pour être sûr que la
        await win.keyboard.press('h') // touche n'est pas juste un clic déguisé
        await win.keyboard.press(o.touche)
        await win.waitForTimeout(200)
        const e1 = await etat(win)
        notes.push(`clavier « ${o.touche} » → ${e1.tool}`)
        if (e1.tool !== o.id) return { statut: KO, detail: notes.join(' · ') + ' (attendu ' + o.id + ')' }
      } else {
        notes.push('clavier : outil momentané, testé en section mécaniques')
      }

      // --- sélection au CLIC ---
      if (o.libelle) {
        await win.keyboard.press('p')
        await win.waitForTimeout(120)
        const trouve = await cliquerOutil(win, o.libelle)
        const e2 = await etat(win)
        notes.push(`clic barre → ${e2.tool}`)
        if (!trouve) return { statut: KO, detail: notes.join(' · ') + ' (bouton introuvable)' }
        if (e2.tool !== o.id) return { statut: KO, detail: notes.join(' · ') + ' (attendu ' + o.id + ')' }
      } else {
        notes.push('clic : pas de bouton dédié')
      }

      // --- tracé et PREUVE en pixels ---
      const avant = await encreTotale(win)
      if (o.id === 'laser') {
        // le laser est momentané : on tient la touche pendant le geste
        await win.keyboard.down('z')
        await win.waitForTimeout(120)
      }
      await o.geste(win)
      const pendant = await encre(win)
      if (o.id === 'laser') {
        await capturer('trainee')
        await win.keyboard.up('z')
      }
      await win.waitForTimeout(500)
      const apres = await encre(win)
      const pose = (o.ephemere ? pendant.total : apres.total) - avant
      notes.push(`encre ${avant} → ${o.ephemere ? pendant.total : apres.total} (+${pose} px)`)
      if (apres.boite) notes.push(`boîte ${apres.boite.w}×${apres.boite.h}`)
      if (o.ephemere && pendant.boite) notes.push(`boîte ${pendant.boite.w}×${pendant.boite.h}`)
      return {
        statut: pose > 300 ? OK : KO,
        detail: notes.join(' · ') + (pose > 300 ? '' : ' — RIEN DE DESSINÉ'),
      }
    })
  }

  // Gomme : elle doit ENLEVER de l'encre, et seulement celle qu'on vise.
  await rapport.test(win, 'out-eraser', 'Outil Gomme : sélection + effacement ciblé', async () => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    await tracer(win, segment(400, 260, 900, 260, 14))
    await tracer(win, segment(400, 520, 900, 520, 14))
    await win.waitForTimeout(400)
    const avant = await encreTotale(win)

    await win.keyboard.press('e')
    await win.waitForTimeout(200)
    const parClavier = (await etat(win)).tool
    await win.keyboard.press('p')
    await cliquerOutil(win, 'Gomme')
    const parClic = (await etat(win)).tool

    await tracer(win, segment(380, 260, 920, 262, 20), { pauseMs: 12 })
    await win.waitForTimeout(700)
    const apres = await encreTotale(win)
    const ok = parClavier === 'eraser' && parClic === 'eraser' && apres < avant * 0.75 && apres > 200
    return {
      statut: ok ? OK : KO,
      detail: `clavier « e » → ${parClavier} · clic → ${parClic} · encre ${avant} → ${apres} (le 2e trait doit survivre)`,
    }
  })
}

/* ================================================================== *
 * 3. MÉCANIQUES
 * ================================================================== */

if (actif('mecaniques')) {
  // --- fondu automatique : 2 s puis ∞ (exigence forte de l'utilisateur) ---
  await rapport.test(win, 'mec-fondu-2s', 'Fondu auto 2 s : le trait s’efface tout seul', async () => {
    await toutEffacer(win)
    // le bouton « durée du fondu » fait tourner 2s → 4s → 8s → ∞
    const regler = async (cible) => {
      for (let i = 0; i < 5; i++) {
        const val = await win.evaluate(
          () => document.querySelector('.toolbar .chip-label')?.textContent ?? '',
        )
        if (val === cible) return val
        await win.keyboard.press('d')
        await win.waitForTimeout(160)
      }
      return await win.evaluate(
        () => document.querySelector('.toolbar .chip-label')?.textContent ?? '',
      )
    }
    const affiche = await regler('2s')
    await win.keyboard.press('p')
    await tracer(win, segment(430, 320, 880, 400, 12))
    await win.waitForTimeout(400)
    const juste = await encreTotale(win)
    await win.waitForTimeout(3800)
    const apres = await encreTotale(win)
    return {
      statut: affiche === '2s' && juste > 500 && apres === 0 ? OK : KO,
      detail: `chip « ${affiche} » · encre ${juste} → ${apres} après 3,8 s (attendu 0)`,
    }
  })

  await rapport.test(win, 'mec-fondu-infini', 'Fondu ∞ : le trait est TOUJOURS là 6 s après', async () => {
    await toutEffacer(win)
    let affiche = ''
    for (let i = 0; i < 5; i++) {
      affiche = await win.evaluate(
        () => document.querySelector('.toolbar .chip-label')?.textContent ?? '',
      )
      if (affiche === '∞') break
      await win.keyboard.press('d')
      await win.waitForTimeout(160)
    }
    await win.keyboard.press('p')
    await tracer(win, segment(430, 320, 880, 400, 12))
    await win.waitForTimeout(500)
    const juste = await encreTotale(win)
    await win.waitForTimeout(6200)
    const apres = await encreTotale(win)
    return {
      statut: affiche === '∞' && juste > 500 && apres > 500 ? OK : KO,
      detail: `chip « ${affiche} » · encre ${juste} → ${apres} après 6,2 s (doit rester > 0)`,
    }
  })

  await rapport.test(win, 'mec-dissolution', 'Dissolution progressive (pas une disparition sèche)', async () => {
    await toutEffacer(win)
    // 2 s de fondu : on échantillonne pendant la dissolution
    for (let i = 0; i < 5; i++) {
      const v = await win.evaluate(
        () => document.querySelector('.toolbar .chip-label')?.textContent ?? '',
      )
      if (v === '2s') break
      await win.keyboard.press('d')
      await win.waitForTimeout(160)
    }
    await win.keyboard.press('p')
    await tracer(win, segment(430, 340, 900, 340, 14))
    await win.waitForTimeout(500)
    const pleine = await encreTotale(win)
    // la dissolution démarre à t+2 s et dure quelques centaines de ms
    await win.waitForTimeout(1600)
    const mesures = []
    for (let i = 0; i < 14; i++) {
      mesures.push(await encreTotale(win))
      await win.waitForTimeout(45)
    }
    const intermediaire = mesures.some((m) => m > 0 && m < pleine * 0.92)
    return {
      statut: intermediaire ? OK : KO,
      detail: `pleine ${pleine}, échantillons pendant la dissolution : ${mesures.join(', ')}`,
    }
  })

  // --- retour en ∞ pour la suite ---
  const passerEnInfini = async () => {
    for (let i = 0; i < 5; i++) {
      const v = await win.evaluate(
        () => document.querySelector('.toolbar .chip-label')?.textContent ?? '',
      )
      if (v === '∞') return
      await win.keyboard.press('d')
      await win.waitForTimeout(160)
    }
  }
  await passerEnInfini()

  await rapport.test(win, 'mec-grab', 'Attraper une annotation au clic droit', async () => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    await tracer(win, segment(420, 300, 760, 300, 12))
    await win.waitForTimeout(500)
    const avant = (await encre(win)).boite
    // clic droit MAINTENU sur le trait, puis on le déplace vers le bas
    await win.mouse.move(590, 300)
    await win.mouse.down({ button: 'right' })
    await win.waitForTimeout(120)
    for (let i = 1; i <= 10; i++) {
      await win.mouse.move(590 + i * 8, 300 + i * 18)
      await win.waitForTimeout(16)
    }
    await win.mouse.up({ button: 'right' })
    await win.waitForTimeout(800)
    const apres = (await encre(win)).boite
    if (!avant || !apres) return { statut: KO, detail: 'aucune encre mesurable' }
    const dy = apres.y - avant.y
    return {
      statut: dy > 100 ? OK : KO,
      detail: `boîte y ${avant.y} → ${apres.y} (déplacement vertical ${dy} px, attendu ≈ 180)`,
    }
  })

  await rapport.test(win, 'mec-gomme-trait', 'Gomme par trait entier (pas par pixel)', async () => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    await tracer(win, segment(400, 260, 900, 260, 14))
    await win.waitForTimeout(400)
    const avant = await encreTotale(win)
    await win.keyboard.press('e')
    // on ne touche QUE le milieu du trait : s'il s'efface en entier, c'est bien
    // une gomme par trait, comme promis (et non un grattage local)
    await tracer(win, segment(640, 250, 660, 270, 4), { pauseMs: 20 })
    await win.waitForTimeout(700)
    const apres = await encreTotale(win)
    return {
      statut: avant > 500 && apres === 0 ? OK : KO,
      detail: `encre ${avant} → ${apres} après un simple passage au milieu (0 = trait entier retiré)`,
    }
  })

  await rapport.test(win, 'mec-undo-redo', 'Annuler / Rétablir', async () => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    // Formes intelligentes coupées le temps du test : sinon un trait droit au
    // pinceau devient une ligne nette, et le premier Ctrl+Z rend le tracé brut
    // au lieu de supprimer (comportement voulu, vérifié par mec-formes).
    if ((await etat(win)).smartShapes !== false) await win.keyboard.press('w')
    await win.waitForTimeout(150)
    await tracer(win, segment(420, 300, 780, 300, 12))
    await tracer(win, segment(420, 420, 780, 420, 12))
    await win.waitForTimeout(500)
    const deux = await encreTotale(win)
    // l'annulation n'est pas sèche : le trait « pop » puis disparaît, il faut
    // laisser l'animation finir avant de mesurer
    await win.keyboard.press('Control+z')
    await win.waitForTimeout(1400)
    const un = await encreTotale(win)
    await win.keyboard.press('Control+z')
    await win.waitForTimeout(1400)
    const zero = await encreTotale(win)
    await win.keyboard.press('Control+y')
    await win.waitForTimeout(1000)
    const refait = await encreTotale(win)
    await win.keyboard.press('w') // on remet les formes intelligentes
    const ok = deux > 0 && un > 0 && un < deux && zero === 0 && refait > 0
    return {
      statut: ok ? OK : KO,
      detail: `2 traits ${deux} px · Ctrl+Z ${un} · Ctrl+Z ${zero} · Ctrl+Y ${refait}`,
    }
  })

  await rapport.test(win, 'mec-clear', 'Tout effacer', async () => {
    await win.keyboard.press('p')
    await tracer(win, segment(420, 300, 900, 460, 12))
    await tracer(win, segment(420, 460, 900, 300, 12))
    await win.waitForTimeout(500)
    const avant = await encreTotale(win)
    await win.keyboard.press('c')
    await win.waitForTimeout(1000)
    const apres = await encreTotale(win)
    return {
      statut: avant > 500 && apres === 0 ? OK : KO,
      detail: `encre ${avant} → ${apres}`,
    }
  })

  await rapport.test(win, 'mec-formes', 'Formes intelligentes : le gribouillis se redresse', async (capturer) => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    // on s'assure que les formes intelligentes sont bien allumées
    const eAvant = await etat(win)
    if (eAvant.smartShapes === false) await win.keyboard.press('w')
    await tracer(win, rectangleTremble(430, 280, 420, 260), { pauseMs: 6 })
    await win.waitForTimeout(1600) // le morph vers la forme nette
    const droit = await planeiteHaut(win)
    await capturer('1-redresse')

    // Ctrl+Z doit rendre le GRIBOUILLIS, pas supprimer le trait (§4.1.5)
    await win.keyboard.press('Control+z')
    await win.waitForTimeout(1400)
    const brut = await planeiteHaut(win)
    const encreBrute = await encreTotale(win)

    const redresse = droit && droit.ecartType < 1.5
    const revenu = encreBrute > 500 && brut && brut.ecartType > 2.5
    return {
      statut: redresse && revenu ? OK : KO,
      detail:
        `bord haut après morph : écart-type ${droit ? droit.ecartType.toFixed(2) : '?'} px (rectangle net attendu < 1,5) · ` +
        `après Ctrl+Z : ${encreBrute} px d'encre, écart-type ${brut ? brut.ecartType.toFixed(2) : '?'} px (gribouillis attendu > 2,5)`,
    }
  })

  await rapport.test(win, 'mec-guides', 'Guides magnétiques : la ligne s’aimante à l’horizontale', async () => {
    await toutEffacer(win)
    const mesurer = async () => {
      await toutEffacer(win)
      await win.keyboard.press('l')
      await win.waitForTimeout(150)
      // ligne volontairement de travers : 6 px de dénivelé sur 400
      await tracer(win, segment(430, 350, 830, 356, 8))
      await win.waitForTimeout(500)
      const b = (await encre(win)).boite
      return b ? b.h : -1
    }
    const eAvant = await etat(win)
    if (eAvant.guides === false) await win.keyboard.press('g')
    const avecGuides = await mesurer()
    await win.keyboard.press('g') // guides coupés
    await win.waitForTimeout(200)
    const sansGuides = await mesurer()
    await win.keyboard.press('g') // on remet comme avant
    const ok = avecGuides > 0 && sansGuides > 0 && avecGuides < sansGuides
    return {
      statut: ok ? OK : KO,
      detail: `hauteur de la boîte : ${avecGuides} px avec guides · ${sansGuides} px sans (l'aimantation doit aplatir la ligne)`,
    }
  })

  await rapport.test(win, 'mec-molette', 'Molette : épaisseur du pinceau', async () => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    await win.mouse.move(700, 450)
    const t0 = (await etat(win)).size
    for (let i = 0; i < 4; i++) {
      await win.mouse.wheel(0, -120)
      await win.waitForTimeout(90)
    }
    const gros = (await etat(win)).size
    await tracer(win, segment(430, 300, 900, 300, 12))
    await win.waitForTimeout(400)
    const encreGrosse = (await encre(win)).boite?.h ?? 0
    await toutEffacer(win)
    await win.mouse.move(700, 450)
    for (let i = 0; i < 8; i++) {
      await win.mouse.wheel(0, 120)
      await win.waitForTimeout(90)
    }
    const fin = (await etat(win)).size
    await tracer(win, segment(430, 300, 900, 300, 12))
    await win.waitForTimeout(400)
    const encreFine = (await encre(win)).boite?.h ?? 0
    return {
      statut: gros > t0 && fin < gros && encreFine < encreGrosse ? OK : KO,
      detail: `taille ${t0} → molette haut ${gros} → molette bas ${fin} · épaisseur réellement peinte ${encreGrosse} px puis ${encreFine} px`,
    }
  })

  await rapport.test(win, 'mec-shift-alt', 'Maj : carré parfait · Alt : forme remplie', async () => {
    await toutEffacer(win)
    await win.keyboard.press('r')
    await win.waitForTimeout(150)
    // Maj enfoncé : le rectangle doit devenir un carré même si le geste ne l'est pas
    await win.keyboard.down('Shift')
    await tracer(win, segment(430, 280, 830, 430, 8))
    await win.keyboard.up('Shift')
    await win.waitForTimeout(500)
    const carre = (await encre(win)).boite
    const contour = (await encre(win)).statique

    await toutEffacer(win)
    await tracer(win, segment(430, 280, 830, 480, 8))
    await win.waitForTimeout(500)
    const videPx = (await encre(win)).statique

    await toutEffacer(win)
    // Alt enfoncé : la même forme, mais pleine
    await win.keyboard.down('Alt')
    await tracer(win, segment(430, 280, 830, 480, 8))
    await win.keyboard.up('Alt')
    await win.waitForTimeout(500)
    const rempliPx = (await encre(win)).statique

    const estCarre = carre && Math.abs(carre.w - carre.h) < 12
    const estRempli = rempliPx > videPx * 1.8
    return {
      statut: estCarre && estRempli ? OK : KO,
      detail: `Maj → boîte ${carre?.w}×${carre?.h} (carré attendu, contour ${contour} px) · Alt → ${rempliPx} px contre ${videPx} px sans (forme pleine attendue)`,
    }
  })

  await rapport.test(win, 'mec-export', 'Exporter la session en JSON', async () => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    await tracer(win, segment(430, 320, 900, 400, 12))
    await tracer(win, segment(430, 460, 900, 380, 12))
    await win.waitForTimeout(500)
    // Le bouton d'export fabrique un blob et déclenche un téléchargement. On
    // intercepte le blob lui-même (l'URL, elle, est révoquée dans la foulée) et
    // on neutralise le clic pour ne pas ouvrir une vraie boîte d'enregistrement.
    const contenu = await win.evaluate(async () => {
      const vraiUrl = URL.createObjectURL.bind(URL)
      const vraiClic = HTMLAnchorElement.prototype.click
      let blob = null
      URL.createObjectURL = (b) => {
        blob = b
        return vraiUrl(b)
      }
      HTMLAnchorElement.prototype.click = function () {}
      try {
        const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
          (el.getAttribute('title') ?? '').startsWith('Exporter'),
        )
        b?.click()
      } finally {
        URL.createObjectURL = vraiUrl
        HTMLAnchorElement.prototype.click = vraiClic
      }
      return blob ? await blob.text() : null
    })
    if (!contenu) {
      return { statut: KO, detail: 'le bouton d’export n’a produit aucun fichier téléchargeable' }
    }
    let json = null
    try {
      json = JSON.parse(contenu)
    } catch {
      return { statut: KO, detail: `contenu illisible : ${contenu.slice(0, 120)}` }
    }
    const ok = json.app === 'hexa' && Array.isArray(json.strokes) && json.strokes.length === 2
    return {
      statut: ok ? OK : KO,
      detail: `JSON « ${json.app} » v${json.version}, ${json.strokes?.length} traits, ${contenu.length} octets (2 traits dessinés)`,
    }
  })

  await rapport.test(win, 'mec-ecriture', 'Mode écriture : le manuscrit devient une typo', async () => {
    await toutEffacer(win)
    await win.keyboard.press('j') // bascule du mode écriture
    await win.waitForTimeout(200)
    const e = await etat(win)
    if (e.handwriting !== true) {
      return { statut: KO, detail: `la touche J n'a pas allumé le mode écriture (handwriting=${e.handwriting})` }
    }
    await win.keyboard.press('p')
    // Formes intelligentes coupées : sinon chaque jambage droit d'une lettre
    // est d'abord redressé en ligne nette, et on ne mesurerait plus l'écart
    // entre un tracé manuscrit et sa mise en typographie.
    if ((await etat(win)).smartShapes !== false) await win.keyboard.press('w')
    await win.waitForTimeout(150)
    await ecrireMot(win, 'VAL', 430, 330, 76)
    await win.waitForTimeout(300)
    const avant = await encre(win)
    // la transcription part d'elle-même ~600 ms après le dernier trait
    await win.waitForTimeout(2400)
    const apres = await encre(win)
    await win.keyboard.press('w') // formes intelligentes remises
    await win.keyboard.press('j') // mode écriture éteint pour la suite
    // la typo PLEINE remplace un tracé filaire : sur le canevas des annotations
    // (hors étincelles), l'encre bondit franchement
    const transcrit = apres.statique > avant.statique * 1.4
    return {
      statut: transcrit ? OK : KO,
      detail:
        `manuscrit ${avant.statique} px (boîte ${avant.boite?.w}×${avant.boite?.h}) → ` +
        `typo ${apres.statique} px (boîte ${apres.boite?.w}×${apres.boite?.h}) — le mot « VAL » doit passer en typographie pleine`,
    }
  })
}

/* ================================================================== *
 * 4. PANNEAUX
 * ================================================================== */

if (actif('panneaux')) {
  await toutEffacer(win)

  await rapport.test(win, 'pan-reglages', 'Panneau Réglages : ouverture et fermeture', async () => {
    await win.evaluate(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
        (el.getAttribute('title') ?? '').startsWith('Réglages'),
      )
      b?.click()
    })
    await win.waitForTimeout(700)
    const ouvert = await win.evaluate(() => {
      const p = document.querySelector('.hx-settings')
      return { present: !!p, sections: document.querySelectorAll('.hx-settings .hx-sec').length }
    })
    if (!ouvert.present) return { statut: ABSENT, detail: 'le panneau .hx-settings ne s’ouvre pas' }
    await win.keyboard.press('Escape')
    await win.waitForTimeout(600)
    const ferme = await win.evaluate(() => !document.querySelector('.hx-settings'))
    return {
      statut: ferme ? OK : KO,
      detail: `${ouvert.sections} sections · fermeture par Échap : ${ferme ? 'oui' : 'NON'}`,
    }
  })

  await rapport.test(win, 'pan-themes', 'Galerie de thèmes : les 8 se chargent et s’appliquent', async () => {
    await win.evaluate(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
        (el.getAttribute('title') ?? '').startsWith('Réglages'),
      )
      b?.click()
    })
    await win.waitForSelector('.hx-theme', { timeout: 5000 })
    const noms = await win.evaluate(() =>
      [...document.querySelectorAll('.hx-theme')].map(
        (t) => t.querySelector('.hx-theme-name')?.textContent?.trim() ?? '?',
      ),
    )
    const avant = await win.evaluate(() => document.documentElement.dataset.theme)
    // on essaie chaque thème pour de vrai : un thème qui ne s'applique pas est
    // un thème cassé, même s'il apparaît dans la liste
    const appliques = []
    for (let i = 0; i < noms.length; i++) {
      await win.evaluate((k) => document.querySelectorAll('.hx-theme')[k]?.click(), i)
      await win.waitForTimeout(220)
      appliques.push(await win.evaluate(() => document.documentElement.dataset.theme))
    }
    const distincts = new Set(appliques).size
    // retour au thème initial
    const idx = appliques.indexOf(avant)
    if (idx >= 0) await win.evaluate((k) => document.querySelectorAll('.hx-theme')[k]?.click(), idx)
    await win.waitForTimeout(300)
    return {
      statut: noms.length === 8 && distincts === 8 ? OK : KO,
      detail: `${noms.length} thèmes listés, ${distincts} réellement appliqués : ${noms.join(', ')}`,
    }
  })

  await rapport.test(win, 'pan-profils', 'Panneau Profils : les profils s’appliquent', async () => {
    const info = await win.evaluate(() => {
      const p = document.querySelector('.profiles')
      if (!p) return null
      return {
        cartes: p.querySelectorAll('.profile-card').length,
        noms: [...p.querySelectorAll('.profile-name')].map((n) => n.textContent?.trim()),
      }
    })
    if (!info) return { statut: ABSENT, detail: 'aucun élément .profiles dans les réglages' }
    const avant = await etat(win)
    // on applique le 2e profil (le 1er est souvent celui déjà actif)
    await win.evaluate(() => document.querySelectorAll('.profiles .profile-card')[1]?.click())
    await win.waitForTimeout(500)
    const apres = await etat(win)
    const change = apres.profileId !== avant.profileId
    return {
      statut: info.cartes >= 2 && change ? OK : KO,
      detail: `${info.cartes} profils (${info.noms.slice(0, 4).join(', ')}…) · profil ${avant.profileId} → ${apres.profileId}`,
    }
  })

  await rapport.test(win, 'pan-raccourcis', 'Éditeur de raccourcis : presets', async () => {
    const info = await win.evaluate(() => {
      const k = document.querySelector('.kme')
      if (!k) return null
      return {
        presets: [...k.querySelectorAll('.kme-preset')].map((b) => b.textContent?.trim().slice(0, 24)),
        actif: k.querySelector('.kme-preset[data-on="1"]')?.textContent?.trim() ?? '(aucun)',
        lignes: k.querySelectorAll('.kme-row').length,
        combos: k.querySelectorAll('.kme-key').length,
      }
    })
    if (!info) return { statut: ABSENT, detail: 'aucun élément .kme dans les réglages' }
    const avant = (await etat(win)).keymapPreset
    // on clique le preset qui n'est PAS actif (« Personnalisé » est désactivé)
    await win.evaluate(() =>
      document.querySelector('.kme-preset[data-on="0"]:not([disabled])')?.click(),
    )
    await win.waitForTimeout(500)
    const apres = (await etat(win)).keymapPreset
    // et on revient au preset d'origine
    await win.evaluate(() =>
      document.querySelector('.kme-preset[data-on="0"]:not([disabled])')?.click(),
    )
    await win.waitForTimeout(400)
    const retour = (await etat(win)).keymapPreset
    return {
      statut: info.lignes >= 30 && apres !== avant && retour === avant ? OK : KO,
      detail: `presets [${info.presets.join(' | ')}], actif « ${info.actif} » · ${info.lignes} actions, ${info.combos} combinaisons affichées · bascule ${avant} → ${apres} → ${retour}`,
    }
  })

  await rapport.test(win, 'pan-remap', 'Raccourci personnalisable : remap réel au clavier', async () => {
    // On remappe « Rectangle » sur la touche Y, puis on vérifie que Y sort
    // VRAIMENT le rectangle : c'est la promesse « customisable ».
    const cible = await win.evaluate(() => {
      const ligne = [...document.querySelectorAll('.kme-row')].find(
        (r) => r.querySelector('.kme-label b')?.textContent?.trim() === 'Rectangle',
      )
      if (!ligne) return null
      const touche = ligne.querySelector('.kme-key')
      const avant = touche?.textContent?.trim() ?? ''
      touche?.click()
      return avant
    })
    if (cible == null) return { statut: ABSENT, detail: 'ligne « Rectangle » introuvable dans l’éditeur' }
    await win.waitForTimeout(300)
    await win.keyboard.press('y')
    await win.waitForTimeout(500)
    const nouvelle = await win.evaluate(() => {
      const ligne = [...document.querySelectorAll('.kme-row')].find(
        (r) => r.querySelector('.kme-label b')?.textContent?.trim() === 'Rectangle',
      )
      return ligne?.querySelector('.kme-key')?.textContent?.trim() ?? ''
    })
    const enregistre = (await etat(win)).keymapOverrides?.['tool.rect']
    // on ferme les réglages et on essaie la touche pour de vrai
    await win.evaluate(() => document.querySelector('.hx-close')?.click())
    await win.waitForTimeout(500)
    await win.keyboard.press('p')
    await win.waitForTimeout(180)
    await win.keyboard.press('y')
    await win.waitForTimeout(250)
    const outil = (await etat(win)).tool
    // remise à zéro : on ne laisse pas un clavier bricolé aux tests suivants
    await etatDeDepart(win)
    return {
      statut: nouvelle.toLowerCase() === 'y' && outil === 'rect' ? OK : KO,
      detail: `« ${cible} » → « ${nouvelle} » (store : ${JSON.stringify(enregistre)}) · la touche Y sort maintenant l’outil « ${outil} »`,
    }
  })

  await rapport.test(win, 'pan-replay', 'Barre de rejeu de session', async () => {
    // il faut quelque chose à rejouer : l'enregistreur observe le moteur
    await win.keyboard.press('p')
    await tracer(win, segment(430, 320, 900, 420, 14))
    await win.waitForTimeout(600)
    await win.evaluate(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
        (el.getAttribute('title') ?? '').startsWith('Réglages'),
      )
      b?.click()
    })
    await win.waitForTimeout(600)
    // « Rejouer la session » rejoue ce qui vient d'être dessiné ;
    // « Importer et rejouer » ouvre un sélecteur de fichier (hors test).
    const clique = await win.evaluate(() => {
      const b = [...document.querySelectorAll('.hx-btn')].find(
        (el) => (el.textContent ?? '').trim() === 'Rejouer la session',
      )
      if (!b) return null
      b.click()
      return b.textContent?.trim()
    })
    if (!clique) return { statut: ABSENT, detail: 'aucun bouton « Rejouer la session » dans les réglages' }
    await win.waitForTimeout(1200)
    const barre = await win.evaluate(() => {
      const r = document.querySelector('.rp-bar-root')
      return r
        ? {
            present: true,
            canvas: !!document.querySelector('.rp-canvas'),
            lecture: !!document.querySelector('.rp-play'),
            texte: document.querySelector('.rp-count')?.textContent?.trim() ?? '',
          }
        : { present: false }
    })
    if (barre.present) {
      await win.keyboard.press('Escape')
      await win.waitForTimeout(500)
    }
    return {
      statut: barre.present && barre.canvas ? OK : KO,
      detail: `bouton « ${clique} » · barre ${barre.present ? 'ouverte' : 'ABSENTE'}, canevas de rejeu ${barre.canvas ? 'présent' : 'absent'}, ${barre.texte}`,
    }
  })

  await rapport.test(win, 'pan-aide', 'Panneau d’aide (touche ?)', async () => {
    await win.evaluate(() => document.querySelector('.hx-close')?.click())
    await win.waitForTimeout(400)
    await win.keyboard.press('Shift+,')
    await win.waitForTimeout(600)
    // Depuis S7, la touche « ? » ouvre le PANNEAU D'AIDE (.hlp) : les gestes,
    // le clavier actif, le stream et le dépannage. La fiche imprimable (.shs)
    // vit maintenant dans son onglet « Raccourcis ».
    let ouvert = await win.evaluate(() => !!document.querySelector('.hlp'))
    if (!ouvert) {
      await win.keyboard.press('Shift+/')
      await win.waitForTimeout(600)
      ouvert = await win.evaluate(() => !!document.querySelector('.hlp'))
    }
    if (ouvert) {
      await win.evaluate(() =>
        [...document.querySelectorAll('.hlp-tab')]
          .find((b) => b.textContent === 'Raccourcis')
          ?.click(),
      )
      await win.waitForTimeout(350)
    }
    const combos = ouvert
      ? await win.evaluate(() => document.querySelectorAll('.hlp-kbd').length)
      : 0
    if (ouvert) {
      await win.keyboard.press('Escape')
      await win.waitForTimeout(400)
    }
    return {
      statut: ouvert && combos > 20 ? OK : KO,
      detail: ouvert ? `feuille ouverte, ${combos} combinaisons listées` : 'la feuille ne s’ouvre pas (Maj+, et Maj+/ essayés)',
    }
  })

  await rapport.test(win, 'pan-radial', 'Menu radial (clic droit maintenu dans le vide)', async (capturer) => {
    await toutEffacer(win)
    await win.mouse.move(760, 450)
    await win.mouse.down({ button: 'right' })
    await win.waitForTimeout(700)
    const ouvert = await win.evaluate(() => {
      const r = document.querySelector('.radial')
      return r
        ? { present: true, secteurs: r.querySelectorAll('.sect').length }
        : { present: false, secteurs: 0 }
    })
    await capturer('roue-ouverte')
    await win.mouse.up({ button: 'right' })
    await win.waitForTimeout(500)
    const referme = await win.evaluate(() => !document.querySelector('.radial'))
    return {
      statut: ouvert.present && referme ? OK : KO,
      detail: `roue ${ouvert.present ? `ouverte (${ouvert.secteurs} secteurs)` : 'PAS OUVERTE'} · refermée au relâché : ${referme ? 'oui' : 'NON'}`,
    }
  })

  await rapport.test(win, 'pan-decouverte', 'Découverte guidée rejouable (?onboarding=1)', async () => {
    const base = win.url().split('?')[0]
    await win.goto(`${base}?onboarding=1`)
    await win.waitForTimeout(1500)
    const d = await win.evaluate(() => {
      const c = document.querySelector('.onb-card')
      return {
        present: !!c,
        etapes: document.querySelectorAll('.onb-dot, .onb-steps > *').length,
        titre: c?.querySelector('h2, .onb-title')?.textContent?.trim() ?? c?.textContent?.slice(0, 40) ?? '',
      }
    })
    // on repart sur la page normale pour la suite
    await win.goto(base)
    await win.waitForSelector('.toolbar', { timeout: 10000 })
    await win.waitForTimeout(600)
    return {
      statut: d.present ? OK : KO,
      detail: d.present ? `carte affichée : « ${d.titre} »` : 'aucune carte .onb-card avec ?onboarding=1',
    }
  })
}

/* ================================================================== *
 * 5. RACCOURCIS — les deux presets, pour de vrai
 * ================================================================== */

if (actif('raccourcis')) {
  await etatDeDepart(win)

  /** Joue une combinaison et rend l'état persisté juste après. */
  const apresTouche = async (combo, attente = 220) => {
    await win.keyboard.press(combo)
    await win.waitForTimeout(attente)
    return etat(win)
  }

  await rapport.test(win, 'rac-epicpen-outils', 'Preset Epic Pen : Ctrl+Maj+3/4/5', async () => {
    const lignes = []
    let ok = true
    for (const [combo, cible] of [
      ['Control+Shift+3', 'pen'],
      ['Control+Shift+4', 'highlight'],
      ['Control+Shift+5', 'eraser'],
    ]) {
      await win.keyboard.press('l') // on part d'un autre outil
      await win.waitForTimeout(140)
      const e = await apresTouche(combo)
      lignes.push(`${combo} → ${e.tool}`)
      if (e.tool !== cible) ok = false
    }
    return { statut: ok ? OK : KO, detail: lignes.join(' · ') }
  })

  await rapport.test(win, 'rac-epicpen-edition', 'Preset Epic Pen : Ctrl+Maj+6 et Ctrl+E', async () => {
    await win.keyboard.press('p')
    // deux ondulations : aucune ne ressemble à une forme, donc l'annulation
    // supprime bien un trait entier au lieu de rendre un tracé brut
    const onde = (y) =>
      Array.from({ length: 26 }, (_, i) => [420 + i * 14, y + Math.sin(i / 2) * 34])
    await tracer(win, onde(300))
    await tracer(win, onde(460))
    await win.waitForTimeout(500)
    const deux = await encreTotale(win)
    await win.keyboard.press('Control+Shift+6') // annuler
    await win.waitForTimeout(1400)
    const un = await encreTotale(win)
    await win.keyboard.press('Control+e') // tout effacer
    await win.waitForTimeout(1000)
    const zero = await encreTotale(win)
    return {
      statut: un < deux * 0.7 && un > 0 && zero === 0 ? OK : KO,
      detail: `2 ondulations ${deux} px · Ctrl+Maj+6 (annuler) → ${un} px · Ctrl+E (tout effacer) → ${zero} px`,
    }
  })

  await rapport.test(win, 'rac-epicpen-ui', 'Preset Epic Pen : Ctrl+H et Ctrl+Maj+2', async () => {
    await win.keyboard.press('Control+h')
    await win.waitForTimeout(400)
    const masquee = await win.evaluate(() => !document.querySelector('.toolbar'))
    await win.keyboard.press('Control+h')
    await win.waitForTimeout(400)
    const revenue = await win.evaluate(() => !!document.querySelector('.toolbar'))
    // Ctrl+Maj+2 = outil « curseur » d'Epic Pen : la souris repart au jeu
    await win.keyboard.press('Control+Shift+2')
    await win.waitForTimeout(500)
    const traversant = await win.evaluate(() => document.body.classList.contains('passthrough'))
    await win.keyboard.press('F8') // on redessine
    await win.waitForTimeout(400)
    const retour = await win.evaluate(() => !document.body.classList.contains('passthrough'))
    return {
      statut: masquee && revenue && traversant && retour ? OK : KO,
      detail: `Ctrl+H masque : ${masquee ? 'oui' : 'NON'} / rend : ${revenue ? 'oui' : 'NON'} · Ctrl+Maj+2 rend la souris au jeu : ${traversant ? 'oui' : 'NON'} · F8 revient en dessin : ${retour ? 'oui' : 'NON'}`,
    }
  })

  await rapport.test(win, 'rac-hexa', 'Preset Hexa : une lettre par outil', async () => {
    await etatDeDepart(win, { keymapPreset: 'hexa' })
    const lignes = []
    let ok = true
    for (const [touche, cible] of [
      ['p', 'pen'],
      ['s', 'highlight'],
      ['l', 'line'],
      ['f', 'arrow'],
      ['r', 'rect'],
      ['o', 'ellipse'],
      ['t', 'text'],
      ['n', 'badge'],
      ['m', 'measure'],
      ['e', 'eraser'],
    ]) {
      const e = await apresTouche(touche, 170)
      lignes.push(`${touche}→${e.tool}`)
      if (e.tool !== cible) ok = false
      if (cible === 'text') await win.keyboard.press('Escape')
    }
    return { statut: ok ? OK : KO, detail: lignes.join(' ') }
  })

  await rapport.test(win, 'rac-couleurs-taille', 'Couleurs 1–7, épaisseur [ ] et fondu D', async () => {
    const lignes = []
    let ok = true
    const c1 = await apresTouche('3', 170)
    lignes.push(`touche 3 → couleur ${c1.color}`)
    if (c1.color !== '#b026ff') ok = false
    const c2 = await apresTouche('6', 170)
    lignes.push(`touche 6 → ${c2.color}`)
    if (c2.color !== '#ff6b35') ok = false
    const t0 = (await etat(win)).size
    await win.keyboard.press(']')
    await win.waitForTimeout(150)
    const t1 = (await etat(win)).size
    await win.keyboard.press('[')
    await win.keyboard.press('[')
    await win.waitForTimeout(150)
    const t2 = (await etat(win)).size
    lignes.push(`épaisseur ${t0} → ] ${t1} → [[ ${t2}`)
    if (!(t1 > t0 && t2 < t1)) ok = false
    const f0 = (await etat(win)).fadeDelay
    await win.keyboard.press('d')
    await win.waitForTimeout(200)
    const f1 = (await etat(win)).fadeDelay
    lignes.push(`fondu ${f0} → ${f1}`)
    if (f0 === f1) ok = false
    return { statut: ok ? OK : KO, detail: lignes.join(' · ') }
  })

  await rapport.test(win, 'out-ping', 'Ping : un appui, un repère qui bat', async (capturer) => {
    await etatDeDepart(win)
    await toutEffacer(win)
    await win.mouse.move(700, 420)
    await win.waitForTimeout(200)
    const avant = await encreTotale(win)
    await win.keyboard.down('q')
    await win.waitForTimeout(220)
    const pendant = await encre(win)
    await capturer('effet')
    await win.keyboard.up('q')
    await win.waitForTimeout(1200)
    const apres = await encreTotale(win)
    return {
      statut: pendant.total - avant > 300 && apres === 0 ? OK : KO,
      detail: `encre ${avant} → ${pendant.total} pendant le ping (boîte ${pendant.boiteVif?.w}×${pendant.boiteVif?.h}) → ${apres} après extinction (l'effet doit s'éteindre seul)`,
    }
  })

  await rapport.test(win, 'out-loupe-gel', 'Loupe (A) et Gel d’image (V)', async (capturer) => {
    await etatDeDepart(win)
    await toutEffacer(win)
    /** Encre des DEUX canevas de la couche d'effets (src/engine/fx-capture.ts) :
     *  ils vivent hors de `.stage`, donc encre() ne les voit pas — et c'est
     *  exprès, l'ordre des canevas du moteur ne doit jamais bouger. */
    const encreFx = () =>
      win.evaluate(() => {
        const out = { dessous: 0, dessus: 0 }
        for (const [cle, sel] of [
          ['dessous', '.fx-below canvas'],
          ['dessus', '.fx-hud canvas'],
        ]) {
          const cv = document.querySelector(sel)
          if (!cv || !cv.width) continue
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
          let n = 0
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
          out[cle] = n
        }
        return out
      })

    await win.keyboard.press('p')
    await win.waitForTimeout(150)
    // LOUPE : maintien de A, le disque suit le curseur au ressort
    await win.keyboard.down('a')
    await win.mouse.move(700, 430)
    await win.mouse.move(760, 470)
    await win.waitForTimeout(700)
    const outilLoupe = (await etat(win)).tool
    const fxLoupe = await encreFx()
    const loupeEtat = await win.evaluate(() => window.hexaFx?.state() ?? null)
    // le disque ne doit JAMAIS recouvrir le point visé (anti-récursion §6)
    const distance = loupeEtat?.disc
      ? Math.round(Math.hypot(loupeEtat.disc.x - 760, loupeEtat.disc.y - 470))
      : 0
    await capturer('loupe')
    await win.keyboard.up('a')
    await win.waitForTimeout(400)

    // GEL : V fige l'écran, et le gel SURVIT au relâchement (on doit pouvoir
    // annoter la photo), puis un second V rend le direct
    await win.keyboard.press('v')
    await win.waitForTimeout(800)
    const fxGel = await encreFx()
    const gele = (await win.evaluate(() => window.hexaFx?.state() ?? null))?.frozen === true
    await capturer('gel')
    await win.keyboard.press('v')
    await win.waitForTimeout(700)
    const degele = (await win.evaluate(() => window.hexaFx?.state() ?? null))?.frozen === false
    const fxApres = await encreFx()

    const okLoupe = outilLoupe === 'magnifier' && fxLoupe.dessus > 500 && distance >= 300
    const okGel = gele && fxGel.dessous > 50000 && degele && fxApres.dessous === 0
    return {
      statut: okLoupe && okGel ? OK : okLoupe || okGel ? ABSENT : KO,
      detail:
        `A → outil « ${outilLoupe} », disque peint sur ${fxLoupe.dessus} px, ` +
        `centre à ${distance} px du point visé (≥ 300 exigé, sinon tunnel infini) · ` +
        `V → gel ${gele ? 'actif' : 'ABSENT'} sur ${fxGel.dessous} px, ` +
        `puis dégel ${degele ? 'effectif' : 'RATÉ'} (${fxApres.dessous} px restants)`,
    }
  })

  await rapport.test(win, 'rac-momentanes', 'Outils momentanés : Z laser, X spotlight', async (capturer) => {
    await etatDeDepart(win)
    await win.keyboard.press('p')
    await win.mouse.move(760, 430)
    await win.keyboard.down('z')
    await win.waitForTimeout(120)
    for (let i = 1; i <= 12; i++) {
      await win.mouse.move(760 - i * 20, 430 + Math.sin(i / 2) * 50)
      await win.waitForTimeout(14)
    }
    const pendantZ = (await etat(win)).tool
    await capturer('laser-tenu')
    await win.keyboard.up('z')
    await win.waitForTimeout(900)
    const apresZ = (await etat(win)).tool
    await win.keyboard.down('x')
    await win.waitForTimeout(400)
    const pendantX = (await etat(win)).tool
    const voile = (await encre(win)).voile
    await capturer('spotlight-tenu')
    await win.keyboard.up('x')
    await win.waitForTimeout(400)
    const apresX = (await etat(win)).tool
    const ok =
      pendantZ === 'laser' && apresZ === 'pen' && pendantX === 'spotlight' && apresX === 'pen' && voile > 10000
    return {
      statut: ok ? OK : KO,
      detail: `Z tenu → ${pendantZ}, relâché → ${apresZ} · X tenu → ${pendantX} (voile ${voile} px), relâché → ${apresX}`,
    }
  })
}

/* ================================================================== *
 * 6. PERFORMANCE — la promesse la plus dure : 0 image au repos
 * ================================================================== */

if (actif('performance')) {
  await etatDeDepart(win)
  await toutEffacer(win)

  await rapport.test(win, 'perf-repos-vide', 'Écran vide : 0 image en 5 secondes', async () => {
    await win.evaluate(() => {
      window.__hexaFrames = 0
      if (!window.__hexaRafPatché) {
        const orig = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (cb) => {
          window.__hexaFrames++
          return orig(cb)
        }
        window.__hexaRafPatché = true
      }
    })
    await win.mouse.move(20, 20)
    await win.waitForTimeout(5000)
    const n = await win.evaluate(() => window.__hexaFrames)
    return {
      statut: n === 0 ? OK : KO,
      detail: `${n} image(s) demandée(s) en 5 s (attendu 0 — Epic Pen, lui, compose en permanence)`,
    }
  })

  await rapport.test(win, 'perf-repos-encre', 'Trait posé en ∞ : 0 image en 5 secondes', async () => {
    await win.keyboard.press('p')
    await tracer(win, segment(430, 320, 900, 400, 12))
    await win.waitForTimeout(1500)
    const encreLa = await encreTotale(win)
    await win.evaluate(() => {
      window.__hexaFrames = 0
    })
    await win.waitForTimeout(5000)
    const n = await win.evaluate(() => window.__hexaFrames)
    return {
      statut: n === 0 && encreLa > 0 ? OK : KO,
      detail: `${encreLa} px d'encre à l'écran, ${n} image(s) demandée(s) en 5 s (attendu 0 : la boucle est dormante)`,
    }
  })

  await rapport.test(win, 'perf-latence', 'Latence : appui → premier pixel', async () => {
    await toutEffacer(win)
    await win.keyboard.press('p')
    await win.evaluate(() => {
      window.__hexaLat = null
      const cv = document.querySelectorAll('.stage canvas')[2]
      const ctx = cv.getContext('2d')
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const onDown = (e) => {
        const t0 = performance.now()
        const x = Math.max(0, Math.round((e.clientX - 90) * dpr))
        const y = Math.max(0, Math.round((e.clientY - 90) * dpr))
        const c = Math.round(180 * dpr)
        const tick = () => {
          const d = ctx.getImageData(x, y, c, c).data
          for (let i = 3; i < d.length; i += 4) {
            if (d[i] > 8) {
              window.__hexaLat = performance.now() - t0
              return
            }
          }
          if (performance.now() - t0 < 1500) requestAnimationFrame(tick)
          else window.__hexaLat = -1
        }
        requestAnimationFrame(tick)
      }
      window.addEventListener('pointerdown', onDown, { once: true, capture: true })
    })
    await win.mouse.move(600, 400)
    await win.mouse.down()
    for (let i = 1; i <= 6; i++) await win.mouse.move(600 + i * 9, 400 + i * 5)
    await win.waitForTimeout(600)
    await win.mouse.up()
    const lat = await win.evaluate(() => window.__hexaLat)
    return {
      statut: typeof lat === 'number' && lat >= 0 && lat < 60 ? OK : lat === -1 ? KO : NON_TESTE,
      detail:
        lat === -1
          ? 'aucun pixel peint en 1,5 s après l’appui'
          : `${lat?.toFixed(1)} ms entre le pointerdown et le premier pixel (mesure incluant une lecture GPU→CPU, donc pessimiste)`,
    }
  })

  await rapport.test(win, 'perf-anim-css', 'Aucune animation CSS perpétuelle dans le thème par défaut', async () => {
    const anims = await win.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el)
        if (s.animationName !== 'none' && s.animationIterationCount === 'infinite') {
          out.push(`${el.className || el.tagName} : ${s.animationName}`)
        }
      }
      return out
    })
    return {
      statut: anims.length === 0 ? OK : KO,
      detail:
        anims.length === 0
          ? 'aucun élément visible n’anime en boucle (le compositeur reste au repos)'
          : `animations perpétuelles : ${anims.join(' | ')}`,
    }
  })
}

/* ================================================================== *
 * Sortie
 * ================================================================== */

await rapport.test(win, 'fin-erreurs', 'Aucune erreur JavaScript sur toute la campagne', async () => ({
  statut: journal.erreurs.length === 0 ? OK : KO,
  detail:
    journal.erreurs.length === 0
      ? `0 pageerror · ${journal.consoleErreurs.length} message(s) console de type error` +
        (journal.consoleErreurs.length > 0
          ? ` : ${[...new Set(journal.consoleErreurs)].join(' | ').slice(0, 220)}`
          : '')
      : `${journal.erreurs.length} pageerror : ${[...new Set(journal.erreurs)].join(' | ').slice(0, 300)}`,
}))

const tableau = rapport.tableau()
process.stdout.write(`${tableau}\n`)
writeFileSync(join(CAPTURES, 'resultats.txt'), `${tableau}\n`, 'utf8')
writeFileSync(
  join(CAPTURES, 'resultats.json'),
  `${JSON.stringify({ date: new Date().toISOString(), lignes: rapport.lignes }, null, 2)}\n`,
  'utf8',
)

await app.close()
process.exit(rapport.codeSortie)
