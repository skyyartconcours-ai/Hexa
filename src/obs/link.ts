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
 */
import type { Stroke } from '../engine/types'
import { OBS_CHANNEL, OBS_PROTOCOL_VERSION, type ObsMessage, type ObsMode } from './protocol'

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
  private channel: BroadcastChannel | null = null
  private sent = new Map<number, SentInfo>()
  private lastScan = 0
  private lastStrokes: readonly Stroke[] = []
  private lastCurrent: Stroke | null = null

  constructor() {
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

  setMode(mode: ObsMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.send({ t: 'mode', now: performance.now(), mode })
  }

  /** Appelé par le moteur à chaque image active. Doit rester très bon marché. */
  publish(strokes: readonly Stroke[], current: Stroke | null): void {
    this.lastStrokes = strokes
    this.lastCurrent = current
    if (!this.enabled) return
    const now = performance.now()
    if (now - this.lastScan < SAMPLE_MS) return
    this.lastScan = now
    this.scan(now)
  }

  /** Renvoie tout l'état : à la connexion d'une vue, ou au réveil du miroir. */
  sendFull(): void {
    if (!this.enabled) return
    const strokes = this.lastCurrent
      ? [...this.lastStrokes, this.lastCurrent]
      : [...this.lastStrokes]
    this.sent.clear()
    for (const s of strokes) this.sent.set(s.id, { len: s.points.length, sig: signature(s) })
    this.send({
      t: 'state:full',
      now: performance.now(),
      strokes: structuredClone(strokes),
      mode: this.mode,
    })
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

/** Message de politesse envoyé par une vue qui vient de s'ouvrir (démo navigateur). */
export const OBS_HELLO_REQUEST = { t: 'obs:hello', version: OBS_PROTOCOL_VERSION } as const
