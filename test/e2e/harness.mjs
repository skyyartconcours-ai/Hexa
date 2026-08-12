/**
 * Hexa — outillage de la campagne de tests bout en bout.
 *
 * Tout ce qui suit pilote la VRAIE application Electron (pas une simulation,
 * pas un rendu de composant isolé) : la fenêtre transparente est lancée, la
 * souris et le clavier sont pilotés comme ceux de l'utilisateur, et la preuve
 * qu'une fonctionnalité marche est TOUJOURS un comptage de pixels réellement
 * peints sur les canevas.
 *
 * Aucune dépendance nouvelle : playwright-core est déjà installé, Electron
 * aussi. Rien ne sort sur le réseau.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))

/**
 * Playwright n'est PAS une dépendance d'Hexa : l'application livrée à
 * l'utilisateur ne doit pas grossir d'un pilote de navigateur. On va donc le
 * chercher là où il se trouve — dépendance locale, installation globale, ou
 * chemin donné à la main — et on explique clairement quoi faire s'il manque.
 */
export async function chargerPilote() {
  const globalNode = join(dirname(dirname(process.execPath)), 'lib', 'node_modules')
  const pistes = [
    process.env.HEXA_E2E_PLAYWRIGHT,
    'playwright-core',
    'playwright',
    join(RACINE, 'node_modules', 'playwright-core', 'index.js'),
    join(globalNode, 'playwright-core', 'index.js'),
    join(globalNode, 'playwright', 'index.js'),
    join(globalNode, 'playwright', 'node_modules', 'playwright-core', 'index.js'),
  ].filter(Boolean)
  for (const piste of pistes) {
    try {
      const spec = piste.startsWith('.') || piste.includes('/') ? pathToFileURL(piste).href : piste
      if (piste.includes('/') && !existsSync(piste)) continue
      const mod = await import(spec)
      return mod._electron ?? mod.default?._electron
    } catch {
      /* piste suivante */
    }
  }
  throw new Error(
    'Playwright introuvable. Installe-le sans toucher aux dépendances d’Hexa :\n' +
      '  npm i -g playwright        (puis relance)\n' +
      'ou indique son emplacement :\n' +
      '  HEXA_E2E_PLAYWRIGHT=/chemin/vers/playwright-core/index.js node test/e2e/hexa-e2e.mjs',
  )
}

/** racine du dépôt (test/e2e/ → ../../) */
export const RACINE = resolve(ICI, '..', '..')

/** dossier des captures — une par test, c'est la seule preuve qui compte */
export const CAPTURES = process.env.HEXA_E2E_OUT
  ? resolve(process.env.HEXA_E2E_OUT)
  : join(RACINE, 'test', 'e2e', 'captures')

/* ------------------------------------------------------------------ *
 * Lancement de l'application
 * ------------------------------------------------------------------ */

/**
 * Lance Hexa avec un dossier utilisateur NEUF : chaque campagne repart d'une
 * installation vierge, exactement comme le tout premier double-clic sur
 * l'icône. C'est ce qui rend les résultats reproductibles.
 */
export async function lancerHexa({ profil = 'campagne' } = {}) {
  const electron = await chargerPilote()
  const userData = join(CAPTURES, `.user-data-${profil}`)
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })

  if (!existsSync(join(RACINE, 'dist', 'index.html')) || !existsSync(join(RACINE, 'dist-electron', 'main.cjs'))) {
    throw new Error('Application non construite. Lance d’abord : npm run build && npm run build:main')
  }

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: RACINE,
    executablePath: join(RACINE, 'node_modules', 'electron', 'dist', 'electron'),
    timeout: 60000,
  })

  const journal = { erreurs: [], consoleErreurs: [] }
  const win = await app.firstWindow({ timeout: 30000 })
  win.on('pageerror', (e) => journal.erreurs.push(String(e.message)))
  win.on('console', (m) => {
    if (m.type() === 'error') journal.consoleErreurs.push(m.text())
  })
  // le premier rendu, la création du moteur et le dimensionnement des canevas
  await win.waitForSelector('.stage canvas', { timeout: 20000 })
  await win.waitForTimeout(1200)
  return { app, win, journal }
}

/**
 * Remet l'application dans un état de départ connu : découverte guidée déjà
 * vue, fondu sur ∞ (les traits restent, sinon la moitié des tests mesurerait
 * du vide), thème par défaut, sons coupés. On passe par localStorage, c'est-
 * à-dire par le VRAI mécanisme de persistance de l'application, puis on
 * recharge : si la persistance est cassée, ce test-ci le voit tout de suite.
 */
export async function etatDeDepart(win, patch = {}) {
  await win.evaluate((p) => {
    localStorage.setItem(
      'hexa-ui',
      JSON.stringify({
        state: {
          onboarded: true,
          fadeDelay: null,
          tool: 'pen',
          color: '#00e5ff',
          size: 6,
          theme: 'neon-nuit',
          sound: false,
          sparkles: true,
          smartShapes: true,
          guides: true,
          handwriting: false,
          toolbarVisible: true,
          keymapPreset: 'epicpen',
          keymapPresetChosen: true,
          keymapOverrides: {},
          // les raccourcis système sont confisqués à l'OS : sous Xvfb ça n'a
          // aucun sens et ça pollue le journal
          globalShortcutsOn: false,
          ...p,
        },
        version: 2,
      }),
    )
  }, patch)
  await win.reload()
  await win.waitForSelector('.toolbar', { timeout: 15000 })
  await win.waitForTimeout(700)
}

/* ------------------------------------------------------------------ *
 * Mesure de l'encre : la preuve
 * ------------------------------------------------------------------ */

/**
 * Compte les pixels non transparents de chaque canevas et donne la boîte
 * englobante de l'encre posée. C'est LA fonction qui distingue « le bouton
 * a l'air actif » de « quelque chose a réellement été dessiné ».
 *
 * Renvoie des coordonnées en pixels CSS (donc comparables aux coordonnées
 * souris), pas en pixels physiques.
 */
export function encre(win) {
  return win.evaluate(() => {
    const cvs = [...document.querySelectorAll('.stage canvas')]
    // ordre du DOM : voile (spotlight) · statique (annotations) · vif (geste)
    const noms = ['voile', 'statique', 'vif']
    const out = { total: 0, voile: 0, statique: 0, vif: 0, boite: null, boiteVif: null }
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    /** boîte par canevas : le voile couvre l'écran, le vif porte les étincelles
     *  et le curseur — mélanger tout ça donnerait des mesures fausses. */
    const boites = cvs.map(() => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }))
    cvs.forEach((cv, idx) => {
      const ctx = cv.getContext('2d')
      if (!ctx || cv.width === 0) return
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data
      const b = boites[idx]
      let n = 0
      for (let y = 0; y < cv.height; y++) {
        const base = y * cv.width * 4
        for (let x = 0; x < cv.width; x++) {
          if (d[base + x * 4 + 3] > 8) {
            n++
            if (x < b.x0) b.x0 = x
            if (x > b.x1) b.x1 = x
            if (y < b.y0) b.y0 = y
            if (y > b.y1) b.y1 = y
          }
        }
      }
      out[noms[idx] ?? `c${idx}`] = n
      out.total += n
    })
    const enPx = (b) =>
      b.x1 >= b.x0
        ? {
            x: Math.round(b.x0 / dpr),
            y: Math.round(b.y0 / dpr),
            w: Math.round((b.x1 - b.x0 + 1) / dpr),
            h: Math.round((b.y1 - b.y0 + 1) / dpr),
          }
        : null
    // `boite` = les ANNOTATIONS posées (canevas statique) : c'est la seule
    // mesure stable, les étincelles du canevas vif faussent tout le reste.
    out.boite = boites[1] ? enPx(boites[1]) : null
    out.boiteVif = boites[2] ? enPx(boites[2]) : null
    return out
  })
}

/** Raccourci le plus fréquent : « y a-t-il de l'encre à l'écran ? » */
export async function encreTotale(win) {
  return (await encre(win)).total
}

/**
 * Planéité du bord supérieur de l'encre du canevas statique.
 *
 * Sert à prouver qu'une forme intelligente a VRAIMENT redressé un gribouillis
 * (un rectangle net a un bord haut parfaitement horizontal, un gribouillis
 * non) et qu'un guide magnétique a VRAIMENT aimanté une ligne sur l'horizontale.
 * Renvoie l'écart-type, en pixels CSS, des ordonnées du bord haut.
 */
export function planeiteHaut(win) {
  return win.evaluate(() => {
    const cv = document.querySelectorAll('.stage canvas')[1]
    const ctx = cv?.getContext('2d')
    if (!ctx) return null
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data
    /** pour chaque colonne, la première ligne d'encre rencontrée */
    const hauts = new Array(cv.width).fill(-1)
    for (let y = 0; y < cv.height; y++) {
      const base = y * cv.width * 4
      for (let x = 0; x < cv.width; x++) {
        if (hauts[x] < 0 && d[base + x * 4 + 3] > 40) hauts[x] = y
      }
    }
    const cols = []
    for (let x = 0; x < cv.width; x++) if (hauts[x] >= 0) cols.push(x)
    if (cols.length < 40) return null
    // on écarte 15 % de chaque côté : les coins arrondis et les pointes de
    // flèche ne disent rien de la rectitude du bord
    const marge = Math.floor(cols.length * 0.15)
    const util = cols.slice(marge, cols.length - marge).map((x) => hauts[x])
    const moy = util.reduce((a, b) => a + b, 0) / util.length
    const varn = util.reduce((a, b) => a + (b - moy) * (b - moy), 0) / util.length
    return { ecartType: Math.sqrt(varn) / dpr, colonnes: util.length }
  })
}

/* ------------------------------------------------------------------ *
 * Gestes
 * ------------------------------------------------------------------ */

/** Un trait à main levée, tracé en plusieurs points comme un vrai geste. */
export async function tracer(win, points, { bouton = 'left', pauseMs = 8 } = {}) {
  const m = win.mouse
  await m.move(points[0][0], points[0][1])
  await m.down({ button: bouton })
  for (let i = 1; i < points.length; i++) {
    await m.move(points[i][0], points[i][1], { steps: 2 })
    if (pauseMs) await win.waitForTimeout(pauseMs)
  }
  await m.up({ button: bouton })
}

/** Segment droit entre deux points (formes, lignes, flèches, mesure). */
export function segment(x0, y0, x1, y1, n = 12) {
  const pts = []
  for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
  return pts
}

/**
 * Gribouillis de rectangle : quatre côtés tremblés, comme à la main.
 *
 * Le tremblement est volontairement BASSE FRÉQUENCE et ample (±14 px) : le
 * lissage One Euro du moteur écrase les micro-tremblements, et un gribouillis
 * déjà lisse ne prouverait rien sur les formes intelligentes.
 */
export function rectangleTremble(x, y, w, h) {
  const bruit = (t) => Math.sin(t * Math.PI * 2) * 11 + Math.sin(t * Math.PI * 5 + 1) * 4
  const pts = []
  for (let t = 0; t <= 1; t += 0.05) pts.push([x + w * t, y + bruit(t)])
  for (let t = 0; t <= 1; t += 0.07) pts.push([x + w + bruit(t), y + h * t])
  for (let t = 0; t <= 1; t += 0.05) pts.push([x + w - w * t, y + h + bruit(t)])
  for (let t = 0; t <= 1; t += 0.07) pts.push([x + bruit(t), y + h - h * t])
  return pts
}

/**
 * Écriture manuscrite de test.
 *
 * Le mode écriture n'accepte de transformer QUE ce qu'il reconnaît avec une
 * forte confiance (un faux positif en direct serait pire que rien). Les
 * lettres ci-dessous sont donc tracées proprement, en capitales, à hauteur
 * suffisante — c'est ce que fait un streamer qui écrit pour être lu.
 */
const ALPHABET = {
  V: (x, y, H, w) => [[[x, y], [x + w * 0.5, y + H], [x + w, y]]],
  A: (x, y, H, w) => [
    [[x, y + H], [x + w * 0.5, y], [x + w, y + H]],
    [[x + w * 0.18, y + H * 0.68], [x + w * 0.82, y + H * 0.68]],
  ],
  L: (x, y, H, w) => [[[x, y], [x, y + H], [x + w * 0.8, y + H]]],
  T: (x, y, H, w) => [
    [[x, y], [x + w, y]],
    [[x + w * 0.5, y], [x + w * 0.5, y + H]],
  ],
  N: (x, y, H, w) => [[[x, y + H], [x, y], [x + w, y + H], [x + w, y]]],
  X: (x, y, H, w) => [
    [[x, y], [x + w, y + H]],
    [[x + w, y], [x, y + H]],
  ],
}

/** densifie une polyligne : un geste réel n'est pas fait de 3 points */
function densifier(pts, n = 6) {
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      out.push([
        pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n,
        pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n,
      ])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Écrit un mot à la main, lettre par lettre, trait par trait. */
export async function ecrireMot(win, mot, x0, y0, H = 80) {
  const w = H * 0.7
  let x = x0
  for (const c of mot.toUpperCase()) {
    const forme = ALPHABET[c]
    if (!forme) throw new Error(`lettre « ${c} » absente de l'alphabet de test`)
    for (const t of forme(x, y0, H, w)) await tracer(win, densifier(t), { pauseMs: 5 })
    x += w + H * 0.22
  }
}

/** Efface tout via le clavier de l'application (touche de la table keymap). */
export async function toutEffacer(win) {
  await win.keyboard.press('c')
  await win.waitForTimeout(900)
}

/* ------------------------------------------------------------------ *
 * Lecture de l'état réel
 * ------------------------------------------------------------------ */

/** État persisté par l'application (le vrai, celui écrit par le store). */
export async function etat(win) {
  const brut = await win.evaluate(() => localStorage.getItem('hexa-ui'))
  if (!brut) return {}
  try {
    return JSON.parse(brut).state ?? {}
  } catch {
    return {}
  }
}

/** Outil actif d'après la barre : l'utilisateur, lui, ne lit que ça. */
export function outilActifDansBarre(win) {
  return win.evaluate(() => {
    const boutons = [...document.querySelectorAll('.toolbar .group:first-of-type .tbtn')]
    const i = boutons.findIndex((b) => b.classList.contains('active'))
    return i < 0 ? null : (boutons[i].getAttribute('title') ?? '').split('—')[0].trim()
  })
}

/** Clique le bouton d'outil dont l'infobulle commence par ce libellé. */
export async function cliquerOutil(win, libelle) {
  const ok = await win.evaluate((lib) => {
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find((el) =>
      (el.getAttribute('title') ?? '').startsWith(lib),
    )
    if (!b) return false
    b.click()
    return true
  }, libelle)
  await win.waitForTimeout(180)
  return ok
}

/* ------------------------------------------------------------------ *
 * Journal des résultats
 * ------------------------------------------------------------------ */

export const OK = 'FONCTIONNE'
export const KO = 'CASSÉ'
export const ABSENT = 'ABSENT'
export const NON_TESTE = 'NON TESTÉ'

export class Rapport {
  constructor() {
    this.lignes = []
    this.debut = Date.now()
  }

  ajouter(id, titre, statut, detail, capture) {
    this.lignes.push({ id, titre, statut, detail, capture })
    const marque = statut === OK ? '  ok ' : statut === KO ? ' KO  ' : '  ?  '
    process.stdout.write(`${marque} ${id.padEnd(26)} ${titre} — ${detail}\n`)
  }

  /**
   * Enveloppe un test : une capture, un statut, jamais d'exception qui tue tout.
   *
   * La fonction reçoit un `capturer(nom)` : beaucoup d'effets d'Hexa sont
   * ÉPHÉMÈRES (laser, ping, spotlight, roue d'outils). Une capture prise à la
   * fin du test ne montrerait qu'un écran vide — il faut pouvoir photographier
   * l'instant où l'effet est à l'écran.
   */
  async test(win, id, titre, fn) {
    const capture = `${id}.png`
    const capturer = (nom) =>
      win.screenshot({ path: join(CAPTURES, `${id}-${nom}.png`) }).catch(() => {})
    try {
      const r = await fn(capturer)
      const statut = r?.statut ?? (r?.ok === false ? KO : OK)
      await win.screenshot({ path: join(CAPTURES, capture) }).catch(() => {})
      this.ajouter(id, titre, statut, r?.detail ?? '', capture)
      return r
    } catch (err) {
      await win.screenshot({ path: join(CAPTURES, capture) }).catch(() => {})
      this.ajouter(id, titre, KO, `exception : ${String(err?.message ?? err).slice(0, 160)}`, capture)
      return { statut: KO }
    }
  }

  tableau() {
    const largeurs = [26, 46, 11]
    const barre = `+${'-'.repeat(largeurs[0] + 2)}+${'-'.repeat(largeurs[1] + 2)}+${'-'.repeat(
      largeurs[2] + 2,
    )}+`
    const out = []
    out.push('')
    out.push('================ RÉSULTATS DE LA CAMPAGNE ================')
    out.push(barre)
    out.push(
      `| ${'Test'.padEnd(largeurs[0])} | ${'Objet'.padEnd(largeurs[1])} | ${'Statut'.padEnd(
        largeurs[2],
      )} |`,
    )
    out.push(barre)
    for (const l of this.lignes) {
      out.push(
        `| ${l.id.slice(0, largeurs[0]).padEnd(largeurs[0])} | ${l.titre
          .slice(0, largeurs[1])
          .padEnd(largeurs[1])} | ${l.statut.padEnd(largeurs[2])} |`,
      )
    }
    out.push(barre)
    const n = (s) => this.lignes.filter((l) => l.statut === s).length
    out.push('')
    out.push(`${n(OK)} FONCTIONNE · ${n(KO)} CASSÉ · ${n(ABSENT)} ABSENT · ${n(NON_TESTE)} NON TESTÉ`)
    const casses = this.lignes.filter((l) => l.statut !== OK)
    if (casses.length > 0) {
      out.push('')
      out.push('--- détail des points non validés ---')
      for (const l of casses) out.push(`  [${l.statut}] ${l.id} : ${l.detail}  (capture ${l.capture})`)
    }
    out.push('')
    out.push(`captures : ${CAPTURES}`)
    out.push(`durée : ${Math.round((Date.now() - this.debut) / 1000)} s`)
    return out.join('\n')
  }

  /** code de sortie : 1 s'il reste un point cassé */
  get codeSortie() {
    return this.lignes.some((l) => l.statut === KO) ? 1 : 0
  }
}

export function preparerCaptures() {
  mkdirSync(CAPTURES, { recursive: true })
}
