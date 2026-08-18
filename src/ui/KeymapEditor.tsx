/**
 * Hexa — éditeur de raccourcis clavier.
 *
 * Composant AUTONOME : il n'attend aucune prop, lit et écrit tout dans le store.
 * Il se pose tel quel dans le panneau de réglages :
 *
 *     import { KeymapEditor } from './KeymapEditor'
 *     …
 *     <KeymapEditor />
 *
 * Il gère : bascule de preset (Epic Pen par défaut / Hexa / personnalisé),
 * liste par catégorie, capture d'une nouvelle combinaison au clic, refus des
 * combinaisons dangereuses, détection ET affichage des conflits,
 * réinitialisation ligne par ligne ou en bloc, et l'état réel des raccourcis
 * confisqués au système.
 *
 * Le ré-enregistrement côté Electron est immédiat : il est déclenché par le
 * store, via le hook `useGlobalShortcuts` posé dans App.tsx. Aucun redémarrage,
 * jamais.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  KEYMAP_ENTRIES,
  KEYMAP_PRESETS,
  buildLookup,
  comboFromEvent,
  comboSafety,
  findConflicts,
  formatCombo,
  isNeverGlobal,
  isRegistrableCombo,
  normalizeCombo,
  resolveKeymap,
  setKeyCaptureActive,
  type ComboRisk,
  type KeymapAction,
  type KeymapCategory,
  type KeymapEntry,
} from '../keymap'
import { COLORS, useUiStore } from '../store'
import { getGlobalShortcutStatus, subscribeGlobalShortcuts } from '../globalShortcuts'
import { bridge, isElectron } from '../bridge'
import './keymap-editor.css'

/** Couleur réelle de la palette pour les actions « Couleur N ». */
function swatchOf(action: KeymapAction): string | null {
  const m = /^color\.([1-7])$/.exec(action)
  return m ? (COLORS[parseInt(m[1], 10) - 1] ?? null) : null
}

export function KeymapEditor() {
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)
  const globalShortcutsOn = useUiStore((s) => s.globalShortcutsOn)
  /** Niveau de privilège : lu une fois, il ne change pas en cours de session. */
  const [privileges, setPrivileges] = useState<{ windows: boolean; eleve: boolean } | null>(null)
  useEffect(() => {
    if (!isElectron) return
    let vivant = true
    void bridge.privileges().then((p) => {
      if (vivant) setPrivileges(p)
    })
    return () => {
      vivant = false
    }
  }, [])
  const relancerAdmin = (): void => {
    void bridge.relancerAdmin()
  }
  const setKeymapPreset = useUiStore((s) => s.setKeymapPreset)
  const setBinding = useUiStore((s) => s.setBinding)
  const resetBinding = useUiStore((s) => s.resetBinding)
  const resetAllBindings = useUiStore((s) => s.resetAllBindings)
  const setGlobalShortcuts = useUiStore((s) => s.setGlobalShortcuts)
  const setCheatsheetOpen = useUiStore((s) => s.setCheatsheetOpen)

  const [capturing, setCapturing] = useState<KeymapAction | null>(null)
  /** message affiché quand une combinaison est refusée (Alt+F4, Windows+L…) */
  const [refusal, setRefusal] = useState<string | null>(null)
  /** dernier avertissement non bloquant (F1–F5, Windows+…) */
  const [warning, setWarning] = useState<{ action: KeymapAction; risk: ComboRisk } | null>(null)
  const capturingRef = useRef<KeymapAction | null>(null)
  capturingRef.current = capturing

  // État réel des raccourcis système : poussé par le processus principal après
  // chaque tentative d'enregistrement. On s'abonne, on ne sonde jamais.
  const status = useSyncExternalStore(subscribeGlobalShortcuts, getGlobalShortcutStatus)

  const bindings = useMemo(
    () => resolveKeymap(keymapPreset, keymapOverrides),
    [keymapPreset, keymapOverrides],
  )
  const conflicts = useMemo(() => findConflicts(bindings), [bindings])
  const lookup = useMemo(() => buildLookup(bindings), [bindings])
  const customCount = Object.keys(keymapOverrides).length
  const failedCount = Object.keys(status.failed).length

  const stopCapture = useCallback(() => {
    setCapturing(null)
    setKeyCaptureActive(false)
    setRefusal(null)
  }, [])

  // Capture : on écoute le clavier en phase de capture (capture:true) pour
  // passer AVANT le clavier global de l'application.
  useEffect(() => {
    if (!capturing) return
    setKeyCaptureActive(true)
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const action = capturingRef.current
      if (!action) return
      if (e.key === 'Escape') {
        stopCapture()
        return
      }
      // Retour arrière / Suppr SEULS retirent le raccourci. Avec un
      // modificateur, ce sont de vraies combinaisons à examiner (Ctrl+Alt+Suppr
      // doit être refusé, pas confondu avec « effacer la ligne »).
      const nu = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
      if (nu && (e.key === 'Backspace' || e.key === 'Delete')) {
        setBinding(action, null)
        stopCapture()
        return
      }
      const combo = comboFromEvent(e)
      // Tant qu'on n'appuie que sur Ctrl/Alt/Maj, on attend la vraie touche.
      if (!combo) return

      const entry = KEYMAP_ENTRIES.find((x) => x.action === action)
      const risk = comboSafety(combo, entry?.global === true)
      if (risk?.level === 'refus') {
        // On REFUSE et on reste en capture : l'utilisateur enchaîne directement
        // sur une autre combinaison, sans avoir à recliquer.
        setRefusal(`${formatCombo(normalizeCombo(combo))} — ${risk.message}`)
        return
      }
      setBinding(action, combo)
      setWarning(risk ? { action, risk } : null)
      stopCapture()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      setKeyCaptureActive(false)
    }
  }, [capturing, setBinding, stopCapture])

  const grouped = useMemo(() => {
    const map = new Map<KeymapCategory, KeymapEntry[]>()
    for (const entry of KEYMAP_ENTRIES) {
      const list = map.get(entry.category)
      if (list) list.push(entry)
      else map.set(entry.category, [entry])
    }
    return map
  }, [])

  const conflictLabel = (combo: string, action: KeymapAction): string | null => {
    const others = conflicts.get(combo)
    if (!others) return null
    const rivals = others
      .filter((a) => a !== action)
      .map((a) => KEYMAP_ENTRIES.find((e) => e.action === a)?.label ?? a)
    if (rivals.length === 0) return null
    return `${formatCombo(combo)} est déjà pris par « ${rivals.join(' », « ')} »`
  }

  const startCapture = (action: KeymapAction) => {
    setRefusal(null)
    setWarning(null)
    setCapturing(action)
  }

  return (
    <div className="kme">
      <div className="kme-head">
        <div>
          <div className="kme-title">Raccourcis clavier</div>
          <div className="kme-sub">
            Tu arrives d’Epic Pen : ses combinaisons sont actives par défaut. Clique sur une touche
            pour la réenregistrer, Échap annule, Retour arrière retire le raccourci. Chaque
            changement est pris en compte tout de suite — jamais besoin de relancer Hexa.
          </div>
        </div>
        <div className="kme-spacer" />
      </div>

      <div className="kme-head">
        <div className="kme-presets" role="group" aria-label="Preset de raccourcis">
          {KEYMAP_PRESETS.map((p) => (
            <button
              key={p.id}
              className="kme-preset"
              data-on={keymapPreset === p.id ? '1' : '0'}
              title={p.description}
              onClick={() => setKeymapPreset(p.id)}
            >
              {p.name}
            </button>
          ))}
          {/* Troisième état, informatif : dès qu'une ligne est remappée, le
              clavier n'est plus tout à fait un preset — il est à toi. */}
          <button
            className="kme-preset"
            data-custom={customCount > 0 ? '1' : '0'}
            disabled={customCount === 0}
            title={
              customCount === 0
                ? 'Modifie un raccourci et ton clavier devient personnalisé.'
                : `${customCount} raccourci(s) remappé(s) par-dessus le preset « ${
                    KEYMAP_PRESETS.find((p) => p.id === keymapPreset)?.name ?? keymapPreset
                  } ».`
            }
          >
            Personnalisé{customCount > 0 ? ` · ${customCount}` : ''}
          </button>
        </div>
        <div className="kme-spacer" />
        <button
          className="kme-ghost"
          onClick={() => setCheatsheetOpen(true)}
          title="La liste complète, lisible et imprimable"
        >
          Aide-mémoire
        </button>
        <button
          className="kme-ghost"
          data-danger="1"
          disabled={customCount === 0}
          onClick={() => {
            resetAllBindings()
            setWarning(null)
          }}
          title="Revenir aux combinaisons du preset"
        >
          Tout réinitialiser
        </button>
      </div>

      {/* Raccourcis confisqués au système : c'est ce qui les fait marcher
          par-dessus un jeu. On dit ce qui a réussi, et surtout ce qui a échoué. */}
      <button
        className="kme-global"
        data-on={globalShortcutsOn ? '1' : '0'}
        role="switch"
        aria-checked={globalShortcutsOn}
        onClick={() => setGlobalShortcuts(!globalShortcutsOn)}
      >
        <span className="kme-global-text">
          <b>Raccourcis actifs même quand le jeu a le focus</b>
          <i>
            {globalShortcutsOn
              ? 'Actif : Hexa réserve auprès de Windows les combinaisons marquées « global » (Ctrl+Maj+2 à 8, F8, touche panique). C’est ce qui fait marcher tes réflexes Epic Pen pendant que tu joues. Ctrl+E et Ctrl+H, eux, ne sont JAMAIS confisqués : ils restent à ton navigateur et à VLC.'
              : 'Seuls le mode dessin et la touche panique restent globaux. Tout le reste ne répond que lorsque Hexa a le focus — donc pas pendant que tu joues.'}
          </i>
        </span>
        <span className="kme-global-track">
          <span className="kme-global-knob" />
        </span>
      </button>

      {/* LE CAS QUE PERSONNE NE DEVINE. Le raccourci est bien réservé auprès de
          Windows — le journal le dit — et pourtant il ne se passe rien pendant
          la partie : Windows ne livre pas les touches d'un programme ordinaire
          tant qu'un jeu lancé EN ADMINISTRATEUR est au premier plan. D'où le
          symptôme exact « je dois alt-tab pour que ça marche ». */}
      {privileges?.windows && !privileges.eleve && (
        <div className="kme-alert kme-admin">
          <span>
            <b>Tes raccourcis ne répondent pas pendant une partie ?</b> Windows ne remet pas les
            touches d’un programme ordinaire tant qu’un jeu lancé en administrateur est au premier
            plan — c’est le cas de League of Legends et de Valorant. Le symptôme est toujours le
            même : il faut Alt+Tab pour qu’Hexa réagisse. Relance Hexa en administrateur et ils
            passeront aussi en jeu.
          </span>
          <button type="button" className="kme-admin-go" onClick={relancerAdmin}>
            Relancer Hexa en administrateur
          </button>
        </div>
      )}

      {isElectron && failedCount > 0 && (
        <div className="kme-alert">
          ⚠ Windows a refusé {failedCount} combinaison{failedCount > 1 ? 's' : ''} : elle est déjà
          prise par un autre logiciel. Les lignes concernées sont signalées ci-dessous — donne-leur
          une autre combinaison.
        </div>
      )}

      {refusal && <div className="kme-alert">⛔ {refusal} Essaie une autre combinaison.</div>}

      {CATEGORY_ORDER.map((cat) => {
        const entries = grouped.get(cat)
        if (!entries || entries.length === 0) return null
        return (
          <section className="kme-cat" key={cat}>
            <h4 className="kme-cat-title">{CATEGORY_LABELS[cat]}</h4>
            {entries.map((entry) => {
              const combos = bindings[entry.action]
              const isCapturing = capturing === entry.action
              const conflict = combos.map((c) => conflictLabel(c, entry.action)).find(Boolean)
              const overridden = keymapOverrides[entry.action] !== undefined
              const failedAccel = status.failed[entry.action]
              const registeredAccel = status.registered[entry.action]
              // Avertissement réservé aux actions SYSTÈME : pour elles, ne pas
              // être globales, c'est ne pas fonctionner du tout en jeu. Sur les
              // autres, la pastille « global » éteinte suffit à le dire.
              const localOnly =
                entry.category === 'systeme' &&
                combos.length > 0 &&
                !combos.some(isRegistrableCombo)
              // Action annoncée « global » mais dont AUCUNE combinaison ne part
              // au système parce qu'Hexa refuse de la voler aux autres logiciels
              // (Ctrl+E du navigateur, Ctrl+H de l'historique…). Dire pourquoi,
              // sinon la pastille grise passe pour une panne.
              const rendueAuSysteme =
                entry.global === true &&
                !registeredAccel &&
                combos.length > 0 &&
                combos.some(isNeverGlobal) &&
                !combos.some(isRegistrableCombo)
              const rowWarning = warning?.action === entry.action ? warning.risk.message : null
              return (
                <div key={entry.action}>
                  <div
                    className="kme-row"
                    data-capturing={isCapturing ? '1' : '0'}
                    data-conflict={conflict || failedAccel ? '1' : '0'}
                  >
                    {swatchOf(entry.action) && (
                      <span
                        className="kme-swatch"
                        style={{ '--swatch': swatchOf(entry.action) } as CSSProperties}
                      />
                    )}
                    <div className="kme-label">
                      <b>{entry.label}</b>
                      {entry.hint && <span>{entry.hint}</span>}
                    </div>
                    {entry.hold && <span className="kme-tag">maintien</span>}
                    {entry.global && (
                      <span
                        className="kme-tag"
                        data-live={registeredAccel ? '1' : '0'}
                        title={
                          registeredAccel
                            ? `Réservé auprès de Windows (${registeredAccel}) : marche en jeu.`
                            : rendueAuSysteme
                              ? 'Laissé à tes autres logiciels : actif quand Hexa a le focus, donc en mode dessin.'
                              : 'Actif seulement quand la fenêtre d’Hexa a le focus.'
                        }
                      >
                        global
                      </span>
                    )}
                    <div className="kme-keys">
                      {isCapturing ? (
                        <button className="kme-key" data-capturing="1" onClick={stopCapture}>
                          appuie sur la combinaison souhaitée…
                        </button>
                      ) : combos.length === 0 ? (
                        <button
                          className="kme-key"
                          data-empty="1"
                          onClick={() => startCapture(entry.action)}
                        >
                          non assigné
                        </button>
                      ) : (
                        combos.map((combo, i) => (
                          <button
                            key={combo}
                            className="kme-key"
                            data-alt={i > 0 ? '1' : '0'}
                            title={i > 0 ? 'Combinaison secondaire' : 'Changer le raccourci'}
                            onClick={() => startCapture(entry.action)}
                          >
                            {formatCombo(combo)}
                          </button>
                        ))
                      )}
                      {overridden && !isCapturing && (
                        <button
                          className="kme-clear"
                          data-reset="1"
                          title="Réinitialiser cette ligne"
                          onClick={() => {
                            resetBinding(entry.action)
                            setWarning(null)
                          }}
                        >
                          ↺
                        </button>
                      )}
                      {combos.length > 0 && !isCapturing && (
                        <button
                          className="kme-clear"
                          title="Retirer ce raccourci"
                          onClick={() => setBinding(entry.action, null)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                  {conflict && <div className="kme-conflict">⚠ {conflict}</div>}
                  {failedAccel && (
                    <div className="kme-conflict">
                      ⚠ Windows refuse {formatCombo(combos[0] ?? '')} : un autre logiciel l’a déjà
                      réservée.
                    </div>
                  )}
                  {rowWarning && <div className="kme-warn">⚠ {rowWarning}</div>}
                  {!failedAccel && localOnly && globalShortcutsOn && (
                    <div className="kme-warn">
                      ⚠ Sans Ctrl, Alt ou une touche F6–F12, ce raccourci ne marchera que si la
                      fenêtre d’Hexa a le focus — pas par-dessus un jeu.
                    </div>
                  )}
                  {!failedAccel && rendueAuSysteme && globalShortcutsOn && (
                    <div className="kme-warn">
                      ⚠ {formatCombo(combos[0])} appartient à tes autres logiciels (navigateur,
                      VLC…) : Hexa refuse de la leur confisquer. Elle marche en mode dessin. Pour
                      nettoyer l’écran pendant que le jeu a le focus, c’est la touche panique.
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}

      <p className="kme-note">
        Les combinaisons du preset « Epic Pen » (Ctrl+Maj+2/3/4/5/6, Ctrl+E, Ctrl+H, Ctrl+Maj+7/8)
        proviennent de la documentation publique d’Epic Pen : elles sont là pour que ta mémoire
        musculaire fonctionne dès la première seconde, et restent toutes remappables ici. Le preset
        garde en second les touches maison (P, S, E, C, H…) : basculer de preset ne fait jamais
        perdre un raccourci.
        <br />
        <b>Stream Deck</b> : crée une action « Raccourci clavier » (Hotkey) et saisis exactement la
        combinaison affichée ici — aucun plugin n’est nécessaire.
        <br />
        F1 à F5 sont volontairement évitées (sorts alliés dans League of Legends), et Hexa refuse
        les combinaisons réservées par Windows (Alt+F4, Ctrl+Alt+Suppr, Windows+L…).
        <br />
        {lookup.size} combinaisons actives, {conflicts.size} conflit
        {conflicts.size > 1 ? 's' : ''}
        {isElectron
          ? `, ${Object.keys(status.registered).length} réservées auprès de Windows.`
          : ' (les raccourcis globaux n’existent que dans l’application installée).'}
      </p>
    </div>
  )
}

export default KeymapEditor
