/**
 * Hexa — preload.
 *
 * Seule passerelle entre le renderer (sandboxé, contextIsolation:true,
 * nodeIntegration:false) et le processus principal. On expose une API minuscule
 * et strictement typée sur `window.hexa` — aucune primitive Node ne fuit.
 *
 * Toute la surface est en liste blanche : un canal inconnu est ignoré, jamais
 * transmis.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/** Canaux que le processus principal peut pousser vers la page. */
const INBOUND = ['toggle-draw', 'panic-clear', 'set-draw', 'spike-cursor'] as const
type Inbound = (typeof INBOUND)[number]

/** Informations de l'écran porteur, injectées à la création de la fenêtre. */
interface DisplayInfo {
  id: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  primary: boolean
}

function readDisplayInfo(): DisplayInfo | null {
  try {
    const arg = process.argv.find((a) => a.startsWith('--hexa-display='))
    if (!arg) return null
    return JSON.parse(decodeURIComponent(arg.slice('--hexa-display='.length))) as DisplayInfo
  } catch {
    return null
  }
}

const displayInfo = readDisplayInfo()

const api = {
  /** Vraie valeur : permet au renderer de savoir qu'il tourne en overlay. */
  isOverlay: true,

  /** Écran porteur (pixels logiques + facteur d'échelle DPI, §12.3). */
  display: displayInfo,

  /** Clic traversant on/off (§2.2). */
  setPassthrough(value: boolean): void {
    try {
      ipcRenderer.send('hexa:set-passthrough', value === true)
    } catch {
      /* ignore */
    }
  },

  /**
   * Signale si la couche contient quelque chose de vivant. C'est CE signal qui
   * permet au processus principal de cacher la fenêtre quand elle est vide
   * (§2.5) — la règle de performance numéro un du projet.
   */
  notifyActivity(active: boolean): void {
    try {
      ipcRenderer.send('hexa:activity', active === true)
    } catch {
      /* ignore */
    }
  },

  /** Abonnement à un canal en liste blanche. Renvoie la fonction de désabonnement. */
  on(channel: Inbound, callback: (...args: unknown[]) => void): () => void {
    if (!INBOUND.includes(channel)) return () => undefined
    const handler = (_e: IpcRendererEvent, ...args: unknown[]) => {
      try {
        callback(...args)
      } catch {
        /* un abonné qui casse ne doit pas casser l'overlay */
      }
    }
    ipcRenderer.on(`hexa:${channel}`, handler)
    return () => {
      try {
        ipcRenderer.off(`hexa:${channel}`, handler)
      } catch {
        /* ignore */
      }
    }
  },

  /** Capture de l'écran courant en dataURL, ou null si refusée (§12.6). */
  captureScreen(): Promise<string | null> {
    return ipcRenderer.invoke('hexa:capture-screen').catch(() => null)
  },

  /** Identifiant de source pour getUserMedia (flux continu de la loupe, §6.1). */
  getScreenSourceId(): Promise<string | null> {
    return ipcRenderer.invoke('hexa:get-screen-source-id').catch(() => null)
  },

  /** Reconfigure les raccourcis GLOBAUX (mode dessin, panique). */
  setShortcuts(map: { toggleDraw: string; panic: string }): Promise<unknown> {
    return ipcRenderer.invoke('hexa:set-shortcuts', map).catch(() => null)
  },
}

try {
  contextBridge.exposeInMainWorld('hexa', api)
} catch {
  /* si le contexte est déjà figé, on ne casse rien */
}
