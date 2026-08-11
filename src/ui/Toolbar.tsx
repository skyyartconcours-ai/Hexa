import type { CSSProperties, ReactElement } from 'react'
import { COLORS, useUiStore } from '../store'
import type { ToolId } from '../engine/types'
import {
  HexaLogo,
  IconArrow,
  IconClear,
  IconEraser,
  IconExport,
  IconGear,
  IconHighlight,
  IconInfinity,
  IconLaser,
  IconLine,
  IconPen,
  IconRedo,
  IconSparkles,
  IconTimer,
  IconUndo,
} from './icons'

const TOOLS: { id: ToolId; icon: ReactElement; label: string; kbd: string }[] = [
  { id: 'pen', icon: <IconPen />, label: 'Pinceau', kbd: 'P' },
  { id: 'highlight', icon: <IconHighlight />, label: 'Surligneur', kbd: 'S' },
  { id: 'line', icon: <IconLine />, label: 'Ligne (Shift : angles 15°)', kbd: 'L' },
  { id: 'arrow', icon: <IconArrow />, label: 'Flèche', kbd: 'F' },
  { id: 'laser', icon: <IconLaser />, label: 'Laser (maintenir Z)', kbd: 'Z' },
  { id: 'eraser', icon: <IconEraser />, label: 'Gomme', kbd: 'E' },
]

export interface ToolbarActions {
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onExport: () => void
}

export function Toolbar({ onUndo, onRedo, onClear, onExport }: ToolbarActions) {
  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const setTool = useUiStore((s) => s.setTool)
  const setColor = useUiStore((s) => s.setColor)
  const setSize = useUiStore((s) => s.setSize)
  const cycleFade = useUiStore((s) => s.cycleFade)
  const toggleSparkles = useUiStore((s) => s.toggleSparkles)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  const hover = (on: boolean) => document.body.classList.toggle('over-ui', on)

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
            title={`${t.label} — ${t.kbd}`}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="sep" />

      <div className="group swatches">
        {COLORS.map((c, i) => (
          <button
            key={c}
            className={`swatch ${color === c ? 'active' : ''}`}
            style={{ '--c': c } as CSSProperties}
            title={`Couleur ${i + 1}`}
            onClick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="sep" />

      <div className="group size-group" title="Taille du pinceau (molette ou [ ])">
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
          title="Durée avant fondu automatique — D (∞ : le board reste jusqu'au clean)"
          onClick={cycleFade}
        >
          {fadeDelay == null ? <IconInfinity /> : <IconTimer />}
          <span className="chip-label">{fadeDelay == null ? '∞' : `${fadeDelay / 1000}s`}</span>
        </button>
        <button
          className={`tbtn ${sparkles ? 'active' : ''}`}
          title="Étincelles pendant le tracé"
          onClick={toggleSparkles}
        >
          <IconSparkles />
        </button>
      </div>

      <div className="sep" />

      <div className="group">
        <button className="tbtn" title="Annuler — Ctrl+Z" onClick={onUndo}>
          <IconUndo />
        </button>
        <button className="tbtn" title="Rétablir — Ctrl+Y" onClick={onRedo}>
          <IconRedo />
        </button>
        <button className="tbtn danger" title="Tout effacer — C" onClick={onClear}>
          <IconClear />
        </button>
      </div>

      <div className="sep" />

      <div className="group">
        <button className="tbtn" title="Exporter la session (JSON rejouable)" onClick={onExport}>
          <IconExport />
        </button>
        <button className="tbtn" title="Réglages et thèmes" onClick={() => setSettingsOpen(true)}>
          <IconGear />
        </button>
      </div>
    </div>
  )
}
