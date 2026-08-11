/** Outils sélectionnables. Certains produisent des annotations (StrokeTool),
 *  d'autres sont des effets vivants (laser, ping…) ou des modes (loupe, gel…). */
export type ToolId =
  | 'pen'
  | 'highlight'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'badge'
  | 'laser'
  | 'ping'
  | 'spotlight'
  | 'magnifier'
  | 'freeze'
  | 'blur'
  | 'eraser'

export type StrokeTool =
  | 'pen'
  | 'highlight'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'badge'

export interface StrokePoint {
  x: number
  y: number
  /** pression 0..1 (0.5 par défaut à la souris) */
  p: number
  /** horodatage performance.now() — sert au rejeu/export (§11 du brief) */
  t: number
}

export type DyingMode = 'dissolve' | 'pop'

export interface Stroke {
  id: number
  tool: StrokeTool
  color: string
  size: number
  points: StrokePoint[]
  simulatePressure: boolean
  done: boolean
  startedAt: number
  endedAt?: number
  /** formes : contour ou rempli */
  filled?: boolean
  /** texte : contenu (outil texte) */
  text?: string
  /** pastille numérotée */
  badge?: number
  /** timestamp auquel le trait commence à se dissoudre (mode fade auto) */
  dieAt?: number
  dying?: { start: number; duration: number; mode: DyingMode }
  /** animation d'apparition (flèches : draw-on, formes : morph…) */
  anim?: { start: number; duration: number }
}

export interface EngineOptions {
  tool: ToolId
  color: string
  size: number
  /** délai avant dissolution en ms — null = les annotations restent jusqu'au clear */
  fadeDelay: number | null
  sparkles: boolean
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  life: number
  size: number
  color: string
}

export interface LaserPoint {
  x: number
  y: number
  t: number
  pressed: boolean
}

/** Export JSON d'une session (§11 du brief) */
export interface SessionExport {
  app: 'hexa'
  version: 1
  exportedAt: string
  strokes: Stroke[]
}
