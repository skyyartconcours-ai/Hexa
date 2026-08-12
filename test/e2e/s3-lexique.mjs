/**
 * Hexa — campagne « deviner le mot et le réécrire » (S3).
 *
 * Le mode écriture de S2 lit des LETTRES. Cette campagne-ci vérifie la
 * dernière marche : à la fin du mot, le lexique embarqué le devine et
 * rétablit son orthographe. Tout est joué à la souris dans la VRAIE
 * application Electron.
 *
 *   syndra     · « SYNDRA » écrit à la main ressort « Syndra »
 *   kaisa      · « KAISA » ressort « Kai'Sa » — l'apostrophe est restituée
 *   casse      · un mot hors lexique est juste remis en forme, pas remplacé
 *   crie       · un mot court reste en capitales (GG, MID)
 *   prudence   · un mot INCONNU du lexique n'est JAMAIS détourné
 *   annuler    · Ctrl+Z rend le mot NON corrigé, un second les gribouillis
 *   eteint     · l'interrupteur des réglages coupe vraiment le correcteur
 *
 * Usage :
 *   node test/e2e/s3-lexique.mjs [syndra|kaisa|casse|crie|prudence|annuler|eteint]
 */
import { KO, OK, Rapport, etatDeDepart, lancerHexa, preparerCaptures } from './harness.mjs'

const seulement = process.argv.slice(2).find((a) => !a.startsWith('-'))
const veut = (nom) => !seulement || seulement === nom

/* ------------------------------------------------------------------ *
 * Alphabet gestuel — comment une main trace une capitale.
 * Recopié de la campagne S2 : les deux campagnes doivent pouvoir évoluer
 * séparément, et un test qui dépend d'un autre test est un test fragile.
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
const AVANCE = { I: 0.72, L: 0.8, W: 1.18, M: 1.06, T: 0.94 }

let graine = 20260812
const alea = () => ((graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

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

/** écrit un mot à la souris, puis attend que le mot soit déclaré fini */
async function ecrire(win, mot, { x = 200, ligne = 320, cap = 76, tremble = 3.2, pause = 500 } = {}) {
  let plume = x
  for (const ch of mot) {
    for (const poly of GESTE[ch]) {
      await traitDe(win, pointsDe(poly, plume, ligne, cap, tremble))
      await win.waitForTimeout(35)
    }
    plume += cap * (AVANCE[ch] ?? 0.9) + cap * 0.2
    await win.waitForTimeout(pause)
  }
  return plume
}

/* ---------------- lecture de la scène ---------------- */

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
  if (window.__hw) {
    // journal des mots publiés : quand un test échoue, on veut savoir si
    // c'est la LECTURE des lettres ou la DÉCISION du lexique qui a dérapé
    window.__mots = []
    window.__hw.writing.onWord = (w) => {
      if (w.closed) window.__mots.push(w.letters.map((l) => (l.char || '·')).join(''))
    }
  }
  return !!window.__hw
})()`

const moteur = (win, fn, arg) =>
  win.evaluate(({ src, arg }) => new Function('e', 'arg', src)(window.__hw, arg), {
    src: `return (${fn.toString()})(e, arg)`,
    arg,
  })

/** ce qui est POSÉ sur la scène, de gauche à droite */
const luSurLaScene = (win) =>
  moteur(win, (e) =>
    e.strokes
      .filter((s) => s.tool === 'glyph')
      .sort((a, b) => a.points[0].x - b.points[0].x)
      .map((s) => s.text)
      .join(' '),
  )

const compter = (win) =>
  moteur(win, (e) => ({
    glyphes: e.strokes.filter((s) => s.tool === 'glyph').length,
    encre: e.strokes.filter((s) => s.tool === 'pen' && !s.dying).length,
  }))

const nettoyer = async (win) => {
  await moteur(win, (e) => e.clear())
  await win.evaluate(() => { window.__mots = [] })
  await win.waitForTimeout(300)
}

/** ce que le reconnaisseur a lu, avant toute correction */
const luParLaMachine = (win) => win.evaluate(() => (window.__mots ?? []).join('+'))

/** `a` n'est-il fait que de lettres de `b`, dans l'ordre ? */
function sousSuite(a, b) {
  let i = 0
  for (const c of b) if (i < a.length && a[i] === c) i++
  return i === a.length && a.length > 0
}

/** patiente jusqu'à la fermeture du mot (pause longue) et sa correction */
const finDeMot = (win) => win.waitForTimeout(2400)

/* ------------------------------------------------------------------ */

preparerCaptures()
const rapport = new Rapport()
const { app, win } = await lancerHexa({ profil: 's3' })
await etatDeDepart(win, {
  handwriting: true,
  fadeDelay: null,
  size: 5,
  smartShapes: false,
  lexicon: true,
})
await win.evaluate(HOOK)

if (veut('syndra')) {
  await rapport.test(win, 's3-syndra', '« SYNDRA » écrit à la souris ressort « Syndra »', async (capturer) => {
    await nettoyer(win)
    await ecrire(win, 'SYNDRA', { x: 170, ligne: 320 })
    await finDeMot(win)
    const texte = await luSurLaScene(win)
    await capturer('s3-syndra')
    return {
      statut: texte === 'Syndra' ? OK : KO,
      detail: `lu « ${await luParLaMachine(win)} » → scène « ${texte || '∅'} » (attendu « Syndra »)`,
    }
  })
}

if (veut('kaisa')) {
  await rapport.test(win, 's3-kaisa', '« KAISA » ressort « Kai’Sa » : l’apostrophe est restituée', async (capturer) => {
    await nettoyer(win)
    await ecrire(win, 'KAISA', { x: 170, ligne: 320 })
    await finDeMot(win)
    const texte = await luSurLaScene(win)
    await capturer('s3-kaisa')
    return {
      statut: texte === "Kai'Sa" ? OK : KO,
      detail: `lu « ${await luParLaMachine(win)} » → scène « ${texte || '∅'} » (attendu « Kai'Sa »)`,
    }
  })
}

if (veut('casse')) {
  await rapport.test(win, 's3-casse', 'Un mot hors lexique est mis en forme, pas remplacé', async () => {
    await nettoyer(win)
    // « THOMAS » n'est dans aucune catégorie : capitale initiale, rien de plus,
    // et le mot fini est recomposé d'un seul tenant
    await ecrire(win, 'THOMAS', { x: 170, ligne: 320 })
    await finDeMot(win)
    const texte = await luSurLaScene(win)
    return {
      statut: texte === 'Thomas' ? OK : KO,
      detail: `lu « ${await luParLaMachine(win)} » → scène « ${texte || '∅'} » (attendu « Thomas », jamais un autre mot)`,
    }
  })
}

if (veut('crie')) {
  await rapport.test(win, 's3-crie', 'Un mot court garde ses capitales (GG)', async () => {
    await nettoyer(win)
    await ecrire(win, 'GG', { x: 200, ligne: 320 })
    await finDeMot(win)
    const texte = await luSurLaScene(win)
    return {
      statut: texte === 'GG' ? OK : KO,
      detail: `lu « ${await luParLaMachine(win)} » → scène « ${texte || '∅'} » (attendu « GG », jamais « Gg »)`,
    }
  })
}

if (veut('prudence')) {
  await rapport.test(win, 's3-prudence', 'Un mot inconnu n’est JAMAIS détourné vers un mot du lexique', async () => {
    // LE péché mortel : afficher « Doran » quand le coach a écrit « ECRAN ».
    // Le critère est volontairement indulgent sur la LECTURE (une lettre peut
    // rester illisible) et intraitable sur le DÉTOURNEMENT : tout ce qui reste
    // à l'écran doit être fait de lettres réellement écrites, dans l'ordre.
    const cas = ['ECRAN', 'PIZZA', 'KEVIN']
    const vus = []
    let bons = 0
    for (const mot of cas) {
      await nettoyer(win)
      await ecrire(win, mot, { x: 170, ligne: 320 })
      await finDeMot(win)
      const texte = await luSurLaScene(win)
      const vu = texte.toUpperCase().replace(/[^A-Z0-9]/g, '')
      vus.push(`${mot}→${texte || '∅'}`)
      if (sousSuite(vu, mot)) bons++
    }
    return {
      statut: bons === cas.length ? OK : KO,
      detail: `${vus.join('  ')} — ${bons}/${cas.length} laissés intacts`,
    }
  })
}

if (veut('annuler')) {
  await rapport.test(win, 's3-annuler', 'Ctrl+Z rend le mot NON corrigé, un second les gribouillis', async (capturer) => {
    await nettoyer(win)
    await ecrire(win, 'WARD', { x: 200, ligne: 320 })
    await finDeMot(win)
    const corrige = await luSurLaScene(win)
    const apresCorrection = await compter(win)
    await win.keyboard.press('Control+z')
    await win.waitForTimeout(500)
    const rendu = await luSurLaScene(win)
    const apresUndo = await compter(win)
    await capturer('s3-annuler-1')
    await win.keyboard.press('Control+z')
    await win.waitForTimeout(700)
    const apresUndo2 = await compter(win)
    // 1er Ctrl+Z : un seul mot corrigé → les lettres séparées reviennent
    const rendLesLettres = apresCorrection.glyphes === 1 && apresUndo.glyphes > 1
    // 2e Ctrl+Z : une lettre redevient de l'encre
    const rendLEncre = apresUndo2.encre > apresUndo.encre
    return {
      statut: rendLesLettres && rendLEncre ? OK : KO,
      detail: `« ${corrige} » → ${apresUndo.glyphes} lettres (« ${rendu} ») → ${apresUndo2.encre} traits d'encre`,
    }
  })
}

if (veut('eteint')) {
  await rapport.test(win, 's3-eteint', 'L’interrupteur des réglages coupe vraiment le correcteur', async () => {
    await nettoyer(win)
    await win.evaluate(() => {
      const hw = window.__hw?.writing
      if (hw) hw.lexique = { actif: false, categories: [], perso: [] }
    })
    await ecrire(win, 'SYNDRA', { x: 170, ligne: 320 })
    await finDeMot(win)
    const texte = await luSurLaScene(win)
    // correcteur éteint : les lettres restent des capitales séparées
    const separees = await compter(win)
    await win.evaluate(() => {
      const hw = window.__hw?.writing
      if (hw) hw.lexique = { actif: true, categories: ['champions', 'jeu', 'francais', 'perso'], perso: [] }
    })
    return {
      statut: separees.glyphes > 1 && !texte.includes('Syndra') ? OK : KO,
      detail: `scène : « ${texte || '∅'} » en ${separees.glyphes} morceaux (aucune correction attendue)`,
    }
  })
}

process.stdout.write(rapport.tableau() + '\n')
await app.close()
process.exit(rapport.codeSortie)
