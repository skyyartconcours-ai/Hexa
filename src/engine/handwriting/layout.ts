/**
 * Hexa — segmentation d'une volée de traits en lettres, mots et lignes.
 *
 * C'est la moitié invisible de la magie : le reconnaisseur ne sait lire
 * qu'UNE lettre à la fois, encore faut-il savoir où elle commence et où
 * elle finit. On regroupe donc les traits par proximité TEMPORELLE (on ne
 * revient pas sur une lettre trois secondes plus tard) et SPATIALE
 * (recouvrement horizontal rapporté à la hauteur de capitale estimée).
 *
 * Le regroupement gère nativement les lettres à plusieurs traits — i, j, t,
 * x, E, F, H, A — puisqu'un trait qui chevauche le groupe courant le
 * rejoint au lieu d'ouvrir une lettre.
 */
import type { Stroke } from '../types'
import type { TplPoint } from './templates'

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Letter {
  strokes: Stroke[]
  box: Box
  /** sous-tracés bruts, prêts pour le reconnaisseur */
  paths: TplPoint[][]
  t0: number
  t1: number
}

export interface Word {
  letters: Letter[]
  box: Box
  /** hauteur de capitale estimée sur le mot */
  capHeight: number
  /** ligne de base estimée (médiane des bas de lettres) */
  baseline: number
  /** inclinaison de l'écriture, en tangente (0 = droit, 0.2 ≈ 11°) */
  slant: number
}

/** Écart de temps maximal entre deux traits d'une même lettre. */
export const LETTER_GAP_MS = 1200

export const width = (b: Box): number => b.x1 - b.x0
export const height = (b: Box): number => b.y1 - b.y0

export function boxOf(pts: { x: number; y: number }[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

export function merge(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))
  return s[i]
}

/**
 * Hauteur de capitale : le 78ᵉ centile des hauteurs de traits. La médiane
 * serait trompée par les barres horizontales (le « t », le « E »), le
 * maximum par un jambage isolé.
 */
function estimateCap(boxes: Box[]): number {
  const hs = boxes.map(height).filter((h) => h > 1)
  if (hs.length === 0) return 24
  return Math.max(12, quantile(hs, 0.78))
}

/** Inclinaison moyenne des fûts quasi verticaux (tangente, signe = vers la droite). */
export function estimateSlant(strokes: Stroke[], cap: number): number {
  let sx = 0
  let sy = 0
  const minLen = cap * 0.22
  for (const s of strokes) {
    const p = s.points
    for (let i = 1; i < p.length; i++) {
      let dx = p[i].x - p[i - 1].x
      let dy = p[i].y - p[i - 1].y
      if (Math.hypot(dx, dy) < minLen * 0.35) continue
      if (Math.abs(dy) < Math.abs(dx) * 1.25) continue
      if (dy < 0) {
        dx = -dx
        dy = -dy
      }
      sx += dx
      sy += dy
    }
  }
  if (sy < minLen) return 0
  const tan = sx / sy
  // on n'incline que si le geste est franchement penché, et jamais au-delà de 20°
  if (Math.abs(tan) < 0.08) return 0
  return Math.max(-0.36, Math.min(0.36, tan))
}

export interface Group {
  strokes: Stroke[]
  box: Box
  t0: number
  t1: number
}

/**
 * Le trait `s` peut-il rejoindre le groupe `g` pour former une seule lettre ?
 *
 * Deux conditions, et c'est tout l'art de la segmentation en direct : le
 * CHEVAUCHEMENT HORIZONTAL (la barre du A repasse au-dessus des deux jambes)
 * et la PROXIMITÉ TEMPORELLE (on ne revient pas sur une lettre trois secondes
 * plus tard). Le garde-fou de taille interdit à une lettre de s'étaler :
 * sans lui, un mot entier finirait dans un seul groupe.
 *
 * `maxGap` remplace l'écart temporel par défaut (le rattrapage d'une lettre
 * déjà transformée s'accorde une fenêtre plus courte).
 */
export function joins(
  g: Group,
  sBox: Box,
  sT0: number,
  cap: number,
  maxGap = LETTER_GAP_MS,
): boolean {
  if (sT0 - g.t1 > maxGap) return false
  const u = merge(g.box, sBox)
  // une lettre ne s'étale pas beaucoup plus haut qu'une capitale
  if (height(u) > cap * 1.55) return false

  const overlap = Math.min(g.box.x1, sBox.x1) - Math.max(g.box.x0, sBox.x0)
  const minW = Math.min(width(g.box), width(sBox))
  // (a) franc chevauchement horizontal : la barre du A, du E, du H, la
  //     seconde panse du B — le trait repasse au-dessus de ce qui est déjà là
  if (width(u) <= cap * 1.3 && overlap > 0.34 * Math.max(minW, cap * 0.1)) return true

  // (b) l'ensemble reste AUSSI ÉTROIT QU'UNE SEULE CAPITALE et les deux
  //     traits couvrent la même bande verticale. Sans cette règle, un H (deux
  //     fûts qui ne se touchent ni ne se chevauchent), un Y, un V, un X, un K
  //     ou un N en trois traits partiraient en morceaux. Le garde-fou de
  //     largeur est ici beaucoup plus serré qu'en (a), car c'est lui seul qui
  //     empêche deux lettres voisines et jointives de fusionner : deux
  //     capitales côte à côte occupent au moins 1,3 cap.
  const vOver = Math.min(g.box.y1, sBox.y1) - Math.max(g.box.y0, sBox.y0)
  const minH = Math.min(height(g.box), height(sBox))
  if (width(u) <= cap * 1.02 && vOver > 0.45 * Math.max(minH, cap * 0.1)) return true

  // (c) l'un des deux est un trait ÉTROIT (le fût du T, le point du J, le
  //     fût du F) posé à l'aplomb de l'autre. La règle est symétrique : la
  //     barre du F arrive après son fût, le fût du T arrive après sa barre —
  //     et dans les deux cas c'est la même lettre.
  if (width(u) <= cap * 1.3) {
    const thin = width(sBox) <= width(g.box) ? sBox : g.box
    const wide = thin === sBox ? g.box : sBox
    const cx = (thin.x0 + thin.x1) / 2
    if (width(thin) < cap * 0.55 && cx > wide.x0 - cap * 0.14 && cx < wide.x1 + cap * 0.14) {
      return true
    }
  }
  return false
}

/** Regroupe les traits en lettres (ordre chronologique, fusion à la volée). */
function groupLetters(strokes: Stroke[], cap: number): Group[] {
  const groups: Group[] = []
  for (const s of strokes) {
    const box = boxOf(s.points)
    const t0 = s.startedAt
    const t1 = s.endedAt ?? s.startedAt
    let target: Group | null = null
    // on ne regarde que les deux derniers groupes : on revient parfois pointer
    // un « i » après avoir écrit la lettre suivante, jamais après cinq lettres
    for (let k = groups.length - 1; k >= Math.max(0, groups.length - 2); k--) {
      if (joins(groups[k], box, t0, cap)) {
        target = groups[k]
        break
      }
    }
    if (target) {
      target.strokes.push(s)
      target.box = merge(target.box, box)
      target.t0 = Math.min(target.t0, t0)
      target.t1 = Math.max(target.t1, t1)
    } else {
      groups.push({ strokes: [s], box, t0, t1 })
    }
  }
  return groups
}

function toLetter(g: Group): Letter {
  return {
    strokes: g.strokes,
    box: g.box,
    paths: g.strokes.map((s) => s.points.map((p) => ({ x: p.x, y: p.y }))),
    t0: g.t0,
    t1: g.t1,
  }
}

function makeWord(letters: Letter[], cap: number): Word {
  let box = letters[0].box
  for (const l of letters) box = merge(box, l.box)
  const bottoms = letters.map((l) => l.box.y1)
  const strokes = letters.flatMap((l) => l.strokes)
  const localCap = Math.max(cap * 0.7, quantile(letters.map((l) => height(l.box)), 0.8))
  return {
    letters,
    box,
    capHeight: localCap,
    baseline: quantile(bottoms, 0.5),
    slant: estimateSlant(strokes, localCap),
  }
}

/**
 * Segmente une volée de traits en mots (regroupés par ligne, puis par
 * espacement horizontal). Les mots sont rendus dans l'ordre de lecture.
 */
export function segment(strokes: Stroke[]): Word[] {
  const usable = strokes.filter((s) => s.points.length > 1)
  if (usable.length === 0) return []
  const ordered = [...usable].sort((a, b) => a.startedAt - b.startedAt)
  const cap = estimateCap(ordered.map((s) => boxOf(s.points)))

  const letters = groupLetters(ordered, cap).map(toLetter)

  // --- lignes : regroupement vertical par centre de boîte ---
  const byY = [...letters].sort((a, b) => (a.box.y0 + a.box.y1) / 2 - (b.box.y0 + b.box.y1) / 2)
  const lines: Letter[][] = []
  let line: Letter[] = []
  let lineY = 0
  for (const l of byY) {
    const yc = (l.box.y0 + l.box.y1) / 2
    if (line.length === 0) {
      line = [l]
      lineY = yc
      continue
    }
    if (Math.abs(yc - lineY) < cap * 0.66) {
      line.push(l)
      lineY = (lineY * (line.length - 1) + yc) / line.length
    } else {
      lines.push(line)
      line = [l]
      lineY = yc
    }
  }
  if (line.length > 0) lines.push(line)

  // --- mots : coupure quand l'espace dépasse ~0,38 hauteur de capitale ---
  const words: Word[] = []
  for (const ln of lines) {
    const sorted = [...ln].sort((a, b) => a.box.x0 - b.box.x0)
    let cur: Letter[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].box.x0 - cur[cur.length - 1].box.x1
      if (gap > cap * 0.38) {
        words.push(makeWord(cur, cap))
        cur = [sorted[i]]
      } else {
        cur.push(sorted[i])
      }
    }
    words.push(makeWord(cur, cap))
  }
  return words
}
