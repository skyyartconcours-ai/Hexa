/**
 * Hexa — protocole du miroir OBS (brief §10.2).
 *
 * Un différenciateur qu'aucun concurrent n'a : la browser source d'OBS affiche
 * EXACTEMENT les mêmes annotations que l'overlay, rendues par la même base de
 * code, avec un fond transparent et aucune interface.
 *
 * Règles du transport :
 *  - messages JSON typés, jamais de HTML ;
 *  - `state:full` à la connexion (l'arrivée en cours de session est instantanée) ;
 *  - les points d'un trait en cours partent par LOTS (~30 Hz), jamais un
 *    message par point : c'est ce qui garde le coût réseau à zéro ;
 *  - horloge : chaque message porte l'instant `now` de l'émetteur, le miroir
 *    calcule son propre décalage (les deux pages n'ont pas la même origine de
 *    performance.now()).
 */
import type { Stroke, StrokePoint } from '../engine/types'

export const OBS_PROTOCOL_VERSION = 1

/** Port par défaut du serveur local (configurable dans les réglages). */
export const OBS_DEFAULT_PORT = 4787

/** Canal BroadcastChannel utilisé en démo navigateur (même origine, zéro serveur). */
export const OBS_CHANNEL = 'hexa-obs'

/** « Écran » : l'overlay est visible et OBS capture l'écran (défaut, §10.1).
 *  « Stream seul » : l'écran du streamer reste propre, seule la browser source
 *  affiche les annotations (§10.2). */
export type ObsMode = 'screen' | 'stream'

export interface ObsHello {
  t: 'hello'
  now: number
  version: number
  mode: ObsMode
}

export interface ObsStateFull {
  t: 'state:full'
  now: number
  strokes: Stroke[]
  mode: ObsMode
  /** taille de l'écran annoté, en pixels logiques (voir ObsViewport) */
  w?: number
  h?: number
}

/**
 * Taille de la surface annotée. INDISPENSABLE : les traits sont exprimés dans
 * les pixels de l'écran du streamer (1920×1080, 2560×1440…), alors que la
 * source navigateur d'OBS a la taille de la SCÈNE. Sans cette information, un
 * écran 1440p mirroité dans une scène 1080p verrait ses annotations décalées
 * et rognées : le miroir met tout à l'échelle grâce à ce message.
 */
export interface ObsViewport {
  t: 'viewport'
  now: number
  w: number
  h: number
}

export interface ObsStrokeAdd {
  t: 'stroke:add'
  now: number
  stroke: Stroke
}

export interface ObsStrokePoints {
  t: 'stroke:points'
  now: number
  id: number
  /** points ajoutés depuis le dernier lot */
  points: StrokePoint[]
  done: boolean
}

export interface ObsStrokeUpdate {
  t: 'stroke:update'
  now: number
  stroke: Stroke
}

export interface ObsStrokeRemove {
  t: 'stroke:remove'
  now: number
  ids: number[]
}

export interface ObsClear {
  t: 'clear'
  now: number
}

export interface ObsModeMsg {
  t: 'mode'
  now: number
  mode: ObsMode
}

export type ObsMessage =
  | ObsHello
  | ObsStateFull
  | ObsStrokeAdd
  | ObsStrokePoints
  | ObsStrokeUpdate
  | ObsStrokeRemove
  | ObsClear
  | ObsModeMsg
  | ObsViewport

const KINDS = new Set([
  'hello',
  'state:full',
  'stroke:add',
  'stroke:points',
  'stroke:update',
  'stroke:remove',
  'clear',
  'mode',
  'viewport',
])

/** Garde-fou : tout ce qui arrive du réseau est vérifié avant d'être appliqué. */
export function isObsMessage(value: unknown): value is ObsMessage {
  if (typeof value !== 'object' || value === null) return false
  const t = (value as { t?: unknown }).t
  return typeof t === 'string' && KINDS.has(t)
}

export function parseObsMessage(raw: string): ObsMessage | null {
  try {
    const data: unknown = JSON.parse(raw)
    return isObsMessage(data) ? data : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Sens inverse : vue → Hexa
 * ------------------------------------------------------------------ */

/**
 * Le SEUL message qu'une vue a le droit d'envoyer : « je viens d'ouvrir,
 * envoie-moi tout ». Volontairement unique — rien venu du réseau ne doit
 * pouvoir piloter Hexa. Le serveur (electron/obs-server.ts) rejette le reste.
 *
 * Il est indispensable : OBS recharge une source navigateur quand elle devient
 * visible (option « Rafraîchir le navigateur quand la scène devient active »),
 * et sans cette demande la source repartirait vide jusqu'au trait suivant.
 */
export const OBS_HELLO = { t: 'obs:hello', version: OBS_PROTOCOL_VERSION } as const

/** Taille conseillée d'une source navigateur : celle du canevas de la scène. */
export interface ObsCanvasSize {
  width: number
  height: number
}

/** Résolution la plus probable de la scène du streamer, pour le mode d'emploi. */
export function suggestedCanvasSize(): ObsCanvasSize {
  if (typeof window === 'undefined') return { width: 1920, height: 1080 }
  const w = Math.round(window.screen?.width ?? 1920)
  const h = Math.round(window.screen?.height ?? 1080)
  // Une scène OBS est presque toujours en 1920×1080, même sur un écran plus
  // grand : on ne propose l'écran réel que s'il est plus petit.
  if (w >= 1920 && h >= 1080) return { width: 1920, height: 1080 }
  return { width: w || 1920, height: h || 1080 }
}
