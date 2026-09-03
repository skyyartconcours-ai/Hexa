#!/usr/bin/env node
/**
 * Hexa — §S20 : LE DÉMARRAGE À FROID, Y COMPRIS QUAND LA CONFIGURATION EST
 * ABÎMÉE.
 *
 * POURQUOI. Hexa relit à chaque lancement un état persisté écrit par lui-même.
 * Cet état peut être abîmé sans que l'utilisateur y soit pour rien : coupure de
 * courant pendant une écriture, plantage de la machine, retour d'une version
 * antérieure, fichier recopié d'un autre poste. Et le mode de panne est le pire
 * qui soit pour un overlay : le rendu React lève, la page reste blanche, la
 * fenêtre est transparente — l'utilisateur ne voit RIEN et n'a aucun message.
 * C'est exactement le symptôme qui avait déjà frappé une fois (« l'application
 * empaquetée affichait une fenêtre vide »).
 *
 * Ce que ce fichier exige, pour chaque forme d'abîmement : la barre d'outils
 * est là, la scène est là, LE STYLO DESSINE, et aucune erreur de page.
 * Autrement dit : un état illisible se jette, il ne se propage pas.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, KO, OK, Rapport, lancerHexa, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const { app, win, journal } = await lancerHexa({ profil: 's20' })

/**
 * Le journal que l'application écrit elle-même — le même fichier que celui
 * qu'un utilisateur envoie pour se faire dépanner. Le dossier utilisateur est
 * celui que `lancerHexa` crée à neuf pour ce profil.
 */
const journalApp = () => {
  const p = join(CAPTURES, '.user-data-s20', 'hexa.log')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/* ------------------------------------------------------------------ *
 * 1. PREMIER LANCEMENT, PROFIL VIERGE
 * ------------------------------------------------------------------ */

await rapport.test(win, 's20-1-profil-vierge', 'Premier lancement sur un profil vierge', async () => {
  const vu = await win.evaluate(() => ({
    barre: !!document.querySelector('.toolbar'),
    scene: !!document.querySelector('.stage'),
    canevas: document.querySelectorAll('.stage canvas').length,
    corps: document.body.innerText.length,
  }))
  return {
    statut: vu.barre && vu.scene && vu.canevas >= 2 && journal.erreurs.length === 0 ? OK : KO,
    detail:
      `barre ${vu.barre} · scène ${vu.scene} · ${vu.canevas} canevas · ` +
      `${journal.erreurs.length} erreur(s) de page : ${journal.erreurs.slice(0, 2).join(' | ') || 'aucune'}`,
  }
})

/* ------------------------------------------------------------------ *
 * 1bis. LA SÉQUENCE D'ACCUEIL VA JUSQU'AU BOUT TOUTE SEULE
 *
 * Au lancement, Hexa reste visible et dessinable quelques secondes, puis rend
 * la souris au jeu en l'expliquant. Cette séquence s'annule dès que
 * l'utilisateur agit — et c'est là que le piège se referme : le tout premier
 * 'set-passthrough' d'une page n'est PAS une action, c'est l'écho de son état
 * initial au montage de React. Le prendre pour un geste (une version
 * intermédiaire de ce travail l'a fait) annulait l'accueil 43 ms après le
 * démarrage : Hexa restait en mode dessin indéfiniment, à avaler les clics du
 * jeu, sans que rien ne le dise.
 *
 * On regarde donc le JOURNAL de l'application, qui trace les deux issues.
 * ------------------------------------------------------------------ */

await rapport.test(win, 's20-1b-accueil-va-au-bout', 'La séquence d’accueil n’est pas annulée par le démarrage lui-même', async () => {
  const lignes = () => journalApp().split('\n').filter((l) => l.includes('[accueil]'))
  const debut = lignes()

  // Tout premier lancement : la découverte guidée s'affiche 12 s (§ accueil).
  // On attend le retrait, sans toucher à rien — c'est tout l'objet du test.
  const limite = Date.now() + 20000
  let fin = debut
  while (Date.now() < limite) {
    fin = lignes()
    if (fin.some((l) => /retour au mode traversant/.test(l))) break
    await win.waitForTimeout(500)
  }

  const interrompue = fin.filter((l) => /séquence interrompue/.test(l))
  const retrait = fin.some((l) => /retour au mode traversant/.test(l))
  const traversant = await win.evaluate(() => document.body.classList.contains('passthrough'))

  const ok = interrompue.length === 0 && retrait && traversant === true
  return {
    statut: ok ? OK : KO,
    detail:
      `${interrompue.length} annulation(s) de la séquence sans que personne n’ait rien fait ` +
      `(0 exigé) · retrait automatique observé : ${retrait} · la page est repassée en clic ` +
      `traversant : ${traversant} · journal : ${fin.map((l) => l.split('] ').pop()).join(' / ')}`,
  }
})

await rapport.test(win, 's20-1c-accueil-annulee-par-l-utilisateur', 'Un vrai F8 interrompt bien la séquence d’accueil', async () => {
  // La séquence est terminée : on ne peut plus l'annuler. Ce qu'on vérifie
  // ici, c'est que le chemin existe et qu'un F8 de la page atteint bien le
  // processus principal — sans quoi le garde ci-dessus serait un mur aveugle.
  const avant = await win.evaluate(() => document.body.classList.contains('passthrough'))
  await win.keyboard.press('F8')
  await win.waitForTimeout(700)
  const apres = await win.evaluate(() => document.body.classList.contains('passthrough'))
  const modeDessin = await win.evaluate(() => window.hexa?.modeDessin?.() ?? null)
  await win.keyboard.press('F8')
  await win.waitForTimeout(600)

  const ok = avant === true && apres === false && modeDessin === true
  return {
    statut: ok ? OK : KO,
    detail:
      `traversant avant F8 : ${avant} · après : ${apres} (false exigé) · le processus principal ` +
      `confirme le mode dessin : ${modeDessin} (true exigé — c’est la preuve que le message de ` +
      `la page l’atteint vraiment, et donc que l’annulation d’accueil a bien un chemin)`,
  }
})

/* ------------------------------------------------------------------ *
 * 2. ÉTATS PERSISTÉS ABÎMÉS
 * ------------------------------------------------------------------ */

/**
 * Écrit un `hexa-ui` abîmé, recharge, et regarde si Hexa se relève :
 * l'interface est montée, et surtout LE STYLO DESSINE ENCORE. Une page qui
 * s'affiche mais ne dessine plus est aussi perdue pour l'utilisateur qu'une
 * page blanche.
 */
const eprouver = async (brut) => {
  const erreurs = []
  const surErreur = (e) => erreurs.push(String(e.message))
  win.on('pageerror', surErreur)
  await win.evaluate((v) => localStorage.setItem('hexa-ui', v), brut)
  await win.reload()
  // On ne suppose RIEN : si la scène ne vient jamais, c'est déjà la réponse.
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
   * On dessine AVEC L'ÉTAT ABÎMÉ TOUJOURS EN PLACE : c'est le seul moyen de
   * prouver qu'Hexa reste utilisable, et pas seulement qu'il redémarre une fois
   * la configuration remplacée. On ne touche donc pas à `hexa-ui` ici — et on
   * ne le relit surtout pas avec JSON.parse, puisque la moitié des cas éprouvés
   * sont justement illisibles (c'était le TEST qui levait, pas l'application).
   * On mesure dans la foulée du geste : même un fondu de 2 s n'a pas commencé.
   */
  let peints = 0
  if (vu.moteur) {
    // Une découverte guidée éventuellement ouverte capterait les clics.
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(300)
    if (await win.evaluate(() => document.body.classList.contains('passthrough'))) {
      await win.keyboard.press('F8')
      await win.waitForTimeout(400)
    }
    await win.keyboard.press('p') // pinceau, par la touche réelle
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
  return { monte, ...vu, peints, erreurs }
}

/** Remet une base saine entre deux épreuves. */
const assainir = async () => {
  await win.evaluate(() =>
    localStorage.setItem(
      'hexa-ui',
      JSON.stringify({
        state: { onboarded: true, fadeDelay: null, tool: 'pen', size: 6, sound: false },
        version: 2,
      }),
    ),
  )
  await win.reload()
  await win.waitForSelector('.stage canvas', { timeout: 12000 })
  await win.waitForTimeout(800)
}

const CAS = [
  {
    id: 's20-2-json-invalide',
    titre: 'Configuration illisible (JSON invalide)',
    pourquoi: 'coupure de courant pendant l’écriture du fichier',
    brut: '{"state":{"tool":"pen"',
  },
  {
    id: 's20-3-listes-nulles',
    titre: 'Chronos et notes à null au lieu de listes',
    pourquoi:
      'le mode de panne le plus dangereux : `clocks.length` sur null lève au RENDU, ' +
      'et une fenêtre transparente qui ne rend rien est indiscernable d’une application morte',
    brut: JSON.stringify({ state: { onboarded: true, clocks: null, notes: null }, version: 2 }),
  },
  {
    id: 's20-4-listes-mauvais-type',
    titre: 'Chronos et notes du mauvais type',
    pourquoi: 'un fichier recopié d’un autre poste, ou écrit par une version antérieure',
    brut: JSON.stringify({
      state: { onboarded: true, clocks: 'trois', notes: { a: 1 } },
      version: 2,
    }),
  },
  {
    id: 's20-5-valeurs-absurdes',
    titre: 'Outil inconnu, taille et fondu absurdes, couleur invalide',
    pourquoi: 'un état trafiqué à la main, ou écrit par une version future',
    brut: JSON.stringify({
      state: {
        onboarded: true,
        tool: 'lance-flammes',
        size: -9999,
        fadeDelay: 'plus tard',
        color: 'pas une couleur',
        theme: 'inexistant',
        gridMode: 42,
      },
      version: 2,
    }),
  },
  {
    id: 's20-6-etat-vide',
    titre: 'Fichier vide',
    pourquoi: 'écriture interrompue avant le premier octet',
    brut: '',
  },
  {
    id: 's20-7-widgets-abimes',
    titre: 'Un chrono et une note sans les champs attendus',
    pourquoi: 'les cartes posées à l’écran sont rendues une par une : une seule suffit à tout casser',
    brut: JSON.stringify({
      state: {
        onboarded: true,
        clocks: [{ id: 'c1' }, null],
        notes: [{ id: 'n1' }, 'pas un objet'],
      },
      version: 2,
    }),
  },
]

for (const cas of CAS) {
  await assainir()
  await rapport.test(win, cas.id, cas.titre, async () => {
    const r = await eprouver(cas.brut)
    const ok = r.monte && r.barre && r.canevas >= 2 && r.moteur && r.peints > 1000 && r.erreurs.length === 0
    return {
      statut: ok ? OK : KO,
      detail:
        `(${cas.pourquoi}) · scène montée ${r.monte} · barre ${r.barre} · ${r.canevas} canevas · ` +
        `moteur ${r.moteur} · le stylo dessine : ${r.peints} px peints (> 1000 exigé) · ` +
        `${r.erreurs.length} erreur(s) de page : ${r.erreurs.slice(0, 2).join(' | ') || 'aucune'}`,
    }
  })
}

/* ------------------------------------------------------------------ *
 * 3. ET APRÈS ? L'ÉTAT ABÎMÉ NE DOIT PAS SURVIVRE
 * ------------------------------------------------------------------ */

await rapport.test(win, 's20-8-etat-reecrit-sain', 'Après le relèvement, l’état réécrit est sain', async () => {
  // Le dernier cas éprouvé a laissé un chrono et une note ABÎMÉS dans l'état.
  // Après le relèvement, ce qu'Hexa réécrit doit être sain — sinon le prochain
  // lancement retomberait dans le même trou, et le nôtre aussi.
  await win.evaluate(() => window.hexaEngine && localStorage.setItem('__forcer', '1'))
  await win.reload()
  await win.waitForSelector('.stage canvas', { timeout: 12000 }).catch(() => {})
  await win.waitForTimeout(1200)
  const etat = await win.evaluate(() => {
    let raw = null
    try {
      raw = JSON.parse(localStorage.getItem('hexa-ui') ?? 'null')
    } catch {
      return { lisible: false, clocks: false, notes: false, taille: false }
    }
    const s = raw?.state ?? {}
    return {
      lisible: true,
      // Les chronos ne sont PLUS enregistrés (un chrono posé un soir revenait à
      // chaque lancement) : l'état réécrit ne doit plus en porter du tout.
      clocks: s.clocks === undefined,
      notes: Array.isArray(s.notes),
      taille: typeof s.size === 'number' && s.size > 0 && s.size < 100,
      contenu: `clocks=${JSON.stringify(s.clocks)} notes=${JSON.stringify(s.notes)}`.slice(0, 160),
    }
  })
  // Un état relu doit être relisable, sa liste de notes doit être une liste, et
  // les chronos absents : sinon le prochain lancement retomberait dans le même trou.
  const ok = etat.lisible && etat.clocks && etat.notes && etat.taille
  return {
    statut: ok ? OK : KO,
    detail:
      `relisible ${etat.lisible} · chronos absents de l’état enregistré : ${etat.clocks} · ` +
      `notes est une liste : ${etat.notes} · taille de trait plausible : ${etat.taille} · ` +
      `${etat.contenu ?? ''}`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
