/**
 * Hexa — icône dans la barre des tâches (zone de notification, près de l'horloge).
 *
 * C'est LA pièce qui rend Hexa utilisable par un humain. L'application n'a
 * aucune fenêtre visible : sans cette icône, l'utilisateur ne sait pas qu'elle
 * tourne, ne peut pas la piloter, ne peut même pas la quitter — autrement dit,
 * elle n'existe pas pour lui.
 *
 * Tout est en français, tout est cliquable, rien n'exige de connaître un
 * raccourci clavier.
 */
import {
  app,
  dialog,
  Menu,
  nativeImage,
  shell,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron'
import path from 'node:path'
import { log, logError, logFilePath } from './logger'

/** Ce que le menu sait faire — fourni par le processus principal. */
export interface TrayActions {
  /** bascule le mode dessin (strictement identique au raccourci global) */
  toggleDraw: () => void
  /** efface toutes les annotations, sur tous les écrans */
  clearAll: () => void
  /** ouvre le panneau de réglages dans l'overlay */
  openSettings: () => void
  /**
   * Remet la barre d'outils à son ancrage par défaut (§S4.3).
   *
   * Filet de sécurité indispensable : si la barre a fini hors champ — écran
   * débranché, résolution divisée par deux — plus AUCUN clic ne peut la
   * rattraper. L'icône près de l'horloge, elle, reste toujours atteignable.
   */
  resetToolbar: () => void
  /** met l'overlay en veille complète (aucune fenêtre) ou le réveille */
  toggleSuspended: () => void
  /** vrai si le mode dessin est actif sur au moins un écran */
  isDrawing: () => boolean
  /** vrai si l'utilisateur a demandé la mise en veille */
  isSuspended: () => boolean
  /** accélérateur courant du mode dessin, affiché dans le menu (« F8 ») */
  drawShortcut: () => string
  /** accélérateur courant du « tout effacer », affiché dans « À propos » */
  clearShortcut: () => string
  /** ferme proprement toute l'application */
  quit: () => void
}

/**
 * Icône de secours, embarquée en dur (PNG 32 px encodé en base64).
 *
 * Indispensable : `build/icon.png` ne fait PAS partie des fichiers empaquetés
 * par electron-builder. Dans l'installateur Windows, le fichier n'existe donc
 * pas sur le disque — sans cette copie de secours, l'utilisateur verrait un
 * carré vide près de l'horloge, ce qui est presque pire que rien.
 */
const ICON_32_BASE64 =
  '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'

let tray: Tray | null = null
let actions: TrayActions | null = null
/** Nombre d'entrées du dernier menu construit — journalisé au démarrage. */
let dernierNombreEntrees = 0

/**
 * Icône de la barre des tâches, à la bonne taille.
 *
 * On part du PNG 1024 px du dépôt quand il est là (exécution depuis les
 * sources) et on redimensionne : Windows affiche 16 px en 100 % et 32 px en
 * 200 %, et un redimensionnement fait par Windows à partir d'un 1024 px rend
 * une bouillie. `nativeImage.resize` donne un résultat net.
 */
function buildIcon(): NativeImage {
  try {
    const disque = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'))
    if (!disque.isEmpty()) {
      const image = disque.resize({ width: 32, height: 32, quality: 'best' })
      image.addRepresentation({
        scaleFactor: 0.5,
        buffer: disque.resize({ width: 16, height: 16, quality: 'best' }).toPNG(),
      })
      return image
    }
  } catch (err) {
    logError('icône', 'lecture de build/icon.png impossible', err)
  }
  // Application empaquetée : on retombe sur la copie embarquée.
  try {
    return nativeImage.createFromDataURL(`data:image/png;base64,${ICON_32_BASE64}`)
  } catch (err) {
    logError('icône', 'icône de secours illisible', err)
    return nativeImage.createEmpty()
  }
}

let iconeCache: NativeImage | null = null

/** Icône construite une seule fois : elle ne change jamais de la session. */
function icone(): NativeImage {
  if (!iconeCache) iconeCache = buildIcon()
  return iconeCache
}

/** Phrase d'état, réutilisée par l'info-bulle et par l'en-tête du menu. */
function etat(): string {
  if (!actions) return 'Hexa'
  if (actions.isSuspended()) return 'en veille — clique pour réveiller'
  return actions.isDrawing()
    ? 'mode dessin ACTIF — tu dessines sur ton écran'
    : `en attente — ${actions.drawShortcut()} pour dessiner`
}

/** Le démarrage automatique n'existe que sur Windows et macOS. */
function demarrageAutoDisponible(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

function demarrageAutoActif(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin === true
  } catch {
    return false
  }
}

function basculerDemarrageAuto(valeur: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: valeur,
      // `--hexa-demarrage` permet plus tard de démarrer encore plus discrètement.
      args: ['--hexa-demarrage'],
    })
    log('démarrage-auto', valeur ? 'activé' : 'désactivé')
  } catch (err) {
    logError('démarrage-auto', 'réglage impossible', err)
  }
  refreshTray()
}

function aPropos(): void {
  const journal = logFilePath() || '(journal indisponible)'
  const message =
    `Hexa ${app.getVersion()} — annotation d'écran pour le direct.\n\n` +
    `${actions?.drawShortcut() ?? 'F8'} : entrer ou sortir du mode dessin.\n` +
    `${actions?.clearShortcut() ?? '—'} : tout effacer instantanément.\n` +
    `Clic droit maintenu : le menu radial sous le curseur.\n\n` +
    `Hexa fonctionne entièrement hors ligne : aucune donnée ne quitte cet ordinateur.\n\n` +
    `Journal de diagnostic :\n${journal}`
  try {
    const choix = dialog.showMessageBoxSync({
      type: 'info',
      title: 'À propos de Hexa',
      message: 'Hexa',
      detail: message,
      buttons: ['Fermer', 'Ouvrir le dossier du journal'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (choix === 1 && logFilePath()) shell.showItemInFolder(logFilePath())
  } catch (err) {
    logError('à-propos', 'boîte de dialogue impossible', err)
  }
}

function buildMenu(): Menu {
  const a = actions
  const dessine = a?.isDrawing() === true
  const veille = a?.isSuspended() === true

  const items: MenuItemConstructorOptions[] = [
    // En-tête non cliquable : l'état est lisible sans survoler l'icône.
    { label: `Hexa — ${etat()}`, enabled: false },
    { type: 'separator' },
    {
      label: `Mode dessin (${a?.drawShortcut() ?? 'F8'})`,
      type: 'checkbox',
      checked: dessine,
      click: () => a?.toggleDraw(),
    },
    { label: 'Tout effacer', click: () => a?.clearAll() },
    { type: 'separator' },
    { label: 'Réglages…', click: () => a?.openSettings() },
    { label: 'Replacer la barre d’outils', click: () => a?.resetToolbar() },
    {
      label: veille ? 'Afficher Hexa' : 'Masquer Hexa (mise en veille)',
      click: () => a?.toggleSuspended(),
    },
  ]

  if (demarrageAutoDisponible()) {
    items.push({
      label: 'Lancer au démarrage de Windows',
      type: 'checkbox',
      checked: demarrageAutoActif(),
      click: (item) => basculerDemarrageAuto(item.checked),
    })
  }

  items.push(
    { type: 'separator' },
    { label: 'À propos de Hexa', click: () => aPropos() },
    { label: 'Quitter', click: () => a?.quit() },
  )

  dernierNombreEntrees = items.filter((i) => i.type !== 'separator').length
  return Menu.buildFromTemplate(items)
}

/**
 * Installe l'icône. Renvoie false si le système la refuse (certains bureaux
 * Linux sans zone de notification) — l'application continue de tourner.
 */
export function createHexaTray(next: TrayActions): boolean {
  actions = next
  if (tray) {
    refreshTray()
    return true
  }
  try {
    const image = icone()
    tray = new Tray(image)
    tray.setIgnoreDoubleClickEvents(true)
    // Clic gauche = le geste le plus court possible pour dessiner.
    tray.on('click', () => {
      if (actions?.isSuspended()) actions.toggleSuspended()
      else actions?.toggleDraw()
    })
    // Windows n'ouvre pas toujours le menu au clic droit sans coup de pouce.
    tray.on('right-click', () => {
      try {
        tray?.popUpContextMenu()
      } catch {
        /* ignore */
      }
    })
    refreshTray()
    const taille = image.getSize()
    log('barre-des-tâches', 'icône installée près de l’horloge', {
      icone: `${taille.width}×${taille.height}`,
      entrees: dernierNombreEntrees,
    })
    return true
  } catch (err) {
    tray = null
    logError('barre-des-tâches', 'icône impossible à installer', err)
    return false
  }
}

/** Reconstruit menu et info-bulle : à appeler après chaque changement d'état. */
export function refreshTray(): void {
  if (!tray) return
  try {
    tray.setToolTip(`Hexa · ${etat()}`)
    tray.setContextMenu(buildMenu())
  } catch (err) {
    logError('barre-des-tâches', 'rafraîchissement du menu impossible', err)
  }
}

/**
 * Signale visuellement que Hexa tourne DÉJÀ (deuxième lancement). Sur Windows,
 * une bulle près de l'horloge ; ailleurs, le journal suffit.
 */
export function notifyAlreadyRunning(): void {
  if (!tray) return
  try {
    if (process.platform === 'win32') {
      tray.displayBalloon({
        title: 'Hexa tourne déjà',
        content: `Inutile de relancer : ${actions?.drawShortcut() ?? 'F8'} pour dessiner, ou clique cette icône.`,
        icon: icone(),
      })
    }
  } catch (err) {
    logError('barre-des-tâches', 'bulle d’information impossible', err)
  }
}

/** Libère l'icône. Sans ça, Windows garde un fantôme près de l'horloge. */
export function destroyTray(): void {
  try {
    tray?.destroy()
  } catch {
    /* ignore */
  }
  tray = null
  actions = null
  iconeCache = null
}
