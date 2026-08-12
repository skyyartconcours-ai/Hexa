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

const KINDS = new Set([
  'hello',
  'state:full',
  'stroke:add',
  'stroke:points',
  'stroke:update',
  'stroke:remove',
  'clear',
  'mode',
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
