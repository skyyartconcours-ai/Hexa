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
 *
 * Perf, la vraie : CALQUE CONSOLIDÉ (src/engine/ink-fx.ts). Cette page-ci
 * tourne DANS OBS, sur le processeur du streamer, à côté du jeu et de
 * l'encodeur. Repeindre les 800 traits d'une longue session à chaque image —
 * contour perfect-freehand et passes de halo comprises — coûtait 33 ms par
 * image : la source navigateur tombait à 5 images par seconde et tirait toute
 * la machine avec elle, de plus en plus fort à mesure que la scène se
 * remplissait. Les traits POSÉS sont donc peints UNE fois hors écran et
 * restitués en un seul `drawImage` ; par image, on ne repeint plus que ce qui
 * bouge vraiment (trait en cours, dissolutions, trait qu'on déplace).
 */
import type { Stroke } from '../engine/types'
import { dissolveDuration, panicDying } from '../engine/dissolve'
import { InkLayer } from '../engine/ink-fx'
import { getFxIntensity, paintSettled, paintStrokes } from '../replay/paint'
import type { ObsMessage, ObsMode } from './protocol'

/**
 * Un trait retouché reste hors du calque pendant ce délai.
 *
 * Vu du miroir, une annotation qu'on est en train de DÉPLACER chez le streamer
 * a l'air parfaitement posée : terminée, immobile, sans animation. Elle entre
 * donc dans le calque… et en ressort à l'`update` suivant, trente fois par
 * seconde, chaque fois au prix d'une reconstruction. On la garde « chaude »
 * quelques dixièmes de seconde après sa dernière retouche : pendant le geste
 * elle est peinte à la main (un trait), et elle se consolide une fois posée.
 */
const HOT_MS = 400

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
  /** calque consolidé des traits posés — l'instance est À NOUS (voir ink-fx) */
  private layer = new InkLayer()
  /** dernière retouche reçue par trait : id → instant local */
  private touched = new Map<number, number>()
  /** instant où la dernière retouche cesse d'être « chaude » (0 = aucune) */
  private hotUntil = 0

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
    // rend les deux canevas hors écran du calque : une source navigateur
    // détruite ne doit pas laisser ses mégaoctets dans le processus d'OBS
    this.layer.reset()
    this.touched.clear()
    this.hotUntil = 0
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
        // On repart d'une liste neuve : les traits portent les mêmes
        // identifiants mais rien ne dit qu'ils ont le même contenu (une
        // annotation a pu être déplacée pendant la coupure). Le calque doit
        // donc être jeté, sinon il resservirait une peinture périmée.
        this.layer.reset()
        this.touched.clear()
        this.hotUntil = 0
        this.mode = msg.mode
        if (msg.w && msg.h) this.setSource(msg.w, msg.h)
        // `frais = false` : un état complet décrit une scène DÉJÀ stable. La
        // garder chaude condamnerait la source à repeindre toute la session à
        // la main pendant une demi-seconde à chaque changement de scène OBS.
        for (const s of msg.strokes) this.put(s, false)
        break
      }
      // Suite d'un état complet DÉCOUPÉ EN LOTS : on AJOUTE, on n'efface rien.
      // Une scène de plusieurs mégaoctets ne passe pas dans un seul message —
      // le relais IPC la refuse — elle arrive donc en plusieurs fois. Mêmes
      // règles que ci-dessus : ces traits-là sont déjà stables.
      case 'state:more':
        for (const s of msg.strokes) this.put(s, false)
        break
      case 'viewport':
        this.setSource(msg.w, msg.h)
        break
      case 'stroke:add':
        this.put(msg.stroke)
        break
      case 'stroke:points': {
        const s = this.map.get(msg.id)
        if (!s) break
        this.retoucher(s.id)
        for (const p of msg.points) s.points.push(p)
        s.done = msg.done
        break
      }
      case 'stroke:update':
        this.put(msg.stroke)
        break
      // Seules les ÉCHÉANCES ont bougé : le trait garde sa géométrie, on ne
      // remplace donc rien. C'est ce qui rend gratuite la touche panique (et le
      // bouton « masquer ») sur un tableau plein — voir ObsStrokePhase.
      case 'stroke:phase': {
        const off = this.offset ?? 0
        if (!Array.isArray(msg.items)) break
        for (const it of msg.items) {
          const s = this.map.get(it.id)
          if (!s) continue
          s.dieAt = it.dieAt == null ? undefined : it.dieAt + off
          s.dying = it.dying ? { ...it.dying, start: it.dying.start + off } : undefined
          s.anim = it.anim ? { ...it.anim, start: it.anim.start + off } : undefined
          this.retoucher(s.id)
        }
        break
      }
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
    // `endedAt` DOIT être traduit lui aussi : c'est lui qui déclenche l'onde
    // d'allumage (src/engine/ink-fx.ts, igniteAt). Laissé dans l'horloge de
    // l'émetteur, il faisait courir une vague de rallumages fantômes le long
    // de la session, dans l'ordre de création et avec le retard exact séparant
    // les deux pages — des annotations vieilles de dix minutes qui se
    // rallumaient à l'antenne, et un calque à reconstruire à chaque fois.
    if (s.endedAt != null) s.endedAt += off
    return s
  }

  private put(s: Stroke, frais = true): void {
    const stroke = this.localize(s)
    if (!this.map.has(stroke.id)) this.order.push(stroke.id)
    this.map.set(stroke.id, stroke)
    if (frais) this.retoucher(stroke.id)
  }

  /**
   * Un trait vient d'être touché par un message : on le sort du calque et on le
   * garde chaud (voir HOT_MS).
   *
   * La règle est volontairement uniforme — ajout, lot de points, mise à jour :
   * un trait n'entre au calque qu'après un court silence. C'est ce qui évite le
   * pire des cas : un trait consolidé À PEINE POSÉ, puis aussitôt corrigé par
   * l'émetteur (le moteur simplifie le tracé au relâché), donc sorti du calque
   * et remis, chaque aller-retour coûtant une reconstruction complète.
   */
  private retoucher(id: number): void {
    const now = performance.now()
    this.layer.invalider(id)
    this.touched.set(id, now)
    this.hotUntil = now + HOT_MS
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
    // fin de la période chaude : les traits retouchés peuvent rejoindre le
    // calque. On vide la table d'un bloc — elle ne sert plus à rien.
    if (this.hotUntil !== 0 && now >= this.hotUntil) {
      this.touched.clear()
      this.hotUntil = 0
    }

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
      // une retouche vient d'arriver : on reste éveillé jusqu'à la remise au
      // calque, sinon le trait déplacé resterait peint à la main pour toujours
      this.hotUntil > now ||
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
    // ---- calque consolidé -------------------------------------------------
    // Les traits posés sortent d'une image hors écran en un seul appel. Le
    // calque se refait tout seul dès que la liste change autrement que par la
    // fin : annulation, dissolution, effacement, retouche, redimensionnement
    // de la source, nouvel état complet. Le vectoriel reste la source de
    // vérité — le calque n'est qu'un cache reconstructible.
    const glow = getFxIntensity()
    const settled = this.layer.compose(ctx, list, {
      w: this.w,
      h: this.h,
      now,
      glow,
      hot: (s) => {
        const t = this.touched.get(s.id)
        return t != null && now - t < HOT_MS
      },
      paint: (c, s) => paintSettled(c, s, now),
    })
    // ---- fin du calque ----------------------------------------------------
    paintStrokes(ctx, list, now, { skip: settled })
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
