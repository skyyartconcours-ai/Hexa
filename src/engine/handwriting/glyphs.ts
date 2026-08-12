/**
 * Hexa — typographie de sortie : mesures, nuages de points et rendu néon.
 *
 * VOIE CHOISIE POUR LE MORPH (documentée, voir aussi index.ts) : plutôt que
 * d'extraire le contour vectoriel d'une police système — opération que le
 * canvas 2D ne sait pas faire proprement, et dont la qualité dépendrait du
 * jeu de polices de la machine — on RASTÉRISE la lettre finale hors écran
 * dans la vraie police système grasse, puis on échantillonne son masque
 * alpha pour obtenir un nuage de points cible. L'encre manuscrite se
 * désagrège en particules qui viennent se ranger exactement dans la forme
 * de la lettre, et la lettre nette apparaît par-dessus en fin de course.
 *
 * Avantages : ça marche avec N'IMPORTE QUELLE police disponible, sans
 * dépendance, sans réseau ; c'est déterministe (générateur pseudo-aléatoire
 * à graine) ; et le rendu final reste du VRAI texte, donc net à toute
 * résolution, y compris pour l'export PNG 4×.
 *
 * Aucune police n'est téléchargée : on s'appuie exclusivement sur la pile
 * système. L'app fonctionne hors ligne, c'est non négociable.
 */
import { clamp, lerp, rgba, whiteMix } from '../geometry'

/** Pile 100 % système : rien à télécharger, rien à embarquer. */
export const FONT_STACK =
  "'Segoe UI Semibold', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif"

const WEIGHT = 800

/** taille de référence pour toutes les mesures et rastérisations */
const REF = 96

export const fontOf = (px: number): string => `${WEIGHT} ${px}px ${FONT_STACK}`

let measureCtx: CanvasRenderingContext2D | null = null

function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const cv = document.createElement('canvas')
    cv.width = 8
    cv.height = 8
    measureCtx = cv.getContext('2d')!
  }
  return measureCtx
}

let capRatioCache = 0

/**
 * Hauteur de capitale de la police système, rapportée à la taille de fonte.
 * Mesurée pour de vrai (et non supposée à 0,7) : c'est ce qui garantit que
 * le texte typographié occupe EXACTEMENT la place du gribouillis.
 */
export function capRatio(): number {
  if (capRatioCache) return capRatioCache
  const ctx = measurer()
  ctx.font = fontOf(REF)
  const m = ctx.measureText('H')
  const asc = m.actualBoundingBoxAscent
  capRatioCache = asc && asc > 1 ? asc / REF : 0.716
  return capRatioCache
}

/** Largeur du texte à la taille demandée. */
export function textWidth(text: string, fontSize: number): number {
  const ctx = measurer()
  ctx.font = fontOf(REF)
  return (ctx.measureText(text).width * fontSize) / REF
}

/** Abscisse de chaque lettre (crénage compris) relativement au début du mot. */
export function letterOffsets(text: string, fontSize: number): number[] {
  const ctx = measurer()
  ctx.font = fontOf(REF)
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    out.push((ctx.measureText(text.slice(0, i)).width * fontSize) / REF)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Nuage de points d'une lettre (échantillonnage du masque alpha)       */
/* ------------------------------------------------------------------ */

export interface GlyphPoint {
  /** coordonnées en unités de taille de fonte, origine = plume sur la ligne de base */
  x: number
  y: number
}

/** générateur pseudo-aléatoire déterministe (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MAX_CLOUD = 260
const cloudCache = new Map<string, GlyphPoint[]>()

let rasterCv: HTMLCanvasElement | null = null
let rasterCtx: CanvasRenderingContext2D | null = null

/**
 * Échantillonne le masque alpha de la lettre rendue dans la police système.
 * Résultat mis en cache par caractère, en unités de taille de fonte : une
 * lettre n'est jamais rastérisée deux fois de toute la session.
 */
export function glyphCloud(char: string): GlyphPoint[] {
  const hit = cloudCache.get(char)
  if (hit) return hit
  if (!rasterCv) {
    rasterCv = document.createElement('canvas')
    rasterCtx = rasterCv.getContext('2d', { willReadFrequently: true })
  }
  const ctx = rasterCtx
  const out: GlyphPoint[] = []
  if (!ctx || !rasterCv) return out

  const m0 = measurer()
  m0.font = fontOf(REF)
  const adv = Math.max(4, m0.measureText(char).width)
  const pad = Math.round(REF * 0.35)
  const w = Math.ceil(adv) + pad * 2
  const h = Math.round(REF * 2)
  const base = Math.round(REF * 1.4)
  rasterCv.width = w
  rasterCv.height = h
  ctx.clearRect(0, 0, w, h)
  ctx.font = fontOf(REF)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  ctx.fillText(char, pad, base)

  const data = ctx.getImageData(0, 0, w, h).data
  const solid: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 150) solid.push(y * w + x)
    }
  }
  if (solid.length === 0) return out
  // mélange déterministe (Fisher-Yates à graine) puis prélèvement uniforme :
  // le nuage couvre la lettre sans motif régulier visible
  const rand = rng(char.charCodeAt(0) * 2654435761)
  for (let i = solid.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = solid[i]
    solid[i] = solid[j]
    solid[j] = t
  }
  const take = Math.min(MAX_CLOUD, solid.length)
  for (let i = 0; i < take; i++) {
    const idx = solid[i]
    const px = idx % w
    const py = (idx - px) / w
    out.push({ x: (px + rand() - 0.5 - pad) / REF, y: (py + rand() - 0.5 - base) / REF })
  }
  cloudCache.set(char, out)
  return out
}

/* ------------------------------------------------------------------ */
/* Rendu néon du texte typographié                                      */
/* ------------------------------------------------------------------ */

export interface NeonTextOptions {
  text: string
  /** plume : abscisse de départ, ordonnée sur la ligne de base */
  x: number
  y: number
  fontSize: number
  color: string
  alpha: number
  /** multiplicateur de halo (intensité des effets) */
  glow: number
  /** inclinaison en tangente */
  slant: number
}

/**
 * Même recette néon que le moteur — halo large additif, halo serré, cœur
 * blanchi — mais appliquée à du texte : deux `strokeText` de plus en plus
 * serrés, puis un `fillText` dégradé du blanc chaud vers la couleur.
 */
export function renderNeonText(ctx: CanvasRenderingContext2D, o: NeonTextOptions): void {
  if (!o.text) return
  const f = o.fontSize
  ctx.save()
  ctx.translate(o.x, o.y)
  if (o.slant) ctx.transform(1, 0, -o.slant, 1, 0, 0)
  ctx.font = fontOf(f)
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.globalCompositeOperation = 'lighter'

  const g = o.glow
  ctx.strokeStyle = rgba(o.color, 0.085 * o.alpha * g)
  ctx.lineWidth = f * 0.34
  ctx.strokeText(o.text, 0, 0)
  ctx.strokeStyle = rgba(o.color, 0.16 * o.alpha * g)
  ctx.lineWidth = f * 0.17
  ctx.strokeText(o.text, 0, 0)
  ctx.strokeStyle = rgba(o.color, 0.42 * o.alpha)
  ctx.lineWidth = f * 0.06
  ctx.strokeText(o.text, 0, 0)

  const cap = capRatio() * f
  const grad = ctx.createLinearGradient(0, -cap, 0, f * 0.06)
  grad.addColorStop(0, whiteMix(o.color, 0.86, 0.98 * o.alpha))
  grad.addColorStop(0.55, whiteMix(o.color, 0.66, 0.97 * o.alpha))
  grad.addColorStop(1, whiteMix(o.color, 0.34, 0.95 * o.alpha))
  ctx.fillStyle = grad
  ctx.fillText(o.text, 0, 0)
  ctx.restore()
}

/**
 * Éclat bref au moment où une lettre se pose : un disque additif très doux,
 * qui donne le « clac » lumineux qu'on attend d'un outil premium.
 */
export function renderFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0.002) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, whiteMix(color, 0.9, 0.55 * alpha))
  grad.addColorStop(0.4, rgba(color, 0.3 * alpha))
  grad.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Interpolation douce utilisée par le morph (accélère puis freine). */
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Petit dépassement élastique à l'atterrissage. */
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5)

export { clamp, lerp }
