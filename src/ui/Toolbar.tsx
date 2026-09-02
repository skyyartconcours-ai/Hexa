import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { COLORS, TOOLBAR_FADE_STEPS, useUiStore } from '../store'
import type { ToolId } from '../engine/types'
import { GRID_LABELS } from '../engine/stream-fx'
import {
  eventCombos,
  formatCombo,
  KEYMAP_BY_ACTION,
  resolveKeymap,
  type KeymapAction,
} from '../keymap'
import {
  dockRect,
  EDGE_LABELS,
  EDGE_MARGIN,
  edgePreviewStyle,
  MARGE_OMBRE,
  memePlacement,
  nearestEdge,
  offsetAlongEdge,
  placeDock,
  placementStyle,
  rectFenetreBarre,
  resolveOrientation,
  type DockPlacement,
  type ToolbarEdge,
} from './toolbar-dock'
import {
  abonnerCompacte,
  compactPossible,
  estCompacte,
  exigerPleinEcran,
  publierRectBarre,
} from './fenetre-compacte'
import { bridge, libelleBuild } from '../bridge'
import { spawnClock, spawnNote } from './StageWidgets'
import {
  HexaLogo,
  IconArrow,
  IconBadge,
  IconObs,
  IconBlur,
  IconClear,
  IconCompare,
  IconEllipse,
  IconEye,
  IconEyeOff,
  IconFadeBar,
  IconFreeze,
  IconImage,
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
  IconJalon,
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
const COLOR_NAMES = ['Bleu clair', 'Rouge', 'Bleu', 'Magenta', 'Vert', 'Jaune', 'Blanc']

/** « build 37 » — le numéro de la Release GitHub, lu dans le coin de la barre */
const VERSION_BARRE = libelleBuild()

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
  {
    id: 'arrow',
    icon: <IconArrow />,
    label: 'Flèche (trace ta courbe, elle l’épouse · Maj : flèche droite)',
    kbd: 'F',
    action: 'tool.arrow',
  },
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
    id: 'marker',
    icon: <IconJalon />,
    label: 'Jalons : 1, 2, 3… posés sans être reliés',
    kbd: 'Y',
    action: 'tool.marker',
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
  {
    id: 'ping',
    icon: <IconPing />,
    label: 'Ping : un clic, un repère qui bat',
    kbd: 'Q',
    action: 'hold.ping',
    hold: true,
  },
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
      'Masque flou : trace un rectangle sur ce qu’il ne faut pas montrer (clic droit : déplacer · la croix le retire)',
    kbd: 'B',
    action: 'tool.blur',
  },
]

/* ------------------------------------------------------------------ *
 * Orientation, ancrage, écran porteur (§S4)
 * ------------------------------------------------------------------ */

/** Poignée de préhension : six points, le geste universel du « ça se déplace ». */
function IconGrip(): ReactElement {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden focusable="false">
      <g fill="currentColor">
        <circle cx="4" cy="2" r="1.15" />
        <circle cx="8" cy="2" r="1.15" />
        <circle cx="4" cy="6" r="1.15" />
        <circle cx="8" cy="6" r="1.15" />
        <circle cx="4" cy="10" r="1.15" />
        <circle cx="8" cy="10" r="1.15" />
      </g>
    </svg>
  )
}

/** Bascule d'orientation : deux barres, l'une debout, l'autre couchée. */
function IconOrient({ vertical }: { vertical: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden focusable="false">
      <rect
        x={vertical ? 4.5 : 2}
        y={vertical ? 2 : 4.5}
        width={vertical ? 5 : 16}
        height={vertical ? 16 : 5}
        rx="1.6"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x={vertical ? 12 : 2}
        y={vertical ? 4.5 : 12}
        width={vertical ? 5 : 16}
        height={vertical ? 11 : 5}
        rx="1.6"
        fill="currentColor"
        opacity="0.32"
      />
    </svg>
  )
}

/**
 * Cette fenêtre porte-t-elle la barre ?
 *
 * ⚠️ POINT CRITIQUE du multi-écrans : Hexa ouvre UNE FENÊTRE PAR ÉCRAN et chacune
 * monte l'interface React complète. Sans ce garde-fou, la barre d'outils
 * apparaîtrait sur TOUS les écrans — donc en plein milieu de ce que les
 * spectateurs regardent, exactement ce qu'il fallait éviter.
 *
 * Le processus principal désigne UN écran porteur (le plus à droite, sinon
 * l'écran principal) et le dit à chaque fenêtre via `--hexa-display`
 * (`toolbarHost`). Les annotations, elles, restent disponibles PARTOUT : seule
 * la barre est confinée. En démo navigateur il n'y a pas de passerelle : on
 * affiche la barre, évidemment.
 */
export function useToolbarHost(): boolean {
  const [host, setHost] = useState(() => bridge.display?.toolbarHost !== false)
  useEffect(
    () =>
      // Un écran débranché peut déplacer le porteur : le processus principal
      // renvoie alors un 'display-changed' à CHAQUE fenêtre, porteuse ou non.
      bridge.on('display-changed', (info) => {
        if (info && typeof info.toolbarHost === 'boolean') setHost(info.toolbarHost)
      }),
    [],
  )
  return host
}

/**
 * Taille de la zone de placement, en pixels CSS — c'est-à-dire L'ÉCRAN.
 *
 * ⚠️⚠️ LE PIÈGE CENTRAL DU MODE COMPACT (§S12), ET LA RAISON DE CETTE FONCTION.
 *
 * La barre calculait sa position par rapport à SA FENÊTRE (`window.innerWidth`).
 * C'était exact tant que cette fenêtre couvrait l'écran entier. Dès qu'on la
 * réduit à la taille de la barre, `window.innerWidth` vaut la largeur de LA
 * BARRE : `placeDock` replacerait alors la barre par rapport à un cadre de
 * 141 px, donc dans le coin, donc la fenêtre se reposerait ailleurs, donc le
 * cadre changerait encore… La barre partirait en vrille dans un coin de l'écran
 * en se redimensionnant sans fin — la boucle de composition qu'on cherche
 * précisément à éteindre.
 *
 * LA RÈGLE, DONC : la barre raisonne TOUJOURS en coordonnées ÉCRAN. Sa position
 * ne dépend jamais de la taille de sa propre fenêtre, ce qui rend le calcul
 * IDEMPOTENT : réduire la fenêtre ne change pas le résultat, donc ne provoque
 * aucun replacement, donc aucune boucle. En mode compact, la barre est rendue
 * dans le coin de sa fenêtre (à la marge d'ombre près) pendant que le processus
 * principal pose cette fenêtre aux coordonnées écran calculées ici.
 *
 * Hors fenêtre d'interface séparée (démo navigateur, mode fusionné), la fenêtre
 * EST la zone de travail : on garde `innerWidth`/`innerHeight`, sans quoi la
 * barre se placerait hors du cadre du navigateur.
 */
function ecranParDefaut(): { width: number; height: number } {
  if (!compactPossible) return { width: window.innerWidth, height: window.innerHeight }
  const b = bridge.display?.bounds
  if (b && b.width > 0 && b.height > 0) return { width: b.width, height: b.height }
  // Repli : `window.screen` est déjà en pixels CSS (logiques), comme les bounds
  // d'Electron. Dernier repli, la fenêtre elle-même — juste au démarrage, où
  // elle couvre encore tout l'écran.
  const s = typeof window.screen === 'object' ? window.screen : null
  if (s && s.width > 0 && s.height > 0) return { width: s.width, height: s.height }
  return { width: window.innerWidth, height: window.innerHeight }
}

export interface ToolbarActions {
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onExport: () => void
  /** PNG transparent de la page courante, en un clic (miniature, VOD) */
  onExportPng: () => void
  /** gel d'image (§5.5) : l'écran se fige, on annote la photo */
  onFreeze: () => void
  /** avant/après (§5.7) : photo à gauche, direct à droite */
  onCompare: () => void
  /** état de la couche d'effets, pour allumer les deux boutons ci-dessus */
  frozen: boolean
  comparing: boolean
  /** la souris est rendue au jeu : la barre ne s'efface pas, elle est déjà discrète */
  passthrough: boolean
}

export function Toolbar({
  onUndo,
  onRedo,
  onClear,
  onExport,
  onExportPng,
  onFreeze,
  onCompare,
  frozen,
  comparing,
  passthrough,
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
  const badgeContinuous = useUiStore((s) => s.badgeContinuous)
  const prevColor = useUiStore((s) => s.prevColor)
  const annotationsHidden = useUiStore((s) => s.annotationsHidden)
  const toggleAnnotationsHidden = useUiStore((s) => s.toggleAnnotationsHidden)
  const toggleBadgeContinuous = useUiStore((s) => s.toggleBadgeContinuous)
  const gridMode = useUiStore((s) => s.gridMode)
  const gridOpacity = useUiStore((s) => s.gridOpacity)
  const cycleGrid = useUiStore((s) => s.cycleGrid)
  const setGridOpacity = useUiStore((s) => s.setGridOpacity)
  const toggleSparkles = useUiStore((s) => s.toggleSparkles)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setCheatsheetOpen = useUiStore((s) => s.setCheatsheetOpen)
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)
  const toolbarEdge = useUiStore((s) => s.toolbarEdge)
  const toolbarOffset = useUiStore((s) => s.toolbarOffset)
  const toolbarOrientation = useUiStore((s) => s.toolbarOrientation)
  const setToolbarDock = useUiStore((s) => s.setToolbarDock)
  const setToolbarOrientation = useUiStore((s) => s.setToolbarOrientation)
  const toggleToolbarOrientation = useUiStore((s) => s.toggleToolbarOrientation)
  const pageIndex = useUiStore((s) => s.pageIndex)
  const pageCount = useUiStore((s) => s.pageCount)
  const nextPage = useUiStore((s) => s.nextPage)
  const prevPage = useUiStore((s) => s.prevPage)
  const newPage = useUiStore((s) => s.newPage)
  const duplicatePage = useUiStore((s) => s.duplicatePage)
  const setPage = useUiStore((s) => s.setPage)
  const toolbarFade = useUiStore((s) => s.toolbarFade)
  const cycleToolbarFade = useUiStore((s) => s.cycleToolbarFade)
  const notify = useUiStore((s) => s.notify)

  /** L'adresse pour OBS, copiée d'un clic (bouton « OBS » de la barre). */
  const copierAdresseObs = async () => {
    const r = await bridge.copierAdresseObs()
    if (!r) notify('Adresse OBS introuvable : ouvre Réglages → OBS')
    else if (r.copie) notify(`Adresse copiée pour OBS : ${r.adresse} — colle-la dans une source « Navigateur »`)
    else notify(`Adresse pour OBS (copie impossible) : ${r.adresse}`)
  }

  const hover = (on: boolean) => document.body.classList.toggle('over-ui', on)

  const isHost = useToolbarHost()
  const orient = resolveOrientation(toolbarEdge, toolbarOrientation)
  const vertical = orient === 'vertical'

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

  /* ---------------- Touche Fin maintenue : les raccourcis (§S4.4) --------- *
   * Le libellé court vient de la table des raccourcis (« Pinceau », « Flèche »)
   * et jamais du texte d'info-bulle, qui est une phrase entière. À défaut, on
   * coupe le libellé de la barre à sa première ponctuation.                  */
  const [hints, setHints] = useState(false)
  const hintCombos = useMemo(() => new Set(bindings['ui.hints'] ?? []), [bindings])
  useEffect(() => {
    if (hintCombos.size === 0) return
    const concerne = (e: KeyboardEvent) => eventCombos(e).some((c) => hintCombos.has(c))
    const down = (e: KeyboardEvent) => {
      if (e.repeat || !concerne(e)) return
      e.preventDefault()
      setHints(true)
    }
    const up = (e: KeyboardEvent) => {
      if (concerne(e)) setHints(false)
    }
    // Perdre le focus la touche enfoncée laisserait la barre gonflée pour
    // toujours : le relâché n'arriverait jamais.
    const off = () => setHints(false)
    // ⚠️ EN MODE DEUX FENÊTRES, LA FRAPPE N'ARRIVE JAMAIS ICI : cette fenêtre
    // n'a pas le focus clavier (§12.2). La couche encre nous relaie l'appui et
    // le relâché par cet événement — sans lui, la touche Fin ne ferait rien.
    const relais = (e: Event) => setHints((e as CustomEvent<boolean>).detail === true)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    window.addEventListener('hexa:hints', relais)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
      window.removeEventListener('hexa:hints', relais)
    }
  }, [hintCombos])

  /**
   * Nom court : le libellé de la barre coupé à sa première ponctuation
   * (« Flèche (trace ta courbe…) » → « Flèche »), à défaut celui de la table
   * des raccourcis. Dans cet ordre : le libellé de la barre est écrit pour être
   * lu ICI, celui de la table pour être lu dans l'éditeur de raccourcis.
   */
  const nomCourt = (label: string, action?: KeymapAction): string => {
    const court = label.split(/\s+[(—:·]/)[0].trim()
    if (court) return court
    return (action ? KEYMAP_BY_ACTION[action]?.label : undefined) ?? label
  }

  /**
   * Rappel posé dans le bouton tant que la touche Fin est tenue.
   *
   * En vertical, le nom s'affiche même sans raccourci : sinon la moitié des
   * lignes resteraient de simples icônes au milieu de lignes légendées, et la
   * colonne aurait l'air trouée. En horizontal il n'y a place que pour la
   * touche : un bouton sans raccourci ne montre donc rien.
   */
  const rappel = (label: string, action?: KeymapAction, repli?: string): ReactNode => {
    if (!hints) return null
    const k = touche(action, repli)
    if (!k && !vertical) return null
    return (
      <span className="tb-hint">
        <span className="tb-hint-name">{nomCourt(label, action)}</span>
        {k && <span className="tb-hint-key">({k})</span>}
      </span>
    )
  }

  /* ---------------- Placement : ancrage, glisser, bornage (§S4.2-3) ------- */
  const barRef = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState<DockPlacement | null>(null)
  const [drag, setDrag] = useState<{ left: number; top: number; edge: ToolbarEdge } | null>(null)
  /** La fenêtre est-elle réduite au rectangle de la barre en ce moment ? (§S12) */
  const compacte = useSyncExternalStore(abonnerCompacte, estCompacte, estCompacte)

  /**
   * Taille de l'écran porteur, tenue à jour. L'instantané du preload devient
   * faux dès qu'on change de résolution ou passe de 100 % à 125 % : sans cette
   * mise à jour, la barre se placerait d'après un écran qui n'existe plus.
   */
  const ecranRef = useRef(ecranParDefaut())
  const zone = useCallback((): { width: number; height: number } => {
    if (!compactPossible) return { width: window.innerWidth, height: window.innerHeight }
    return ecranRef.current
  }, [])

  /**
   * Recalcule la position à partir du bord, de la proportion mémorisée et de la
   * TAILLE RÉELLE de la barre. Rejoué à chaque changement de taille (thème,
   * raccourcis affichés, repli sur deux rangs) et à chaque redimensionnement de
   * l'écran : c'est ce qui ramène tout seul la barre dans le cadre quand la
   * position mémorisée vient d'un écran débranché.
   */
  const replacer = useCallback(() => {
    const el = barRef.current
    if (!el) return
    const vue = zone()
    // ⚠️ AVANT DE MESURER : la barre se replie d'après `100vw`/`100vh`
    // (`max-width: calc(100vw - 28px)` en horizontal, `max-height` en vertical).
    // En fenêtre compacte, ces unités valent la taille de la BARRE : la règle la
    // rognerait de quelques pixels, ce qui rétrécirait la fenêtre, ce qui la
    // rognerait encore — la boucle de rétrécissement. On publie donc la taille
    // de l'ÉCRAN, dont la feuille de style se sert en mode compact (§S12).
    const racine = document.documentElement
    racine.style.setProperty('--hexa-ecran-w', `${vue.width}px`)
    racine.style.setProperty('--hexa-ecran-h', `${vue.height}px`)
    // Même raison pour la DENSITÉ de la barre, qui se resserre sur un écran
    // court. C'étaient deux media queries `max-height` — donc mesurées sur la
    // FENÊTRE : en fenêtre compacte, la barre se resserrait parce qu'elle était
    // seule dans un cadre à sa taille, ce qui rétrécissait le cadre, ce qui la
    // resserrait encore. Mesurée sur l'ÉCRAN, la densité est constante et la
    // barre ne bouge plus d'un pixel entre mode dessin et mode traversant.
    racine.classList.toggle('ecran-court', vue.height <= 900)
    racine.classList.toggle('ecran-tres-court', vue.height <= 760)
    // offsetWidth/Height et NON getBoundingClientRect : le rectangle client est
    // le rectangle TRANSFORMÉ. Pendant l'animation d'entrée (scale 0.97) il
    // annonce une barre 3 % plus petite qu'elle ne sera, et la barre se posait
    // vingt pixels trop bas — un décalage que rien ne venait ensuite corriger,
    // puisque la taille de mise en page, elle, n'avait pas bougé.
    const width = el.offsetWidth
    const height = el.offsetHeight
    if (width === 0 && height === 0) return
    const p = placeDock({ edge: toolbarEdge, offset: toolbarOffset }, { width, height }, vue)
    // Même placement = même objet : un rendu de plus par mouvement de souris ne
    // servirait à rien, et ferait clignoter les mesures des tests.
    setPlace((avant) => (avant && memePlacement(avant, p) ? avant : p))
    // La fenêtre voulue quand la barre est seule à l'écran : son rectangle en
    // coordonnées ÉCRAN, ombre comprise. L'arbitre (fenetre-compacte.ts) décide
    // s'il faut réellement s'y réduire, et n'en parle au processus principal que
    // si la cible a bougé.
    publierRectBarre(rectFenetreBarre(dockRect(p, { width, height }, vue)))
    // Place réellement occupée EN BAS de l'écran, publiée pour le reste de
    // l'interface (indicateur d'outil, messages de la loupe). Elle valait
    // 92 px en dur dans styles.css, calés sur une barre d'un seul rang : dès
    // que la barre se repliait sur deux rangs, l'indicateur tombait dedans et
    // masquait la moitié de la palette à chaque changement d'outil.
    document.documentElement.style.setProperty(
      '--hexa-tb-bas',
      toolbarEdge === 'bottom' ? `${Math.round(height) + EDGE_MARGIN}px` : '0px',
    )
  }, [toolbarEdge, toolbarOffset, zone])

  useLayoutEffect(() => {
    replacer()
    const el = barRef.current
    // ResizeObserver plutôt qu'une boucle : il ne se réveille QUE si la barre
    // change de taille, et se rendort aussitôt. Zéro processeur au repos.
    // C'est aussi lui qui met la FENÊTRE à jour quand la touche Fin élargit la
    // barre pour afficher les raccourcis (§S12).
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(replacer)
    if (el && ro) ro.observe(el)
    window.addEventListener('resize', replacer)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', replacer)
      // barre masquée (Ctrl+H) : plus rien n'est réservé en bas de l'écran
      document.documentElement.style.removeProperty('--hexa-tb-bas')
      // …et plus aucune barre à loger : la fenêtre reprend l'écran entier
      // (avant, le plus souvent, de se retirer complètement).
      publierRectBarre(null)
    }
  }, [replacer, orient, hints])

  // Filet : la barre démontée en plein glisser (masquée au clavier, écran
  // débranché, panne de la couche) laisserait sa fenêtre bloquée en plein écran.
  useEffect(() => () => exigerPleinEcran('glisser', false), [])

  // Un écran redimensionné, pivoté ou passé à 125 % déplace la barre : elle se
  // replace d'après le NOUVEL écran, jamais d'après l'instantané du démarrage.
  useEffect(
    () =>
      bridge.on('display-changed', (info) => {
        const b = info?.bounds
        if (!b || !(b.width > 0) || !(b.height > 0)) return
        ecranRef.current = { width: b.width, height: b.height }
        replacer()
      }),
    [replacer],
  )

  const onGripDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = barRef.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    // ⚠️ PLEIN ÉCRAN OBLIGATOIRE PENDANT LE GESTE, et réclamé TOUT DE SUITE
    // (pas dans un effet) : l'aperçu d'ancrage est un liseré qui court le long
    // des bords de l'ÉCRAN, et la barre doit pouvoir se promener partout. Dans
    // une fenêtre à sa taille, on ne pourrait pas la sortir de son coin.
    exigerPleinEcran('glisser', true)
    const r = el.getBoundingClientRect()
    // dx/dy sont pris DANS la barre : ils restent justes quelle que soit la
    // taille de la fenêtre, y compris pendant qu'elle repasse en plein écran.
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    hover(true)
    // Point de départ en coordonnées ÉCRAN : en compact, `r.left` vaut la marge
    // d'ombre, et la barre sauterait dans le coin le temps d'une image.
    const depart =
      compacte && place
        ? dockRect(place, { width: r.width, height: r.height }, zone())
        : { x: r.left, y: r.top }
    setDrag({ left: depart.x, top: depart.y, edge: toolbarEdge })
    const suivre = (ev: PointerEvent) => {
      const rr = el.getBoundingClientRect()
      const left = ev.clientX - dx
      const top = ev.clientY - dy
      setDrag({ left, top, edge: nearestEdge(left + rr.width / 2, top + rr.height / 2, zone()) })
    }
    const lacher = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', suivre)
      const rr = el.getBoundingClientRect()
      const left = ev.clientX - dx
      const top = ev.clientY - dy
      const view = zone()
      const cx = left + rr.width / 2
      const cy = top + rr.height / 2
      const edge = nearestEdge(cx, cy, view)
      setToolbarDock(edge, offsetAlongEdge(edge, cx, cy, view))
      // Lâcher la barre sur un bord, c'est CHOISIR ce bord : l'orientation
      // redevient celle qui va avec (verticale à gauche/droite, horizontale en
      // haut/bas). Un ancrage à gauche qui resterait horizontal serait absurde.
      setToolbarOrientation('auto')
      setDrag(null)
      exigerPleinEcran('glisser', false)
    }
    window.addEventListener('pointermove', suivre)
    window.addEventListener('pointerup', lacher, { once: true })
  }

  /* ---------------- LA BARRE QUI S'EFFACE ---------------------------------
   * En mode dessin, après `toolbarFade` secondes sans survol ni changement
   * d'outil/couleur/taille/fondu, la barre s'estompe (opacité seulement : elle
   * reste là, à sa place, cliquable) et revient dès que la souris s'en
   * APPROCHE — pas dès qu'elle bouge : un coach qui trace une flèche ne veut
   * pas que la barre se rallume au milieu de son geste.
   *
   * Coût au repos : un seul setTimeout armé. L'écouteur de mouvement n'est posé
   * QUE pendant que la barre est estompée, et ne fait qu'une comparaison de
   * rectangle — sans mouvement de souris, rien ne s'exécute. */
  const [dim, setDim] = useState(false)
  const fadeActif = toolbarFade > 0 && !passthrough && !drag
  // une « frappe » (outil, couleur, taille, fondu, page, masquage) rallume la
  // barre : ce sont les gestes du clavier qui traversent le store jusqu'ici
  // (« hints » : la touche Fin maintenue pour lire les raccourcis — une barre
  // qui s'estomperait pendant qu'on la lit serait un contresens)
  useEffect(() => {
    setDim(false)
  }, [tool, color, size, fadeDelay, pageIndex, annotationsHidden, hints])
  // un seul minuteur, armé tant que la barre est nette et que le réglage est
  // actif ; réarmé à chaque rallumage et à chaque frappe
  useEffect(() => {
    if (!fadeActif) {
      setDim(false)
      return
    }
    if (dim) return
    const t = setTimeout(() => setDim(true), toolbarFade * 1000)
    return () => clearTimeout(t)
  }, [dim, fadeActif, toolbarFade, tool, color, size, fadeDelay, pageIndex, annotationsHidden, hints])
  useEffect(() => {
    if (!dim) return
    const el = barRef.current
    if (!el) return
    // Le rectangle est lu UNE fois, à l'estompage : une barre estompée ne
    // bouge pas (le glisser la rallume). Le lire à chaque mouvement forçait
    // une mise en page par événement de souris — mesuré sur la campagne DPI :
    // le trait prenait 2 px de retard sur le curseur pendant que la barre
    // était estompée. En mode fenêtre unique, c'est la même page que l'encre.
    const r = el.getBoundingClientRect()
    // marge d'approche : la barre revient AVANT que le curseur ne la touche,
    // pour que le premier clic tombe sur une barre déjà nette
    const m = 70
    const approche = (e: PointerEvent) => {
      if (
        e.clientX >= r.left - m &&
        e.clientX <= r.right + m &&
        e.clientY >= r.top - m &&
        e.clientY <= r.bottom + m
      ) {
        setDim(false)
      }
    }
    window.addEventListener('pointermove', approche, { passive: true })
    return () => window.removeEventListener('pointermove', approche)
  }, [dim])

  // Cette fenêtre ne porte pas la barre (écran de gauche d'une configuration à
  // deux écrans) : on annote quand même, mais sans barre par-dessus le jeu.
  if (!isHost) return null

  const pose: CSSProperties = drag
    ? { left: drag.left, top: drag.top, right: 'auto', bottom: 'auto' }
    : compacte
      ? // FENÊTRE À LA TAILLE DE LA BARRE (§S12) : la barre se pose dans le coin
        // de sa fenêtre — c'est la FENÊTRE qui est aux coordonnées calculées,
        // posée par le processus principal. La marge d'ombre est le seul décalage.
        { left: MARGE_OMBRE, top: MARGE_OMBRE, right: 'auto', bottom: 'auto' }
      : place
        ? (placementStyle(place) as CSSProperties)
        : // Avant la toute première mesure, mieux vaut invisible qu'au mauvais
          // endroit : personne ne doit voir la barre sauter à l'ouverture.
          { visibility: 'hidden' }

  return (
    <div
      ref={barRef}
      className={`toolbar ${vertical ? 'vertical' : 'horizontal'} edge-${toolbarEdge} ${
        hints ? 'hints' : ''
      } ${drag ? 'dragging' : ''} ${dim ? 'is-dim' : ''}`}
      style={{ '--accent': color, ...pose } as CSSProperties}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
    >
      {/* Aperçu d'ancrage : un liseré sur le bord visé, hors de la barre (donc
          par portail — la barre porte un backdrop-filter, qui piégerait un
          enfant en position fixe dans son propre repère). */}
      {drag &&
        createPortal(
          <div className="dock-preview" aria-hidden>
            <span className="dock-preview-edge" style={edgePreviewStyle(drag.edge)} />
            <span className={`dock-preview-word edge-${drag.edge}`}>{EDGE_LABELS[drag.edge]}</span>
          </div>,
          document.body,
        )}

      <div className="tb-handle">
        <span
          className="brand grip"
          title={`Hexa — glisse cette poignée pour déplacer la barre (elle s’ancre aux bords · actuellement ${EDGE_LABELS[toolbarEdge]})`}
          onPointerDown={onGripDown}
        >
          <HexaLogo />
          <span className="grip-dots" aria-hidden>
            <IconGrip />
          </span>
        </span>
        {/* Orientation et adresse OBS CÔTE À CÔTE. L'adresse pour OBS se copie
            d'un clic, dans l'outil — pas au fond d'un panneau ni dans un menu de
            la zone de notification : le streamer la cherche pendant qu'il monte
            sa scène. Placée ici, la puce partage la rangée du bouton
            d'orientation quand la barre est debout : posée parmi les autres
            puces, elle prenait une rangée entière et la barre débordait d'un
            écran de 900 px avec Fin tenu (mesure s4-barre-fin). Le processus
            principal copie, ce qui marche même sans le focus. */}
        <span className="tb-handle-btns">
          <button
            className="tbtn tb-orient"
            title={bulle(
              vertical
                ? 'Barre verticale — passer à l’horizontale'
                : 'Barre horizontale — passer à la verticale',
              'ui.toolbar.orient',
            )}
            onClick={toggleToolbarOrientation}
          >
            <IconOrient vertical={vertical} />
          </button>
          {/* Ni `chip` ni `chip-label` ici : ces classes désignent les puces
              d'ÉTAT (fondu, numérotation), que l'aide, la découverte guidée et
              les campagnes repèrent par « la première puce de la barre ». */}
          <button
            className="tbtn tb-obs"
            title="Copier l’adresse pour OBS — colle-la dans une source « Navigateur » (Sources → + → Navigateur), largeur et hauteur de ton écran d’annotation. Le fond est déjà transparent."
            onClick={() => void copierAdresseObs()}
          >
            <IconObs />
            <span className="tb-obs-label">OBS</span>
          </button>
        </span>
      </div>

      {/* LE NUMÉRO DE BUILD, LISIBLE SANS RIEN OUVRIR : « build 37 » dans le coin
          de la barre — le même numéro que la Release GitHub. Posé en absolu dans
          la marge, il n'ajoute pas un pixel à la hauteur de la barre. */}
      {VERSION_BARRE && (
        <span className="tb-version" title={`Hexa ${VERSION_BARRE}`} aria-hidden>
          {VERSION_BARRE}
        </span>
      )}

      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tbtn ${tool === t.id ? 'active' : ''}`}
            title={bulle(t.label, t.action, t.kbd, t.hold)}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
            {rappel(t.label, t.action, t.kbd)}
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
          {rappel('Gel d’image', 'hold.freeze', 'V')}
        </button>
      </div>

      <div className="sep" />

      {/* Les pastilles sont détourées au clip-path : un enfant y serait
          découpé avec elles. Le rappel de touche vit donc DANS LA CELLULE,
          à côté de l'hexagone, jamais dedans. */}
      {/* LE DUO SE LIT SUR LA PASTILLE ACTIVE : un point de la couleur précédente à
          son coin (CSS, --duo-prev), et Tab pour l'échanger. Aucun bouton de plus :
          avec Fin tenu, la barre débordait de l'écran avec deux boutons ajoutés. */}
      <div className="group swatches" style={{ '--duo-prev': prevColor } as CSSProperties}>
        {COLORS.map((c, i) => (
          <span className="swatch-cell" key={c}>
            <button
              className={`swatch ${color === c ? 'active' : ''}`}
              style={{ '--c': c } as CSSProperties}
              title={
                color === c
                  ? `${COLOR_NAMES[i] ?? `Couleur ${i + 1}`} (active) — Tab revient à la précédente, ${COLOR_NAMES[COLORS.indexOf(prevColor)] ?? prevColor}. Chaque couleur garde sa propre numérotation.`
                  : bulle(COLOR_NAMES[i] ?? `Couleur ${i + 1}`, `color.${i + 1}` as KeymapAction)
              }
              onClick={() => setColor(c)}
            />
            {rappel(COLOR_NAMES[i] ?? `Couleur ${i + 1}`, `color.${i + 1}` as KeymapAction)}
          </span>
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
          {rappel('Durée du fondu', 'fade.cycle', 'D')}
        </button>
        <button
          className={`tbtn chip ${badgeContinuous ? 'active' : ''}`}
          title={
            badgeContinuous
              ? 'Numérotation continue : pastilles ET jalons s’enchaînent d’une couleur à l’autre. Clique pour que chaque couleur reparte de 1.'
              : 'Numérotation par couleur : chaque couleur repart de 1, pour les pastilles comme pour les jalons. Clique pour poursuivre la même série d’une couleur à l’autre.'
          }
          onClick={toggleBadgeContinuous}
        >
          <IconBadge />
          <span className="chip-label">{badgeContinuous ? '1→n' : '1|1'}</span>
          {rappel('Numérotation', 'toggle.linkBadges')}
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
          {rappel('Étincelles')}
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
          {rappel('Formes intelligentes', 'toggle.smartShapes', 'W')}
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
          {rappel('Guides magnétiques', 'toggle.guides', 'G')}
        </button>
        <button
          className={`tbtn ${handwriting ? 'active' : ''}`}
          title={bulle(
            'Mode écriture : écris tes CAPITALES à la main, chaque lettre est retracée en typographie juste après (Entrée : tout de suite · annuler rend le gribouillis)',
            'toggle.handwriting',
            'J',
          )}
          onClick={toggleHandwriting}
        >
          <IconScript />
          {rappel('Mode écriture', 'toggle.handwriting', 'J')}
        </button>
        <button
          className={`tbtn ${comparing ? 'active' : ''}`}
          title={bulle(
            'Avant / après : à gauche l’écran photographié, à droite le direct. Glisse le curseur.',
            'fx.compare',
            'U',
          )}
          onClick={onCompare}
        >
          <IconCompare />
          {rappel('Avant / après', 'fx.compare', 'U')}
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
          {rappel('Sons')}
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
          title={bulle(
            `Cadrage : ${GRID_LABELS[gridMode]} — molette sur ce bouton pour la discrétion (${Math.round(
              gridOpacity * 100,
            )} %) · ce bouton fait défiler les cadrages`,
            'stage.grid',
          )}
          onClick={cycleGrid}
          onWheel={(e) => setGridOpacity(gridOpacity + (e.deltaY < 0 ? 0.02 : -0.02))}
        >
          <IconGrid />
          {rappel('Cadrage', 'stage.grid')}
        </button>
        <button
          className="tbtn"
          title={bulle(
            'Poser un chrono (le bouton ↓ de la carte le passe en compte à rebours)',
            'stage.clock',
          )}
          onClick={() => spawnClock('chrono')}
        >
          <IconStopwatch />
          {rappel('Chrono', 'stage.clock')}
        </button>
        <button
          className="tbtn"
          title={bulle(
            'Poser une note : elle reste à l’écran, même après un « tout effacer »',
            'stage.note',
          )}
          onClick={spawnNote}
        >
          <IconNote />
          {rappel('Note', 'stage.note')}
        </button>
      </div>

      <div className="sep" />

      <div className="group">
        <button className="tbtn" title={bulle('Annuler le dernier trait', 'edit.undo')} onClick={onUndo}>
          <IconUndo />
          {rappel('Annuler', 'edit.undo')}
        </button>
        <button className="tbtn" title={bulle('Rétablir', 'edit.redo')} onClick={onRedo}>
          <IconRedo />
          {rappel('Rétablir', 'edit.redo')}
        </button>
        <button
          className={`tbtn ${annotationsHidden ? 'active' : ''}`}
          title={bulle(
            annotationsHidden
              ? 'Annotations masquées — rien n’est perdu, le fondu est suspendu. Clique pour les remontrer.'
              : 'Masquer les annotations sans les effacer (le fondu se met en pause)',
            'ui.hideInk',
          )}
          onClick={toggleAnnotationsHidden}
        >
          {annotationsHidden ? <IconEyeOff /> : <IconEye />}
          {rappel(annotationsHidden ? 'Remontrer' : 'Masquer', 'ui.hideInk')}
        </button>
        <button
          className="tbtn danger"
          title={bulle('Tout effacer : l’écran redevient net', 'edit.clear')}
          onClick={onClear}
        >
          <IconClear />
          {rappel('Tout effacer', 'edit.clear')}
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
          {rappel('Exporter')}
        </button>
        <button
          className="tbtn"
          title={bulle(
            'Image PNG transparente de cette page : les annotations seules, sans le fond ni la barre — pour une miniature ou une VOD',
            'export.png',
          )}
          onClick={onExportPng}
        >
          <IconImage />
          {rappel('Image PNG', 'export.png')}
        </button>
        {/* PAGES D'ANNOTATION : le plan sur la 1, ce qui s'est passé sur la 2,
            la comparaison ensuite. UN SEUL BOUTON, mesuré : la barre verticale
            avec ses raccourcis affichés (touche Fin) tenait à 22 px près dans
            un écran de 900 px, et une rangée « ‹ 2/3 › » la faisait défiler.
            Le témoin dit où l'on est ; le clic tourne les pages comme un
            diaporama, les modificateurs font le reste, et Page ↑ / Page ↓
            restent le geste principal. */}
        <button
          className="tbtn tb-page"
          title={`Page ${pageIndex + 1} sur ${pageCount} — chaque page garde ses annotations, le fondu est suspendu sur celles qu’on ne regarde pas · clic : page suivante (${
            touche('page.next') ?? ''
          }, en boucle) · Alt + clic : page précédente (${touche('page.prev') ?? ''}) · Maj + clic : nouvelle page vierge (${
            touche('page.new') ?? ''
          }) · Ctrl + clic : dupliquer cette page (${touche('page.dup') ?? ''})`}
          onClick={(e) => {
            if (e.shiftKey) newPage()
            else if (e.ctrlKey || e.metaKey) duplicatePage()
            else if (e.altKey) prevPage()
            else if (pageIndex >= pageCount - 1) setPage(0)
            else nextPage()
          }}
        >
          <span className="tb-page-num">{`${pageIndex + 1}/${pageCount}`}</span>
          {rappel('Page suivante', 'page.next')}
        </button>
        <button
          className={`tbtn ${toolbarFade > 0 ? 'active' : ''}`}
          title={
            toolbarFade > 0
              ? `Barre discrète : en mode dessin, elle s’estompe après ${toolbarFade} s sans survol ni changement d’outil, et revient dès que la souris s’en approche. Ce bouton fait défiler ${TOOLBAR_FADE_STEPS.map(
                  (v) => (v === 0 ? 'jamais' : `${v} s`),
                ).join(', ')}`
              : `Barre discrète : coupée — la barre reste nette en permanence. Ce bouton fait défiler ${TOOLBAR_FADE_STEPS.map(
                  (v) => (v === 0 ? 'jamais' : `${v} s`),
                ).join(', ')}`
          }
          onClick={() => {
            cycleToolbarFade()
            // le réglage n'a pas de pastille (une rangée de plus ferait
            // défiler la barre sur un écran de 900 px) : l'indicateur le dit
            const v = useUiStore.getState().toolbarFade
            useUiStore.getState().notify(v > 0 ? `Barre discrète : après ${v} s` : 'Barre discrète : jamais')
          }}
        >
          <IconFadeBar />
          {rappel('Barre discrète')}
        </button>
        <button
          className="tbtn"
          title={bulle('Réglages, thèmes et raccourcis', 'ui.settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <IconGear />
          {rappel('Réglages', 'ui.settings')}
        </button>
        {/* L'aide doit être ATTEIGNABLE À LA SOURIS : personne ne devine tout
            seul qu'une touche « ? » ouvre un panneau. */}
        <button
          className="tbtn"
          title={bulle('Aide : les gestes, les raccourcis, et quoi faire quand ça coince', 'ui.cheatsheet')}
          onClick={() => setCheatsheetOpen(true)}
        >
          <IconHelp />
          {rappel('Aide', 'ui.cheatsheet')}
        </button>
      </div>
    </div>
  )
}
