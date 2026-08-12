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

/* ------------------------------------------------------------------ *
 * Quel ÉCRAN porte la barre (§S4.2)
 * ------------------------------------------------------------------ */

/** Le strict minimum d'un `Display` Electron : de quoi trancher, rien de plus. */
export interface DisplayLike {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
}

/**
 * Écran qui porte la barre d'outils.
 *
 * ⚠️ LE PIÈGE du multi-écrans : Hexa ouvre une fenêtre PAR ÉCRAN, et chacune
 * monte l'interface React complète. Sans désignation d'un porteur unique, la
 * barre s'afficherait sur TOUS les écrans — donc en plein milieu de celui que
 * les spectateurs regardent. C'est exactement ce qu'il ne faut pas.
 *
 * Règle : l'écran le plus à DROITE (plus grand `bounds.x`). Le streamer joue sur
 * l'écran principal et garde chat, Discord et OBS à droite ; la barre plaquée
 * contre le BORD GAUCHE de cet écran de droite se retrouve à quelques
 * centimètres de l'écran de jeu — à portée de souris, jamais par-dessus le jeu.
 *
 * Départages, dans l'ordre : le plus à droite, puis le plus grand, puis l'écran
 * principal, puis le plus petit identifiant (stable d'un lancement à l'autre).
 * Avec un seul écran, c'est forcément lui.
 *
 * ⚠️ Ce module est le SEUL endroit où cette règle est écrite : le processus
 * principal (electron/main.ts) l'importe pour décider, la page s'y réfère pour
 * l'expliquer. Deux implémentations finiraient par diverger, et l'utilisateur
 * verrait deux barres — ou aucune.
 */
export function pickToolbarHost(displays: readonly DisplayLike[], primaryId: number): number {
  if (displays.length === 0) return primaryId
  let best = displays[0]
  for (const d of displays.slice(1)) {
    if (d.bounds.x !== best.bounds.x) {
      if (d.bounds.x > best.bounds.x) best = d
      continue
    }
    const aire = d.bounds.width * d.bounds.height
    const aireBest = best.bounds.width * best.bounds.height
    if (aire !== aireBest) {
      if (aire > aireBest) best = d
      continue
    }
    if (d.id === primaryId) best = d
    else if (best.id !== primaryId && d.id < best.id) best = d
  }
  return best.id
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

/** Position de la barre : deux bords fixés, deux laissés libres. */
export interface DockPlacement {
  left: number | 'auto'
  right: number | 'auto'
  top: number | 'auto'
  bottom: number | 'auto'
}

/**
 * Position de la barre, en pixels CSS, TOUJOURS dans le cadre.
 *
 * Le côté ANCRÉ est exprimé par sa propre propriété (`right: 12px` pour un
 * ancrage à droite, jamais `left: largeur-mesurée`). C'est volontaire : le
 * navigateur connaît la largeur réelle de la barre mieux que nous, et une
 * mesure prise une image trop tôt — pendant que le thème charge, pendant la
 * transition de 180 ms des raccourcis — décollerait la barre de son bord.
 * Seule la coordonnée LE LONG du bord est calculée ici, et une erreur d'un
 * pixel y est sans conséquence.
 *
 * Le bornage final n'est pas une politesse : c'est lui qui ramène la barre à
 * l'écran quand la position mémorisée vient d'un écran qui n'existe plus.
 */
export function placeDock(
  dock: ToolbarDock,
  size: { width: number; height: number },
  view: { width: number; height: number },
  margin = EDGE_MARGIN,
): DockPlacement {
  const { width: w, height: h } = size
  const offset = Number.isFinite(dock.offset) ? Math.min(1, Math.max(0, dock.offset)) : 0.5
  const long = (span: number, taille: number) =>
    Math.round(clamp(offset * span - taille / 2, margin, Math.max(margin, span - taille - margin)))
  switch (dock.edge) {
    case 'left':
      return { left: margin, right: 'auto', top: long(view.height, h), bottom: 'auto' }
    case 'right':
      return { left: 'auto', right: margin, top: long(view.height, h), bottom: 'auto' }
    case 'top':
      return { left: long(view.width, w), right: 'auto', top: margin, bottom: 'auto' }
    default:
      return { left: long(view.width, w), right: 'auto', top: 'auto', bottom: margin }
  }
}

/** Traduction en style CSS : les `auto` doivent être écrits, pas omis. */
export function placementStyle(p: DockPlacement): Record<string, string> {
  const px = (v: number | 'auto') => (v === 'auto' ? 'auto' : `${v}px`)
  return { left: px(p.left), right: px(p.right), top: px(p.top), bottom: px(p.bottom) }
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
