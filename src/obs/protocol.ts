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
import type { DyingCause, DyingMode, Stroke, StrokePoint } from '../engine/types'

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

/**
 * TAILLE MAXIMALE D'UN MESSAGE, en caractères.
 *
 * Le relais IPC du processus principal (electron/main.ts, `hexa:obs-publish`)
 * refuse tout ce qui dépasse : un message géant recopié entre deux processus
 * gèle la boucle du principal, donc les raccourcis globaux et l'icône près de
 * l'horloge. La limite est donc SAINE — ce qui ne l'était pas, c'est de jeter
 * le message sans un mot : passé 4 Mo (~51 000 points, une heure de fondu
 * infini), la source navigateur restait vide POUR TOUJOURS, puisque l'émetteur
 * avait déjà noté la scène comme envoyée. D'où les deux règles d'aujourd'hui :
 * l'état complet part DÉCOUPÉ EN LOTS (voir OBS_BATCH_CHARS), et tout refus
 * remonte à l'émetteur au lieu de disparaître.
 */
export const OBS_MAX_MESSAGE = 4_000_000

/**
 * Taille visée d'un lot d'état complet, en caractères estimés.
 *
 * ⚠️ CE N'EST PLUS UN COMPROMIS DE DÉBIT, C'EST UN BUDGET DE TEMPS.
 *
 * L'état complet part à chaque reconnexion d'une source navigateur — donc, pour
 * un streamer qui coche « désactiver la source quand elle n'est pas visible »,
 * À CHAQUE CHANGEMENT DE SCÈNE. Il est maintenant ÉTALÉ sur plusieurs images
 * (voir ObsLink.pousserLot) : ce qui compte n'est plus de faire peu de messages,
 * c'est qu'aucun d'eux ne bloque la couche encre — celle qui est à l'antenne —
 * plus d'une poignée de millisecondes. Un lot de 600 000 caractères coûtait à
 * lui seul une dizaine de millisecondes de sérialisation ; à 120 000, on reste
 * sous l'image, et la scène entière arrive quand même en moins de 200 ms.
 *
 * Mesuré à 1 600 traits (36 800 points) : le plus long blocage de la couche
 * encre passe de 133 ms à moins de 4 ms par changement de scène OBS, pour une
 * quarantaine de messages au lieu d'un seul pavé.
 */
export const OBS_BATCH_CHARS = 80_000

export interface ObsStateFull {
  t: 'state:full'
  now: number
  strokes: Stroke[]
  mode: ObsMode
  /** taille de l'écran annoté, en pixels logiques (voir ObsViewport) */
  w?: number
  h?: number
  /** vrai quand la scène est trop grosse pour un message : des `state:more` suivent */
  more?: boolean
}

/**
 * Suite d'un `state:full` découpé en lots.
 *
 * Le premier message remet la vue à zéro et pose le début de la scène ; chacun
 * de ceux-ci AJOUTE la suite, sans jamais rien effacer. Une très longue session
 * de tableau blanc (des dizaines de milliers de points) arrive ainsi entière,
 * là où le message unique se faisait refuser en silence par le relais IPC.
 */
export interface ObsStateMore {
  t: 'state:more'
  now: number
  strokes: Stroke[]
  /** vrai tant qu'un autre lot suit */
  more?: boolean
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

/**
 * SEULES LES ÉCHÉANCES D'UN TRAIT ONT CHANGÉ — sa géométrie, sa couleur et ses
 * points sont exactement ceux déjà envoyés.
 *
 * Ce message existe pour une raison très concrète : la touche panique, le
 * bouton « masquer les annotations » et le curseur de fondu automatique
 * touchent TOUS LES TRAITS DE LA SCÈNE D'UN COUP. Avec un `stroke:update` par
 * trait, un tableau de deux mille annotations partait en deux mille copies
 * complètes — plusieurs mégaoctets et un gel bien visible, au moment précis où
 * le streamer veut faire disparaître quelque chose de l'antenne. Ici, chaque
 * trait tient en quatre champs, et tout le lot part en UN message.
 */
export interface ObsStrokePhase {
  t: 'stroke:phase'
  now: number
  items: {
    id: number
    dieAt?: number
    dying?: { start: number; duration: number; mode: DyingMode; cause?: DyingCause }
    anim?: { start: number; duration: number; kind?: 'draw' | 'head' }
  }[]
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
  | ObsStateMore
  | ObsStrokeAdd
  | ObsStrokePoints
  | ObsStrokeUpdate
  | ObsStrokePhase
  | ObsStrokeRemove
  | ObsClear
  | ObsModeMsg
  | ObsViewport

const KINDS = new Set([
  'hello',
  'state:full',
  'state:more',
  'stroke:add',
  'stroke:points',
  'stroke:update',
  'stroke:phase',
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
