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
  /** « Réglages… » choisi dans le menu de l'icône près de l'horloge */
  'open-settings': () => void
  /**
   * Action déclenchée par un raccourci GLOBAL (Ctrl+Maj+3, Ctrl+E…) alors que
   * le jeu avait le focus. La charge utile est un identifiant d'action de
   * src/keymap.ts — typée `string` ici pour ne pas coupler le pont à la table.
   */
  action: (action: string) => void
  /**
   * L'écran porteur a changé de taille, d'échelle (100 % → 125 %) ou de
   * rotation. Il faut recalibrer les canvas : leur fond de rendu est en pixels
   * PHYSIQUES et un changement d'échelle ne produit pas toujours d'événement
   * `resize` côté page (§12.3).
   */
  'display-changed': (info: HexaDisplayInfo) => void
  /**
   * « Replacer la barre d'outils » demandé depuis l'icône près de l'horloge
   * (§S4.3) : dernier recours quand la barre a fini hors champ.
   */
  'toolbar-reset': () => void
}

export type BridgeChannel = keyof BridgeEvents

/** Infos de l'écran porteur : bounds logiques + facteur DPI (§12.3). */
export interface HexaDisplayInfo {
  id: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  primary: boolean
  /**
   * Cette fenêtre porte-t-elle la BARRE D'OUTILS (§S4.2) ?
   *
   * Il y a une fenêtre par écran et chacune monte l'interface complète : sans
   * ce drapeau, la barre s'afficherait sur TOUS les écrans, donc par-dessus ce
   * que les spectateurs regardent. Le processus principal en désigne un seul
   * (le plus à droite, sinon l'écran principal) et redit son choix par
   * 'display-changed' quand la topologie bouge.
   * Absent = démo navigateur : la barre s'affiche, évidemment.
   */
  toolbarHost?: boolean
}

/**
 * Raccourcis GLOBAUX à réserver auprès du système : identifiant d'action
 * (src/keymap.ts) → accélérateur Electron.
 * Ex. { 'mode.draw': 'F8', 'tool.pen': 'Control+Shift+3' }
 */
export type GlobalShortcuts = Record<string, string>

export interface HexaBridgeApi {
  /** écran porteur au moment de la création de la fenêtre (null en démo) */
  display: HexaDisplayInfo | null
  /** écran porteur relu à l'instant : seule valeur fiable après un changement
   *  de résolution ou de mise à l'échelle Windows */
  displayInfo(): Promise<HexaDisplayInfo | null>
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
  /** (ré)enregistre les raccourcis globaux ; renvoie ce qui a été pris ou refusé */
  setShortcuts(map: GlobalShortcuts): Promise<unknown>
  /** écrit une ligne dans le journal de diagnostic (hexa.log) */
  log(scope: string, message: string): void
  /** emplacement du journal, à montrer à l'utilisateur ('' en démo navigateur) */
  logPath(): Promise<string>
}

declare global {
  interface Window {
    hexa?: Partial<HexaBridgeApi>
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.hexa

export const bridge: HexaBridgeApi = {
  display: (typeof window !== 'undefined' && window.hexa?.display) || null,
  displayInfo: async () => (window.hexa?.displayInfo ? window.hexa.displayInfo() : null),
  setPassthrough: (v) => window.hexa?.setPassthrough?.(v),
  notifyActivity: (active) => window.hexa?.notifyActivity?.(active),
  on: (channel, cb) => window.hexa?.on?.(channel, cb) ?? (() => undefined),
  captureScreen: async () => (window.hexa?.captureScreen ? window.hexa.captureScreen() : null),
  getScreenSourceId: async () =>
    window.hexa?.getScreenSourceId ? window.hexa.getScreenSourceId() : null,
  setShortcuts: async (map) =>
    window.hexa?.setShortcuts ? window.hexa.setShortcuts(map) : Promise.resolve(null),
  log: (scope, message) => window.hexa?.log?.(scope, message),
  logPath: async () => (window.hexa?.logPath ? window.hexa.logPath() : ''),
}

/**
 * Une erreur de la page finit dans hexa.log, aux côtés des journaux du processus
 * principal. C'est ce qui permet de comprendre « ça ne marche pas » chez un
 * utilisateur qui n'ouvrira jamais une console de développement.
 * Aucun coût au repos : deux écouteurs passifs, rien de plus.
 */
if (isElectron && typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    bridge.log('page', `erreur : ${e.message} (${e.filename}:${e.lineno})`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    bridge.log('page', `promesse rejetée : ${String(e.reason)}`)
  })
}
