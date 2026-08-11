/**
 * Pont renderer ↔ processus principal Electron.
 * En démo navigateur, toutes les fonctions sont des no-op : l'app reste testable partout.
 * Le preload Electron expose `window.hexa` (voir electron/preload.ts).
 */
export interface HexaBridgeApi {
  /** active/désactive le clic traversant (setIgnoreMouseEvents + forward) */
  setPassthrough(v: boolean): void
  /** signale au main process si la couche contient quelque chose d'actif —
   *  règle §2.5 du brief : fenêtre cachée quand vide = zéro coût compositeur */
  notifyActivity(active: boolean): void
  /** s'abonner aux raccourcis globaux relayés par le main process */
  on(channel: 'toggle-draw' | 'panic-clear', cb: () => void): void
  /** capture d'écran de l'affichage courant (loupe, gel d'image, flou) */
  captureScreen(): Promise<string | null>
}

declare global {
  interface Window {
    hexa?: Partial<HexaBridgeApi>
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.hexa

export const bridge: HexaBridgeApi = {
  setPassthrough: (v) => window.hexa?.setPassthrough?.(v),
  notifyActivity: (active) => window.hexa?.notifyActivity?.(active),
  on: (channel, cb) => window.hexa?.on?.(channel, cb),
  captureScreen: async () => (window.hexa?.captureScreen ? window.hexa.captureScreen() : null),
}
