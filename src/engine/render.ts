import { getStroke } from 'perfect-freehand'
import type { Stroke, StrokePoint } from './types'
import { clamp, easeOutCubic, rgba, whiteMix } from './geometry'
import { arrowHeadLen, easeOutBack, neonHead, renderCurvedArrow, renderShape } from './shapes'
import { renderBadge, renderMeasure, renderStamp, renderText } from './teaching'
import { renderGlyph } from './handwriting'

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

export function renderStroke(ctx: CanvasRenderingContext2D, s: Stroke, st: RenderState): void {
  if (s.tool === 'arrow') {
    renderArrow(ctx, s, st)
    return
  }
  if (s.tool === 'line') {
    renderLine(ctx, s, st)
    return
  }
  if (s.tool === 'rect' || s.tool === 'ellipse') {
    renderShape(ctx, s, st)
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
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (s.tool === 'highlight') {
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineCap = 'butt'
    ctx.strokeStyle = rgba(s.color, 0.32 * st.alpha)
    ctx.lineWidth = s.size * 2.8
    tracePath(ctx, pts, st.from)
    ctx.stroke()
    ctx.restore()
    return
  }

  // stylo néon : halo additif large + halo serré + cœur chaud avec pression
  ctx.globalCompositeOperation = 'lighter'
  const g = st.glowBoost
  ctx.strokeStyle = rgba(s.color, 0.13 * st.alpha * g)
  ctx.lineWidth = s.size * 3.6
  tracePath(ctx, pts, st.from)
  ctx.stroke()
  ctx.strokeStyle = rgba(s.color, 0.3 * st.alpha * g)
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
  ctx.fillStyle = whiteMix(s.color, CORE_MIX, 0.95 * st.alpha)
  fillOutline(ctx, outline)
  ctx.restore()
}

function renderArrow(ctx: CanvasRenderingContext2D, s: Stroke, st: RenderState): void {
  // geste courbe : la flèche épouse la courbe au lieu de forcer la ligne (§4.2.2)
  if (s.points.length > 2) {
    renderCurvedArrow(ctx, s, st)
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

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const g = st.glowBoost

  const shaft = (w: number, style: string) => {
    ctx.strokeStyle = style
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(shaftEnd.x, shaftEnd.y)
    ctx.stroke()
  }
  shaft(s.size * 3.6, rgba(s.color, 0.13 * st.alpha * g))
  shaft(s.size * 1.9, rgba(s.color, 0.3 * st.alpha * g))
  shaft(s.size, whiteMix(s.color, CORE_MIX, 0.95 * st.alpha))

  ctx.restore()
  // pointe : même recette néon, avec le pop élastique
  neonHead(ctx, b, ang, s.size, s.color, st.alpha, g, headK)
}

function renderLine(ctx: CanvasRenderingContext2D, s: Stroke, st: RenderState): void {
  const a = s.points[0]
  const b = s.points[s.points.length - 1]
  if (!a || !b) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  const g = st.glowBoost
  const seg = (w: number, style: string) => {
    ctx.strokeStyle = style
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  seg(s.size * 3.6, rgba(s.color, 0.13 * st.alpha * g))
  seg(s.size * 1.9, rgba(s.color, 0.3 * st.alpha * g))
  seg(s.size, whiteMix(s.color, CORE_MIX, 0.95 * st.alpha))
  ctx.restore()
}

/** braise incandescente au bord de dissolution d'un trait */
export function renderEmber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
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
  ctx.restore()
}
