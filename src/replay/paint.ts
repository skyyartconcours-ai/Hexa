/**
 * Hexa — peinture d'une liste de traits sur un canvas quelconque.
 *
 * C'est LA brique partagée entre les trois consommateurs hors moteur :
 *  - le rejeu de session (src/replay/player.ts) ;
 *  - l'export PNG haute résolution (src/replay/exporter.ts) ;
 *  - le miroir OBS (src/obs/mirror.ts).
 *
 * Elle réutilise strictement la même recette de rendu que le moteur
 * (src/engine/render.ts) : « une seule base de code de rendu, deux vues »
 * (brief §10.2). Aucune interaction, aucun état, aucune boucle ici : on
 * dessine une liste de traits à un instant donné, point.
 */
import type { Stroke } from '../engine/types'
import { renderEmber, renderStroke } from '../engine/render'
import { clamp, easeInQuad } from '../engine/geometry'
import { emberAt } from '../engine/dissolve'

/** seuls les tracés à main levée se consument en « comète » */
const COMET_TOOLS = new Set(['pen', 'highlight'])

/** Intensité globale des effets (halos, braises), réglable dans les réglages. */
let fxIntensity = 1

export function setFxIntensity(value: number): void {
  fxIntensity = clamp(value, 0.2, 1.6)
}

export function getFxIntensity(): number {
  return fxIntensity
}

/**
 * Durée d'une dissolution : LA recette du moteur, pas une copie. Le rejeu,
 * l'export et la vue OBS doivent faire mourir un trait à la milliseconde où il
 * meurt chez le streamer — sinon le spectateur voit une annotation persister
 * après qu'elle a disparu chez le coach.
 */
export { dissolveDuration } from '../engine/dissolve'

export interface PaintOptions {
  /** multiplicateur de halo appliqué en plus de l'intensité globale */
  glow?: number
  /** braise incandescente au bord de dissolution (coûte une passe de plus) */
  ember?: boolean
}

/** Centre de la pastille précédente, pour la flèche de liaison du numéroteur. */
function linkAnchor(strokes: readonly Stroke[], s: Stroke): { x: number; y: number } | null {
  if (s.tool !== 'badge' || s.linkFrom == null) return null
  for (const o of strokes) {
    if (o.id === s.linkFrom && o.points.length > 0) return { x: o.points[0].x, y: o.points[0].y }
  }
  return null
}

/**
 * Dessine la liste à l'instant `now` (même horloge que les champs `dying`).
 * Le canvas doit déjà être nettoyé et transformé par l'appelant.
 */
export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  now: number,
  opts: PaintOptions = {},
): void {
  const glowBoost = (opts.glow ?? 1) * fxIntensity
  for (const s of strokes) {
    if (s.points.length === 0) continue
    let alpha = 1
    let from = 0
    const comet = COMET_TOOLS.has(s.tool)
    if (s.dying) {
      const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
      if (p >= 1) continue
      if (p > 0) {
        if (s.dying.mode === 'pop' || !comet) {
          alpha = 1 - p
        } else {
          const n = s.points.length
          from = Math.floor(easeInQuad(p) * Math.max(0, n - 2))
          alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25
        }
      }
    }
    renderStroke(ctx, s, { alpha, from, glowBoost, now, link: linkAnchor(strokes, s) })
    if (opts.ember !== false && s.dying && s.dying.mode === 'dissolve') {
      const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
      if (p > 0 && p < 1) {
        const head = !comet
          ? s.points[s.points.length - 1]
          : s.points[Math.min(from, s.points.length - 1)]
        const e = emberAt(p)
        const r = Math.max(6, s.size * (1.7 + Math.sin(now * 0.02) * 0.35)) * e.scale
        renderEmber(ctx, head.x, head.y, r, s.color, e.alpha)
      }
    }
  }
}

/** Boîte englobante du contenu, marges comprises (export PNG recadré). */
export function strokesBounds(
  strokes: readonly Stroke[],
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of strokes) {
    // marge généreuse : halo néon, pointe de flèche, pastille, boîte de texte
    const pad = s.size * 4 + 26 + (s.tool === 'text' ? 220 : 0)
    for (const p of s.points) {
      minX = Math.min(minX, p.x - pad)
      minY = Math.min(minY, p.y - pad)
      maxX = Math.max(maxX, p.x + pad)
      maxY = Math.max(maxY, p.y + pad)
    }
    if (s.tool === 'stamp' && s.w && s.h && s.points[0]) {
      minX = Math.min(minX, s.points[0].x - s.w / 2 - 20)
      minY = Math.min(minY, s.points[0].y - s.h / 2 - 20)
      maxX = Math.max(maxX, s.points[0].x + s.w / 2 + 20)
      maxY = Math.max(maxY, s.points[0].y + s.h / 2 + 20)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
