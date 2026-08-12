/**
 * Pont renderer ↔ processus principal Electron.
 * En démo navigateur, toutes les fonctions sont des no-op : l'app reste testable partout.
 * Le preload Electron expose `window.hexa` (voir electron/preload.ts).
 */
/** Événements poussés par le processus principal vers la page. */
export interface BridgeEvents {
  /** raccourci global « mode dessin » : bascule demandée sur CET écran */
  'toggle-draw': () => void
  /** touche panique : tout effacer */
  'panic-clear': () => void
  /** état de mode dessin imposé par le main (ex. autre écran devenu actif) */
  'set-draw': (drawing: boolean) => void
  /** position du curseur pendant le Spike 0 (§14) */
  'spike-cursor': (point: { x: number; y: number }) => void
}

export type BridgeChannel = keyof BridgeEvents

/** Infos de l'écran porteur : bounds logiques + facteur DPI (§12.3). */
export interface HexaDisplayInfo {
  id: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  primary: boolean
}

/** Accélérateurs Electron des deux raccourcis GLOBAUX. */
export interface GlobalShortcuts {
  toggleDraw: string
  panic: string
}

export interface HexaBridgeApi {
  /** écran porteur de cette fenêtre overlay (null en démo navigateur) */
  display: HexaDisplayInfo | null
  /** active/désactive le clic traversant (setIgnoreMouseEvents + forward) */
  setPassthrough(v: boolean): void
  /** signale au main process si la couche contient quelque chose d'actif —
   *  règle §2.5 du brief : fenêtre cachée quand vide = zéro coût compositeur */
  notifyActivity(active: boolean): void
  /** s'abonner à un canal du main process ; renvoie la fonction de désabonnement */
  on<K extends BridgeChannel>(channel: K, cb: BridgeEvents[K]): () => void
  /** capture d'écran de l'affichage courant (loupe, gel d'image, flou) */
  captureScreen(): Promise<string | null>
  /** id de source desktopCapturer pour getUserMedia (flux continu, §6.1) */
  getScreenSourceId(): Promise<string | null>
  /** reconfigure les raccourcis globaux (mode dessin, panique) */
  setShortcuts(map: GlobalShortcuts): Promise<unknown>
}

declare global {
  interface Window {
    hexa?: Partial<HexaBridgeApi>
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.hexa

export const bridge: HexaBridgeApi = {
  display: (typeof window !== 'undefined' && window.hexa?.display) || null,
  setPassthrough: (v) => window.hexa?.setPassthrough?.(v),
  notifyActivity: (active) => window.hexa?.notifyActivity?.(active),
  on: (channel, cb) => window.hexa?.on?.(channel, cb) ?? (() => undefined),
  captureScreen: async () => (window.hexa?.captureScreen ? window.hexa.captureScreen() : null),
  getScreenSourceId: async () =>
    window.hexa?.getScreenSourceId ? window.hexa.getScreenSourceId() : null,
  setShortcuts: async (map) =>
    window.hexa?.setShortcuts ? window.hexa.setShortcuts(map) : Promise.resolve(null),
}
