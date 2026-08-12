import type {
  EngineOptions,
  LaserPoint,
  Particle,
  SessionExport,
  Stroke,
  StrokePoint,
  ToolId,
} from './types'
import { clamp, dist, easeInQuad, pointToSegment, rgba, whiteMix } from './geometry'
import { renderEmber, renderStroke } from './render'
import { OneEuro } from './oneEuro'
import { hitShape, renderMorph, resample, shapeOutline, squarify, alignLoop } from './shapes'
import type { MorphAnim, Pt } from './shapes'
import { recognize } from './recognizer'
import { GuideOverlay, buildAnchors, snapPoint } from './guides'
import type { Anchor } from './guides'
import {
  BADGE_ANIM,
  BADGE_LINK_ANIM,
  badgeRadius,
  imageFromClipboard,
  openTextInput,
  setImageInvalidate,
  textBox,
  textSizeOf,
} from './teaching'

const LASER_TTL = 450
const DISSOLVE_MIN = 420
const SNAP_RAD = (15 * Math.PI) / 180
/** durée du morph entre le tracé brut et la forme parfaite (§4.1.5) */
const MORPH_MS = 150
const MORPH_SAMPLES = 72

/** outils qui démarrent un tracé au clic gauche */
const FREEHAND_TOOLS = new Set(['pen', 'highlight'])
const TWO_POINT_TOOLS = new Set(['line', 'arrow', 'rect', 'ellipse', 'measure'])
/** outils qui posent une annotation d'un seul clic */
const CLICK_TOOLS = new Set(['text', 'badge', 'stamp'])

/**
 * Moteur de rendu et d'interaction de Hexa.
 *
 * Règles de performance (brief §13) :
 *  - zéro boucle quand rien n'est animé : la rAF ne tourne que pendant un tracé,
 *    une dissolution, une traînée laser ou des particules, puis s'arrête ;
 *  - deux canvas : `staticCv` (annotations posées, redessiné seulement quand
 *    nécessaire) et `liveCv` (trait en cours, laser, particules) ;
 *  - les réveils différés (fondu auto) passent par un setTimeout unique.
 */
export class HexaEngine {
  private stage: HTMLElement
  private staticCv: HTMLCanvasElement
  private liveCv: HTMLCanvasElement
  private sCtx: CanvasRenderingContext2D
  private lCtx: CanvasRenderingContext2D
  private cursor: HTMLDivElement

  private opts: EngineOptions = {
    tool: 'pen',
    color: '#00e5ff',
    size: 6,
    fadeDelay: 4000,
    sparkles: true,
    smartShapes: true,
    guides: true,
    linkBadges: true,
  }

  private strokes: Stroke[] = []
  private redoStack: Stroke[] = []
  private current: Stroke | null = null
  private particles: Particle[] = []
  private laser: LaserPoint[] = []
  private grabbed: Stroke | null = null
  private grabLast = { x: 0, y: 0 }
  private erasing = false
  private pointer = { x: -200, y: -200 }
  private shiftHeld = false
  private altHeld = false

  /** morphs en cours (hors Stroke : jamais sérialisé) */
  private morphs = new Map<number, MorphAnim>()
  /** guides magnétiques : index des points remarquables + calque de rendu */
  private overlay = new GuideOverlay()
  private anchors: Anchor[] = []
  private anchorsDirty = true
  /** numéroteur */
  private badgeSeq = 1
  private lastBadgeId: number | null = null
  /** éditeur de texte flottant en cours (fonction de fermeture) */
  private closeText: (() => void) | null = null
  /** dernière image collée, prête à être tamponnée */
  private pendingStamp: { src: string; w: number; h: number } | null = null

  private running = false
  private raf = 0
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private staticDirty = true
  private lastFrame = 0
  private idSeq = 1
  private w = 0
  private h = 0
  private fx: OneEuro | null = null
  private fy: OneEuro | null = null
  private lastActivity = false
  private detachFns: (() => void)[] = []

  /** notifié quand la couche passe de vide à non-vide (et inversement) —
   *  sert à la règle §2.5 du brief : masquer la fenêtre quand il n'y a rien */
  onActivity?: (hasContent: boolean) => void

  /**
   * Miroir de l'état, appelé À CHAQUE IMAGE ACTIVE (donc jamais au repos, la
   * boucle étant dormante). Sert à l'enregistreur de session (§11) et au miroir
   * OBS (§10.2). Les tableaux fournis appartiennent au moteur : les lire, ne
   * jamais les modifier. Les consommateurs s'échantillonnent eux-mêmes.
   */
  onMirror?: (strokes: readonly Stroke[], current: Stroke | null) => void

  constructor(stage: HTMLElement, staticCv: HTMLCanvasElement, liveCv: HTMLCanvasElement) {
    this.stage = stage
    this.staticCv = staticCv
    this.liveCv = liveCv
    this.sCtx = staticCv.getContext('2d')!
    this.lCtx = liveCv.getContext('2d')!
    this.cursor = document.createElement('div')
    this.cursor.className = 'cursor-dot'
    stage.appendChild(this.cursor)

    const down = (e: PointerEvent) => this.onDown(e)
    const move = (e: PointerEvent) => this.onMove(e)
    const up = (e: PointerEvent) => this.onUp(e)
    const menu = (e: Event) => e.preventDefault()
    const resize = () => this.resize()
    const wheel = (e: WheelEvent) => this.onWheel(e)
    const paste = (e: ClipboardEvent) => this.onPaste(e)
    window.addEventListener('paste', paste)
    this.detachFns.push(() => window.removeEventListener('paste', paste))
    // une image qui finit de charger doit relancer un rendu (jamais de boucle)
    setImageInvalidate(() => {
      this.staticDirty = true
      this.wake()
    })
    stage.addEventListener('pointerdown', down)
    stage.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    stage.addEventListener('pointercancel', up)
    stage.addEventListener('contextmenu', menu)
    stage.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('resize', resize)
    this.detachFns.push(() => {
      stage.removeEventListener('pointerdown', down)
      stage.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      stage.removeEventListener('pointercancel', up)
      stage.removeEventListener('contextmenu', menu)
      stage.removeEventListener('wheel', wheel)
      window.removeEventListener('resize', resize)
    })

    this.resize()
    this.syncCursor()
  }

  /** la molette est gérée par l'app (taille du pinceau) — seam volontaire */
  onWheelCb?: (e: WheelEvent) => void

  /** le moteur demande un changement d'outil (collage d'image → tampon) */
  onRequestTool?: (tool: ToolId) => void

  destroy(): void {
    for (const fn of this.detachFns) fn()
    cancelAnimationFrame(this.raf)
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.closeText?.()
    setImageInvalidate(null)
    this.cursor.remove()
  }

  setOptions(patch: Partial<EngineOptions>): void {
    const prevFade = this.opts.fadeDelay
    const prevTool = this.opts.tool
    this.opts = { ...this.opts, ...patch }
    if (this.opts.tool !== prevTool && prevTool === 'text') this.closeText?.()
    if ('fadeDelay' in patch && this.opts.fadeDelay !== prevFade) {
      const now = performance.now()
      for (const s of this.strokes) {
        if (s.dying) continue
        s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
      }
      this.wake()
    }
    this.syncCursor()
  }

  undo(): void {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]
      if (s.dying) continue
      // 1er Ctrl+Z après un redressement : on rend le TRACÉ BRUT (§4.1.5)
      if (s.raw) {
        const now = performance.now()
        this.morphs.delete(s.id)
        s.points = s.raw
        s.raw = undefined
        s.tool = 'pen'
        s.filled = undefined
        s.anim = undefined
        s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
        this.anchorsDirty = true
        this.staticDirty = true
        this.wake()
        return
      }
      this.strokes.splice(i, 1)
      this.redoStack.push(s)
      if (s.tool === 'badge') this.syncBadgeSeq()
      this.anchorsDirty = true
      this.staticDirty = true
      this.wake()
      return
    }
  }

  redo(): void {
    const s = this.redoStack.pop()
    if (!s) return
    s.dieAt = this.opts.fadeDelay == null ? undefined : performance.now() + this.opts.fadeDelay
    this.strokes.push(s)
    if (s.tool === 'badge') this.syncBadgeSeq()
    this.anchorsDirty = true
    this.staticDirty = true
    this.wake()
  }

  /** le compteur du numéroteur suit toujours la plus grande pastille présente */
  private syncBadgeSeq(): void {
    let max = 0
    let last: number | null = null
    for (const s of this.strokes) {
      if (s.tool !== 'badge' || s.dying) continue
      max = Math.max(max, s.badge ?? 0)
      last = s.id
    }
    this.badgeSeq = max + 1
    this.lastBadgeId = last
  }

  /** touche panique : tout part en dissolution, léger décalage en cascade */
  clear(): void {
    const now = performance.now()
    let i = 0
    for (const s of this.strokes) {
      if (s.dying) continue
      s.dying = { start: now + i * 45, duration: this.dissolveDuration(s), mode: 'dissolve' }
      i++
    }
    this.badgeSeq = 1
    this.lastBadgeId = null
    this.anchorsDirty = true
    this.wake()
  }

  exportSession(): SessionExport {
    return {
      app: 'hexa',
      version: 1,
      exportedAt: new Date().toISOString(),
      strokes: structuredClone(this.strokes.filter((s) => !s.dying)),
    }
  }

  get hasContent(): boolean {
    return this.strokes.length > 0 || this.current != null
  }

  /** recharge une session exportée (§11 du brief — rejeu/montage) */
  loadSession(data: SessionExport): void {
    if (data.app !== 'hexa' || !Array.isArray(data.strokes)) return
    const now = performance.now()
    const remap = new Map<number, number>()
    const loaded = structuredClone(data.strokes)
    for (const s of loaded) {
      s.dying = undefined
      s.anim = undefined
      s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
      const old = s.id
      s.id = this.idSeq++
      remap.set(old, s.id)
    }
    // les liens du numéroteur pointent vers des ids : on les réécrit
    for (const s of loaded) {
      if (s.linkFrom != null) s.linkFrom = remap.get(s.linkFrom)
      this.strokes.push(s)
    }
    this.syncBadgeSeq()
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  private dissolveDuration(s: Stroke): number {
    return clamp(DISSOLVE_MIN + s.points.length * 2.2, DISSOLVE_MIN, 1200)
  }

  private toLocal(e: { clientX: number; clientY: number; pressure?: number }): StrokePoint {
    const r = this.stage.getBoundingClientRect()
    const p = e.pressure != null && e.pressure > 0 ? e.pressure : 0.5
    return { x: e.clientX - r.left, y: e.clientY - r.top, p, t: performance.now() }
  }

  private strokeAt(x: number, y: number): Stroke | null {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]
      if (s.dying) continue
      const pad = Math.max(14, s.size * 2)
      const pts = s.points
      // formes, textes, pastilles et tampons ont leur propre zone de saisie
      if (s.tool === 'rect' || s.tool === 'ellipse') {
        if (hitShape(s, x, y, pad)) return s
        continue
      }
      if (s.tool === 'badge') {
        if (dist(x, y, pts[0].x, pts[0].y) < badgeRadius(s.size) + 4) return s
        continue
      }
      if (s.tool === 'stamp') {
        const w = (s.w ?? 0) / 2
        const h = (s.h ?? 0) / 2
        if (Math.abs(x - pts[0].x) < w && Math.abs(y - pts[0].y) < h) return s
        continue
      }
      if (s.tool === 'text') {
        const box = textBox(this.sCtx, s)
        if (x > pts[0].x - 6 && x < pts[0].x + box.w + 6 && Math.abs(y - pts[0].y) < box.h / 2 + 4) {
          return s
        }
        continue
      }
      if (pts.length === 1) {
        if (dist(x, y, pts[0].x, pts[0].y) < pad) return s
        continue
      }
      if (s.tool === 'arrow' && pts.length > 2) {
        for (let j = 0; j < pts.length - 1; j++) {
          if (pointToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) < pad) return s
        }
        continue
      }
      if (s.tool === 'arrow' || s.tool === 'line' || s.tool === 'measure') {
        const a = pts[0]
        const b = pts[pts.length - 1]
        if (pointToSegment(x, y, a.x, a.y, b.x, b.y) < pad) return s
        continue
      }
      for (let j = 0; j < pts.length - 1; j++) {
        if (pointToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) < pad) return s
      }
    }
    return null
  }

  private onDown(e: PointerEvent): void {
    // clic dans l'éditeur de texte flottant : ce n'est pas un geste de dessin
    if (e.target !== this.stage && !(e.target instanceof HTMLCanvasElement)) return
    const pt = this.toLocal(e)
    this.pointer = pt
    this.shiftHeld = e.shiftKey
    this.altHeld = e.altKey
    this.stage.setPointerCapture(e.pointerId)

    if (e.button === 2) {
      // clic droit sur une annotation : on l'attrape pour la déplacer.
      // (clic droit maintenu dans le vide = menu radial, vague suivante)
      const s = this.strokeAt(pt.x, pt.y)
      if (s) {
        this.grabbed = s
        this.grabLast = { x: pt.x, y: pt.y }
        s.dieAt = undefined // le compte à rebours est suspendu pendant le drag
        this.cursor.classList.add('is-grab')
        this.staticDirty = true
        this.wake()
      }
      return
    }
    if (e.button !== 0) return

    const t = this.opts.tool
    if (t === 'eraser') {
      this.erasing = true
      this.eraseAt(pt)
      this.wake()
      return
    }
    if (t === 'laser') {
      this.pushLaser(pt, true)
      this.wake()
      return
    }
    if (CLICK_TOOLS.has(t)) {
      this.redoStack = []
      // les outils posés au clic profitent aussi des guides (alignement,
      // espacement égal) : c'est ce qui rend une série de pastilles nette
      const p = this.guidesOn() ? this.snapClick(pt) : pt
      this.overlay.clear(performance.now())
      if (t === 'text') this.openText(p)
      else if (t === 'badge') this.placeBadge(p)
      else this.placeStamp(p)
      return
    }

    if (FREEHAND_TOOLS.has(t) || TWO_POINT_TOOLS.has(t)) {
      this.redoStack = []
      this.fx = new OneEuro()
      this.fy = new OneEuro()
      const first: StrokePoint = { ...pt, x: this.fx.filter(pt.x, pt.t), y: this.fy.filter(pt.y, pt.t) }
      // le point de DÉPART s'accroche aussi aux points remarquables
      if (TWO_POINT_TOOLS.has(t) && this.guidesOn()) {
        const snapped = snapPoint(null, first, this.anchorList())
        first.x = snapped.x
        first.y = snapped.y
      }
      this.current = {
        id: this.idSeq++,
        tool: t as Stroke['tool'],
        color: this.opts.color,
        size: this.opts.size,
        points: [first],
        simulatePressure: e.pointerType !== 'pen',
        done: false,
        startedAt: pt.t,
      }
      if (TWO_POINT_TOOLS.has(t)) {
        this.current.points.push({ ...first })
        // Alt = forme remplie translucide (rect / ellipse)
        if ((t === 'rect' || t === 'ellipse') && e.altKey) this.current.filled = true
      }
      this.emitActivity()
      this.wake()
    }
  }

  /* ---------------- outils à un clic ---------------- */

  private openText(pt: StrokePoint): void {
    this.closeText?.()
    const color = this.opts.color
    const size = this.opts.size
    this.closeText = openTextInput(
      this.stage,
      { x: pt.x, y: pt.y, color, fontSize: textSizeOf(size) },
      (value) => {
        const now = performance.now()
        const s: Stroke = {
          id: this.idSeq++,
          tool: 'text',
          color,
          size,
          points: [{ x: pt.x, y: pt.y, p: 0.5, t: now }],
          simulatePressure: false,
          done: true,
          startedAt: now,
          endedAt: now,
          text: value,
          anim: { start: now, duration: 260 },
        }
        if (this.opts.fadeDelay != null) s.dieAt = now + this.opts.fadeDelay + 260
        this.strokes.push(s)
        this.anchorsDirty = true
        this.staticDirty = true
        this.emitActivity()
        this.wake()
      },
    )
  }

  private placeBadge(pt: StrokePoint): void {
    const now = performance.now()
    const link = this.opts.linkBadges ? this.lastBadgeId : null
    const s: Stroke = {
      id: this.idSeq++,
      tool: 'badge',
      color: this.opts.color,
      size: this.opts.size,
      points: [{ x: pt.x, y: pt.y, p: 0.5, t: now }],
      simulatePressure: false,
      done: true,
      startedAt: now,
      endedAt: now,
      badge: this.badgeSeq,
      anim: { start: now, duration: link != null ? BADGE_LINK_ANIM : BADGE_ANIM },
    }
    if (link != null) s.linkFrom = link
    if (this.opts.fadeDelay != null) s.dieAt = now + this.opts.fadeDelay + (s.anim?.duration ?? 0)
    this.strokes.push(s)
    this.badgeSeq++
    this.lastBadgeId = s.id
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  private placeStamp(pt: StrokePoint): void {
    const img = this.pendingStamp
    if (!img) return
    const now = performance.now()
    const s: Stroke = {
      id: this.idSeq++,
      tool: 'stamp',
      color: this.opts.color,
      size: this.opts.size,
      points: [{ x: pt.x, y: pt.y, p: 0.5, t: now }],
      simulatePressure: false,
      done: true,
      startedAt: now,
      endedAt: now,
      image: img.src,
      w: img.w,
      h: img.h,
      anim: { start: now, duration: 260 },
    }
    if (this.opts.fadeDelay != null) s.dieAt = now + this.opts.fadeDelay + 260
    this.strokes.push(s)
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  /** collage d'une image du presse-papier (§4.10) : bascule sur le tampon */
  private async onPaste(e: ClipboardEvent): Promise<void> {
    const img = await imageFromClipboard(e.clipboardData?.items ?? null)
    if (!img) return
    this.pendingStamp = img
    this.onRequestTool?.('stamp')
  }

  /** molette : redimensionne le tampon survolé, sinon comportement de l'app */
  private onWheel(e: WheelEvent): void {
    if (this.opts.tool !== 'eraser') {
      const s = this.strokeAt(this.pointer.x, this.pointer.y)
      if (s && s.tool === 'stamp' && s.w && s.h) {
        e.preventDefault()
        const k = e.deltaY < 0 ? 1.09 : 1 / 1.09
        const w = clamp(s.w * k, 48, 1600)
        s.h = (s.h / s.w) * w
        s.w = w
        this.staticDirty = true
        this.wake()
        return
      }
    }
    this.onWheelCb?.(e)
  }

  private onMove(e: PointerEvent): void {
    this.shiftHeld = e.shiftKey
    this.altHeld = e.altKey
    const coalesced = e.getCoalescedEvents?.() ?? []
    const list = coalesced.length > 0 ? coalesced : [e]
    for (const ev of list) {
      const pt = this.toLocal(ev)
      this.pointer = pt
      if (this.grabbed) {
        const dx = pt.x - this.grabLast.x
        const dy = pt.y - this.grabLast.y
        this.grabLast = { x: pt.x, y: pt.y }
        for (const p of this.grabbed.points) {
          p.x += dx
          p.y += dy
        }
        this.anchorsDirty = true
        this.staticDirty = true
      } else if (this.current) {
        const c = this.current
        if (TWO_POINT_TOOLS.has(c.tool)) {
          c.points[c.points.length - 1] = this.resolveTwoPoint(c, pt)
        } else {
          const fpt: StrokePoint = {
            ...pt,
            x: this.fx ? this.fx.filter(pt.x, pt.t) : pt.x,
            y: this.fy ? this.fy.filter(pt.y, pt.t) : pt.y,
          }
          const lastP = c.points[c.points.length - 1]
          if (dist(lastP.x, lastP.y, fpt.x, fpt.y) > 0.7) {
            c.points.push(fpt)
            if (c.tool === 'pen' && this.opts.sparkles) this.spawnSparkles(fpt)
          }
        }
      } else if (this.erasing) {
        this.eraseAt(pt)
      } else if (this.opts.tool === 'laser') {
        this.pushLaser(pt, (e.buttons & 1) === 1)
      } else if (CLICK_TOOLS.has(this.opts.tool)) {
        // aperçu des guides sous le curseur avant même de cliquer
        if (this.guidesOn()) this.snapClick(pt)
        else this.overlay.clear(pt.t)
      }
    }
    this.moveCursor()
    if (
      this.grabbed ||
      this.current ||
      this.erasing ||
      this.opts.tool === 'laser' ||
      CLICK_TOOLS.has(this.opts.tool)
    ) {
      this.wake()
    }
  }

  /** accroche d'un outil posé au clic + affichage des guides correspondants */
  private snapClick(pt: StrokePoint): StrokePoint {
    const res = snapPoint(null, pt, this.anchorList())
    this.overlay.set(res.guides, performance.now())
    return { ...pt, x: res.x, y: res.y }
  }

  /** accroche aux angles de 15° quand Shift est maintenu (lignes et flèches) */
  private maybeSnap(origin: StrokePoint, pt: StrokePoint): StrokePoint {
    if (!this.shiftHeld) return pt
    const ang = Math.atan2(pt.y - origin.y, pt.x - origin.x)
    const snapped = Math.round(ang / SNAP_RAD) * SNAP_RAD
    const len = dist(origin.x, origin.y, pt.x, pt.y)
    return { ...pt, x: origin.x + Math.cos(snapped) * len, y: origin.y + Math.sin(snapped) * len }
  }

  /** guides actifs ? (réglage global, et Alt les suspend le temps du geste) */
  private guidesOn(): boolean {
    return this.opts.guides && !this.altHeld
  }

  /** index paresseux des points remarquables — jamais reconstruit pour rien */
  private anchorList(): Anchor[] {
    if (this.anchorsDirty) {
      this.anchors = buildAnchors(this.strokes)
      this.anchorsDirty = false
    }
    return this.anchors
  }

  /**
   * Point courant d'une forme à deux points : Shift (carré/cercle ou angles
   * de 15°) l'emporte, sinon les guides magnétiques prennent la main.
   */
  private resolveTwoPoint(c: Stroke, pt: StrokePoint): StrokePoint {
    const origin = c.points[0]
    if (this.shiftHeld) {
      this.overlay.clear(performance.now())
      if (c.tool === 'rect' || c.tool === 'ellipse') {
        const sq = squarify(origin, pt)
        return { ...pt, x: sq.x, y: sq.y }
      }
      return this.maybeSnap(origin, pt)
    }
    if (!this.guidesOn()) {
      this.overlay.clear(performance.now())
      return pt
    }
    const boxTool = c.tool === 'rect' || c.tool === 'ellipse'
    const res = snapPoint(boxTool ? null : origin, pt, this.anchorList())
    this.overlay.set(res.guides, performance.now())
    return { ...pt, x: res.x, y: res.y }
  }

  private onUp(_e: PointerEvent): void {
    if (this.grabbed) {
      if (this.opts.fadeDelay != null) {
        this.grabbed.dieAt = performance.now() + this.opts.fadeDelay
      }
      this.grabbed = null
      this.cursor.classList.remove('is-grab')
      this.anchorsDirty = true
      this.staticDirty = true
      this.wake()
      return
    }
    this.erasing = false
    const c = this.current
    if (!c) return
    this.current = null
    this.fx = null
    this.fy = null
    const now = performance.now()
    this.overlay.clear(now)
    c.done = true
    c.endedAt = now
    if (TWO_POINT_TOOLS.has(c.tool)) {
      const a = c.points[0]
      const b = c.points[c.points.length - 1]
      if (dist(a.x, a.y, b.x, b.y) < 8) {
        this.emitActivity()
        this.wake()
        return // geste trop court : on n'ajoute rien
      }
      if (c.tool === 'arrow') c.anim = { start: now, duration: 300 }
      else if (c.tool === 'rect' || c.tool === 'ellipse') c.anim = { start: now, duration: 220 }
    }
    // formes intelligentes : le geste au stylo est redressé (§4.1)
    if (c.tool === 'pen' && this.opts.smartShapes) this.applySmartShape(c, now)
    if (this.opts.fadeDelay != null) c.dieAt = now + this.opts.fadeDelay + (c.anim?.duration ?? 0)
    this.strokes.push(c)
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  /**
   * Reconnaît une forme dans le tracé et l'anime vers la version parfaite
   * en 150 ms (§4.1.5). Le tracé brut est conservé dans `raw` : le premier
   * Ctrl+Z le rend au lieu de supprimer l'annotation.
   */
  private applySmartShape(c: Stroke, now: number): void {
    const rec = recognize(c.points)
    if (!rec) return
    const target: Pt[] = rec.points
    const from = resample(
      c.points.map((p) => ({ x: p.x, y: p.y })),
      MORPH_SAMPLES,
      rec.closed,
    )
    let to = shapeOutline(rec.kind, target, MORPH_SAMPLES)
    if (rec.closed) to = alignLoop(to, from)
    this.morphs.set(c.id, { from, to, start: now, duration: MORPH_MS, closed: rec.closed })
    c.raw = c.points
    c.tool = rec.kind
    c.points = target.map((p) => ({ x: p.x, y: p.y, p: 0.5, t: now }))
    // la pointe de la flèche éclot juste après l'atterrissage du morph
    c.anim =
      rec.kind === 'arrow' ? { start: now + MORPH_MS, duration: 260, kind: 'head' } : undefined
  }

  private eraseAt(pt: StrokePoint): void {
    const s = this.strokeAt(pt.x, pt.y)
    if (s) {
      s.dying = { start: performance.now(), duration: 160, mode: 'pop' }
      this.wake()
    }
  }

  private pushLaser(pt: StrokePoint, pressed: boolean): void {
    this.laser.push({ x: pt.x, y: pt.y, t: pt.t, pressed })
    if (this.laser.length > 160) this.laser.splice(0, this.laser.length - 160)
  }

  private spawnSparkles(pt: StrokePoint): void {
    if (this.particles.length > 260) return
    const count = Math.random() < 0.45 ? 2 : 1
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: pt.x + (Math.random() - 0.5) * this.opts.size * 2.2,
        y: pt.y + (Math.random() - 0.5) * this.opts.size * 2.2,
        vx: (Math.random() - 0.5) * 120,
        vy: -20 - Math.random() * 70,
        born: pt.t,
        life: 380 + Math.random() * 420,
        size: 0.7 + Math.random() * 1.7,
        color: this.opts.color,
      })
    }
  }

  private moveCursor(): void {
    this.cursor.style.transform = `translate3d(${this.pointer.x}px, ${this.pointer.y}px, 0) translate(-50%, -50%)`
  }

  private syncCursor(): void {
    const t = this.opts.tool
    this.cursor.dataset.tool = t
    this.cursor.style.setProperty('--c', this.opts.color)
    const d = t === 'eraser' ? 30 : clamp(this.opts.size * 1.6, 8, 26)
    this.cursor.style.setProperty('--d', `${d}px`)
    this.cursor.style.opacity = t === 'laser' ? '0' : '1'
  }

  private emitActivity(): void {
    const has = this.hasContent
    if (has !== this.lastActivity) {
      this.lastActivity = has
      this.onActivity?.(has)
    }
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.w = this.stage.clientWidth
    this.h = this.stage.clientHeight
    for (const [cv, ctx] of [
      [this.staticCv, this.sCtx],
      [this.liveCv, this.lCtx],
    ] as const) {
      cv.width = Math.round(this.w * dpr)
      cv.height = Math.round(this.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    this.staticDirty = true
    this.wake()
  }

  private wake(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    if (!this.running) {
      this.running = true
      this.lastFrame = performance.now()
      this.raf = requestAnimationFrame(this.loop)
    }
  }

  private loop = (): void => {
    const now = performance.now()
    const dt = clamp(now - this.lastFrame, 0, 48) / 1000
    this.lastFrame = now

    // déclencher les dissolutions programmées (fondu auto)
    for (const s of this.strokes) {
      if (!s.dying && s.dieAt != null && now >= s.dieAt) {
        s.dying = { start: now, duration: this.dissolveDuration(s), mode: 'dissolve' }
      }
    }
    // purger les traits entièrement dissous
    let purged = false
    let purgedBadge = false
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const st = this.strokes[i]
      const d = st.dying
      if (d && now - d.start >= d.duration) {
        this.morphs.delete(st.id)
        if (st.tool === 'badge') purgedBadge = true
        this.strokes.splice(i, 1)
        purged = true
      }
    }
    if (purged) {
      if (purgedBadge) this.syncBadgeSeq()
      this.anchorsDirty = true
      this.staticDirty = true
      this.emitActivity()
    }

    // particules
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      if (now - p.born > p.life) {
        this.particles.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 1 - 1.4 * dt
      p.vy += 26 * dt
    }
    // traînée laser
    while (this.laser.length > 0 && now - this.laser[0].t > LASER_TTL) this.laser.shift()

    const dyingActive = this.strokes.some((s) => s.dying)
    const animActive = this.strokes.some((s) => s.anim && now - s.anim.start < s.anim.duration)
    const morphActive = this.morphs.size > 0
    const guidesActive = this.overlay.active(now)
    if (this.staticDirty || dyingActive || animActive || morphActive || this.grabbed) {
      this.renderStatic(now)
    }
    this.renderLive(now)
    // miroir : enregistreur de session (§11) et vue OBS (§10.2). Uniquement
    // pendant que la boucle tourne, donc jamais au repos.
    this.onMirror?.(this.strokes, this.current)

    const busy =
      this.current != null ||
      this.grabbed != null ||
      this.erasing ||
      this.particles.length > 0 ||
      this.laser.length > 0 ||
      dyingActive ||
      animActive ||
      morphActive ||
      guidesActive
    if (busy) {
      this.raf = requestAnimationFrame(this.loop)
      return
    }
    this.running = false
    // programmer le prochain réveil si un fondu auto est en attente
    let next = Infinity
    for (const s of this.strokes) {
      if (!s.dying && s.dieAt != null) next = Math.min(next, s.dieAt)
    }
    if (next < Infinity) {
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = null
        this.wake()
      }, Math.max(16, next - now))
    }
  }

  private renderStatic(now: number): void {
    const ctx = this.sCtx
    ctx.clearRect(0, 0, this.w, this.h)
    for (const s of this.strokes) {
      let alpha = 1
      let from = 0
      // intensité des effets (réglages) : multiplie le halo, 1 par défaut
      const glowBoost = (s === this.grabbed ? 1.45 : 1) * (this.opts.effects ?? 1)
      // seuls les tracés à main levée se consument en comète : les formes,
      // textes, pastilles et tampons partent en fondu
      const comet = FREEHAND_TOOLS.has(s.tool)
      if (s.dying) {
        const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
        if (p > 0) {
          if (s.dying.mode === 'pop' || !comet) {
            alpha = 1 - p
          } else {
            const n = s.points.length
            from = Math.floor(easeInQuad(p) * Math.max(0, n - 2))
            alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25
          }
        }
      }
      // morph en cours : on dessine l'image intermédiaire, pas la forme finale
      const morph = this.morphs.get(s.id)
      if (morph) {
        const mt = clamp((now - morph.start) / morph.duration, 0, 1)
        renderMorph(ctx, morph, mt, s, alpha)
        if (mt >= 1) this.morphs.delete(s.id)
        continue
      }
      renderStroke(ctx, s, { alpha, from, glowBoost, now, link: this.linkAnchor(s) })
      if (s.dying && s.dying.mode === 'dissolve') {
        const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
        if (p > 0 && p < 1) {
          const head = !comet
            ? s.points[s.points.length - 1]
            : s.points[Math.min(from, s.points.length - 1)]
          const r = Math.max(6, s.size * (1.7 + Math.sin(now * 0.02) * 0.35))
          renderEmber(ctx, head.x, head.y, r, s.color, 1 - p * 0.4)
        }
      }
    }
    this.staticDirty = false
  }

  /** centre de la pastille précédente, pour la flèche de liaison du numéroteur */
  private linkAnchor(s: Stroke): Pt | null {
    if (s.tool !== 'badge' || s.linkFrom == null) return null
    // on garde l'ancre même si la pastille source se dissout : le lien part
    // en fondu avec elle au lieu de disparaître d'un coup
    for (const o of this.strokes) {
      if (o.id === s.linkFrom) return { x: o.points[0].x, y: o.points[0].y }
    }
    return null
  }

  private renderLive(now: number): void {
    const ctx = this.lCtx
    ctx.clearRect(0, 0, this.w, this.h)
    // guides magnétiques : couche LIVE uniquement, jamais dans l'export
    this.overlay.render(ctx, now, this.opts.color)
    if (this.current) {
      renderStroke(ctx, this.current, { alpha: 1, from: 0, glowBoost: 1, now })
    }
    if (this.particles.length > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const p of this.particles) {
        const k = 1 - (now - p.born) / p.life
        if (k <= 0) continue
        const a = k * k
        ctx.fillStyle = rgba(p.color, 0.3 * a)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = whiteMix(p.color, 0.75, 0.9 * a)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    if (this.laser.length > 0) this.renderLaser(ctx, now)
  }

  private renderLaser(ctx: CanvasRenderingContext2D, now: number): void {
    const pts = this.laser
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const color = this.opts.color
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const age = (now - b.t) / LASER_TTL
      if (age >= 1) continue
      const k = 1 - age
      const w = (b.pressed ? 13 : 9) * k + 1
      ctx.strokeStyle = rgba(color, 0.16 * k)
      ctx.lineWidth = w * 2.6
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.strokeStyle = whiteMix(color, 0.55, 0.5 * k)
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    const head = pts[pts.length - 1]
    const r = head.pressed ? 30 : 22
    const grad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r)
    grad.addColorStop(0, whiteMix(color, 0.85, 0.95))
    grad.addColorStop(0.25, rgba(color, 0.5))
    grad.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
