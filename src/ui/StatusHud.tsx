/**
 * Hexa — lisibilité des états (brief §9.6, §9.7).
 *
 * Deux objets, et deux seulement :
 *
 *  1. LA PASTILLE. Elle n'apparaît que quand la barre d'outils est masquée —
 *     sinon la barre dit déjà tout. Elle rappelle alors l'outil, la couleur,
 *     l'épaisseur, le fondu (et surtout le ∞), et la touche qui ramène la
 *     barre. Sans elle, masquer la barre est un cul-de-sac : plus rien à
 *     l'écran ne dit ce qu'on tient dans la main.
 *
 *  2. LES MESSAGES ÉPHÉMÈRES. Un changement d'état qu'on ne voit pas est un
 *     changement qu'on croit cassé : « souris rendue au jeu », « barre
 *     masquée », « fondu désactivé ». Ils annoncent AUSSI la touche du retour,
 *     donc on n'est jamais coincé. Ils s'effacent seuls en 2,6 s : rien ne
 *     reste sur le direct.
 *
 * Coût : zéro image au repos (aucune rAF, aucun intervalle), un seul
 * setTimeout à la fois, et strictement rien à l'écran quand tout va bien.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { COLORS, useUiStore } from '../store'
import { formatCombo, resolveKeymap, type KeymapAction } from '../keymap'
import { exigerPleinEcran } from './fenetre-compacte'
import './status-hud.css'

/** libellés d'outils — les mêmes mots que la barre et le menu radial */
const TOOL_LABELS: Record<string, string> = {
  pen: 'Pinceau',
  highlight: 'Surligneur',
  line: 'Ligne',
  arrow: 'Flèche',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Texte',
  badge: 'Numéroteur',
  measure: 'Mesure',
  stamp: 'Tampon d’image',
  laser: 'Laser',
  ping: 'Ping',
  spotlight: 'Spotlight',
  magnifier: 'Loupe',
  freeze: 'Gel d’image',
  blur: 'Masque flou',
  eraser: 'Gomme',
}

/** les sept couleurs, nommées comme dans la barre et le menu radial */
const COLOR_NAMES = ['Bleu', 'Rouge', 'Cyan', 'Magenta', 'Vert', 'Jaune', 'Blanc']

const TOAST_MS = 2600

export interface StatusHudProps {
  /** true = la souris est rendue au jeu (fenêtre traversante) */
  passthrough: boolean
}

interface Toast {
  /** identité du message : sert de clé de rendu pour rejouer l'animation */
  id: number
  text: string
  /** touche du retour en arrière, affichée en pastille */
  key?: string
  tone?: 'game' | 'draw'
}

export function StatusHud({ passthrough }: StatusHudProps) {
  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const toolbarVisible = useUiStore((s) => s.toolbarVisible)
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)

  const [toast, setToast] = useState<Toast | null>(null)
  const seq = useRef(0)
  const timer = useRef(0)
  /** valeurs précédentes : un message ne se déclenche que sur un CHANGEMENT */
  const prev = useRef({ passthrough, toolbarVisible, fadeDelay, first: true })

  const bindings = useMemo(
    () => resolveKeymap(keymapPreset, keymapOverrides),
    [keymapPreset, keymapOverrides],
  )
  const keyOf = (action: KeymapAction): string | undefined => {
    const combo = bindings[action]?.[0]
    return combo ? formatCombo(combo) : undefined
  }

  useEffect(() => {
    const show = (text: string, key?: string, tone?: Toast['tone']) => {
      seq.current += 1
      setToast({ id: seq.current, text, key, tone })
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setToast(null), TOAST_MS)
    }

    const p = prev.current
    // Au montage on ne raconte rien : l'utilisateur n'a rien fait.
    if (p.first) {
      prev.current = { passthrough, toolbarVisible, fadeDelay, first: false }
      return
    }

    // Aucun message au changement de mode dessin/traversant. Il était capturé
    // par OBS et partait dans le direct, ce que l'utilisateur refuse — et il
    // était de toute façon redondant : en mode traversant la barre, le curseur
    // et le liseré disparaissent déjà, ce qui se voit immédiatement.
    if (passthrough !== p.passthrough) {
      // rien à dire
    } else if (toolbarVisible !== p.toolbarVisible) {
      if (!toolbarVisible) show('Barre d’outils masquée', keyOf('ui.toolbar'))
      else show('Barre d’outils affichée')
    } else if (fadeDelay !== p.fadeDelay) {
      if (fadeDelay == null) show('Fondu coupé (∞) — tout reste jusqu’à l’effacement')
      else show(`Fondu : les traits s’effacent après ${fadeDelay / 1000} s`)
    }

    prev.current = { passthrough, toolbarVisible, fadeDelay, first: false }
    // `bindings` est volontairement hors dépendances : on ne rejoue pas un
    // message parce que l'utilisateur a remappé une touche.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passthrough, toolbarVisible, fadeDelay])

  // Un message éphémère s'affiche au MILIEU de l'écran, très loin de la barre :
  // tant qu'il est là, la fenêtre d'interface doit couvrir l'écran entier,
  // sinon il serait rogné par la fenêtre compacte (§S12).
  useEffect(() => {
    exigerPleinEcran('message', toast !== null)
  }, [toast])

  // le dernier minuteur part avec le composant
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
      exigerPleinEcran('message', false)
    },
    [],
  )

  // En mode jeu, l'écran doit rester absolument net : seul le message
  // éphémère a le droit d'exister, et il s'en va tout seul.
  const showPill = !passthrough && !toolbarVisible
  const colorIndex = COLORS.indexOf(color)

  return (
    <>
      {showPill && (
        <div className="hx-status" role="status">
          <span className="hx-status-dot" style={{ background: color }} aria-hidden />
          <b>{TOOL_LABELS[tool] ?? tool}</b>
          <span className="hx-status-sep" aria-hidden />
          <span title="Couleur active">
            {colorIndex >= 0 ? COLOR_NAMES[colorIndex] : 'Couleur'}
          </span>
          <span className="hx-status-sep" aria-hidden />
          <span title="Épaisseur du trait (molette)">{size} px</span>
          <span className="hx-status-sep" aria-hidden />
          <span
            className={`hx-status-fade${fadeDelay == null ? ' is-inf' : ''}`}
            title={
              fadeDelay == null
                ? 'Fondu coupé : les annotations restent jusqu’à l’effacement'
                : 'Les annotations s’effacent seules après ce délai'
            }
          >
            {fadeDelay == null ? '∞' : `${fadeDelay / 1000} s`}
          </span>
          {keyOf('ui.toolbar') && (
            <span className="hx-status-hint">
              <kbd>{keyOf('ui.toolbar')}</kbd> barre
            </span>
          )}
        </div>
      )}

      {toast && (
        <div className={`hx-toast${toast.tone ? ` is-${toast.tone}` : ''}`} key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.key && (
            <span className="hx-toast-key">
              <kbd>{toast.key}</kbd> pour revenir
            </span>
          )}
        </div>
      )}
    </>
  )
}

export default StatusHud
