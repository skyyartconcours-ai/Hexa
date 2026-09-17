/**
 * Hexa — raccourcis GLOBAUX (hors focus).
 *
 * On annote PAR-DESSUS un jeu : un raccourci qui n'agit que lorsque la fenêtre
 * d'Hexa a le focus ne sert à rien. Ce module est la courroie entre la table
 * centralisée (src/keymap.ts) et Electron :
 *
 *  1. il calcule les accélérateurs à confisquer au système ;
 *  2. il les pousse au processus principal via IPC 'hexa:set-shortcuts' à
 *     CHAQUE changement — jamais de « redémarre l'application » ;
 *  3. il exécute les actions renvoyées par le processus principal quand la
 *     touche a été pressée alors que le jeu avait le focus ;
 *  4. il publie l'état d'enregistrement (réussi / refusé par Windows) pour que
 *     l'éditeur de raccourcis puisse le dire à l'utilisateur.
 *
 * Zéro boucle, zéro minuterie : tout est événementiel.
 */
import { useEffect, useRef } from 'react'
import { bridge, isElectron } from './bridge'
import { porteEncre } from './couches'
import type { ToolId } from './engine/types'
import { KNOWN_TOOLS, useUiStore } from './store'
import {
  globalAcceleratorChains,
  resolveKeymap,
  type KeymapAction,
  type KeymapPresetId,
} from './keymap'

/** Le minimum vital : on doit TOUJOURS pouvoir entrer/sortir et tout effacer. */
const ALWAYS_GLOBAL: KeymapAction[] = ['mode.draw', 'app.panic']

/** Surface du moteur utilisée par les raccourcis (évite de le coupler ici). */
export interface ShortcutEngine {
  undo(): void
  redo(): void
  clear(): void
}

export interface GlobalShortcutStatus {
  /** false en démo navigateur : aucun raccourci système possible */
  supported: boolean
  /** accélérateurs réellement pris par le système */
  registered: Partial<Record<KeymapAction, string>>
  /** refusés par Windows (déjà pris par un autre logiciel) */
  failed: Partial<Record<KeymapAction, string>>
}

/* ------------------------------------------------------------------ *
 * État publié (l'éditeur s'y abonne, il ne sonde jamais)
 * ------------------------------------------------------------------ */

let status: GlobalShortcutStatus = { supported: isElectron, registered: {}, failed: {} }
const listeners = new Set<() => void>()

/** Instantané stable : la même référence tant que rien n'a changé. */
export function getGlobalShortcutStatus(): GlobalShortcutStatus {
  return status
}

export function subscribeGlobalShortcuts(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function publish(next: GlobalShortcutStatus): void {
  // lisible par les campagnes de tests, comme window.hexaEngine
  ;(window as unknown as { __hexaRaccourcis?: GlobalShortcutStatus }).__hexaRaccourcis = next
  status = next
  for (const cb of listeners) cb()
}

/* ------------------------------------------------------------------ *
 * Anti double-exécution
 * ------------------------------------------------------------------ */

/**
 * Selon la façon dont Windows livre une touche confisquée, la page peut, elle
 * aussi, recevoir le keydown. Sans garde, Ctrl+E effacerait deux fois (sans
 * conséquence) mais Ctrl+H afficherait puis masquerait la barre — donc rien.
 *
 * Chaque exécution « réclame » l'action : la seconde source qui se présente
 * dans la foulée est ignorée. Deux appuis successifs venus de la MÊME source
 * (l'utilisateur qui martèle sa touche) passent normalement.
 */
type ActionSource = 'system' | 'page'
const claims = new Map<KeymapAction, { at: number; source: ActionSource }>()
const ECHO_MS = 400

export function claimAction(action: KeymapAction, source: ActionSource): boolean {
  const last = claims.get(action)
  if (last && last.source !== source && Date.now() - last.at < ECHO_MS) return false
  claims.set(action, { at: Date.now(), source })
  return true
}

/** Le système a-t-il bien pris cette action en charge ? (sinon : repli local) */
export function isRegisteredGlobally(action: KeymapAction): boolean {
  return status.registered[action] != null
}

/* ------------------------------------------------------------------ *
 * Exécution d'une action arrivée du processus principal
 * ------------------------------------------------------------------ */

/**
 * L'outil d'une action « tool.X », DÉDUIT du nom de l'action.
 *
 * ⚠️ C'était une table écrite à la main, et elle a fini par mentir. Le
 * numéroteur est devenu global (Ctrl+Maj+1) : Windows nous livrait bien la
 * touche, le processus principal la routait bien vers la page… qui n'en
 * faisait RIEN, parce que 'tool.badge' manquait dans la table. Pire qu'un
 * raccourci absent : un raccourci affiché, réservé auprès de Windows — donc
 * volé à tous les autres logiciels — et mort. Le nom de l'action porte déjà
 * l'outil ; on le lit, et on le valide contre les outils que le moteur
 * connaît. Aucune liste à tenir à jour, donc plus rien à oublier.
 */
function outilDeAction(action: KeymapAction): ToolId | null {
  if (!action.startsWith('tool.')) return null
  const id = action.slice('tool.'.length)
  return KNOWN_TOOLS.has(id) ? (id as ToolId) : null
}

/**
 * Applique une action déclenchée hors focus. Volontairement limité aux actions
 * marquées globales : le reste du clavier vit dans la page (src/App.tsx).
 */
export function runGlobalAction(action: KeymapAction, engine: ShortcutEngine | null): void {
  const st = useUiStore.getState()
  const tool = outilDeAction(action)
  if (tool) {
    st.setTool(tool)
    return
  }
  switch (action) {
    case 'edit.undo':
      engine?.undo()
      break
    case 'edit.redo':
      engine?.redo()
      break
    case 'edit.clear':
      engine?.clear()
      break
    case 'size.dec':
      st.setSize(Math.max(2, st.size - 2))
      break
    case 'size.inc':
      st.setSize(Math.min(18, st.size + 2))
      break
    case 'ui.toolbar':
      st.toggleToolbar()
      break
    // Masquer/remontrer les annotations : global lui aussi, et lui aussi
    // oublié ici — il n'existait que dans le clavier local (src/App.tsx).
    case 'ui.hideInk':
      st.toggleAnnotationsHidden()
      break
    case 'ui.cheatsheet':
      st.setCheatsheetOpen(!st.cheatsheetOpen)
      break
    default:
      // 'mode.draw' et 'mode.cursor' sont traités par le processus principal :
      // ils touchent la FENÊTRE (clic traversant), pas la page.
      break
  }
}

/* ------------------------------------------------------------------ *
 * Le hook : une seule ligne à poser dans App.tsx
 * ------------------------------------------------------------------ */

export interface UseGlobalShortcutsOptions {
  preset: KeymapPresetId
  overrides: Partial<Record<KeymapAction, string | string[] | null>>
  /** false = on ne confisque plus rien au système, sauf le minimum vital */
  enabled: boolean
  /** accès paresseux au moteur (il naît après le premier rendu) */
  engine: () => ShortcutEngine | null
}

/**
 * Réponse du processus principal, volontairement tolérante.
 *
 * La SOURCE DE VÉRITÉ est `accelerators` : la table réellement en vigueur côté
 * système, et `souhaites` : ce qu'on aurait voulu (la première combinaison de
 * chaque chaîne). Elles peuvent différer — quand Windows refuse une
 * combinaison, le processus principal tente la suivante (Ctrl+Alt+1 pour le
 * numéroteur, F8 pour le mode dessin). Recopier la combinaison DEMANDÉE
 * reviendrait à certifier « réservé auprès de Windows » pour une touche
 * morte, et l'utilisateur martèlerait sa combinaison toute la soirée devant
 * son chat. `failed` porte donc la combinaison VOULUE dès qu'elle n'est pas
 * celle en vigueur ; `registered` porte ce qui répond vraiment.
 */
function readResult(value: unknown): GlobalShortcutStatus {
  const registered: Partial<Record<KeymapAction, string>> = {}
  const failed: Partial<Record<KeymapAction, string>> = {}
  const v = (value ?? {}) as { accelerators?: Record<string, unknown>; souhaites?: Record<string, unknown> }
  const reels = v.accelerators ?? {}
  const souhaites = v.souhaites ?? {}
  for (const [action, voulu] of Object.entries(souhaites) as [KeymapAction, unknown][]) {
    if (typeof voulu !== 'string' || voulu.length === 0) continue
    const brut = reels[action]
    const reel = typeof brut === 'string' && brut.length > 0 ? brut : ''
    if (reel) registered[action] = reel
    if (reel !== voulu) failed[action] = voulu
  }
  return { supported: true, registered, failed }
}

export function useGlobalShortcuts(options: UseGlobalShortcutsOptions): void {
  const { preset, overrides, enabled } = options
  const engineRef = useRef(options.engine)
  engineRef.current = options.engine

  // (1) exécution des actions poussées par le processus principal
  useEffect(() => {
    if (!isElectron) return
    // §S11 : SEULE la couche encre exécute. Deux fenêtres par écran qui
    // joueraient la même action doubleraient tout ce qui est relatif —
    // « épaisseur + 2 » deviendrait « + 4 », le fondu sauterait un cran.
    if (!porteEncre) return
    return bridge.on('action', (action) => {
      const a = action as KeymapAction
      // La SECONDE moitié de la trace : le processus principal note qu'il a
      // reçu la touche du système ; la page note ce qu'elle en fait. Entre les
      // deux lignes de hexa.log, plus aucun « ça ne marche pas » n'est deviné.
      if (!claimAction(a, 'system')) {
        bridge.log('raccourcis', `action système ignorée (déjà jouée par la page) : ${a}`)
        return
      }
      runGlobalAction(a, engineRef.current())
      bridge.log('raccourcis', `action système jouée : ${a} → outil ${useUiStore.getState().tool}`)
    })
  }, [])

  // (3) L'ÉTAT RÉEL DES RÉSERVATIONS, poussé par le processus principal — à
  // chaque enregistrement et quand une combinaison refusée se libère. Dans
  // TOUTES les fenêtres : l'éditeur de raccourcis vit dans la fenêtre
  // d'interface, qui n'enregistre rien elle-même et ne savait donc jamais ce
  // que Windows avait vraiment accordé.
  useEffect(() => {
    if (!isElectron) return
    return bridge.on('raccourcis-status', (value) => publish(readResult(value)))
  }, [])

  // (2) (ré)enregistrement système à chaque changement de clavier
  useEffect(() => {
    if (!isElectron) return
    // Une seule fenêtre pilote les raccourcis : sinon chaque écran réécrirait
    // la même table à la suite des autres. Et parmi les deux couches d'un même
    // écran (§S11), c'est l'encre qui parle — celle qui tient le moteur.
    if (bridge.display && !bridge.display.primary) return
    if (!porteEncre) return

    const bindings = resolveKeymap(preset, overrides)
    const all = globalAcceleratorChains(bindings)
    const asked: Partial<Record<KeymapAction, string[]>> = enabled
      ? all
      : Object.fromEntries(
          ALWAYS_GLOBAL.filter((a) => all[a]).map((a) => [a, all[a] as string[]]),
        )

    let alive = true
    void bridge.setShortcuts(asked).then((value) => {
      if (alive) publish(readResult(value))
    })
    return () => {
      alive = false
    }
  }, [preset, overrides, enabled])
}
