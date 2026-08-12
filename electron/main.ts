/**
 * Hexa — processus principal Electron.
 *
 * Rôle : fabriquer UNE fenêtre overlay par écran physique, transparente, toujours
 * au-dessus, en clic traversant, qui ne vole jamais le focus et qui DISPARAÎT
 * complètement quand elle n'a rien à afficher (§2.5 du brief : c'est la règle de
 * performance la plus importante du projet).
 *
 * Tout le fichier est défensif : un overlay ne doit JAMAIS faire tomber l'app du
 * joueur. Chaque appel système sensible est enveloppé dans un try/catch.
 */
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  type Display,
  type WebContents,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
// Serveur local de la vue OBS (§10.2) : HTTP + WebSocket sur 127.0.0.1.
import { broadcastObs, obsServerStatus, startObsServer, stopObsServer } from './obs-server'
// Table de raccourcis partagée avec le renderer : UNE seule source de vérité
// pour les combinaisons d'usine (preset Epic Pen).
import { defaultGlobalAccelerators } from '../src/keymap'
// Diagnostic de démarrage : sans fenêtre visible, le journal est le SEUL moyen
// de comprendre pourquoi « ça ne se lance pas ».
import {
  fatalDialog,
  initLogger,
  installCrashHandlers,
  log,
  logError,
  logFailure,
  logFilePath,
  markStarted,
} from './logger'
// Icône près de l'horloge : la seule prise que l'utilisateur ait sur Hexa.
import { createHexaTray, destroyTray, notifyAlreadyRunning, refreshTray } from './tray'
// Bandeau d'accueil natif : la preuve visuelle que Hexa tourne.
import { closeToast, showToast } from './welcome'
// Garde-fou Windows (§S9) : écrans branchés à chaud, DPI, veille, plein écran
// exclusif, niveau « toujours au-dessus », libération des écouteurs.
import {
  applyBounds,
  probeExclusiveFullscreen,
  reassertTopmost,
  sameBounds,
  stopWindowsGuard,
  watchDisplays,
  watchPower,
  watchSessionEnd,
} from './windows-guard'

/* ------------------------------------------------------------------ *
 * Réglages moteur Chromium
 * ------------------------------------------------------------------ */

// §12.5 : on NE désactive JAMAIS l'accélération matérielle. Sans GPU, l'overlay
// devient inutilisable dès qu'un jeu tourne. (Aucun appel à
// app.disableHardwareAcceleration() ici, et il ne doit jamais y en avoir.)

// Windows calcule l'« occlusion native » des fenêtres et met en veille celles
// qu'il croit cachées : sur une fenêtre transparente plein écran posée sur un
// jeu, ça provoque des gels de rendu aléatoires. On désactive ce calcul.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
// Empêche Chromium de brider le renderer quand la fenêtre n'a pas le focus —
// or notre overlay n'a JAMAIS le focus (§12.2).
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

/* ------------------------------------------------------------------ *
 * Types internes
 * ------------------------------------------------------------------ */

interface Overlay {
  win: BrowserWindow
  displayId: number
  /** la couche contient-elle quelque chose de vivant (trait, laser, effet) ? */
  hasContent: boolean
  /** true = clics traversants (mode jeu) ; false = mode dessin */
  passthrough: boolean
  /** horodatage de la dernière entrée en mode dessin (anti blur parasite) */
  drawEnteredAt: number
  /** minuterie de grâce avant win.hide() */
  hideTimer: NodeJS.Timeout | null
  /**
   * Dernier facteur d'échelle connu de l'écran porteur. Il sert à repérer un
   * passage de 100 % à 125 % : les bounds LOGIQUES changent alors elles aussi,
   * mais c'est le renderer qu'il faut prévenir — ses canvas sont dimensionnés
   * en pixels physiques (§12.3), et un `resize` DOM n'est pas garanti.
   */
  scaleFactor: number
  /** dernières bounds RÉCLAMÉES au système pour cette fenêtre */
  wantedBounds: { x: number; y: number; width: number; height: number } | null
  /**
   * Le système a refusé ces bounds-là (gestionnaire de fenêtres qui rogne d'un
   * pixel, pilote graphique capricieux). On ne réessaie plus tant que la cible
   * n'a pas changé : sans ce drapeau, chaque événement d'écran relancerait la
   * même bataille perdue d'avance, avec le clignotement que ça implique.
   */
  boundsRefusees: boolean
}

/**
 * Raccourcis GLOBAUX : action Hexa → accélérateur Electron.
 * Ex. { 'mode.draw': 'F8', 'tool.pen': 'Control+Shift+3', 'edit.clear': 'Control+E' }
 * La table est calculée par le renderer depuis src/keymap.ts et poussée ici.
 */
type ShortcutMap = Record<string, string>

/* ------------------------------------------------------------------ *
 * État global
 * ------------------------------------------------------------------ */

const overlays = new Map<number, Overlay>()

/**
 * Délai de grâce avant de cacher une fenêtre vide. Assez court pour que le
 * compositeur reprenne son souffle, assez long pour ne pas clignoter entre deux
 * traits rapides.
 */
const HIDE_GRACE_MS = 300

/**
 * Combinaisons d'usine = preset « Epic Pen », lues dans la table partagée
 * (src/keymap.ts). Elles sont enregistrées AVANT même que la page ne soit
 * chargée : Ctrl+Maj+3 doit sortir le stylo dès la première seconde.
 * §12.4 : F1–F5 sont les sorts alliés dans League of Legends → jamais utilisées.
 */
const DEFAULT_SHORTCUTS: ShortcutMap = defaultGlobalAccelerators()

/** Repli absolu : sans mode dessin, l'application est inutilisable. */
const FALLBACK_DRAW = 'F8'

let shortcuts: ShortcutMap = { ...DEFAULT_SHORTCUTS }

const isSpike = process.env.HEXA_SPIKE === '1'
const devServerUrl = process.env.VITE_DEV_SERVER_URL

/**
 * Mise en veille demandée depuis l'icône (« Masquer Hexa ») : plus AUCUNE
 * fenêtre n'est composée, quoi qu'il arrive côté renderer.
 */
let suspended = false

/** Fermeture en cours : on ne recrée plus rien, on ne réaffiche plus rien. */
let quitting = false

/** L'icône de la barre des tâches a-t-elle pu s'installer ? */
let trayReady = false

/**
 * Écran dont les annotations partent vers la vue OBS (§10.2). Sur plusieurs
 * écrans, un seul parle à la fois : celui où l'on dessine. `null` = personne
 * n'a encore publié.
 */
let obsSender: number | null = null

/** Minuterie unique du retour au mode traversant après l'accueil (jamais un intervalle). */
let welcomeTimer: NodeJS.Timeout | null = null

/**
 * Éclipse système (veille, verrouillage, changement d'utilisateur) : toutes les
 * fenêtres sont rentrées et RIEN ne les ramène tant que la session n'est pas
 * revenue. Distinct de `suspended`, qui est un choix de l'utilisateur.
 */
let eclipsed = false

/** Durée pendant laquelle l'overlay reste visible au lancement (§ accueil). */
const WELCOME_MS = 4200
/** Tout premier lancement : la découverte guidée s'affiche, on laisse le temps de lire. */
const WELCOME_FIRST_RUN_MS = 12000

/* ------------------------------------------------------------------ *
 * Utilitaires
 * ------------------------------------------------------------------ */

function overlayFor(win: BrowserWindow | null): Overlay | undefined {
  if (!win) return undefined
  for (const o of overlays.values()) if (o.win === win) return o
  return undefined
}

/** Fonctionne pour ipcMain.on comme pour ipcMain.handle (même forme d'événement). */
function overlayFromEvent(e: { sender: WebContents }): Overlay | undefined {
  return overlayFor(BrowserWindow.fromWebContents(e.sender))
}

/** Overlay de l'écran qui contient actuellement le curseur (§8.8). */
function overlayUnderCursor(): Overlay | undefined {
  try {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    return overlays.get(display.id)
  } catch {
    return overlays.values().next().value
  }
}

function send(o: Overlay, channel: string, ...args: unknown[]): void {
  try {
    if (!o.win.isDestroyed()) o.win.webContents.send(`hexa:${channel}`, ...args)
  } catch {
    /* fenêtre en cours de destruction : rien à faire */
  }
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const o of overlays.values()) send(o, channel, ...args)
}

/* ------------------------------------------------------------------ *
 * Visibilité : LA règle de perf (§2.5)
 * ------------------------------------------------------------------ */

/**
 * Une fenêtre transparente plein écran force le compositeur de Windows (DWM) à
 * composer une couche supplémentaire À CHAQUE IMAGE, même totalement vide, même
 * avec 0 % de CPU côté renderer. C'est ce qui coûte des images par seconde au
 * jeu — et c'est exactement le défaut d'Epic Pen.
 *
 * La seule parade fiable : `win.hide()`. Une fenêtre cachée n'est plus composée
 * du tout, le coût retombe à zéro absolu. On la ré-affiche avec `showInactive()`
 * (jamais `show()` : ça volerait le focus, §12.2) dès qu'il y a du contenu ou
 * qu'on entre en mode dessin.
 */
function refreshVisibility(o: Overlay): void {
  // Éclipse système (veille, session verrouillée) : une fenêtre transparente
  // qui reste composée pendant que Windows bascule de bureau revient souvent
  // avec une surface Direct3D invalide — le grand rectangle noir au réveil.
  if (eclipsed) {
    if (o.hideTimer) {
      clearTimeout(o.hideTimer)
      o.hideTimer = null
    }
    return
  }
  // Veille demandée depuis l'icône : on ne montre plus rien, sans discuter.
  const shouldShow = !suspended && (o.hasContent || !o.passthrough)
  if (shouldShow) {
    if (o.hideTimer) {
      clearTimeout(o.hideTimer)
      o.hideTimer = null
    }
    showOverlay(o)
    return
  }
  if (o.hideTimer) return
  o.hideTimer = setTimeout(() => {
    o.hideTimer = null
    // Re-vérification : l'état a pu changer pendant le délai de grâce.
    if (!suspended && (o.hasContent || !o.passthrough)) return
    try {
      if (!o.win.isDestroyed() && o.win.isVisible()) o.win.hide()
    } catch {
      /* ignore */
    }
  }, HIDE_GRACE_MS)
}

function showOverlay(o: Overlay): void {
  try {
    if (o.win.isDestroyed() || eclipsed) return
    if (!o.win.isVisible()) o.win.showInactive()
    // Certains overlays de jeu (Discord, GeForce Experience) et les infobulles
    // de Windows se réinsèrent au-dessus de nous en cours de session : entre
    // deux fenêtres « topmost », c'est la DERNIÈRE qui l'a demandé qui gagne.
    // On réaffirme donc le niveau à chaque réapparition (détail dans
    // windows-guard.ts, reassertTopmost).
    reassertTopmost(o.win)
  } catch (err) {
    // Si l'overlay refuse de s'afficher, l'utilisateur ne verra JAMAIS Hexa :
    // c'est exactement le genre de panne qui doit finir dans le journal.
    logError('fenêtre', `affichage impossible (écran ${o.displayId})`, err)
  }
}

/* ------------------------------------------------------------------ *
 * Clic traversant / mode dessin (§2.2, §12.2)
 * ------------------------------------------------------------------ */

/**
 * `forward: true` est la clé de toute l'application : les CLICS partent dans le
 * jeu, mais le renderer continue de recevoir les `pointermove`. C'est ce qui
 * permet au laser, à la loupe et au spotlight de suivre le curseur pendant que
 * l'utilisateur joue vraiment.
 */
function applyPassthrough(o: Overlay, on: boolean): void {
  o.passthrough = on
  try {
    if (o.win.isDestroyed()) return
    if (on) {
      o.win.setIgnoreMouseEvents(true, { forward: true })
      // On redevient non focusable AVANT de rendre la main : un overlay
      // focusable dans l'Alt+Tab fait perdre des parties.
      o.win.setFocusable(false)
      try {
        o.win.blur()
      } catch {
        /* ignore */
      }
    } else {
      o.drawEnteredAt = Date.now()
      o.win.setIgnoreMouseEvents(false)
      o.win.setFocusable(true)
      showOverlay(o)
      o.win.focus()
      // On vient de RÉCLAMER le premier plan à Windows. Si on ne l'obtient pas,
      // c'est presque toujours un jeu en plein écran exclusif : le seul cas où
      // Hexa ne peut structurellement rien afficher. On le dit à l'utilisateur
      // au lieu de le laisser croire à une panne (voir windows-guard.ts).
      probeExclusiveFullscreen(o.win, warnExclusiveFullscreen)
    }
  } catch (err) {
    // Le mode dessin qui ne bascule pas, c'est « ça ne marche pas » côté
    // utilisateur : on veut la trace dans le journal.
    logError('fenêtre', `bascule du mode dessin impossible (écran ${o.displayId})`, err)
  }
  refreshVisibility(o)
  // L'icône près de l'horloge doit TOUJOURS dire la vérité sur l'état courant.
  refreshTray()
}

/** Y a-t-il au moins un écran en mode dessin ? (état affiché dans le menu) */
function isDrawing(): boolean {
  for (const o of overlays.values()) if (!o.passthrough) return true
  return false
}

/**
 * Annule le retour automatique au mode traversant : dès que l'utilisateur agit
 * (F8, dessin, menu), c'est LUI qui décide, plus la séquence d'accueil.
 */
function cancelWelcome(): void {
  if (!welcomeTimer) return
  clearTimeout(welcomeTimer)
  welcomeTimer = null
  if (!quitting) log('accueil', 'séquence interrompue : l’utilisateur a pris la main')
}

/** Bascule le mode dessin sur l'écran du curseur, et le coupe sur les autres. */
function toggleDrawMode(): void {
  cancelWelcome()
  // On sort de veille : demander à dessiner, c'est demander à voir Hexa.
  if (suspended) setSuspended(false)
  const target = overlayUnderCursor()
  if (!target) return
  // On ENTRE en mode dessin si l'écran visé était en clic traversant.
  const enterDraw = target.passthrough
  for (const o of overlays.values()) {
    if (o === target) continue
    if (!o.passthrough) {
      applyPassthrough(o, true)
      send(o, 'set-draw', false)
    }
  }
  applyPassthrough(target, !enterDraw)
  // Un seul canal, en valeur absolue : impossible de désynchroniser l'interface
  // du vrai état de la fenêtre (ce qu'un simple « toggle » ne garantit pas).
  send(target, 'set-draw', enterDraw)
}

/**
 * Entre en mode dessin sur un écran précis, sans basculer.
 * C'est le comportement d'Epic Pen : choisir un outil (Ctrl+Maj+3) donne la
 * main au stylo, il n'y a pas d'étape supplémentaire.
 */
function enterDrawMode(target: Overlay): void {
  cancelWelcome()
  if (suspended) setSuspended(false)
  for (const o of overlays.values()) {
    if (o === target || o.passthrough) continue
    applyPassthrough(o, true)
    send(o, 'set-draw', false)
  }
  if (!target.passthrough) return
  applyPassthrough(target, false)
  send(target, 'set-draw', true)
}

/** Rend la souris au jeu, partout : l'outil « curseur » d'Epic Pen. */
function leaveDrawMode(): void {
  cancelWelcome()
  for (const o of overlays.values()) {
    if (o.passthrough) continue
    applyPassthrough(o, true)
    send(o, 'set-draw', false)
  }
}

/**
 * Exécute une action déclenchée par un raccourci GLOBAL.
 *
 * Deux familles :
 *  - celles qui touchent la FENÊTRE (mode dessin, curseur) : traitées ici, le
 *    renderer n'a pas la main dessus ;
 *  - celles qui touchent le DESSIN (outil, épaisseur, annuler, effacer) :
 *    relayées à la page par le canal 'action'.
 */
function dispatchGlobalAction(action: string): void {
  // Le canal 'action' sert aussi de marqueur anti double-exécution : si Windows
  // livre la touche à la page EN PLUS de nous, elle verra que le système a déjà
  // pris l'action et ne la rejouera pas (voir claimAction, src/globalShortcuts).
  if (action === 'mode.draw') {
    const o = overlayUnderCursor()
    if (o) send(o, 'action', action)
    toggleDrawMode()
    return
  }
  if (action === 'mode.cursor') {
    broadcast('action', action)
    leaveDrawMode()
    return
  }
  if (action === 'app.panic') {
    cancelWelcome()
    broadcast('action', action)
    broadcast('panic-clear')
    return
  }
  // Tout effacer nettoie TOUS les écrans, comme le fait la touche panique.
  if (action === 'edit.clear') {
    cancelWelcome()
    broadcast('action', action)
    return
  }
  const target = overlayUnderCursor()
  if (!target) return
  cancelWelcome()
  if (suspended) setSuspended(false)
  // Choisir un outil, c'est vouloir dessiner : on entre en mode dessin.
  if (action.startsWith('tool.')) enterDrawMode(target)
  send(target, 'action', action)
}

/* ------------------------------------------------------------------ *
 * Pilotage depuis l'icône de la barre des tâches
 * ------------------------------------------------------------------ */

/**
 * Mise en veille complète : toutes les fenêtres disparaissent (coût compositeur
 * strictement nul) et rien ne les ramène tant que l'utilisateur ne le demande
 * pas. C'est le « je ne veux plus voir Hexa maintenant » sans avoir à le quitter.
 */
function setSuspended(value: boolean): void {
  if (suspended === value) return
  suspended = value
  log('veille', value ? 'Hexa masqué' : 'Hexa réaffiché')
  for (const o of overlays.values()) {
    if (value && !o.passthrough) {
      applyPassthrough(o, true)
      send(o, 'set-draw', false)
    } else {
      refreshVisibility(o)
    }
  }
  refreshTray()
}

/**
 * Le message le plus utile de toute l'application, et le seul cas où Hexa est
 * réellement impuissant : en plein écran EXCLUSIF, le jeu possède la sortie
 * vidéo, Windows ne compose plus le bureau et aucun overlay ne peut s'afficher.
 * Epic Pen bute exactement sur le même mur. La solution est côté jeu.
 */
function warnExclusiveFullscreen(): void {
  showToast(
    'Ton jeu est en plein écran exclusif',
    'Windows empêche alors TOUT logiciel de dessiner par-dessus (Hexa comme les autres). ' +
      'Dans les options vidéo du jeu, choisis « Plein écran fenêtré » ou « Sans bordure » : ' +
      'l’image est identique, et Hexa réapparaît. Dans League of Legends : Options → Vidéo → ' +
      'Mode d’affichage → Sans bordure.',
    11000,
  )
}

/**
 * Éclipse système : la veille ou le verrouillage de session arrive. On rentre
 * TOUT, immédiatement, sans délai de grâce.
 *
 * Raison technique : une fenêtre transparente plein écran garde une surface de
 * composition que Windows peut invalider pendant la bascule de bureau. Au
 * retour, Chromium repeint cette surface perdue en NOIR OPAQUE — un rectangle
 * plein écran, en clic traversant, donc impossible à fermer à la souris. Une
 * fenêtre cachée n'a pas de surface à perdre.
 */
function setEclipsed(value: boolean, raison: string): void {
  // Un réveil qui arrive pendant la fermeture ne doit rien reconstruire ni
  // reprendre de raccourcis au système : on est en train de tout rendre.
  if (quitting || eclipsed === value) return
  eclipsed = value
  if (value) {
    cancelWelcome()
    for (const o of overlays.values()) {
      try {
        if (o.hideTimer) {
          clearTimeout(o.hideTimer)
          o.hideTimer = null
        }
        // Le mode dessin ne survit pas à une veille : au retour, l'utilisateur
        // est dans son jeu, pas dans Hexa. On rend la souris avant de cacher.
        if (!o.passthrough) {
          applyPassthrough(o, true)
          send(o, 'set-draw', false)
        }
        if (!o.win.isDestroyed() && o.win.isVisible()) o.win.hide()
      } catch (err) {
        logError('veille', `mise en retrait impossible (écran ${o.displayId})`, err)
      }
    }
    log('veille', `overlays rentrés (${raison})`)
    return
  }
  log('veille', `retour de session (${raison}) — remise en état`)
  // 1) Les écrans ont pu changer PENDANT la veille (moniteur éteint, station
  //    d'accueil débranchée) : on re-énumère avant tout le reste.
  rebuildOverlays(`retour de ${raison}`)
  // 2) Windows a pu perdre nos raccourcis globaux pendant la bascule de
  //    session : les réenregistrer coûte une milliseconde et évite le
  //    « F8 ne marche plus depuis que j'ai verrouillé ».
  registerShortcuts({ ...shortcuts })
  // Chaque fenêtre retrouve son niveau topmost, puis sa visibilité normale :
  // une couche qui portait des annotations réapparaît, une couche vide reste
  // cachée — exactement la règle habituelle (§2.5).
  for (const o of overlays.values()) {
    reassertTopmost(o.win)
    refreshVisibility(o)
  }
  refreshTray()
}

/** « Réglages… » : le panneau doit être visible ET cliquable, donc mode dessin. */
function openSettingsPanel(): void {
  cancelWelcome()
  if (suspended) setSuspended(false)
  const target = overlayUnderCursor() ?? overlays.values().next().value
  if (!target) return
  // En mode traversant, la fenêtre est cachée (ou traverse les clics) : le
  // panneau serait invisible et inutilisable. On entre en mode dessin d'abord.
  if (target.passthrough) {
    applyPassthrough(target, false)
    send(target, 'set-draw', true)
  }
  send(target, 'open-settings')
  log('menu', 'ouverture des réglages')
}

/** Fermeture propre demandée par l'utilisateur (menu « Quitter »). */
function quitHexa(): void {
  if (quitting) return
  quitting = true
  log('cycle', 'fermeture demandée par l’utilisateur')
  app.quit()
}

/**
 * Accélérateur Electron → notation lisible par un francophone.
 * Défensif : la table de raccourcis est reconfigurable, une entrée peut manquer.
 */
function lisible(accel: string | undefined): string {
  if (typeof accel !== 'string' || !accel) return '—'
  return accel
    .replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
    .replace(/Shift/g, 'Maj')
    .replace(/\+/g, ' + ')
}

/* ------------------------------------------------------------------ *
 * Séquence d'accueil (premier contact avec l'utilisateur)
 * ------------------------------------------------------------------ */

/** Témoin du tout premier lancement, posé dans le dossier utilisateur. */
function isFirstRun(): boolean {
  try {
    const marker = path.join(app.getPath('userData'), 'premier-lancement.txt')
    if (fs.existsSync(marker)) return false
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
    return true
  } catch (err) {
    logError('accueil', 'témoin de premier lancement illisible', err)
    return false
  }
}

let welcomeDone = false

/**
 * LE moment critique de toute l'application : Hexa vient de démarrer et n'a, par
 * nature, aucune fenêtre visible. Sans ce qui suit, l'utilisateur double-clique
 * sur l'icône, ne voit RIEN, en conclut que c'est cassé et désinstalle.
 *
 * On affiche donc l'overlay en mode dessin quelques secondes, avec un bandeau
 * qui dit quoi faire, puis on rend la souris au jeu tout seul.
 */
function runWelcome(): void {
  if (welcomeDone || quitting || isSpike) return
  welcomeDone = true
  const premier = isFirstRun()
  const target = overlays.get(screen.getPrimaryDisplay().id) ?? overlays.values().next().value
  if (!target) return

  applyPassthrough(target, false)
  send(target, 'set-draw', true)

  const dessin = lisible(shortcuts['mode.draw'] ?? FALLBACK_DRAW)
  showToast(
    premier ? 'Bienvenue dans Hexa' : 'Hexa est lancé',
    premier
      ? `Dessine directement sur ton écran. <kbd>${dessin}</kbd> entre et sort du mode dessin, ` +
          `<kbd>${lisible(shortcuts['app.panic'] ?? '')}</kbd> efface tout. Retrouve Hexa près de l’horloge.`
      : `<kbd>${dessin}</kbd> pour dessiner · l’icône près de l’horloge pour le reste.`,
    premier ? 7600 : 5200,
  )

  const duree = premier ? WELCOME_FIRST_RUN_MS : WELCOME_MS
  log('accueil', premier ? 'tout premier lancement' : 'lancement', { visibleMs: duree })
  welcomeTimer = setTimeout(() => {
    welcomeTimer = null
    // On rend la souris au jeu : Hexa redevient invisible et gratuit.
    for (const o of overlays.values()) {
      if (o.hasContent) continue
      if (o.passthrough) continue
      applyPassthrough(o, true)
      send(o, 'set-draw', false)
    }
    // On explique ce qui vient de se passer : sans ça, l'utilisateur voit son
    // écran « perdre » Hexa et croit à un plantage.
    showToast(
      'Hexa se met en retrait',
      `Tes clics repartent dans ton jeu. <kbd>${dessin}</kbd> à tout moment pour redessiner.`,
      3600,
    )
    log('accueil', 'retour au mode traversant (clics rendus au jeu)')
  }, duree)
}

/* ------------------------------------------------------------------ *
 * Création des fenêtres
 * ------------------------------------------------------------------ */

function createOverlay(display: Display): Overlay | null {
  const { bounds } = display
  try {
    const win = new BrowserWindow({
      // Bounds exactes de l'écran. Electron attend des pixels logiques (DIP) ;
      // le renderer, lui, travaille en pixels physiques via devicePixelRatio —
      // sans ça, tout est décalé sur un écran à 125 % (§12.3).
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      transparent: true,
      frame: false,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      // §12.2 : non focusable par défaut. On ne redevient focusable que le temps
      // du mode dessin, sinon l'overlay entre dans l'Alt+Tab et vole le focus du
      // jeu au pire moment.
      focusable: false,
      show: false,
      acceptFirstMouse: true,
      roundedCorners: false,
      thickFrame: false,
      title: 'Hexa Overlay',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Sans ça, Chromium bride la boucle rAF d'une fenêtre non focus — donc
        // la nôtre, en permanence.
        backgroundThrottling: false,
        devTools: !app.isPackaged,
        additionalArguments: [
          `--hexa-display=${encodeURIComponent(
            JSON.stringify({
              id: display.id,
              scaleFactor: display.scaleFactor,
              bounds: display.bounds,
              primary: display.id === screen.getPrimaryDisplay().id,
            }),
          )}`,
        ],
      },
    })

    // 'screen-saver' : le niveau le plus haut, celui qui passe au-dessus des
    // autres overlays (Discord, Steam, GeForce). Justification détaillée dans
    // windows-guard.ts → reassertTopmost, qui est aussi rappelé à chaque
    // réapparition et après chaque réveil.
    reassertTopmost(win)
    win.setMenuBarVisibility(false)
    // EXPLICITE, et c'est tout l'enjeu du stream : la protection de contenu
    // (l'équivalent du « écran noir » de Netflix) rendrait la fenêtre INVISIBLE
    // dans OBS. Elle est déjà désactivée par défaut ; on l'affirme quand même,
    // pour qu'aucune évolution d'Electron ni aucun réglage hérité ne puisse
    // faire disparaître les annotations à l'antenne sans qu'on le voie.
    try {
      win.setContentProtection(false)
    } catch {
      /* plateforme sans protection de contenu : rien à désactiver */
    }
    // On démarre TOUJOURS en traversant : au lancement, l'utilisateur joue.
    win.setIgnoreMouseEvents(true, { forward: true })

    const overlay: Overlay = {
      win,
      displayId: display.id,
      hasContent: false,
      passthrough: true,
      drawEnteredAt: 0,
      hideTimer: null,
      scaleFactor: display.scaleFactor,
      wantedBounds: { ...bounds },
      boundsRefusees: false,
    }

    win.on('closed', () => {
      if (overlay.hideTimer) clearTimeout(overlay.hideTimer)
      // ATTENTION : 'closed' peut arriver APRÈS qu'un nouvel overlay a été créé
      // pour le même identifiant d'écran (moniteur éteint puis rallumé, Windows
      // qui réutilise l'id). Supprimer aveuglément l'entrée effacerait le NOUVEL
      // overlay de la table : la fenêtre resterait à l'écran sans que personne
      // ne puisse plus la piloter — l'overlay fantôme, précisément.
      if (overlays.get(display.id) === overlay) overlays.delete(display.id)
    })

    // Arrêt / redémarrage / déconnexion Windows : on rentre tout de suite.
    // (Depuis Electron 30, `session-end` est porté par la fenêtre, plus par app.)
    watchSessionEnd(win, () => setEclipsed(true, 'fin de session'))

    // Perdre le focus pendant le mode dessin = l'utilisateur est reparti dans le
    // jeu (clic dans la fenêtre du jeu, Alt+Tab…). On rend la souris immédiatement
    // plutôt que de le laisser cliquer dans le vide sur un overlay opaque.
    win.on('blur', () => {
      if (overlay.passthrough) return
      // Fenêtre de grâce : sous Windows, passer focusable puis appeler focus()
      // peut produire un blur parasite juste après l'entrée en mode dessin.
      if (Date.now() - overlay.drawEnteredAt < 400) return
      applyPassthrough(overlay, true)
      send(overlay, 'set-draw', false)
    })

    /* ---- Diagnostic : plus RIEN n'est avalé en silence ------------- *
     * Une fenêtre transparente qui échoue à charger son interface reste une
     * fenêtre transparente : à l'écran, ça ressemble exactement à « il ne s'est
     * rien passé ». Chaque panne est donc journalisée, et les pannes fatales
     * deviennent une vraie boîte de dialogue en français.                    */
    const wc = win.webContents

    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 = ERR_ABORTED : navigation simplement remplacée, ce n'est pas une panne.
      if (code === -3) return
      logError('renderer', `chargement échoué (écran ${display.id})`, `${code} ${description} · ${url}`)
      if (!isMainFrame) return
      fatalDialog(
        'l’interface ne s’est pas chargée',
        `Hexa n’a pas réussi à charger son interface (${description}, code ${code}).\n` +
          `Adresse demandée : ${url}\n\n` +
          `C’est presque toujours une installation incomplète ou un fichier bloqué par ` +
          `l’antivirus : réinstalle Hexa avec l’installateur, puis relance-le.`,
      )
    })

    wc.on('render-process-gone', (_e, details) => {
      logError('renderer', `processus de rendu perdu (écran ${display.id})`, details)
      if (quitting || details.reason === 'clean-exit') return
      fatalDialog(
        'l’affichage s’est interrompu',
        `Le module d’affichage de Hexa s’est arrêté (${details.reason}).\n\n` +
          `Hexa reste disponible près de l’horloge : quitte-le depuis son icône, puis relance-le.`,
      )
    })

    wc.on('preload-error', (_e, preloadPath, error) => {
      logError('preload', `passerelle refusée (${preloadPath})`, error)
    })

    // Les erreurs de la page (React, moteur) remontent dans le journal : c'est
    // ce qui permet de comprendre une panne chez l'utilisateur, sans devtools.
    wc.on('console-message', (details) => {
      if (details.level !== 'error' && details.level !== 'warning') return
      // Les avertissements internes d'Electron (CSP en développement) ne sont
      // pas des pannes : ils pollueraient le journal qu'on demande à l'utilisateur.
      if (details.sourceId.startsWith('node:electron/')) return
      logError(
        'page',
        `${details.level} · ${details.sourceId}:${details.lineNumber}`,
        details.message,
      )
    })

    wc.on('did-finish-load', () => {
      log('renderer', `interface chargée (écran ${display.id})`)
      // À partir d'ici, l'application est réellement lancée : une exception
      // isolée n'a plus à interrompre l'utilisateur avec une boîte de dialogue.
      markStarted()
      // Premier chargement réussi : on se montre, sinon l'utilisateur ne saura
      // jamais que Hexa tourne.
      runWelcome()
    })

    win.on('unresponsive', () => {
      logError('fenêtre', `overlay figé (écran ${display.id})`)
    })

    if (isSpike) {
      loadSpikePage(overlay, display)
    } else if (devServerUrl) {
      log('renderer', `chargement depuis le serveur de développement ${devServerUrl}`)
      logFailure('renderer', `loadURL ${devServerUrl}`, win.loadURL(devServerUrl))
    } else {
      const page = path.join(__dirname, '..', 'dist', 'index.html')
      log('renderer', `chargement du fichier ${page}`)
      if (!fs.existsSync(page)) {
        fatalDialog(
          'interface introuvable',
          `Le fichier de l’interface est absent de l’installation :\n${page}\n\n` +
            `Réinstalle Hexa avec l’installateur pour restaurer les fichiers manquants.`,
        )
      }
      logFailure('renderer', `loadFile ${page}`, win.loadFile(page))
    }

    overlays.set(display.id, overlay)
    log('écrans', `overlay créé pour l’écran ${display.id}`, {
      taille: `${bounds.width}×${bounds.height}`,
      echelle: display.scaleFactor,
    })
    return overlay
  } catch (err) {
    logError('écrans', `création de l’overlay impossible (écran ${display.id})`, err)
    return null
  }
}

/**
 * Met la table des overlays en accord avec les écrans RÉELLEMENT présents.
 *
 * Appelée au démarrage, à chaque changement de topologie (écran branché,
 * débranché, résolution ou échelle modifiée, écran pivoté) et au retour de
 * veille. Idempotente : la rejouer ne coûte rien si rien n'a bougé — c'est ce
 * qui permet la passe de vérification différée du garde-fou.
 *
 * Trois règles, chacune tirée d'une panne réelle des outils d'overlay :
 *  - on ne DÉTRUIT que ce qui a vraiment disparu (détruire et recréer à chaque
 *    événement ferait clignoter l'overlay et perdrait les annotations en cours) ;
 *  - on ne repose des bounds que si elles ont réellement changé (reposer une
 *    fenêtre en pleine partie lui fait perdre sa place dans l'ordre topmost) ;
 *  - le mode dessin SURVIT au changement : si l'écran où l'on dessinait a
 *    disparu, la main passe à l'écran du curseur, sinon l'utilisateur appuie
 *    sur F8 sans plus rien obtenir.
 */
function rebuildOverlays(raison = 'démarrage'): void {
  if (quitting) return
  try {
    const displays = screen.getAllDisplays()
    const seen = new Set<number>()
    const dessinAvant = isDrawing()
    let cree = 0
    let repose = 0

    for (const d of displays) {
      seen.add(d.id)
      const existing = overlays.get(d.id)
      if (!existing) {
        if (createOverlay(d)) cree++
        continue
      }
      if (existing.win.isDestroyed()) {
        // Fenêtre morte mais entrée encore présente : on repart d'une neuve,
        // sinon l'écran resterait définitivement sans couche d'annotation.
        overlays.delete(d.id)
        if (createOverlay(d)) cree++
        continue
      }
      const echelleChangee = existing.scaleFactor !== d.scaleFactor
      // Cible changée = l'écran a vraiment été reconfiguré. Fenêtre décalée =
      // quelqu'un d'autre l'a déplacée (Windows le fait après un changement de
      // résolution provoqué par un jeu). Les deux méritent une pose ; la
      // seconde une seule fois, pour ne pas se battre en boucle avec le système.
      const cibleChangee = !existing.wantedBounds || !sameBounds(existing.wantedBounds, d.bounds)
      const decalee = !sameBounds(existing.win.getBounds(), d.bounds)
      const boundsChangees = cibleChangee || (decalee && !existing.boundsRefusees)
      if (boundsChangees) {
        existing.wantedBounds = { ...d.bounds }
        existing.boundsRefusees = !applyBounds(existing.win, d.bounds, `écran ${d.id}`)
        repose++
      }
      if (echelleChangee || boundsChangees) {
        existing.scaleFactor = d.scaleFactor
        // Le renderer dimensionne ses canvas en pixels PHYSIQUES à partir de
        // devicePixelRatio. Un changement d'échelle ne produit PAS toujours un
        // événement `resize` DOM (la taille en pixels CSS peut être inchangée) :
        // sans ce message, les canvas resteraient calibrés pour l'ancien
        // facteur et le trait tomberait à côté du curseur (§12.3).
        send(existing, 'display-changed', {
          id: d.id,
          scaleFactor: d.scaleFactor,
          bounds: d.bounds,
          primary: d.id === screen.getPrimaryDisplay().id,
        })
        // Une fenêtre reposée repart parfois derrière : on réaffirme le niveau.
        reassertTopmost(existing.win)
      }
    }

    let detruits = 0
    for (const [id, o] of [...overlays]) {
      if (seen.has(id)) continue
      // L'écran a disparu : sa fenêtre pointe sur des coordonnées qui
      // n'existent plus. La garder, c'est l'overlay fantôme qui consomme le
      // compositeur et que rien ne peut plus atteindre.
      overlays.delete(id)
      if (o.hideTimer) {
        clearTimeout(o.hideTimer)
        o.hideTimer = null
      }
      // Le miroir OBS parlait peut-être depuis cet écran : sans cet oubli, la
      // vue OBS resterait figée sur un émetteur mort jusqu'au redémarrage.
      try {
        if (!o.win.isDestroyed() && o.win.webContents.id === obsSender) obsSender = null
      } catch {
        obsSender = null
      }
      try {
        if (!o.win.isDestroyed()) o.win.destroy()
      } catch (err) {
        logError('écrans', `libération de l’overlay ${id} impossible`, err)
      }
      detruits++
      log('écrans', `écran ${id} débranché — overlay libéré`)
    }

    if (cree || detruits || repose) {
      log('écrans', `topologie mise à jour (${raison})`, {
        ecrans: displays.length,
        crees: cree,
        reposes: repose,
        detruits,
        overlays: overlays.size,
      })
    }

    // Le mode dessin ne doit pas mourir avec un écran débranché.
    if (dessinAvant && !isDrawing() && !suspended && !eclipsed) {
      const cible = overlayUnderCursor()
      if (cible) {
        log('écrans', 'écran de dessin disparu — la main passe à l’écran du curseur')
        applyPassthrough(cible, false)
        send(cible, 'set-draw', true)
      }
    }
    refreshTray()
  } catch (err) {
    logError('écrans', 'reconstruction des overlays impossible', err)
  }
}

/* ------------------------------------------------------------------ *
 * SPIKE 0 (§14) — la preuve par le rond rouge
 * ------------------------------------------------------------------ */

/**
 * Page autonome (data: URL, zéro fichier, zéro réseau) : un cercle rouge de
 * 40 px qui suit le curseur système. Les positions sont poussées depuis le
 * processus principal (le seul qui connaisse le curseur en mode traversant) ;
 * la page se contente d'une rAF qui applique la dernière position connue.
 */
function loadSpikePage(overlay: Overlay, display: Display): void {
  const html = `<!doctype html><meta charset="utf-8"><title>Hexa · Spike 0</title>
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;cursor:none}
  #dot{position:fixed;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;
    border-radius:50%;background:#ff2d40;
    box-shadow:0 0 0 2px rgba(255,255,255,.85),0 0 28px 6px rgba(255,45,64,.65);
    will-change:transform}
  #hud{position:fixed;left:16px;top:16px;font:12px/1.5 system-ui,sans-serif;color:#fff;
    background:rgba(0,0,0,.55);padding:8px 12px;border-radius:10px}
</style>
<div id="dot"></div>
<div id="hud">Hexa · Spike 0 — écran ${display.id} · le rond doit suivre le curseur PAR-DESSUS le jeu, sans lui voler le focus.</div>
<script>
  var tx = 0, ty = 0, dot = document.getElementById('dot')
  if (window.hexa && window.hexa.on) {
    window.hexa.on('spike-cursor', function (p) { tx = p.x; ty = p.y })
  }
  // rAF côté page uniquement : aucun timer, aucune boucle de calcul.
  requestAnimationFrame(function loop () {
    dot.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)'
    requestAnimationFrame(loop)
  })
</script>`
  logFailure(
    'spike',
    'chargement de la page du spike',
    overlay.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)),
  )
  overlay.win.once('ready-to-show', () => {
    overlay.hasContent = true
    refreshVisibility(overlay)
  })
}

let spikeTimer: NodeJS.Timeout | null = null

/**
 * Pompe de position pour le spike. `setTimeout` ré-armé (jamais `setInterval`,
 * §2.5) et UNIQUEMENT dans le mode spike : en usage normal, le processus
 * principal ne tourne pas en boucle.
 */
function startSpikePump(): void {
  const tick = () => {
    try {
      const p = screen.getCursorScreenPoint()
      for (const o of overlays.values()) {
        const d = screen.getAllDisplays().find((x) => x.id === o.displayId)
        if (!d) continue
        send(o, 'spike-cursor', { x: p.x - d.bounds.x, y: p.y - d.bounds.y })
      }
    } catch {
      /* ignore */
    }
    spikeTimer = setTimeout(tick, 8)
  }
  tick()
}

/* ------------------------------------------------------------------ *
 * Raccourcis globaux (§8.1, §8.6, §12.4)
 * ------------------------------------------------------------------ */

/**
 * Enregistre auprès du système TOUTES les combinaisons demandées.
 *
 * On annote par-dessus un jeu : un raccourci qui n'existe que lorsque notre
 * fenêtre a le focus ne sert à rien. C'est pourquoi les combinaisons d'Epic Pen
 * (Ctrl+Maj+2/3/4/5/6, Ctrl+E, Ctrl+H…) sont confisquées au système, exactement
 * comme le fait Epic Pen lui-même.
 *
 * Le renderer ne pousse ici QUE des combinaisons avec modificateur (ou F6–F12) :
 * une lettre nue enregistrée globalement serait volée à tous les autres
 * logiciels (voir isRegistrableCombo dans src/keymap.ts).
 *
 * Un Stream Deck n'a besoin de rien de plus : il envoie ces combinaisons comme
 * un clavier physique (§8.6), donc chaque ligne de la table est pilotable
 * depuis un boîtier, sans plugin dédié.
 */
function registerShortcuts(map: ShortcutMap): { registered: string[]; failed: string[] } {
  const registered: string[] = []
  const failed: string[] = []
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* ignore */
  }
  for (const [action, accel] of Object.entries(map)) {
    if (typeof accel !== 'string' || accel.length === 0) continue
    let ok = false
    try {
      // register renvoie false quand un autre logiciel a déjà pris la
      // combinaison ; certaines versions lèvent aussi sur un accélérateur
      // invalide. Les deux cas atterrissent dans `failed`.
      ok = globalShortcut.register(accel, () => dispatchGlobalAction(action))
    } catch {
      ok = false
    }
    if (ok) registered.push(action)
    else failed.push(action)
  }

  // Filet de sécurité : sans mode dessin, l'utilisateur est prisonnier de son
  // jeu. Si sa combinaison a été refusée, on remet F8 d'office.
  if (!registered.includes('mode.draw')) {
    try {
      if (globalShortcut.register(FALLBACK_DRAW, () => toggleDrawMode())) {
        map = { ...map, 'mode.draw': FALLBACK_DRAW }
        registered.push('mode.draw')
        const i = failed.indexOf('mode.draw')
        if (i >= 0) failed.splice(i, 1)
        log('raccourcis', 'mode dessin refusé par le système : repli sur F8')
      }
    } catch {
      /* ignore */
    }
  }

  shortcuts = map
  log('raccourcis', 'enregistrement global', {
    pris: registered.length,
    refuses: failed.length,
    refusesDetail: failed.map((a) => `${a}=${map[a]}`).join(' '),
  })
  return { registered, failed }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc(): void {
  // Mode dessin / traversant demandé par le renderer.
  ipcMain.on('hexa:set-passthrough', (e, value: unknown) => {
    const o = overlayFromEvent(e)
    if (!o) return
    applyPassthrough(o, value !== false)
  })

  // §2.5 : le renderer nous dit si sa couche est vivante. C'est le signal qui
  // décide de cacher la fenêtre (coût compositeur nul) ou de la rendre.
  ipcMain.on('hexa:activity', (e, active: unknown) => {
    const o = overlayFromEvent(e)
    if (!o) return
    o.hasContent = active === true
    // L'utilisateur dessine : la séquence d'accueil n'a plus rien à imposer.
    if (o.hasContent) cancelWelcome()
    refreshVisibility(o)
  })

  // Journalisation demandée par la page (erreurs du renderer, diagnostics).
  ipcMain.on('hexa:log', (_e, scope: unknown, message: unknown) => {
    if (typeof message !== 'string') return
    log(typeof scope === 'string' ? scope : 'page', message.slice(0, 2000))
  })

  // Emplacement du journal, pour l'afficher dans les réglages.
  ipcMain.handle('hexa:log-path', () => logFilePath())

  /**
   * Écran porteur, ACTUALISÉ. Le preload en garde un instantané pris à la
   * création de la fenêtre ; après un changement de résolution ou un passage à
   * 125 %, cet instantané ment. Le renderer peut donc redemander la vérité —
   * c'est ce qui lui permet de recalibrer ses canvas au pixel près (§12.3).
   */
  ipcMain.handle('hexa:display-info', (e) => {
    try {
      const o = overlayFromEvent(e)
      const d =
        screen.getAllDisplays().find((x) => x.id === o?.displayId) ?? screen.getPrimaryDisplay()
      return {
        id: d.id,
        scaleFactor: d.scaleFactor,
        bounds: d.bounds,
        primary: d.id === screen.getPrimaryDisplay().id,
      }
    } catch {
      return null
    }
  })

  // Capture de l'écran appelant, en pixels PHYSIQUES (loupe, gel d'image, flou).
  ipcMain.handle('hexa:capture-screen', async (e) => {
    try {
      const o = overlayFromEvent(e)
      const display =
        screen.getAllDisplays().find((d) => d.id === o?.displayId) ?? screen.getPrimaryDisplay()
      const size = {
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor),
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: size,
        fetchWindowIcons: false,
      })
      const match =
        sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0] ?? null
      if (!match || match.thumbnail.isEmpty()) return null
      return match.thumbnail.toDataURL()
    } catch {
      // §12.6 : sur certaines configurations le partage d'écran est refusé.
      // On renvoie null, jamais une exception : l'appelant dégrade proprement.
      return null
    }
  })

  // Identifiant de source pour getUserMedia côté renderer (flux vidéo continu
  // de la loupe : bien moins coûteux qu'une suite de captures).
  ipcMain.handle('hexa:get-screen-source-id', async (e) => {
    try {
      const o = overlayFromEvent(e)
      const display =
        screen.getAllDisplays().find((d) => d.id === o?.displayId) ?? screen.getPrimaryDisplay()
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      })
      const match = sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0]
      return match ? match.id : null
    } catch {
      return null
    }
  })

  /**
   * Reconfiguration des raccourcis globaux depuis l'éditeur de raccourcis.
   * Appelé au démarrage de la page ET à chaque modification : c'est ce qui
   * évite le « redémarre l'application pour appliquer ».
   *
   * Entrée : { 'tool.pen': 'Control+Shift+3', … } — accélérateurs Electron déjà
   * filtrés côté renderer. Toute valeur non conforme est ignorée.
   */
  ipcMain.handle('hexa:set-shortcuts', (_e, value: unknown) => {
    const input = (value ?? {}) as Record<string, unknown>
    const map: ShortcutMap = {}
    for (const [action, accel] of Object.entries(input)) {
      // Garde-fou : action et accélérateur plausibles, rien d'autre ne passe.
      if (typeof accel !== 'string' || accel.length === 0 || accel.length > 40) continue
      if (!/^[a-z]+\.[a-zA-Z]+$/.test(action)) continue
      map[action] = accel
    }
    const result = registerShortcuts(
      Object.keys(map).length > 0 ? map : { ...DEFAULT_SHORTCUTS },
    )
    return { ...result, accelerators: { ...shortcuts } }
  })

  /* ---- Miroir OBS (§10.2) ---------------------------------------- */

  // Démarrage/arrêt du serveur local qui sert obs.html et diffuse l'état.
  ipcMain.handle('hexa:obs-server', async (_e, value: unknown) => {
    const cfg = (value ?? {}) as { enabled?: unknown; port?: unknown }
    const port =
      typeof cfg.port === 'number' && cfg.port > 1023 && cfg.port < 65536 ? cfg.port : 4787
    try {
      if (cfg.enabled === true) {
        const status = await startObsServer({
          port,
          root: path.join(app.getAppPath(), 'dist'),
          onClients: (n) => broadcast('obs-clients', n),
          // Une source navigateur qui vient de s'ouvrir (ou qu'OBS a rechargée
          // au changement de scène) réclame l'état complet : sans ce chemin,
          // elle resterait DÉSESPÉRÉMENT VIDE jusqu'au trait suivant.
          onHello: () => broadcast('obs-full-request'),
          onLog: (message) => log('obs', message),
        })
        broadcast('obs-status', status)
        return status
      }
      stopObsServer()
      // plus personne n'a la main : le prochain écran qui publie la reprendra
      obsSender = null
      broadcast('obs-clients', 0)
      const status = obsServerStatus()
      broadcast('obs-status', status)
      return status
    } catch (err) {
      logError('obs', 'serveur de la vue OBS', err)
      return { running: false, port, wantedPort: port, clients: 0, url: '', error: String(err) }
    }
  })

  // État du serveur, à la demande (panneau de réglages ouvert en pleine session).
  ipcMain.handle('hexa:obs-status', () => obsServerStatus())

  /**
   * Message déjà sérialisé par le renderer : on le relaie… mais UN SEUL écran à
   * la fois.
   *
   * Sur deux écrans, Hexa ouvre deux overlays, donc deux pages qui publient
   * chacune leurs traits — avec des numéros qui se chevauchent. Tout mélanger
   * dans la même source navigateur donnerait un salmigondis d'annotations
   * venues des deux écrans, superposées n'importe où. La règle est donc :
   * la vue OBS suit L'ÉCRAN OÙ L'ON DESSINE. Un autre écran ne prend la main
   * qu'au moment où un trait y commence vraiment ; on lui redemande alors son
   * état complet, ce qui remplace proprement le contenu de la vue.
   */
  ipcMain.on('hexa:obs-publish', (e, payload: unknown) => {
    if (typeof payload !== 'string' || payload.length > 4_000_000) return
    const id = e.sender.id
    if (obsSender !== id) {
      const nouveauTrait = payload.includes('"stroke:add"')
      const previous =
        obsSender == null
          ? undefined
          : BrowserWindow.getAllWindows().find(
              (w) => !w.isDestroyed() && w.webContents.id === obsSender,
            )
      // Un écran déjà actif ne cède la main qu'à un trait qui commence
      // vraiment ailleurs. S'il a disparu (fenêtre fermée, écran débranché),
      // reprise immédiate par celui qui parle.
      if (previous && !nouveauTrait) return
      // Personne n'a encore la main : l'écran PRINCIPAL est prioritaire, c'est
      // celui que le streamer capture dans neuf cas sur dix.
      if (!previous && !nouveauTrait) {
        const principal = overlays.get(screen.getPrimaryDisplay().id)
        if (principal && !principal.win.isDestroyed() && principal.win.webContents.id !== id) return
      }
      obsSender = id
      broadcast('obs-full-request')
    }
    broadcastObs(payload)
  })
}

/* ------------------------------------------------------------------ *
 * Cycle de vie
 * ------------------------------------------------------------------ */

/**
 * INSTANCE UNIQUE. Sans ce verrou, relancer Hexa (double-clic de trop, raccourci
 * du bureau, démarrage automatique) empilerait des overlays fantômes : plusieurs
 * couches transparentes superposées, des raccourcis globaux qui se battent pour
 * la même touche, et un utilisateur qui ne comprend plus rien.
 */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // La première instance sera prévenue par 'second-instance' : on se retire.
  // `app.exit` et pas `app.quit` : avant que l'application soit prête, `quit`
  // peut ne jamais aboutir et laisser un processus fantôme dans le gestionnaire
  // des tâches — exactement ce qu'on veut éviter.
  log('cycle', 'Hexa tourne déjà — cette seconde instance se retire')
  app.exit(0)
} else {
  initLogger()
  installCrashHandlers()
  log('cycle', `démarrage de Hexa ${app.getVersion()}`, {
    journal: logFilePath(),
    arguments: process.argv.slice(1).join(' ') || '(aucun)',
  })

  /** Horodatage du dernier signalement, pour ne pas empiler les bandeaux. */
  let dernierSignalement = 0

  app.on('second-instance', (_e, argv) => {
    // Deuxième lancement = l'utilisateur a cliqué l'icône et attend un signe.
    log('cycle', 'seconde instance refusée', argv.slice(1).join(' ') || '(aucun argument)')
    // Un double-clic impatient sur le raccourci du bureau peut en produire
    // plusieurs d'affilée : un seul bandeau suffit.
    const maintenant = Date.now()
    if (maintenant - dernierSignalement < 1500) return
    dernierSignalement = maintenant
    if (suspended) setSuspended(false)
    for (const o of overlays.values()) showOverlay(o)
    notifyAlreadyRunning()
    showToast(
      'Hexa tourne déjà',
      `Inutile de le relancer : <kbd>${lisible(shortcuts['mode.draw'] ?? FALLBACK_DRAW)}</kbd> ` +
        `pour dessiner, ou clique son icône près de l’horloge.`,
      4200,
    )
  })

  app.whenReady().then(() => {
    registerIpc()

    const ecrans = screen.getAllDisplays()
    log('écrans', `${ecrans.length} écran(s) détecté(s)`, {
      principal: screen.getPrimaryDisplay().id,
      liste: ecrans.map((d) => `${d.id}:${d.bounds.width}×${d.bounds.height}@${d.scaleFactor}`),
    })

    rebuildOverlays('démarrage')
    if (overlays.size === 0) {
      fatalDialog(
        'aucun écran utilisable',
        'Hexa n’a pas réussi à créer sa couche d’annotation sur cet ordinateur. ' +
          'Vérifie qu’un écran est bien branché, puis relance Hexa.',
      )
    }

    // Combinaisons d'usine (preset Epic Pen) enregistrées AVANT le chargement
    // de la page : Ctrl+Maj+3 doit sortir le stylo dès la première seconde.
    // La page les repoussera aussitôt avec les réglages de l'utilisateur.
    const raccourcis = registerShortcuts({ ...DEFAULT_SHORTCUTS })
    log('raccourcis', 'raccourcis globaux d’usine enregistrés', {
      pris: raccourcis.registered.join(' '),
      refuses: raccourcis.failed.join(' ') || 'aucun',
    })
    if (raccourcis.failed.includes('mode.draw')) {
      // Un autre logiciel a confisqué la touche : on le DIT, sinon l'utilisateur
      // appuiera dessus toute la soirée en pensant que Hexa est cassé.
      showToast(
        'Raccourci indisponible',
        `<kbd>${lisible(DEFAULT_SHORTCUTS['mode.draw'] ?? FALLBACK_DRAW)}</kbd> est déjà pris par ` +
          `un autre logiciel. Utilise l’icône près de l’horloge, ou change la touche dans les réglages.`,
        7000,
      )
    }

    // L'icône près de l'horloge : sans elle, Hexa est invisible ET impilotable.
    trayReady = createHexaTray({
      toggleDraw: () => toggleDrawMode(),
      clearAll: () => {
        cancelWelcome()
        broadcast('panic-clear')
        log('menu', 'tout effacer')
      },
      openSettings: () => openSettingsPanel(),
      toggleSuspended: () => setSuspended(!suspended),
      isDrawing,
      isSuspended: () => suspended,
      drawShortcut: () => lisible(shortcuts['mode.draw'] ?? FALLBACK_DRAW),
      clearShortcut: () => lisible(shortcuts['app.panic'] ?? shortcuts['edit.clear']),
      quit: () => quitHexa(),
    })
    if (!trayReady) {
      logError(
        'barre-des-tâches',
        'aucune icône : ce bureau n’a pas de zone de notification utilisable',
      )
    }

    if (isSpike) startSpikePump()

    // Écrans branchés/débranchés/redimensionnés/repassés à 125 % : on suit.
    // Le filtrage et le débounce vivent dans windows-guard.ts — sans eux, la
    // simple auto-dissimulation de la barre des tâches reposerait toutes les
    // fenêtres en pleine partie.
    watchDisplays({ onTopologie: (raison) => rebuildOverlays(raison) })

    // Veille, verrouillage, changement d'utilisateur, fin de session Windows.
    watchPower({
      onEclipse: (raison) => setEclipsed(true, raison),
      onRetour: (raison) => setEclipsed(false, raison),
    })

    app.on('activate', () => {
      if (overlays.size === 0) rebuildOverlays('activation')
    })
  })

  /**
   * FERMETURE PROPRE : raccourcis globaux rendus au système, serveur OBS coupé,
   * minuteries éteintes, icône libérée (sinon Windows garde un fantôme près de
   * l'horloge), fenêtres détruites.
   */
  app.on('will-quit', () => {
    quitting = true
    log('cycle', 'fermeture : libération des ressources')
    cancelWelcome()
    closeToast()
    destroyTray()
    stopObsServer()
    // Écouteurs d'écrans et d'alimentation + minuteries différées du garde-fou.
    // Un écouteur `screen`/`powerMonitor` encore branché peut rappeler du code
    // dont les fenêtres sont détruites — et surtout garder le processus vivant.
    stopWindowsGuard()
    try {
      globalShortcut.unregisterAll()
    } catch (err) {
      logError('raccourcis', 'libération impossible', err)
    }
    if (spikeTimer) {
      clearTimeout(spikeTimer)
      spikeTimer = null
    }
    for (const o of overlays.values()) {
      if (o.hideTimer) clearTimeout(o.hideTimer)
      try {
        if (!o.win.isDestroyed()) o.win.destroy()
      } catch {
        /* ignore */
      }
    }
    overlays.clear()
    log('cycle', 'Hexa fermé proprement')

    /**
     * DERNIER FILET ANTI-ZOMBIE. Sous Windows, un socket resté ouvert (vue OBS
     * d'un navigateur qui ne s'est pas déconnecté), un pilote graphique lent ou
     * un processus GPU qui traîne peuvent empêcher la sortie : Hexa disparaît
     * de l'écran mais reste dans le gestionnaire des tâches, avec ses
     * raccourcis globaux confisqués — et le prochain lancement se heurte au
     * verrou d'instance unique. L'utilisateur conclut « ça ne se lance plus ».
     *
     * `unref()` est essentiel : cette minuterie ne doit surtout pas maintenir
     * elle-même la boucle d'événements en vie. Si le processus se termine
     * normalement, elle n'existe déjà plus.
     */
    const filet = setTimeout(() => {
      log('cycle', 'sortie forcée : des ressources système n’ont pas rendu la main')
      process.exit(0)
    }, 2500)
    filet.unref?.()
  })

  /**
   * Hexa est un OVERLAY : il vit dans la barre des tâches, sans fenêtre visible.
   * Fermer la dernière fenêtre ne doit donc surtout pas quitter l'application.
   * Seule exception : si l'icône n'a pas pu s'installer, il ne resterait aucune
   * prise sur un processus devenu invisible — dans ce cas on quitte.
   */
  app.on('window-all-closed', () => {
    if (quitting) return
    if (!trayReady) {
      log('cycle', 'plus aucune fenêtre et pas d’icône : fermeture pour ne pas rester fantôme')
      app.quit()
      return
    }
    log('cycle', 'plus aucune fenêtre — Hexa reste disponible près de l’horloge')
  })
}
