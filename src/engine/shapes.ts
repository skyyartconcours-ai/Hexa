import type { Stroke } from './types'
import { clamp, dist, easeOutCubic, lerp, rgba, whiteMix } from './geometry'
import { arrowGeom, headOutline } from './arrow'
import { coreMix, needsCoreFix } from './ink-fx'

/**
 * Formes vectorielles de Hexa : rectangles, ellipses, flèches courbes,
 * polylignes néon et morph animé (§4.1.5 du brief).
 *
 * Tout est rendu avec la MÊME recette néon en trois passes que render.ts
 * (halo large additif + halo serré + cœur blanchi), pour que rien ne jure.
 */

/** part de blanc dans le cœur des traits néon — dupliqué depuis render.ts
 *  volontairement, pour éviter un cycle d'import à l'exécution */
const CORE = 0.62

export interface Pt {
  x: number
  y: number
}

/** sous-ensemble de RenderState nécessaire aux formes */
export interface ShapeState {
  alpha: number
  glowBoost: number
  now: number
}

/** ressort doux avec un léger dépassement — l'ADN des animations Hexa */
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/* ------------------------------------------------------------------ */
/*  Recette néon générique                                             */
/* ------------------------------------------------------------------ */

/** trois passes : halo large additif, halo serré, cœur blanchi */
export function neonStroke(
  ctx: CanvasRenderingContext2D,
  trace: (c: CanvasRenderingContext2D) => void,
  color: string,
  size: number,
  alpha: number,
  glow: number,
): void {
  if (alpha <= 0.003) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const pass = (w: number, style: string) => {
    ctx.strokeStyle = style
    ctx.lineWidth = w
    trace(ctx)
    ctx.stroke()
  }
  pass(size * 3.6, rgba(color, 0.13 * alpha * glow))
  pass(size * 1.9, rgba(color, 0.3 * alpha * glow))
  pass(size, whiteMix(color, CORE, 0.95 * alpha))
  ctx.restore()
}

/** trace une polyligne lissée (milieux de segments en quadratiques) */
export function tracePoly(ctx: CanvasRenderingContext2D, pts: Pt[], closed: boolean): void {
  const n = pts.length
  ctx.beginPath()
  if (n === 0) return
  if (n < 3) {
    ctx.moveTo(pts[0].x, pts[0].y)
    ctx.lineTo(pts[n - 1].x + (n === 1 ? 0.01 : 0), pts[n - 1].y)
    return
  }
  if (closed) {
    const m0 = mid(pts[n - 1], pts[0])
    ctx.moveTo(m0.x, m0.y)
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const m = mid(a, b)
      ctx.quadraticCurveTo(a.x, a.y, m.x, m.y)
    }
    ctx.closePath()
    return
  }
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
  }
  ctx.lineTo(pts[n - 1].x, pts[n - 1].y)
}

/** rectangle à coins arrondis, tracé à la main (arcTo) pour rester portable */
export function traceRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = clamp(r, 0, Math.min(w, h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/* ------------------------------------------------------------------ */
/*  Rectangle et ellipse                                               */
/* ------------------------------------------------------------------ */

export interface Box {
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

/** boîte d'une forme à deux points (premier et dernier point du tracé) */
export function shapeBox(s: Stroke): Box {
  const a = s.points[0]
  const b = s.points[s.points.length - 1]
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

/** contrainte Shift : carré / cercle parfait, dans le quadrant du geste */
export function squarify(a: Pt, b: Pt): Pt {
  const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  return {
    x: a.x + Math.sign(b.x - a.x || 1) * d,
    y: a.y + Math.sign(b.y - a.y || 1) * d,
  }
}

export function renderShape(ctx: CanvasRenderingContext2D, s: Stroke, st: ShapeState): void {
  const b = shapeBox(s)
  if (b.w < 0.5 && b.h < 0.5) return
  // apparition : très léger ressort depuis le centre
  let k = 1
  if (s.anim) {
    const t = clamp((st.now - s.anim.start) / s.anim.duration, 0, 1)
    k = lerp(0.93, 1, easeOutBack(t))
  }
  const w = b.w * k
  const h = b.h * k
  const x = b.cx - w / 2
  const y = b.cy - h / 2
  const r = Math.min(16, Math.min(w, h) * 0.14)
  const trace = (c: CanvasRenderingContext2D) => {
    if (s.tool === 'ellipse') {
      c.beginPath()
      c.ellipse(b.cx, b.cy, Math.max(w / 2, 0.1), Math.max(h / 2, 0.1), 0, 0, Math.PI * 2)
    } else {
      traceRoundRect(c, x, y, w, h, r)
    }
  }
  if (s.filled) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = rgba(s.color, 0.18 * st.alpha)
    trace(ctx)
    ctx.fill()
    ctx.restore()
  }
  neonStroke(ctx, trace, s.color, s.size, st.alpha, st.glowBoost)
}

/** hit-test sur le PÉRIMÈTRE (ou l'intérieur si la forme est remplie) */
export function hitShape(s: Stroke, x: number, y: number, pad: number): boolean {
  const b = shapeBox(s)
  if (s.tool === 'ellipse') {
    const rx = Math.max(b.w / 2, 1)
    const ry = Math.max(b.h / 2, 1)
    const r = Math.hypot((x - b.cx) / rx, (y - b.cy) / ry)
    if (s.filled && r <= 1) return true
    return Math.abs(r - 1) * Math.min(rx, ry) < pad
  }
  const inX = x > b.x - pad && x < b.x + b.w + pad
  const inY = y > b.y - pad && y < b.y + b.h + pad
  if (!inX || !inY) return false
  if (s.filled) return true
  const nearV = Math.abs(x - b.x) < pad || Math.abs(x - (b.x + b.w)) < pad
  const nearH = Math.abs(y - b.y) < pad || Math.abs(y - (b.y + b.h)) < pad
  return nearV || nearH
}

/* ------------------------------------------------------------------ */
/*  Flèches courbes (§4.2.2) et pointe à pop élastique (§4.2.1)        */
/* ------------------------------------------------------------------ */

/** longueurs cumulées d'une polyligne */
export function cumulative(pts: Pt[]): number[] {
  const c = [0]
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y))
  return c
}

/** portion d'une polyligne, de 0 à la fraction t de sa longueur */
export function partialPoly(pts: Pt[], t: number): Pt[] {
  if (t >= 1) return pts
  const cum = cumulative(pts)
  const total = cum[cum.length - 1]
  if (total <= 0) return [pts[0]]
  const target = total * clamp(t, 0, 1)
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= target) {
      out.push(pts[i])
      continue
    }
    const seg = cum[i] - cum[i - 1]
    const k = seg > 0 ? (target - cum[i - 1]) / seg : 0
    out.push({ x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) })
    break
  }
  return out
}

/** raccourcit la polyligne de `by` pixels à la fin (place pour la pointe) */
export function trimEnd(pts: Pt[], by: number): Pt[] {
  const cum = cumulative(pts)
  const total = cum[cum.length - 1]
  if (total <= by + 1) return [pts[0], pts[0]]
  return partialPoly(pts, (total - by) / total)
}

/** longueur de la pointe d'une flèche — une seule définition, dans arrow.ts */
export { arrowHeadLen } from './arrow'

/** trace un contour fermé déjà calculé (corps fuselé, pointe…) */
function traceOutline(ctx: CanvasRenderingContext2D, poly: Pt[]): void {
  ctx.beginPath()
  if (poly.length === 0) return
  ctx.moveTo(poly[0].x, poly[0].y)
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
  ctx.closePath()
}

/** pointe de flèche néon aux ailerons incurvés, avec pop élastique */
export function neonHead(
  ctx: CanvasRenderingContext2D,
  tip: Pt,
  ang: number,
  size: number,
  color: string,
  alpha: number,
  glow: number,
  scale: number,
): void {
  if (scale <= 0.01) return
  const poly = headOutline(tip, ang, size, scale)
  const tri = () => traceOutline(ctx, poly)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = rgba(color, 0.16 * alpha * glow)
  ctx.lineWidth = size * 2.4
  tri()
  ctx.stroke()
  ctx.strokeStyle = rgba(color, 0.3 * alpha * glow)
  ctx.lineWidth = size * 1.1
  tri()
  ctx.stroke()
  ctx.fillStyle = whiteMix(color, CORE, 0.95 * alpha)
  tri()
  ctx.fill()
  ctx.restore()
}

/**
 * Flèche qui ÉPOUSE la courbe du geste (§4.2.2).
 * `anim.kind === 'head'` : le fût est déjà là, seule la pointe éclot
 * (cas du morph des formes intelligentes).
 * Sinon : animation de trajet de A vers B (§4.2.3) puis pop de la pointe.
 *
 * Le corps fuselé et la pointe sont remplis d'un SEUL contour : la jonction
 * est invisible, sans trou ni surbrillance de recouvrement.
 */
export function renderCurvedArrow(ctx: CanvasRenderingContext2D, s: Stroke, st: ShapeState): void {
  const pts: Pt[] = s.points.map((p) => ({ x: p.x, y: p.y }))
  if (pts.length < 2) return
  let t = 1
  let headK = 1
  if (s.anim) {
    const p = clamp((st.now - s.anim.start) / s.anim.duration, 0, 1)
    if (s.anim.kind === 'head') {
      headK = easeOutBack(p)
    } else {
      t = easeOutCubic(p)
      headK = easeOutBack(clamp((p - 0.68) / 0.32, 0, 1))
    }
  }
  const drawn = partialPoly(pts, t)
  if (drawn.length < 2) return
  const g = arrowGeom(drawn, s.size, headK)
  if (st.alpha <= 0.003) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // halos : deux passes larges pour le fût, deux passes serrées pour la pointe
  const a1 = 0.13 * st.alpha * st.glowBoost
  const a2 = 0.3 * st.alpha * st.glowBoost
  const halo = (w: number, a: number, trace: () => void) => {
    ctx.strokeStyle = rgba(s.color, a)
    ctx.lineWidth = w
    trace()
    ctx.stroke()
  }
  const body = () => tracePoly(ctx, g.body, false)
  halo(s.size * 3.6, a1, body)
  halo(s.size * 1.9, a2, body)
  // la pointe reçoit SES halos, plus serrés : un halo de fût sur une surface
  // aussi petite la délaverait en blanc
  if (headK > 0.01) {
    const head = () => traceOutline(ctx, g.head)
    halo(s.size * 2.4, 0.16 * st.alpha * st.glowBoost, head)
    halo(s.size * 1.1, a2, head)
  }
  // cœur : corps + pointe d'un seul tenant
  ctx.fillStyle = whiteMix(s.color, CORE, 0.95 * st.alpha)
  traceOutline(ctx, g.outline)
  ctx.fill()
  ctx.restore()
  // sur fond clair, le cœur additif se délave : on le repose en source-over
  if (needsCoreFix() && st.alpha > 0.02) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = whiteMix(s.color, coreMix(CORE), 0.92 * st.alpha)
    traceOutline(ctx, g.outline)
    ctx.fill()
    ctx.restore()
  }
}

/* ------------------------------------------------------------------ */
/*  Morph animé entre le tracé brut et la forme parfaite (§4.1.5)      */
/* ------------------------------------------------------------------ */

export interface MorphAnim {
  from: Pt[]
  to: Pt[]
  start: number
  duration: number
  closed: boolean
}

/** ré-échantillonne une polyligne en n points équidistants (par longueur d'arc) */
export function resample(pts: Pt[], n: number, closed: boolean): Pt[] {
  const src = closed ? [...pts, pts[0]] : pts
  const cum = cumulative(src)
  const total = cum[cum.length - 1]
  const out: Pt[] = []
  if (total <= 0) {
    for (let i = 0; i < n; i++) out.push({ x: src[0].x, y: src[0].y })
    return out
  }
  const step = closed ? total / n : total / (n - 1)
  let j = 1
  for (let i = 0; i < n; i++) {
    const d = Math.min(i * step, total)
    while (j < cum.length - 1 && cum[j] < d) j++
    const seg = cum[j] - cum[j - 1]
    const k = seg > 0 ? (d - cum[j - 1]) / seg : 0
    out.push({ x: lerp(src[j - 1].x, src[j].x, k), y: lerp(src[j - 1].y, src[j].y, k) })
  }
  return out
}

const signedArea = (pts: Pt[]): number => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** aligne une boucle cible sur la boucle source : même sens, même point de départ */
export function alignLoop(target: Pt[], ref: Pt[]): Pt[] {
  let t = target
  if (signedArea(t) * signedArea(ref) < 0) t = [...t].reverse()
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < t.length; i++) {
    const d = dist(t[i].x, t[i].y, ref[0].x, ref[0].y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return [...t.slice(best), ...t.slice(0, best)]
}

/** polyligne de contour d'une forme reconnue (sert de cible au morph) */
export function shapeOutline(kind: string, pts: Pt[], n: number): Pt[] {
  if (kind === 'rect') {
    const a = pts[0]
    const b = pts[1]
    const corners: Pt[] = [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ]
    return resample(corners, n, true)
  }
  if (kind === 'ellipse') {
    const cx = (pts[0].x + pts[1].x) / 2
    const cy = (pts[0].y + pts[1].y) / 2
    const rx = Math.abs(pts[1].x - pts[0].x) / 2
    const ry = Math.abs(pts[1].y - pts[0].y) / 2
    const out: Pt[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry })
    }
    return out
  }
  return resample(pts, n, false)
}

/** rendu d'une image intermédiaire du morph, avec un halo qui monte au clic final */
export function renderMorph(
  ctx: CanvasRenderingContext2D,
  m: MorphAnim,
  t: number,
  s: Stroke,
  alpha: number,
): void {
  const e = easeOutCubic(clamp(t, 0, 1))
  const pts: Pt[] = m.from.map((p, i) => ({
    x: lerp(p.x, m.to[i].x, e),
    y: lerp(p.y, m.to[i].y, e),
  }))
  // le halo enfle jusqu'au verrouillage : c'est le « clic » visuel de la forme
  const glow = 1 + e * 0.75
  if (s.filled) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = rgba(s.color, 0.18 * alpha * e)
    tracePoly(ctx, pts, m.closed)
    ctx.fill()
    ctx.restore()
  }
  neonStroke(ctx, (c) => tracePoly(c, pts, m.closed), s.color, s.size, alpha, glow)
}
