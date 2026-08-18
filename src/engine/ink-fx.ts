import type { Stroke } from './types'
import { clamp, hexToRgb, lerp, rgba, whiteMix } from './geometry'

/**
 * Hexa — l'encre vivante.
 *
 * Tout ce qui fait qu'un trait d'Hexa est VIVANT, et pas un tracé mort :
 *
 *  1. ALLUMAGE — à la pose, une onde lumineuse parcourt le trait de la queue
 *     vers la tête en ~350 ms, comme un tube néon qui s'amorce, avec un léger
 *     sur-éclat qui retombe.
 *  2. PROFONDEUR — dégradé le long du trait (la tête est plus chaude que la
 *     queue) et ombre portée colorée diffuse SOUS l'encre.
 *  3. DISSOLUTION SUBLIMÉE — la queue se désagrège en fines particules qui
 *     montent et s'éteignent, la braise de tête a un cœur blanc qui palpite,
 *     et la toute fin fait un dernier micro-éclat.
 *  4. FLÈCHES — pulsation douce optionnelle (jamais par défaut : elle maintient
 *     la boucle de rendu vivante).
 *  5. LISIBILITÉ SUR FOND CLAIR — l'ombre portée s'épaissit quand le fond est
 *     lumineux ; c'est elle qui empêche le cœur blanchi du néon de délaver le
 *     trait sur un thème Glacier ou sur un jeu très clair.
 *  6. CALQUE CONSOLIDÉ — les traits posés et immobiles sont peints UNE fois
 *     dans une image hors écran, puis blittés en un seul appel. La classe est
 *     exportée : la vue OBS (src/obs/mirror.ts) en tient sa PROPRE instance,
 *     parce qu'elle a son canevas, sa matrice et son cycle de vie à elle.
 *
 * Règles tenues ici :
 *  - AUCUN état par trait : les particules de dissolution sont déterministes
 *    (hachage id+index), donc rigoureusement identiques dans l'overlay, dans le
 *    rejeu, dans la vue OBS et dans l'export PNG ;
 *  - AUCUNE boucle, AUCUN timer, AUCUNE allocation par image en régime établi :
 *    tout s'éteint tout seul, et au repos plus rien n'est appelé ;
 *  - le VECTORIEL reste la seule source de vérité : le calque n'est qu'un cache
 *    reconstructible à tout moment (annuler, changer de thème, exporter en 4K
 *    passent tous à côté et repartent des points).
 */

/** durée de l'onde d'allumage d'un trait fraîchement posé */
export const IGNITE_MS = 350

/** durée de vie d'une particule de dissolution */
const DUST_MS = 520

/** nombre de points d'émission de poussière échantillonnés par trait */
const DUST_PER_STROKE = 40

/** grains émis par point d'émission */
const GRAINS = 3

/** budget global de particules par image — un mur de traits qui meurent
 *  ensemble ne doit jamais coûter plus cher qu'un trait qui meurt seul */
const DUST_BUDGET = 900

/** période de la pulsation des flèches (mode boucle) */
const PULSE_MS = 1750

/** outils que le calque consolidé sait mettre en cache.
 *  Volontairement conservateur : pastilles (flèche de liaison qui bouge),
 *  tampons (image chargée en différé) et textes en sont exclus. */
const LAYERABLE = new Set(['pen', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'glyph'])

/* ------------------------------------------------------------------ */
/*  Réglages globaux                                                    */
/* ------------------------------------------------------------------ */

export interface InkFxTuning {
  /** intensité des effets (0,4 sobre → 1,4 spectaculaire), réglages */
  intensity: number
  /** flèches pulsantes (mode « boucle ») — coûteux, donc jamais par défaut */
  arrowPulse: boolean
}

const tuning: InkFxTuning = { intensity: 1, arrowPulse: false }
let invalidate: (() => void) | null = null
/** apparence en vigueur (thème + réglages) : si elle change, il faut repeindre */
let apparence = ''

/**
 * Le moteur s'inscrit ici pour être prévenu quand un réglage change
 * l'apparence des traits DÉJÀ POSÉS (thème clair, intensité). Sans ça, le
 * calque garderait l'ancienne peinture jusqu'au prochain geste : on verrait
 * des traits délavés juste après avoir choisi le thème Glacier.
 * Même patron que `setImageInvalidate` : un rappel, jamais une boucle.
 */
export function setInkInvalidate(cb: (() => void) | null): void {
  invalidate = cb
}

/**
 * Réglages POUSSÉS par l'application (App.tsx est déjà abonné au store).
 *
 * Le moteur ne connaît ni React ni le store : c'est ce qui permet à la source
 * navigateur d'OBS — qui partage cette recette de rendu — de se charger sans
 * embarquer la table des raccourcis et tout le schéma des réglages. Un appel
 * qui change l'apparence des traits DÉJÀ POSÉS déclenche un repeint, sinon le
 * curseur d'intensité ne se verrait qu'au trait suivant.
 */
export function setInkTuning(patch: {
  intensity?: number
  arrowPulse?: boolean
  /** identifiant du thème : sa palette change l'encre déjà posée */
  theme?: string
}): void {
  if (patch.intensity != null) tuning.intensity = clamp(patch.intensity, 0.2, 1.6)
  if (patch.arrowPulse != null) tuning.arrowPulse = patch.arrowPulse === true
  const clef = `${patch.theme ?? ''}|${tuning.intensity}|${tuning.arrowPulse}`
  if (apparence !== '' && clef !== apparence) invalidate?.()
  apparence = clef
}

export function inkFx(): InkFxTuning {
  return tuning
}

/* ------------------------------------------------------------------ */
/*  Luminosité estimée du fond (lisibilité sur fond clair)             */
/* ------------------------------------------------------------------ */

/** sentinelle : force une première lecture, même si le thème est vide */
let themeSeen = ' '
let backdrop = 0.05

function parseLum(raw: string): number {
  const c = raw.trim()
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) return backdrop
  const hex = c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c
  const [r, g, b] = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Luminosité du fond, déduite du thème actif (variable CSS `--wall-1`).
 * L'overlay est transparent : on ne peut pas mesurer le jeu qui est dessous,
 * mais le thème dit l'INTENTION de l'utilisateur (« je travaille sur du
 * clair »). Relu seulement quand le thème change — jamais à chaque image.
 */
export function backdropLum(): number {
  if (typeof document === 'undefined') return backdrop
  const t = document.documentElement.dataset.theme ?? ''
  if (t !== themeSeen) {
    themeSeen = t
    backdrop = parseLum(getComputedStyle(document.documentElement).getPropertyValue('--wall-1'))
  }
  return backdrop
}

/** 0 sur fond sombre → 1 sur fond franchement clair */
function lightness(): number {
  return clamp((backdropLum() - 0.16) / 0.5, 0, 1)
}

/**
 * Force de l'ombre portée.
 * Sur fond sombre elle reste présente mais discrète : elle sert alors contre un
 * JEU lumineux, que le thème ne connaît pas. Sur fond clair déclaré, elle
 * s'épaissit franchement — c'est ce qui empêche le cœur blanc de délaver.
 * Elle ne s'efface presque pas en mode sobre : la lisibilité n'est pas un effet.
 */
export function shadowStrength(): number {
  return lerp(0.9, 1.7, lightness()) * (0.78 + 0.22 * inkFx().intensity)
}

/**
 * Part de blanc du cœur du néon, ADAPTÉE au fond.
 *
 * Le néon d'Hexa est né pour les fonds sombres : un cœur blanchi à 62 % y fait
 * un tube incandescent. Sur un fond clair (thème Glacier, jeu lumineux), ce
 * même cœur délave le trait jusqu'à le rendre illisible. On rend alors sa
 * couleur au trait : moins de blanc, plus de pigment.
 */
export function coreMix(base: number): number {
  return lerp(base, base * 0.42, lightness())
}

/** le fond est-il assez clair pour justifier une correction de cœur ? */
export function needsCoreFix(): boolean {
  return lightness() > 0.12
}

/**
 * Repose un cœur saturé par-dessus un tracé néon déjà peint (formes, flèches
 * courbes), en `source-over` : sur fond clair, c'est ce qui empêche le blanc
 * additif de manger la couleur. Ne fait rien sur fond sombre.
 */
export function paintCoreFix(
  ctx: CanvasRenderingContext2D,
  trace: (c: CanvasRenderingContext2D) => void,
  color: string,
  size: number,
  alpha: number,
  base: number,
): void {
  if (!needsCoreFix() || alpha <= 0.02) return
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = whiteMix(color, coreMix(base), 0.92 * alpha)
  ctx.lineWidth = size
  trace(ctx)
  ctx.stroke()
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  1. Allumage                                                         */
/* ------------------------------------------------------------------ */

export interface Ignition {
  /** position de l'onde le long du trait, 0 = queue, 1 = tête */
  u: number
  /** sur-éclat global qui retombe (1 = plus rien) */
  boost: number
  /** avancement brut 0 → 1 */
  p: number
}

/**
 * État d'allumage d'un trait, ou null s'il n'y a rien à jouer.
 * Basé sur `endedAt` : aucun champ supplémentaire à sérialiser, et le rejeu
 * comme la vue OBS rejouent l'allumage exactement au même instant.
 */
export function igniteAt(s: Stroke, now: number): Ignition | null {
  const end = s.endedAt
  if (end == null || !s.done) return null
  const p = (now - end) / IGNITE_MS
  if (p < 0 || p >= 1) return null
  return {
    // à peine plus rapide au départ qu'à l'arrivée : on doit VOIR l'onde
    // parcourir le trait, pas la deviner
    u: 1 - Math.pow(1 - p, 1.5),
    boost: 1 + 0.6 * (1 - p) * (1 - p) * inkFx().intensity,
    p,
  }
}

/**
 * Onde d'allumage : trois bandes concentriques de plus en plus blanches et de
 * plus en plus courtes, promenées le long du chemin avec un pointillé animé.
 * Marche sur n'importe quel chemin (polyligne lissée, ellipse, rectangle
 * arrondi) puisqu'on ne fait que jouer avec `setLineDash`.
 */
export function paintIgnite(
  ctx: CanvasRenderingContext2D,
  trace: (c: CanvasRenderingContext2D) => void,
  len: number,
  color: string,
  size: number,
  st: Ignition,
  alpha: number,
): void {
  if (len <= 1 || alpha <= 0.02) return
  const k = inkFx().intensity
  // l'onde dépasse volontairement les deux bouts : on veut voir la tête
  // s'allumer en dernier, pas l'onde s'arrêter avant
  const band = clamp(len * 0.26, 34, 300)
  const centre = -band * 0.5 + st.u * (len + band)
  const fade = 1 - st.p * st.p * 0.65
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const pass = (frac: number, w: number, style: string, blur: number, halo: string) => {
    const l = band * frac
    ctx.setLineDash([l, len * 2 + band * 2])
    ctx.lineDashOffset = -(centre - l / 2)
    ctx.strokeStyle = style
    ctx.lineWidth = w
    // le flou de Chromium fait un VRAI dégradé : trois traits concentriques
    // laisseraient une dalle aux bords nets, ce qui se voit tout de suite
    ctx.shadowColor = halo
    ctx.shadowBlur = blur
    trace(ctx)
    ctx.stroke()
  }
  pass(
    1,
    size * 1.5,
    rgba(color, 0.3 * alpha * fade * k),
    size * 6,
    rgba(color, 0.8 * alpha * fade * k),
  )
  pass(
    0.5,
    size * 1.2,
    whiteMix(color, 0.5, 0.55 * alpha * fade * k),
    size * 2.4,
    whiteMix(color, 0.5, 0.7 * alpha * fade * k),
  )
  pass(0.22, size * 1.1, whiteMix(color, 0.95, 0.95 * alpha * fade), 0, 'rgba(0,0,0,0)')
  ctx.setLineDash([])
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  2. Profondeur : dégradé le long du trait + ombre portée            */
/* ------------------------------------------------------------------ */

export interface Pt2 {
  x: number
  y: number
}

/**
 * Dégradé de la queue vers la tête. Renvoie une couleur plate si les deux
 * bouts sont trop proches (boucle fermée) : un dégradé dégénéré ferait un
 * aplat sale.
 */
export function depthPaint(
  ctx: CanvasRenderingContext2D,
  tail: Pt2,
  head: Pt2,
  color: string,
  mix: number,
  alpha: number,
): string | CanvasGradient {
  const dx = head.x - tail.x
  const dy = head.y - tail.y
  if (dx * dx + dy * dy < 24 * 24) return whiteMix(color, mix, alpha)
  const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)
  g.addColorStop(0, whiteMix(color, mix * 0.6, alpha * 0.84))
  g.addColorStop(0.55, whiteMix(color, mix, alpha * 0.96))
  g.addColorStop(1, whiteMix(color, Math.min(1, mix * 1.2), alpha))
  return g
}

/** même dégradé, mais pour les halos (couleur pure, pas de blanc) */
export function haloPaint(
  ctx: CanvasRenderingContext2D,
  tail: Pt2,
  head: Pt2,
  color: string,
  alpha: number,
): string | CanvasGradient {
  const dx = head.x - tail.x
  const dy = head.y - tail.y
  if (dx * dx + dy * dy < 24 * 24) return rgba(color, alpha)
  const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)
  g.addColorStop(0, rgba(color, alpha * 0.68))
  g.addColorStop(1, rgba(color, alpha * 1.12))
  return g
}

/**
 * Ombre portée colorée, à peindre AVANT les passes néon.
 *
 * Trois passes concentriques en `source-over` (donc soustractives à l'écran,
 * contrairement au néon qui est additif) : sur fond sombre c'est invisible, sur
 * fond clair c'est ce qui détache le trait. La couleur est celle de l'encre
 * ramenée vers le noir : une ombre grise jurerait, une ombre teintée se lit
 * comme une profondeur.
 */
export function paintInkShadow(
  ctx: CanvasRenderingContext2D,
  trace: (c: CanvasRenderingContext2D) => void,
  color: string,
  size: number,
  alpha: number,
): void {
  const k = shadowStrength()
  if (alpha <= 0.02 || k <= 0.02) return
  const [r, g, b] = hexToRgb(color)
  const dark = (a: number) =>
    `rgba(${Math.round(r * 0.16)},${Math.round(g * 0.16)},${Math.round(b * 0.18)},${a})`
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // très léger décalage vers le bas : l'encre se pose SUR l'image
  ctx.translate(0, size * 0.16)
  const pass = (w: number, a: number) => {
    ctx.strokeStyle = dark(a * alpha * k)
    ctx.lineWidth = w
    trace(ctx)
    ctx.stroke()
  }
  // quatre passes serrées : un contour qui épouse le trait, pas une dalle
  pass(size * 2.7, 0.028)
  pass(size * 2.15, 0.036)
  pass(size * 1.7, 0.045)
  pass(size * 1.32, 0.055)
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  3. Dissolution sublimée                                             */
/* ------------------------------------------------------------------ */

/**
 * Sprite de braise, fabriqué UNE fois par couleur (7 au total) et réutilisé.
 * Un dégradé radial pré-rendu coûte un `drawImage` par particule, là où un
 * flou natif coûterait une gaussienne par particule : à 120 braises par image
 * pendant une dissolution, c'est la différence entre 60 images par seconde et
 * un diaporama.
 */
const SPRITE = 64
const sprites = new Map<string, HTMLCanvasElement>()

/**
 * Exporté : les étincelles du tracé (engine.ts) peignaient leur propre braise
 * en TROIS disques pleins concentriques — donc trois bords circulaires nets,
 * des bulles de savon empilées sur la tête du trait. Une seule recette de
 * braise pour tout le moteur, et elle fond dans le fond au lieu de le salir.
 */
export function emberSprite(color: string): HTMLCanvasElement | null {
  const hit = sprites.get(color)
  if (hit) return hit
  if (typeof document === 'undefined') return null
  const cv = document.createElement('canvas')
  cv.width = SPRITE
  cv.height = SPRITE
  const c = cv.getContext('2d')
  if (!c) return null
  const r = SPRITE / 2
  const g = c.createRadialGradient(r, r, 0, r, r, r)
  g.addColorStop(0, whiteMix(color, 0.9, 1))
  g.addColorStop(0.16, whiteMix(color, 0.4, 0.9))
  g.addColorStop(0.42, rgba(color, 0.34))
  g.addColorStop(1, rgba(color, 0))
  c.fillStyle = g
  c.fillRect(0, 0, SPRITE, SPRITE)
  sprites.set(color, cv)
  return cv
}

/** hachage déterministe (identifiant, index) → 0..1 */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** budget de particules pour l'image en cours (remis à zéro au changement d'horloge) */
let dustNow = -1
let dustLeft = DUST_BUDGET

/**
 * Poussière de dissolution : chaque point déjà consommé par la comète relâche
 * une braise qui monte, dérive et s'éteint. Entièrement déterministe : le même
 * trait produit la même poussière dans l'overlay, dans OBS et dans le rejeu.
 */
export function paintDissolveDust(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  from: number,
  p: number,
  now: number,
  duration: number,
  alpha: number,
): void {
  if (from <= 0 || p <= 0) return
  const n = s.points.length
  if (n < 3) return
  if (now !== dustNow) {
    dustNow = now
    dustLeft = DUST_BUDGET
  }
  if (dustLeft <= 0) return
  const sprite = emberSprite(s.color)
  if (!sprite) return
  const k = inkFx().intensity
  const span = Math.max(1, n - 2)
  const step = Math.max(1, Math.ceil(span / DUST_PER_STROKE))
  const scale = clamp(s.size / 6, 0.55, 2.2)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < from; i += step) {
    if (dustLeft <= 0) break
    // instant exact où la comète a mangé ce point (inverse de easeInQuad)
    const born = Math.sqrt(i / span)
    for (let grain = 0; grain < GRAINS; grain++) {
      const r0 = hash01(s.id, i * 4 + grain)
      const r1 = hash01(s.id, i * 4 + grain + 9973)
      const r2 = hash01(s.id, i * 4 + grain + 31337)
      // chaque grain part avec un léger retard : la queue s'effiloche au lieu
      // de se désintégrer d'un bloc
      const age = (p - born) * duration - r0 * 90
      if (age < 0 || age > DUST_MS) continue
      const q = age / DUST_MS
      // `alpha` est celui du trait : la poussière s'éteint AVEC lui, jamais
      // coupée net au moment où le moteur retire le trait de la liste
      const a = (1 - q) * (1 - q) * 0.95 * k * alpha
      if (a < 0.012) continue
      const pt = s.points[i]
      const t = age / 1000
      const x = pt.x + (r0 - 0.5) * s.size * 2.4 + (r1 - 0.5) * 52 * t
      // la braise MONTE : c'est ce qui donne la sensation de sublimation
      const y = pt.y + (r1 - 0.5) * s.size * 1.4 - (58 + r2 * 96) * t
      const rad = (0.75 + r0 * r0 * 2.6) * scale * (0.45 + 0.55 * (1 - q))
      const R = rad * 5
      ctx.globalAlpha = Math.min(1, a)
      ctx.drawImage(sprite, x - R, y - R, R * 2, R * 2)
      dustLeft--
    }
  }
  ctx.restore()
}

/**
 * Micro-éclat final : la toute dernière image d'un trait qui meurt.
 * Un anneau qui s'ouvre et un cœur qui s'éteint, 12 % du temps de dissolution.
 * C'est le plan le plus regardé de l'outil : il doit claquer sans tacher.
 */
export function paintLastFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
  p: number,
): void {
  if (p < 0.88) return
  const q = clamp((p - 0.88) / 0.12, 0, 1)
  const k = inkFx().intensity
  const fade = (1 - q) * (1 - q)
  const r = size * (1.1 + q * 3.4)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rgba(color, 0.5 * fade * k)
  ctx.lineWidth = Math.max(1, size * 0.34 * (1 - q))
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, size * 1.5))
  grad.addColorStop(0, whiteMix(color, 0.95, 0.95 * fade))
  grad.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, size * 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  4. Flèches : pulsation optionnelle                                 */
/* ------------------------------------------------------------------ */

/**
 * Facteur de pulsation d'une flèche posée (mode « boucle »).
 * Renvoie 1 quand l'option est coupée — donc aucun coût, et surtout aucune
 * image de rendu : c'est ce que garantit `fxKeepsAlive`.
 */
export function arrowPulseK(s: Stroke, now: number): number {
  if (!inkFx().arrowPulse || s.tool !== 'arrow' || !s.done) return 1
  const phase = ((now / PULSE_MS) % 1) * Math.PI * 2
  return 1 + 0.22 * (0.5 + 0.5 * Math.sin(phase))
}

/* ------------------------------------------------------------------ */
/*  Maintien de la boucle                                              */
/* ------------------------------------------------------------------ */

/**
 * Y a-t-il un effet d'encre vivante à animer ? Le moteur s'en sert pour deux
 * choses : redessiner la couche statique, et NE PAS s'endormir. Sans allumage
 * en cours et sans flèche pulsante, renvoie false — et la boucle s'éteint,
 * comme le veut le budget de performance.
 */
export function fxKeepsAlive(strokes: readonly Stroke[], now: number): boolean {
  const pulse = inkFx().arrowPulse
  for (const s of strokes) {
    if (igniteAt(s, now)) return true
    if (pulse && s.done && s.tool === 'arrow') return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/*  6. Calque consolidé                                                */
/* ------------------------------------------------------------------ */

/** compteurs de diagnostic (mesures de performance, tests end-to-end) */
export const fxStats = {
  /** reconstructions complètes du calque */
  rebuilds: 0,
  /** traits ajoutés au calque sans tout refaire */
  appends: 0,
  /** traits servis par le calque à la dernière image */
  layered: 0,
  /** traits redessinés à la main à la dernière image */
  direct: 0,
  /** reconstructions reparties d'un point de reprise au lieu du blanc */
  reprises: 0,
  /** durée de la dernière consolidation, en ms */
  composeMs: 0,
  /** cause de la dernière reconstruction — une reconstruction coûte cher, on
   *  doit pouvoir dire POURQUOI elle a eu lieu sans relire le code */
  raison: '',
}

/** ?inklayer=0 : désactive le calque. Sert UNIQUEMENT à mesurer son gain. */
const LAYER_OFF =
  typeof location !== 'undefined' && /[?&]inklayer=0(&|$)/.test(location.search || '')

/** au-delà, le calque coûterait plus de mémoire qu'il ne fait gagner */
const MAX_LAYER_PX = 17e6

/** traits entre deux photographies du calque (voir `noterCheckpoint`) */
const CHECKPOINT = 32

const EMPTY: ReadonlySet<number> = new Set<number>()

export interface ComposeOptions {
  /** taille de la scène en pixels CSS (sert de garde-fou et de détecteur de
   *  changement ; la taille réelle du calque est celle du canevas de l'appelant) */
  w: number
  h: number
  now: number
  /** intensité des halos, pour invalider le calque quand elle change */
  glow: number
  /** traits que l'appelant veut garder « chauds » (attrapés, en morph…) */
  hot: (s: Stroke) => boolean
  /** peinture d'un trait posé — fournie par l'appelant, pas d'import croisé */
  paint: (ctx: CanvasRenderingContext2D, s: Stroke) => void
}

/**
 * Calque consolidé des traits posés.
 *
 * Le canevas statique était redessiné INTÉGRALEMENT à chaque image dès qu'un
 * seul trait bougeait : 200 annotations = 200 recalculs de contour
 * perfect-freehand et 600 passes de halo, soixante fois par seconde.
 *
 * Ici, les traits terminés, immobiles et sans animation sont peints une fois
 * dans une image hors écran, puis restitués en UN `drawImage`. Le calque se
 * complète par la fin quand on ajoute des traits (cas normal) et ne se
 * reconstruit entièrement que si la liste change autrement (annuler, effacer,
 * dissolution, changement de thème ou de taille de fenêtre).
 *
 * Le rendu est identique au pixel près : le canevas statique est vide au
 * moment du blit, et l'ordre de peinture est conservé.
 *
 * Le calque prend la taille EXACTE du canevas de l'appelant et recopie sa
 * matrice : la restitution est alors un blit un pour un, même quand l'appelant
 * dessine avec une mise à l'échelle et un décalage (la vue OBS fait entrer un
 * écran 1440p dans une scène 1080p).
 */
export class InkLayer {
  private cv: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private ids: number[] = []
  private w = 0
  private h = 0
  /** signature de la matrice de l'appelant (échelle, décalage, densité) */
  private matrice = ''
  private glow = -1
  private theme = ' '
  private set = new Set<number>()
  /** un trait déjà consolidé a changé de contenu : il faut tout refaire */
  private refonte = false
  /** point de reprise : image du calque après ses `ckIds` premiers traits */
  private ckCv: HTMLCanvasElement | null = null
  private ckIds: number[] = []
  /** même contenu que `ckIds`, pour répondre en temps constant (voir invalider) */
  private ckSet = new Set<number>()

  /** libère le calque (destruction du moteur, ou repli en rendu direct) */
  reset(): void {
    this.ids = []
    this.set.clear()
    if (this.cv) {
      this.cv.width = 0
      this.cv.height = 0
    }
    this.cv = null
    this.ctx = null
    this.matrice = ''
    this.refonte = false
    this.oublierCheckpoint()
  }

  /**
   * Le CONTENU d'un trait déjà consolidé vient de changer sous nos pieds.
   *
   * Le moteur n'en a pas besoin : chez lui, un trait qu'on déplace est « chaud »
   * (`hot`) et n'entre jamais dans le calque. La vue OBS, elle, reçoit des
   * `stroke:update` sur des traits qui, vus du miroir, ont l'air parfaitement
   * posés : sans ce signal, le calque garderait la peinture d'AVANT le
   * déplacement et l'annotation resterait figée à l'antenne.
   */
  invalider(id: number): void {
    // ⚠️ DEUX ENSEMBLES, PAS DEUX PARCOURS. Cette méthode est appelée par la vue
    // OBS pour CHAQUE message reçu — et un seul geste du streamer (touche
    // panique, bouton « masquer ») en produit autant qu'il y a d'annotations.
    // Avec deux recherches linéaires, ce geste coûtait le carré de la taille du
    // tableau, dans le processus d'OBS lui-même. `set` reflète exactement `ids`
    // entre deux compositions, `ckSet` exactement `ckIds`.
    if (!this.set.has(id)) return
    this.refonte = true
    // le point de reprise contient peut-être ce trait : il serait périmé lui aussi
    if (this.ckSet.has(id)) this.oublierCheckpoint()
  }

  /** le point de reprise ne survit ni au changement de peau ni de taille */
  private oublierCheckpoint(): void {
    if (this.ckCv) {
      this.ckCv.width = 0
      this.ckCv.height = 0
    }
    this.ckCv = null
    this.ckIds = []
    this.ckSet.clear()
  }

  /** `ckIds` est-il exactement le début de ce qu'on veut peindre ? */
  private checkpointUtilisable(want: readonly Stroke[]): boolean {
    if (!this.ckCv || this.ckIds.length === 0 || this.ckIds.length > want.length) return false
    // une photographie prise à une autre taille se reposerait décalée : la
    // source navigateur d'OBS, elle, peut être redimensionnée à la souris
    if (this.cv && (this.ckCv.width !== this.cv.width || this.ckCv.height !== this.cv.height)) {
      return false
    }
    for (let i = 0; i < this.ckIds.length; i++) if (this.ckIds[i] !== want[i].id) return false
    return true
  }

  /**
   * Photographie le calque tous les CHECKPOINT traits.
   *
   * ⚠️ C'EST LA CLÉ DU CTRL+Z. Le calque n'est gardé que s'il est un PRÉFIXE
   * exact de ce qu'on veut peindre : la moindre annulation cassait ce préfixe
   * et forçait une reconstruction INTÉGRALE — 22 ms à 100 traits, 137 ms à 600,
   * soit une image gelée en plein direct à chaque « oups ». Avec cette
   * photographie, on repart du dernier point de reprise et on ne repeint que la
   * queue : au pire CHECKPOINT − 1 traits, quel que soit le tableau.
   * Le rendu reste identique au pixel près : l'image du point de reprise EST le
   * calque après ses `ckIds` premiers traits, peints dans le même ordre.
   */
  private noterCheckpoint(devW: number, devH: number): void {
    if (!this.cv || this.ids.length - this.ckIds.length < CHECKPOINT) return
    const cv = this.ckCv ?? document.createElement('canvas')
    if (cv.width !== devW || cv.height !== devH) {
      cv.width = devW
      cv.height = devH
    }
    const c = cv.getContext('2d')
    if (!c) return
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, devW, devH)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
    c.drawImage(this.cv, 0, 0)
    this.ckCv = cv
    this.ckIds = [...this.ids]
    this.ckSet.clear()
    for (const id of this.ckIds) this.ckSet.add(id)
  }

  /**
   * Consolide puis blitte. Renvoie l'ensemble des identifiants déjà peints :
   * l'appelant saute simplement ces traits dans sa boucle.
   */
  compose(
    ctx: CanvasRenderingContext2D,
    strokes: readonly Stroke[],
    o: ComposeOptions,
  ): ReadonlySet<number> {
    fxStats.layered = 0
    fxStats.direct = strokes.length
    if (LAYER_OFF || o.w <= 0 || o.h <= 0) return EMPTY
    const t0 = performance.now()
    const m = ctx.getTransform()
    // Le calque a EXACTEMENT les pixels du canevas de destination, et sa
    // matrice : ni la mise à l'échelle ni le centrage de la vue OBS ne peuvent
    // décaler le blit d'un demi-pixel.
    const devW = ctx.canvas.width || Math.round(o.w * (m.a || 1))
    const devH = ctx.canvas.height || Math.round(o.h * (m.d || 1))
    if (devW * devH > MAX_LAYER_PX) {
      this.reset()
      return EMPTY
    }
    const theme =
      typeof document !== 'undefined' ? (document.documentElement.dataset.theme ?? '') : ''
    // tout ce qui change l'apparence d'un trait posé invalide le calque
    const sig = `${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}`
    if (this.w !== o.w || this.h !== o.h || this.matrice !== sig) {
      this.reset()
      this.w = o.w
      this.h = o.h
      this.matrice = sig
    }
    const refonte = this.refonte
    this.refonte = false
    // INVARIANT : le contenu du calque correspond TOUJOURS exactement à
    // `this.ids`. Vider la liste sans effacer l'image repeindrait par-dessus
    // l'ancienne, en additif — le genre de bavure qu'on ne voit qu'en direct.
    let force = false
    if (this.glow !== o.glow || this.theme !== theme) {
      this.glow = o.glow
      this.theme = theme
      force = true
    }

    // 1. qui est « posé » à cette image, et dans quel ordre
    const want: Stroke[] = []
    for (const s of strokes) if (this.settled(s, o)) want.push(s)

    // 2. le calque est-il un préfixe de ce qu'on veut ? (cas normal : on a
    //    seulement ajouté des traits par la fin)
    let keep = !force && !refonte && this.ids.length <= want.length
    // index du premier désaccord, -1 s'il n'y en a pas. La RAISON n'est
    // fabriquée que le jour où une reconstruction a vraiment lieu : pas une
    // chaîne jetable par image, c'est la règle de ce fichier.
    let ecart = -1
    const avant = this.ids.length
    if (keep) {
      for (let i = 0; i < this.ids.length; i++) {
        if (this.ids[i] !== want[i].id) {
          keep = false
          ecart = i
          break
        }
      }
    }

    if (want.length === 0) {
      if (this.ids.length > 0 || force) this.clearLayer()
      this.set.clear()
      fxStats.composeMs = performance.now() - t0
      return EMPTY
    }

    const lctx = this.ensure(devW, devH, m)
    if (!lctx) {
      fxStats.composeMs = performance.now() - t0
      return EMPTY
    }
    if (!keep) {
      this.clearLayer()
      fxStats.rebuilds++
      fxStats.raison = force
        ? 'apparence'
        : refonte
          ? 'retouche'
          : ecart >= 0
            ? `ordre@${ecart}/${avant}→${want.length}`
            : `retrait ${avant}→${want.length}`
      // Reconstruction : on ne repart de la page blanche que si le point de
      // reprise ne colle pas non plus (thème changé, tableau vidé, tout début
      // de session). Sinon on le REPOSE en une image et on ne repeint que la
      // queue — c'est ce qui rend le Ctrl+Z instantané sur un grand tableau.
      if (!force && this.ckCv && this.checkpointUtilisable(want)) {
        lctx.save()
        lctx.setTransform(1, 0, 0, 1, 0, 0)
        lctx.globalCompositeOperation = 'source-over'
        lctx.globalAlpha = 1
        lctx.drawImage(this.ckCv, 0, 0)
        lctx.restore()
        this.ids = [...this.ckIds]
        fxStats.reprises++
      } else {
        this.oublierCheckpoint()
      }
    }
    for (let i = this.ids.length; i < want.length; i++) {
      o.paint(lctx, want[i])
      this.ids.push(want[i].id)
      fxStats.appends++
    }
    this.noterCheckpoint(devW, devH)

    // 3. restitution : un seul appel, en pixels périphériques, donc exacte
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.drawImage(this.cv as HTMLCanvasElement, 0, 0)
    ctx.restore()

    this.set.clear()
    for (const id of this.ids) this.set.add(id)
    fxStats.layered = this.set.size
    fxStats.direct = strokes.length - this.set.size
    fxStats.composeMs = performance.now() - t0
    return this.set
  }

  /** vide le calque ET la liste des identifiants : les deux vont ensemble */
  private clearLayer(): void {
    this.ids = []
    const c = this.ctx
    if (!c) return
    // en pixels périphériques : avec un décalage dans la matrice (vue OBS), un
    // clearRect en coordonnées de scène laisserait une bande non effacée
    c.save()
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, c.canvas.width, c.canvas.height)
    c.restore()
  }

  /** diagnostic : nombre de traits repeints à la dernière reconstruction */
  get reste(): number {
    return this.ids.length - this.ckIds.length
  }

  /** un trait est « posé » quand plus rien ne peut changer son apparence */
  private settled(s: Stroke, o: ComposeOptions): boolean {
    if (!s.done || s.dying || s.points.length === 0) return false
    if (!LAYERABLE.has(s.tool)) return false
    if (s.anim && o.now - s.anim.start < s.anim.duration + 16) return false
    if (igniteAt(s, o.now)) return false
    if (inkFx().arrowPulse && s.tool === 'arrow') return false
    return !o.hot(s)
  }

  private ensure(devW: number, devH: number, m: DOMMatrix): CanvasRenderingContext2D | null {
    if (this.ctx && this.cv && this.cv.width === devW && this.cv.height === devH) return this.ctx
    const cv = this.cv ?? document.createElement('canvas')
    cv.width = devW
    cv.height = devH
    const ctx = cv.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f)
    this.cv = cv
    this.ctx = ctx
    this.ids = []
    return ctx
  }
}

export const inkLayer = new InkLayer()

// Fenêtre de diagnostic : lecture seule, aucun effet sur le rendu. Sert aux
// mesures de performance des tests end-to-end (window.__hexaFx).
if (typeof window !== 'undefined') Object.assign(window, { __hexaFx: fxStats })
