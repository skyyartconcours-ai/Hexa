/**
 * Hexa — enregistreur de session (brief §11).
 *
 * Problème à résoudre : le moteur PURGE les traits dissous. Une session live
 * avec fondu automatique ne laisse donc rien derrière elle, et un rejeu de la
 * session courante serait vide. L'enregistreur archive tout ce qu'il a vu
 * passer, avec les horodatages d'origine, afin de pouvoir tout rejouer et tout
 * réexporter en vectoriel des heures après (§11.1 à §11.3).
 *
 * Coût : quasi nul. On garde la RÉFÉRENCE de chaque trait (le moteur le mute en
 * place : points ajoutés, dieAt posé, dissolution démarrée), donc aucune copie
 * par image. On ne clone qu'au moment de l'export.
 *
 * Aucune boucle : l'enregistreur est nourri par le hook `onMirror` du moteur,
 * qui n'est appelé que pendant que la rAF du moteur tourne (§2.5, §13).
 */
import type { SessionExport, Stroke } from '../engine/types'
import { dissolveDuration } from './paint'

/** Au-delà, on oublie les plus vieux traits : une session de stream reste bornée. */
const MAX_STROKES = 6000

interface Entry {
  s: Stroke
  /** instant où le trait a quitté le moteur SANS se dissoudre (undo) */
  gone?: number
}

export class SessionRecorder {
  private entries = new Map<number, Entry>()
  private lastLive = 0
  private listeners = new Set<() => void>()
  private notifyQueued = false
  /** vrai tant qu'on n'a jamais rien vu : évite de notifier pour rien */
  private lastCount = 0

  /**
   * Appelé par le moteur à chaque image active. Ne fait quasiment rien :
   * enregistrer les nouveaux traits, et repérer ceux qui ont disparu.
   */
  observe(strokes: readonly Stroke[], current: Stroke | null): void {
    for (const s of strokes) this.remember(s)
    if (current) this.remember(current)

    // Un trait a disparu de la liste du moteur ? Deux cas :
    //  - il s'était mis à mourir (fondu, touche panique) → l'archive garde son
    //    `dying`, le rejeu montrera la dissolution telle qu'elle a eu lieu ;
    //  - il a été annulé (Ctrl+Z) → on note l'instant, le rejeu le fera
    //    disparaître d'un pop à ce moment précis.
    const live = strokes.length + (current ? 1 : 0)
    if (live < this.lastLive) {
      const present = new Set<number>()
      for (const s of strokes) present.add(s.id)
      if (current) present.add(current.id)
      const now = performance.now()
      for (const [id, e] of this.entries) {
        if (e.gone != null || present.has(id)) continue
        if (!e.s.dying) e.gone = now
      }
    }
    this.lastLive = live
    if (this.entries.size !== this.lastCount) {
      this.lastCount = this.entries.size
      this.queueNotify()
    }
  }

  private remember(s: Stroke): void {
    const e = this.entries.get(s.id)
    if (e) {
      // réapparition (Ctrl+Y) : le trait est revenu, il n'est plus « parti »
      if (e.gone != null) e.gone = undefined
      return
    }
    this.entries.set(s.id, { s })
    if (this.entries.size > MAX_STROKES) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
  }

  /** Nombre de traits archivés (affiché dans les réglages). */
  get count(): number {
    return this.entries.size
  }

  /** Fenêtre temporelle couverte, en ms d'horloge `performance.now()`. */
  span(): { start: number; end: number } | null {
    let start = Infinity
    let end = -Infinity
    for (const { s, gone } of this.entries.values()) {
      start = Math.min(start, s.startedAt, s.points[0]?.t ?? s.startedAt)
      const last = s.points[s.points.length - 1]?.t ?? s.endedAt ?? s.startedAt
      let e = Math.max(s.endedAt ?? last, last)
      if (s.dying) e = Math.max(e, s.dying.start + s.dying.duration)
      else if (s.dieAt != null) e = Math.max(e, s.dieAt + dissolveDuration(s))
      if (gone != null) e = Math.max(e, gone + 200)
      end = Math.max(end, e)
    }
    if (!Number.isFinite(start)) return null
    return { start, end }
  }

  /** Durée rejouable en millisecondes. */
  get duration(): number {
    const s = this.span()
    return s ? Math.max(0, s.end - s.start) : 0
  }

  /**
   * Session complète, prête à rejouer ou exporter. Les traits annulés portent
   * un `dying` de type « pop » posé à l'instant de leur annulation : le rejeu
   * est fidèle à ce que le spectateur a vu.
   */
  session(): SessionExport {
    const out: Stroke[] = []
    for (const { s, gone } of this.entries.values()) {
      if (s.points.length === 0) continue
      const clone = structuredClone(s)
      if (gone != null && !clone.dying) {
        clone.dying = { start: gone, duration: 200, mode: 'pop' }
      }
      out.push(clone)
    }
    out.sort((a, b) => a.startedAt - b.startedAt)
    return { app: 'hexa', version: 1, exportedAt: new Date().toISOString(), strokes: out }
  }

  /** Session « à plat » : tout est vivant et terminé (export PNG, §11.2). */
  flatSession(): SessionExport {
    const s = this.session()
    for (const st of s.strokes) {
      st.dying = undefined
      st.anim = undefined
      st.dieAt = undefined
      st.done = true
    }
    return s
  }

  reset(): void {
    this.entries.clear()
    this.lastLive = 0
    this.lastCount = 0
    this.queueNotify()
  }

  /** Abonnement pour l'interface (compteur de traits), sans le moindre sondage. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Une seule notification par micro-tâche, même si l'archive bouge 60 fois/s. */
  private queueNotify(): void {
    if (this.notifyQueued || this.listeners.size === 0) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const cb of this.listeners) cb()
    })
  }
}

/** Instance unique : l'app n'a qu'un moteur. */
export const recorder = new SessionRecorder()

/* ------------------------------------------------------------------ *
 * Session mise en file d'attente pour le rejeu.
 * Permet aux réglages de dire « rejoue CE fichier » sans que l'App ait à
 * transporter l'objet : la barre de rejeu vient le chercher à son montage.
 * ------------------------------------------------------------------ */

let queued: SessionExport | null = null

export function queueReplay(session: SessionExport | null): void {
  queued = session
}

/** Récupère (et consomme) la session en attente, sinon null. */
export function takeQueuedReplay(): SessionExport | null {
  const s = queued
  queued = null
  return s
}
