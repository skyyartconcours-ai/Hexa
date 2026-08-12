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
 * Il gère : liste par catégorie, capture d'une nouvelle combinaison au clic,
 * détection des conflits, réinitialisation, bascule de preset, et pousse
 * automatiquement les deux raccourcis GLOBAUX vers Electron.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  CATEGORY_LABELS,
  KEYMAP_ENTRIES,
  KEYMAP_PRESETS,
  buildLookup,
  comboFromEvent,
  findConflicts,
  formatCombo,
  resolveKeymap,
  setKeyCaptureActive,
  toAccelerator,
  type KeymapAction,
  type KeymapCategory,
  type KeymapEntry,
} from '../keymap'
import { COLORS, useUiStore } from '../store'
import { bridge, isElectron } from '../bridge'
import './keymap-editor.css'

/** Couleur réelle de la palette pour les actions « Couleur N ». */
function swatchOf(action: KeymapAction): string | null {
  const m = /^color\.([1-7])$/.exec(action)
  return m ? (COLORS[parseInt(m[1], 10) - 1] ?? null) : null
}

const CATEGORY_ORDER: KeymapCategory[] = [
  'outils',
  'momentanes',
  'couleurs',
  'edition',
  'interface',
  'systeme',
]

export function KeymapEditor() {
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)
  const setKeymapPreset = useUiStore((s) => s.setKeymapPreset)
  const setBinding = useUiStore((s) => s.setBinding)
  const resetAllBindings = useUiStore((s) => s.resetAllBindings)

  const [capturing, setCapturing] = useState<KeymapAction | null>(null)
  const capturingRef = useRef<KeymapAction | null>(null)
  capturingRef.current = capturing

  const bindings = useMemo(
    () => resolveKeymap(keymapPreset, keymapOverrides),
    [keymapPreset, keymapOverrides],
  )
  const conflicts = useMemo(() => findConflicts(bindings), [bindings])
  const lookup = useMemo(() => buildLookup(bindings), [bindings])
  const customCount = Object.keys(keymapOverrides).length

  // Les deux raccourcis globaux vivent côté Electron (globalShortcut) : ils
  // doivent fonctionner même quand le jeu a le focus. On les resynchronise à
  // chaque changement — jamais en boucle, uniquement sur variation réelle.
  const drawCombo = bindings['mode.draw'][0] ?? ''
  const panicCombo = bindings['app.panic'][0] ?? ''
  useEffect(() => {
    if (!isElectron) return
    void bridge.setShortcuts({
      toggleDraw: toAccelerator(drawCombo),
      panic: toAccelerator(panicCombo),
    })
  }, [drawCombo, panicCombo])

  const stopCapture = useCallback(() => {
    setCapturing(null)
    setKeyCaptureActive(false)
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
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setBinding(action, null)
        stopCapture()
        return
      }
      const combo = comboFromEvent(e)
      // Tant qu'on n'appuie que sur Ctrl/Alt/Maj, on attend la vraie touche.
      if (!combo) return
      setBinding(action, combo)
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

  return (
    <div className="kme">
      <div className="kme-head">
        <div>
          <div className="kme-title">Raccourcis clavier</div>
          <div className="kme-sub">
            Clique sur une touche pour la réenregistrer. Échap annule, Retour arrière retire le
            raccourci. Un Stream Deck envoie ces mêmes combinaisons : tout est pilotable au boîtier.
          </div>
        </div>
        <div className="kme-spacer" />
        {customCount > 0 && <span className="kme-badge">personnalisé · {customCount}</span>}
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
        </div>
        <div className="kme-spacer" />
        <button
          className="kme-ghost"
          data-danger="1"
          disabled={customCount === 0}
          onClick={() => resetAllBindings()}
          title="Revenir aux combinaisons du preset"
        >
          Réinitialiser
        </button>
      </div>

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
              return (
                <div key={entry.action}>
                  <div
                    className="kme-row"
                    data-capturing={isCapturing ? '1' : '0'}
                    data-conflict={conflict ? '1' : '0'}
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
                    {entry.global && <span className="kme-tag">global</span>}
                    <div className="kme-keys">
                      {isCapturing ? (
                        <button className="kme-key" data-capturing="1" onClick={stopCapture}>
                          appuie sur une touche…
                        </button>
                      ) : combos.length === 0 ? (
                        <button
                          className="kme-key"
                          data-empty="1"
                          onClick={() => setCapturing(entry.action)}
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
                            onClick={() => setCapturing(entry.action)}
                          >
                            {formatCombo(combo)}
                          </button>
                        ))
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
                </div>
              )
            })}
          </section>
        )
      })}

      <p className="kme-note">
        Les combinaisons du preset « Compatibilité Epic Pen » (Ctrl+Maj+3/4/5/6, Ctrl+E, Ctrl+H)
        proviennent de la documentation publique d’Epic Pen : elles sont fournies pour retrouver ses
        réflexes et restent toutes remappables ici.
        <br />
        F1 à F5 sont volontairement évitées : ce sont les sorts alliés dans League of Legends. Les
        deux raccourcis marqués « global » sont enregistrés par le système et fonctionnent même
        quand le jeu a le focus{isElectron ? '.' : ' (uniquement dans l’application Electron).'}
        <br />
        {lookup.size} combinaisons actives, {conflicts.size} conflit
        {conflicts.size > 1 ? 's' : ''}.
      </p>
    </div>
  )
}

export default KeymapEditor
