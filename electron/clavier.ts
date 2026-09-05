/**
 * LA FENÊTRE CLAVIER — Hexa ne donne plus jamais le focus à une fenêtre
 * transparente.
 *
 * Retour utilisateur (build 39) : « ça fait ça quand j'ai voulu écrire, ça
 * cache YouTube ». Tout l'écran devient un aplat gris sombre, opaque, et le
 * trait reste visible par-dessus. Ce n'est pas un rendu d'Hexa : c'est la
 * fenêtre elle-même qui a perdu sa transparence.
 *
 * La mécanique, relue dans les sources :
 *  - Chromium (ui/views/win/hwnd_message_handler.cc, OnCreate) étend le cadre
 *    DWM sur TOUTE la surface d'une fenêtre translucide (marges −1) : c'est ce
 *    qui donne la transparence par pixel sous Windows.
 *  - Electron (patches/chromium/fix_resolve_dynamic_background_material_update_
 *    issue_on_windows_11.patch, identique de la 36 à la 44) fait passer
 *    WM_NCACTIVATE des fenêtres translucides sans cadre à DefWindowProc.
 *    WM_NCACTIVATE arrive à CHAQUE changement d'activation — donc à chaque
 *    focus() ou blur() de la fenêtre.
 *  - Sur certains matériels, DWM repeint alors « le cadre » — c'est-à-dire la
 *    fenêtre entière — dans la couleur de cadre du thème sombre : gris opaque.
 *    Le correctif connu (SetIsTranslucent(false)) est natif ; il n'est pas
 *    dans Electron, et une mise à niveau ne change rien.
 *
 * Hexa activait ses deux fenêtres transparentes pour la frappe clavier : la
 * couche encre en mode dessin, l'interface quand un panneau s'ouvre. C'est
 * précisément le moment où l'utilisateur « voulait écrire ».
 *
 * La parade, sans toucher à Electron : les fenêtres transparentes ne sont
 * JAMAIS focusables — donc jamais activées, donc jamais de WM_NCACTIVATE. Le
 * clavier est tenu par cette fenêtre-ci : opaque, 2 × 2 pixels, hors Alt+Tab,
 * hors des captures, dans le coin de l'écran d'annotation. Elle reçoit les
 * touches et les rejoue dans la page qui les attend (encre, ou interface si un
 * panneau est ouvert) par le protocole DevTools — le chemin même de Playwright,
 * qui tape dans nos champs sans que la fenêtre ait le focus système. Les pages
 * sont mises en « focus émulé » pour que champs, caret et événements se
 * comportent comme si elles l'avaient.
 */
import { app, BrowserWindow, type Display, type Input, type WebContents } from 'electron'
import { log, logError } from './logger'

/** 2 pixels : invisible à l'œil, mais une vraie fenêtre pour Windows. */
const TAILLE = 2

/** Page minimale : un titre lisible dans les outils de diagnostic, un fond noir. */
const PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent('<!doctype html><title>Hexa Clavier</title><body style="margin:0;background:#000"></body>')

export interface ClavierOptions {
  /** la page qui doit recevoir les touches EN CE MOMENT (encre, ou interface si un panneau est ouvert) */
  cible: () => WebContents | null
  /** le clavier vient d'être perdu (Alt+Tab, clic dans le jeu sur un autre écran) */
  surPerte: () => void
}

let fenetre: BrowserWindow | null = null
/** une seule ligne de journal pour dire que le relais est vivant */
let premiereRelayee = false
let options: ClavierOptions | null = null

function boundsClavier(d: Display): { x: number; y: number; width: number; height: number } {
  return {
    x: d.bounds.x + d.bounds.width - TAILLE,
    y: d.bounds.y + d.bounds.height - TAILLE,
    width: TAILLE,
    height: TAILLE,
  }
}

/** Crée la fenêtre clavier sur l'écran d'annotation. Une seule pour toute l'application. */
export function creerFenetreClavier(display: Display, o: ClavierOptions): BrowserWindow | null {
  options = o
  if (fenetre && !fenetre.isDestroyed()) {
    deplacerClavier(display)
    return fenetre
  }
  try {
    const win = new BrowserWindow({
      ...boundsClavier(display),
      // OPAQUE, et c'est tout l'intérêt : une fenêtre opaque n'a pas de cadre
      // DWM étendu, WM_NCACTIVATE ne lui fait rien.
      transparent: false,
      frame: false,
      backgroundColor: '#000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,
      show: false,
      alwaysOnTop: true,
      roundedCorners: false,
      thickFrame: false,
      // Sous Windows, « toolbar » = WS_EX_TOOLWINDOW : absente de l'Alt+Tab.
      // Un overlay dans l'Alt+Tab fait perdre des parties (§12.2).
      ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
      title: 'Hexa Clavier',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
        backgroundThrottling: false,
      },
    })
    win.setMenuBarVisibility(false)
    win.on('page-title-updated', (e) => e.preventDefault())
    // Jamais dans une capture, jamais sous la souris.
    try {
      win.setContentProtection(true)
    } catch {
      /* plateforme sans protection : 2 pixels noirs, sans conséquence */
    }
    win.setIgnoreMouseEvents(true)
    // TOUTES les touches sont rejouées dans la page cible, et aucune n'est
    // laissée à cette page-ci ni à Chromium (F11, Ctrl+P, Ctrl+F…).
    win.webContents.on('before-input-event', (e, input) => {
      e.preventDefault()
      const wc = options?.cible() ?? null
      if (wc) relayerTouche(wc, input)
    })
    win.on('blur', () => options?.surPerte())
    win.on('closed', () => {
      if (fenetre === win) fenetre = null
    })
    void win.loadURL(PAGE).catch((err) => logError('clavier', 'page clavier impossible', err))
    win.showInactive()
    fenetre = win
    log('clavier', `fenêtre clavier créée sur l’écran ${display.id}`)
    return win
  } catch (err) {
    logError('clavier', 'création de la fenêtre clavier impossible', err)
    return null
  }
}

/** La fenêtre suit l'écran d'annotation (désignation, topologie, échelle). */
export function deplacerClavier(display: Display): void {
  if (!fenetre || fenetre.isDestroyed()) return
  try {
    const cible = boundsClavier(display)
    const actuel = fenetre.getBounds()
    if (actuel.x === cible.x && actuel.y === cible.y) return
    fenetre.setBounds(cible)
  } catch (err) {
    logError('clavier', 'déplacement de la fenêtre clavier impossible', err)
  }
}

export function fenetreClavier(): BrowserWindow | null {
  return fenetre && !fenetre.isDestroyed() ? fenetre : null
}

/**
 * Prend le clavier. Renvoie `true` si la demande a pu être faite — Windows
 * peut encore la refuser (jeu en plein écran exclusif : voir la sonde).
 */
export function focusClavier(): boolean {
  if (!fenetre || fenetre.isDestroyed()) return false
  const win = fenetre
  try {
    if (!win.isVisible()) win.showInactive()
    if (win.isFocused()) return true
    /*
     * `app.focus({ steal: true })` D'ABORD, et c'est décisif sous Windows :
     * le système n'autorise le passage au premier plan qu'au processus qui
     * détient déjà le premier plan ou qui vient de recevoir une entrée. Hexa,
     * lui, se réveille sur un raccourci global pendant qu'un jeu est devant.
     * Sans ce vol assumé, `focus()` échouait en silence : les touches du
     * joueur restaient dans son jeu, et AUCUN raccourci local d'Hexa (Tab, les
     * lettres) ne répondait — seuls les raccourcis réservés au système
     * marchaient encore.
     */
    if (process.platform === 'win32') {
      try {
        app.focus({ steal: true })
      } catch {
        /* plateforme sans vol de focus : on tente quand même la fenêtre */
      }
    }
    win.focus()
    // On VÉRIFIE, et on réessaie une fois : Windows accorde parfois le premier
    // plan à la seconde demande, juste après l'affichage de la fenêtre.
    setTimeout(() => {
      try {
        if (win.isDestroyed() || win.isFocused()) return
        log('clavier', 'clavier non obtenu du premier coup — seconde tentative')
        win.showInactive()
        if (process.platform === 'win32') app.focus({ steal: true })
        win.focus()
        setTimeout(() => {
          if (win.isDestroyed()) return
          if (!win.isFocused()) {
            logError(
              'clavier',
              'CLAVIER REFUSÉ PAR LE SYSTÈME : les raccourcis locaux (Tab, lettres) ne ' +
                'répondront pas. Cause la plus probable : jeu en plein écran exclusif.',
              null,
            )
          } else {
            log('clavier', 'clavier obtenu à la seconde tentative')
          }
        }, 260)
      } catch (err) {
        logError('clavier', 'seconde prise du clavier impossible', err)
      }
    }, 180)
    return true
  } catch (err) {
    logError('clavier', 'prise du clavier impossible', err)
    return false
  }
}

/** Rend le clavier au jeu (fin du mode dessin, panneau refermé, veille). */
export function relacherClavier(): void {
  if (!fenetre || fenetre.isDestroyed()) return
  try {
    if (fenetre.isFocused()) fenetre.blur()
  } catch (err) {
    logError('clavier', 'relâchement du clavier impossible', err)
  }
}

export function detruireClavier(): void {
  const f = fenetre
  fenetre = null
  premiereRelayee = false
  options = null
  if (!f || f.isDestroyed()) return
  try {
    f.destroy()
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Relais des touches par le protocole DevTools
 * ------------------------------------------------------------------ */

function attacher(wc: WebContents, etiquette: string): boolean {
  if (wc.isDestroyed()) return false
  if (wc.debugger.isAttached()) return true
  try {
    wc.debugger.attach('1.3')
    return true
  } catch (err) {
    logError('clavier', `protocole DevTools inaccessible (${etiquette})`, err)
    return false
  }
}

/**
 * La page se croit au premier plan, en permanence : champs qui gardent leur
 * focus, caret visible, événements focus/blur cohérents — alors que sa fenêtre
 * ne sera jamais activée par le système.
 */
export function emulerFocus(wc: WebContents, etiquette: string): void {
  if (!attacher(wc, etiquette)) return
  void wc.debugger
    .sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    .then(() => log('clavier', `focus émulé (${etiquette})`))
    .catch((err: unknown) => logError('clavier', `émulation du focus impossible (${etiquette})`, err))
}

/**
 * ⚠️ L'ÉMULATION NE SURVIT PAS À UNE NAVIGATION, et c'est un piège complet :
 * une page rechargée reçoit toujours les touches du relais, mais elles n'ont
 * PLUS AUCUN EFFET — clavier muet, sans un message, sans une erreur. Mesuré
 * (§S27) : « o » puis Tab agissent, la page se recharge, les deux mêmes
 * touches ne font plus rien du tout.
 *
 * Or la page se recharge pour de vrai : au changement d'écran, après une
 * panne du renderer, à chaque relance d'une couche. On réarme donc à CHAQUE
 * chargement, une ligne de journal à l'appui.
 */
export function suivreFocus(wc: WebContents, etiquette: string): void {
  emulerFocus(wc, etiquette)
  wc.on('did-finish-load', () => emulerFocus(wc, `${etiquette} · rechargée`))
}

/** Codes de touches virtuelles Windows, attendus par le protocole pour `keyCode`. */
const VK: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  NumpadEnter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  PrintScreen: 44,
  Insert: 45,
  Delete: 46,
  MetaLeft: 91,
  MetaRight: 92,
  ContextMenu: 93,
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDecimal: 110,
  NumpadDivide: 111,
  NumLock: 144,
  ScrollLock: 145,
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
  IntlBackslash: 226,
}

function codeVersVk(code: string, key: string): number {
  if (VK[code] != null) return VK[code]
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1].charCodeAt(0)
  m = /^Digit([0-9])$/.exec(code)
  if (m) return 48 + Number(m[1])
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return 96 + Number(m[1])
  m = /^F([0-9]{1,2})$/.exec(code)
  if (m) return 111 + Number(m[1])
  if (key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0)
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) return c
  }
  return 0
}

/**
 * Le texte que la touche tape, ou rien. Ctrl seul ou Alt seul = raccourci,
 * pas une lettre ; les deux ensemble, c'est AltGr (@, #, {…) : on garde.
 */
function texteDe(input: Input): string {
  if (input.key === 'Enter') return '\r'
  if (input.key.length !== 1) return ''
  if (input.meta) return ''
  if (input.control !== input.alt) return ''
  return input.key
}

/** Rejoue une touche de la fenêtre clavier dans la page cible. */
export function relayerTouche(wc: WebContents, input: Input): void {
  if (input.type !== 'keyDown' && input.type !== 'keyUp') return
  if (!attacher(wc, 'relais')) return
  const modifiers = (input.alt ? 1 : 0) | (input.control ? 2 : 0) | (input.meta ? 4 : 0) | (input.shift ? 8 : 0)
  const vk = codeVersVk(input.code, input.key)
  const location = typeof input.location === 'number' ? input.location : 0
  const base = {
    key: input.key,
    code: input.code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
    location,
    autoRepeat: input.isAutoRepeat === true,
    isKeypad: location === 3,
  }
  let params: Record<string, unknown>
  if (input.type === 'keyDown') {
    const texte = texteDe(input)
    params = texte ? { type: 'keyDown', text: texte, unmodifiedText: texte, ...base } : { type: 'rawKeyDown', ...base }
  } else {
    params = { type: 'keyUp', ...base }
  }
  // Une ligne de journal à la PREMIÈRE touche relayée, et plus jamais : elle
  // suffit à dire « le relais fonctionne » dans un rapport d'utilisateur, sans
  // écrire un fichier de journal à chaque frappe.
  if (!premiereRelayee) {
    premiereRelayee = true
    log('clavier', `première touche relayée (${input.key}) vers ${wc.getURL().split('/').pop()}`)
  }
  void wc.debugger
    .sendCommand('Input.dispatchKeyEvent', params)
    .catch((err: unknown) => logError('clavier', `touche non relayée (${input.type} ${input.key})`, err))
}
