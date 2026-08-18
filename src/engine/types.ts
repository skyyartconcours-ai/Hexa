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

/**
 * CE QUE LE MOTEUR REMET AU MIROIR À CHAQUE IMAGE ACTIVE.
 *
 * ⚠️ C'EST LA PIÈCE QUI REND LE COÛT PAR IMAGE INDÉPENDANT DE LA SESSION.
 *
 * Avant, le miroir recevait la scène entière et devait DEVINER ce qui avait
 * changé : il relisait les dix-huit champs de chaque trait, trente fois par
 * seconde. Un tableau blanc de deux mille annotations coûtait donc trente-six
 * mille comparaisons par seconde pour découvrir que rien n'avait bougé — et ce
 * coût grimpait avec le remplissage de la scène, c'est-à-dire avec la durée du
 * direct. C'est exactement la dégradation que décrivent les streamers.
 *
 * Le moteur sait, lui, ce qu'il vient de toucher : il le DIT. Le miroir ne
 * regarde plus que ça. Un trait terminé, immobile et déjà envoyé n'est plus
 * jamais relu — jamais.
 *
 * Les deux ensembles ne valent que pour L'IMAGE EN COURS : le moteur les vide
 * juste après l'appel. Un consommateur qui s'échantillonne plus lentement (le
 * miroir OBS ne balaie qu'à 30 Hz) doit donc les ACCUMULER de son côté, ce qui
 * ne coûte que le changement lui-même.
 */
export interface MirrorDelta {
  /** traits vivants, propriété du moteur : à lire, jamais à modifier */
  strokes: readonly Stroke[]
  /** trait en cours de tracé, hors de `strokes` tant qu'il n'est pas fini */
  current: Stroke | null
  /** traits apparus ou modifiés depuis l'image précédente */
  changed: ReadonlySet<Stroke>
  /** identifiants sortis de la scène depuis l'image précédente */
  gone: ReadonlySet<number>
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
  /**
   * Masquer TOUTES les annotations sans les perdre.
   *
   * Le geste « je montre, je cache, je remontre » : rien n'est effacé, le
   * fondu automatique est SUSPENDU pendant la coupure (sinon les annotations
   * mourraient en douce pendant qu'on ne les voit pas, et l'on retrouverait
   * un écran vide en les rallumant), et la couche redevenue vide laisse la
   * fenêtre se retirer — donc coût nul pendant la coupure.
   */
  annotationsHidden: boolean
  /**
   * Numéroteur : poursuivre la numérotation d'une couleur à l'autre.
   *
   * COUPÉ par défaut, donc chaque couleur repart de 1. C'est la façon dont on
   * annote une carte : un parcours cyan 1→7 pour une équipe, un parcours rose
   * 1→6 pour l'autre. Activé, les pastilles s'enchaînent sans se soucier de la
   * couleur, pour numéroter une longue séquence en changeant de teinte.
   */
  badgeContinuous: boolean
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
