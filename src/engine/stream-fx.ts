/* ============================================================
   Hexa — effets « stream » et outils pédagogiques posés à l'écran
   (brief §5.2 spotlight · §5.8.1 grille · §5.8.2 chrono · §5.8.3 notes)

   Ce module est volontairement PUR : aucune boucle, aucun timer,
   aucun accès au DOM global. Il décrit des formes et des états ; ce
   sont le moteur (voile du spotlight) et StageWidgets (grille, chrono,
   notes) qui les peignent. C'est ce qui garantit la règle d'or :
   au repos, rien ne tourne.
   ============================================================ */

import { clamp, rgba } from './geometry'

/* ------------------------------------------------------------------ *
 * 1. Spotlight (§5.2) — trois variantes : disque suiveur, rectangle
 *    tracé à la volée, forme libre au lasso.
 * ------------------------------------------------------------------ */

export interface SpotPoint {
  x: number
  y: number
}

/** Zone éclairée figée par un geste. `null` côté moteur = disque suiveur. */
export interface SpotRegion {
  shape: 'rect' | 'lasso'
  /** rectangle : deux coins opposés, dans n'importe quel ordre */
  a?: SpotPoint
  b?: SpotPoint
  /** lasso : polygone refermé automatiquement */
  path?: SpotPoint[]
}

/** largeur du dégradé de bord — jamais de bord net (§5.2) */
export const SPOT_FEATHER = 40
/** en dessous, le geste n'est pas un tracé : on revient au disque suiveur */
export const SPOT_MIN_DRAG = 14
/** un lasso reste borné : au-delà on décime, la forme ne change pas à l'œil */
const LASSO_MAX_POINTS = 260
/** distance minimale entre deux points du lasso (lissage à la source) */
const LASSO_STEP = 3.5

/** ajoute un point au lasso en cours, en gardant le tracé borné et lisse */
export function pushLassoPoint(path: SpotPoint[], p: SpotPoint): void {
  const last = path[path.length - 1]
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < LASSO_STEP) return
  path.push({ x: p.x, y: p.y })
  if (path.length > LASSO_MAX_POINTS) {
    // décimation un point sur deux : la silhouette est conservée
    for (let i = path.length - 2; i > 0; i -= 2) path.splice(i, 1)
  }
}

/** boîte englobante d'une zone — sert de pivot à l'animation d'ouverture */
function regionBox(region: SpotRegion): { x0: number; y0: number; x1: number; y1: number } {
  if (region.shape === 'rect' && region.a && region.b) {
    return {
      x0: Math.min(region.a.x, region.b.x),
      y0: Math.min(region.a.y, region.b.y),
      x1: Math.max(region.a.x, region.b.x),
      y1: Math.max(region.a.y, region.b.y),
    }
  }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of region.path ?? []) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0 }
  return { x0, y0, x1, y1 }
}

/** la zone a-t-elle une surface exploitable ? (un clic sec n'en est pas une) */
export function regionUsable(region: SpotRegion): boolean {
  const b = regionBox(region)
  if (region.shape === 'lasso' && (region.path?.length ?? 0) < 4) return false
  return b.x1 - b.x0 >= SPOT_MIN_DRAG || b.y1 - b.y0 >= SPOT_MIN_DRAG
}

/** trace le contour de la zone, dilaté de `grow` px et mis à l'échelle `k` */
function tracePath(
  ctx: CanvasRenderingContext2D,
  region: SpotRegion,
  k: number,
  grow: number,
): void {
  const b = regionBox(region)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  const sx = (x: number): number => cx + (x - cx) * k
  const sy = (y: number): number => cy + (y - cy) * k
  ctx.beginPath()
  if (region.shape === 'rect') {
    const x0 = sx(b.x0) - grow
    const y0 = sy(b.y0) - grow
    const w = (b.x1 - b.x0) * k + grow * 2
    const h = (b.y1 - b.y0) * k + grow * 2
    // coins arrondis : un rectangle de lumière à angles vifs fait « capture
    // d'écran », pas « projecteur »
    const r = Math.min(18, w / 2, h / 2)
    ctx.roundRect(x0, y0, Math.max(1, w), Math.max(1, h), Math.max(0, r))
    return
  }
  const path = region.path ?? []
  if (path.length === 0) return
  // Le lasso est refermé et lissé par des quadratiques passant au milieu des
  // segments : le tracé à main levée devient une silhouette souple.
  const pts = path.map((p) => ({ x: sx(p.x), y: sy(p.y) }))
  const mid = (i: number, j: number): SpotPoint => ({
    x: (pts[i].x + pts[j].x) / 2,
    y: (pts[i].y + pts[j].y) / 2,
  })
  if (pts.length < 3) {
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    return
  }
  const m0 = mid(pts.length - 1, 0)
  ctx.moveTo(m0.x, m0.y)
  for (let i = 0; i < pts.length; i++) {
    const next = (i + 1) % pts.length
    const m = mid(i, next)
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y)
  }
  ctx.closePath()
}

export interface VeilOptions {
  /** couleur d'accent (liseré chaud du bord) */
  accent: string
  /** intensité globale des halos (réglage utilisateur) */
  boost: number
  /** opacité du voile, 0 → 1 (animation d'ouverture/fermeture) */
  alpha: number
  /** facteur d'échelle animé (dépassement élastique à l'ouverture) */
  scale: number
}

/**
 * Peint le voile sombre percé d'un trou à bord dégradé.
 *
 * `region` nul = disque suiveur au curseur (variante par défaut). Le trou est
 * toujours DÉGRADÉ : disque par gradient radial, rectangle et lasso par un
 * flou de composition. Aucun bord net, jamais (§5.2).
 */
export function paintVeil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  region: SpotRegion | null,
  cursor: SpotPoint,
  radius: number,
  o: VeilOptions,
): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = `rgba(3, 5, 12, ${0.7 * o.alpha})`
  ctx.fillRect(0, 0, w, h)

  if (!region) {
    // ---- disque suiveur : dégradé radial sur SPOT_FEATHER px ----
    const x = cursor.x
    const y = cursor.y
    const r = Math.max(28, radius * (0.6 + 0.4 * o.scale))
    const inner = Math.max(4, r - SPOT_FEATHER)
    const hole = ctx.createRadialGradient(x, y, inner, x, y, r)
    hole.addColorStop(0, 'rgba(0,0,0,1)')
    hole.addColorStop(0.5, 'rgba(0,0,0,0.78)')
    hole.addColorStop(0.8, 'rgba(0,0,0,0.3)')
    hole.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // deux touches de lumière très légères : liseré chaud au bord, voile clair
    // au centre — comme un vrai faisceau, jamais un cercle net
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const ring = ctx.createRadialGradient(x, y, inner * 0.9, x, y, r * 1.04)
    ring.addColorStop(0, rgba(o.accent, 0))
    ring.addColorStop(0.9, rgba(o.accent, 0.07 * o.alpha * o.boost))
    ring.addColorStop(1, rgba(o.accent, 0))
    ctx.fillStyle = ring
    ctx.beginPath()
    ctx.arc(x, y, r * 1.04, 0, Math.PI * 2)
    ctx.fill()
    const lift = ctx.createRadialGradient(x, y, 0, x, y, inner)
    lift.addColorStop(0, `rgba(255,255,255,${0.05 * o.alpha})`)
    lift.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = lift
    ctx.beginPath()
    ctx.arc(x, y, inner, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  // ---- rectangle / lasso : trou percé au flou de composition ----
  const k = Math.max(0.05, o.scale)
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  if (canBlur(ctx)) {
    // un seul passage flouté : le bord fond sur ~SPOT_FEATHER px
    ctx.filter = `blur(${SPOT_FEATHER * 0.42}px)`
    tracePath(ctx, region, k, -SPOT_FEATHER * 0.36)
    ctx.fill()
    ctx.filter = 'none'
  } else {
    // repli sans filtre : quelques passages concentriques de plus en plus
    // opaques reconstituent le dégradé (aucun bord net non plus)
    const steps = 9
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1)
      ctx.globalAlpha = 0.16 + 0.84 * t * t
      tracePath(ctx, region, k, -SPOT_FEATHER * t)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()

  // liseré chaud, très discret, posé sur le bord de la zone
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rgba(o.accent, 0.16 * o.alpha * o.boost)
  ctx.lineWidth = 2
  if (canBlur(ctx)) ctx.filter = `blur(${SPOT_FEATHER * 0.2}px)`
  tracePath(ctx, region, k, -SPOT_FEATHER * 0.3)
  ctx.stroke()
  ctx.filter = 'none'
  ctx.restore()
}

/** le contexte sait-il flouter ? (Chromium : oui — le repli reste pour les autres) */
function canBlur(ctx: CanvasRenderingContext2D): boolean {
  return typeof ctx.filter === 'string'
}

/**
 * Aperçu du geste en cours (rectangle ou lasso pas encore relâché) : un simple
 * contour pointillé sur le calque vif. Le voile, lui, montre déjà la zone.
 */
export function paintSpotDraft(
  ctx: CanvasRenderingContext2D,
  region: SpotRegion,
  accent: string,
): void {
  ctx.save()
  ctx.setLineDash([7, 6])
  ctx.lineWidth = 1.4
  ctx.strokeStyle = rgba(accent, 0.75)
  tracePath(ctx, region, 1, 0)
  ctx.stroke()
  ctx.restore()
}

/* ------------------------------------------------------------------ *
 * 2. Grille et règle des tiers (§5.8.1)
 *    Rendu 100 % CSS : des dégradés répétés, aucun canvas, aucune image
 *    de rendu. Le coût au repos est nul par construction.
 * ------------------------------------------------------------------ */

export type GridMode = 'off' | 'grid' | 'thirds' | 'both'

export const GRID_MODES: GridMode[] = ['off', 'grid', 'thirds', 'both']

export const GRID_LABELS: Record<GridMode, string> = {
  off: 'Aucune',
  grid: 'Grille',
  thirds: 'Règle des tiers',
  both: 'Grille + tiers',
}

/** pas de la grille fine, en pixels */
export const GRID_STEP = 64

export interface GridLayers {
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
}

/**
 * Un trait de cadrage doit se voir sur N'IMPORTE QUEL fond : une carte de jeu
 * claire comme une scène de nuit. Chaque ligne fait donc 3 px : un cœur clair
 * d'un pixel, bordé de deux pixels sombres. C'est la recette des grilles de
 * cadrage en photo — lisible partout, sans jamais crier.
 */
function bandStops(pos: string, dark: string, light: string): string[] {
  return [
    `transparent calc(${pos} - 1.5px)`,
    `${dark} calc(${pos} - 1.5px)`,
    `${dark} calc(${pos} - 0.5px)`,
    `${light} calc(${pos} - 0.5px)`,
    `${light} calc(${pos} + 0.5px)`,
    `${dark} calc(${pos} + 0.5px)`,
    `${dark} calc(${pos} + 1.5px)`,
    `transparent calc(${pos} + 1.5px)`,
  ]
}

/**
 * Construit les calques CSS d'une superposition discrète.
 * `opacity` est appliquée dans les couleurs elles-mêmes : la superposition
 * reste sous les annotations, on ne teinte jamais le trait.
 */
export function gridLayers(mode: GridMode, opacity: number): GridLayers | null {
  if (mode === 'off') return null
  const a = clamp(opacity, 0.02, 0.6)
  const images: string[] = []
  if (mode === 'thirds' || mode === 'both') {
    // Deux traits verticaux et deux horizontaux, plus marqués que la grille :
    // ce sont eux qui servent au cadrage.
    const light = `rgba(255,255,255,${Math.min(0.9, a * 1.9).toFixed(3)})`
    const dark = `rgba(0,0,0,${Math.min(0.7, a * 1.15).toFixed(3)})`
    const stops = [...bandStops('33.3333%', dark, light), ...bandStops('66.6667%', dark, light)]
    images.push(
      `linear-gradient(to right, ${stops.join(', ')})`,
      `linear-gradient(to bottom, ${stops.join(', ')})`,
    )
  }
  if (mode === 'grid' || mode === 'both') {
    const light = `rgba(255,255,255,${a.toFixed(3)})`
    const dark = `rgba(0,0,0,${(a * 0.62).toFixed(3)})`
    const band = `${dark} 0 1px, ${light} 1px 2px, ${dark} 2px 3px, transparent 3px ${GRID_STEP}px`
    images.push(
      `repeating-linear-gradient(to right, ${band})`,
      `repeating-linear-gradient(to bottom, ${band})`,
    )
  }
  return {
    backgroundImage: images.join(', '),
    backgroundSize: images.map(() => '100% 100%').join(', '),
    backgroundPosition: images.map(() => '0 0').join(', '),
  }
}

/* ------------------------------------------------------------------ *
 * 3. Chrono et compte à rebours (§5.8.2)
 *    Modèle d'horloge sans aucun timer : on stocke un cumul et l'instant
 *    de départ. Tant que l'horloge tourne, l'affichage se calcule ; à
 *    l'arrêt, plus rien ne bouge et plus rien ne consomme.
 * ------------------------------------------------------------------ */

export type ClockKind = 'chrono' | 'countdown'

export interface StageClock {
  id: string
  kind: ClockKind
  /** position à l'écran, en pixels (coin haut-gauche) */
  x: number
  y: number
  /** millisecondes déjà écoulées, hors marche en cours */
  elapsed: number
  /** Date.now() du dernier démarrage — null quand l'horloge est en pause */
  startedAt: number | null
  /** compte à rebours : durée totale demandée, en ms */
  duration: number
}

/** durées proposées au compte à rebours (secondes) */
export const COUNTDOWN_STEPS = [30, 60, 120, 180, 300, 600]

/** seuil de la pulsation d'urgence : 10 dernières secondes (§5.8.2) */
export const URGENT_MS = 10_000

/** millisecondes écoulées depuis le début, marche en cours comprise */
export function clockElapsed(c: StageClock, now: number): number {
  return c.elapsed + (c.startedAt == null ? 0 : Math.max(0, now - c.startedAt))
}

/** valeur AFFICHÉE : croissante pour le chrono, décroissante (bornée à 0) sinon */
export function clockValue(c: StageClock, now: number): number {
  const e = clockElapsed(c, now)
  return c.kind === 'chrono' ? e : Math.max(0, c.duration - e)
}

/** un compte à rebours arrivé à zéro n'a plus rien à animer */
export function clockRunning(c: StageClock, now: number): boolean {
  if (c.startedAt == null) return false
  return c.kind === 'chrono' || clockValue(c, now) > 0
}

/** formate en M:SS ou H:MM:SS, avec les centièmes pour le chrono */
export function formatClock(ms: number, centis: boolean): string {
  const total = Math.max(0, ms)
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor(total / 60_000) % 60
  const s = Math.floor(total / 1000) % 60
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))
  const head = h > 0 ? `${h}:${pad(m)}` : String(m)
  const base = `${head}:${pad(s)}`
  if (!centis || h > 0) return base
  return `${base}.${pad(Math.floor(total / 10) % 100)}`
}

/* ------------------------------------------------------------------ *
 * 4. Notes persistantes (§5.8.3)
 *    Immunisées au fondu automatique et à la touche panique : ce sont des
 *    éléments d'interface, pas des annotations. Elles ne sont donc ni dans
 *    l'historique d'annulation, ni dans l'export de session.
 * ------------------------------------------------------------------ */

export interface StageNote {
  id: string
  x: number
  y: number
  text: string
  /** couleur d'accent de la note (reprend la couleur active à la création) */
  color: string
}

/** largeur d'une note, en pixels — fixée pour rester lisible en stream */
export const NOTE_WIDTH = 236

/** identifiant court, unique pour la session (aucune dépendance ajoutée) */
let widgetSeq = 0
export function widgetId(prefix: string): string {
  widgetSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${widgetSeq}`
}

/**
 * Place un nouvel élément sans jamais le poser sous la barre d'outils ni hors
 * écran, et en décalant s'il tombe pile sur un élément déjà posé.
 */
export function placeWidget(
  taken: { x: number; y: number }[],
  w: number,
  h: number,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  let x = Math.round(viewport.w * 0.5 - w / 2)
  let y = Math.round(viewport.h * 0.24)
  for (let i = 0; i < 24; i++) {
    const hit = taken.some((p) => Math.abs(p.x - x) < 28 && Math.abs(p.y - y) < 28)
    if (!hit) break
    x += 30
    y += 30
  }
  return clampWidget(x, y, w, h, viewport)
}

/** garde un élément entièrement visible (marge basse : la barre d'outils) */
export function clampWidget(
  x: number,
  y: number,
  w: number,
  h: number,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.round(clamp(x, 8, Math.max(8, viewport.w - w - 8))),
    y: Math.round(clamp(y, 8, Math.max(8, viewport.h - h - 96))),
  }
}
