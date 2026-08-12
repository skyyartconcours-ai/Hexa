/**
 * Hexa — mode écriture : le gribouillis devient une typographie impeccable,
 * LETTRE PAR LETTRE, PENDANT qu'on écrit la suivante.
 *
 * Enchaînement complet :
 *   1. le streamer écrit ses capitales à l'arrache pendant son live ;
 *   2. une lettre est déclarée FINIE dès que l'un des deux signaux tombe :
 *      une pause de 400 ms sans nouveau trait, ou un trait qui démarre
 *      franchement à droite du groupe courant (§ letterClosed) ;
 *   3. `recognizer.ts` ($P + carte de densité) l'identifie et donne une
 *      confiance ;
 *   4. confiance insuffisante = ON NE TOUCHE À RIEN (un faux positif détruit
 *      la confiance dans l'outil, une non-transformation ne coûte rien) ;
 *   5. sinon la lettre part immédiatement en morph : son encre se désagrège
 *      en particules qui se rangent dans la forme de la lettre typographiée,
 *      380 ms, pendant que la main écrit déjà la suivante ;
 *   6. si un trait retombe SUR une lettre déjà transformée (la barre du A
 *      posée après coup), la lettre est RATTRAPÉE : le glyphe redevient
 *      encre, le trait la rejoint, et la reconnaissance recommence.
 *
 * LE MORPH, VOIE CHOISIE : particules guidées par le masque alpha de la
 * vraie police (voir l'en-tête de glyphs.ts). Choisie parce qu'elle est
 * IRRÉPROCHABLE quelle que soit la police disponible, déterministe, sans
 * dépendance, et parce que l'état final reste du vrai texte — donc net à
 * l'export 4×, et toujours un Stroke normal : clic droit pour l'attraper,
 * gomme, fondu auto, export JSON.
 *
 * Performance : aucune boucle propre. Le module ne fait rien tant que le
 * moteur ne l'appelle pas depuis sa rAF dormante, et il dit au moteur quand
 * le réveiller (`nextDue`).
 */
import { getStroke } from 'perfect-freehand'
import type { Stroke, StrokePoint } from '../types'
import { clamp, rgba, whiteMix } from '../geometry'
import { resampleCloud, type TplPoint } from './templates'
import { recognizeChar } from './recognizer'
import {
  boxOf,
  estimateSlant,
  height,
  joins,
  merge,
  segment,
  width,
  type Box,
  type Group,
} from './layout'
import {
  capRatio,
  easeInOutCubic,
  easeOutQuint,
  glyphCloud,
  letterOffsets,
  renderFlash,
  renderNeonText,
  textWidth,
} from './glyphs'

/**
 * Pause qui clôt une LETTRE. Réglage sensible : trop court, la barre du A
 * arrive après la fermeture ; trop long, la magie se fait attendre. 400 ms
 * est le compromis mesuré — et de toute façon rattrapable (§ reopen).
 */
export const LETTER_IDLE_MS = 400
/**
 * Pause qui clôt un MOT (le lexique peut alors le corriger en entier). Bien
 * plus généreuse que la pause de fin de lettre : on hésite souvent une
 * seconde au milieu d'un nom propre, et couper le mot en deux priverait le
 * correcteur de la moitié de son contexte.
 */
const WORD_IDLE_MS = 1300
/** Fenêtre pendant laquelle une lettre déjà transformée peut être rouverte. */
const REOPEN_MS = 900
/** durée du morph d'une lettre */
const LETTER_MS = 380
/** décalage entre deux lettres (cascade, pour une réécriture de mot entier) */
const CASCADE_MS = 40
/** durée du dé-morph (premier Ctrl+Z) */
const DEMORPH_MS = 330
/** durée de vie du chip de confirmation */
const CHIP_MS = 800

/**
 * Confiance minimale pour transformer une lettre. Choisie sur la courbe
 * mesurée du banc d'essai (bench/seuil.mjs) : à 0,62 on transforme 94 % des
 * lettres et 99 % des transformations sont justes. Monter plus haut ne gagne
 * presque plus de justesse et coûte beaucoup de magie.
 */
const MIN_LETTER = 0.62
/** longueur d'encre admissible pour une lettre, en hauteurs de capitale.
 *  Un gribouillis nerveux dépasse largement : c'est le filtre le plus
 *  efficace contre les faux positifs, et il ne coûte rien. */
const INK_MIN = 0.7
const INK_MAX = 6.5
/** en dessous, l'écriture est trop petite pour être analysée sereinement */
const MIN_CAP_PX = 15
/** au-delà, ce n'est plus une lettre mais un dessin */
const MAX_STROKES_PER_LETTER = 5

export interface HwSwap {
  remove: Stroke[]
  add: Stroke[]
  /**
   * Traits du mot EN COURS dont il faut repousser le fondu automatique.
   * Sans ça, écrire « SYNDRA » avec un fondu à 4 s ferait disparaître le S
   * avant le A : tant qu'on écrit le mot, le mot entier reste vivant.
   */
  keep?: Stroke[]
}

export interface HwContext {
  /** identifiants uniques fournis par le moteur */
  nextId: () => number
  /** intensité globale des halos */
  glow: number
  /** un trait est en cours de tracé : le mot ne peut pas être déclaré fini */
  drawing?: boolean
}

/* ------------------------------------------------------------------ *
 * CONTRAT PUBLIC — le mot en cours, à destination du lexique (§S2.7)
 *
 * Le module d'écriture ne connaît aucun dictionnaire : il livre des LETTRES
 * mesurées, avec leur confiance et leur place exacte à l'écran. Un correcteur
 * lexical s'abonne à `onWord`, décide (« SYNDRA » → « Syndra »), puis appelle
 * `rewrite(id, texte)`. Rien d'autre n'est nécessaire.
 * ------------------------------------------------------------------ */

export interface HwLetter {
  /** caractère retenu ; chaîne vide si la lettre est restée en gribouillis */
  char: string
  /** confiance 0..1 rendue par le reconnaisseur */
  score: number
  /** rectangle englobant du GRIBOUILLIS d'origine, en pixels écran */
  box: Box
  /** identifiant du trait typographié posé sur la scène (null si non transformé) */
  glyphId: number | null
}

export interface HwWord {
  /** identifiant stable du mot, à repasser à `rewrite()` */
  id: number
  /** lettres dans l'ordre de lecture */
  letters: HwLetter[]
  /** concaténation brute des lettres reconnues, ex. « SYNDRA » */
  raw: string
  /** rectangle englobant du mot entier, en pixels écran */
  box: Box
  /** hauteur de capitale estimée (px) */
  capHeight: number
  /** ligne de base estimée (px) */
  baseline: number
  /** inclinaison de l'écriture (tangente) */
  slant: number
  /** couleur et épaisseur du geste, pour recomposer un mot entier */
  color: string
  size: number
  /** vrai quand le mot est terminé (longue pause, saut de ligne, mode coupé) */
  closed: boolean
}

/* ------------------------------------------------------------------ */
/* État d'animation — hors Stroke, donc jamais sérialisé               */
/* ------------------------------------------------------------------ */

interface LetterMorph {
  /** particules : positions source (encre) et cible (glyphe) */
  sx: Float32Array
  sy: Float32Array
  tx: Float32Array
  ty: Float32Array
  /** amplitude de l'écart en cloche, par particule */
  bow: Float32Array
  cx: number
  cy: number
}

interface GlyphMorph {
  stroke: Stroke
  letters: LetterMorph[]
  ink: Stroke[]
  start: number
  duration: number
  reverse: boolean
  dotSize: number
}

/** morphs en cours, indexés par identifiant de trait */
const morphs = new Map<number, GlyphMorph>()

interface Chip {
  text: string
  x: number
  y: number
  color: string
  start: number
}

/* ------------------------------------------------------------------ */
/* Encre manuscrite — même recette néon que le moteur, en local pour    */
/* éviter toute dépendance croisée entre render.ts et ce module.        */
/* ------------------------------------------------------------------ */

function neonInk(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  alpha: number,
  glow: number,
  shrink: number,
): void {
  const pts = s.points
  if (pts.length < 2 || alpha <= 0.002) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const trace = () => {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last.x, last.y)
  }
  ctx.strokeStyle = rgba(s.color, 0.13 * alpha * glow)
  ctx.lineWidth = s.size * 3.6 * shrink
  trace()
  ctx.stroke()
  ctx.strokeStyle = rgba(s.color, 0.3 * alpha * glow)
  ctx.lineWidth = s.size * 1.9 * shrink
  trace()
  ctx.stroke()
  const outline = getStroke(
    pts.map((p) => [p.x, p.y, p.p]),
    {
      size: s.size * shrink,
      thinning: 0.52,
      smoothing: 0.62,
      streamline: 0.44,
      simulatePressure: s.simulatePressure,
      last: true,
    },
  )
  if (outline.length > 2) {
    ctx.fillStyle = whiteMix(s.color, 0.62, 0.95 * alpha)
    ctx.beginPath()
    ctx.moveTo(outline[0][0], outline[0][1])
    for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1])
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Construction du morph                                                */
/* ------------------------------------------------------------------ */

/** longueur totale d'encre d'une lettre (somme des sous-tracés) */
function inkLength(paths: TplPoint[][]): number {
  let d = 0
  for (const p of paths) {
    for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
  }
  return d
}

/** clé de tri « balayage diagonal » : limite les croisements de particules */
const sweepKey = (p: { x: number; y: number }): number => p.x + p.y * 0.35

function buildLetterMorph(
  paths: TplPoint[][],
  char: string,
  penX: number,
  baseline: number,
  fontSize: number,
  slant: number,
  seed: number,
): LetterMorph | null {
  const cloud = glyphCloud(char)
  if (cloud.length === 0) return null
  const n = Math.max(48, Math.min(cloud.length, Math.round(fontSize * 2.1)))
  const src = resampleCloud(paths, n)
  if (src.length < n) return null

  const dst = cloud.slice(0, n).map((p) => {
    // l'inclinaison est appliquée aux cibles pour coller au rendu final
    const x = penX + (p.x - p.y * slant) * fontSize
    const y = baseline + p.y * fontSize
    return { x, y }
  })

  src.sort((a, b) => sweepKey(a) - sweepKey(b))
  dst.sort((a, b) => sweepKey(a) - sweepKey(b))

  const sx = new Float32Array(n)
  const sy = new Float32Array(n)
  const tx = new Float32Array(n)
  const ty = new Float32Array(n)
  const bow = new Float32Array(n)
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    sx[i] = src[i].x
    sy[i] = src[i].y
    tx[i] = dst[i].x
    ty[i] = dst[i].y
    // écart en cloche pseudo-aléatoire mais stable : le vol respire
    const r = Math.sin((i + seed) * 12.9898) * 43758.5453
    bow[i] = (r - Math.floor(r) - 0.5) * fontSize * 0.34
    cx += dst[i].x
    cy += dst[i].y
  }
  return { sx, sy, tx, ty, bow, cx: cx / n, cy: cy / n }
}

/* ------------------------------------------------------------------ */
/* Rendu d'un trait « glyphe » (appelé par engine/render.ts)            */
/* ------------------------------------------------------------------ */

export interface GlyphRenderState {
  alpha: number
  glowBoost: number
  now: number
}

/**
 * Dessine un mot typographié. Si un morph est en cours pour ce trait, on
 * dessine l'image intermédiaire (encre qui s'efface + particules en vol +
 * texte qui s'allume) ; sinon le texte net, point.
 */
export function renderGlyph(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  st: GlyphRenderState,
): void {
  const anchor = s.points[0]
  if (!anchor) return
  const fontSize = s.h ?? 40
  const m = morphs.get(s.id)
  const finalText = () =>
    renderNeonText(ctx, {
      text: s.text ?? '',
      x: anchor.x,
      y: anchor.y,
      fontSize,
      color: s.color,
      alpha: st.alpha,
      glow: st.glowBoost,
      slant: s.slant ?? 0,
    })

  if (!m) {
    finalText()
    return
  }

  const raw = clamp((st.now - m.start) / m.duration, 0, 1)
  if (!m.reverse && raw >= 1) {
    morphs.delete(s.id)
    finalText()
    return
  }
  // le dé-morph rejoue exactement le même film, à l'envers
  const dir = m.reverse ? 1 - raw : raw
  const count = m.letters.length
  const span = m.reverse ? 1 : Math.max(1e-3, LETTER_MS / m.duration)

  // 1. l'encre d'origine s'efface pendant le premier tiers
  const inkFade = clamp(1 - dir / 0.34, 0, 1)
  if (inkFade > 0.002) {
    for (const ink of m.ink) {
      neonInk(ctx, ink, inkFade * st.alpha, st.glowBoost, 0.82 + 0.18 * inkFade)
    }
  }

  // 2. les particules, lettre par lettre, en cascade
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let li = 0; li < count; li++) {
    const L = m.letters[li]
    const offset = m.reverse ? 0 : (li * CASCADE_MS) / m.duration
    const lp = clamp((dir - offset) / span, 0, 1)
    const n = L.sx.length
    // fondu des particules : présentes au décollage, éteintes à l'atterrissage
    const pAlpha = (lp < 0.08 ? lp / 0.08 : 1) * (lp > 0.7 ? clamp((1 - lp) / 0.3, 0, 1) : 1)
    if (pAlpha > 0.004) {
      for (let i = 0; i < n; i++) {
        // micro-décalage par particule : l'essaim s'étire au lieu de bloquer
        const d = ((i * 7919) % 100) / 100
        const t = clamp((lp - d * 0.2) / (1 - d * 0.2), 0, 1)
        const e = easeInOutCubic(t)
        const dx = L.tx[i] - L.sx[i]
        const dy = L.ty[i] - L.sy[i]
        const len = Math.hypot(dx, dy) || 1
        const bow = Math.sin(Math.PI * e) * L.bow[i] * 0.5
        const x = L.sx[i] + dx * e - (dy / len) * bow
        const y = L.sy[i] + dy * e + (dx / len) * bow
        const a = pAlpha * (0.35 + 0.65 * (1 - Math.abs(0.5 - e) * 1.2))
        ctx.fillStyle = whiteMix(s.color, 0.55, 0.85 * a * st.alpha)
        ctx.beginPath()
        ctx.arc(x, y, m.dotSize, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // 3. éclat bref à l'atterrissage de la lettre
    if (!m.reverse && lp > 0.62 && lp < 1) {
      const k = Math.sin(((lp - 0.62) / 0.38) * Math.PI)
      renderFlash(ctx, L.cx, L.cy, fontSize * 0.72, s.color, k * 0.7 * st.alpha)
    }
  }
  ctx.restore()

  // 4. le texte net s'allume sur la fin
  const textAlpha = easeOutQuint(clamp((dir - 0.55) / 0.4, 0, 1))
  if (textAlpha > 0.004) {
    renderNeonText(ctx, {
      text: s.text ?? '',
      x: anchor.x,
      y: anchor.y,
      fontSize,
      color: s.color,
      alpha: textAlpha * st.alpha,
      glow: st.glowBoost * (0.7 + 0.3 * textAlpha),
      slant: s.slant ?? 0,
    })
  }
}

/* ------------------------------------------------------------------ */
/* Session d'écriture                                                   */
/* ------------------------------------------------------------------ */

/** lettre déjà jugée : transformée (glyph) ou laissée en gribouillis */
interface DoneLetter {
  char: string
  score: number
  box: Box
  ink: Stroke[]
  glyph: Stroke | null
  t0: number
  t1: number
}

export class Handwriting {
  /** lettre en cours d'écriture (ses traits s'accumulent) */
  private open: Group | null = null
  /** lettres déjà jugées du mot en cours */
  private done: DoneLetter[] = []
  /** lettres closes par un geste (et non par la pause), à juger au prochain tick */
  private queue: Group[] = []
  /** échanges décidés hors tick (rattrapage), à rendre au moteur */
  private queued: HwSwap[] = []
  /** réécritures demandées par le lexique */
  private rewrites: { id: number; text: string }[] = []
  private chips: Chip[] = []
  private dueAt: number | null = null
  /** un saut de mot est à consommer une fois la lettre en attente jugée */
  private breakPending = false
  private wordSeq = 1
  private wordId = 1
  private wordClosed = false
  /** hauteur de capitale courante (px) — survit aux mots : on écrit à taille constante */
  private cap = 0
  private baseline = 0
  /** bord droit de la dernière lettre posée : sert à ne pas les empiler */
  private lastRight = 0
  private lastAt = 0

  /** le mot vient de changer (lettre ajoutée) ou d'être clos — pour le lexique */
  onWord?: (w: HwWord) => void

  /* ---------------- entrée ---------------- */

  /**
   * Un trait vient d'être terminé. Trois issues : il complète la lettre en
   * cours, il rattrape une lettre déjà transformée, ou il en ouvre une
   * nouvelle — auquel cas la précédente est close SUR-LE-CHAMP.
   */
  push(s: Stroke, now: number): void {
    const box = boxOf(s.points)
    const t0 = s.startedAt
    const cap = this.capHint(box)
    this.lastAt = now

    // 1. le trait complète la lettre en cours
    if (this.open && joins(this.open, box, t0, cap)) {
      this.open.strokes.push(s)
      this.open.box = merge(this.open.box, box)
      this.open.t1 = Math.max(this.open.t1, s.endedAt ?? now)
      this.arm(now)
      return
    }

    // 2. rattrapage : le trait retombe sur la DERNIÈRE lettre déjà jugée
    //    (barre du A, du E, du H posée après coup, point du J). On défait la
    //    transformation, le trait rejoint la lettre, tout est rejoué.
    if (!this.open && this.reopen(box, t0, now, cap)) {
      this.open!.strokes.push(s)
      this.open!.box = merge(this.open!.box, box)
      this.open!.t1 = Math.max(this.open!.t1, s.endedAt ?? now)
      this.arm(now)
      return
    }

    // 3. nouvelle lettre : la précédente est close tout de suite
    if (this.open) {
      this.queue.push(this.open)
      this.open = null
    }
    if (this.startsNewWord(box, cap)) this.breakPending = true
    this.open = { strokes: [s], box, t0, t1: s.endedAt ?? now }
    this.arm(now)
  }

  /** déclenchement manuel : la lettre en cours est jugée sans attendre */
  trigger(now: number): boolean {
    if (!this.open && this.queue.length === 0) return false
    if (this.open) {
      this.queue.push(this.open)
      this.open = null
    }
    this.dueAt = now
    return true
  }

  get hasPending(): boolean {
    return this.open != null || this.queue.length > 0
  }

  /** tout est abandonné (mode coupé, effacement panique, nouvelle session) */
  reset(): void {
    if (this.done.length > 0) this.closeWord()
    this.open = null
    this.queue = []
    this.done = []
    this.queued = []
    this.rewrites = []
    this.dueAt = null
    this.breakPending = false
    this.wordClosed = false
    this.wordId = ++this.wordSeq
    this.cap = 0
    this.baseline = 0
    this.lastRight = 0
  }

  /** prochaine échéance à programmer par le moteur (aucune boucle ici) */
  nextDue(): number | null {
    if (this.queue.length > 0 || this.queued.length > 0 || this.rewrites.length > 0) return this.lastAt
    if (this.open) return this.open.t1 + LETTER_IDLE_MS
    if (this.done.length > 0 && !this.wordClosed) return this.lastAt + WORD_IDLE_MS
    return this.dueAt
  }

  /** quelque chose bouge-t-il encore ? (morph, dé-morph, chip) */
  active(now: number): boolean {
    // +100 ms : il faut UNE image de plus après la dernière pastille dessinée,
    // sinon la boucle s'endort sur la dernière image qui la contient encore et
    // la pastille reste figée à l'écran (la couche live n'est repeinte que
    // pendant que la boucle tourne).
    for (const c of this.chips) if (now - c.start < CHIP_MS + 100) return true
    for (const m of morphs.values()) {
      if (now - m.start < m.duration) return true
    }
    return false
  }

  /**
   * Appelée à chaque image active. Renvoie les échanges de traits que le
   * moteur doit appliquer (encre → lettre, ou lettre → encre pour un Ctrl+Z).
   */
  tick(now: number, live: readonly Stroke[], ctx: HwContext): HwSwap[] {
    const swaps: HwSwap[] = []

    // dé-morphs arrivés à terme : on rend l'encre
    for (const [id, m] of morphs) {
      if (!m.reverse || now - m.start < m.duration) continue
      morphs.delete(id)
      swaps.push({ remove: [m.stroke], add: m.ink })
    }
    if (this.queued.length > 0) {
      swaps.push(...this.queued)
      this.queued = []
    }

    // lettres closes par un geste : jugées immédiatement
    while (this.queue.length > 0) {
      const g = this.queue.shift()!
      const sw = this.judge(g, now, live, ctx)
      if (sw) swaps.push(sw)
    }
    // le mot précédent était fini : on le publie avant d'entamer le suivant
    if (this.breakPending) {
      this.breakPending = false
      this.closeWord()
    }
    // lettre close par la pause
    if (this.open && now >= this.open.t1 + LETTER_IDLE_MS) {
      const g = this.open
      this.open = null
      const sw = this.judge(g, now, live, ctx)
      if (sw) swaps.push(sw)
    }
    // Mot clos par une longue pause. Jamais pendant qu'un trait s'écrit : un
    // O tracé lentement dure plus d'une seconde, et rien n'arrive dans la
    // file avant que le crayon ne se lève. Sans cette garde, le mot se
    // couperait en deux au beau milieu d'une lettre.
    if (
      !this.open &&
      !this.wordClosed &&
      !ctx.drawing &&
      this.done.length > 0 &&
      now >= this.lastAt + WORD_IDLE_MS
    ) {
      this.closeWord()
    }
    // réécritures demandées par le lexique
    while (this.rewrites.length > 0) {
      const r = this.rewrites.shift()!
      const sw = this.applyRewrite(r.id, r.text, now, live, ctx)
      if (sw) swaps.push(sw)
    }
    this.dueAt = null
    return swaps
  }

  /* ---------------- mot en cours : contrat public ---------------- */

  /** État du mot en construction (null si rien n'est en cours). */
  currentWord(): HwWord | null {
    if (this.done.length === 0) return null
    return this.snapshot(this.wordClosed)
  }

  /**
   * Remplace le mot `id` par `text` — c'est l'appel que fait le lexique une
   * fois « SYNDRA » reconnu et remis en forme en « Syndra ». Les lettres
   * posées disparaissent au profit d'un seul mot typographié, calé sur la
   * même ligne de base et la même hauteur de capitale. Renvoie false si le
   * mot n'existe plus (effacé, annulé, remplacé entre-temps).
   */
  rewrite(id: number, text: string): boolean {
    if (id !== this.wordId || this.done.length === 0) return false
    this.rewrites.push({ id, text })
    return true
  }

  private snapshot(closed: boolean): HwWord {
    let box = this.done[0].box
    for (const l of this.done) box = merge(box, l.box)
    const strokes = this.done.flatMap((l) => l.ink)
    const first = strokes.find((s) => s.color) ?? null
    return {
      id: this.wordId,
      letters: this.done.map((l) => ({
        char: l.char,
        score: l.score,
        box: l.box,
        glyphId: l.glyph ? l.glyph.id : null,
      })),
      raw: this.done.map((l) => l.char).join(''),
      box,
      capHeight: this.cap,
      baseline: this.baseline,
      slant: estimateSlant(strokes, this.cap || 24),
      color: first?.color ?? '#ffffff',
      size: strokes.reduce((a, s) => Math.max(a, s.size), 4),
      closed,
    }
  }

  private emit(closed: boolean): void {
    if (!this.onWord || this.done.length === 0) return
    this.onWord(this.snapshot(closed))
  }

  private closeWord(): void {
    if (this.done.length === 0 || this.wordClosed) return
    this.wordClosed = true
    this.lastRight = 0
    this.emit(true)
  }

  /* ---------------- segmentation en direct ---------------- */

  /** hauteur de capitale de travail : celle du mot, sinon celle du trait. */
  private capHint(box: Box): number {
    if (this.cap > 0) return this.cap
    return Math.max(12, height(box))
  }

  /** programme la prochaine échéance après un nouveau trait */
  private arm(now: number): void {
    this.dueAt = now + LETTER_IDLE_MS
  }

  /** Le trait ouvre-t-il un nouveau MOT ? (espace franc ou changement de ligne) */
  private startsNewWord(box: Box, cap: number): boolean {
    if (this.done.length === 0) return false
    let wb = this.done[0].box
    for (const l of this.done) wb = merge(wb, l.box)
    if (box.x0 > wb.x1 + cap * 0.55) return true
    if (box.x1 < wb.x0 - cap * 0.4) return true
    const yc = (box.y0 + box.y1) / 2
    const wc = (wb.y0 + wb.y1) / 2
    return Math.abs(yc - wc) > cap * 0.85
  }

  /**
   * Rattrapage : la dernière lettre jugée redevient modifiable. C'est ce qui
   * autorise l'utilisateur à poser la barre du A une demi-seconde après ses
   * deux jambes sans se retrouver avec deux caractères.
   */
  private reopen(box: Box, t0: number, now: number, cap: number): boolean {
    const last = this.done[this.done.length - 1]
    if (!last) return false
    if (now - last.t1 > REOPEN_MS) return false
    const g: Group = { strokes: last.ink, box: last.box, t0: last.t0, t1: last.t1 }
    // même critère de regroupement que pour une lettre ouverte : le résultat
    // ne doit pas dépendre du hasard d'une pause qui a fermé la lettre trop
    // tôt. Seule la fenêtre de temps est plus courte.
    if (!joins(g, box, t0, cap, REOPEN_MS)) return false
    // les traits d'encre doivent encore exister sur la scène
    if (last.ink.length === 0 || last.ink.length >= MAX_STROKES_PER_LETTER) return false
    this.done.pop()
    if (last.glyph) {
      // la lettre typographiée s'efface, son encre revient — sans animation :
      // ce qui compte, c'est la lettre corrigée qui va la remplacer
      morphs.delete(last.glyph.id)
      this.queued.push({ remove: [last.glyph], add: last.ink })
    }
    this.open = { strokes: [...last.ink], box: last.box, t0: last.t0, t1: last.t1 }
    return true
  }

  /**
   * Premier Ctrl+Z sur une lettre typographiée : on rejoue le morph à
   * l'envers, le gribouillis revient. La lettre quitte le mot en cours — le
   * reste du mot n'est pas touché, on peut réécrire la lettre par-dessus.
   */
  demorph(s: Stroke, now: number): boolean {
    if (!s.ink || s.ink.length === 0) return false
    const existing = morphs.get(s.id)
    if (existing?.reverse) return false
    const rebuilt = existing ?? this.rebuildMorph(s, now)
    if (!rebuilt) {
      return false
    }
    rebuilt.reverse = true
    rebuilt.start = now
    rebuilt.duration = DEMORPH_MS
    morphs.set(s.id, rebuilt)
    const i = this.done.findIndex((l) => l.glyph?.id === s.id)
    if (i >= 0) {
      this.done.splice(i, 1)
      if (this.done.length === 0) this.wordClosed = false
      else this.emit(this.wordClosed)
    }
    return true
  }

  /**
   * Reconstruit l'état de morph d'un mot déjà posé (cas courant : le morph
   * d'origine est terminé et a été purgé, puis l'utilisateur annule).
   */
  private rebuildMorph(s: Stroke, now: number): GlyphMorph | null {
    const text = s.text ?? ''
    const ink = s.ink ?? []
    if (!text || ink.length === 0) return null
    const anchor = s.points[0]
    const fontSize = s.h ?? 40
    const slant = s.slant ?? 0
    // cas courant du mode écriture : un seul caractère, tous les traits à lui
    const letters =
      text.length === 1
        ? [{ paths: ink.map((k) => k.points.map((p) => ({ x: p.x, y: p.y }))) }]
        : segment(ink).flatMap((w) => w.letters)
    if (letters.length !== text.length) return null
    const offsets = letterOffsets(text, fontSize)
    const built: LetterMorph[] = []
    for (let i = 0; i < letters.length; i++) {
      const lm = buildLetterMorph(
        letters[i].paths,
        text[i],
        anchor.x + offsets[i],
        anchor.y,
        fontSize,
        slant,
        i * 31 + 7,
      )
      if (!lm) return null
      built.push(lm)
    }
    return {
      stroke: s,
      letters: built,
      ink,
      start: now,
      duration: DEMORPH_MS,
      reverse: false,
      dotSize: Math.max(1.05, fontSize * 0.028),
    }
  }

  /* ---------------- jugement d'UNE lettre ---------------- */

  /**
   * Reconnaît la lettre que forment les traits de `g` et, si la confiance
   * est au rendez-vous, la remplace par sa version typographiée. Sinon le
   * gribouillis reste exactement tel qu'il est : c'est la règle d'or, un
   * faux positif coûte infiniment plus cher qu'une non-transformation.
   */
  private judge(g: Group, now: number, live: readonly Stroke[], ctx: HwContext): HwSwap | null {
    // un trait effacé, annulé ou dissous entre-temps ne doit pas ressusciter
    const ink = g.strokes.filter((s) => live.includes(s) && !s.dying)
    if (ink.length === 0) return null
    const box = boxOf(ink.flatMap((s) => s.points))
    const paths = ink.map((s) => s.points.map((p) => ({ x: p.x, y: p.y })))

    // hauteur de capitale : celle du mot si on en a une, sinon celle du trait.
    // Une lettre plate (un « - ») ne doit pas rétrécir tout le mot.
    const h = height(box)
    const cap = this.cap > 0 ? this.cap : Math.max(h, width(box) * 0.55)
    const res = this.read(paths, ink, cap)

    const letter: DoneLetter = {
      char: res?.char ?? '',
      score: res?.score ?? 0,
      box,
      ink,
      glyph: null,
      t0: g.t0,
      t1: Math.max(g.t1, now),
    }
    if (this.wordClosed) {
      // une lettre après un mot clos ouvre le mot suivant
      this.done = []
      this.wordClosed = false
      this.lastRight = 0
      this.wordId = ++this.wordSeq
    }
    if (!res) {
      this.done.push(letter)
      this.track(box, h, res)
      this.emit(false)
      return { remove: [], add: [], keep: this.alive() }
    }

    const glyph = this.place(res.char, box, h, ink, now, ctx)
    letter.glyph = glyph
    this.done.push(letter)
    this.track(box, h, res)
    this.chips.push({
      text: res.char,
      x: (box.x0 + box.x1) / 2,
      // sous la lettre : la vue reste dégagée là où la main écrit la suivante
      y: box.y1 + 30,
      color: glyph.color,
      start: now + 90,
    })
    if (this.chips.length > 5) this.chips.shift()
    this.emit(false)
    return { remove: ink, add: [glyph], keep: this.alive() }
  }

  /** tous les traits du mot en cours (lettres posées et gribouillis gardés) */
  private alive(): Stroke[] {
    const out: Stroke[] = []
    for (const l of this.done) {
      if (l.glyph) out.push(l.glyph)
      else out.push(...l.ink)
    }
    if (this.open) out.push(...this.open.strokes)
    return out
  }

  /** Met à jour hauteur de capitale et ligne de base courantes du mot. */
  private track(box: Box, h: number, res: { char: string } | null): void {
    // les lettres qui descendent sous la ligne (J, Q) ne servent pas de repère
    const descends = res != null && (res.char === 'J' || res.char === 'Q')
    if (h > 8 && (this.cap === 0 || (h > this.cap * 0.55 && h < this.cap * 1.7))) {
      this.cap = this.cap === 0 ? h : this.cap * 0.6 + h * 0.4
    }
    if (!descends) {
      this.baseline =
        this.baseline === 0 || Math.abs(box.y1 - this.baseline) > this.cap * 0.6
          ? box.y1
          : this.baseline * 0.55 + box.y1 * 0.45
    }
  }

  /** Lit une lettre ; renvoie null dès qu'un doute subsiste (§ confiance). */
  private read(
    paths: TplPoint[][],
    ink: Stroke[],
    cap: number,
  ): { char: string; score: number } | null {
    if (cap < MIN_CAP_PX) return null
    if (ink.length > MAX_STROKES_PER_LETTER) return null
    const len = inkLength(paths) / cap
    if (len < INK_MIN || len > INK_MAX) return null
    const c = recognizeChar(paths, 1)[0]
    if (!c || c.score < MIN_LETTER) return null
    return { char: c.char, score: c.score }
  }

  /**
   * Fabrique le trait typographié d'UNE lettre et lance son morph. La lettre
   * se pose exactement là où elle a été écrite : même hauteur de capitale,
   * même ligne de base, même inclinaison, centrée sur son gribouillis. Ni
   * saut de position, ni saut d'échelle — c'est ce qui fait croire à une
   * transformation et non à un remplacement.
   */
  private place(
    char: string,
    box: Box,
    h: number,
    ink: Stroke[],
    now: number,
    ctx: HwContext,
  ): Stroke {
    // hauteur de capitale de CETTE lettre : la sienne si elle est plausible,
    // celle du mot sinon (une barre écrasée ne doit pas rapetisser la lettre)
    const capPx = this.cap > 0 && (h < this.cap * 0.55 || h > this.cap * 1.7) ? this.cap : h
    const fontSize = capPx / capRatio()
    const slant = estimateSlant(ink, capPx)
    const w = textWidth(char, fontSize)
    const cx = (box.x0 + box.x1) / 2
    // centrée sur son gribouillis… mais jamais À CHEVAL sur la lettre
    // précédente : l'écriture à la main est souvent plus serrée que la chasse
    // de la police. On ne pousse que vers la droite, et seulement s'il y a
    // collision — la lettre reste là où elle a été écrite.
    let penX = cx - w / 2 + (slant * capPx) / 2
    if (this.lastRight > 0 && penX < this.lastRight) penX = this.lastRight
    this.lastRight = penX + w + fontSize * 0.02
    const baseline =
      this.baseline > 0 && Math.abs(box.y1 - this.baseline) < capPx * 0.45 ? this.baseline : box.y1
    const color = ink[0]?.color ?? '#ffffff'
    const size = ink.reduce((a, s) => Math.max(a, s.size), 4)

    const point: StrokePoint = { x: penX, y: baseline, p: 0.5, t: now }
    const glyph: Stroke = {
      id: ctx.nextId(),
      tool: 'glyph',
      color,
      size,
      points: [point],
      simulatePressure: false,
      done: true,
      startedAt: now,
      endedAt: now,
      text: char,
      w,
      h: fontSize,
      slant,
      ink,
      anim: { start: now, duration: LETTER_MS },
    }
    const paths = ink.map((s) => s.points.map((p) => ({ x: p.x, y: p.y })))
    const lm = buildLetterMorph(paths, char, penX, baseline, fontSize, slant, glyph.id * 31 + 7)
    morphs.set(glyph.id, {
      stroke: glyph,
      letters: lm ? [lm] : [],
      ink,
      start: now,
      duration: LETTER_MS,
      reverse: false,
      dotSize: Math.max(1.05, fontSize * 0.028),
    })
    return glyph
  }

  /* ---------------- réécriture par le lexique ---------------- */

  /**
   * Remplace toutes les lettres du mot par un seul mot typographié. Le
   * lexique s'en sert pour corriger la casse et l'orthographe une fois le
   * mot terminé (« SYNDRA » → « Syndra »).
   */
  private applyRewrite(
    id: number,
    text: string,
    now: number,
    live: readonly Stroke[],
    ctx: HwContext,
  ): HwSwap | null {
    if (id !== this.wordId || this.done.length === 0 || !text) return null
    const w = this.snapshot(this.wordClosed)
    const remove: Stroke[] = []
    for (const l of this.done) {
      if (l.glyph && live.includes(l.glyph)) remove.push(l.glyph)
      for (const k of l.ink) if (live.includes(k)) remove.push(k)
    }
    if (remove.length === 0) return null
    const capPx = this.cap > 0 ? this.cap : height(w.box)
    const fontSize = capPx / capRatio()
    const total = LETTER_MS + (text.length - 1) * CASCADE_MS
    const glyph: Stroke = {
      id: ctx.nextId(),
      tool: 'glyph',
      color: w.color,
      size: w.size,
      points: [{ x: w.box.x0, y: w.baseline || w.box.y1, p: 0.5, t: now }],
      simulatePressure: false,
      done: true,
      startedAt: now,
      endedAt: now,
      text,
      w: textWidth(text, fontSize),
      h: fontSize,
      slant: w.slant,
      ink: this.done.flatMap((l) => l.ink),
      anim: { start: now, duration: total },
    }
    this.done = []
    this.wordClosed = false
    this.wordId = ++this.wordSeq
    return { remove, add: [glyph] }
  }

  /* ---------------- chip de confirmation ---------------- */

  /**
   * Pastille discrète « lettre retenue », posée SOUS la lettre sur la couche
   * live (donc jamais exportée, jamais rejouée) : 800 ms, puis elle s'éteint.
   * Elle ne sert qu'à une chose, mais elle est indispensable : comprendre en
   * un coup d'œil ce que l'outil vient de décider à votre place.
   */
  renderChip(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.chips.length === 0) return
    let alive = 0
    for (const c of this.chips) {
      const age = now - c.start
      if (age > CHIP_MS) continue
      this.chips[alive++] = c
      if (age < 0) continue
      const enter = clamp(age / 150, 0, 1)
      const exit = clamp((CHIP_MS - age) / 240, 0, 1)
      const alpha = Math.min(easeOutQuint(enter), exit)
      const rise = (1 - easeOutQuint(enter)) * -7

      ctx.save()
      ctx.font = '700 15px ' + FONT_UI
      const label = c.text
      const tw = ctx.measureText(label).width
      const h = 24
      const w = Math.max(tw + 22, 30)
      const x = c.x - w / 2
      const y = c.y + rise

      // halo doux derrière la plaque
      ctx.globalCompositeOperation = 'lighter'
      const grad = ctx.createRadialGradient(c.x, y + h / 2, 2, c.x, y + h / 2, w * 0.9)
      grad.addColorStop(0, rgba(c.color, 0.2 * alpha))
      grad.addColorStop(1, rgba(c.color, 0))
      ctx.fillStyle = grad
      ctx.fillRect(x - w * 0.5, y - h, w * 2, h * 3)

      ctx.globalCompositeOperation = 'source-over'
      roundRect(ctx, x, y, w, h, 12)
      ctx.fillStyle = `rgba(8,10,16,${0.86 * alpha})`
      ctx.fill()
      ctx.strokeStyle = rgba(c.color, 0.75 * alpha)
      ctx.lineWidth = 1.4
      ctx.stroke()

      ctx.fillStyle = whiteMix(c.color, 0.72, 0.98 * alpha)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText(label, c.x, y + h / 2 + 0.5)
      ctx.restore()
    }
    this.chips.length = alive
  }
}

const FONT_UI =
  "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif"

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

/** Le trait `s` est-il en cours de morph ? (le moteur y regarde pour les hit-tests) */
export function isMorphing(id: number): boolean {
  return morphs.has(id)
}

/** Purge totale (effacement panique, destruction du moteur). */
export function clearMorphs(): void {
  morphs.clear()
}
