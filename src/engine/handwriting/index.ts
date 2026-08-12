/**
 * Hexa — mode écriture : le gribouillis devient une typographie impeccable.
 *
 * Enchaînement complet :
 *   1. le streamer écrit à l'arrache pendant son live ;
 *   2. ~600 ms sans nouveau trait (ou raccourci manuel) déclenchent l'analyse ;
 *   3. `layout.ts` regroupe les traits en lettres / mots / lignes ;
 *   4. `recognizer.ts` ($P) identifie chaque lettre et donne une confiance ;
 *   5. confiance insuffisante = ON NE TOUCHE À RIEN (un faux positif détruit
 *      la confiance dans l'outil, une non-transformation ne coûte rien) ;
 *   6. sinon le mot part en morph : l'encre se désagrège en particules qui
 *      se rangent dans la forme des lettres de la police système, lettre
 *      par lettre en cascade, puis le texte net s'allume.
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
import { segment, type Word } from './layout'
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

/** délai d'inactivité avant transformation automatique */
export const IDLE_MS = 600
/** durée du morph d'une lettre */
const LETTER_MS = 450
/** décalage entre deux lettres (cascade) */
const CASCADE_MS = 40
/** durée du dé-morph (premier Ctrl+Z) */
const DEMORPH_MS = 330
/** durée de vie du chip de confirmation */
const CHIP_MS = 1150

/** confiance minimale d'une lettre isolée dans un mot de plusieurs lettres */
const MIN_LETTER = 0.52
/** confiance moyenne minimale sur le mot */
const MIN_WORD = 0.64
/** un mot d'UNE seule lettre est bien plus risqué : on exige beaucoup plus.
 *  Un rond isolé reste un rond ; deux lettres côte à côte, c'est un mot. */
const MIN_SINGLE = 0.8
/** longueur d'encre admissible pour une lettre, en hauteurs de capitale.
 *  Un gribouillis nerveux dépasse largement : c'est le filtre le plus
 *  efficace contre les faux positifs, et il ne coûte rien. */
const INK_MIN = 0.7
const INK_MAX = 6.5
/** en dessous, l'écriture est trop petite pour être analysée sereinement */
const MIN_CAP_PX = 15

export interface HwSwap {
  remove: Stroke[]
  add: Stroke[]
}

export interface HwContext {
  /** identifiants uniques fournis par le moteur */
  nextId: () => number
  /** intensité globale des halos */
  glow: number
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

export class Handwriting {
  /** traits au stylo en attente d'analyse */
  private pending: Stroke[] = []
  private dueAt: number | null = null
  private chip: Chip | null = null

  /** un trait vient d'être terminé : il rejoint la file et relance le compte à rebours */
  push(s: Stroke, now: number): void {
    this.pending.push(s)
    this.dueAt = now + IDLE_MS
  }

  /** raccourci de déclenchement manuel : on n'attend pas les 600 ms */
  trigger(now: number): boolean {
    if (this.pending.length === 0) return false
    this.dueAt = now
    return true
  }

  get hasPending(): boolean {
    return this.pending.length > 0
  }

  /** file vidée (mode désactivé, effacement panique, changement de session) */
  reset(): void {
    this.pending = []
    this.dueAt = null
  }

  /** prochaine échéance à programmer par le moteur (aucune boucle ici) */
  nextDue(): number | null {
    return this.dueAt
  }

  /** quelque chose bouge-t-il encore ? (morph, dé-morph, chip) */
  active(now: number): boolean {
    if (this.chip && now - this.chip.start < CHIP_MS) return true
    for (const m of morphs.values()) {
      if (now - m.start < m.duration) return true
    }
    return false
  }

  /**
   * Appelée à chaque image active. Renvoie les échanges de traits que le
   * moteur doit appliquer (encre → texte, ou texte → encre pour un Ctrl+Z).
   */
  tick(now: number, live: readonly Stroke[], ctx: HwContext): HwSwap[] {
    const swaps: HwSwap[] = []

    // dé-morphs arrivés à terme : on rend l'encre
    for (const [id, m] of morphs) {
      if (!m.reverse || now - m.start < m.duration) continue
      morphs.delete(id)
      swaps.push({ remove: [m.stroke], add: m.ink })
    }

    if (this.dueAt != null && now >= this.dueAt) {
      this.dueAt = null
      // un trait effacé, annulé ou dissous entre-temps ne doit pas ressusciter
      const alive = this.pending.filter((s) => live.includes(s) && !s.dying)
      this.pending = []
      if (alive.length > 0) swaps.push(...this.transcribe(alive, now, ctx))
    }
    return swaps
  }

  /** premier Ctrl+Z sur un mot typographié : on rejoue le morph à l'envers */
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
    const words = segment(ink)
    if (words.length === 0) return null
    // on ré-associe les lettres du mot à leurs traits, dans l'ordre de lecture
    const letters = words.flatMap((w) => w.letters)
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

  /* ---------------- reconnaissance d'une volée de traits ---------------- */

  private transcribe(strokes: Stroke[], now: number, ctx: HwContext): HwSwap[] {
    const swaps: HwSwap[] = []
    for (const w of segment(strokes)) {
      const res = this.readWord(w)
      if (!res) continue
      swaps.push(this.buildWord(w, res.text, now, ctx))
    }
    return swaps
  }

  /** Lit un mot ; renvoie null dès qu'un doute subsiste (§ confiance). */
  private readWord(w: Word): { text: string; score: number } | null {
    if (w.capHeight < MIN_CAP_PX) return null
    if (w.letters.length > 14) return null
    let text = ''
    let sum = 0
    let worst = 1
    for (const l of w.letters) {
      if (l.strokes.length > 5) return null
      const ink = inkLength(l.paths) / w.capHeight
      if (ink < INK_MIN || ink > INK_MAX) return null
      const cands = recognizeChar(l.paths, 1)
      if (cands.length === 0) return null
      const c = cands[0]
      text += c.char
      sum += c.score
      worst = Math.min(worst, c.score)
    }
    const mean = sum / w.letters.length
    if (w.letters.length === 1) {
      if (mean < MIN_SINGLE) return null
    } else if (mean < MIN_WORD || worst < MIN_LETTER) {
      return null
    }
    return { text, score: mean }
  }

  /** Fabrique le trait typographié et lance son morph. */
  private buildWord(w: Word, text: string, now: number, ctx: HwContext): HwSwap {
    const ink = w.letters.flatMap((l) => l.strokes)
    const fontSize = w.capHeight / capRatio()
    const width = textWidth(text, fontSize)
    // on garde la ligne de base et l'échelle du geste, et on recentre le mot
    // sur son gribouillis : ni saut ni dérive, la lettre atterrit « là »
    const cx = (w.box.x0 + w.box.x1) / 2
    const penX = cx - width / 2 + (w.slant * w.capHeight) / 2
    const baseline = w.baseline
    const color = ink[0]?.color ?? '#ffffff'
    const size = ink.reduce((a, s) => Math.max(a, s.size), 4)

    const point: StrokePoint = { x: penX, y: baseline, p: 0.5, t: now }
    const total = LETTER_MS + (text.length - 1) * CASCADE_MS
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
      text,
      w: width,
      h: fontSize,
      slant: w.slant,
      ink,
      anim: { start: now, duration: total },
    }

    const offsets = letterOffsets(text, fontSize)
    const letters: LetterMorph[] = []
    for (let i = 0; i < w.letters.length; i++) {
      const lm = buildLetterMorph(
        w.letters[i].paths,
        text[i],
        penX + offsets[i],
        baseline,
        fontSize,
        w.slant,
        i * 31 + 7,
      )
      if (lm) letters.push(lm)
    }
    morphs.set(glyph.id, {
      stroke: glyph,
      letters,
      ink,
      start: now,
      duration: total,
      reverse: false,
      dotSize: Math.max(1.05, fontSize * 0.028),
    })

    this.chip = { text, x: cx, y: w.box.y0 - 16, color, start: now + 120 }
    return { remove: ink, add: [glyph] }
  }

  /* ---------------- chip de confirmation ---------------- */

  /**
   * Petit bandeau discret « mot reconnu », sur la couche live (donc jamais
   * exporté, jamais dans le rejeu) : une seconde, puis il s'éteint.
   */
  renderChip(ctx: CanvasRenderingContext2D, now: number): void {
    const c = this.chip
    if (!c) return
    const age = now - c.start
    if (age < 0) return
    if (age > CHIP_MS) {
      this.chip = null
      return
    }
    const enter = clamp(age / 170, 0, 1)
    const exit = clamp((CHIP_MS - age) / 260, 0, 1)
    const alpha = Math.min(easeOutQuint(enter), exit)
    const rise = (1 - easeOutQuint(enter)) * 9

    ctx.save()
    ctx.font = '600 13px ' + FONT_UI
    const label = c.text
    const tw = ctx.measureText(label).width
    const padX = 11
    const h = 26
    const w = tw + padX * 2 + 16
    const x = c.x - w / 2
    const y = c.y - h + rise

    // halo doux derrière la plaque
    ctx.globalCompositeOperation = 'lighter'
    const grad = ctx.createRadialGradient(c.x, y + h / 2, 2, c.x, y + h / 2, w * 0.8)
    grad.addColorStop(0, rgba(c.color, 0.22 * alpha))
    grad.addColorStop(1, rgba(c.color, 0))
    ctx.fillStyle = grad
    ctx.fillRect(x - w * 0.4, y - h, w * 1.8, h * 3)

    ctx.globalCompositeOperation = 'source-over'
    roundRect(ctx, x, y, w, h, 13)
    ctx.fillStyle = `rgba(10,12,18,${0.66 * alpha})`
    ctx.fill()
    ctx.strokeStyle = rgba(c.color, 0.5 * alpha)
    ctx.lineWidth = 1
    ctx.stroke()

    // pastille lumineuse
    ctx.fillStyle = whiteMix(c.color, 0.35, 0.95 * alpha)
    ctx.beginPath()
    ctx.arc(x + padX + 3, y + h / 2, 3.2, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = `rgba(255,255,255,${0.92 * alpha})`
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + padX + 14, y + h / 2 + 0.5)
    ctx.restore()
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
