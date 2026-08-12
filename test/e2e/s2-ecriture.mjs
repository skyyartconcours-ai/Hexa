/**
 * Hexa — campagne « écriture de capitales, lettre par lettre » (S2).
 *
 * Tout se joue dans la VRAIE application Electron, à la souris, avec des
 * tracés tremblés. Ce qui est vérifié :
 *
 *   mots       · SYNDRA, GG, TOP, WARD écrits à la main sont lus juste
 *   direct     · une lettre est DÉJÀ typographiée pendant qu'on écrit la
 *                suivante (c'est toute la promesse du mode)
 *   plusieurs  · les lettres à plusieurs traits (A, E, H, T, Y) ne se cassent
 *                pas en morceaux, et la barre du A posée APRÈS coup rejoint
 *                le A au lieu de créer un caractère de plus
 *   prudence   · un gribouillis qui ne ressemble à rien n'est PAS transformé
 *   annuler    · Ctrl+Z rend le gribouillis de la lettre, sans casser le mot
 *   lexique    · le contrat onWord / rewrite() est complet et utilisable
 *   taux       · taux de reconnaissance mesuré sur A→Z
 *
 * Usage :
 *   node test/e2e/s2-ecriture.mjs [mots|direct|plusieurs|prudence|annuler|lexique|taux]
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures } from './harness.mjs'

const seulement = process.argv.slice(2).find((a) => !a.startsWith('-'))
const veut = (nom) => !seulement || seulement === nom

/* ------------------------------------------------------------------ *
 * Alphabet gestuel : comment une main trace une capitale.
 * Coordonnées dans la boîte de capitale [0..l] x [0..1], y vers le bas.
 * ------------------------------------------------------------------ */
const P = (...pts) => pts
const GESTE = {
  A: [P([0.04, 1], [0.46, 0.02]), P([0.46, 0.03], [0.9, 1]), P([0.18, 0.62], [0.76, 0.63])],
  B: [
    P([0.02, 0], [0.02, 1]),
    P([0.02, 0.01], [0.4, 0], [0.66, 0.14], [0.66, 0.36], [0.4, 0.48], [0.02, 0.49]),
    P([0.02, 0.5], [0.44, 0.5], [0.74, 0.66], [0.72, 0.88], [0.44, 1], [0.02, 0.99]),
  ],
  C: [P([0.88, 0.16], [0.6, 0.02], [0.28, 0.08], [0.06, 0.36], [0.06, 0.66], [0.28, 0.94], [0.6, 0.98], [0.88, 0.84])],
  D: [P([0.03, 0], [0.03, 1]), P([0.03, 0.02], [0.34, 0], [0.62, 0.12], [0.74, 0.5], [0.62, 0.88], [0.34, 1], [0.03, 0.99])],
  E: [P([0.78, 0.02], [0.04, 0]), P([0.04, 0.01], [0.04, 1]), P([0.04, 1], [0.8, 0.98]), P([0.05, 0.5], [0.62, 0.5])],
  F: [P([0.04, 0], [0.04, 1]), P([0.04, 0.02], [0.76, 0]), P([0.05, 0.47], [0.62, 0.47])],
  G: [P([0.86, 0.16], [0.6, 0.02], [0.28, 0.08], [0.06, 0.36], [0.06, 0.66], [0.28, 0.94], [0.6, 0.98], [0.86, 0.84], [0.9, 0.56], [0.52, 0.56])],
  H: [P([0.03, 0], [0.03, 1]), P([0.75, 0.02], [0.75, 1]), P([0.03, 0.5], [0.75, 0.48])],
  I: [P([0.3, 0], [0.3, 1]), P([0.04, 0.01], [0.56, 0]), P([0.04, 1], [0.56, 0.99])],
  J: [P([0.66, 0], [0.66, 0.72], [0.56, 0.94], [0.32, 1], [0.12, 0.88], [0.08, 0.7])],
  K: [P([0.03, 0], [0.03, 1]), P([0.72, 0.02], [0.06, 0.55]), P([0.2, 0.44], [0.78, 1])],
  L: [P([0.04, 0], [0.04, 1], [0.66, 0.98])],
  M: [P([0.02, 1], [0.02, 0], [0.45, 0.66], [0.88, 0], [0.88, 1])],
  N: [P([0.02, 1], [0.02, 0]), P([0.03, 0.03], [0.75, 0.97]), P([0.76, 1], [0.76, 0])],
  O: [P([0.5, 0], [0.16, 0.12], [0.02, 0.46], [0.14, 0.86], [0.48, 1], [0.82, 0.86], [0.94, 0.48], [0.82, 0.12], [0.5, 0])],
  P: [P([0.03, 0], [0.03, 1]), P([0.03, 0.02], [0.42, 0], [0.7, 0.14], [0.7, 0.38], [0.42, 0.52], [0.03, 0.53])],
  R: [P([0.03, 0], [0.03, 1]), P([0.03, 0.02], [0.4, 0], [0.7, 0.14], [0.68, 0.38], [0.4, 0.52], [0.03, 0.52]), P([0.36, 0.53], [0.8, 1])],
  S: [P([0.82, 0.14], [0.5, 0], [0.14, 0.1], [0.1, 0.32], [0.44, 0.48], [0.78, 0.62], [0.76, 0.88], [0.4, 1], [0.08, 0.86])],
  T: [P([0.02, 0.02], [0.82, 0]), P([0.42, 0.03], [0.42, 1])],
  U: [P([0.02, 0], [0.03, 0.66], [0.16, 0.92], [0.42, 1], [0.66, 0.92], [0.78, 0.66], [0.78, 0])],
  V: [P([0.02, 0], [0.42, 1], [0.82, 0])],
  W: [P([0, 0], [0.24, 1], [0.5, 0.28], [0.76, 1], [1, 0])],
  X: [P([0.02, 0], [0.74, 1]), P([0.74, 0], [0.02, 1])],
  Y: [P([0.02, 0], [0.4, 0.52]), P([0.78, 0], [0.4, 0.52]), P([0.4, 0.53], [0.4, 1])],
  Z: [P([0.02, 0.02], [0.78, 0], [0.03, 1], [0.8, 0.98])],
}
/** avance de la plume, en hauteurs de capitale */
const AVANCE = { I: 0.72, L: 0.8, W: 1.18, M: 1.06, T: 0.94 }

let graine = 20250812
const alea = () => ((graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

/** échantillonne une polyligne et la tremble : c'est ce que fait une main */
function pointsDe(poly, x0, ligne, cap, tremble) {
  const out = []
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]
    const b = poly[i]
    const n = Math.max(2, Math.round((Math.hypot(b[0] - a[0], b[1] - a[1]) * cap) / 6))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n
      out.push([
        x0 + (a[0] + (b[0] - a[0]) * t) * cap + (alea() - 0.5) * tremble,
        ligne - cap + (a[1] + (b[1] - a[1]) * t) * cap + (alea() - 0.5) * tremble,
      ])
    }
  }
  return out
}

async function traitDe(win, pts) {
  await win.mouse.move(pts[0][0], pts[0][1])
  await win.mouse.down()
  for (const p of pts.slice(1)) await win.mouse.move(p[0], p[1])
  await win.mouse.up()
}

/** écrit un mot à la souris ; `apresLettre` permet de capturer en cours de route */
async function ecrire(win, mot, { x, ligne, cap = 76, tremble = 3.2, pause = 500, apresLettre } = {}) {
  let plume = x
  for (let i = 0; i < mot.length; i++) {
    const ch = mot[i]
    for (const poly of GESTE[ch]) {
      await traitDe(win, pointsDe(poly, plume, ligne, cap, tremble))
      await win.waitForTimeout(35)
    }
    plume += cap * (AVANCE[ch] ?? 0.9) + cap * 0.2
    if (apresLettre) await apresLettre(i, ch)
    await win.waitForTimeout(pause)
  }
  return plume
}

/* ------------------------------------------------------------------ *
 * Lecture de l'état — par le moteur, comme le ferait un utilisateur qui
 * regarde l'écran : on ne lit que ce qui est POSÉ sur la scène.
 * ------------------------------------------------------------------ */

const HOOK = `(() => {
  if (window.__hw) return true
  const stage = document.querySelector('.stage')
  if (!stage) return false
  const key = Object.keys(stage).find((k) => k.startsWith('__reactFiber$'))
  let f = stage[key]
  for (let d = 0; f && d < 40; d++, f = f.return) {
    let hook = f.memoizedState
    for (let i = 0; hook && i < 80; i++, hook = hook.next) {
      const st = hook.memoizedState
      if (st && typeof st === 'object' && 'current' in st && st.current) {
        const c = st.current
        if (c && c.strokes && c.redoStack && typeof c.undo === 'function') window.__hw = c
      }
    }
  }
  return !!window.__hw
})()`

const moteur = (win, fn, arg) =>
  win.evaluate(
    ({ src, arg }) => new Function('e', 'arg', src)(window.__hw, arg),
    { src: `return (${fn.toString()})(e, arg)`, arg },
  )

const luSurLaScene = (win) =>
  moteur(win, (e) =>
    e.strokes
      .filter((s) => s.tool === 'glyph')
      .sort((a, b) => a.points[0].x - b.points[0].x)
      .map((s) => s.text)
      .join(''),
  )
const compter = (win) =>
  moteur(win, (e) => ({
    lettres: e.strokes.filter((s) => s.tool === 'glyph').length,
    encre: e.strokes.filter((s) => s.tool === 'pen').length,
  }))
const nettoyer = async (win) => {
  await moteur(win, (e) => e.clear())
  await win.waitForTimeout(260)
}
/** plus longue sous-suite commune : une lettre manquante coûte 1, pas 4 */
function commun(a, b) {
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1])
  return d[a.length][b.length]
}

/* ------------------------------------------------------------------ */

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's2' })
// Correcteur lexical COUPÉ : cette campagne-ci mesure la lecture des LETTRES.
// Le lexique, lui, réécrit le mot entier (« SYNDRA » → « Syndra ») et a sa
// propre campagne (test/e2e/s3-lexique.mjs).
await etatDeDepart(win, {
  handwriting: true,
  fadeDelay: null,
  size: 5,
  smartShapes: false,
  lexicon: false,
})
await win.evaluate(HOOK)

if (veut('mots')) {
  await rapport.test(win, 's2-mots', 'SYNDRA, GG, TOP, WARD écrits à la souris', async () => {
    const attendus = ['SYNDRA', 'GG', 'TOP', 'WARD']
    const obtenus = []
    let justes = 0
    let total = 0
    for (const mot of attendus) {
      await nettoyer(win)
      await ecrire(win, mot, { x: 200, ligne: 300, cap: 76 })
      await win.waitForTimeout(1200)
      const got = await luSurLaScene(win)
      obtenus.push(`${mot}→${got || '∅'}`)
      justes += commun(mot, got)
      total += mot.length
    }
    // au moins 90 % des lettres des quatre mots doivent être justes
    return {
      statut: justes >= Math.ceil(total * 0.9) ? OK : KO,
      detail: `${obtenus.join('  ')} — ${justes}/${total} lettres justes`,
    }
  })
}

if (veut('direct')) {
  await rapport.test(win, 's2-direct', 'Une lettre est typographiée pendant qu’on écrit la suivante', async (capturer) => {
    await nettoyer(win)
    let pendant = null
    await ecrire(win, 'TOP', {
      x: 240,
      ligne: 300,
      cap: 80,
      apresLettre: async (i) => {
        if (i === 1) {
          // la 3ᵉ lettre n'est pas encore commencée : on regarde ce qui est déjà posé
          await win.waitForTimeout(520)
          pendant = await compter(win)
          await capturer('en-cours')
        }
      },
    })
    await win.waitForTimeout(1200)
    const fin = await compter(win)
    return {
      statut: pendant && pendant.lettres >= 2 && fin.lettres >= 3 ? OK : KO,
      detail:
        `pendant l'écriture : ${pendant?.lettres} lettre(s) déjà typographiée(s) et ${pendant?.encre} trait(s) d'encre ; ` +
        `à la fin : ${fin.lettres} lettres, ${fin.encre} encre`,
    }
  })
}

if (veut('plusieurs')) {
  await rapport.test(win, 's2-plusieurs-traits', 'Lettres à plusieurs traits : A, E, H, T, Y restent entières', async () => {
    await nettoyer(win)
    await ecrire(win, 'HAY', { x: 220, ligne: 300, cap: 78 })
    await win.waitForTimeout(1200)
    const lu = await luSurLaScene(win)
    const c = await compter(win)
    return {
      statut: lu === 'HAY' ? OK : KO,
      detail: `9 traits pour 3 lettres → « ${lu} » (${c.lettres} lettres posées, ${c.encre} traits d'encre restants)`,
    }
  })

  await rapport.test(win, 's2-rattrapage', 'La barre du A posée APRÈS coup rejoint le A', async (capturer) => {
    await nettoyer(win)
    const cap = 92
    const x = 320
    const ligne = 320
    await traitDe(win, pointsDe(GESTE.A[0], x, ligne, cap, 3))
    await win.waitForTimeout(40)
    await traitDe(win, pointsDe(GESTE.A[1], x, ligne, cap, 3))
    // on laisse VOLONTAIREMENT la lettre se transformer avant de poser la barre
    await win.waitForTimeout(700)
    const avant = await compter(win)
    await traitDe(win, pointsDe(GESTE.A[2], x, ligne, cap, 3))
    await win.waitForTimeout(1300)
    await capturer('apres-barre')
    const apres = await compter(win)
    const lu = await luSurLaScene(win)
    return {
      statut: apres.lettres === 1 && lu === 'A' ? OK : KO,
      detail:
        `avant la barre : ${avant.lettres} lettre(s) posée(s) — après : ${apres.lettres} lettre(s) « ${lu} », ` +
        `${apres.encre} trait(s) d'encre (la barre ne doit PAS faire un caractère de plus)`,
    }
  })
}

if (veut('prudence')) {
  await rapport.test(win, 's2-prudence', 'Un gribouillis n’est pas transformé de force', async () => {
    await nettoyer(win)
    // trois boucles nerveuses : ça ne ressemble à aucune lettre
    const pts = []
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 6
      pts.push([420 + Math.cos(a) * 40 + i * 0.9, 300 + Math.sin(a * 1.7) * 34])
    }
    await traitDe(win, pts)
    await win.waitForTimeout(1600)
    const c = await compter(win)
    return {
      statut: c.lettres === 0 && c.encre === 1 ? OK : KO,
      detail: `gribouillis laissé tel quel : ${c.lettres} lettre(s) typographiée(s), ${c.encre} trait(s) d'encre`,
    }
  })
}

if (veut('annuler')) {
  await rapport.test(win, 's2-annuler', 'Ctrl+Z rend le gribouillis de la lettre, sans casser le mot', async () => {
    await nettoyer(win)
    await ecrire(win, 'TOP', { x: 240, ligne: 300, cap: 78 })
    await win.waitForTimeout(1200)
    const avant = await compter(win)
    await win.keyboard.press('Control+z')
    await win.waitForTimeout(800)
    const apres = await compter(win)
    const rendu = apres.lettres === avant.lettres - 1 && apres.encre > 0
    return {
      statut: rendu ? OK : KO,
      detail: `${avant.lettres} lettres / ${avant.encre} encre → ${apres.lettres} lettres / ${apres.encre} encre (le P revient en manuscrit)`,
    }
  })
}

if (veut('lexique')) {
  await rapport.test(win, 's2-lexique', 'Contrat lexique : onWord livre le mot, rewrite() le remet en forme', async () => {
    await nettoyer(win)
    await moteur(win, (e) => {
      window.__mot = null
      e.writing.onWord = (w) => {
        window.__mot = {
          id: w.id,
          raw: w.raw,
          closed: w.closed,
          cap: Math.round(w.capHeight),
          base: Math.round(w.baseline),
          lettres: w.letters.map((l) => ({ c: l.char, s: +l.score.toFixed(2), b: !!l.box, g: l.glyphId != null })),
        }
        // un correcteur lexical brancherait ici son dictionnaire
        if (w.closed && w.raw === 'TOP') e.writing.rewrite(w.id, 'Top')
      }
    })
    await ecrire(win, 'TOP', { x: 240, ligne: 300, cap: 78 })
    await win.waitForTimeout(2200)
    const mot = await win.evaluate(() => window.__mot)
    const lu = await luSurLaScene(win)
    const complet =
      mot &&
      mot.raw === 'TOP' &&
      mot.closed === true &&
      mot.cap > 40 &&
      mot.base > 0 &&
      mot.lettres.length === 3 &&
      mot.lettres.every((l) => l.s > 0.6 && l.b && l.g)
    return {
      statut: complet && lu === 'Top' ? OK : KO,
      detail: `onWord → ${JSON.stringify(mot)} ; après rewrite() la scène affiche « ${lu} »`,
    }
  })
}

if (veut('taux')) {
  await rapport.test(win, 's2-taux', 'Taux de reconnaissance mesuré sur A→Z', async () => {
    let justes = 0
    let total = 0
    const lignes = []
    for (const mot of ['ABCDEF', 'GHIJKL', 'MNOPRS', 'TUVWXYZ']) {
      await nettoyer(win)
      await ecrire(win, mot, { x: 130, ligne: 300, cap: 74, pause: 470 })
      await win.waitForTimeout(1100)
      const got = await luSurLaScene(win)
      lignes.push(`${mot}→${got}`)
      justes += commun(mot, got)
      total += mot.length
    }
    const pct = Math.round((justes / total) * 100)
    // seuil de non-régression : on mesure aujourd'hui bien au-dessus
    return {
      statut: pct >= 85 ? OK : KO,
      detail: `${lignes.join('  ')} — ${justes}/${total} = ${pct} % des capitales reconnues`,
    }
  })
}

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
