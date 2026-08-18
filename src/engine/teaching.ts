import type { Stroke } from './types'
import { clamp, dist, lerp, rgba, whiteMix } from './geometry'
import { easeOutBack, neonHead, neonStroke, partialPoly, tracePoly, traceRoundRect } from './shapes'
import type { Pt, ShapeState } from './shapes'

/**
 * Outils pédagogiques : texte lisible sur n'importe quel fond (§4.6),
 * numéroteur à pastilles reliées (§4.8), règle de mesure (§4.9)
 * et tampon d'images collées (§4.10).
 *
 * Aucune fonte externe : uniquement la pile système, l'app doit marcher
 * hors ligne.
 */

const FONT_STACK = 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif'

/**
 * Taille du texte, dérivée de l'épaisseur du trait (curseur de la barre ou
 * molette) : un seul réglage à comprendre, et il agit en direct pendant la
 * saisie. La plage était plafonnée à 62 px — trop courte pour un titre posé
 * sur une carte. De 14 à 96 px, l'épaisseur 2 → 18 couvre enfin du sous-titre
 * discret au gros mot-clé.
 */
export const textSizeOf = (size: number): number => clamp(size * 5.2, 14, 96)

/* ------------------------------------------------------------------ */
/*  Étiquette en verre dépoli (mesure, guides, angles)                 */
/* ------------------------------------------------------------------ */

export interface LabelOpts {
  align?: 'center' | 'left'
  fontSize?: number
  alpha?: number
  /** couleur d'accent du liseré et du texte */
  color: string
}

/** petite plaque sombre arrondie, liseré coloré — lisible sur tout fond */
export function glassLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  o: LabelOpts,
): void {
  const a = o.alpha ?? 1
  if (a <= 0.01) return
  const fs = o.fontSize ?? 12.5
  ctx.save()
  ctx.font = `600 ${fs}px ${FONT_STACK}`
  ctx.textBaseline = 'middle'
  const w = ctx.measureText(text).width + fs * 1.5
  const h = fs * 2
  const bx = o.align === 'left' ? x : x - w / 2
  const by = y - h / 2
  // halo diffus derrière la plaque
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = rgba(o.color, 0.1 * a)
  traceRoundRect(ctx, bx - 3, by - 3, w + 6, h + 6, h / 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(8,11,20,${0.72 * a})`
  traceRoundRect(ctx, bx, by, w, h, h / 2)
  ctx.fill()
  ctx.strokeStyle = rgba(o.color, 0.45 * a)
  ctx.lineWidth = 1
  traceRoundRect(ctx, bx + 0.5, by + 0.5, w - 1, h - 1, h / 2)
  ctx.stroke()
  ctx.fillStyle = whiteMix(o.color, 0.62, 0.98 * a)
  ctx.textAlign = 'left'
  ctx.fillText(text, bx + fs * 0.75, y + 0.5)
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  Texte avec fond arrondi automatique (§4.6)                         */
/* ------------------------------------------------------------------ */

export function renderText(ctx: CanvasRenderingContext2D, s: Stroke, st: ShapeState): void {
  const p = s.points[0]
  if (!p || !s.text) return
  const fs = textSizeOf(s.size)
  let k = 1
  if (s.anim) {
    const t = clamp((st.now - s.anim.start) / s.anim.duration, 0, 1)
    k = lerp(0.86, 1, easeOutBack(t))
  }
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.scale(k, k)
  ctx.font = `700 ${fs}px ${FONT_STACK}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const padX = fs * 0.52
  const w = ctx.measureText(s.text).width + padX * 2
  const h = fs * 1.62
  const r = h * 0.32
  const a = st.alpha
  // halo coloré diffus : le texte s'inscrit dans l'univers néon
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = rgba(s.color, 0.13 * a * st.glowBoost)
  traceRoundRect(ctx, -5, -h / 2 - 5, w + 10, h + 10, r + 5)
  ctx.fill()
  // plaque sombre : lisibilité garantie sur n'importe quel fond
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = `rgba(7,10,18,${0.7 * a})`
  traceRoundRect(ctx, 0, -h / 2, w, h, r)
  ctx.fill()
  ctx.strokeStyle = rgba(s.color, 0.5 * a)
  ctx.lineWidth = 1.2
  traceRoundRect(ctx, 0.6, -h / 2 + 0.6, w - 1.2, h - 1.2, r)
  ctx.stroke()
  // texte : cœur blanchi + très léger halo, comme les traits
  ctx.shadowColor = rgba(s.color, 0.8 * a)
  ctx.shadowBlur = fs * 0.5
  ctx.fillStyle = whiteMix(s.color, 0.72, 0.98 * a)
  ctx.fillText(s.text, padX, 1)
  ctx.restore()
}

/** boîte occupée par un texte (hit-test grab/gomme) */
export function textBox(ctx: CanvasRenderingContext2D, s: Stroke): { w: number; h: number } {
  const fs = textSizeOf(s.size)
  ctx.save()
  ctx.font = `700 ${fs}px ${FONT_STACK}`
  const w = ctx.measureText(s.text ?? '').width + fs * 1.04
  ctx.restore()
  return { w, h: fs * 1.62 }
}

/* ------------------------------------------------------------------ */
/*  Numéroteur : pastilles numérotées reliées (§4.8)                   */
/* ------------------------------------------------------------------ */

export const badgeRadius = (size: number): number => clamp(size * 2.3, 14, 30)

/** durée totale de l'animation d'une pastille (pop + trajet du lien) */
export const BADGE_ANIM = 220
export const BADGE_LINK_ANIM = 520

/**
 * Pastille : disque coloré, halo, chiffre blanc, pop élastique de 200 ms.
 * `link` = centre de la pastille précédente : une flèche fine se dessine
 * automatiquement de N vers N+1 avec l'animation de trajet (§4.2.3).
 */
export function renderBadge(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  st: ShapeState,
  link: Pt | null,
): void {
  const c = s.points[0]
  if (!c) return
  const r = badgeRadius(s.size)
  let pop = 1
  let path = 1
  if (s.anim) {
    const el = st.now - s.anim.start
    pop = easeOutBack(clamp(el / BADGE_ANIM, 0, 1))
    path = clamp((el - 120) / (BADGE_LINK_ANIM - 120), 0, 1)
  }

  // 1. le lien vers la pastille précédente, en dessous de tout
  if (link) {
    const d = dist(link.x, link.y, c.x, c.y)
    if (d > r * 2.4) {
      const from = { x: lerp(link.x, c.x, (r + 6) / d), y: lerp(link.y, c.y, (r + 6) / d) }
      const to = { x: lerp(c.x, link.x, (r + 8) / d), y: lerp(c.y, link.y, (r + 8) / d) }
      // légère courbure : le trajet respire au lieu d'être un segment sec
      const mx = (from.x + to.x) / 2
      const my = (from.y + to.y) / 2
      const nx = -(to.y - from.y) / d
      const ny = (to.x - from.x) / d
      const bow = clamp(d * 0.11, 6, 26)
      const curve: Pt[] = []
      for (let i = 0; i <= 14; i++) {
        const t = i / 14
        const u = 1 - t
        const cx = mx + nx * bow
        const cy = my + ny * bow
        curve.push({
          x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
          y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
        })
      }
      const drawn = partialPoly(curve, path)
      if (drawn.length >= 2) {
        const size = Math.max(1.6, s.size * 0.42)
        neonStroke(ctx, (cc) => tracePoly(cc, drawn, false), s.color, size, st.alpha * 0.85, st.glowBoost)
        if (path > 0.55) {
          const last = drawn[drawn.length - 1]
          const prev = drawn[drawn.length - 2]
          const ang = Math.atan2(last.y - prev.y, last.x - prev.x)
          const hk = easeOutBack(clamp((path - 0.55) / 0.45, 0, 1))
          neonHead(ctx, last, ang, size * 1.35, s.color, st.alpha * 0.9, st.glowBoost, hk)
        }
      }
    }
  }

  if (pop <= 0.01) return
  const rr = r * pop
  /**
   * JALON ou PASTILLE ? Un seul peintre, deux silhouettes.
   *
   * Les deux séries cohabitent souvent sur la même carte — un parcours au
   * numéroteur, des positions au jalon — et il faut les distinguer d'un coup
   * d'œil, à trente centimètres d'un écran de direct, sans lire les chiffres.
   * L'hexagone se lit instantanément contre le disque (et c'est la forme de
   * l'application). Rien d'autre ne change : mêmes couleurs, même halo, même
   * pop élastique.
   */
  const hexa = s.tool === 'marker'
  const contour = (rayon: number): void => {
    if (!hexa) {
      ctx.arc(c.x, c.y, rayon, 0, Math.PI * 2)
      return
    }
    // pointe en haut : la silhouette est franche même très petite
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3
      const x = c.x + Math.cos(a) * rayon
      const y = c.y + Math.sin(a) * rayon
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  ctx.save()
  // halo
  ctx.globalCompositeOperation = 'lighter'
  const grad = ctx.createRadialGradient(c.x, c.y, rr * 0.4, c.x, c.y, rr * 2.3)
  grad.addColorStop(0, rgba(s.color, 0.42 * st.alpha * st.glowBoost))
  grad.addColorStop(1, rgba(s.color, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(c.x, c.y, rr * 2.3, 0, Math.PI * 2)
  ctx.fill()
  // disque : dégradé vertical léger pour donner du volume
  ctx.globalCompositeOperation = 'source-over'
  const disc = ctx.createLinearGradient(c.x, c.y - rr, c.x, c.y + rr)
  disc.addColorStop(0, whiteMix(s.color, 0.34, 0.97 * st.alpha))
  disc.addColorStop(1, rgba(s.color, 0.95 * st.alpha))
  ctx.fillStyle = disc
  ctx.beginPath()
  contour(rr)
  ctx.fill()
  ctx.strokeStyle = `rgba(255,255,255,${0.55 * st.alpha})`
  ctx.lineWidth = Math.max(1, rr * 0.075)
  // Aux toutes premières images du pop, la pastille est plus petite que son
  // propre liseré : le rayon devient négatif, arc() lève, et l'exception tue la
  // boucle de rendu — l'overlay se fige alors JUSQU'AU REDÉMARRAGE. On ne trace
  // le liseré que lorsqu'il tient dans le disque.
  const rTrait = rr - ctx.lineWidth / 2
  if (rTrait > 0) {
    ctx.beginPath()
    contour(rTrait)
    ctx.stroke()
  }
  // chiffre
  const fs = rr * (hexa ? 1.02 : 1.12)
  ctx.font = `800 ${fs}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = `rgba(6,9,16,${0.35 * st.alpha})`
  ctx.fillText(String(s.badge ?? 1), c.x, c.y + fs * 0.09)
  ctx.fillStyle = `rgba(255,255,255,${0.99 * st.alpha})`
  ctx.fillText(String(s.badge ?? 1), c.x, c.y + fs * 0.04)
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  Reprise de la numérotation : le retour visuel du clic droit bref   */
/* ------------------------------------------------------------------ */

/** durée du signal de reprise, sur la pastille désignée */
export const REPRISE_CUE_MS = 1150

export interface RepriseCue {
  /** centre de la pastille reprise */
  x: number
  y: number
  /** rayon de cette pastille (badgeRadius de son épaisseur) */
  r: number
  color: string
  /** numéro que portera la PROCHAINE pastille */
  suivant: number
  start: number
}

/**
 * « C'est reparti d'ici, et la suivante portera ce numéro-là. »
 *
 * Le geste (clic droit BREF sur une pastille) est invisible : sans retour à
 * l'écran, l'utilisateur ne peut pas savoir s'il a été compris. On dessine
 * donc, sur la couche LIVE — celle qui se nettoie toute seule et ne part ni
 * dans l'export ni dans le calque consolidé :
 *
 *   1. une onde qui s'écarte de la pastille : le clic a été reçu ;
 *   2. un anneau qui la cercle : c'est CELLE-CI qui reprend la main ;
 *   3. une étiquette « suivante : 4 » juste au-dessus : le prochain numéro,
 *      écrit en toutes lettres, à l'endroit précis où se pose la question.
 *
 * Rien ne persiste : au bout de REPRISE_CUE_MS la boucle se rendort et
 * l'écran est net (§2.5).
 */
export function renderReprise(ctx: CanvasRenderingContext2D, cue: RepriseCue, now: number): void {
  const t = clamp((now - cue.start) / REPRISE_CUE_MS, 0, 1)
  if (t >= 1) return
  ctx.save()
  // 1. l'onde : elle part du bord de la pastille et s'éteint au tiers du temps
  const onde = clamp(t / 0.34, 0, 1)
  if (onde < 1) {
    const ro = cue.r + 3 + onde * 26
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = rgba(cue.color, 0.5 * (1 - onde))
    ctx.lineWidth = 3.2 * (1 - onde * 0.6)
    ctx.beginPath()
    ctx.arc(cue.x, cue.y, ro, 0, Math.PI * 2)
    ctx.stroke()
  }
  // 2. l'anneau de désignation : plein tout du long, il s'efface à la fin
  const a = 1 - clamp((t - 0.68) / 0.32, 0, 1)
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rgba(cue.color, 0.82 * a)
  ctx.lineWidth = 2.4
  ctx.setLineDash([5, 4])
  ctx.lineDashOffset = -now * 0.024
  ctx.beginPath()
  ctx.arc(cue.x, cue.y, cue.r + 6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
  // 3. l'étiquette, au-dessus de la pastille et JAMAIS tronquée par un bord :
  // une pastille posée dans un coin est un cas courant (on annote les coins).
  // La largeur en pixels CSS se déduit du canvas et de son échelle courante.
  const ech = ctx.getTransform().a || 1
  const large = ctx.canvas.width / ech
  const haut = cue.y - cue.r - 20
  const y = haut < 16 ? cue.y + cue.r + 20 : haut
  const x = clamp(cue.x, 74, Math.max(74, large - 74))
  glassLabel(ctx, x, y, `suivante : ${cue.suivant}`, {
    color: cue.color,
    alpha: a * (0.35 + 0.65 * clamp(t / 0.12, 0, 1)),
    fontSize: 13,
  })
}

/* ------------------------------------------------------------------ */
/*  Règle de mesure (§4.9)                                             */
/* ------------------------------------------------------------------ */

export function renderMeasure(ctx: CanvasRenderingContext2D, s: Stroke, st: ShapeState): void {
  const a = s.points[0]
  const b = s.points[s.points.length - 1]
  if (!a || !b) return
  const d = dist(a.x, a.y, b.x, b.y)
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const nx = -Math.sin(ang)
  const ny = Math.cos(ang)
  const tick = clamp(s.size * 1.6, 7, 16)
  const w = Math.max(1.4, s.size * 0.42)
  const trace = (c: CanvasRenderingContext2D) => {
    c.beginPath()
    c.moveTo(a.x, a.y)
    c.lineTo(b.x, b.y)
    c.moveTo(a.x + nx * tick, a.y + ny * tick)
    c.lineTo(a.x - nx * tick, a.y - ny * tick)
    c.moveTo(b.x + nx * tick, b.y + ny * tick)
    c.lineTo(b.x - nx * tick, b.y - ny * tick)
  }
  neonStroke(ctx, trace, s.color, w, st.alpha, st.glowBoost)
  // angle en repère écran, positif dans le sens trigonométrique
  let deg = Math.round(-ang * (180 / Math.PI))
  if (deg <= -180) deg += 360
  const label = `${Math.round(d)} px · ${deg}°`
  const off = 20
  glassLabel(ctx, (a.x + b.x) / 2 + nx * off, (a.y + b.y) / 2 + ny * off, label, {
    color: s.color,
    alpha: st.alpha,
    fontSize: 12.5,
  })
}

/* ------------------------------------------------------------------ */
/*  Tampon d'images collées (§4.10)                                    */
/* ------------------------------------------------------------------ */

/** bornes documentées : côté max 1400 px, dataURL max ~3 Mo */
export const STAMP_MAX_DIM = 1400
export const STAMP_MAX_DATAURL = 3_000_000

interface CacheEntry {
  img: HTMLImageElement
  ready: boolean
}

const imgCache = new Map<string, CacheEntry>()
let invalidate: (() => void) | null = null

/** le moteur s'abonne ici pour redessiner quand une image finit de charger */
export function setImageInvalidate(cb: (() => void) | null): void {
  invalidate = cb
}

export function getImage(src: string): HTMLImageElement | null {
  let e = imgCache.get(src)
  if (!e) {
    if (imgCache.size > 24) imgCache.delete(imgCache.keys().next().value as string)
    const img = new Image()
    const entry: CacheEntry = { img, ready: false }
    e = entry
    imgCache.set(src, entry)
    img.onload = () => {
      entry.ready = true
      invalidate?.()
    }
    img.src = src
  }
  return e.ready ? e.img : null
}

export function renderStamp(ctx: CanvasRenderingContext2D, s: Stroke, st: ShapeState): void {
  const c = s.points[0]
  const img = s.image ? getImage(s.image) : null
  if (!c || !img || !s.w || !s.h) return
  let k = 1
  if (s.anim) {
    const t = clamp((st.now - s.anim.start) / s.anim.duration, 0, 1)
    k = lerp(0.88, 1, easeOutBack(t))
  }
  const w = s.w * k
  const h = s.h * k
  const x = c.x - w / 2
  const y = c.y - h / 2
  const r = Math.min(14, Math.min(w, h) * 0.08)
  ctx.save()
  ctx.globalAlpha = st.alpha
  // halo doux : le tampon appartient à la même famille visuelle
  ctx.shadowColor = rgba(s.color, 0.55)
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 6
  traceRoundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.save()
  traceRoundRect(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.drawImage(img, x, y, w, h)
  ctx.restore()
  ctx.strokeStyle = rgba(s.color, 0.55)
  ctx.lineWidth = 1.4
  traceRoundRect(ctx, x + 0.7, y + 0.7, w - 1.4, h - 1.4, r)
  ctx.stroke()
  ctx.restore()
}

export interface StampImage {
  src: string
  w: number
  h: number
}

/** lit une image du presse-papier, la borne en taille, la sort en dataURL */
export async function imageFromClipboard(data: DataTransferItemList | null): Promise<StampImage | null> {
  if (!data) return null
  let file: File | null = null
  for (let i = 0; i < data.length; i++) {
    const it = data[i]
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      file = it.getAsFile()
      break
    }
  }
  if (!file) return null
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, STAMP_MAX_DIM / Math.max(bmp.width, bmp.height))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(bmp.width * scale))
    cv.height = Math.max(1, Math.round(bmp.height * scale))
    const cx = cv.getContext('2d')
    if (!cx) return null
    cx.drawImage(bmp, 0, 0, cv.width, cv.height)
    bmp.close()
    let src = cv.toDataURL('image/png')
    if (src.length > STAMP_MAX_DATAURL) src = cv.toDataURL('image/jpeg', 0.88)
    if (src.length > STAMP_MAX_DATAURL) return null
    // taille d'affichage par défaut : lisible sans écraser l'écran
    const disp = Math.min(1, 380 / Math.max(cv.width, cv.height))
    return { src, w: Math.round(cv.width * disp), h: Math.round(cv.height * disp) }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Champ de saisie flottant en verre dépoli (outil texte)             */
/* ------------------------------------------------------------------ */

export interface TextInputOpts {
  x: number
  y: number
  color: string
  fontSize: number
  /** la molette a changé la taille pendant la saisie : l'app suit (épaisseur) */
  onSize?: (fontSize: number) => void
}

/**
 * Ouvre un input DOM flottant. Entrée valide, Échap annule, perte de
 * focus valide. Retourne une fonction de fermeture (valide le contenu).
 */
export function openTextInput(
  stage: HTMLElement,
  o: TextInputOpts,
  onCommit: (value: string) => void,
): () => void {
  const wrap = document.createElement('div')
  wrap.className = 'hexa-text'
  wrap.style.left = `${o.x}px`
  wrap.style.top = `${o.y}px`
  wrap.style.setProperty('--c', o.color)
  const input = document.createElement('input')
  input.className = 'hexa-text-field'
  input.type = 'text'
  input.spellcheck = false
  input.autocomplete = 'off'
  input.placeholder = 'Texte…'
  input.style.fontSize = `${o.fontSize}px`
  wrap.appendChild(input)

  // Le champ épouse son contenu : une boîte large et vide au milieu de l'écran
  // pendant un live, c'est laid et ça masque le jeu. Un jumeau invisible porte
  // le même texte dans la même fonte, et sa largeur devient celle du champ.
  const ghost = document.createElement('span')
  ghost.className = 'hexa-text-ghost'
  ghost.style.fontSize = `${o.fontSize}px`
  wrap.appendChild(ghost)
  const fit = () => {
    ghost.textContent = input.value || input.placeholder
    input.style.width = `${Math.ceil(ghost.getBoundingClientRect().width) + 2}px`
  }
  input.addEventListener('input', fit)

  /* ---- réglage VISIBLE de la taille -------------------------------------
   * La molette suffisait techniquement, mais rien ne l'annonçait : personne
   * ne devine un geste invisible. Deux boutons et la valeur en clair, posés
   * contre le champ, rendent le réglage évident — et apprennent la molette
   * au passage grâce à leur info-bulle. */
  const jauge = document.createElement('div')
  jauge.className = 'hexa-text-size'
  const moins = document.createElement('button')
  moins.type = 'button'
  moins.className = 'hexa-text-size-btn'
  moins.textContent = 'A'
  moins.title = 'Réduire le texte (molette vers le bas)'
  const plus = document.createElement('button')
  plus.type = 'button'
  plus.className = 'hexa-text-size-btn is-big'
  plus.textContent = 'A'
  plus.title = 'Agrandir le texte (molette vers le haut)'
  const valeur = document.createElement('span')
  valeur.className = 'hexa-text-size-val'
  jauge.append(moins, valeur, plus)
  wrap.appendChild(jauge)

  // MOLETTE = TAILLE DU TEXTE, en direct pendant la frappe. C'est le geste
  // qu'on tente naturellement, et l'aperçu immédiat évite d'écrire, valider,
  // juger trop petit, annuler et recommencer.
  let taille = o.fontSize
  const applique = (t: number) => {
    taille = clamp(t, 14, 96)
    input.style.fontSize = `${taille}px`
    ghost.style.fontSize = `${taille}px`
    valeur.textContent = `${Math.round(taille)}`
    fit()
    o.onSize?.(taille)
  }
  const molette = (e: WheelEvent) => {
    e.preventDefault()
    applique(taille * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
  }
  wrap.addEventListener('wheel', molette, { passive: false })
  // `mousedown` plutôt que `click` : le champ perdrait le focus avant le clic,
  // ce qui validerait le texte et fermerait la saisie sous les doigts.
  const boutonTaille = (b: HTMLButtonElement, facteur: number) =>
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      applique(taille * facteur)
      input.focus()
    })
  boutonTaille(moins, 1 / 1.18)
  boutonTaille(plus, 1.18)
  valeur.textContent = `${Math.round(taille)}`

  stage.appendChild(wrap)
  fit()

  let closed = false
  const close = (commit: boolean) => {
    if (closed) return
    closed = true
    const v = input.value.trim()
    wrap.classList.add('is-out')
    // sortie en fondu : un seul timeout ponctuel, aucune boucle
    setTimeout(() => wrap.remove(), 170)
    if (commit && v) onCommit(v)
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close(false)
    }
  })
  input.addEventListener('pointerdown', (e) => e.stopPropagation())
  input.addEventListener('blur', () => close(true))
  requestAnimationFrame(() => input.focus())
  return () => close(true)
}
