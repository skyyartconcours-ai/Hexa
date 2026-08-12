/**
 * Hexa — placement de la barre d'outils (§S4).
 *
 * Trois idées, et rien d'autre :
 *
 *  1. La barre est ANCRÉE À UN BORD. Un bord vertical (gauche/droite) impose une
 *     barre verticale, un bord horizontal (haut/bas) une barre horizontale.
 *     L'utilisateur peut forcer l'autre orientation, mais le défaut suit le bord :
 *     une barre horizontale plaquée contre le bord gauche laisse un trou absurde.
 *
 *  2. Sa position le long de ce bord est mémorisée en PROPORTION (0 → 1) et non
 *     en pixels. Brancher un 1440p à la place d'un 1080p, changer l'échelle
 *     Windows de 100 % à 125 % : la barre reste là où l'œil l'attend au lieu de
 *     partir hors champ.
 *
 *  3. Le placement final est TOUJOURS recalculé et borné à l'écran réel
 *     (`placeDock`). C'est ce qui rattrape tout seul le cas « j'ai débranché
 *     l'écran de droite » : la barre revient dans le cadre au lieu de disparaître.
 *
 * Module pur, sans React et sans DOM : testable, et réutilisable par les
 * réglages comme par la barre elle-même.
 */

export type ToolbarEdge = 'left' | 'right' | 'top' | 'bottom'
export type ToolbarOrientation = 'vertical' | 'horizontal'
/** 'auto' = l'orientation suit le bord d'ancrage. */
export type ToolbarOrientationPref = 'auto' | ToolbarOrientation

export interface ToolbarDock {
  edge: ToolbarEdge
  /** position du CENTRE de la barre le long du bord, 0 (haut/gauche) → 1 */
  offset: number
}

/**
 * Défaut : bord GAUCHE, à mi-hauteur, donc verticale.
 *
 * Sur une configuration à deux écrans, la barre ne vit que sur l'écran de
 * droite (voir `hexa.display.toolbarHost`, décidé par electron/main.ts) : collée
 * à son bord gauche, elle se retrouve juste à côté de l'écran principal — à
 * portée de souris, et jamais par-dessus ce que les spectateurs regardent.
 *
 * Sur un écran unique, le bord gauche reste le meilleur défaut : en League of
 * Legends le bas de l'écran est occupé par la barre de sorts et l'inventaire,
 * le haut par le score et la minimap n'est jamais à gauche. La colonne de
 * gauche est la bande la moins chargée de l'écran — et la barre reste
 * déplaçable d'un glisser si le jeu du moment en décide autrement.
 */
export const DEFAULT_DOCK: ToolbarDock = { edge: 'left', offset: 0.5 }

/** Marge entre la barre et le bord de l'écran, en pixels CSS. */
export const EDGE_MARGIN = 12

export const EDGE_LABELS: Record<ToolbarEdge, string> = {
  left: 'à gauche',
  right: 'à droite',
  top: 'en haut',
  bottom: 'en bas',
}

export function orientationForEdge(edge: ToolbarEdge): ToolbarOrientation {
  return edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal'
}

/** Orientation réellement appliquée : le choix explicite, sinon celle du bord. */
export function resolveOrientation(
  edge: ToolbarEdge,
  pref: ToolbarOrientationPref,
): ToolbarOrientation {
  return pref === 'auto' ? orientationForEdge(edge) : pref
}

export function isEdge(value: unknown): value is ToolbarEdge {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom'
}

/**
 * Bord le plus proche d'un point, en distances NORMALISÉES.
 *
 * Comparer des pixels bruts serait faux : sur un 21/9, le bord haut est presque
 * toujours « plus proche » que le bord gauche, et on ne pourrait plus ancrer à
 * gauche qu'en collant le curseur au pixel. En proportion de l'écran, les zones
 * d'attraction se rejoignent proprement sur les diagonales.
 */
export function nearestEdge(
  cx: number,
  cy: number,
  view: { width: number; height: number },
): ToolbarEdge {
  const w = Math.max(1, view.width)
  const h = Math.max(1, view.height)
  const d: Record<ToolbarEdge, number> = {
    left: cx / w,
    right: (w - cx) / w,
    top: cy / h,
    bottom: (h - cy) / h,
  }
  let best: ToolbarEdge = 'left'
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    if (d[edge] < d[best]) best = edge
  }
  return best
}

/** Proportion (0 → 1) du centre le long du bord visé. */
export function offsetAlongEdge(
  edge: ToolbarEdge,
  cx: number,
  cy: number,
  view: { width: number; height: number },
): number {
  const value =
    edge === 'left' || edge === 'right' ? cy / Math.max(1, view.height) : cx / Math.max(1, view.width)
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000))
}

/**
 * Coin haut-gauche de la barre, en pixels CSS, TOUJOURS dans le cadre.
 *
 * Le bornage final n'est pas une politesse : c'est lui qui ramène la barre à
 * l'écran quand la position mémorisée vient d'un écran qui n'existe plus.
 */
export function placeDock(
  dock: ToolbarDock,
  size: { width: number; height: number },
  view: { width: number; height: number },
  margin = EDGE_MARGIN,
): { left: number; top: number } {
  const { width: w, height: h } = size
  const offset = Number.isFinite(dock.offset) ? Math.min(1, Math.max(0, dock.offset)) : 0.5
  let left: number
  let top: number
  switch (dock.edge) {
    case 'left':
      left = margin
      top = offset * view.height - h / 2
      break
    case 'right':
      left = view.width - w - margin
      top = offset * view.height - h / 2
      break
    case 'top':
      left = offset * view.width - w / 2
      top = margin
      break
    default:
      left = offset * view.width - w / 2
      top = view.height - h - margin
      break
  }
  return {
    left: Math.round(clamp(left, margin, Math.max(margin, view.width - w - margin))),
    top: Math.round(clamp(top, margin, Math.max(margin, view.height - h - margin))),
  }
}

/** Rectangle de l'aperçu d'ancrage affiché pendant le glisser. */
export function edgePreviewStyle(edge: ToolbarEdge, thickness = 6): {
  left: string
  top: string
  width: string
  height: string
} {
  const t = `${thickness}px`
  switch (edge) {
    case 'left':
      return { left: '0', top: '0', width: t, height: '100%' }
    case 'right':
      return { left: `calc(100% - ${t})`, top: '0', width: t, height: '100%' }
    case 'top':
      return { left: '0', top: '0', width: '100%', height: t }
    default:
      return { left: '0', top: `calc(100% - ${t})`, width: '100%', height: t }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
