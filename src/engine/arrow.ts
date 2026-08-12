import { clamp } from './geometry'

/**
 * Géométrie de la flèche qui ÉPOUSE LE GESTE (§4.2.2).
 *
 * Le geste est capturé à main levée, comme au stylo. Ce module le transforme
 * en une flèche PLUS BELLE que le geste, sans jamais le trahir :
 *
 *   1. simplification Ramer-Douglas-Peucker, tolérance proportionnelle à
 *      l'échelle du geste — le tremblement de la souris disparaît ;
 *   2. si le geste est presque droit, il est redressé FRANCHEMENT : personne
 *      ne veut d'une flèche « presque droite » qui ondule ;
 *   3. sinon la courbure est conservée et légèrement ACCENTUÉE, pour un
 *      rendu volontaire — jamais au-delà d'une courbure raisonnable ;
 *   4. spline de Catmull-Rom centripète convertie en Bézier cubiques : la
 *      courbe finale est lisse, sans boucle ni rebroussement.
 *
 * Les gestes en S (double inflexion) traversent tout cela intacts : les
 * écarts sont mis à l'échelle SIGNE COMPRIS, jamais aplatis.
 *
 * Une seule implémentation sert le tracé direct, le retour visuel pendant le
 * geste, les formes intelligentes (stylo + crochet) et les flèches de liaison
 * du numéroteur.
 */

export interface Pt {
  x: number
  y: number
}

/** en deçà de ce rapport flèche/corde, le geste est considéré comme droit */
const STRAIGHT_RATIO = 0.04
/** accentuation de la courbure d'un geste franchement courbe */
const ACCENT = 1.16
/** courbure maximale tolérée après accentuation (fraction de la corde) */
const MAX_BOW = 0.42
/** longueur d'arc visée entre deux points de la courbe lissée */
const FLATTEN_STEP = 5
/** nombre maximal de points de la courbe finale (garde-fou de performance) */
const MAX_PTS = 160

/* ------------------------------------------------------------------ */
/*  Petites routines de polyligne — autonomes pour éviter tout cycle    */
/* ------------------------------------------------------------------ */

const len2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  return dx * dx + dy * dy
}

/** longueurs cumulées le long d'une polyligne */
export function cumLen(pts: Pt[]): number[] {
  const c = [0]
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  return c
}

/** longueur totale d'une polyligne */
export function pathLen(pts: Pt[]): number {
  const c = cumLen(pts)
  return c[c.length - 1]
}

/** supprime les points confondus (le lissage n'aime pas les doublons) */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (!q || len2(q.x, q.y, p.x, p.y) > 0.04) out.push({ x: p.x, y: p.y })
  }
  if (out.length === 1 && pts.length > 1) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y })
  return out
}

/** point situé à l'abscisse curviligne `d` sur la polyligne */
export function pointAtLen(pts: Pt[], cum: number[], d: number): Pt {
  const total = cum[cum.length - 1]
  const target = clamp(d, 0, total)
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] < target) continue
    const seg = cum[i] - cum[i - 1]
    const k = seg > 0 ? (target - cum[i - 1]) / seg : 0
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k }
  }
  return { ...pts[pts.length - 1] }
}

/** raccourcit une polyligne de `by` pixels à la fin */
export function trimEndBy(pts: Pt[], by: number): Pt[] {
  if (pts.length < 2) return pts
  const cum = cumLen(pts)
  const total = cum[cum.length - 1]
  const target = total - by
  if (target <= 0.5) return [pts[0], { ...pts[0] }]
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] < target) {
      out.push(pts[i])
      continue
    }
    out.push(pointAtLen(pts, cum, target))
    break
  }
  if (out.length < 2) out.push(pointAtLen(pts, cum, target))
  return out
}

/* ------------------------------------------------------------------ */
/*  1. Simplification Ramer-Douglas-Peucker                             */
/* ------------------------------------------------------------------ */

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const l2 = len2(a.x, a.y, b.x, b.y)
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2, 0, 1)
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)))
}

/**
 * Simplification RDP itérative (pile explicite : aucune récursion profonde
 * même sur un geste de plusieurs milliers de points).
 */
export function simplify(pts: Pt[], tol: number): Pt[] {
  const n = pts.length
  if (n < 3) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: number[][] = [[0, n - 1]]
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!
    let best = -1
    let bestD = tol
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpDist(pts[i], pts[i0], pts[i1])
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0) continue
    keep[best] = 1
    stack.push([i0, best], [best, i1])
  }
  const out: Pt[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i])
  return out
}

/* ------------------------------------------------------------------ */
/*  2. Mesure et accentuation de la courbure                            */
/* ------------------------------------------------------------------ */

/** écarts signés des points à la corde (repère : normale à la corde) */
function chordOffsets(pts: Pt[]): { off: number[]; nx: number; ny: number; chord: number } {
  const a = pts[0]
  const b = pts[pts.length - 1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const chord = Math.hypot(dx, dy)
  if (chord < 0.001) return { off: pts.map(() => 0), nx: 0, ny: 0, chord: 0 }
  const nx = -dy / chord
  const ny = dx / chord
  return { off: pts.map((p) => (p.x - a.x) * nx + (p.y - a.y) * ny), nx, ny, chord }
}

/** flèche du geste (écart maximal à la corde), en fraction de la corde */
export function bowRatio(pts: Pt[]): number {
  if (pts.length < 3) return 0
  const { off, chord } = chordOffsets(pts)
  if (chord < 0.001) return 1
  let m = 0
  for (const o of off) m = Math.max(m, Math.abs(o))
  return m / chord
}

/**
 * Accentue légèrement la courbure : les écarts à la corde sont multipliés,
 * SIGNE COMPRIS — un S reste un S, et les deux ventres grossissent ensemble.
 * L'accentuation s'annule d'elle-même sur un geste déjà très courbé : elle
 * ne peut jamais pousser la flèche au-delà de MAX_BOW, ni écraser un geste
 * qui dépassait déjà ce seuil de son plein gré.
 */
function accentuate(pts: Pt[], k0: number): Pt[] {
  const n = pts.length
  if (n < 3) return pts
  const { off, nx, ny, chord } = chordOffsets(pts)
  if (chord < 0.001) return pts
  let maxAbs = 0
  for (const o of off) maxAbs = Math.max(maxAbs, Math.abs(o))
  if (maxAbs < 0.01) return pts
  const cap = Math.max(maxAbs, chord * MAX_BOW)
  const k = Math.min(k0, cap / maxAbs)
  if (k <= 1.0001) return pts
  return pts.map((p, i) =>
    i === 0 || i === n - 1 ? p : { x: p.x + nx * off[i] * (k - 1), y: p.y + ny * off[i] * (k - 1) },
  )
}

/* ------------------------------------------------------------------ */
/*  3. Lissage : Catmull-Rom centripète → Bézier cubiques               */
/* ------------------------------------------------------------------ */

function bezierPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/**
 * Spline de Catmull-Rom CENTRIPÈTE (alpha = 0,5) : contrairement à la
 * version uniforme, elle ne fabrique jamais de boucle ni de rebroussement
 * quand deux points de contrôle sont proches — exactement ce qu'il faut
 * pour un geste tracé à la souris.
 */
export function smoothCurve(ctrl: Pt[]): Pt[] {
  const n = ctrl.length
  if (n < 3) return ctrl.slice()
  const out: Pt[] = [ctrl[0]]
  let budget = MAX_PTS
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[i === 0 ? 0 : i - 1]
    const p1 = ctrl[i]
    const p2 = ctrl[i + 1]
    const p3 = ctrl[i + 2 <= n - 1 ? i + 2 : n - 1]
    const d1 = Math.pow(Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), 0.001), 0.5)
    const d2 = Math.pow(Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), 0.001), 0.5)
    const d3 = Math.pow(Math.max(Math.hypot(p3.x - p2.x, p3.y - p2.y), 0.001), 0.5)
    // conversion Catmull-Rom → Bézier (Yuksel & al.)
    const b1 = {
      x: (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) / (3 * d1 * (d1 + d2)),
      y: (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) / (3 * d1 * (d1 + d2)),
    }
    const b2 = {
      x: (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) / (3 * d3 * (d3 + d2)),
      y: (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) / (3 * d3 * (d3 + d2)),
    }
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const steps = clamp(Math.round(segLen / FLATTEN_STEP), 2, Math.max(2, Math.min(28, budget)))
    budget -= steps
    for (let s = 1; s <= steps; s++) out.push(bezierPoint(p1, b1, b2, p2, s / steps))
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  4. Embellissement — le point d'entrée unique                        */
/* ------------------------------------------------------------------ */

/**
 * Transforme un geste brut en courbe de flèche élégante.
 * `straight` (Shift maintenu) : segment parfaitement droit du premier au
 * dernier point, sans détour par le lissage.
 */
export function beautifyArrow(raw: Pt[], straight = false): Pt[] {
  const pts = dedupe(raw)
  if (pts.length < 2) return pts
  const a = pts[0]
  const b = pts[pts.length - 1]
  if (straight) return [a, b]
  const chord = Math.hypot(b.x - a.x, b.y - a.y)
  const total = pathLen(pts)
  // geste minuscule : rien à embellir
  if (total < 6) return [a, b]
  // Tolérance proportionnelle à l'échelle du geste : un grand geste tolère un
  // grand nettoyage, un petit garde ses détails. Le plafond est GÉNÉREUX à
  // dessein — une main qui tremble sur un geste d'un mètre écarte facilement
  // dix pixels, et 2 % d'un grand geste reste invisible à l'œil.
  const tol = clamp(Math.max(chord, total * 0.5) * 0.02, 1.5, 16)
  const ctrl = simplify(pts, tol)
  if (ctrl.length < 3) return [a, b]
  // presque droit → franchement droit (§2.c)
  if (chord > 1 && bowRatio(ctrl) < STRAIGHT_RATIO) return [a, b]
  return smoothCurve(accentuate(ctrl, ACCENT))
}

/* ------------------------------------------------------------------ */
/*  5. Habillage : corps fuselé et pointe aux ailerons incurvés         */
/* ------------------------------------------------------------------ */

/** longueur de la pointe d'une flèche — partagée par TOUTES les flèches */
export const arrowHeadLen = (size: number): number => clamp(size * 4.4, 15, 58)

/** demi-largeur du corps : queue affinée, épaississement vers la pointe */
const halfWidth = (size: number, t: number): number => (size * (0.38 + 0.82 * Math.pow(t, 0.6))) / 2

/** profondeur d'implantation de la pointe sur le corps (échancrure) */
const HEAD_NOTCH = 0.42
/** demi-envergure de la pointe, en fraction de sa longueur */
const HEAD_SPREAD = 0.46

export interface ArrowGeom {
  /** courbe embellie complète, de la queue à la pointe */
  curve: Pt[]
  /** fût seul (s'arrête à l'échancrure de la pointe) — halos et ombre portée */
  body: Pt[]
  /** contour fermé corps + pointe, d'un seul tenant : à remplir tel quel */
  outline: Pt[]
  /** contour de la pointe seule — halos de la pointe */
  head: Pt[]
  tip: Pt
  /** tangente de la courbe à son extrémité (radians) */
  angle: number
  headLen: number
}

/**
 * Tangente de la courbe à son extrémité. Surtout PAS la corde départ→arrivée :
 * sur une flèche courbe, la pointe doit sortir dans le sens du geste.
 * Mesurée sur les derniers pixels seulement, mais assez pour ignorer le bruit.
 */
export function endAngle(pts: Pt[], span = 9): number {
  const n = pts.length
  if (n < 2) return 0
  const cum = cumLen(pts)
  const total = cum[cum.length - 1]
  const back = pointAtLen(pts, cum, Math.max(0, total - Math.min(span, total * 0.9)))
  const last = pts[n - 1]
  const dx = last.x - back.x
  const dy = last.y - back.y
  if (Math.hypot(dx, dy) < 0.001) return Math.atan2(last.y - pts[0].y, last.x - pts[0].x)
  return Math.atan2(dy, dx)
}

/** normales moyennées d'une polyligne (aucune pointe parasite dans les virages) */
function normals(pts: Pt[]): Pt[] {
  const n = pts.length
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let dx = b.x - a.x
    let dy = b.y - a.y
    const l = Math.hypot(dx, dy)
    if (l < 0.001) {
      dx = 1
      dy = 0
    } else {
      dx /= l
      dy /= l
    }
    out.push({ x: -dy, y: dx })
  }
  return out
}

/**
 * Pointe de flèche aux ailerons légèrement INCURVÉS (concaves) : c'est ce
 * galbe qui distingue une flèche dessinée d'un triangle posé. Rendue dans le
 * repère de la tangente, échancrée à l'arrière pour que le corps s'y implante
 * sans trou ni chevauchement.
 */
/** quadratique dont le point de contrôle est écarté de la corde : l'arête se
 *  galbe au lieu d'être un bête segment. Rend les points SANS le premier. */
function bowArc(from: Pt, to: Pt, bow: number, steps = 7): Pt[] {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const l = Math.hypot(dx, dy) || 1
  const cx = mx + (-dy / l) * bow
  const cy = my + (dx / l) * bow
  const out: Pt[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push({
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
    })
  }
  return out
}

/** points remarquables d'une pointe, dans le repère de la tangente */
function headAnchors(tip: Pt, ang: number, size: number, scale: number) {
  const hl = arrowHeadLen(size) * scale
  const hw = hl * HEAD_SPREAD
  const cs = Math.cos(ang)
  const sn = Math.sin(ang)
  // repère local : u vers la pointe, v perpendiculaire
  const loc = (u: number, v: number): Pt => ({ x: tip.x + cs * u - sn * v, y: tip.y + sn * u + cs * v })
  return {
    hl,
    tip: loc(0, 0),
    barbL: loc(-hl, hw),
    barbR: loc(-hl, -hw),
    notch: loc(-hl * HEAD_NOTCH, 0),
    bow: hl * 0.1,
  }
}

export function headOutline(tip: Pt, ang: number, size: number, scale: number): Pt[] {
  const a = headAnchors(tip, ang, size, scale)
  return [
    a.tip,
    ...bowArc(a.tip, a.barbL, -a.bow),
    ...bowArc(a.barbL, a.notch, -a.bow * 0.35),
    ...bowArc(a.notch, a.barbR, -a.bow * 0.35),
    ...bowArc(a.barbR, a.tip, -a.bow),
  ]
}

/**
 * Ailerons SEULS, en chaîne ouverte, du bord gauche du fût au bord droit.
 * C'est cette chaîne — et non la pointe fermée — qu'on greffe sur le contour
 * du corps : un contour fermé inséré au milieu d'un autre se retournerait
 * contre lui-même et creuserait la pointe.
 */
function headWings(tip: Pt, ang: number, size: number, scale: number, joinL: Pt, joinR: Pt): Pt[] {
  const a = headAnchors(tip, ang, size, scale)
  return [
    ...bowArc(joinL, a.barbL, -a.bow * 0.35, 3),
    ...bowArc(a.barbL, a.tip, a.bow),
    ...bowArc(a.tip, a.barbR, a.bow),
    ...bowArc(a.barbR, joinR, -a.bow * 0.35, 3),
  ]
}

/**
 * Géométrie complète d'une flèche à partir de sa courbe embellie.
 * `headScale` porte le pop élastique de la pointe (§4.2.1).
 *
 * Le corps et la pointe forment UN SEUL contour fermé : le remplissage est
 * d'un seul tenant, donc la jonction est invisible — ni trou, ni surbrillance
 * de recouvrement.
 */
export function arrowGeom(curve: Pt[], size: number, headScale = 1): ArrowGeom {
  const pts = dedupe(curve)
  const tip = pts[pts.length - 1] ?? { x: 0, y: 0 }
  const angle = endAngle(pts)
  const k = Math.max(headScale, 0.001)
  const hl = arrowHeadLen(size) * k
  const head = headOutline(tip, angle, size, k)
  if (pts.length < 2) return { curve: pts, body: pts, outline: head, head, tip, angle, headLen: hl }
  // le fût s'arrête au creux de l'échancrure : le contour se referme dessus
  const body = trimEndBy(pts, hl * HEAD_NOTCH)
  const nrm = normals(body)
  const cum = cumLen(body)
  const total = cum[cum.length - 1] || 1
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < body.length; i++) {
    const w = halfWidth(size, cum[i] / total)
    left.push({ x: body[i].x + nrm[i].x * w, y: body[i].y + nrm[i].y * w })
    right.push({ x: body[i].x - nrm[i].x * w, y: body[i].y - nrm[i].y * w })
  }
  // contour d'un seul tenant : flanc gauche → ailerons → flanc droit en retour
  const wings = headWings(tip, angle, size, k, left[left.length - 1], right[right.length - 1])
  const outline = [...left, ...wings, ...right.reverse()]
  return { curve: pts, body, outline, head, tip, angle, headLen: hl }
}
