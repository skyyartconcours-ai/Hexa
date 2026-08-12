import { useMemo } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { COLORS, useUiStore } from '../store'
import type { ToolId } from '../engine/types'
import { GRID_LABELS } from '../engine/stream-fx'
import { formatCombo, resolveKeymap, type KeymapAction } from '../keymap'
import { spawnClock, spawnNote } from './StageWidgets'
import {
  HexaLogo,
  IconArrow,
  IconBadge,
  IconBlur,
  IconClear,
  IconCompare,
  IconEllipse,
  IconFreeze,
  IconHelp,
  IconMagnifier,
  IconEraser,
  IconExport,
  IconGear,
  IconGrid,
  IconNote,
  IconStopwatch,
  IconHighlight,
  IconInfinity,
  IconLaser,
  IconLine,
  IconMagnet,
  IconScript,
  IconMeasure,
  IconMute,
  IconPen,
  IconPing,
  IconRect,
  IconRedo,
  IconSound,
  IconSparkles,
  IconSpotlight,
  IconText,
  IconTimer,
  IconUndo,
  IconWand,
} from './icons'

/**
 * Les outils de la barre.
 *
 * `action` renvoie vers la table centrale des raccourcis : l'info-bulle affiche
 * alors la touche RÉELLEMENT active (preset Epic Pen par défaut, remaps de
 * l'utilisateur compris). Une info-bulle qui ment est pire que pas
 * d'info-bulle. `kbd` ne sert plus que de repli pour les rares gestes qui ne
 * passent pas encore par la table.
 */
interface ToolButton {
  id: ToolId
  icon: ReactElement
  label: string
  kbd: string
  action?: KeymapAction
  /** l'outil ne vit que tant que la touche est maintenue */
  hold?: boolean
}

/** Les sept couleurs, nommées : « Couleur 3 » ne dit rien à personne. */
const COLOR_NAMES = ['Cyan', 'Magenta', 'Violet', 'Vert', 'Jaune', 'Orange', 'Blanc']

const TOOLS: ToolButton[] = [
  { id: 'pen', icon: <IconPen />, label: 'Pinceau', kbd: 'P', action: 'tool.pen' },
  {
    id: 'highlight',
    icon: <IconHighlight />,
    label: 'Surligneur',
    kbd: 'S',
    action: 'tool.highlight',
  },
  {
    id: 'line',
    icon: <IconLine />,
    label: 'Ligne (Maj : angles de 15°)',
    kbd: 'L',
    action: 'tool.line',
  },
  { id: 'arrow', icon: <IconArrow />, label: 'Flèche', kbd: 'F', action: 'tool.arrow' },
  {
    id: 'rect',
    icon: <IconRect />,
    label: 'Rectangle (Maj : carré · Alt : rempli)',
    kbd: 'R',
    action: 'tool.rect',
  },
  {
    id: 'ellipse',
    icon: <IconEllipse />,
    label: 'Ellipse (Maj : cercle · Alt : remplie)',
    kbd: 'O',
    action: 'tool.ellipse',
  },
  {
    id: 'text',
    icon: <IconText />,
    label: 'Texte (Entrée valide, Échap annule)',
    kbd: 'T',
    action: 'tool.text',
  },
  {
    id: 'badge',
    icon: <IconBadge />,
    label: 'Numéroteur : pastilles 1, 2, 3…',
    kbd: 'N',
    action: 'tool.badge',
  },
  {
    id: 'measure',
    icon: <IconMeasure />,
    label: 'Règle de mesure (distance et angle)',
    kbd: 'M',
    action: 'tool.measure',
  },
  {
    id: 'laser',
    icon: <IconLaser />,
    label: 'Laser : le trait s’efface derrière le curseur',
    kbd: 'Z',
    action: 'hold.laser',
    hold: true,
  },
  { id: 'ping', icon: <IconPing />, label: 'Ping : un clic, un repère qui bat', kbd: 'Q' },
  {
    id: 'spotlight',
    icon: <IconSpotlight />,
    label:
      'Spotlight — le disque suit la souris (molette : rayon) · glisse : éclaire un rectangle · Alt + glisse : forme libre · un clic : retour au disque',
    kbd: 'X',
    action: 'hold.spotlight',
    hold: true,
  },
  { id: 'eraser', icon: <IconEraser />, label: 'Gomme : efface le trait survolé, clic maintenu', kbd: 'E', action: 'tool.eraser' },
  {
    id: 'magnifier',
    icon: <IconMagnifier />,
    label: 'Loupe (molette : grossissement · V : figer le disque)',
    kbd: 'A',
    action: 'hold.magnifier',
    hold: true,
  },
  {
    id: 'blur',
    icon: <IconBlur />,
    label:
      'Masque flou : trace un rectangle sur ce qu’il ne faut pas montrer (B · clic droit : déplacer · la croix le retire)',
    kbd: 'B',
  },
]

export interface ToolbarActions {
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onExport: () => void
  /** gel d'image (§5.5) : l'écran se fige, on annote la photo */
  onFreeze: () => void
  /** avant/après (§5.7) : photo à gauche, direct à droite */
  onCompare: () => void
  /** état de la couche d'effets, pour allumer les deux boutons ci-dessus */
  frozen: boolean
  comparing: boolean
}

export function Toolbar({
  onUndo,
  onRedo,
  onClear,
  onExport,
  onFreeze,
  onCompare,
  frozen,
  comparing,
}: ToolbarActions) {
  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const smartShapes = useUiStore((s) => s.smartShapes)
  const guides = useUiStore((s) => s.guides)
  const sound = useUiStore((s) => s.sound)
  const soundVolume = useUiStore((s) => s.soundVolume)
  const toggleSound = useUiStore((s) => s.toggleSound)
  const setSoundVolume = useUiStore((s) => s.setSoundVolume)
  const toggleSmartShapes = useUiStore((s) => s.toggleSmartShapes)
  const toggleGuides = useUiStore((s) => s.toggleGuides)
  const handwriting = useUiStore((s) => s.handwriting)
  const toggleHandwriting = useUiStore((s) => s.toggleHandwriting)
  const setTool = useUiStore((s) => s.setTool)
  const setColor = useUiStore((s) => s.setColor)
  const setSize = useUiStore((s) => s.setSize)
  const cycleFade = useUiStore((s) => s.cycleFade)
  const gridMode = useUiStore((s) => s.gridMode)
  const gridOpacity = useUiStore((s) => s.gridOpacity)
  const cycleGrid = useUiStore((s) => s.cycleGrid)
  const setGridOpacity = useUiStore((s) => s.setGridOpacity)
  const toggleSparkles = useUiStore((s) => s.toggleSparkles)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setCheatsheetOpen = useUiStore((s) => s.setCheatsheetOpen)
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)

  const hover = (on: boolean) => document.body.classList.toggle('over-ui', on)

  // Les info-bulles disent la touche qui marche VRAIMENT sur cette machine :
  // preset actif et remaps de l'utilisateur compris. Rien n'est écrit en dur.
  const bindings = useMemo(
    () => resolveKeymap(keymapPreset, keymapOverrides),
    [keymapPreset, keymapOverrides],
  )
  const touche = (action: KeymapAction | undefined, repli?: string): string | null => {
    const combo = action ? bindings[action]?.[0] : undefined
    if (combo) return formatCombo(combo)
    return repli ?? null
  }
  /** « Libellé — Ctrl + Maj + 3 » (ou sans queue si l'action n'a plus de touche) */
  const bulle = (label: string, action?: KeymapAction, repli?: string, hold = false): string => {
    const k = touche(action, repli)
    if (!k) return label
    return `${label} — ${hold ? 'maintenir ' : ''}${k}`
  }

  return (
    <div
      className="toolbar"
      style={{ '--accent': color } as CSSProperties}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
    >
      <div className="brand" title="Hexa">
        <HexaLogo />
      </div>

      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tbtn ${tool === t.id ? 'active' : ''}`}
            title={bulle(t.label, t.action, t.kbd, t.hold)}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
        {/* Le gel n'est pas un outil mais une BASCULE : une fois l'écran figé
            on continue de dessiner avec son pinceau, sur la photo (§5.5). */}
        <button
          className={`tbtn ${frozen ? 'active' : ''}`}
          title={
            frozen
              ? bulle('Écran figé — ce bouton reprend le direct', 'hold.freeze', 'V')
              : bulle(
                  'Gel d’image : l’écran se fige, tu annotes la photo tranquillement',
                  'hold.freeze',
                  'V',
                )
          }
          onClick={onFreeze}
        >
          <IconFreeze />
        </button>
      </div>

      <div className="sep" />

      <div className="group swatches">
        {COLORS.map((c, i) => (
          <button
            key={c}
            className={`swatch ${color === c ? 'active' : ''}`}
            style={{ '--c': c } as CSSProperties}
            title={bulle(COLOR_NAMES[i] ?? `Couleur ${i + 1}`, `color.${i + 1}` as KeymapAction)}
            onClick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="sep" />

      <div
        className="group size-group"
        title={`Épaisseur du trait : ${size} px — molette de la souris, ou ${
          touche('size.dec', '[') ?? '[' } / ${touche('size.inc', ']') ?? ']'}`}
      >
        <span className="size-dot" style={{ width: size, height: size, background: color }} />
        <input
          type="range"
          min={2}
          max={18}
          step={1}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
      </div>

      <div className="sep" />

      <div className="group">
        <button
          className={`tbtn chip ${fadeDelay == null ? 'active' : ''}`}
          title={bulle(
            fadeDelay == null
              ? 'Fondu coupé (∞) : tes annotations restent jusqu’à ce que tu effaces. Ce bouton fait défiler 2 s, 4 s, 8 s, ∞'
              : `Fondu : chaque trait s’efface seul après ${fadeDelay / 1000} s. Ce bouton fait défiler 2 s, 4 s, 8 s, ∞`,
            'fade.cycle',
            'D',
          )}
          onClick={cycleFade}
        >
          {fadeDelay == null ? <IconInfinity /> : <IconTimer />}
          <span className="chip-label">{fadeDelay == null ? '∞' : `${fadeDelay / 1000}s`}</span>
        </button>
        <button
          className={`tbtn ${sparkles ? 'active' : ''}`}
          title={
            sparkles
              ? 'Étincelles pendant le tracé : allumées'
              : 'Étincelles pendant le tracé : éteintes'
          }
          onClick={toggleSparkles}
        >
          <IconSparkles />
        </button>
        <button
          className={`tbtn ${smartShapes ? 'active' : ''}`}
          title={bulle(
            'Formes intelligentes : ton rectangle tremblé est redressé tout seul (annuler rend le tracé brut)',
            'toggle.smartShapes',
            'W',
          )}
          onClick={toggleSmartShapes}
        >
          <IconWand />
        </button>
        <button
          className={`tbtn ${guides ? 'active' : ''}`}
          title={bulle(
            'Guides magnétiques : les angles et les alignements s’aimantent (Alt les suspend)',
            'toggle.guides',
            'G',
          )}
          onClick={toggleGuides}
        >
          <IconMagnet />
        </button>
        <button
          className={`tbtn ${handwriting ? 'active' : ''}`}
          title="Mode écriture — J : écris à la main, Hexa retrace en typographie (Entrée : tout de suite · annuler rend le gribouillis)"
          onClick={toggleHandwriting}
        >
          <IconScript />
        </button>
        <button
          className={`tbtn ${comparing ? 'active' : ''}`}
          title="Avant / après — U : à gauche l’écran photographié, à droite le direct. Glisse le curseur."
          onClick={onCompare}
        >
          <IconCompare />
        </button>
        <button
          className={`tbtn ${sound ? 'active' : ''}`}
          title={
            sound
              ? 'Sons génératifs actifs — tout est synthétisé, aucun fichier'
              : 'Sons génératifs (coupés par défaut)'
          }
          onClick={toggleSound}
        >
          {sound ? <IconSound /> : <IconMute />}
        </button>
        {sound && (
          <span className="vol-group" title="Volume des sons">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={soundVolume}
              onChange={(e) => setSoundVolume(Number(e.target.value))}
            />
          </span>
        )}
      </div>

      <div className="sep" />

      {/* Éléments posés à l'écran (§5.8) : cadrage, minuteurs, notes.
          Ils ne sont PAS des annotations : ni fondu, ni touche panique. */}
      <div className="group">
        <button
          className={`tbtn ${gridMode !== 'off' ? 'active' : ''}`}
          title={`Cadrage : ${GRID_LABELS[gridMode]} — Ctrl+Maj+G pour changer, molette sur ce bouton pour la discrétion (${Math.round(gridOpacity * 100)} %)`}
          onClick={cycleGrid}
          onWheel={(e) => setGridOpacity(gridOpacity + (e.deltaY < 0 ? 0.02 : -0.02))}
        >
          <IconGrid />
        </button>
        <button
          className="tbtn"
          title="Poser un chrono — Ctrl+Maj+Y (le bouton ↓ de la carte le passe en compte à rebours)"
          onClick={() => spawnClock('chrono')}
        >
          <IconStopwatch />
        </button>
        <button
          className="tbtn"
          title="Poser une note — Ctrl+Maj+B : elle reste à l’écran, même après un « tout effacer »"
          onClick={spawnNote}
        >
          <IconNote />
        </button>
      </div>

      <div className="sep" />

      <div className="group">
        <button className="tbtn" title={bulle('Annuler le dernier trait', 'edit.undo')} onClick={onUndo}>
          <IconUndo />
        </button>
        <button className="tbtn" title={bulle('Rétablir', 'edit.redo')} onClick={onRedo}>
          <IconRedo />
        </button>
        <button
          className="tbtn danger"
          title={bulle('Tout effacer : l’écran redevient net', 'edit.clear')}
          onClick={onClear}
        >
          <IconClear />
        </button>
      </div>

      <div className="sep" />

      <div className="group">
        <button
          className="tbtn"
          title="Exporter la session dans un fichier : à réimporter ou à rejouer plus tard"
          onClick={onExport}
        >
          <IconExport />
        </button>
        <button
          className="tbtn"
          title={bulle('Réglages, thèmes et raccourcis', 'ui.settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <IconGear />
        </button>
        {/* L'aide doit être ATTEIGNABLE À LA SOURIS : personne ne devine tout
            seul qu'une touche « ? » ouvre un panneau. */}
        <button
          className="tbtn"
          title={bulle('Aide : les gestes, les raccourcis, et quoi faire quand ça coince', 'ui.cheatsheet')}
          onClick={() => setCheatsheetOpen(true)}
        >
          <IconHelp />
        </button>
      </div>
    </div>
  )
}
