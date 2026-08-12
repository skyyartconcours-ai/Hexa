import type { StrokePoint } from './types'
import { clamp, dist, pointToSegment } from './geometry'
import { cumulative, resample } from './shapes'
import type { Pt } from './shapes'

/**
 * Formes intelligentes (§4.1) — LA différence avec Epic Pen.
 * L'utilisateur dessine à main levée, l'outil redresse.
 *
 * Philosophie des seuils : PRUDENTS. Dans le doute on ne transforme pas.
 * Un faux positif détruit la confiance, un faux négatif ne coûte rien
 * (le trait reste un beau trait au stylo).
 */

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'arrow'

export interface Recognition {
  kind: ShapeKind
  /** line : [a, b] · rect/ellipse : [coin, coin opposé] · arrow : fût (2 pts si droit, polyligne si courbe) */
  points: Pt[]
  closed: boolean
}

interface Bbox {
  x: number
  y: number
  w: number
  h: number
}

const DEG = 180 / Math.PI

function bboxOf(pts: Pt[]): Bbox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function pathLength(pts: Pt[]): number {
  const c = cumulative(pts)
  return c[c.length - 1]
}

/** écart maximal des points à la corde [premier, dernier] */
function chordDeviation(pts: Pt[]): number {
  const a = pts[0]
  const b = pts[pts.length - 1]
  let max = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegment(pts[i].x, pts[i].y, a.x, a.y, b.x, b.y)
    if (d > max) max = d
  }
  return max
}

/** Ramer-Douglas-Peucker */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return [...pts]
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!
    let idx = -1
    let max = eps
    for (let i = i0 + 1; i < i1; i++) {
      const d = pointToSegment(pts[i].x, pts[i].y, pts[i0].x, pts[i0].y, pts[i1].x, pts[i1].y)
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (idx >= 0) {
      keep[idx] = 1
      stack.push([i0, idx], [idx, i1])
    }
  }
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i])
  return out
}

/** angle intérieur au sommet b, en degrés (0 = repli complet, 180 = aligné) */
function cornerAngle(a: Pt, b: Pt, c: Pt): number {
  const ax = a.x - b.x
  const ay = a.y - b.y
  const cx = c.x - b.x
  const cy = c.y - b.y
  const na = Math.hypot(ax, ay)
  const nc = Math.hypot(cx, cy)
  if (na < 0.001 || nc < 0.001) return 180
  return Math.acos(clamp((ax * cx + ay * cy) / (na * nc), -1, 1)) * DEG
}

/** écart d'une direction à l'axe horizontal ou vertical le plus proche, en degrés */
function axisDeviation(a: Pt, b: Pt): number {
  let d = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * DEG) % 180
  if (d > 90) d = 180 - d
  return Math.min(d, Math.abs(90 - d))
}

/* ------------------------------------------------------------------ */

function asRect(pts: Pt[], bb: Bbox, diag: number): Recognition | null {
  const loop = [...pts, pts[0]]
  let corners = simplify(loop, clamp(diag * 0.055, 4, 18))
  corners = corners.slice(0, -1) // on retire la fermeture
  // le geste peut démarrer au milieu d'un côté : on supprime le sommet le plus plat
  if (corners.length === 5) {
    let flat = -1
    let best = 155
    for (let i = 0; i < 5; i++) {
      const a = cornerAngle(corners[(i + 4) % 5], corners[i], corners[(i + 1) % 5])
      if (a > best) {
        best = a
        flat = i
      }
    }
    if (flat < 0) return null
    corners = corners.filter((_, i) => i !== flat)
  }
  if (corners.length !== 4) return null
  for (let i = 0; i < 4; i++) {
    const a = cornerAngle(corners[(i + 3) % 4], corners[i], corners[(i + 1) % 4])
    if (a < 66 || a > 114) return null
    const side = dist(corners[i].x, corners[i].y, corners[(i + 1) % 4].x, corners[(i + 1) % 4].y)
    if (side < 22) return null
    if (axisDeviation(corners[i], corners[(i + 1) % 4]) > 16) return null
  }
  return {
    kind: 'rect',
    points: [
      { x: bb.x, y: bb.y },
      { x: bb.x + bb.w, y: bb.y + bb.h },
    ],
    closed: true,
  }
}

function asEllipse(pts: Pt[], bb: Bbox): Recognition | null {
  const rx = bb.w / 2
  const ry = bb.h / 2
  if (rx < 14 || ry < 14) return null
  if (Math.max(rx, ry) / Math.min(rx, ry) > 4.5) return null
  const cx = bb.x + rx
  const cy = bb.y + ry
  // rayon normalisé : ~1 partout sur une vraie ellipse
  const sample = resample(pts, 48, true)
  let sum = 0
  const rs: number[] = []
  for (const p of sample) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
    rs.push(r)
    sum += r
  }
  const mean = sum / rs.length
  if (mean < 0.88 || mean > 1.12) return null
  let v = 0
  for (const r of rs) v += (r - mean) * (r - mean)
  const cv = Math.sqrt(v / rs.length) / mean
  // un rectangle donne cv ≈ 0.10, un cercle à main levée ≈ 0.03 : 0.075 est prudent
  if (cv > 0.075) return null
  return {
    kind: 'ellipse',
    points: [
      { x: bb.x, y: bb.y },
      { x: bb.x + bb.w, y: bb.y + bb.h },
    ],
    closed: true,
  }
}

function asLine(pts: Pt[]): Recognition | null {
  const a = pts[0]
  const b = pts[pts.length - 1]
  const chord = dist(a.x, a.y, b.x, b.y)
  if (chord < 55) return null
  if (chordDeviation(pts) / chord > 0.045) return null
  return { kind: 'line', points: [a, b], closed: false }
}

/**
 * Flèche : un fût, puis un CROCHET net qui revient en arrière (la barbe).
 * On exige un repli marqué (95°–178°) et un fût au moins 2,2× plus long
 * que le crochet : une coche « ✓ » ou un « V » ne passent pas.
 */
function asArrow(pts: Pt[], total: number): Recognition | null {
  const cum = cumulative(pts)
  const n = pts.length
  const minHook = Math.max(14, total * 0.06)
  const maxHook = Math.min(total * 0.3, 150)
  let bestIdx = -1
  let bestTurn = 0
  for (let i = 2; i < n - 2; i++) {
    const hook = total - cum[i]
    if (hook < minHook || hook > maxHook) continue
    // directions sur ~22 px de part et d'autre du sommet : au-delà du bruit
    // de la main, en deçà de la courbure générale du geste
    let j = i
    while (j > 0 && cum[i] - cum[j] < 22) j--
    let k = i
    while (k < n - 1 && cum[k] - cum[i] < 22) k++
    if (j === i || k === i) continue
    const inAng = Math.atan2(pts[i].y - pts[j].y, pts[i].x - pts[j].x)
    const outAng = Math.atan2(pts[k].y - pts[i].y, pts[k].x - pts[i].x)
    let turn = Math.abs((outAng - inAng) * DEG) % 360
    if (turn > 180) turn = 360 - turn
    if (turn > bestTurn) {
      bestTurn = turn
      bestIdx = i
    }
  }
  // un vrai crochet de flèche revient nettement en arrière (95° à 179°) :
  // une coche « ✓ » ou un « V » tournent beaucoup moins et sont rejetés
  if (bestIdx < 0 || bestTurn < 95 || bestTurn > 179) return null
  const shaft = pts.slice(0, bestIdx + 1)
  const hookLen = total - cum[bestIdx]
  const shaftLen = cum[bestIdx]
  if (shaftLen < 46 || shaftLen < hookLen * 2.2) return null
  const chord = dist(shaft[0].x, shaft[0].y, shaft[shaft.length - 1].x, shaft[shaft.length - 1].y)
  if (chord < 40) return null
  // fût quasi droit → flèche droite ; sinon la flèche épouse la courbe (§4.2.2)
  if (chordDeviation(shaft) / chord < 0.05) {
    return { kind: 'arrow', points: [shaft[0], shaft[shaft.length - 1]], closed: false }
  }
  if (chordDeviation(shaft) / chord > 0.55) return null // gribouillis : on ne touche pas
  return { kind: 'arrow', points: resample(shaft, 18, false), closed: false }
}

/* ------------------------------------------------------------------ */

/** Reconnaît une forme dans un tracé au stylo, ou null si le doute subsiste. */
export function recognize(raw: StrokePoint[]): Recognition | null {
  if (raw.length < 10) return null
  const pts: Pt[] = raw.map((p) => ({ x: p.x, y: p.y }))
  const total = pathLength(pts)
  const bb = bboxOf(pts)
  const diag = Math.hypot(bb.w, bb.h)
  if (total < 70 || diag < 38) return null

  const gap = dist(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y)
  const closed =
    total > 150 &&
    bb.w > 26 &&
    bb.h > 26 &&
    gap < Math.min(total * 0.22, Math.max(30, diag * 0.36))

  if (closed) {
    return asRect(pts, bb, diag) ?? asEllipse(pts, bb)
  }
  return asArrow(pts, total) ?? asLine(pts)
}
