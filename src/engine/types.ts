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
  | 'measure'
  | 'stamp'
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
  | 'measure'
  | 'stamp'
  /** mot typographié issu du mode écriture — jamais sélectionnable à la main */
  | 'glyph'

export interface StrokePoint {
  x: number
  y: number
  /** pression 0..1 (0.5 par défaut à la souris) */
  p: number
  /** horodatage performance.now() — sert au rejeu/export (§11 du brief) */
  t: number
}

export type DyingMode = 'dissolve' | 'pop'

/** Pourquoi ce trait est en train de mourir. Sert au rattrapage : rallonger
 *  le fondu automatique doit SAUVER un trait qui s'efface (« non, garde ça à
 *  l'écran ! »), sans jamais ressusciter ce que la gomme ou la touche panique
 *  viennent d'emporter. */
export type DyingCause = 'fade' | 'panic' | 'erase'

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
  /** pastille : id de la pastille précédente, reliée par une flèche fine (§4.8) */
  linkFrom?: number
  /** tampon d'image : dataURL bornée (voir STAMP_MAX_DATAURL) et taille d'affichage */
  image?: string
  w?: number
  h?: number
  /** tracé brut conservé quand une forme intelligente a redressé le geste :
   *  le premier Ctrl+Z le restitue au lieu de supprimer (§4.1.5) */
  raw?: StrokePoint[]
  /** mode écriture : traits manuscrits d'origine d'un mot typographié.
   *  Le premier Ctrl+Z rejoue le morph à l'envers et les rend. */
  ink?: Stroke[]
  /** mode écriture : inclinaison du mot en tangente (0 = droit) */
  slant?: number
  /** timestamp auquel le trait commence à se dissoudre (mode fade auto) */
  dieAt?: number
  dying?: { start: number; duration: number; mode: DyingMode; cause?: DyingCause }
  /** animation d'apparition (flèches : draw-on, formes : morph…)
   *  kind 'head' : le fût est déjà posé, seule la pointe éclot */
  anim?: { start: number; duration: number; kind?: 'draw' | 'head' }
}

export interface EngineOptions {
  tool: ToolId
  color: string
  size: number
  /** délai avant dissolution en ms — null = les annotations restent jusqu'au clear */
  fadeDelay: number | null
  sparkles: boolean
  /** formes intelligentes : le tracé au stylo est redressé à la fin du geste (§4.1) */
  smartShapes: boolean
  /** guides magnétiques (angles remarquables, alignements, espacement égal) */
  guides: boolean
  /** numéroteur : relier automatiquement la pastille N à N+1 */
  linkBadges: boolean
  /** intensité globale des halos néon (1 = normal, réglable 0,4 → 1,4).
   *  Optionnel : un moteur qui l'ignore reste correct. */
  effects?: number
  /** mode écriture : le gribouillis manuscrit devient une typographie nette
   *  ~600 ms après le dernier trait. Désactivé par défaut : la magie se choisit. */
  handwriting?: boolean
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
