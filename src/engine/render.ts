import { getStroke } from 'perfect-freehand'
import type { Stroke, StrokePoint } from './types'
import { clamp, easeOutCubic, lerp, rgba, whiteMix } from './geometry'
import {
  arrowHeadLen,
  easeOutBack,
  neonHead,
  renderCurvedArrow,
  renderShape,
  shapeBox,
  traceRoundRect,
} from './shapes'
import { renderBadge, renderMeasure, renderStamp, renderText } from './teaching'
import { renderGlyph } from './handwriting'
import {
  arrowPulseK,
  coreMix,
  depthPaint,
  haloPaint,
  igniteAt,
  paintCoreFix,
  paintDissolveDust,
  paintIgnite,
  paintInkShadow,
  paintLastFlash,
  type Ignition,
  type Pt2,
} from './ink-fx'

/** part de blanc dans le cœur des traits néon */
export const CORE_MIX = 0.62

export interface RenderState {
  alpha: number
  /** index de départ (dissolution "comète" : les points sont consommés depuis la queue) */
  from: number
  glowBoost: number
  now: number
  /** pastille numérotée : centre de la pastille précédente (flèche de liaison) */
  link?: { x: number; y: number } | null
}

function tracePath(ctx: CanvasRenderingContext2D, pts: StrokePoint[], from: number): void {
  const n = pts.length
  ctx.beginPath()
  const p0 = pts[from]
  ctx.moveTo(p0.x, p0.y)
  if (n - from === 1) {
    ctx.lineTo(p0.x + 0.01, p0.y)
    return
  }
  for (let i = from + 1; i < n - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
  }
  const last = pts[n - 1]
  ctx.lineTo(last.x, last.y)
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: number[][]): void {
  if (outline.length < 3) return
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1])
  ctx.closePath()
  ctx.fill()
}

/* ------------------------------------------------------------------ */
/*  Chemin d'un trait : sert à l'ombre portée et à l'onde d'allumage    */
/* ------------------------------------------------------------------ */

interface InkPath {
  trace: (c: CanvasRenderingContext2D) => void
  /** longueur approchée, pour promener l'onde d'allumage */
  len: number
  tail: Pt2
  head: Pt2
}

function polyLen(pts: { x: number; y: number }[], from: number): number {
  let l = 0
  for (let i = from + 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return l
}

/** facteur de ressort d'apparition d'une forme — identique à renderShape */
function shapeSpring(s: Stroke, now: number): number {
  if (!s.anim) return 1
  return lerp(0.93, 1, easeOutBack(clamp((now - s.anim.start) / s.anim.duration, 0, 1)))
}

/**
 * Chemin unique d'un trait, quel que soit l'outil. Le néon, l'ombre portée et
 * l'onde d'allumage parlent ainsi tous le même langage : un `trace` et une
 * longueur. Renvoie null pour les outils qui ont leur propre mise en page
 * (texte, pastille, tampon, mot typographié).
 */
function pathOf(s: Stroke, from: number, now: number): InkPath | null {
  const pts = s.points
  const n = pts.length
  if (n === 0) return null
  if (s.tool === 'pen' || s.tool === 'highlight') {
    if (n - from < 1) return null
    return {
      trace: (c) => tracePath(c, pts, from),
      len: polyLen(pts, from),
      tail: pts[from],
      head: pts[n - 1],
    }
  }
  if (s.tool === 'line' || s.tool === 'measure' || (s.tool === 'arrow' && n <= 2)) {
    const a = pts[0]
    const b = pts[n - 1]
    return {
      trace: (c) => {
        c.beginPath()
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
      },
      len: Math.hypot(b.x - a.x, b.y - a.y),
      tail: a,
      head: b,
    }
  }
  if (s.tool === 'arrow') {
    return {
      trace: (c) => tracePath(c, pts, 0),
      len: polyLen(pts, 0),
      tail: pts[0],
      head: pts[n - 1],
    }
  }
  if (s.tool === 'rect' || s.tool === 'ellipse') {
    const b = shapeBox(s)
    const k = shapeSpring(s, now)
    const w = Math.max(b.w * k, 0.2)
    const h = Math.max(b.h * k, 0.2)
    const x = b.cx - w / 2
    const y = b.cy - h / 2
    if (s.tool === 'ellipse') {
      const rx = w / 2
      const ry = h / 2
      // périmètre d'ellipse, approximation de Ramanujan
      const len = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
      return {
        trace: (c) => {
          c.beginPath()
          c.ellipse(b.cx, b.cy, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2)
        },
        len: Math.max(len, 1),
        tail: { x: b.cx + rx, y: b.cy },
        head: { x: b.cx + rx, y: b.cy },
      }
    }
    const r = Math.min(16, Math.min(w, h) * 0.14)
    return {
      trace: (c) => traceRoundRect(c, x, y, w, h, r),
      len: Math.max(2 * (w + h) - 8 * r + 2 * Math.PI * r, 1),
      tail: { x: x + r, y },
      head: { x: x + r, y },
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  Rendu d'un trait                                                    */
/* ------------------------------------------------------------------ */

export function renderStroke(ctx: CanvasRenderingContext2D, s: Stroke, st: RenderState): void {
  // dissolution : poussière qui monte et micro-éclat final, communs à tous
  // les outils qui se consument en comète
  if (s.dying && s.dying.mode === 'dissolve' && (s.tool === 'pen' || s.tool === 'highlight')) {
    const p = clamp((st.now - s.dying.start) / s.dying.duration, 0, 1)
    paintDissolveDust(ctx, s, st.from, p, st.now, s.dying.duration, st.alpha)
    const head = s.points[Math.min(st.from, s.points.length - 1)]
    if (head) paintLastFlash(ctx, head.x, head.y, s.color, s.size, p)
  }

  if (s.tool === 'arrow') {
    renderArrow(ctx, s, st)
    return
  }
  if (s.tool === 'line') {
    renderLine(ctx, s, st)
    return
  }
  if (s.tool === 'rect' || s.tool === 'ellipse') {
    const path = pathOf(s, 0, st.now)
    const ign = igniteAt(s, st.now)
    if (path) paintInkShadow(ctx, path.trace, s.color, s.size, st.alpha)
    renderShape(ctx, s, ign ? { ...st, glowBoost: st.glowBoost * ign.boost } : st)
    if (path) {
      paintCoreFix(ctx, path.trace, s.color, s.size, st.alpha, CORE_MIX)
      igniteOn(ctx, s, st, path, ign)
    }
    return
  }
  if (s.tool === 'text') {
    renderText(ctx, s, st)
    return
  }
  if (s.tool === 'badge') {
    renderBadge(ctx, s, st, st.link ?? null)
    return
  }
  if (s.tool === 'measure') {
    renderMeasure(ctx, s, st)
    return
  }
  if (s.tool === 'stamp') {
    renderStamp(ctx, s, st)
    return
  }
  // mode écriture : mot typographié (morph en cours ou texte net)
  if (s.tool === 'glyph') {
    renderGlyph(ctx, s, st)
    return
  }
  const pts = s.points
  if (pts.length - st.from < 1) return
  const path = pathOf(s, st.from, st.now)
  const ign = igniteAt(s, st.now)

  if (s.tool === 'highlight') {
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = rgba(s.color, 0.32 * st.alpha)
    ctx.lineWidth = s.size * 2.8
    tracePath(ctx, pts, st.from)
    ctx.stroke()
    ctx.restore()
    if (path) igniteOn(ctx, s, st, path, ign)
    return
  }

  // ombre portée colorée : SOUS l'encre, en source-over. Invisible sur fond
  // sombre, c'est elle qui détache le trait sur un fond clair.
  if (path) paintInkShadow(ctx, path.trace, s.color, s.size, st.alpha)

  // stylo néon : halo additif large + halo serré + cœur chaud avec pression.
  // Les trois passes suivent un dégradé de la queue vers la tête (profondeur).
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalCompositeOperation = 'lighter'
  // sur-éclat de l'allumage : le trait naît trop lumineux et se calme
  const g = st.glowBoost * (ign ? ign.boost : 1)
  const tail = path ? path.tail : pts[st.from]
  const head = path ? path.head : pts[pts.length - 1]
  ctx.strokeStyle = haloPaint(ctx, tail, head, s.color, 0.13 * st.alpha * g)
  ctx.lineWidth = s.size * 3.6
  tracePath(ctx, pts, st.from)
  ctx.stroke()
  ctx.strokeStyle = haloPaint(ctx, tail, head, s.color, 0.3 * st.alpha * g)
  ctx.lineWidth = s.size * 1.9
  tracePath(ctx, pts, st.from)
  ctx.stroke()

  const sliced = st.from > 0 ? pts.slice(st.from) : pts
  const outline = getStroke(
    sliced.map((p) => [p.x, p.y, p.p]),
    {
      size: s.size,
      thinning: 0.52,
      smoothing: 0.62,
      streamline: 0.44,
      simulatePressure: s.simulatePressure,
      last: s.done,
    },
  )
  ctx.fillStyle = depthPaint(ctx, tail, head, s.color, coreMix(CORE_MIX), 0.95 * st.alpha)
  fillOutline(ctx, outline)
  ctx.restore()

  if (path) igniteOn(ctx, s, st, path, ign)
}

/** onde d'allumage, si le trait vient d'être posé */
function igniteOn(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  st: RenderState,
  path: InkPath,
  ign: Ignition | null,
): void {
  if (!ign) return
  paintIgnite(ctx, path.trace, path.len, s.color, s.size, ign, st.alpha)
}

function renderArrow(ctx: CanvasRenderingContext2D, s: Stroke, st: RenderState): void {
  // pulsation optionnelle d'une flèche posée (mode « boucle ») et sur-éclat
  // de l'allumage : les deux ne font que moduler le halo
  const ign = igniteAt(s, st.now)
  const pulse = arrowPulseK(s, st.now) * (ign ? ign.boost : 1)
  const sp = pulse === 1 ? st : { ...st, glowBoost: st.glowBoost * pulse }
  // geste courbe : la flèche épouse la courbe au lieu de forcer la ligne (§4.2.2)
  if (s.points.length > 2) {
    const path = pathOf(s, 0, st.now)
    if (path) paintInkShadow(ctx, path.trace, s.color, s.size, st.alpha)
    renderCurvedArrow(ctx, s, sp)
    if (path) {
      paintCoreFix(ctx, path.trace, s.color, s.size, st.alpha, CORE_MIX)
      igniteOn(ctx, s, st, path, ign)
    }
    return
  }
  const a = s.points[0]
  const bRaw = s.points[s.points.length - 1]
  if (!a || !bRaw || (a.x === bRaw.x && a.y === bRaw.y)) return

  let t = 1
  let headK = 1
  if (s.anim) {
    const p = clamp((st.now - s.anim.start) / s.anim.duration, 0, 1)
    if (s.anim.kind === 'head') {
      // morph d'une forme intelligente : le fût est déjà là, la pointe éclot
      headK = easeOutBack(p)
    } else {
      t = easeOutCubic(p)
      // la pointe se dessine APRÈS le fût, avec un pop élastique (§4.2.1)
      headK = easeOutBack(clamp((p - 0.68) / 0.32, 0, 1))
    }
  }
  const b = { x: a.x + (bRaw.x - a.x) * t, y: a.y + (bRaw.y - a.y) * t }
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const headLen = arrowHeadLen(s.size) * Math.max(headK, 0.001)
  const shaftEnd = {
    x: b.x - Math.cos(ang) * headLen * 0.72,
    y: b.y - Math.sin(ang) * headLen * 0.72,
  }

  const traceShaft = (c: CanvasRenderingContext2D) => {
    c.beginPath()
    c.moveTo(a.x, a.y)
    c.lineTo(shaftEnd.x, shaftEnd.y)
  }
  paintInkShadow(ctx, traceShaft, s.color, s.size, st.alpha)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const g = st.glowBoost * pulse

  const shaft = (w: number, style: string | CanvasGradient) => {
    ctx.strokeStyle = style
    ctx.lineWidth = w
    traceShaft(ctx)
    ctx.stroke()
  }
  shaft(s.size * 3.6, haloPaint(ctx, a, shaftEnd, s.color, 0.13 * st.alpha * g))
  shaft(s.size * 1.9, haloPaint(ctx, a, shaftEnd, s.color, 0.3 * st.alpha * g))
  shaft(s.size, depthPaint(ctx, a, shaftEnd, s.color, coreMix(CORE_MIX), 0.95 * st.alpha))

  ctx.restore()
  // pointe : même recette néon, avec le pop élastique
  neonHead(ctx, b, ang, s.size, s.color, st.alpha, g, headK * (pulse === 1 ? 1 : 1 + (pulse - 1) * 0.18))
  // éclair sec au moment exact où la pointe claque : c'est ce qui rend le
  // geste « posé » et non « dessiné »
  if (s.anim) {
    const p = clamp((st.now - s.anim.start) / s.anim.duration, 0, 1)
    const q = s.anim.kind === 'head' ? p : clamp((p - 0.68) / 0.32, 0, 1)
    if (q > 0 && q < 1) tipSpark(ctx, b.x, b.y, s.color, s.size, q, st.alpha)
  }

  const path = pathOf(s, 0, st.now)
  if (path) igniteOn(ctx, s, st, path, ign)
}

/** micro-éclat blanc au bout d'une flèche qui vient de claquer */
function tipSpark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
  q: number,
  alpha: number,
): void {
  const fade = (1 - q) * (1 - q) * alpha
  if (fade < 0.02) return
  const r = size * (1.4 + q * 2.6)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, whiteMix(color, 0.92, 0.75 * fade))
  grad.addColorStop(0.4, rgba(color, 0.4 * fade))
  grad.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function renderLine(ctx: CanvasRenderingContext2D, s: Stroke, st: RenderState): void {
  const a = s.points[0]
  const b = s.points[s.points.length - 1]
  if (!a || !b) return
  const trace = (c: CanvasRenderingContext2D) => {
    c.beginPath()
    c.moveTo(a.x, a.y)
    c.lineTo(b.x, b.y)
  }
  paintInkShadow(ctx, trace, s.color, s.size, st.alpha)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  const ign = igniteAt(s, st.now)
  const g = st.glowBoost * (ign ? ign.boost : 1)
  const seg = (w: number, style: string | CanvasGradient) => {
    ctx.strokeStyle = style
    ctx.lineWidth = w
    trace(ctx)
    ctx.stroke()
  }
  seg(s.size * 3.6, haloPaint(ctx, a, b, s.color, 0.13 * st.alpha * g))
  seg(s.size * 1.9, haloPaint(ctx, a, b, s.color, 0.3 * st.alpha * g))
  seg(s.size, depthPaint(ctx, a, b, s.color, coreMix(CORE_MIX), 0.95 * st.alpha))
  ctx.restore()
  const path = pathOf(s, 0, st.now)
  if (path) igniteOn(ctx, s, st, path, ign)
}

/**
 * Braise incandescente au bord de dissolution d'un trait.
 * Cœur blanc qui PALPITE : c'est le détail qui fait exister la braise, plutôt
 * qu'un simple point lumineux. La phase se lit sur l'horloge passée en dernier
 * argument (le rendu en direct s'en remet à `performance.now()`) : aucun
 * compteur interne, donc rien à remettre à zéro et rien qui dérive.
 */
export function renderEmber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  now: number = performance.now(),
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, whiteMix(color, 0.8, 0.9 * alpha))
  grad.addColorStop(0.35, rgba(color, 0.55 * alpha))
  grad.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  // cœur blanc palpitant
  const beat = 0.78 + 0.22 * Math.sin(now * 0.019)
  const cr = Math.max(0.6, r * 0.3 * beat)
  const core = ctx.createRadialGradient(x, y, 0, x, y, cr * 2.2)
  core.addColorStop(0, `rgba(255,255,255,${0.92 * alpha})`)
  core.addColorStop(0.5, whiteMix(color, 0.6, 0.5 * alpha))
  core.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(x, y, cr * 2.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
