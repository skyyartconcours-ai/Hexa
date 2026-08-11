import type {
  EngineOptions,
  LaserPoint,
  Particle,
  SessionExport,
  Stroke,
  StrokePoint,
} from './types'
import { clamp, dist, easeInQuad, pointToSegment, rgba, whiteMix } from './geometry'
import { renderEmber, renderStroke } from './render'
import { OneEuro } from './oneEuro'

const LASER_TTL = 450
const DISSOLVE_MIN = 420
const SNAP_RAD = (15 * Math.PI) / 180

/** outils qui démarrent un tracé au clic gauche (les autres vagues en ajouteront) */
const FREEHAND_TOOLS = new Set(['pen', 'highlight'])
const TWO_POINT_TOOLS = new Set(['line', 'arrow'])

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
    const wheel = (e: WheelEvent) => this.onWheelCb?.(e)
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

  destroy(): void {
    for (const fn of this.detachFns) fn()
    cancelAnimationFrame(this.raf)
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.cursor.remove()
  }

  setOptions(patch: Partial<EngineOptions>): void {
    const prevFade = this.opts.fadeDelay
    this.opts = { ...this.opts, ...patch }
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
      if (!s.dying) {
        this.strokes.splice(i, 1)
        this.redoStack.push(s)
        this.staticDirty = true
        this.wake()
        return
      }
    }
  }

  redo(): void {
    const s = this.redoStack.pop()
    if (!s) return
    s.dieAt = this.opts.fadeDelay == null ? undefined : performance.now() + this.opts.fadeDelay
    this.strokes.push(s)
    this.staticDirty = true
    this.wake()
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
    for (const s of structuredClone(data.strokes)) {
      s.dying = undefined
      s.anim = undefined
      s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
      s.id = this.idSeq++
      this.strokes.push(s)
    }
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
      if (pts.length === 1) {
        if (dist(x, y, pts[0].x, pts[0].y) < pad) return s
        continue
      }
      if (s.tool === 'arrow' || s.tool === 'line') {
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
    const pt = this.toLocal(e)
    this.pointer = pt
    this.shiftHeld = e.shiftKey
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

    if (FREEHAND_TOOLS.has(t) || TWO_POINT_TOOLS.has(t)) {
      this.redoStack = []
      this.fx = new OneEuro()
      this.fy = new OneEuro()
      const first: StrokePoint = { ...pt, x: this.fx.filter(pt.x, pt.t), y: this.fy.filter(pt.y, pt.t) }
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
      if (TWO_POINT_TOOLS.has(t)) this.current.points.push({ ...pt })
      this.emitActivity()
      this.wake()
    }
  }

  private onMove(e: PointerEvent): void {
    this.shiftHeld = e.shiftKey
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
        this.staticDirty = true
      } else if (this.current) {
        const c = this.current
        if (TWO_POINT_TOOLS.has(c.tool)) {
          c.points[c.points.length - 1] = this.maybeSnap(c.points[0], pt)
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
      }
    }
    this.moveCursor()
    if (this.grabbed || this.current || this.erasing || this.opts.tool === 'laser') this.wake()
  }

  /** accroche aux angles de 15° quand Shift est maintenu (lignes et flèches) */
  private maybeSnap(origin: StrokePoint, pt: StrokePoint): StrokePoint {
    if (!this.shiftHeld) return pt
    const ang = Math.atan2(pt.y - origin.y, pt.x - origin.x)
    const snapped = Math.round(ang / SNAP_RAD) * SNAP_RAD
    const len = dist(origin.x, origin.y, pt.x, pt.y)
    return { ...pt, x: origin.x + Math.cos(snapped) * len, y: origin.y + Math.sin(snapped) * len }
  }

  private onUp(_e: PointerEvent): void {
    if (this.grabbed) {
      if (this.opts.fadeDelay != null) {
        this.grabbed.dieAt = performance.now() + this.opts.fadeDelay
      }
      this.grabbed = null
      this.cursor.classList.remove('is-grab')
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
    c.done = true
    c.endedAt = now
    if (c.tool === 'arrow' || c.tool === 'line') {
      const a = c.points[0]
      const b = c.points[c.points.length - 1]
      if (dist(a.x, a.y, b.x, b.y) < 8) {
        this.emitActivity()
        this.wake()
        return // geste trop court : on n'ajoute rien
      }
      if (c.tool === 'arrow') c.anim = { start: now, duration: 300 }
    }
    if (this.opts.fadeDelay != null) c.dieAt = now + this.opts.fadeDelay + (c.anim?.duration ?? 0)
    this.strokes.push(c)
    this.staticDirty = true
    this.emitActivity()
    this.wake()
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
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const d = this.strokes[i].dying
      if (d && now - d.start >= d.duration) {
        this.strokes.splice(i, 1)
        purged = true
      }
    }
    if (purged) {
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
    if (this.staticDirty || dyingActive || animActive || this.grabbed) this.renderStatic(now)
    this.renderLive(now)

    const busy =
      this.current != null ||
      this.grabbed != null ||
      this.erasing ||
      this.particles.length > 0 ||
      this.laser.length > 0 ||
      dyingActive ||
      animActive
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
      const glowBoost = s === this.grabbed ? 1.45 : 1
      if (s.dying) {
        const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
        if (p > 0) {
          if (s.dying.mode === 'pop' || s.tool === 'arrow' || s.tool === 'line') {
            alpha = 1 - p
          } else {
            const n = s.points.length
            from = Math.floor(easeInQuad(p) * Math.max(0, n - 2))
            alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25
          }
        }
      }
      renderStroke(ctx, s, { alpha, from, glowBoost, now })
      if (s.dying && s.dying.mode === 'dissolve') {
        const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
        if (p > 0 && p < 1) {
          const head =
            s.tool === 'arrow' || s.tool === 'line'
              ? s.points[s.points.length - 1]
              : s.points[Math.min(from, s.points.length - 1)]
          const r = Math.max(6, s.size * (1.7 + Math.sin(now * 0.02) * 0.35))
          renderEmber(ctx, head.x, head.y, r, s.color, 1 - p * 0.4)
        }
      }
    }
    this.staticDirty = false
  }

  private renderLive(now: number): void {
    const ctx = this.lCtx
    ctx.clearRect(0, 0, this.w, this.h)
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
