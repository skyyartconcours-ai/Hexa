/**
 * Hexa — aide-mémoire des raccourcis.
 *
 * Le panneau qu'on ouvre d'une touche (?) quand on a oublié une combinaison, et
 * qu'on laisse sur un second écran pendant les premiers directs. Groupé par
 * catégorie, lisible de loin, propre à l'impression (Ctrl+P → noir sur blanc).
 *
 * Il ne règle RIEN : il montre. Les modifications se font dans l'éditeur de
 * raccourcis (réglages), auquel il renvoie d'un bouton.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  KEYMAP_ENTRIES,
  KEYMAP_PRESETS,
  formatCombo,
  resolveKeymap,
  type KeymapAction,
  type KeymapCategory,
  type KeymapEntry,
} from '../keymap'
import { useUiStore } from '../store'
import { getGlobalShortcutStatus, subscribeGlobalShortcuts } from '../globalShortcuts'
import { isElectron } from '../bridge'
import './shortcuts-sheet.css'

/** Les gestes d'Epic Pen, dans l'ordre où la main les apprend. */
const ESSENTIALS: { action: KeymapAction; label: string }[] = [
  { action: 'mode.cursor', label: 'Curseur (souris au jeu)' },
  { action: 'tool.pen', label: 'Stylo' },
  { action: 'tool.highlight', label: 'Surligneur' },
  { action: 'tool.eraser', label: 'Gomme' },
  { action: 'edit.undo', label: 'Annuler' },
  { action: 'edit.clear', label: 'Tout effacer' },
  { action: 'ui.toolbar', label: 'Barre d’outils' },
]

export interface ShortcutsSheetProps {
  onClose: () => void
  /** ouvre les réglages (où vit l'éditeur de raccourcis) */
  onEdit?: () => void
}

export function ShortcutsSheet({ onClose, onEdit }: ShortcutsSheetProps) {
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)
  const status = useSyncExternalStore(subscribeGlobalShortcuts, getGlobalShortcutStatus)

  const bindings = useMemo(
    () => resolveKeymap(keymapPreset, keymapOverrides),
    [keymapPreset, keymapOverrides],
  )

  const grouped = useMemo(() => {
    const map = new Map<KeymapCategory, KeymapEntry[]>()
    for (const entry of KEYMAP_ENTRIES) {
      const list = map.get(entry.category)
      if (list) list.push(entry)
      else map.set(entry.category, [entry])
    }
    return map
  }, [])

  const presetName = KEYMAP_PRESETS.find((p) => p.id === keymapPreset)?.name ?? keymapPreset
  const customCount = Object.keys(keymapOverrides).length

  // Échap ferme, comme partout ailleurs dans l'application.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // On est la couche du dessus : Échap nous ferme, NOUS, et laisse le
        // panneau de réglages ouvert derrière.
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    document.body.classList.add('over-ui')
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('over-ui')
    }
  }, [onClose])

  const keys = (action: KeymapAction) => bindings[action]

  return (
    <>
      <div className="shs-scrim" onPointerDown={onClose} aria-hidden />
      <aside className="shs" role="dialog" aria-label="Aide-mémoire des raccourcis">
        <header className="shs-top">
          <span className="shs-mark" aria-hidden />
          <div className="shs-top-text">
            <b>Aide-mémoire des raccourcis</b>
            <i>
              Clavier « {presetName} »{customCount > 0 && ` · ${customCount} personnalisé(s)`} ·
              Échap ferme
            </i>
          </div>
          {onEdit && (
            <button className="shs-btn" onClick={onEdit}>
              Modifier
            </button>
          )}
          <button className="shs-close" onClick={onClose} title="Fermer (Échap)">
            ✕
          </button>
        </header>

        <div className="shs-scroll">
          {/* L'essentiel : les sept gestes qu'on garde d'Epic Pen */}
          <section className="shs-hero">
            <h3>L’essentiel</h3>
            <div className="shs-hero-grid">
              {ESSENTIALS.map((item) => {
                const combos = keys(item.action)
                return (
                  <div className="shs-hero-item" key={item.action}>
                    <span className="shs-hero-label">{item.label}</span>
                    <span className="shs-keys">
                      {combos.length === 0 ? (
                        <em className="shs-none">non assigné</em>
                      ) : (
                        <kbd className="shs-kbd">{formatCombo(combos[0])}</kbd>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <div className="shs-cols">
            {CATEGORY_ORDER.map((cat) => {
              const entries = grouped.get(cat)
              if (!entries || entries.length === 0) return null
              return (
                <section className="shs-cat" key={cat}>
                  <h4>{CATEGORY_LABELS[cat]}</h4>
                  <dl>
                    {entries.map((entry) => {
                      const combos = keys(entry.action)
                      const global = status.registered[entry.action] != null
                      return (
                        <div className="shs-line" key={entry.action}>
                          <dt>
                            {entry.label}
                            {entry.hold && <span className="shs-flag">maintien</span>}
                            {global && (
                              <span className="shs-flag" data-global="1" title="Marche même en jeu">
                                hors focus
                              </span>
                            )}
                          </dt>
                          <dd>
                            {combos.length === 0 ? (
                              <em className="shs-none">—</em>
                            ) : (
                              combos.map((c, i) => (
                                <kbd className="shs-kbd" data-alt={i > 0 ? '1' : '0'} key={c}>
                                  {formatCombo(c)}
                                </kbd>
                              ))
                            )}
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                </section>
              )
            })}

            {/* Gestes souris : ils ne sont pas dans la table clavier, mais ce
                sont eux qu'on cherche le plus souvent au début. */}
            <section className="shs-cat">
              <h4>Souris</h4>
              <dl>
                <div className="shs-line">
                  <dt>Clic droit sur un trait</dt>
                  <dd>
                    <kbd className="shs-kbd">attraper et déplacer</kbd>
                  </dd>
                </div>
                <div className="shs-line">
                  <dt>Clic droit maintenu dans le vide</dt>
                  <dd>
                    <kbd className="shs-kbd">menu radial</kbd>
                  </dd>
                </div>
                <div className="shs-line">
                  <dt>Molette</dt>
                  <dd>
                    <kbd className="shs-kbd">épaisseur du trait</kbd>
                  </dd>
                </div>
                <div className="shs-line">
                  <dt>Maj pendant le tracé</dt>
                  <dd>
                    <kbd className="shs-kbd">carré, cercle, angles 15°</kbd>
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="shs-note">
            <h4>Stream Deck</h4>
            <p>
              Un Stream Deck envoie des combinaisons clavier : aucune extension n’est nécessaire.
              Crée une action <b>« Raccourci clavier » (Hotkey)</b> par bouton et saisis exactement
              la combinaison de la colonne de droite. Les plus utiles :{' '}
              {ESSENTIALS.filter((e) => keys(e.action).length > 0)
                .map((e) => `${formatCombo(keys(e.action)[0])} = ${e.label.toLowerCase()}`)
                .join(' · ')}
              .
            </p>
            <p>
              Un bouton de Stream Deck vaut exactement un appui clavier : la même règle s’applique
              donc. Les lignes marquées{' '}
              <span className="shs-flag" data-global="1">
                hors focus
              </span>{' '}
              sont enregistrées auprès de Windows et fonctionnent pendant que le jeu a le focus ;
              les autres attendent que Hexa l’ait, c’est-à-dire le mode dessin.
              {!isElectron && ' (Uniquement dans l’application installée, pas dans la démo navigateur.)'}
            </p>
          </section>
        </div>
      </aside>
    </>
  )
}

export default ShortcutsSheet
