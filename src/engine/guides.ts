import type { Stroke } from './types'
import { clamp, dist, rgba, whiteMix } from './geometry'
import { glassLabel } from './teaching'
import type { Pt } from './shapes'

/**
 * Guides magnétiques, esprit Figma (idée premium).
 *
 *  - accroche douce aux angles remarquables (0/15/30/45…) à moins de 4°
 *  - guide lumineux pointillé quand le point courant s'aligne (~6 px) avec
 *    le début, la fin ou le centre d'une annotation existante
 *  - accroche d'espacement égal quand on pose un troisième élément
 *
 * Les guides vivent UNIQUEMENT sur la couche live : ils n'entrent jamais
 * dans l'export. Alt les désactive temporairement.
 *
 * Perf : les points remarquables sont indexés (au plus 3 par annotation,
 * 60 annotations max) et l'index n'est reconstruit que lorsqu'il est sale.
 */

const ANGLE_STEP = 15
const ANGLE_TOL = 4
const ALIGN_TOL = 6
const GAP_TOL = 5
const FADE = 120
const MAX_STROKES = 60

export interface Anchor {
  x: number
  y: number
  id: number
  kind: 'start' | 'end' | 'center'
}

export type Guide =
  | { key: string; kind: 'v'; x: number; a: number; b: number; mx: number; my: number }
  | { key: string; kind: 'h'; y: number; a: number; b: number; mx: number; my: number }
  | { key: string; kind: 'ray'; ox: number; oy: number; x: number; y: number; label: string }
  | { key: string; kind: 'gap'; a: Pt; b: Pt; c: Pt }

export interface SnapResult {
  x: number
  y: number
  guides: Guide[]
}

/** points remarquables des annotations : début, fin, centre */
export function buildAnchors(strokes: Stroke[]): Anchor[] {
  const out: Anchor[] = []
  const start = Math.max(0, strokes.length - MAX_STROKES)
  for (let i = start; i < strokes.length; i++) {
    const s = strokes[i]
    if (s.dying || s.points.length === 0) continue
    const a = s.points[0]
    const b = s.points[s.points.length - 1]
    if (s.tool === 'badge' || s.tool === 'marker' || s.tool === 'stamp' || s.tool === 'text') {
      out.push({ x: a.x, y: a.y, id: s.id, kind: 'center' })
      continue
    }
    out.push({ x: a.x, y: a.y, id: s.id, kind: 'start' })
    if (b !== a) out.push({ x: b.x, y: b.y, id: s.id, kind: 'end' })
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, id: s.id, kind: 'center' })
  }
  return out
}

/**
 * Accroche le point courant. `origin` = point de départ du geste en cours
 * (null pour un simple clic). Renvoie le point corrigé et les guides à afficher.
 */
export function snapPoint(origin: Pt | null, p: Pt, anchors: Anchor[]): SnapResult {
  const guides: Guide[] = []
  let x = p.x
  let y = p.y

  // 1. espacement égal : le troisième élément se cale sur l'écart des deux premiers
  if (anchors.length >= 2) {
    const gap = equalGap(p, anchors)
    if (gap) {
      guides.push(gap.guide)
      return { x: gap.x, y: gap.y, guides }
    }
  }

  // 2. alignement sur un point remarquable (axes X et Y indépendants)
  let bestX: Anchor | null = null
  let bestY: Anchor | null = null
  let dx = ALIGN_TOL
  let dy = ALIGN_TOL
  for (const a of anchors) {
    const ax = Math.abs(a.x - p.x)
    if (ax < dx) {
      dx = ax
      bestX = a
    }
    const ay = Math.abs(a.y - p.y)
    if (ay < dy) {
      dy = ay
      bestY = a
    }
  }
  if (bestX) {
    x = bestX.x
    guides.push({
      key: `v${Math.round(bestX.x)}`,
      kind: 'v',
      x: bestX.x,
      a: Math.min(bestX.y, y) - 26,
      b: Math.max(bestX.y, y) + 26,
      mx: bestX.x,
      my: bestX.y,
    })
  }
  if (bestY) {
    y = bestY.y
    guides.push({
      key: `h${Math.round(bestY.y)}`,
      kind: 'h',
      y: bestY.y,
      a: Math.min(bestY.x, x) - 26,
      b: Math.max(bestY.x, x) + 26,
      mx: bestY.x,
      my: bestY.y,
    })
  }
  if (guides.length > 0) return { x, y, guides }

  // 3. accroche douce aux angles remarquables
  if (origin) {
    const d = dist(origin.x, origin.y, p.x, p.y)
    if (d > 18) {
      const deg = (Math.atan2(p.y - origin.y, p.x - origin.x) * 180) / Math.PI
      const snapped = Math.round(deg / ANGLE_STEP) * ANGLE_STEP
      let diff = Math.abs(deg - snapped)
      if (diff > 180) diff = 360 - diff
      if (diff < ANGLE_TOL) {
        const r = (snapped * Math.PI) / 180
        x = origin.x + Math.cos(r) * d
        y = origin.y + Math.sin(r) * d
        let label = Math.round(-snapped)
        if (label <= -180) label += 360
        guides.push({
          key: `ray${snapped}`,
          kind: 'ray',
          ox: origin.x,
          oy: origin.y,
          x: origin.x + Math.cos(r) * (d + 90),
          y: origin.y + Math.sin(r) * (d + 90),
          label: `${label}°`,
        })
      }
    }
  }
  return { x, y, guides }
}

/**
 * Espacement égal : le point courant prolonge l'écart entre deux annotations
 * déjà posées (B puis A, puis p au même intervalle et dans le même axe).
 * On ne teste que les 8 centres les plus proches : 64 comparaisons au pire.
 */
function equalGap(p: Pt, anchors: Anchor[]): { x: number; y: number; guide: Guide } | null {
  const near = anchors
    .filter((a) => a.kind === 'center')
    .map((a) => ({ a, d: dist(a.x, a.y, p.x, p.y) }))
    .sort((u, v) => u.d - v.d)
    .slice(0, 8)
  for (const { a: a1, d: d1 } of near) {
    for (const { a: a2 } of near) {
      if (a2.id === a1.id) continue
      const ref = dist(a1.x, a1.y, a2.x, a2.y)
      if (ref < 40 || Math.abs(ref - d1) > GAP_TOL) continue
      // a2 → a1 → p doit être à peu près une ligne : le geste continue la série
      const ang1 = Math.atan2(a1.y - a2.y, a1.x - a2.x)
      const ang2 = Math.atan2(p.y - a1.y, p.x - a1.x)
      let diff = Math.abs(((ang2 - ang1) * 180) / Math.PI) % 360
      if (diff > 180) diff = 360 - diff
      if (diff > 11) continue
      const x = a1.x + Math.cos(ang1) * ref
      const y = a1.y + Math.sin(ang1) * ref
      return {
        x,
        y,
        guide: {
          key: `gap${a1.id}-${a2.id}`,
          kind: 'gap',
          a: { x: a2.x, y: a2.y },
          b: { x: a1.x, y: a1.y },
          c: { x, y },
        },
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */

/** Affichage des guides : fondu de 120 ms à l'apparition ET à la sortie. */
export class GuideOverlay {
  private list: Guide[] = []
  private births = new Map<string, number>()
  private deaths = new Map<string, { g: Guide; t: number }>()

  set(guides: Guide[], now: number): void {
    const keys = new Set(guides.map((g) => g.key))
    for (const g of this.list) {
      if (!keys.has(g.key) && !this.deaths.has(g.key)) this.deaths.set(g.key, { g, t: now })
    }
    for (const g of guides) {
      if (!this.births.has(g.key)) this.births.set(g.key, now)
      this.deaths.delete(g.key)
    }
    for (const k of this.births.keys()) {
      if (!keys.has(k) && !this.deaths.has(k)) this.births.delete(k)
    }
    this.list = guides
  }

  clear(now: number): void {
    this.set([], now)
  }

  active(now: number): boolean {
    if (this.list.length > 0) return true
    for (const d of this.deaths.values()) if (now - d.t < FADE) return true
    return false
  }

  render(ctx: CanvasRenderingContext2D, now: number, color: string): void {
    for (const [k, d] of this.deaths) {
      const a = 1 - (now - d.t) / FADE
      if (a <= 0) {
        this.deaths.delete(k)
        this.births.delete(k)
        continue
      }
      this.draw(ctx, d.g, a, color)
    }
    for (const g of this.list) {
      const born = this.births.get(g.key) ?? now
      this.draw(ctx, g, clamp((now - born) / FADE, 0, 1), color)
    }
  }

  private draw(ctx: CanvasRenderingContext2D, g: Guide, a: number, color: string): void {
    if (a <= 0.01) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.strokeStyle = rgba(color, 0.14 * a)
      ctx.lineWidth = 5
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.strokeStyle = whiteMix(color, 0.5, 0.85 * a)
      ctx.lineWidth = 1.2
      ctx.setLineDash([5, 6])
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.setLineDash([])
    }
    const diamond = (x: number, y: number, r: number) => {
      ctx.fillStyle = whiteMix(color, 0.55, 0.9 * a)
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      ctx.fill()
    }
    if (g.kind === 'v') {
      line(g.x, g.a, g.x, g.b)
      diamond(g.mx, g.my, 3.4)
    } else if (g.kind === 'h') {
      line(g.a, g.y, g.b, g.y)
      diamond(g.mx, g.my, 3.4)
    } else if (g.kind === 'ray') {
      line(g.ox, g.oy, g.x, g.y)
      ctx.restore()
      glassLabel(ctx, g.x, g.y, g.label, { color, alpha: a, fontSize: 11.5 })
      return
    } else {
      line(g.a.x, g.a.y, g.b.x, g.b.y)
      line(g.b.x, g.b.y, g.c.x, g.c.y)
      diamond(g.a.x, g.a.y, 3)
      diamond(g.b.x, g.b.y, 3)
      const m1 = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }
      const m2 = { x: (g.b.x + g.c.x) / 2, y: (g.c.y + g.b.y) / 2 }
      ctx.restore()
      glassLabel(ctx, m1.x, m1.y, '=', { color, alpha: a, fontSize: 11 })
      glassLabel(ctx, m2.x, m2.y, '=', { color, alpha: a, fontSize: 11 })
      return
    }
    ctx.restore()
  }
}
