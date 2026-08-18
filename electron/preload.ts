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
const INBOUND = [
  'toggle-draw',
  'panic-clear',
  'set-draw',
  'spike-cursor',
  /** nombre de vues OBS connectées au serveur local (§10.2) */
  'obs-clients',
  /** une source navigateur vient d'ouvrir : elle réclame l'état complet */
  'obs-full-request',
  /**
   * Un message du miroir a été REFUSÉ par le relais (trop gros). Sans ce
   * retour, l'émetteur croyait la scène partie et la source navigateur restait
   * vide jusqu'à la fin de la session.
   */
  'obs-refus',
  /** état du serveur local (port réellement écouté, erreur éventuelle) */
  'obs-status',
  /** « Réglages… » demandé depuis l'icône de la barre des tâches */
  'open-settings',
  /** action déclenchée par un raccourci GLOBAL, alors que le jeu avait le focus */
  'action',
  /**
   * L'écran porteur a changé de taille, d'échelle (100 % → 125 %) ou de
   * rotation. La page doit recalibrer ses canvas : sans ça, le trait tombe à
   * côté du curseur (§12.3).
   */
  'display-changed',
  /**
   * « Replacer la barre d'outils » (menu de l'icône système, §S4.3) : la page
   * remet la barre à son ancrage par défaut. Filet de sécurité pour le jour où
   * elle a fini hors champ — écran débranché, résolution changée.
   */
  'toolbar-reset',
  /**
   * §S11 — séparation en deux fenêtres (encre capturée / interface exclue des
   * captures). Ces trois canaux sont la colonne vertébrale de la liaison :
   *  - 'sync'       : patch d'état d'interface venu de l'autre fenêtre ;
   *  - 'commande'   : ordre de la barre d'outils au moteur ;
   *  - 'etat-encre' : état du moteur que l'interface doit refléter.
   */
  'sync',
  'commande',
  'etat-encre',
] as const
type Inbound = (typeof INBOUND)[number]

/** Informations de l'écran porteur, injectées à la création de la fenêtre. */
interface DisplayInfo {
  id: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  primary: boolean
  /**
   * Cette fenêtre est-elle celle qui affiche la BARRE D'OUTILS (§S4.2) ?
   *
   * Il y a une fenêtre par écran et chacune monte l'interface complète : sans
   * ce drapeau, la barre s'afficherait sur tous les écrans à la fois. Le
   * processus principal en désigne un seul (l'écran le plus à droite, sinon
   * l'écran principal) et le redit par 'display-changed' si la topologie bouge.
   */
  toolbarHost?: boolean
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

/**
 * §S11 — quelle COUCHE cette fenêtre porte-t-elle ?
 *  'encre'     : les canvas d'annotation (fenêtre capturée par OBS) ;
 *  'interface' : barre, panneaux, curseur (fenêtre exclue des captures) ;
 *  'complet'   : les deux dans la même fenêtre (mode fusionné, HEXA_FUSION=1).
 * Le processus principal le déclare : c'est plus sûr que de le deviner depuis
 * l'adresse de la page.
 */
function readCouche(): string | null {
  try {
    const arg = process.argv.find((a) => a.startsWith('--hexa-couche='))
    return arg ? arg.slice('--hexa-couche='.length) : null
  } catch {
    return null
  }
}

const api = {
  /** Vraie valeur : permet au renderer de savoir qu'il tourne en overlay. */
  isOverlay: true,

  /** Couche portée par cette fenêtre : 'encre', 'interface' ou 'complet'. */
  couche: readCouche(),

  /**
   * Écran porteur (pixels logiques + facteur d'échelle DPI, §12.3).
   * INSTANTANÉ pris à la création de la fenêtre : après un changement de
   * résolution ou d'échelle il est périmé — utiliser `displayInfo()`.
   */
  display: displayInfo,

  /** Écran porteur, relu à l'instant auprès du processus principal. */
  displayInfo(): Promise<DisplayInfo | null> {
    return ipcRenderer.invoke('hexa:display-info').catch(() => null)
  },

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

  /**
   * Reconfigure les raccourcis GLOBAUX. Table { action: accélérateur }, ex.
   * { 'mode.draw': 'F8', 'tool.pen': 'Control+Shift+3' }. Renvoie la liste de
   * ce qui a été pris et de ce que Windows a refusé.
   */
  setShortcuts(map: Record<string, string>): Promise<unknown> {
    return ipcRenderer.invoke('hexa:set-shortcuts', map).catch(() => null)
  },

  /**
   * Démarre/arrête le serveur local de la vue OBS (§10.2).
   * Écoute TOUJOURS sur 127.0.0.1 côté processus principal.
   */
  obsServer(cfg: { enabled: boolean; port: number }): Promise<unknown> {
    return ipcRenderer.invoke('hexa:obs-server', cfg).catch(() => null)
  },

  /** État du serveur de la vue OBS : port réellement écouté, vues, erreur. */
  obsStatus(): Promise<unknown> {
    return ipcRenderer.invoke('hexa:obs-status').catch(() => null)
  },

  /**
   * Niveau de privilège d'Hexa (Windows). C'est ce qui décide si un raccourci
   * global est livré PENDANT une partie : un jeu lancé en administrateur retient
   * les touches d'un programme ordinaire. Voir electron/elevation.ts.
   */
  privileges(): Promise<unknown> {
    return ipcRenderer.invoke('hexa:privileges').catch(() => null)
  },

  /** Relance Hexa en administrateur (demande de consentement de Windows). */
  relancerAdmin(): Promise<unknown> {
    return ipcRenderer.invoke('hexa:relaunch-admin').catch(() => null)
  },

  /**
   * Écrit une ligne dans le journal de diagnostic (hexa.log). Sert quand la page
   * rencontre un problème que seul l'utilisateur pourra nous rapporter.
   */
  log(scope: string, message: string): void {
    try {
      if (typeof message === 'string') ipcRenderer.send('hexa:log', String(scope), message)
    } catch {
      /* ignore */
    }
  },

  /** Emplacement du journal, à afficher dans les réglages (« Où est le journal ? »). */
  logPath(): Promise<string> {
    return ipcRenderer.invoke('hexa:log-path').catch(() => '')
  },

  /**
   * Dessine-t-on en ce moment sur CET écran ? À demander au démarrage d'une
   * couche : le mode n'est annoncé qu'à ses changements, si bien qu'une fenêtre
   * relancée après une panne repartait en croyant qu'on dessinait — alors que
   * l'utilisateur jouait.
   */
  modeDessin(): Promise<boolean | null> {
    return ipcRenderer.invoke('hexa:mode-dessin').catch(() => null)
  },

  /* ---- §S11 : les deux couches se parlent ---------------------------- *
   * Le processus principal sert de concentrateur : il relaie aux AUTRES
   * fenêtres, jamais à l'émetteur — c'est ce qui interdit la boucle infinie
   * entre deux stores qui se répondent.                                    */

  /** Diffuse un patch d'état d'interface à l'autre couche. */
  pousserSynchro(patch: Record<string, unknown>): void {
    try {
      if (patch && typeof patch === 'object') ipcRenderer.send('hexa:sync', patch)
    } catch {
      /* un patch perdu se rattrape au patch suivant : jamais d'exception ici */
    }
  },

  /** La couche interface commande le moteur (annuler, effacer, geler…). */
  envoyerCommande(commande: unknown): void {
    try {
      ipcRenderer.send('hexa:commande', commande)
    } catch {
      /* ignore */
    }
  },

  /** La couche encre annonce un état à l'interface (gel, roue, session). */
  annoncerEtatEncre(message: unknown): void {
    try {
      ipcRenderer.send('hexa:etat-encre', message)
    } catch {
      /* ignore */
    }
  },

  /**
   * Fenêtre d'interface cliquable (le pointeur survole un bouton) ou
   * traversante (les clics repartent au jeu). Voir src/ui/interactivite.ts.
   */
  setInterfaceCliquable(value: boolean): void {
    try {
      ipcRenderer.send('hexa:interface-cliquable', value === true)
    } catch {
      /* ignore */
    }
  },

  /** Un panneau est ouvert : la fenêtre interface accepte la frappe clavier. */
  setInterfaceModale(value: boolean): void {
    try {
      ipcRenderer.send('hexa:interface-modale', value === true)
    } catch {
      /* ignore */
    }
  },

  /**
   * Taille voulue pour la FENÊTRE d'interface (§S12) : le rectangle de la barre
   * d'outils quand elle est seule à l'écran, `null` pour reprendre l'écran
   * entier. Coordonnées en pixels LOGIQUES, relatives à l'écran de la fenêtre.
   *
   * C'est la parade au vrai coût d'Hexa : un calque transparent plein écran que
   * le compositeur empile à chaque image par-dessus le jeu, pour n'afficher
   * qu'une barre de 117 × 671.
   */
  setInterfaceRect(rect: { x: number; y: number; width: number; height: number } | null): void {
    try {
      ipcRenderer.send('hexa:interface-rect', rect ?? null)
    } catch {
      /* ignore */
    }
  },

  /**
   * Masquer l'interface de Hexa dans les captures (OBS, Discord, impressions
   * d'écran). Renvoie ce qui a été RÉELLEMENT appliqué : la page doit pouvoir
   * dire la vérité à l'utilisateur, jamais promettre une protection absente.
   */
  setProtectionCapture(on: boolean): Promise<unknown> {
    return ipcRenderer.invoke('hexa:protection-capture', on === true).catch(() => null)
  },

  /** Diffuse un message du miroir OBS (déjà sérialisé) aux vues connectées. */
  obsPublish(payload: string): void {
    try {
      if (typeof payload === 'string') ipcRenderer.send('hexa:obs-publish', payload)
    } catch {
      /* un miroir qui tombe ne doit jamais gêner le dessin */
    }
  },
}

try {
  contextBridge.exposeInMainWorld('hexa', api)
} catch {
  /* si le contexte est déjà figé, on ne casse rien */
}
