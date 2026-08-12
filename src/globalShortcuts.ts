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
import { useUiStore } from './store'
import {
  globalAccelerators,
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

const TOOL_OF_ACTION: Partial<Record<KeymapAction, 'pen' | 'highlight' | 'eraser'>> = {
  'tool.pen': 'pen',
  'tool.highlight': 'highlight',
  'tool.eraser': 'eraser',
}

/**
 * Applique une action déclenchée hors focus. Volontairement limité aux actions
 * marquées globales : le reste du clavier vit dans la page (src/App.tsx).
 */
export function runGlobalAction(action: KeymapAction, engine: ShortcutEngine | null): void {
  const st = useUiStore.getState()
  const tool = TOOL_OF_ACTION[action]
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

/** Réponse du processus principal, volontairement tolérante. */
function readResult(
  value: unknown,
  asked: Partial<Record<KeymapAction, string>>,
): GlobalShortcutStatus {
  const registered: Partial<Record<KeymapAction, string>> = {}
  const failed: Partial<Record<KeymapAction, string>> = {}
  const ok = new Set<string>(
    Array.isArray((value as { registered?: unknown })?.registered)
      ? ((value as { registered: unknown[] }).registered.filter(
          (a) => typeof a === 'string',
        ) as string[])
      : [],
  )
  for (const [action, accel] of Object.entries(asked) as [KeymapAction, string][]) {
    if (ok.has(action)) registered[action] = accel
    else failed[action] = accel
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
    return bridge.on('action', (action) => {
      const a = action as KeymapAction
      if (!claimAction(a, 'system')) return
      runGlobalAction(a, engineRef.current())
    })
  }, [])

  // (2) (ré)enregistrement système à chaque changement de clavier
  useEffect(() => {
    if (!isElectron) return
    // Une seule fenêtre pilote les raccourcis : sinon chaque écran réécrirait
    // la même table à la suite des autres.
    if (bridge.display && !bridge.display.primary) return

    const bindings = resolveKeymap(preset, overrides)
    const all = globalAccelerators(bindings)
    const asked: Partial<Record<KeymapAction, string>> = enabled
      ? all
      : Object.fromEntries(
          ALWAYS_GLOBAL.filter((a) => all[a]).map((a) => [a, all[a] as string]),
        )

    let alive = true
    void bridge.setShortcuts(asked).then((value) => {
      if (alive) publish(readResult(value, asked))
    })
    return () => {
      alive = false
    }
  }, [preset, overrides, enabled])
}
