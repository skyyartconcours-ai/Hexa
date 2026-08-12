/**
 * Hexa — miroir d'annotations (côté browser source OBS).
 *
 * Reçoit les messages du protocole, reconstitue la liste de traits et la
 * dessine avec LA MÊME recette que l'overlay (src/replay/paint.ts →
 * src/engine/render.ts). « Une seule base de code de rendu, deux vues » (§10.2).
 *
 * Perf : rAF dormante. Elle démarre quand quelque chose bouge (trait en cours,
 * dissolution, animation) et s'éteint dès que l'image est stable. Une browser
 * source OBS qui ne consomme rien au repos, c'est la moindre des politesses
 * envers le jeu qui tourne à côté.
 */
import type { Stroke } from '../engine/types'
import { dissolveDuration, panicDying } from '../engine/dissolve'
import { paintStrokes } from '../replay/paint'
import type { ObsMessage, ObsMode } from './protocol'

export class ObsMirror {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private order: number[] = []
  private map = new Map<number, Stroke>()
  /** décalage entre l'horloge de l'émetteur et la nôtre */
  private offset: number | null = null
  private w = 0
  private h = 0
  /** taille de l'écran annoté chez le streamer (0 = inconnue, on suit la nôtre) */
  private srcW = 0
  private srcH = 0
  private raf = 0
  private wakeTimer: ReturnType<typeof setTimeout> | null = null

  mode: ObsMode = 'screen'
  /** notifié à la première image reçue (masquer le voile d'attente) */
  onFirstState?: () => void
  private gotState = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.resize()
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.raf = 0
    this.wakeTimer = null
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.w = this.canvas.clientWidth
    this.h = this.canvas.clientHeight
    this.canvas.width = Math.round(this.w * dpr)
    this.canvas.height = Math.round(this.h * dpr)
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.wake()
  }

  get strokeCount(): number {
    return this.map.size
  }

  /** Applique un message du protocole. Tolérant : un message inconnu est ignoré. */
  apply(msg: ObsMessage): void {
    this.sync(msg.now)
    switch (msg.t) {
      case 'hello':
        this.mode = msg.mode
        break
      case 'state:full': {
        this.order = []
        this.map.clear()
        this.mode = msg.mode
        if (msg.w && msg.h) this.setSource(msg.w, msg.h)
        for (const s of msg.strokes) this.put(s)
        break
      }
      case 'viewport':
        this.setSource(msg.w, msg.h)
        break
      case 'stroke:add':
        this.put(msg.stroke)
        break
      case 'stroke:points': {
        const s = this.map.get(msg.id)
        if (!s) break
        for (const p of msg.points) s.points.push(p)
        s.done = msg.done
        break
      }
      case 'stroke:update':
        this.put(msg.stroke)
        break
      case 'stroke:remove':
        for (const id of msg.ids) this.drop(id)
        break
      case 'clear': {
        // EXACTEMENT le même geste que la touche panique côté overlay — même
        // cascade plafonnée, même fondu court (src/engine/dissolve.ts). Ce qui
        // quitte l'écran du coach quitte le stream au même instant.
        const now = performance.now()
        let i = 0
        for (const id of this.order) {
          const s = this.map.get(id)
          if (!s || s.dying) continue
          s.dying = panicDying(i, now)
          i++
        }
        break
      }
      case 'mode':
        this.mode = msg.mode
        break
    }
    if (!this.gotState) {
      this.gotState = true
      this.onFirstState?.()
    }
    this.wake()
  }

  /** Mémorise la taille de l'écran annoté (source des coordonnées). */
  private setSource(w: number, h: number): void {
    if (!(w > 0) || !(h > 0)) return
    if (this.srcW === w && this.srcH === h) return
    this.srcW = w
    this.srcH = h
  }

  /**
   * Passage « écran du streamer » → « scène OBS ».
   *
   * Un écran 2560×1440 mirroité dans une scène 1920×1080 doit rentrer
   * ENTIÈREMENT : on met à l'échelle uniformément (les cercles restent ronds)
   * et on centre. Quand les deux tailles coïncident — le cas courant, 1080p
   * partout — l'échelle vaut 1 et rien ne bouge d'un pixel.
   */
  private fit(): { scale: number; dx: number; dy: number } {
    if (!this.srcW || !this.srcH || !this.w || !this.h) return { scale: 1, dx: 0, dy: 0 }
    const scale = Math.min(this.w / this.srcW, this.h / this.srcH)
    return {
      scale,
      dx: (this.w - this.srcW * scale) / 2,
      dy: (this.h - this.srcH * scale) / 2,
    }
  }

  private sync(remoteNow: number): void {
    const local = performance.now()
    const delta = local - remoteNow
    // première mesure, ou dérive anormale (page rechargée en face) : on resynchronise
    if (this.offset == null || Math.abs(delta - this.offset) > 2000) this.offset = delta
  }

  /** Traduit les instants de l'émetteur vers notre horloge. */
  private localize(s: Stroke): Stroke {
    const off = this.offset ?? 0
    if (s.dieAt != null) s.dieAt += off
    if (s.dying) s.dying = { ...s.dying, start: s.dying.start + off }
    if (s.anim) s.anim = { ...s.anim, start: s.anim.start + off }
    return s
  }

  private put(s: Stroke): void {
    const stroke = this.localize(s)
    if (!this.map.has(stroke.id)) this.order.push(stroke.id)
    this.map.set(stroke.id, stroke)
  }

  private drop(id: number): void {
    const s = this.map.get(id)
    if (!s) return
    // disparition côté émetteur : on laisse une sortie douce plutôt qu'un saut
    if (!s.dying) s.dying = { start: performance.now(), duration: 200, mode: 'pop' }
  }

  private wake(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.loop)
  }

  private loop = (): void => {
    this.raf = 0
    const now = performance.now()

    // fondu automatique : dieAt → dissolution (au cas où le message d'update
    // se perdrait, le miroir reste juste tout seul)
    for (const id of this.order) {
      const s = this.map.get(id)
      if (s && !s.dying && s.dieAt != null && now >= s.dieAt) {
        s.dying = { start: now, duration: dissolveDuration(s), mode: 'dissolve', cause: 'fade' }
      }
    }
    // purge des traits entièrement dissous
    let purged = false
    for (let i = this.order.length - 1; i >= 0; i--) {
      const s = this.map.get(this.order[i])
      if (!s) {
        this.order.splice(i, 1)
        continue
      }
      if (s.dying && now - s.dying.start >= s.dying.duration) {
        this.map.delete(s.id)
        this.order.splice(i, 1)
        purged = true
      }
    }

    this.render(now)

    const busy =
      purged ||
      this.order.some((id) => {
        const s = this.map.get(id)
        if (!s) return false
        return !!s.dying || (!!s.anim && now - s.anim.start < s.anim.duration) || !s.done
      })
    if (busy) {
      this.raf = requestAnimationFrame(this.loop)
      return
    }
    // rien d'animé : on s'éteint, en programmant le prochain fondu s'il y en a un
    let next = Infinity
    for (const id of this.order) {
      const s = this.map.get(id)
      if (s && !s.dying && s.dieAt != null) next = Math.min(next, s.dieAt)
    }
    if (next < Infinity) {
      this.wakeTimer = setTimeout(
        () => {
          this.wakeTimer = null
          this.wake()
        },
        Math.max(16, next - now),
      )
    }
  }

  private render(now: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    const list: Stroke[] = []
    for (const id of this.order) {
      const s = this.map.get(id)
      if (s) list.push(s)
    }
    // mise à l'échelle écran → scène, appliquée à la matrice : le rendu reste
    // celui du moteur, au pixel près, sans toucher aux coordonnées des traits
    const { scale, dx, dy } = this.fit()
    if (scale !== 1 || dx !== 0 || dy !== 0) {
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * dx, dpr * dy)
    }
    paintStrokes(ctx, list, now)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
