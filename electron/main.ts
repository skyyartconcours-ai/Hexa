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
  type IpcMainEvent,
} from 'electron'
import path from 'node:path'

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
  /** minuterie de grâce avant win.hide() */
  hideTimer: NodeJS.Timeout | null
}

interface ShortcutMap {
  /** accélérateur Electron pour entrer/sortir du mode dessin */
  toggleDraw: string
  /** accélérateur Electron de la touche panique (tout effacer) */
  panic: string
}

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

/** §12.4 : F1–F5 sont les sorts alliés dans League of Legends → interdits. */
const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggleDraw: 'F8',
  panic: 'Control+Shift+X',
}

let shortcuts: ShortcutMap = { ...DEFAULT_SHORTCUTS }

const isSpike = process.env.HEXA_SPIKE === '1'
const devServerUrl = process.env.VITE_DEV_SERVER_URL

/* ------------------------------------------------------------------ *
 * Utilitaires
 * ------------------------------------------------------------------ */

function overlayFor(win: BrowserWindow | null): Overlay | undefined {
  if (!win) return undefined
  for (const o of overlays.values()) if (o.win === win) return o
  return undefined
}

function overlayFromEvent(e: IpcMainEvent): Overlay | undefined {
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
  const shouldShow = o.hasContent || !o.passthrough
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
    if (o.hasContent || !o.passthrough) return
    try {
      if (!o.win.isDestroyed() && o.win.isVisible()) o.win.hide()
    } catch {
      /* ignore */
    }
  }, HIDE_GRACE_MS)
}

function showOverlay(o: Overlay): void {
  try {
    if (o.win.isDestroyed()) return
    if (!o.win.isVisible()) o.win.showInactive()
    // Certains overlays de jeu (Discord, GeForce Experience) se réinsèrent
    // au-dessus : on réaffirme le niveau à chaque réapparition.
    o.win.setAlwaysOnTop(true, 'screen-saver')
  } catch {
    /* ignore */
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
      o.win.setIgnoreMouseEvents(false)
      o.win.setFocusable(true)
      showOverlay(o)
      o.win.focus()
    }
  } catch {
    /* ignore */
  }
  refreshVisibility(o)
}

/** Bascule le mode dessin sur l'écran du curseur, et le coupe sur les autres. */
function toggleDrawMode(): void {
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
  send(target, 'set-draw', enterDraw)
  send(target, 'toggle-draw')
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

    // 'screen-saver' : le niveau le plus haut sous Windows, celui qui passe
    // au-dessus des autres overlays (Discord, Steam, GeForce).
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setMenuBarVisibility(false)
    // On démarre TOUJOURS en traversant : au lancement, l'utilisateur joue.
    win.setIgnoreMouseEvents(true, { forward: true })

    const overlay: Overlay = {
      win,
      displayId: display.id,
      hasContent: false,
      passthrough: true,
      hideTimer: null,
    }

    win.on('closed', () => {
      if (overlay.hideTimer) clearTimeout(overlay.hideTimer)
      overlays.delete(display.id)
    })

    // Ceinture et bretelles : si un tiers nous fait passer derrière, on remonte.
    win.on('blur', () => {
      if (overlay.passthrough) return
      // Perdre le focus en mode dessin = l'utilisateur est reparti dans le jeu.
      applyPassthrough(overlay, true)
      send(overlay, 'set-draw', false)
    })

    if (isSpike) {
      loadSpikePage(overlay, display)
    } else if (devServerUrl) {
      win.loadURL(devServerUrl).catch(() => undefined)
    } else {
      win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(() => undefined)
    }

    overlays.set(display.id, overlay)
    return overlay
  } catch {
    return null
  }
}

function rebuildOverlays(): void {
  try {
    const displays = screen.getAllDisplays()
    const seen = new Set<number>()
    for (const d of displays) {
      seen.add(d.id)
      const existing = overlays.get(d.id)
      if (existing) {
        try {
          existing.win.setBounds(d.bounds)
        } catch {
          /* ignore */
        }
      } else {
        createOverlay(d)
      }
    }
    for (const [id, o] of [...overlays]) {
      if (seen.has(id)) continue
      try {
        o.win.destroy()
      } catch {
        /* ignore */
      }
      overlays.delete(id)
    }
  } catch {
    /* ignore */
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
  overlay.win
    .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    .catch(() => undefined)
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
 * Les raccourcis globaux sont volontairement limités à deux : entrer/sortir du
 * mode dessin, et la touche panique. Tout le reste est capté par le renderer
 * (table centralisée src/keymap.ts) — inutile de confisquer des touches au jeu.
 *
 * Un Stream Deck n'a besoin de rien de plus : il envoie ces combinaisons comme
 * un clavier physique (§8.6), donc chaque bouton de la table de raccourcis est
 * pilotable depuis un Stream Deck sans plugin dédié.
 */
function registerShortcuts(map: ShortcutMap): { toggleDraw: boolean; panic: boolean } {
  const result = { toggleDraw: false, panic: false }
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* ignore */
  }
  try {
    result.toggleDraw = globalShortcut.register(map.toggleDraw, () => toggleDrawMode())
  } catch {
    result.toggleDraw = false
  }
  try {
    result.panic = globalShortcut.register(map.panic, () => {
      broadcast('panic-clear')
      // La couche redevient vide : les fenêtres se recacheront d'elles-mêmes
      // après le délai de grâce, via 'hexa:activity'.
    })
  } catch {
    result.panic = false
  }
  shortcuts = map
  return result
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
    refreshVisibility(o)
  })

  // Capture de l'écran appelant, en pixels PHYSIQUES (loupe, gel d'image, flou).
  ipcMain.handle('hexa:capture-screen', async (e) => {
    try {
      const o = overlayFromEvent(e as unknown as IpcMainEvent)
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
      const o = overlayFromEvent(e as unknown as IpcMainEvent)
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

  // Reconfiguration des raccourcis globaux depuis l'éditeur de raccourcis.
  ipcMain.handle('hexa:set-shortcuts', (_e, value: unknown) => {
    const input = (value ?? {}) as Partial<ShortcutMap>
    const map: ShortcutMap = {
      toggleDraw:
        typeof input.toggleDraw === 'string' && input.toggleDraw
          ? input.toggleDraw
          : DEFAULT_SHORTCUTS.toggleDraw,
      panic:
        typeof input.panic === 'string' && input.panic ? input.panic : DEFAULT_SHORTCUTS.panic,
    }
    const ok = registerShortcuts(map)
    // Si une combinaison est déjà prise par un autre logiciel, on revient à la
    // valeur d'usine pour ne jamais laisser l'utilisateur sans mode dessin.
    if (!ok.toggleDraw && map.toggleDraw !== DEFAULT_SHORTCUTS.toggleDraw) {
      registerShortcuts({ ...map, toggleDraw: DEFAULT_SHORTCUTS.toggleDraw })
    }
    return { ...shortcuts, applied: ok }
  })
}

/* ------------------------------------------------------------------ *
 * Cycle de vie
 * ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Deuxième lancement = l'utilisateur a cliqué l'icône : on se signale.
    for (const o of overlays.values()) showOverlay(o)
  })

  app.whenReady().then(() => {
    registerIpc()
    rebuildOverlays()
    registerShortcuts(DEFAULT_SHORTCUTS)

    if (isSpike) startSpikePump()

    // Écrans branchés/débranchés/redimensionnés à chaud : on suit.
    screen.on('display-added', rebuildOverlays)
    screen.on('display-removed', rebuildOverlays)
    screen.on('display-metrics-changed', rebuildOverlays)

    app.on('activate', () => {
      if (overlays.size === 0) rebuildOverlays()
    })
  })

  app.on('will-quit', () => {
    try {
      globalShortcut.unregisterAll()
    } catch {
      /* ignore */
    }
    if (spikeTimer) clearTimeout(spikeTimer)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
