/**
 * Hexa — panneau d'aide (touche ?).
 *
 * Le filet de sécurité de quelqu'un qui n'est PAS développeur et qui se
 * retrouve seul devant un écran transparent. Quatre onglets, dans l'ordre où
 * les questions arrivent vraiment :
 *
 *   1. Les gestes      — les six choses à savoir faire, rien de plus.
 *   2. Raccourcis      — la table complète du clavier ACTIF (preset + remaps).
 *   3. Sur mon stream  — comment les viewers voient enfin les annotations.
 *   4. Au secours      — symptôme → solution, écrit avec les mots du problème.
 *
 * Règles : Échap ferme, aucune touche n'est écrite en dur (tout vient de
 * src/keymap.ts, donc un remap se voit ici à la seconde), aucun timer, aucune
 * animation permanente.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import {
  CATEGORY_LABELS,
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
import { ShortcutsSheet } from './ShortcutsSheet'
import './help-panel.css'

type TabId = 'gestes' | 'clavier' | 'stream' | 'secours'

const TABS: { id: TabId; label: string }[] = [
  { id: 'gestes', label: 'Les gestes' },
  { id: 'clavier', label: 'Raccourcis' },
  { id: 'stream', label: 'Sur mon stream' },
  { id: 'secours', label: 'Au secours' },
]

const CATEGORY_ORDER: KeymapCategory[] = [
  'outils',
  'momentanes',
  'couleurs',
  'edition',
  'interface',
  'systeme',
]

/* ------------------------------------------------------------------ *
 * Pictogrammes — SVG maison, aucune ressource externe, aucune animation
 * ------------------------------------------------------------------ */

const GLYPHS: Record<string, ReactElement> = {
  dessiner: (
    <svg viewBox="0 0 32 32" aria-hidden>
      <path
        d="M4 24c4-11 7 5 11-4s5 7 13-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  effacer: (
    <svg viewBox="0 0 32 32" aria-hidden>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M13 6h10a3 3 0 013 3v7a3 3 0 01-3 3H8z" transform="rotate(-38 16 13)" />
        <path d="M5 27h22" />
      </g>
    </svg>
  ),
  deplacer: (
    <svg viewBox="0 0 32 32" aria-hidden>
      <path
        d="M5 21c5-9 10-9 14-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M11 25c5-9 10-9 14-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path d="M18 13l9 3.5-3.8 1.4-1.4 3.8z" fill="currentColor" />
    </svg>
  ),
  couleur: (
    <svg viewBox="0 0 32 32" aria-hidden>
      <circle cx="12" cy="13" r="6" fill="currentColor" opacity="0.85" />
      <circle cx="21" cy="17" r="6" fill="currentColor" opacity="0.45" />
      <circle cx="14" cy="22" r="5" fill="currentColor" opacity="0.25" />
    </svg>
  ),
  taille: (
    <svg viewBox="0 0 32 32" aria-hidden>
      <circle cx="9" cy="16" r="2.5" fill="currentColor" />
      <circle cx="17" cy="16" r="4.5" fill="currentColor" opacity="0.7" />
      <circle cx="26" cy="16" r="2" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  jeu: (
    <svg viewBox="0 0 32 32" aria-hidden>
      <path
        d="M9 10h14a5 5 0 015 5v3a4 4 0 01-7 2.6l-1.2-1.4h-5.6L13 20.6A4 4 0 016 18v-3a5 5 0 015-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M11 15h4M13 13v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="22" cy="15" r="1.6" fill="currentColor" />
    </svg>
  ),
  souris: (
    <svg viewBox="0 0 32 32" aria-hidden>
      <rect
        x="10"
        y="4"
        width="12"
        height="19"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path d="M16 5v7" stroke="currentColor" strokeWidth="2.2" />
      <path d="M16 12h6" stroke="currentColor" strokeWidth="2.2" opacity="0.5" />
    </svg>
  ),
}

/** Une touche affichée. `alt` = variante secondaire, plus discrète. */
function Kbd({ combo, alt }: { combo: string; alt?: boolean }) {
  return (
    <kbd className="hlp-kbd" data-alt={alt ? '1' : '0'}>
      {formatCombo(combo)}
    </kbd>
  )
}

export interface HelpPanelProps {
  onClose: () => void
  /** ouvre les réglages, où vit l'éditeur de raccourcis */
  onEdit?: () => void
  /** rejoue la découverte guidée du premier lancement */
  onReplayTour?: () => void
}

export function HelpPanel({ onClose, onEdit, onReplayTour }: HelpPanelProps) {
  const [tab, setTab] = useState<TabId>('gestes')
  /** fiche imprimable posée par-dessus (Échap la referme, l'aide reste) */
  const [sheet, setSheet] = useState(false)
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)
  const obsMode = useUiStore((s) => s.obsMode)
  const obsPort = useUiStore((s) => s.obsPort)
  const obsServerOn = useUiStore((s) => s.obsServerOn)
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

  /** première combinaison d'une action, prête à afficher */
  const key = (action: KeymapAction): string => bindings[action]?.[0] ?? ''
  /** les suivantes : les touches maison gardées en second */
  const others = (action: KeymapAction): string[] => bindings[action]?.slice(1) ?? []

  // Échap ferme l'aide — MAIS jamais quand la fiche imprimable est posée
  // par-dessus : c'est elle qui doit partir d'abord, et l'aide rester. Deux
  // écouteurs sur `window` ne s'annulent pas l'un l'autre (stopPropagation ne
  // vaut que pour les nœuds suivants), il faut donc se taire explicitement.
  useEffect(() => {
    if (sheet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, sheet])

  // le curseur de dessin s'efface tant qu'on est dans l'aide
  useEffect(() => {
    document.body.classList.add('over-ui')
    return () => document.body.classList.remove('over-ui')
  }, [])

  const presetName = KEYMAP_PRESETS.find((p) => p.id === keymapPreset)?.name ?? keymapPreset
  const customCount = Object.keys(keymapOverrides).length

  /* --------------------------- onglet 1 --------------------------- */
  const gestes = (
    <div className="hlp-cards">
      <article className="hlp-card">
        <span className="hlp-ico">{GLYPHS.dessiner}</span>
        <h4>Dessiner</h4>
        <p>
          Appuie sur le bouton gauche et trace, n’importe où sur l’écran. Le trait s’épaissit quand
          tu ralentis : c’est un feutre, pas un tuyau.
        </p>
        <p className="hlp-keys">
          <Kbd combo={key('tool.pen')} /> pinceau · <Kbd combo={key('tool.highlight')} /> surligneur
        </p>
      </article>

      <article className="hlp-card">
        <span className="hlp-ico">{GLYPHS.effacer}</span>
        <h4>Effacer</h4>
        <p>
          <b>Tout enlever</b> d’un coup, ou <b>revenir en arrière</b> d’un trait. La gomme, elle,
          efface le trait entier que tu survoles — clic maintenu.
        </p>
        <p className="hlp-keys">
          <Kbd combo={key('edit.clear')} /> tout effacer · <Kbd combo={key('edit.undo')} /> annuler ·{' '}
          <Kbd combo={key('tool.eraser')} /> gomme
        </p>
      </article>

      <article className="hlp-card">
        <span className="hlp-ico">{GLYPHS.deplacer}</span>
        <h4>Déplacer une annotation</h4>
        <p>
          <b>Clic droit sur un trait</b>, et tu le fais glisser où tu veux. Rien n’est figé : tant
          qu’il est à l’écran, il se déplace.
        </p>
        <p className="hlp-keys">
          <span className="hlp-gesture">Clic droit maintenu sur le trait</span>
        </p>
      </article>

      <article className="hlp-card">
        <span className="hlp-ico">{GLYPHS.couleur}</span>
        <h4>Changer de couleur</h4>
        <p>
          Les sept pastilles de la barre, ou les chiffres du clavier. Le plus rapide reste la roue :
          clic droit maintenu dans le vide, tu glisses vers la couleur, tu relâches.
        </p>
        <p className="hlp-keys">
          <Kbd combo={key('color.1')} />
          <Kbd combo={key('color.2')} />
          <Kbd combo={key('color.3')} />… jusqu’à <Kbd combo={key('color.7')} />
        </p>
      </article>

      <article className="hlp-card">
        <span className="hlp-ico">{GLYPHS.taille}</span>
        <h4>Épaissir le trait</h4>
        <p>
          La molette de la souris, sans lâcher ce que tu fais. La barre affiche la taille en direct
          sous forme de point.
        </p>
        <p className="hlp-keys">
          <span className="hlp-gesture">Molette</span> · <Kbd combo={key('size.inc')} /> plus épais ·{' '}
          <Kbd combo={key('size.dec')} /> plus fin
        </p>
      </article>

      <article className="hlp-card is-strong">
        <span className="hlp-ico">{GLYPHS.jeu}</span>
        <h4>Rendre la souris au jeu</h4>
        <p>
          Tant que le mode dessin est actif, tes clics vont à Hexa et pas au jeu. Une touche, et la
          souris repart au jeu : Hexa devient invisible aux clics, tes annotations restent à l’écran.
        </p>
        <p className="hlp-keys">
          <Kbd combo={key('mode.cursor')} /> rendre la souris ·{' '}
          <Kbd combo={key('mode.draw')} /> revenir dessiner
        </p>
      </article>

      <article className="hlp-card is-wide">
        <span className="hlp-ico">{GLYPHS.souris}</span>
        <h4>Tout ce que fait la souris</h4>
        <ul className="hlp-list">
          <li>
            <b>Clic gauche</b> — dessiner avec l’outil actif.
          </li>
          <li>
            <b>Clic droit sur une annotation</b> — l’attraper et la déplacer.
          </li>
          <li>
            <b>Clic droit maintenu dans le vide</b> — la roue d’outils éclot sous le curseur : glisse
            vers un outil (anneau extérieur) ou une couleur (anneau intérieur), relâche, c’est pris.
            Relâcher au centre annule.
          </li>
          <li>
            <b>Molette</b> — épaisseur du trait.
          </li>
          <li>
            <b>Flèche</b> — trace ta courbe, la flèche l’épouse et l’embellit. La pointe part dans
            le sens de ton geste. <b>Maj</b> — flèche parfaitement droite.
          </li>
          <li>
            <b>Maj pendant le tracé</b> — carré, cercle parfait, angles de 15°.{' '}
            <b>Alt</b> — forme remplie.
          </li>
        </ul>
      </article>
    </div>
  )

  /* --------------------------- onglet 2 --------------------------- */
  const clavier = (
    <>
      <div className="hlp-bar">
        <span className="hlp-bar-text">
          Clavier « {presetName} »{customCount > 0 && ` · ${customCount} raccourci(s) à toi`}. Tout
          est remappable, rien n’oblige à relancer Hexa.
        </span>
        {onEdit && (
          <button className="hlp-btn" onClick={onEdit}>
            Modifier mes raccourcis
          </button>
        )}
        <button className="hlp-btn" onClick={() => setSheet(true)}>
          Fiche imprimable
        </button>
      </div>

      <div className="hlp-cols">
        {CATEGORY_ORDER.map((cat) => {
          const entries = grouped.get(cat)
          if (!entries || entries.length === 0) return null
          return (
            <section className="hlp-cat" key={cat}>
              <h4>{CATEGORY_LABELS[cat]}</h4>
              <dl>
                {entries.map((entry) => {
                  const first = key(entry.action)
                  const rest = others(entry.action)
                  const global = status.registered[entry.action] != null
                  return (
                    <div className="hlp-line" key={entry.action}>
                      <dt>
                        {entry.label}
                        {entry.hold && <span className="hlp-flag">à maintenir</span>}
                        {global && (
                          <span
                            className="hlp-flag"
                            data-global="1"
                            title="Marche même quand le jeu a le focus"
                          >
                            même en jeu
                          </span>
                        )}
                      </dt>
                      <dd>
                        {first === '' ? (
                          <em className="hlp-none">aucune touche</em>
                        ) : (
                          <>
                            <Kbd combo={first} />
                            {rest.map((c) => (
                              <Kbd combo={c} alt key={c} />
                            ))}
                          </>
                        )}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          )
        })}
      </div>
      <p className="hlp-foot">
        Les touches grises sont des équivalents : les deux marchent.{' '}
        {isElectron
          ? 'Les lignes « même en jeu » sont réservées auprès de Windows, elles répondent pendant que tu joues.'
          : 'Dans la démo navigateur, les raccourcis ne marchent que si cette page a le focus — l’application installée, elle, répond même en jeu.'}
      </p>
    </>
  )

  /* --------------------------- onglet 3 --------------------------- */
  const stream = (
    <div className="hlp-steps">
      <ol>
        <li>
          <b>Dans OBS, ajoute une source « Capture d’écran »</b> (<i>Display Capture</i> en anglais)
          et choisis l’écran sur lequel tu dessines.
        </li>
        <li>
          <b>C’est tout.</b> Les annotations d’Hexa sont posées par-dessus le bureau : OBS les
          capture comme il capture ta souris et tes fenêtres.
        </li>
      </ol>
      <div className="hlp-warn">
        <b>Le seul piège, et il vaut aussi pour Epic Pen :</b> une source « Capture de jeu »
        (<i>Game Capture</i>) filme l’intérieur du jeu, <b>avant</b> que Windows ne pose les overlays
        par-dessus. Elle ne verra donc jamais tes annotations. Si tes viewers ne voient rien alors
        que toi si, c’est presque toujours ça : bascule sur « Capture d’écran ».
      </div>
      <ul className="hlp-list">
        <li>
          <b>Jeu en plein écran exclusif ?</b> Passe-le en « Plein écran fenêtré » (borderless) dans
          ses options : sinon rien ne peut se poser par-dessus, aucun logiciel d’annotation ne peut
          rien y faire.
        </li>
        <li>
          <b>Garder ton écran propre et n’envoyer les annotations qu’au stream ?</b> C’est le mode
          « Stream seul » des réglages : Hexa n’affiche plus rien chez toi et publie tout dans une
          source navigateur d’OBS
          {obsServerOn ? (
            <>
              {' '}
              — adresse à coller : <code>http://127.0.0.1:{obsPort}/obs.html</code>
            </>
          ) : (
            <> — active le petit serveur local dans Réglages → OBS pour obtenir l’adresse</>
          )}
          . {obsMode === 'stream' ? 'Ce mode est actuellement ACTIF.' : ''}
        </li>
        <li>
          <b>Deux écrans ?</b> Hexa pose une couche sur chacun. Capture celui que tu diffuses ; « tout
          effacer » nettoie les deux d’un coup.
        </li>
      </ul>
    </div>
  )

  /* --------------------------- onglet 4 --------------------------- */
  const secours = (
    <div className="hlp-sos">
      <div className="hlp-sos-item">
        <h4>Ma barre d’outils a disparu</h4>
        <p>
          Tu l’as masquée (c’est fait pour : elle ne doit pas polluer une capture).{' '}
          <Kbd combo={key('ui.toolbar')} /> la ramène.
        </p>
      </div>
      <div className="hlp-sos-item">
        <h4>Je ne peux plus cliquer dans mon jeu</h4>
        <p>
          Le mode dessin est actif : tes clics vont à Hexa. <Kbd combo={key('mode.cursor')} /> rend la
          souris au jeu, <Kbd combo={key('mode.draw')} /> te ramène au dessin. Le liseré lumineux sur
          le tour de l’écran est là pour te dire dans quel mode tu es.
        </p>
      </div>
      <div className="hlp-sos-item">
        <h4>Je dessine mais rien n’apparaît</h4>
        <p>
          Vérifie le mode : en mode jeu, les clics traversent Hexa. Choisir un outil (
          <Kbd combo={key('tool.pen')} />) rebascule automatiquement en dessin.
        </p>
      </div>
      <div className="hlp-sos-item">
        <h4>Mes traits s’effacent tout seuls</h4>
        <p>
          C’est le fondu automatique, réglé sur quelques secondes.{' '}
          <Kbd combo={key('fade.cycle')} /> fait défiler 2 s, 4 s, 8 s puis <b>∞</b> — en ∞ tout reste
          jusqu’à ce que tu effaces. La pastille de la barre affiche toujours le réglage en cours.
        </p>
      </div>
      <div className="hlp-sos-item">
        <h4>Un panneau reste ouvert / je suis coincé</h4>
        <p>
          <b>Échap</b> referme toujours ce qui est ouvert et repose les outils momentanés.{' '}
          <Kbd combo={key('app.panic')} /> est la touche panique : écran net immédiatement, même
          pendant que tu joues.
        </p>
      </div>
      <div className="hlp-sos-item">
        <h4>Hexa a complètement disparu de l’écran</h4>
        <p>
          Il tourne toujours : son icône est près de l’horloge de Windows (parfois cachée derrière la
          flèche ⌃ de la barre des tâches). Un clic dessus rebascule le mode dessin, un clic droit
          ouvre son menu.
        </p>
      </div>
      <div className="hlp-sos-item">
        <h4>Mes viewers ne voient pas mes annotations</h4>
        <p>
          Ta source OBS est une « Capture de jeu ». Remplace-la par une « Capture d’écran » : détails
          dans l’onglet <b>Sur mon stream</b>.
        </p>
      </div>
      {onReplayTour && (
        <div className="hlp-sos-item is-action">
          <h4>Je veux revoir la présentation du début</h4>
          <button className="hlp-btn is-primary" onClick={onReplayTour}>
            Rejouer la découverte guidée
          </button>
        </div>
      )}
    </div>
  )

  return (
    <>
      <div className="hlp-scrim" onPointerDown={onClose} aria-hidden />
      <aside className="hlp" role="dialog" aria-label="Aide d’Hexa">
        <header className="hlp-top">
          <span className="hlp-mark" aria-hidden />
          <div className="hlp-top-text">
            <b>Comment on s’en sert</b>
            <i>Tout est là. Échap ferme.</i>
          </div>
          <button className="hlp-close" onClick={onClose} title="Fermer (Échap)">
            ✕
          </button>
        </header>

        <nav className="hlp-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`hlp-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="hlp-scroll" key={tab}>
          {tab === 'gestes' && gestes}
          {tab === 'clavier' && clavier}
          {tab === 'stream' && stream}
          {tab === 'secours' && secours}
        </div>
      </aside>

      {/* Fiche imprimable : la liste sèche, pour un second écran ou du papier.
          Elle se pose au-dessus et se referme seule à Échap. */}
      {sheet && <ShortcutsSheet onClose={() => setSheet(false)} onEdit={onEdit} />}
    </>
  )
}

export default HelpPanel
