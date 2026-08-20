#!/usr/bin/env node
/**
 * Hexa — §S22 : L'USAGE RÉEL, EN MODE DEUX FENÊTRES, SOUS MARTÈLEMENT.
 *
 * POURQUOI CE FICHIER EXISTE. Le mode réel de l'utilisateur — DEUX fenêtres
 * par écran, encre + interface, sans `HEXA_FUSION` — est le moins couvert de
 * tout le projet : `couches.mjs` en vérifie la STRUCTURE (qui porte quoi, qui
 * est exclu des captures), `s18` en vérifie le REPOS. Personne n'y avait
 * jamais mesuré ce que fait Hexa PENDANT QU'ON S'EN SERT VRAIMENT.
 *
 * Or c'est là que vivent les plaintes historiques de l'utilisateur :
 *   · « ça saccade de plus en plus à mesure que le temps passe » — une pente
 *     ne se voit pas sur deux minutes de campagne, elle se voit sur une
 *     boucle qui répète le geste des centaines de fois ;
 *   · « ça trace des traits en continu sur le 2ème écran » — les bascules de
 *     topologie sont exactement les moments où l'état d'une fenêtre et celui
 *     de son moteur peuvent diverger.
 *
 * Ce fichier martèle : des centaines de changements d'outil, des gestes
 * INTERROMPUS PAR une bascule d'écran, un changement de thème, une ouverture
 * de panneau, une fenêtre détruite, un rendu rechargé. Après chacun, la même
 * exigence, la seule qui compte : LE STYLO DESSINE ENCORE, les deux fenêtres
 * sont d'accord, et rien n'a fui.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURES, KO, OK, RACINE, Rapport, chargerPilote, preparerCaptures } from './harness.mjs'

preparerCaptures()
const rapport = new Rapport()
const electron = await chargerPilote()

const USER = join(CAPTURES, '.user-data-s22')
rmSync(USER, { recursive: true, force: true })
mkdirSync(USER, { recursive: true })

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// ⚠️ PAS de HEXA_FUSION : c'est tout l'objet de cette campagne. Deux fenêtres
// par écran, comme sur le poste de l'utilisateur.
const app = await electron.launch({
  args: ['.', `--user-data-dir=${USER}`],
  cwd: RACINE,
  executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
  timeout: 60000,
})
app.process().stderr?.on('data', () => {})

await app.firstWindow({ timeout: 30000 })
await pause(3200)

const journal = () => {
  const p = join(USER, 'hexa.log')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/**
 * Retrouve, à chaud, la page d'encre QUI ANNOTE et la page d'interface QUI
 * PORTE LA BARRE.
 *
 * ⚠️ On sélectionne sur `hexaEngine.actif`, PAS sur la présence de canevas. Un
 * écran inerte garde ses trois éléments `<canvas>` dans le DOM — simplement
 * rendus à 0×0. Une première version de ce fichier comptait les éléments : elle
 * retenait la fenêtre INERTE, y dessinait, mesurait 0 pixel et criait au bug
 * alors que le produit se comportait correctement. Le seul critère qui
 * distingue les deux est le moteur lui-même.
 */
const trouverPages = async () => {
  let encre = null
  let inter = null
  for (const w of app.windows()) {
    if (w.url().startsWith('data:')) continue
    const d = await w
      .evaluate(() => ({
        couche: [...document.body.classList].find((c) => c.startsWith('hexa-')) ?? '',
        actif: window.hexaEngine ? window.hexaEngine.actif === true : false,
        barre: !!document.querySelector('.toolbar'),
      }))
      .catch(() => null)
    if (!d) continue
    if (d.couche === 'hexa-encre' && d.actif) encre = w
    if (d.couche === 'hexa-interface' && d.barre) inter = w
  }
  return { encre, inter }
}

let { encre, inter } = await trouverPages()
if (!encre || !inter) {
  process.stdout.write('Impossible de distinguer les deux fenêtres — campagne inutilisable.\n')
  await app.close()
  process.exit(1)
}

/** Les erreurs de page des DEUX fenêtres : une seule suffit à tout perdre. */
const erreurs = { encre: [], inter: [] }
const brancherErreurs = () => {
  encre.on('pageerror', (e) => erreurs.encre.push(String(e.message)))
  inter.on('pageerror', (e) => erreurs.inter.push(String(e.message)))
}
brancherErreurs()

/** Pixels d'encre réellement peints sur la couche encre. */
const peints = () =>
  encre
    .evaluate(() => {
      let n = 0
      for (const cv of document.querySelectorAll('.stage canvas')) {
        if (!cv.width) continue
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
      }
      return n
    })
    .catch(() => -1)

/** Met la fenêtre d'encre en mode dessin si elle n'y est pas déjà. */
const assurerDessin = async () => {
  await encre.keyboard.press('Escape').catch(() => {})
  await pause(200)
  const traversant = await encre
    .evaluate(() => document.body.classList.contains('passthrough'))
    .catch(() => false)
  if (traversant) {
    await encre.keyboard.press('F8')
    await pause(500)
  }
}

/** Un trait franc, dont on sait combien de pixels il doit laisser. */
const tracer = async (x0 = 400, y0 = 300, x1 = 900, y1 = 500) => {
  await encre.mouse.move(x0, y0)
  await encre.mouse.down()
  await encre.mouse.move(x1, y1, { steps: 12 })
  await encre.mouse.up()
  await pause(350)
}

const toutEffacer = async () => {
  await encre.keyboard.press('Control+Shift+E').catch(() => {})
  await pause(250)
  await encre.evaluate(() => window.hexaEngine?.clear?.()).catch(() => {})
  await pause(300)
}

await encre.evaluate(() =>
  localStorage.setItem(
    'hexa-ui',
    JSON.stringify({
      state: {
        onboarded: true,
        fadeDelay: null,
        tool: 'pen',
        size: 6,
        sound: false,
        globalShortcutsOn: false,
        globalShortcutsChosen: true,
      },
      version: 2,
    }),
  ),
)
await encre.reload()
await encre.waitForSelector('.stage canvas', { timeout: 20000 })
await pause(1500)
;({ encre, inter } = await trouverPages())
erreurs.encre = []
erreurs.inter = []
brancherErreurs()
await assurerDessin()

/* ------------------------------------------------------------------ *
 * 1. LE MARTÈLEMENT DES OUTILS
 *
 * « changer d'outil vingt fois par minute » est un usage NORMAL pour un
 * streamer qui commente une phase de jeu. On en fait dix fois plus, d'un coup,
 * et on exige qu'après, tout soit exactement comme avant.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-1-martelement-outils', 'Deux cents changements d’outil ne cassent rien', async () => {
  await toutEffacer()
  const avant = await peints()
  /*
   * ⚠️ LES VRAIES TOUCHES D'OUTIL du clavier par défaut (preset Epic Pen, qui
   * étend le clavier maison) : p·s·l·f·r·o·n·y·m·b·e. Surtout PAS 'h', qui
   * n'est pas le surligneur mais la bascule d'affichage de la barre — une
   * version antérieure de ce fichier martelait 'h' en croyant marteler un
   * outil, et faisait disparaître la barre qu'elle allait ensuite interroger.
   * 't' (texte) est écarté volontairement : il ouvre une saisie et mangerait
   * les touches suivantes.
   */
  const touches = ['p', 's', 'l', 'f', 'r', 'o', 'n', 'y', 'm', 'b', 'e']
  const t0 = Date.now()
  for (let i = 0; i < 200; i++) {
    await encre.keyboard.press(touches[i % touches.length])
  }
  const duree = Date.now() - t0
  await pause(600)

  // Après le martèlement : le pinceau, et un trait qui doit être là.
  await encre.keyboard.press('p')
  await pause(250)
  await assurerDessin()
  await tracer()
  const apres = await peints()

  const outilVu = await inter
    .evaluate(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.classList.contains('active'))
      return b ? (b.getAttribute('title') ?? '').split('—')[0].trim() : 'aucun'
    })
    .catch(() => 'illisible')

  const ok = apres > 3000 && erreurs.encre.length === 0 && erreurs.inter.length === 0
  return {
    statut: ok ? OK : KO,
    detail:
      `200 changements en ${duree} ms · encre ${avant} → ${apres} px · outil vu par la barre « ${outilVu} » · ` +
      `${erreurs.encre.length} erreur(s) encre, ${erreurs.inter.length} interface`,
  }
})

/* ------------------------------------------------------------------ *
 * 2. LES DEUX FENÊTRES RESTENT D'ACCORD
 *
 * L'outil choisi au clavier dans la fenêtre d'encre doit se voir dans la barre,
 * qui vit dans l'AUTRE fenêtre, dans un AUTRE processus de rendu. C'est le
 * point faible propre au mode deux fenêtres, et il n'est pas éprouvé sous
 * charge ailleurs.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-2-fenetres-daccord', 'Sous martèlement, la barre et le moteur ne divergent pas', async () => {
  /*
   * L'observable est le LIBELLÉ ACTIF DE LA BARRE, lue dans la fenêtre
   * d'INTERFACE — c'est-à-dire dans un autre processus de rendu que celui qui
   * a reçu la touche. C'est très exactement ce que l'utilisateur voit, et le
   * seul point où le mode deux fenêtres peut diverger.
   *
   * (`window.hexaEngine.tool` n'existe pas : l'outil vit dans `opts`, privé.
   * Une première version de ce test l'interrogeait et lisait `null` cinq fois
   * sur cinq — elle mesurait sa propre erreur, pas le produit.)
   */
  /*
   * On cherche le bouton PAR SON LIBELLÉ et on regarde s'il porte `active`.
   * (Le sélecteur `.group:first-of-type` du harnais vise un premier div, pas
   * un premier `.group` : en mode deux fenêtres il ne tombe pas sur le groupe
   * des outils et rend `null` à tous les coups. Une version antérieure de ce
   * test s'en servait et mesurait quatre désaccords imaginaires.)
   */
  const barreMontre = (libelle) =>
    inter
      .evaluate((lib) => {
        const b = [...document.querySelectorAll('.toolbar .tbtn')].find((x) =>
          (x.getAttribute('title') ?? '').startsWith(lib),
        )
        if (!b) return 'BOUTON ABSENT'
        return b.classList.contains('active') ? 'actif' : 'inactif'
      }, libelle)
      .catch(() => 'ILLISIBLE')

  const paires = [
    ['s', 'Surligneur'],
    ['f', 'Flèche'],
    ['r', 'Rectangle'],
    ['p', 'Pinceau'],
  ]
  const vus = []
  for (const [touche, attendu] of paires) {
    // On répète la touche : c'est le martèlement qui fait diverger, pas le geste unique.
    for (let i = 0; i < 12; i++) await encre.keyboard.press(touche)
    await pause(700)
    const vu = await barreMontre(attendu)
    vus.push({ attendu, vu, accord: vu === 'actif' })
  }
  const desaccords = vus.filter((v) => !v.accord)
  return {
    statut: desaccords.length === 0 ? OK : KO,
    detail: vus.map((v) => `${v.attendu}:${v.vu}`).join(' · ') + ` · ${desaccords.length} désaccord(s)`,
  }
})

/* ------------------------------------------------------------------ *
 * 3. UN GESTE INTERROMPU PAR UN CHANGEMENT DE THÈME
 *
 * Le thème retouche les couleurs du moteur EN COURS DE ROUTE. Un geste en
 * train de se faire est le pire moment.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-3-theme-en-plein-geste', 'Changer de thème au milieu d’un trait ne perd pas le trait', async () => {
  await toutEffacer()
  await encre.keyboard.press('p')
  await assurerDessin()
  await pause(200)

  await encre.mouse.move(300, 300)
  await encre.mouse.down()
  await encre.mouse.move(600, 400, { steps: 8 })
  // EN PLEIN GESTE : le thème bascule.
  await encre.evaluate(() => {
    const s = window.hexaEngine
    document.documentElement.setAttribute('data-theme', 'aurore')
    return !!s
  })
  await encre.mouse.move(900, 500, { steps: 8 })
  await encre.mouse.up()
  await pause(500)

  const px = await peints()
  return {
    statut: px > 3000 && erreurs.encre.length === 0 ? OK : KO,
    detail: `${px} px après un thème changé en plein trait · ${erreurs.encre.length} erreur(s)`,
  }
})

/* ------------------------------------------------------------------ *
 * 3bis. UN GESTE INTERROMPU PAR UN CHANGEMENT D'ÉCHELLE
 *
 * Changer l'échelle de Windows (100 % → 125 %) redimensionne les canevas en
 * PIXELS PHYSIQUES : le moteur doit tout re-mesurer. §S9-dpi vérifie que le
 * trait tombe sous le curseur à chaque échelle — mais toujours sur une échelle
 * FIXÉE AU LANCEMENT. Personne n'avait changé l'échelle PENDANT un trait, or
 * c'est là qu'une réallocation de canevas peut emporter le geste en cours.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-3b-echelle-en-plein-geste', 'Re-mesurer les canevas au milieu d’un trait ne perd pas le trait', async () => {
  await toutEffacer()
  await encre.keyboard.press('p')
  await assurerDessin()
  await pause(200)

  await encre.mouse.move(300, 300)
  await encre.mouse.down()
  await encre.mouse.move(600, 400, { steps: 8 })
  // EN PLEIN GESTE : le principal annonce un changement de métriques d'écran,
  // et la page reçoit le `resize` DOM qui va avec — les deux chemins qui font
  // re-dimensionner les canevas.
  await app
    .evaluate(({ screen }) => {
      const d = screen.getPrimaryDisplay()
      screen.emit('display-metrics-changed', {}, d, ['scaleFactor', 'bounds'])
    })
    .catch(() => {})
  await encre.evaluate(() => window.dispatchEvent(new Event('resize')))
  await encre.mouse.move(900, 500, { steps: 8 })
  await encre.mouse.up()
  await pause(700)

  const px = await peints()
  const canevas = await encre
    .evaluate(() => [...document.querySelectorAll('.stage canvas')].map((c) => `${c.width}x${c.height}`).join(' '))
    .catch(() => '?')

  return {
    statut: px > 3000 && erreurs.encre.length === 0 ? OK : KO,
    detail: `${px} px après re-mesure en plein trait · canevas ${canevas} · ${erreurs.encre.length} erreur(s)`,
  }
})

/* ------------------------------------------------------------------ *
 * 4. UN GESTE INTERROMPU PAR L'OUVERTURE D'UN PANNEAU
 *
 * Le panneau vit dans la fenêtre d'INTERFACE, et son ouverture donne le focus
 * à cette fenêtre-là. Le geste, lui, est en cours dans la fenêtre d'ENCRE :
 * une perte de focus au milieu d'un trait est exactement ce qui laisse un
 * geste « collé », c'est-à-dire un trait qui continue tout seul — la plainte
 * n°2 de l'utilisateur, sur le deuxième écran.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-4-panneau-en-plein-geste', 'Ouvrir un panneau au milieu d’un trait ne laisse pas le geste collé', async () => {
  await toutEffacer()
  await encre.keyboard.press('p')
  await assurerDessin()
  await pause(200)

  await encre.mouse.move(300, 300)
  await encre.mouse.down()
  await encre.mouse.move(600, 400, { steps: 8 })
  await inter.keyboard.press('Control+,').catch(() => {})
  await pause(700)
  await encre.mouse.move(900, 500, { steps: 8 })
  await encre.mouse.up()
  await pause(400)
  await inter.keyboard.press('Escape').catch(() => {})
  await pause(400)

  const fige = await peints()
  // LA question : la souris bouge encore, bouton relâché. Si un pixel de plus
  // apparaît, le geste est resté collé.
  await encre.mouse.move(1100, 700, { steps: 10 })
  await encre.mouse.move(1300, 300, { steps: 10 })
  await pause(500)
  const apresMouvement = await peints()

  const colle = apresMouvement > fige + 200
  return {
    statut: !colle && fige > 1000 && erreurs.encre.length === 0 ? OK : KO,
    detail:
      `${fige} px au relâchement · ${apresMouvement} px après mouvement libre · ` +
      `geste collé : ${colle ? 'OUI' : 'non'} · ${erreurs.encre.length} erreur(s)`,
  }
})

/* ------------------------------------------------------------------ *
 * 5. UN GESTE INTERROMPU PAR UNE BASCULE D'ÉCRAN D'ANNOTATION
 *
 * Le scénario le plus grave du projet, et jamais éprouvé EN MODE DEUX
 * FENÊTRES : c'est là qu'il y a deux fois plus de fenêtres à remettre d'accord.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-5-bascule-en-plein-geste', 'Une bascule d’écran au milieu d’un trait laisse Hexa utilisable', async () => {
  await toutEffacer()
  await encre.keyboard.press('p')
  await assurerDessin()
  await pause(200)

  // Un second écran branché à chaud, PENDANT le geste.
  await encre.mouse.move(300, 300)
  await encre.mouse.down()
  await encre.mouse.move(600, 400, { steps: 8 })
  await app.evaluate(({ screen }) => {
    const vrai = screen.getAllDisplays.bind(screen)
    const faux = {
      id: 990022,
      label: 'HEXA-S22-2',
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
    globalThis.__s22faux = faux
    globalThis.__s22actif = true
    globalThis.__s22trois = false
    // Mémorisé UNE fois : c'est lui, et jamais l'actuel, qu'on rechaînera.
    globalThis.__s22vrai = vrai
    screen.getAllDisplays = () => {
      const l = vrai()
      if (globalThis.__s22actif) l.push(faux)
      return l
    }
    screen.emit('display-added', {}, faux)
  })
  await encre.mouse.move(900, 500, { steps: 8 })
  await encre.mouse.up()
  await pause(2500)

  // Les fenêtres ont pu être recréées : on les retrouve avant de conclure.
  ;({ encre, inter } = await trouverPages())
  if (!encre) return { statut: KO, detail: 'plus aucune fenêtre d’encre après la bascule' }

  await assurerDessin()
  await encre.keyboard.press('p')
  await pause(300)
  await tracer(350, 250, 850, 450)
  const px = await peints()

  return {
    statut: px > 3000 ? OK : KO,
    detail: `${px} px peints APRÈS une bascule survenue en plein geste (doit être > 3000)`,
  }
})

/* ------------------------------------------------------------------ *
 * 5bis. ⚠️ UN ÉCRAN QUI VIENT D'ÊTRE BRANCHÉ N'AVALE PAS LES CLICS
 *
 * LE DÉFAUT LE PLUS GRAVE TROUVÉ DANS CETTE PASSE, et il survivait à tous les
 * correctifs précédents.
 *
 * `diffuserEcranAnnotation()` remet bien en mode traversant tout écran qui
 * CESSE d'annoter. Mais un écran qui vient de NAÎTRE n'a jamais annoté : au
 * moment où cette fonction passe, son overlay est encore `passthrough: true`
 * (sa valeur de création), il n'y a donc rien à corriger. C'est APRÈS que sa
 * page se monte et envoie l'écho de son état initial — mode dessin — qui
 * faisait basculer l'écran neuf en mode dessin. La séquence d'accueil étant un
 * coup unique et depuis longtemps terminée, PLUS RIEN ne l'en sortait.
 *
 * Mesuré avant correctif, accueil arrivé à son terme, tout en mode jeu, puis un
 * second écran branché à chaud : `actif: false` (il n'annote pas) ET
 * `passthrough: false` avec `visible: true` en 1280×720. Encore vrai 15 s plus
 * tard. Le moniteur entier devenait inutilisable — ni le jeu, ni OBS, ni le
 * chat ne recevaient un clic — et l'overlay étant transparent, RIEN ne
 * l'expliquait. Sur le poste à trois écrans de l'utilisateur, n'importe quel
 * réveil de moniteur suffisait à le déclencher en plein direct.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-5b-ecran-neuf-nabsorbe-pas-les-clics', 'Un écran fraîchement branché ne vole aucun clic au jeu', async () => {
  const vue = []
  for (const w of app.windows()) {
    if (w.url().startsWith('data:')) continue
    const d = await w
      .evaluate(() => ({
        page: location.pathname.split('/').pop(),
        x: window.screenX,
        actif: window.hexaEngine ? window.hexaEngine.actif === true : null,
        dessin: !document.body.classList.contains('passthrough'),
      }))
      .catch(() => null)
    if (d) vue.push(d)
  }
  // La règle, en une phrase : aucune page qui n'annote pas ne doit être en
  // mode dessin. Le mode dessin sur un moteur inerte, c'est un écran mort.
  const coupables = vue.filter((d) => d.actif === false && d.dessin)
  return {
    statut: coupables.length === 0 ? OK : KO,
    detail:
      vue.map((d) => `${d.page}@${d.x} actif=${d.actif} dessin=${d.dessin}`).join(' · ') +
      ` · ${coupables.length} écran(s) inerte(s) en mode dessin (doit être 0)`,
  }
})

/* ------------------------------------------------------------------ *
 * 6. TROIS ÉCRANS, LA BARRE SUR LE TROISIÈME, L'ANNOTATION SUR LE PREMIER
 *
 * Le montage que l'utilisateur a décrit, en mode deux fenêtres : six fenêtres
 * au total. On exige qu'UNE SEULE annote, et que le stylo marche là où il doit.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-6-trois-ecrans-barre-ailleurs', 'Trois écrans, barre sur le 3ᵉ, annotation sur le 1ᵉʳ', async () => {
  await app.evaluate(({ screen }) => {
    const troisieme = {
      ...globalThis.__s22faux,
      id: 990023,
      label: 'HEXA-S22-3',
      bounds: { x: 2880, y: 0, width: 1280, height: 720 },
      workArea: { x: 2880, y: 0, width: 1280, height: 680 },
      nativeOrigin: { x: 2880, y: 0 },
    }
    globalThis.__s22troisieme = troisieme
    globalThis.__s22trois = true
    // ⚠️ On réutilise le `getAllDisplays` D'ORIGINE mémorisé au premier
    // branchement. Rechaîner l'actuel empilerait les faux écrans à chaque
    // appel : une version antérieure de ce fichier finissait à quatre écrans
    // pour deux branchements, et toutes les mesures qui suivaient étaient
    // fausses sans que rien ne le signale.
    screen.getAllDisplays = () => {
      const l = globalThis.__s22vrai()
      if (globalThis.__s22actif) l.push(globalThis.__s22faux)
      if (globalThis.__s22trois) l.push(globalThis.__s22troisieme)
      return l
    }
    screen.emit('display-added', {}, troisieme)
  })
  await pause(3000)

  // La barre est envoyée sur le troisième écran, par le VRAI réglage.
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue
        w.webContents.send('hexa:set-toolbar-display', 990023)
      }
    })
    .catch(() => {})
  await pause(2000)
  ;({ encre, inter } = await trouverPages())

  const actifs = []
  for (const w of app.windows()) {
    if (w.url().startsWith('data:')) continue
    const a = await w.evaluate(() => (window.hexaEngine ? window.hexaEngine.actif : null)).catch(() => null)
    if (a !== null) actifs.push(a)
  }
  const nbActifs = actifs.filter(Boolean).length

  let px = -1
  if (encre) {
    await assurerDessin()
    await encre.keyboard.press('p')
    await pause(250)
    await toutEffacer()
    await tracer(300, 250, 800, 450)
    px = await peints()
  }

  return {
    statut: nbActifs === 1 && px > 3000 ? OK : KO,
    detail: `${actifs.length} moteur(s) au total · ${nbActifs} actif(s) (doit être 1) · ${px} px peints sur l’écran d’annotation`,
  }
})

/* ------------------------------------------------------------------ *
 * 7. LE PROCESSUS DE RENDU PERDU ET RELANCÉ
 *
 * Un processus de rendu peut mourir (mémoire, pilote graphique) et Electron le
 * relance. Si l'état ne revient pas, l'utilisateur se retrouve avec un overlay
 * inerte qu'aucun raccourci ne réveille — et il ne le saura qu'en essayant de
 * dessiner, c'est-à-dire trop tard.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-7-rendu-relance', 'La couche encre rechargée redevient dessinable', async () => {
  await encre.reload()
  await encre.waitForSelector('.stage canvas', { timeout: 20000 }).catch(() => {})
  await pause(2000)
  ;({ encre, inter } = await trouverPages())
  if (!encre) return { statut: KO, detail: 'la fenêtre d’encre n’est pas revenue' }

  erreurs.encre = []
  encre.on('pageerror', (e) => erreurs.encre.push(String(e.message)))

  await assurerDessin()
  await encre.keyboard.press('p')
  await pause(300)
  await tracer(320, 260, 820, 460)
  const px = await peints()
  const moteur = await encre.evaluate(() => !!window.hexaEngine).catch(() => false)

  return {
    statut: moteur && px > 3000 && erreurs.encre.length === 0 ? OK : KO,
    detail: `moteur ${moteur} · ${px} px peints après rechargement · ${erreurs.encre.length} erreur(s)`,
  }
})

/* ------------------------------------------------------------------ *
 * 8. LA FENÊTRE D'INTERFACE DÉTRUITE SOUS LES PIEDS DU PRINCIPAL
 *
 * Le principal parle aux deux fenêtres à chaque diffusion d'état. Une fenêtre
 * détruite entre deux messages est un cas que le système impose (fermeture,
 * plantage) : il ne doit pas emporter le principal, sans quoi TOUT s'arrête,
 * y compris l'écran qui annote.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-8-interface-detruite', 'Détruire la fenêtre d’interface n’arrête pas l’encre', async () => {
  const avantJournal = journal().length
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue
        const u = w.webContents.getURL()
        if (/ui\.html/i.test(u)) {
          w.destroy()
          return
        }
      }
    })
    .catch(() => {})
  await pause(2500)

  // On provoque une diffusion d'état : c'est elle qui traverse la liste des
  // fenêtres et qui lèverait sur une fenêtre détruite.
  await app
    .evaluate(({ screen }) => {
      screen.emit('display-metrics-changed', {}, globalThis.__s22troisieme, ['bounds'])
    })
    .catch(() => {})
  await pause(2000)
  ;({ encre, inter } = await trouverPages())
  if (!encre) return { statut: KO, detail: 'la fenêtre d’encre a disparu avec l’interface' }

  await assurerDessin()
  await encre.keyboard.press('p')
  await pause(250)
  await toutEffacer()
  await tracer(340, 270, 840, 470)
  const px = await peints()

  const jrn = journal().slice(avantJournal)
  const plantages = (jrn.match(/Error|Exception|non rattrap/gi) ?? []).length

  return {
    statut: px > 3000 ? OK : KO,
    detail: `${px} px peints après destruction de l’interface · ${plantages} trace(s) d’erreur au journal`,
  }
})

/* ------------------------------------------------------------------ *
 * 9. LA DURÉE — LA PLAINTE N°1
 *
 * « ça saccade de plus en plus à mesure que le temps passe. » Une pente ne se
 * voit pas sur un geste : elle se voit sur des centaines. On répète le cycle
 * complet (tracer, effacer) et on compare le COÛT D'UN CYCLE au début et à la
 * fin, ainsi que le nombre d'images calculées AU REPOS — qui doit rester nul
 * quoi qu'il arrive, puisque c'est la règle §2.5.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-9-pente-sur-la-duree', 'Trois cents cycles ne creusent pas de pente', async () => {
  await toutEffacer()
  const cycle = async () => {
    await encre.mouse.move(300, 300)
    await encre.mouse.down()
    await encre.mouse.move(700, 450, { steps: 4 })
    await encre.mouse.up()
  }

  // Échauffement : on ne mesure pas la compilation JIT.
  for (let i = 0; i < 20; i++) await cycle()
  await toutEffacer()

  const chrono = async (n) => {
    const t0 = Date.now()
    for (let i = 0; i < n; i++) await cycle()
    return Date.now() - t0
  }

  const debut = await chrono(60)
  // Le gros du travail, sans mesure : c'est lui qui doit creuser la pente s'il
  // y en a une (accumulation de traits, d'écouteurs, d'entrées d'archive).
  for (let i = 0; i < 180; i++) await cycle()
  const fin = await chrono(60)

  /*
   * ⚠️ `exportSession().strokes` est l'ARCHIVE DE REJEU : elle contient tous
   * les traits jamais posés, effacés compris — c'est son rôle. La mesurer
   * après un effacement fait croire à une fuite qui n'existe pas (une version
   * antérieure de ce test annonçait « 300 traits vivants » après un « tout
   * effacer » parfaitement réussi). Ce qui compte ici, ce sont les traits que
   * le moteur tient encore VIVANTS, et surtout les pixels réellement à
   * l'écran : ce sont eux que l'utilisateur voit.
   */
  const vivants = await encre.evaluate(() => window.__hexaDbg?.vivants ?? -1).catch(() => -1)

  await toutEffacer()
  await pause(1500)
  const resteApresEffacement = await peints()
  // Au repos, après trois cents cycles : zéro image calculée. C'est la règle
  // qui a coûté trois correctifs à l'utilisateur ; elle doit tenir APRÈS usage,
  // pas seulement sur une application fraîchement lancée.
  const avantRepos = await encre.evaluate(() => window.__hexaDbg?.appels ?? -1).catch(() => -1)
  await pause(3000)
  const apresRepos = await encre.evaluate(() => window.__hexaDbg?.appels ?? -1).catch(() => -1)
  const imagesAuRepos = apresRepos - avantRepos

  const pente = debut > 0 ? (fin - debut) / debut : 1
  // 60 % de marge : on cherche une DÉRIVE, pas le bruit d'une machine de test
  // partagée. Une vraie fuite double ou triple le coût, elle ne l'effleure pas.
  const ok = pente < 0.6 && imagesAuRepos === 0 && resteApresEffacement === 0
  return {
    statut: ok ? OK : KO,
    detail:
      `60 premiers cycles ${debut} ms · 60 derniers ${fin} ms · pente ${(pente * 100).toFixed(1)} % ` +
      `(doit rester < 60 %) · ${vivants} trait(s) vivants avant effacement · ` +
      `${resteApresEffacement} px après « tout effacer » (doit être 0) · ` +
      `${imagesAuRepos} image(s) calculée(s) sur 3 s de repos (doit être 0)`,
  }
})

/* ------------------------------------------------------------------ *
 * 10. RIEN N'A FUI
 *
 * Après tout ce qui précède : les fenêtres attendues, et pas une de plus. Une
 * fenêtre orpheline par bascule, c'est la mémoire qui monte tout le direct.
 * ------------------------------------------------------------------ */

await rapport.test(encre, 's22-10-pas-de-fenetre-orpheline', 'Aucune fenêtre orpheline après tout le martèlement', async () => {
  const compte = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => {
        let url = ''
        try {
          url = w.webContents.getURL()
        } catch {
          /* en cours de destruction */
        }
        return url.startsWith('data:') ? 'accueil' : url.split('/').pop()
      }),
  )
  const ecrans = await app.evaluate(({ screen }) => screen.getAllDisplays().length)
  // Deux fenêtres par écran, au plus. Le bandeau d'accueil est légitime.
  const reelles = compte.filter((u) => u !== 'accueil')
  const ok = reelles.length <= ecrans * 2
  return {
    statut: ok ? OK : KO,
    detail: `${ecrans} écran(s) · ${reelles.length} fenêtre(s) réelle(s) : ${reelles.join(', ')} (plafond ${ecrans * 2})`,
  }
})

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
