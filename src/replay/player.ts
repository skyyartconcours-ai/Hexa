/**
 * Hexa — rejeu de session (brief §11, « l'idée forte pour la masterclass »).
 *
 * Les traits sont horodatés à la capture (startedAt, endedAt, points[].t) : on
 * peut donc rejouer une session EXACTEMENT à son rythme d'origine, point par
 * point, y compris les fondus automatiques et les annulations. Le rejeu se fait
 * sur son propre canvas : la session en cours n'est jamais touchée.
 *
 * Performance : une rAF qui ne tourne QUE pendant la lecture. En pause, un seul
 * rendu est programmé puis plus rien (§2.5, §13). Jamais de setInterval.
 */
import type { SessionExport, Stroke } from '../engine/types'
import { dissolveDuration, paintStrokes } from './paint'

export interface ReplayState {
  /** position de lecture en ms depuis le début de la session */
  t: number
  duration: number
  playing: boolean
  speed: number
  loop: boolean
}

/** Petite respiration à la fin, pour ne pas couper net sur la dernière image. */
const TAIL_MS = 500

/** Nombre de points visibles à l'instant T (recherche dichotomique). */
function countPoints(points: { t: number }[], t: number): number {
  if (points.length === 0) return 0
  if (points[0].t > t) return 0
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class ReplayPlayer {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  /** traits normalisés : tous les temps sont relatifs au début de la session */
  private strokes: Stroke[] = []
  private w = 0
  private h = 0

  private t = 0
  private dur = 0
  private speed = 1
  private playing = false
  private looping = true
  private raf = 0
  /** rendu ponctuel (pause, seek) — distinct de la boucle de lecture */
  private oneShot = 0
  private lastFrame = 0
  private lastEmit = 0

  /** notifié au fil de la lecture (position, état) — throttlé pour l'interface */
  onState?: (state: ReplayState) => void

  /** Charge une session et remet la tête de lecture au début. */
  load(session: SessionExport): void {
    const src = session.strokes.filter((s) => s.points.length > 0)
    let t0 = Infinity
    for (const s of src) t0 = Math.min(t0, s.startedAt, s.points[0].t)
    if (!Number.isFinite(t0)) t0 = 0

    const shift = (v: number | undefined): number | undefined =>
      v == null ? undefined : v - t0

    this.strokes = src
      .map((s) => {
        const c = structuredClone(s)
        c.startedAt -= t0
        c.endedAt = shift(c.endedAt)
        c.dieAt = shift(c.dieAt)
        for (const p of c.points) p.t -= t0
        if (c.dying) c.dying = { ...c.dying, start: c.dying.start - t0 }
        if (c.anim) c.anim = { ...c.anim, start: c.anim.start - t0 }
        return c
      })
      .sort((a, b) => a.startedAt - b.startedAt)

    let end = 0
    for (const s of this.strokes) {
      const last = s.points[s.points.length - 1].t
      end = Math.max(end, s.endedAt ?? last, last)
      if (s.dying) end = Math.max(end, s.dying.start + s.dying.duration)
      else if (s.dieAt != null) end = Math.max(end, s.dieAt + dissolveDuration(s))
    }
    this.dur = this.strokes.length > 0 ? end + TAIL_MS : 0
    this.t = 0
    this.playing = false
    this.requestRender()
    this.emit(true)
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.resize()
  }

  detach(): void {
    this.playing = false
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.oneShot) cancelAnimationFrame(this.oneShot)
    this.raf = 0
    this.oneShot = 0
    this.canvas = null
    this.ctx = null
  }

  resize(): void {
    const cv = this.canvas
    const ctx = this.ctx
    if (!cv || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.w = cv.clientWidth
    this.h = cv.clientHeight
    cv.width = Math.round(this.w * dpr)
    cv.height = Math.round(this.h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.requestRender()
  }

  get state(): ReplayState {
    return { t: this.t, duration: this.dur, playing: this.playing, speed: this.speed, loop: this.looping }
  }

  get isEmpty(): boolean {
    return this.strokes.length === 0
  }

  /** Densité d'activité par tranche, pour dessiner la mini-frise du scrubber. */
  density(buckets: number): number[] {
    const out = new Array<number>(buckets).fill(0)
    if (this.dur <= 0) return out
    // on compte les POINTS posés dans chaque tranche : c'est le vrai profil
    // d'activité du geste, pas un simple décompte de traits
    for (const s of this.strokes) {
      for (const p of s.points) {
        const i = Math.max(0, Math.min(buckets - 1, Math.floor((p.t / this.dur) * buckets)))
        out[i] += 1
      }
    }
    // léger lissage : une frise en dents de scie est illisible à cette taille
    const smooth = out.map((v, i) => v * 0.6 + (out[i - 1] ?? 0) * 0.2 + (out[i + 1] ?? 0) * 0.2)
    const max = Math.max(1, ...smooth)
    return smooth.map((v) => Math.min(1, v / max))
  }

  play(): void {
    if (this.playing || this.dur <= 0) return
    if (this.t >= this.dur) this.t = 0
    this.playing = true
    this.lastFrame = performance.now()
    // un rendu ponctuel pouvait être en attente : il ne fait PAS avancer le
    // temps, on le remplace par la boucle de lecture
    if (this.oneShot) {
      cancelAnimationFrame(this.oneShot)
      this.oneShot = 0
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick)
    this.emit(true)
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.emit(true)
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.dur, t))
    this.requestRender()
    this.emit(true)
  }

  setSpeed(speed: number): void {
    this.speed = speed
    this.emit(true)
  }

  setLoop(loop: boolean): void {
    this.looping = loop
    this.emit(true)
  }

  /** Une seule image, sans démarrer la lecture (pause, seek, redimensionnement). */
  private requestRender(): void {
    if (this.playing || this.oneShot || !this.ctx) return
    this.oneShot = requestAnimationFrame(() => {
      this.oneShot = 0
      this.render()
    })
  }

  private tick = (): void => {
    this.raf = 0
    const now = performance.now()
    const dt = Math.min(now - this.lastFrame, 120)
    this.lastFrame = now
    if (this.playing) {
      this.t += dt * this.speed
      if (this.t >= this.dur) {
        if (this.looping) this.t = 0
        else {
          this.t = this.dur
          this.playing = false
        }
      }
    }
    this.render()
    this.emit(!this.playing)
    if (this.playing) this.raf = requestAnimationFrame(this.tick)
  }

  /** Liste des traits tels qu'ils étaient à l'instant T. */
  project(t: number): Stroke[] {
    const out: Stroke[] = []
    for (const s of this.strokes) {
      if (s.startedAt > t) break
      const die =
        s.dying ??
        (s.dieAt != null
          ? { start: s.dieAt, duration: dissolveDuration(s), mode: 'dissolve' as const }
          : undefined)
      if (die && t >= die.start + die.duration) continue
      const n = countPoints(s.points, t)
      if (n === 0) continue
      const full = n >= s.points.length
      out.push({
        ...s,
        points: full ? s.points : s.points.slice(0, n),
        done: s.endedAt != null ? t >= s.endedAt : full,
        dying: die && t >= die.start ? die : undefined,
      })
    }
    return out
  }

  private render(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.clearRect(0, 0, this.w, this.h)
    paintStrokes(ctx, this.project(this.t), this.t)
  }

  /** L'interface n'a pas besoin de 60 rafraîchissements par seconde. */
  private emit(force: boolean): void {
    const now = performance.now()
    if (!force && now - this.lastEmit < 66) return
    this.lastEmit = now
    this.onState?.(this.state)
  }
}
