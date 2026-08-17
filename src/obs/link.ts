/**
 * Hexa — émetteur du miroir OBS (brief §10.2).
 *
 * Reçoit à chaque image active l'état du moteur (hook `onMirror`), calcule le
 * DIFFÉRENTIEL et l'émet en JSON typé. Deux transports, choisis tout seuls :
 *
 *  - en overlay Electron : IPC → serveur HTTP/WebSocket local (127.0.0.1) ;
 *  - en démo navigateur : BroadcastChannel, même origine, zéro serveur — la
 *    page obs.html ouverte dans un autre onglet est synchronisée à l'identique.
 *
 * Budget : un balayage toutes les 33 ms au maximum (~30 Hz), jamais un message
 * par point (§13). Quand rien ne bouge, le moteur n'appelle pas ce module :
 * coût nul au repos.
 *
 * ⚠️ ET SURTOUT : ON NE TRAVAILLE QUE SI QUELQU'UN REGARDE.
 *
 * Le serveur local est allumé d'usine (voir OBS_DEFAULTS) pour que coller
 * l'adresse dans OBS suffise. Mais l'immense majorité des sessions se déroule
 * SANS source navigateur : le streamer a OBS ouvert, il capture son écran, et
 * il n'a jamais ajouté la vue d'Hexa. Le miroir balayait quand même TOUS les
 * traits toutes les 33 ms, en clonait, en sérialisait le JSON et l'envoyait par
 * IPC au processus principal — qui le jetait, faute de destinataire. Mesuré sur
 * une session de 400 traits : 3 761 messages, 877 Kio, cent pour cent perdus, et
 * un coût par image qui grimpe avec le nombre d'annotations puisque le balayage
 * est proportionnel à la scène. C'est exactement la dégradation progressive que
 * décrivent les utilisateurs.
 *
 * `viewers` porte donc le nombre de vues RÉELLEMENT connectées, poussé par le
 * processus principal. À zéro, ce module ne fait plus rien du tout ; à la
 * première connexion, l'état complet part immédiatement (voir ObsBridge).
 */
import type { Stroke } from '../engine/types'
import { OBS_CHANNEL, type ObsMessage, type ObsMode } from './protocol'

/** Fenêtre d'échantillonnage des lots de points. */
const SAMPLE_MS = 33

/** Surface Electron ajoutée par le preload — typée ici pour ne pas toucher bridge.ts. */
interface ObsHost {
  obsPublish?: (payload: string) => void
}

function host(): ObsHost | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { hexa?: ObsHost }).hexa
}

interface SentInfo {
  len: number
  sig: string
}

/** Signature compacte : tout ce qui peut changer SANS ajouter de point. */
function signature(s: Stroke): string {
  const p0 = s.points[0]
  const pn = s.points[s.points.length - 1]
  return [
    s.tool,
    s.color,
    s.size,
    s.done ? 1 : 0,
    s.filled ? 1 : 0,
    s.dieAt == null ? '' : Math.round(s.dieAt),
    s.dying ? `${Math.round(s.dying.start)}${s.dying.mode}` : '',
    s.anim ? Math.round(s.anim.start) : '',
    p0 ? `${p0.x | 0},${p0.y | 0}` : '',
    pn ? `${pn.x | 0},${pn.y | 0}` : '',
    s.text ?? '',
    s.badge ?? '',
    s.linkFrom ?? '',
    s.w ?? '',
  ].join('|')
}

export class ObsLink {
  private enabled = true
  private mode: ObsMode = 'screen'
  /**
   * Nombre de vues OBS connectées au serveur local. `-1` = on ne sait pas
   * encore (le processus principal n'a pas répondu) : on se tait, ce qui est
   * le bon défaut — une vue qui arrive réclame de toute façon l'état complet.
   */
  private viewers = -1
  private channel: BroadcastChannel | null = null
  private sent = new Map<number, SentInfo>()
  private lastScan = 0
  private lastStrokes: readonly Stroke[] = []
  private lastCurrent: Stroke | null = null
  /** regroupement des demandes d'état complet (voir requestFull) */
  private fullTimer: ReturnType<typeof setTimeout> | null = null
  /** regroupement des changements de résolution */
  private sizeTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // La taille de l'écran annoté suit les changements de résolution (le
    // streamer passe en 1080p pour jouer, revient en 1440p…). Un écouteur
    // passif, aucun sondage : le coût au repos reste nul.
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        if (this.sizeTimer != null) return
        this.sizeTimer = setTimeout(() => {
          this.sizeTimer = null
          this.sendViewport()
        }, 250)
      })
    }
    if (typeof BroadcastChannel !== 'undefined' && !host()?.obsPublish) {
      try {
        this.channel = new BroadcastChannel(OBS_CHANNEL)
        // une vue qui vient d'ouvrir demande l'état complet
        this.channel.onmessage = (e: MessageEvent) => {
          if ((e.data as { t?: string } | null)?.t === 'obs:hello') this.sendFull()
        }
      } catch {
        this.channel = null
      }
    }
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return
    this.enabled = on
    if (on) this.sendFull()
    else this.sent.clear()
  }

  /**
   * Nombre de sources navigateur connectées, poussé par le processus principal
   * (canal `obs-clients`). C'est l'interrupteur général du miroir : à zéro, plus
   * un balayage, plus un clone, plus un message.
   */
  setViewers(count: number): void {
    const n = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0
    if (n === this.viewers) return
    const avant = this.viewers
    this.viewers = n
    // Plus personne : on lâche l'index des traits déjà envoyés. Il est périmé
    // de toute façon, et il pesait un descripteur par annotation de la session.
    if (n === 0) this.sent.clear()
    // Première vue de la salve : elle doit voir l'écran tel qu'il est MAINTENANT.
    else if (avant <= 0) this.requestFull()
  }

  /** Quelqu'un attend-il vraiment nos messages ? */
  private audience(): boolean {
    // Démo navigateur : le BroadcastChannel n'a pas de compteur d'abonnés, et
    // il ne coûte rien (même processus, pas d'IPC). On publie comme avant.
    if (!host()?.obsPublish) return true
    return this.viewers > 0
  }

  setMode(mode: ObsMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.send({ t: 'mode', now: performance.now(), mode })
  }

  /** Appelé par le moteur à chaque image active. Doit rester très bon marché. */
  publish(strokes: readonly Stroke[], current: Stroke | null): void {
    // Deux affectations, jamais davantage tant que personne ne regarde : c'est
    // ce qu'il faut pour pouvoir servir l'état complet à la première connexion.
    this.lastStrokes = strokes
    this.lastCurrent = current
    if (!this.enabled || !this.audience()) return
    const now = performance.now()
    if (now - this.lastScan < SAMPLE_MS) return
    this.lastScan = now
    this.scan(now)
  }

  /**
   * Renvoie tout l'état, mais au plus une fois par salve : quand OBS ouvre une
   * scène, plusieurs sources peuvent se connecter dans la même milliseconde.
   * Une seule copie complète part alors, au lieu de N.
   */
  requestFull(): void {
    if (this.fullTimer != null) return
    this.fullTimer = setTimeout(() => {
      this.fullTimer = null
      this.sendFull()
    }, 40)
  }

  /** Renvoie tout l'état : à la connexion d'une vue, ou au réveil du miroir. */
  sendFull(): void {
    if (!this.enabled || !this.audience()) return
    const strokes = this.lastCurrent
      ? [...this.lastStrokes, this.lastCurrent]
      : [...this.lastStrokes]
    this.sent.clear()
    for (const s of strokes) this.sent.set(s.id, { len: s.points.length, sig: signature(s) })
    const { w, h } = this.viewport()
    this.send({
      t: 'state:full',
      now: performance.now(),
      strokes: structuredClone(strokes),
      mode: this.mode,
      w,
      h,
    })
  }

  /** Taille de l'écran annoté, en pixels logiques. */
  private viewport(): { w: number; h: number } {
    if (typeof window === 'undefined') return { w: 0, h: 0 }
    return { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) }
  }

  /** Annonce la taille de l'écran : sans elle, la vue OBS décale tout (§10.2). */
  sendViewport(): void {
    const { w, h } = this.viewport()
    if (!w || !h) return
    this.send({ t: 'viewport', now: performance.now(), w, h })
  }

  /** Tout effacer côté miroir (touche panique). */
  clear(): void {
    this.sent.clear()
    this.send({ t: 'clear', now: performance.now() })
  }

  private scan(now: number): void {
    const seen = new Set<number>()
    const visit = (s: Stroke) => {
      seen.add(s.id)
      const prev = this.sent.get(s.id)
      const sig = signature(s)
      if (!prev) {
        this.send({ t: 'stroke:add', now, stroke: structuredClone(s) })
        this.sent.set(s.id, { len: s.points.length, sig })
        return
      }
      if (s.points.length > prev.len) {
        // lot de points : seulement la queue depuis le dernier envoi
        this.send({
          t: 'stroke:points',
          now,
          id: s.id,
          points: s.points.slice(prev.len).map((p) => ({ ...p })),
          done: s.done,
        })
        prev.len = s.points.length
        prev.sig = sig
        return
      }
      if (prev.sig !== sig) {
        // déplacement, redressement, fondu programmé… : on renvoie le trait
        this.send({ t: 'stroke:update', now, stroke: structuredClone(s) })
        prev.len = s.points.length
        prev.sig = sig
      }
    }

    for (const s of this.lastStrokes) visit(s)
    if (this.lastCurrent) visit(this.lastCurrent)

    if (seen.size < this.sent.size) {
      const gone: number[] = []
      for (const id of this.sent.keys()) if (!seen.has(id)) gone.push(id)
      for (const id of gone) this.sent.delete(id)
      if (gone.length > 0) this.send({ t: 'stroke:remove', now, ids: gone })
    }
  }

  private send(msg: ObsMessage): void {
    // Dernier filtre, celui qui garantit qu'AUCUN octet ne part dans le vide.
    // Les rares messages ponctuels perdus ici (mode, taille d'écran, effacement)
    // sont tous reportés dans le prochain `state:full`, envoyé à la connexion.
    if (!this.audience()) return
    const h = host()
    if (h?.obsPublish) {
      try {
        h.obsPublish(JSON.stringify(msg))
      } catch {
        /* un miroir qui tombe ne doit jamais gêner le dessin */
      }
      return
    }
    if (this.channel) {
      try {
        this.channel.postMessage(msg)
      } catch {
        /* idem */
      }
    }
  }
}

export const obsLink = new ObsLink()
