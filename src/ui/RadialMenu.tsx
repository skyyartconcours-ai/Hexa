import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { COLORS, useUiStore } from '../store'
import type { ToolId } from '../engine/types'
import { sfx } from '../audio'
import {
  HexaLogo,
  IconArrow,
  IconBadge,
  IconEllipse,
  IconEraser,
  IconHighlight,
  IconLaser,
  IconLine,
  IconPen,
  IconPing,
  IconRect,
  IconSpotlight,
  IconText,
} from './icons'
import './radial.css'

/**
 * Menu radial (§8.2 : « la fonctionnalité d'ergonomie numéro un »).
 *
 * On maintient le clic droit dans le vide, la roue éclot SOUS le curseur, on
 * glisse vers un secteur, on relâche : c'est sélectionné. Zéro déplacement de
 * souris vers un coin de l'écran, zéro texte permanent, tout se joue à
 * l'aveugle — le geste compte, pas la lecture.
 *
 * Le moteur (engine.ts) décide de l'ouverture : clic droit maintenu 220 ms ET
 * aucune annotation sous le curseur (sinon c'est le grab, comportement
 * historique auquel l'utilisateur tient). Ici on ne fait que le rendu DOM/SVG
 * et le suivi du geste : aucun canvas, aucune boucle d'animation.
 */

/* --------- géométrie (unités SVG = pixels écran, viewBox 1:1) --------- */
const BOX = 300
const C = BOX / 2
const HUB_R = 33
/** anneau intérieur : les 7 couleurs */
const IN_0 = 40
const IN_1 = 72
/** anneau extérieur : les outils */
const OUT_0 = 79
const OUT_1 = 131
/** zone morte centrale : relâcher ici = annuler */
const DEAD_R = 31
/** frontière couleurs / outils au moment du choix */
const SPLIT_R = 76
const TAU = Math.PI * 2

const TOOLS: { id: ToolId; icon: ReactElement; label: string }[] = [
  { id: 'pen', icon: <IconPen />, label: 'Pinceau' },
  { id: 'highlight', icon: <IconHighlight />, label: 'Surligneur' },
  { id: 'line', icon: <IconLine />, label: 'Ligne' },
  { id: 'arrow', icon: <IconArrow />, label: 'Flèche' },
  { id: 'rect', icon: <IconRect />, label: 'Rectangle' },
  { id: 'ellipse', icon: <IconEllipse />, label: 'Ellipse' },
  { id: 'text', icon: <IconText />, label: 'Texte' },
  { id: 'badge', icon: <IconBadge />, label: 'Numéroteur' },
  { id: 'laser', icon: <IconLaser />, label: 'Laser' },
  { id: 'ping', icon: <IconPing />, label: 'Ping' },
  { id: 'spotlight', icon: <IconSpotlight />, label: 'Spotlight' },
  { id: 'eraser', icon: <IconEraser />, label: 'Gomme' },
]

const COLOR_NAMES = ['Cyan', 'Magenta', 'Violet', 'Vert', 'Jaune', 'Orange', 'Blanc']

type Ring = 'tool' | 'color'
interface Hover {
  ring: Ring
  index: number
}

const polar = (r: number, a: number): [number, number] => [C + Math.cos(a) * r, C + Math.sin(a) * r]

/** secteur d'anneau, avec un écart constant EN PIXELS entre les lames */
function ringSector(r0: number, r1: number, a0: number, a1: number, gap = 3.2): string {
  const p0 = gap / r0
  const p1 = gap / r1
  const [x0, y0] = polar(r1, a0 + p1)
  const [x1, y1] = polar(r1, a1 - p1)
  const [x2, y2] = polar(r0, a1 - p0)
  const [x3, y3] = polar(r0, a0 + p0)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`
}

/** index du secteur visé, la première lame étant centrée en haut */
function sectorIndex(angle: number, count: number): number {
  const slice = TAU / count
  let rel = angle + Math.PI / 2 + slice / 2
  rel = ((rel % TAU) + TAU) % TAU
  return Math.floor(rel / slice) % count
}

export interface RadialMenuProps {
  /** point d'ouverture, en coordonnées client (le stage occupe tout l'écran) */
  x: number
  y: number
  onClose: () => void
}

export function RadialMenu({ x, y, onClose }: RadialMenuProps) {
  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const [hover, setHover] = useState<Hover | null>(null)
  const [picked, setPicked] = useState<Hover | null>(null)
  const hoverRef = useRef<Hover | null>(null)
  const closingRef = useRef(false)

  // la roue reste toujours entièrement à l'écran (§8.2 : jamais tronquée)
  const half = BOX / 2
  const m = 10
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const cx = vw < BOX + m * 2 ? vw / 2 : Math.min(Math.max(x, half + m), vw - half - m)
  const cy = vh < BOX + m * 2 ? vh / 2 : Math.min(Math.max(y, half + m), vh - half - m)

  const toolPaths = useMemo(() => {
    const slice = TAU / TOOLS.length
    return TOOLS.map((_, i) => {
      const a0 = -Math.PI / 2 - slice / 2 + i * slice
      return ringSector(OUT_0, OUT_1, a0, a0 + slice)
    })
  }, [])

  const colorPaths = useMemo(() => {
    const slice = TAU / COLORS.length
    return COLORS.map((_, i) => {
      const a0 = -Math.PI / 2 - slice / 2 + i * slice
      return ringSector(IN_0, IN_1, a0, a0 + slice, 2.6)
    })
  }, [])

  const iconPos = useMemo(() => {
    const slice = TAU / TOOLS.length
    const rm = (OUT_0 + OUT_1) / 2
    return TOOLS.map((_, i) => {
      const a = -Math.PI / 2 + i * slice
      return { left: C + Math.cos(a) * rm, top: C + Math.sin(a) * rm }
    })
  }, [])

  // suivi du geste : tout passe par window, le stage garde la capture pointeur
  useEffect(() => {
    sfx.wheelOpen()

    const pick = (h: Hover | null) => {
      const prev = hoverRef.current
      if (prev?.ring === h?.ring && prev?.index === h?.index) return
      hoverRef.current = h
      setHover(h)
      if (h) sfx.tick()
    }

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const r = Math.hypot(dx, dy)
      if (r < DEAD_R) {
        pick(null)
        return
      }
      const a = Math.atan2(dy, dx)
      if (r < SPLIT_R) pick({ ring: 'color', index: sectorIndex(a, COLORS.length) })
      else pick({ ring: 'tool', index: sectorIndex(a, TOOLS.length) })
    }

    const finish = (h: Hover | null) => {
      if (closingRef.current) return
      closingRef.current = true
      const st = useUiStore.getState()
      if (h?.ring === 'tool') {
        st.setTool(TOOLS[h.index].id)
        sfx.tool(h.index)
      } else if (h?.ring === 'color') {
        st.setColor(COLORS[h.index])
        sfx.color(h.index)
      } else {
        sfx.wheelCancel()
      }
      setPicked(h)
      // petite salve de sortie : le secteur choisi flashe, puis la roue s'efface
      setTimeout(onClose, h ? 190 : 130)
    }

    const onUp = () => finish(hoverRef.current)
    const onCancel = () => finish(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    }
    const noMenu = (e: Event) => e.preventDefault()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', noMenu)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', noMenu)
    }
  }, [cx, cy, onClose])

  const shown = picked ?? hover
  const label =
    shown?.ring === 'tool'
      ? TOOLS[shown.index].label
      : shown?.ring === 'color'
        ? COLOR_NAMES[shown.index]
        : null
  const accent = shown?.ring === 'color' ? COLORS[shown.index] : color

  return (
    <div
      className={`radial${picked !== null ? ' is-closing' : ''}`}
      style={{ '--rx': `${cx}px`, '--ry': `${cy}px`, '--accent': accent } as CSSProperties}
      aria-hidden
    >
      <div className="radial-dial">
        <div className="radial-aura" />
        <svg viewBox={`0 0 ${BOX} ${BOX}`} width={BOX} height={BOX}>
          <defs>
            <radialGradient id="radial-hub" cx="50%" cy="42%" r="62%">
              <stop offset="0" stopColor="rgba(255,255,255,0.16)" />
              <stop offset="1" stopColor="rgba(255,255,255,0.02)" />
            </radialGradient>
            {/* lumière rasante venue du haut : c'est ce qui donne le verre */}
            <linearGradient id="radial-sheen" x1="0" y1="0" x2="0" y2={BOX}>
              <stop offset="0" stopColor="rgba(255,255,255,0.13)" />
              <stop offset="0.55" stopColor="rgba(255,255,255,0.03)" />
              <stop offset="1" stopColor="rgba(255,255,255,0.055)" />
            </linearGradient>
          </defs>

          {/* cercle de bordure : ferme l'objet, très discret */}
          <circle className="rim" cx={C} cy={C} r={OUT_1 + 3.5} />

          {/* anneau extérieur : les outils */}
          {toolPaths.map((d, i) => {
            const on = hover?.ring === 'tool' && hover.index === i
            const flash = picked?.ring === 'tool' && picked.index === i
            return (
              <g className="blade" key={TOOLS[i].id} style={{ '--i': i } as CSSProperties}>
                <path
                  d={d}
                  className={`sect sect-tool${on ? ' is-on' : ''}${flash ? ' is-flash' : ''}${
                    TOOLS[i].id === tool ? ' is-current' : ''
                  }`}
                />
              </g>
            )
          })}

          {/* voile de lumière posé sur l'anneau d'outils */}
          <g className="sheen">
            {toolPaths.map((d, i) => (
              <path key={TOOLS[i].id} d={d} fill="url(#radial-sheen)" />
            ))}
          </g>

          {/* anneau intérieur : les 7 couleurs, chacune peinte de sa couleur */}
          {colorPaths.map((d, i) => {
            const on = hover?.ring === 'color' && hover.index === i
            const flash = picked?.ring === 'color' && picked.index === i
            return (
              <g className="blade blade-in" key={COLORS[i]} style={{ '--i': i } as CSSProperties}>
                <path
                  d={d}
                  className={`sect sect-color${on ? ' is-on' : ''}${flash ? ' is-flash' : ''}${
                    COLORS[i] === color ? ' is-current' : ''
                  }`}
                  style={{ '--c': COLORS[i] } as CSSProperties}
                />
              </g>
            )
          })}

          <circle className="hub" cx={C} cy={C} r={HUB_R} fill="url(#radial-hub)" />
          <circle className="hub-ring" cx={C} cy={C} r={HUB_R} />
        </svg>

        {/* icônes : HTML au-dessus du SVG, jamais cliquables (le geste suffit) */}
        <div className="radial-icons">
          {TOOLS.map((t, i) => {
            const on = hover?.ring === 'tool' && hover.index === i
            return (
              <span
                key={t.id}
                className={`ricon${on ? ' is-on' : ''}${t.id === tool ? ' is-current' : ''}`}
                style={
                  {
                    left: `${iconPos[i].left}px`,
                    top: `${iconPos[i].top}px`,
                    '--i': i,
                  } as CSSProperties
                }
              >
                {t.icon}
              </span>
            )
          })}
          <span className="radial-hub-mark">
            {shown?.ring === 'tool' ? (
              TOOLS[shown.index].icon
            ) : shown?.ring === 'color' ? (
              <span className="hub-color" style={{ '--c': COLORS[shown.index] } as CSSProperties} />
            ) : (
              <HexaLogo />
            )}
          </span>
        </div>
      </div>

      {/* Infobulle : le SEUL texte de la roue (§9.4). Au survol elle nomme le
          secteur visé ; tant que rien n'est visé elle rappelle le geste, en
          plus discret — sans ça, un débutant ouvre la roue et se demande ce
          qu'il est censé faire. */}
      <div className={`radial-label${label ? ' is-on' : ' is-hint'}`}>
        {label ?? 'Glisse vers un outil, puis relâche'}
      </div>
    </div>
  )
}
