/**
 * Hexa — garde-fou Windows.
 *
 * C'est ICI que meurent les outils d'overlay. Pas dans le dessin : dans les
 * dix secondes qui suivent un écran branché, une échelle passée à 125 %, une
 * mise en veille, un verrouillage de session ou un jeu lancé en plein écran.
 * Le symptôme est toujours le même côté utilisateur : « ça marchait, et
 * maintenant je ne vois plus rien » — ou pire, un grand rectangle noir.
 *
 * Ce module ne contient AUCUNE politique : il observe le système, filtre le
 * bruit et rappelle le processus principal au bon moment. Aucune boucle,
 * aucun `setInterval` : uniquement des `setTimeout` armés par un événement
 * système et éteints juste après (§2.5 — au repos, 0 % de processeur).
 */
import { powerMonitor, screen, type BrowserWindow, type Display, type Rectangle } from 'electron'
import { log, logError } from './logger'

/* ------------------------------------------------------------------ *
 * Pose des bounds — le piège n°1 sous Windows
 * ------------------------------------------------------------------ */

export function sameBounds(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Repose une fenêtre exactement sur son écran.
 *
 * Deux pièges Windows, tous deux vécus par tous les overlays :
 *
 * 1. `resizable: false` (notre cas : personne ne doit pouvoir attraper un bord
 *    de l'overlay) fige aussi les contraintes de taille côté Chromium sous
 *    Windows — `setBounds` est alors partiellement ignoré et la fenêtre garde
 *    l'ancienne dimension. La parade connue et sans effet de bord visible :
 *    rendre la fenêtre redimensionnable le temps de l'appel, puis la refiger.
 *
 * 2. Quand le facteur d'échelle de l'écran change, Windows envoie
 *    `WM_DPICHANGED` avec un rectangle « suggéré » et redimensionne la fenêtre
 *    APRÈS nous. Notre pose est donc écrasée. On relit `getBounds()` et, si le
 *    compte n'y est pas, on repose une fois — une seule, jamais en boucle.
 *
 * D'où trois essais au maximum, du moins invasif au plus : pose simple, pose
 * avec dégel du style, pose différée de 260 ms. On s'arrête au premier qui
 * prend, et on n'insiste jamais au-delà.
 *
 * Renvoie `true` si les bounds sont conformes immédiatement après la pose.
 */
export function applyBounds(win: BrowserWindow, bounds: Rectangle, etiquette: string): boolean {
  try {
    if (win.isDestroyed()) return false
    if (sameBounds(win.getBounds(), bounds)) return true
    // Chemin normal d'abord : dans l'immense majorité des cas il suffit, et il
    // ne touche à aucun style de fenêtre.
    win.setBounds(bounds)
    if (sameBounds(win.getBounds(), bounds)) return true
    // ⚠️ PLUS JAMAIS `setResizable(true)` ICI. C'était le contournement d'un
    // refus supposé des fenêtres non redimensionnables ; or `setBounds` pose
    // lui-même les contraintes de taille sur ces fenêtres (Electron,
    // native_window_views.cc), et surtout, rendre redimensionnable une fenêtre
    // TRANSPARENTE lui ajoute WS_THICKFRAME à partir d'Electron 39 — un style
    // incompatible avec les fenêtres translucides, qui détruit leur
    // transparence pour de bon (electron/electron#51175). Un refus réel, lui,
    // ne vient que de Windows (WM_DPICHANGED) : on repose après coup.
    const obtenu = win.getBounds()
    log('écrans', `pose des bounds refusée par le système (${etiquette}) — essai différé`, {
      demande: `${bounds.width}×${bounds.height} @${bounds.x},${bounds.y}`,
      obtenu: `${obtenu.width}×${obtenu.height} @${obtenu.x},${obtenu.y}`,
    })
    // Deuxième passe différée : le temps que Windows ait fini son WM_DPICHANGED.
    const t = setTimeout(() => {
      retards.delete(t)
      try {
        if (win.isDestroyed() || sameBounds(win.getBounds(), bounds)) return
        win.setBounds(bounds)
        log('écrans', `bounds reposées après coup (${etiquette})`)
      } catch (err) {
        logError('écrans', `seconde pose impossible (${etiquette})`, err)
      }
    }, 260)
    retards.add(t)
    return false
  } catch (err) {
    logError('écrans', `pose des bounds impossible (${etiquette})`, err)
    return false
  }
}

/** Minuteries différées en attente : toutes éteintes à la fermeture. */
const retards = new Set<NodeJS.Timeout>()

/**
 * Réaffirme le niveau « toujours au-dessus ».
 *
 * Pourquoi `screen-saver` et pas `floating` : sous Windows, tous les niveaux
 * au-dessus de `normal` deviennent `HWND_TOPMOST`, mais l'ordre entre deux
 * fenêtres topmost est celui de la DERNIÈRE qui l'a demandé. Discord, Steam,
 * GeForce Experience et les infobulles de Windows se réinsèrent au-dessus de
 * nous en cours de session : réaffirmer nous remet devant. `screen-saver` est
 * en plus le seul niveau qui, sur macOS, passe au-dessus du Dock et du plein
 * écran — un seul appel couvre les deux plateformes.
 *
 * `setVisibleOnAllWorkspaces(visibleOnFullScreen)` est le pendant macOS : sans
 * lui, l'overlay disparaît dès qu'une application passe en plein écran natif.
 */
export function reassertTopmost(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch (err) {
    logError('fenêtre', 'niveau « toujours au-dessus » non réaffirmé', err)
  }
}

/* ------------------------------------------------------------------ *
 * Surveillance des écrans
 * ------------------------------------------------------------------ */

export interface DisplayWatchHandlers {
  /** la topologie a réellement changé : reconstruire / repositionner */
  onTopologie(raison: string): void
}

/** Débounce : Windows émet ces événements EN RAFALE (voir plus bas). */
const DISPLAY_DEBOUNCE_MS = 180
/**
 * Passe de contrôle après coup : brancher un écran ou changer la résolution
 * met Windows plusieurs centaines de millisecondes à se stabiliser (ré-
 * énumération des moniteurs, WM_DPICHANGED, réarrangement des fenêtres). Une
 * unique vérification différée rattrape ce que la première passe a manqué.
 */
const DISPLAY_SETTLE_MS = 900

let displayTimer: NodeJS.Timeout | null = null
let settleTimer: NodeJS.Timeout | null = null
let raisons = new Set<string>()

/** Écouteurs posés sur `screen`, gardés pour être retirés à la fermeture. */
const screenHandlers: Array<{ event: string; fn: (...args: never[]) => void }> = []

function planifier(raison: string, handlers: DisplayWatchHandlers): void {
  raisons.add(raison)
  if (displayTimer) clearTimeout(displayTimer)
  displayTimer = setTimeout(() => {
    displayTimer = null
    const motif = [...raisons].join(', ')
    raisons = new Set()
    handlers.onTopologie(motif)
    // Une seule passe de rattrapage, jamais réarmée : pas de boucle.
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      handlers.onTopologie(`${motif} (vérification différée)`)
    }, DISPLAY_SETTLE_MS)
  }, DISPLAY_DEBOUNCE_MS)
}

/**
 * Branche la surveillance des écrans.
 *
 * Le filtrage est la partie utile. `display-metrics-changed` est émis par
 * Windows pour un rien : barre des tâches qui s'auto-masque, notification qui
 * apparaît, jeu qui passe en plein écran — tout cela ne touche QUE `workArea`.
 * Or nos overlays sont posés sur `bounds` (l'écran entier, barre des tâches
 * comprise) : y réagir reposerait les fenêtres en pleine partie, avec le
 * clignotement et la perte de l'ordre topmost que ça implique. On ignore donc
 * les changements qui ne concernent que `workArea`.
 */
export function watchDisplays(handlers: DisplayWatchHandlers): void {
  const ajoute = (d: Display) => {
    log('écrans', `écran branché : ${d.id}`, {
      taille: `${d.bounds.width}×${d.bounds.height}`,
      echelle: d.scaleFactor,
    })
    planifier(`écran ${d.id} branché`, handlers)
  }
  const retire = (d: Display) => {
    log('écrans', `écran débranché : ${d.id}`)
    planifier(`écran ${d.id} débranché`, handlers)
  }
  const metrics = (d: Display, changed: string[]) => {
    const utiles = changed.filter((m) => m !== 'workArea')
    if (utiles.length === 0) {
      // Signal précieux malgré tout : sous Windows, `workArea` qui devient égal
      // à `bounds` trahit une application qui occupe tout l'écran.
      return
    }
    log('écrans', `écran ${d.id} reconfiguré : ${utiles.join(', ')}`, {
      taille: `${d.bounds.width}×${d.bounds.height}`,
      echelle: d.scaleFactor,
      rotation: d.rotation,
    })
    planifier(`écran ${d.id} : ${utiles.join('+')}`, handlers)
  }

  screen.on('display-added', (_e, d) => ajoute(d))
  screen.on('display-removed', (_e, d) => retire(d))
  screen.on('display-metrics-changed', (_e, d, changed) => metrics(d, changed))
  screenHandlers.push(
    { event: 'display-added', fn: ajoute as never },
    { event: 'display-removed', fn: retire as never },
    { event: 'display-metrics-changed', fn: metrics as never },
  )
}

/* ------------------------------------------------------------------ *
 * Veille, verrouillage, changement d'utilisateur
 * ------------------------------------------------------------------ */

export interface PowerWatchHandlers {
  /** l'ordinateur s'endort ou la session part : tout rentrer, tout de suite */
  onEclipse(raison: string): void
  /** l'ordinateur revient : tout remettre d'aplomb (écrans, niveau, raccourcis) */
  onRetour(raison: string): void
}

const powerHandlers: Array<{ event: string; fn: () => void }> = []
let sessionEnding = false

/**
 * Branche la surveillance de l'alimentation et de la session.
 *
 * Pourquoi tout cacher à l'endormissement plutôt que « laisser faire » :
 * une fenêtre transparente plein écran possède une surface de composition
 * (Direct3D) que Windows peut PERDRE pendant la veille ou un changement
 * d'utilisateur. Au retour, Chromium se retrouve avec une surface invalide et
 * la repeint en noir opaque : c'est le fameux « grand rectangle noir au
 * réveil », impossible à fermer puisque l'overlay est en clic traversant.
 * Une fenêtre CACHÉE n'a pas de surface à perdre — on la rend au réveil, une
 * fois les écrans ré-énumérés.
 *
 * `lock-screen` couvre aussi le changement d'utilisateur sous Windows : la
 * session est basculée sur le bureau sécurisé, qui n'accepte aucun overlay.
 */
export function watchPower(handlers: PowerWatchHandlers): void {
  const brancher = (event: string, fn: () => void) => {
    try {
      powerMonitor.on(event as 'suspend', fn)
      powerHandlers.push({ event, fn })
    } catch (err) {
      // powerMonitor n'existe pas sur tous les bureaux Linux : ce n'est pas une
      // panne, juste une fonctionnalité en moins.
      logError('veille', `événement « ${event} » indisponible`, err)
    }
  }

  brancher('suspend', () => {
    log('veille', 'mise en veille du système')
    handlers.onEclipse('veille')
  })
  brancher('resume', () => {
    log('veille', 'réveil du système')
    handlers.onRetour('réveil')
  })
  brancher('lock-screen', () => {
    log('veille', 'session verrouillée')
    handlers.onEclipse('verrouillage')
  })
  brancher('unlock-screen', () => {
    log('veille', 'session déverrouillée')
    handlers.onRetour('déverrouillage')
  })

}

/**
 * Fin de session Windows : arrêt, redémarrage, déconnexion, changement
 * d'utilisateur. À partir d'Electron 30, l'événement est porté par les FENÊTRES
 * (`BaseWindow`), plus par `app` — d'où cet appel séparé, fait à la création de
 * chaque overlay. Il ne coûte rien : l'écouteur meurt avec la fenêtre.
 *
 * Ce qu'on en fait : rentrer les overlays immédiatement. Sans ça, Windows
 * détruit nos surfaces graphiques pendant qu'elles sont encore composées, ce
 * qui laisse un aplat noir sur l'écran d'arrêt — et surtout, une fenêtre qui
 * traîne peut faire apparaître « une application empêche l'arrêt ».
 */
export function watchSessionEnd(win: BrowserWindow, onEnd: () => void): void {
  if (process.platform !== 'win32') return
  try {
    win.on('session-end', () => {
      if (sessionEnding) return
      sessionEnding = true
      log('cycle', 'fin de session Windows (arrêt, redémarrage ou déconnexion)')
      onEnd()
    })
  } catch (err) {
    logError('cycle', 'surveillance de la fin de session impossible', err)
  }
}

/* ------------------------------------------------------------------ *
 * Jeu en plein écran EXCLUSIF
 * ------------------------------------------------------------------ */

let fullscreenTimer: NodeJS.Timeout | null = null
let dejaSignale = false

/**
 * Le premier plan nous a-t-il été refusé au moins une fois ?
 *
 * C'est la signature du PLEIN ÉCRAN EXCLUSIF : le jeu possède la sortie vidéo,
 * Windows ne compose plus le bureau, et AUCUN logiciel ne peut dessiner
 * par-dessus. L'auto-diagnostic des raccourcis s'en sert pour distinguer les
 * deux causes possibles de « rien ne se passe quand j'appuie en jeu ».
 */
export function premierPlanRefuse(): boolean {
  return dejaSignale
}

/**
 * Détecte le cas d'assistance n°1 : « je vois pas Hexa quand je joue ».
 *
 * En plein écran EXCLUSIF, le jeu possède la sortie vidéo : Windows ne compose
 * plus le bureau, et AUCUN overlay (ni Hexa, ni Epic Pen, ni Discord sans
 * injection) ne peut s'afficher par-dessus. La solution est côté jeu : passer
 * en « plein écran fenêtré » / « sans bordure » — dans League of Legends,
 * Options → Vidéo → Mode d'affichage.
 *
 * Signal utilisé : on vient d'entrer en mode dessin, donc on a explicitement
 * demandé le focus à Windows. Si, une demi-seconde plus tard, la fenêtre est
 * visible mais TOUJOURS pas focus, c'est qu'une application refuse de rendre
 * le premier plan — la signature du plein écran exclusif. On ne le dit qu'une
 * fois par session, et jamais ailleurs que sous Windows (sous X11/Xvfb, une
 * fenêtre non focusable n'obtient de toute façon jamais le focus, la sonde
 * n'aurait aucun sens).
 */
export function probeExclusiveFullscreen(win: BrowserWindow, onBlocked: () => void): void {
  if (process.platform !== 'win32' || dejaSignale) return
  if (fullscreenTimer) clearTimeout(fullscreenTimer)
  const perdu = (): boolean => !win.isDestroyed() && win.isVisible() && !win.isFocused()
  // DEUX mesures espacées avant d'accuser qui que ce soit. Une seule suffirait à
  // se tromper : sur une machine chargée, Windows met parfois un instant à
  // donner le premier plan, et l'utilisateur peut très bien avoir cliqué
  // ailleurs entre-temps. Deux échecs d'affilée, c'est un refus, pas un retard.
  fullscreenTimer = setTimeout(() => {
    fullscreenTimer = null
    try {
      if (!perdu()) return
      fullscreenTimer = setTimeout(() => {
        fullscreenTimer = null
        try {
          if (!perdu() || dejaSignale) return
          dejaSignale = true
          log('fenêtre', 'premier plan refusé deux fois : jeu probablement en plein écran exclusif')
          onBlocked()
        } catch (err) {
          logError('fenêtre', 'sonde plein écran impossible', err)
        }
      }, 700)
    } catch (err) {
      logError('fenêtre', 'sonde plein écran impossible', err)
    }
  }, 500)
}

/* ------------------------------------------------------------------ *
 * Fermeture
 * ------------------------------------------------------------------ */

/**
 * Rend TOUT au système : écouteurs d'écrans, écouteurs d'alimentation,
 * minuteries différées. Sans ça, un `app.quit()` peut laisser un processus
 * vivant dans le gestionnaire des tâches — un overlay fantôme qui garde ses
 * raccourcis globaux confisqués est le pire héritage possible.
 */
export function stopWindowsGuard(): void {
  for (const { event, fn } of screenHandlers) {
    try {
      screen.removeListener(event as 'display-added', fn as never)
    } catch {
      /* ignore */
    }
  }
  screenHandlers.length = 0
  for (const { event, fn } of powerHandlers) {
    try {
      powerMonitor.removeListener(event as 'suspend', fn)
    } catch {
      /* ignore */
    }
  }
  powerHandlers.length = 0
  // `session-end` est branché sur les fenêtres : son écouteur meurt avec elles,
  // il n'y a rien à retirer ici — seulement le drapeau à rendre neutre.
  sessionEnding = false
  if (displayTimer) {
    clearTimeout(displayTimer)
    displayTimer = null
  }
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
  if (fullscreenTimer) {
    clearTimeout(fullscreenTimer)
    fullscreenTimer = null
  }
  for (const t of retards) clearTimeout(t)
  retards.clear()
  raisons = new Set()
}
