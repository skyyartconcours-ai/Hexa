import { useEffect, useRef, useState } from 'react'
import { HexaEngine } from './engine/engine'
import { FxLayer } from './engine/fx-capture'
import type { ToolId } from './engine/types'
import { COLORS, useUiStore } from './store'
import { Toolbar } from './ui/Toolbar'
import { StageGrid, StageWidgets, spawnClock, spawnNote } from './ui/StageWidgets'
import { RadialMenu } from './ui/RadialMenu'
import { sfx } from './audio'
import { SettingsPanel } from './ui/SettingsPanel'
import { HelpPanel } from './ui/HelpPanel'
import { StatusHud } from './ui/StatusHud'
import { ReplayBar } from './ui/ReplayBar'
import { Onboarding } from './ui/Onboarding'
import { signalTour } from './ui/tour'
import { ObsBridge } from './obs/ObsBridge'
import { recorder } from './replay/recorder'
import { obsLink } from './obs/link'
import { setFxIntensity } from './replay/paint'
import { themeFromQuery } from './themes'
import { bridge, isElectron } from './bridge'
import {
  buildLookup,
  isKeyCaptureActive,
  matchAction,
  resolveKeymap,
  type KeymapAction,
} from './keymap'
import { claimAction, useGlobalShortcuts } from './globalShortcuts'

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

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const staticRef = useRef<HTMLCanvasElement | null>(null)
  const liveRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<HexaEngine | null>(null)
  const fxRef = useRef<FxLayer | null>(null)
  const heldToolRef = useRef<ToolId | null>(null)
  /** touche physique qui tient l'outil momentané, pour le relâcher au bon keyup */
  const heldKeyRef = useRef<{ key: string; code: string } | null>(null)
  /** premier rendu : pas de son de sélection au démarrage */
  const mountedRef = useRef(false)

  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const smartShapes = useUiStore((s) => s.smartShapes)
  const guides = useUiStore((s) => s.guides)
  const linkBadges = useUiStore((s) => s.linkBadges)
  const handwriting = useUiStore((s) => s.handwriting)
  const theme = useUiStore((s) => s.theme)
  const effectIntensity = useUiStore((s) => s.effectIntensity)
  const spotlightRadius = useUiStore((s) => s.spotlightRadius)
  const sound = useUiStore((s) => s.sound)
  const soundVolume = useUiStore((s) => s.soundVolume)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const cheatsheetOpen = useUiStore((s) => s.cheatsheetOpen)
  const replayOpen = useUiStore((s) => s.replayOpen)
  const toolbarVisible = useUiStore((s) => s.toolbarVisible)
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)
  const globalShortcutsOn = useUiStore((s) => s.globalShortcutsOn)

  const [indicator, setIndicator] = useState<string | null>(null)
  const [passthrough, setPassthrough] = useState(false)
  /** menu radial ouvert (clic droit maintenu dans le vide, §8.2) */
  const [radial, setRadial] = useState<{ x: number; y: number } | null>(null)
  /** état des effets de capture — mis à jour sur événement, jamais par image */
  const [fxState, setFxState] = useState({ frozen: false, compare: false })

  // création du moteur (une seule fois)
  useEffect(() => {
    const engine = new HexaEngine(stageRef.current!, staticRef.current!, liveRef.current!)
    engineRef.current = engine
    // Couche des effets de capture (§5.5, §5.6, §5.7, §6) : loupe, gel d'image,
    // masques flous, avant/après. Autonome — ses propres canvas, sa propre
    // boucle dormante, son propre flux d'écran allumé à la demande.
    const fx = new FxLayer(stageRef.current!)
    fxRef.current = fx
    // « Gel d'image » est une bascule, pas un état où l'on reste : si la
    // session précédente s'est terminée pile dessus, on repart au pinceau.
    if (useUiStore.getState().tool === 'freeze') useUiStore.getState().setTool('pen')
    // La fenêtre overlay se cache quand elle est vide (§2.5). Le moteur et la
    // couche d'effets ont chacun leur avis : elle reste visible tant que l'un
    // des deux a quelque chose à montrer — sinon la loupe disparaîtrait sur un
    // écran sans la moindre annotation.
    // Troisième avis : les éléments POSÉS à l'écran (§5.8 — grille, chronos,
    // notes). Sans eux dans le calcul, un compte à rebours seul à l'écran
    // ferait disparaître la fenêtre : le viewer ne verrait plus rien.
    const live = { engine: false, fx: false, widgets: false }
    const pushActivity = () => bridge.notifyActivity(live.engine || live.fx || live.widgets)
    engine.onActivity = (has) => {
      live.engine = has
      pushActivity()
    }
    fx.onActivity = (has) => {
      live.fx = has
      pushActivity()
    }
    const readWidgets = (s: ReturnType<typeof useUiStore.getState>): boolean =>
      s.clocks.length > 0 || s.notes.length > 0 || s.gridMode !== 'off'
    live.widgets = readWidgets(useUiStore.getState())
    // abonnement, pas de sondage : rien ne tourne tant que rien ne change
    const unsubWidgets = useUiStore.subscribe((s) => {
      const has = readWidgets(s)
      if (has === live.widgets) return
      live.widgets = has
      pushActivity()
    })
    // la barre allume ses boutons « gel » et « avant/après » quand ils sont
    // vraiment actifs : sur un écran figé, on doit VOIR pourquoi rien ne bouge
    fx.onChange = (s) => setFxState({ frozen: s.frozen, compare: s.compare })
    // collage d'une image (§4.10) : le moteur demande le passage au tampon
    engine.onRequestTool = (t) => useUiStore.getState().setTool(t)
    engine.onWheelCb = (e) => {
      e.preventDefault()
      const st = useUiStore.getState()
      st.setSize(Math.min(18, Math.max(2, st.size + (e.deltaY < 0 ? 1 : -1))))
    }
    // §11 + §10.2 : l'enregistreur de session et le miroir OBS regardent le
    // moteur travailler. Appelé uniquement pendant une image active, donc
    // strictement rien au repos.
    engine.onMirror = (strokes, current) => {
      recorder.observe(strokes, current)
      obsLink.publish(strokes, current)
    }
    // §8.2 : le moteur a détecté un clic droit maintenu 220 ms dans le vide
    engine.onRadial = (x, y) => {
      setRadial({ x, y })
      // la découverte guidée valide son étape « clic droit » sur l'ouverture
      // réelle de la roue — pas sur une heuristique de durée
      signalTour('radial')
    }
    // touche panique : la roue et le spotlight se referment avec le reste
    engine.onPanic = () => {
      setRadial(null)
      // Le gel d'image et l'avant/après partent aussi. Les MASQUES FLOUS, non :
      // ce qui cache une information sensible ne doit jamais sauter par
      // accident (§5.6) — il faut le retirer un par un, exprès.
      fx.panic()
      const s = useUiStore.getState()
      if (s.tool === 'spotlight' || s.tool === 'ping') s.setTool('pen')
      if (s.tool === 'magnifier' || s.tool === 'freeze') s.setTool('pen')
    }
    // molette sur le spotlight : le rayon est mémorisé d'une session à l'autre
    engine.onSpotRadius = (r) => useUiStore.getState().setSpotlightRadius(r)
    bridge.on('panic-clear', () => engine.clear())
    // 'toggle-draw' : bascule relative (compatibilité) — 'set-draw' : valeur
    // absolue envoyée par le processus principal, seule source fiable quand
    // plusieurs écrans se passent le mode dessin (§8.8).
    bridge.on('toggle-draw', () => setPassthrough((p) => !p))
    bridge.on('set-draw', (drawing) => setPassthrough(!drawing))
    // « Réglages… » du menu de l'icône près de l'horloge
    bridge.on('open-settings', () => useUiStore.getState().setSettingsOpen(true))

    // ---- écrans et DPI qui changent EN COURS DE PARTIE (S9, §12.3) --------
    // Brancher un second écran, changer la résolution ou passer Windows de
    // 100 % à 125 % modifie le rapport entre pixels physiques et pixels CSS.
    // Tous nos calques (moteur, effets de capture, éléments posés) dimensionnent
    // leur fond de rendu en pixels physiques : sans recalibrage, le trait tombe
    // À CÔTÉ du curseur. Un unique événement `resize` synthétique les réveille
    // tous d'un coup, sans qu'aucun n'ait à connaître le pont Electron — et il
    // est sans effet si rien n'a réellement changé (garde-fou dans engine.resize).
    const recalibrer = () => window.dispatchEvent(new Event('resize'))
    const unsubDisplay = bridge.on('display-changed', (info) => {
      bridge.log(
        'écrans',
        `écran recalibré : ${info.bounds.width}×${info.bounds.height} à ${Math.round(
          info.scaleFactor * 100,
        )} %`,
      )
      recalibrer()
    })
    // Filet côté page : le processus principal ne voit pas TOUS les changements
    // d'échelle (une session RDP, un pilote graphique qui rebascule). La requête
    // média `resolution` est le seul signal fiable d'un devicePixelRatio qui
    // bouge — et elle doit être réarmée à chaque fois, puisqu'elle cite la
    // valeur courante. Aucun coût au repos : c'est un écouteur, pas une boucle.
    let dprQuery: MediaQueryList | null = null
    const onDpr = () => {
      recalibrer()
      armerDpr()
    }
    const armerDpr = () => {
      if (typeof window.matchMedia !== 'function') return
      dprQuery?.removeEventListener('change', onDpr)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dprQuery.addEventListener('change', onDpr)
    }
    armerDpr()

    return () => {
      unsubWidgets()
      unsubDisplay()
      dprQuery?.removeEventListener('change', onDpr)
      fx.destroy()
      engine.destroy()
    }
  }, [])

  // outil et couleur d'accent de la couche d'effets (anneau de la loupe,
  // cadres des masques, poignée de l'avant/après)
  useEffect(() => {
    fxRef.current?.setTool(tool)
  }, [tool])

  useEffect(() => {
    fxRef.current?.setAccent(color)
  }, [color])

  // synchronisation store → moteur
  useEffect(() => {
    engineRef.current?.setOptions({
      tool,
      color,
      size,
      fadeDelay,
      sparkles,
      smartShapes,
      guides,
      linkBadges,
      handwriting,
      effects: effectIntensity,
    })
  }, [
    tool,
    color,
    size,
    fadeDelay,
    sparkles,
    smartShapes,
    guides,
    linkBadges,
    handwriting,
    effectIntensity,
  ])

  // rayon du spotlight (§5.2) : réglé à la molette, mémorisé, réappliqué
  useEffect(() => {
    engineRef.current?.setSpotRadius(spotlightRadius)
  }, [spotlightRadius])

  // sons génératifs (§16.7) : coupés par défaut, aucun fichier, aucun réseau.
  // Le contexte audio ne naît qu'au premier son réellement joué.
  useEffect(() => {
    sfx.setEnabled(sound)
    sfx.setVolume(soundVolume)
  }, [sound, soundVolume])

  // intensité des effets : le moteur (halos), et aussi le rejeu, les exports
  // et la vue OBS, qui partagent la même recette de rendu
  useEffect(() => {
    setFxIntensity(effectIntensity)
    document.documentElement.style.setProperty('--fx-intensity', String(effectIntensity))
  }, [effectIntensity])

  // thème (8 designs, appliqués par attribut sur <html>)
  useEffect(() => {
    // ?theme=<id> impose un thème (démos, captures) et court-circuite le store
    document.documentElement.dataset.theme = themeFromQuery() ?? theme
  }, [theme])

  // mode traversant : la fenêtre laisse passer les clics vers le jeu
  useEffect(() => {
    document.body.classList.toggle('passthrough', passthrough)
    bridge.setPassthrough(passthrough)
    // la découverte guidée termine là-dessus : c'est le geste « je rends la
    // souris au jeu », le dernier qu'il faut avoir fait une fois
    if (passthrough) signalTour('passthrough')
  }, [passthrough])

  // Outil momentané resté coincé : on maintient Z (laser) puis on bascule vers
  // le jeu avec Alt+Tab — le clavier ne délivre jamais le relâchement, et Hexa
  // resterait au laser pour toujours. La perte de focus rend donc l'outil.
  useEffect(() => {
    const release = () => {
      if (heldToolRef.current == null) return
      useUiStore.getState().setTool(heldToolRef.current)
      heldToolRef.current = null
      heldKeyRef.current = null
    }
    window.addEventListener('blur', release)
    return () => window.removeEventListener('blur', release)
  }, [])

  // indicateur discret au changement d'outil (brief §9.6)
  useEffect(() => {
    setIndicator(TOOL_LABELS[tool] ?? tool)
    // micro-son de sélection : jamais au montage, et jamais pendant la roue
    // (elle joue déjà son propre retour au relâché, on ne double pas).
    if (mountedRef.current && !radial) sfx.tool()
    mountedRef.current = true
    const t = setTimeout(() => setIndicator(null), 850)
    return () => clearTimeout(t)
    // `radial` est volontairement hors dépendances : on lit la valeur du rendu
    // qui a provoqué le changement d'outil.
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------
  // Raccourcis GLOBAUX (application Electron) : la mémoire musculaire d'Epic
  // Pen doit fonctionner PAR-DESSUS le jeu, donc même quand Hexa n'a pas le
  // focus. Ctrl+Maj+2 curseur · 3 stylo · 4 surligneur · 5 gomme · 6 annuler ·
  // Ctrl+E tout effacer · Ctrl+H barre. Ils sont réenregistrés à chaud à chaque
  // changement de clavier : on ne demande JAMAIS de relancer l'application.
  // ---------------------------------------------------------------
  useGlobalShortcuts({
    preset: keymapPreset,
    overrides: keymapOverrides,
    enabled: globalShortcutsOn,
    engine: () => engineRef.current,
  })

  // ---------------------------------------------------------------
  // Clavier — TOUT passe par la table centralisée (src/keymap.ts).
  // Aucune touche n'est écrite en dur ici : le preset (Hexa ou
  // compatibilité Epic Pen) et les remaps utilisateur pilotent tout.
  // ---------------------------------------------------------------
  useEffect(() => {
    const bindings = resolveKeymap(keymapPreset, keymapOverrides)
    const lookup = buildLookup(bindings)
    const st = () => useUiStore.getState()

    /** outils momentanés : action → outil pris tant que la touche est tenue (§8.5) */
    const HOLD_TOOLS: Partial<Record<KeymapAction, ToolId>> = {
      'hold.laser': 'laser',
      'hold.spotlight': 'spotlight',
      'hold.magnifier': 'magnifier',
      'hold.freeze': 'freeze',
    }

    const TOOL_ACTIONS: Partial<Record<KeymapAction, ToolId>> = {
      'tool.pen': 'pen',
      'tool.highlight': 'highlight',
      'tool.line': 'line',
      'tool.arrow': 'arrow',
      'tool.rect': 'rect',
      'tool.ellipse': 'ellipse',
      'tool.text': 'text',
      'tool.badge': 'badge',
      'tool.measure': 'measure',
      'tool.stamp': 'stamp',
      'tool.eraser': 'eraser',
    }

    /** Raccourcis de la vague « formes » pas encore décrits par la table
     *  centrale. On ne les traite que si la touche n'est prise par personne :
     *  le jour où keymap.ts les intègre, ce repli devient inerte tout seul. */
    const extraKey = (e: KeyboardEvent): boolean => {
      // §5.8 — éléments posés à l'écran. Combinaisons volontairement à
      // l'écart des réflexes Epic Pen (Ctrl+Maj+3…8) et des touches maison.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        const c = e.key.toLowerCase()
        if (c === 'g') st().cycleGrid()
        else if (c === 'y') spawnClock('chrono')
        else if (c === 'b') spawnNote()
        else return false
        e.preventDefault()
        return true
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
      const k = e.key.toLowerCase()
      // §8.5 — maintien de touche : Q = ping momentané. On appuie, un ping
      // part aussitôt sous le curseur ; on relâche, l'outil précédent revient.
      // (Z laser et X spotlight sont déjà décrits par la table centrale.)
      if (k === 'q') {
        e.preventDefault()
        if (e.repeat || heldToolRef.current != null) return true
        heldToolRef.current = st().tool
        heldKeyRef.current = { key: 'q', code: e.code }
        st().setTool('ping')
        engineRef.current?.ping()
        return true
      }
      if (k === 'm') st().setTool('measure')
      else if (k === 'w') st().toggleSmartShapes()
      else if (k === 'g') st().toggleGuides()
      // B : masque flou (§5.6). Bascule — on repose des masques tant que
      // l'outil est choisi, on revient au pinceau quand on a fini.
      else if (k === 'b') st().setTool(st().tool === 'blur' ? 'pen' : 'blur')
      // U : comparateur avant/après (§5.7). S'il n'y a pas encore de photo,
      // il la prend lui-même — l'utilisateur n'a pas à connaître l'ordre.
      else if (k === 'u') fxRef.current?.toggleCompare()
      // mode écriture : bascule (J) et transcription immédiate (Entrée).
      // Entrée n'est capturée que s'il y a vraiment de l'écriture en attente.
      else if (k === 'j') st().toggleHandwriting()
      else if (k === 'enter') {
        if (!engineRef.current?.transcribeNow()) return false
      } else return false
      e.preventDefault()
      return true
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // saisie en cours (nom de profil, texte) ou capture d'un raccourci :
      // le clavier de l'app se tait complètement.
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (target?.isContentEditable) return
      if (isKeyCaptureActive()) return

      const eng = engineRef.current
      if (!eng) return
      const hit = matchAction(lookup, e)
      if (!hit) {
        extraKey(e)
        return
      }
      const { action } = hit

      // Cette action vient peut-être d'être exécutée par le raccourci SYSTÈME
      // (Electron l'a interceptée hors focus) : selon la façon dont Windows
      // livre la touche, la page la reçoit aussi. On ne la joue pas deux fois.
      if (!claimAction(action, 'page')) {
        e.preventDefault()
        return
      }

      // §6 — la loupe est ouverte : la touche « gel » ne change pas d'outil,
      // elle FIGE LE DISQUE sur place. Le contenu, lui, continue de suivre le
      // curseur : c'est ce qui permet de montrer un détail tout en gardant la
      // loupe dans un coin propre de l'image.
      if (action === 'hold.freeze' && st().tool === 'magnifier') {
        e.preventDefault()
        if (!e.repeat) fxRef.current?.toggleMagnifierPin()
        return
      }

      // outil momentané : on mémorise l'outil courant, on le rend au relâchement
      const holdTool = HOLD_TOOLS[action]
      if (holdTool) {
        e.preventDefault()
        if (e.repeat || heldToolRef.current != null) return
        heldToolRef.current = st().tool
        heldKeyRef.current = { key: e.key.toLowerCase(), code: e.code }
        st().setTool(holdTool)
        return
      }

      const tool = TOOL_ACTIONS[action]
      if (tool) {
        e.preventDefault()
        st().setTool(tool)
        // Comme Epic Pen : choisir un outil, c'est vouloir dessiner. Si la
        // souris était rendue au jeu, on reprend la main — sinon l'utilisateur
        // presse Ctrl+Maj+3 et se demande pourquoi rien ne se dessine.
        setPassthrough(false)
        return
      }

      const color = /^color\.([1-7])$/.exec(action)
      if (color) {
        e.preventDefault()
        st().setColor(COLORS[parseInt(color[1], 10) - 1])
        return
      }

      switch (action) {
        case 'edit.undo':
          e.preventDefault()
          eng.undo()
          signalTour('erase')
          break
        case 'edit.redo':
          e.preventDefault()
          eng.redo()
          break
        case 'edit.clear':
          e.preventDefault()
          eng.clear()
          signalTour('erase')
          break
        case 'size.dec':
          e.preventDefault()
          st().setSize(Math.max(2, st().size - 2))
          break
        case 'size.inc':
          e.preventDefault()
          st().setSize(Math.min(18, st().size + 2))
          break
        case 'fade.cycle':
          e.preventDefault()
          st().cycleFade()
          break
        case 'toggle.smartShapes':
          e.preventDefault()
          st().toggleSmartShapes()
          break
        case 'toggle.guides':
          e.preventDefault()
          st().toggleGuides()
          break
        case 'toggle.linkBadges':
          e.preventDefault()
          st().toggleLinkBadges()
          break
        case 'ui.toolbar':
          e.preventDefault()
          st().toggleToolbar()
          break
        case 'ui.settings':
          e.preventDefault()
          // Ouvrir un panneau alors que la souris est rendue au jeu donnerait
          // un panneau que l'on VOIT mais sur lequel on ne peut pas cliquer :
          // les clics traversent la fenêtre. On reprend donc la main.
          if (!st().settingsOpen) setPassthrough(false)
          st().setSettingsOpen(!st().settingsOpen)
          break
        case 'ui.cheatsheet':
          e.preventDefault()
          if (!st().cheatsheetOpen) setPassthrough(false)
          st().setCheatsheetOpen(!st().cheatsheetOpen)
          break
        case 'ui.close': {
          // Échap ramène TOUJOURS à l'état neutre. Dans l'ordre de ce que
          // l'utilisateur veut annuler en premier : le panneau ouvert, puis
          // l'outil momentané resté en l'air, puis les effets qui transforment
          // tout l'écran (spotlight, loupe, gel, avant/après) — dont on ne
          // devinait pas comment sortir autrement que par la touche panique.
          const s = st()
          const panneau = s.settingsOpen || s.cheatsheetOpen || s.replayOpen
          s.setSettingsOpen(false)
          s.setCheatsheetOpen(false)
          s.setReplayOpen(false)
          if (heldToolRef.current != null) {
            s.setTool(heldToolRef.current)
            heldToolRef.current = null
            heldKeyRef.current = null
          } else if (!panneau) {
            if (
              s.tool === 'spotlight' ||
              s.tool === 'magnifier' ||
              s.tool === 'ping' ||
              s.tool === 'freeze' ||
              s.tool === 'blur'
            )
              s.setTool('pen')
            // Gel d'image et avant/après : on rend le direct. Les masques
            // flous, eux, restent (§5.6) — ils cachent quelque chose exprès.
            const fx = fxRef.current
            const fxs = fx?.state()
            if (fxs && (fxs.frozen || fxs.compare)) fx?.panic()
          }
          break
        }
        // Les trois actions ci-dessous existent AUSSI comme raccourcis système
        // (Electron les capte même quand le jeu a le focus). On les traite
        // quand même ici : si Windows a refusé l'enregistrement, ou en démo
        // navigateur, l'utilisateur ne doit pas se retrouver prisonnier. Le
        // verrou claimAction, plus haut, garantit qu'elles ne partent jamais
        // deux fois.
        case 'mode.draw':
          e.preventDefault()
          setPassthrough((p) => !p)
          break
        case 'mode.cursor':
          // Équivalent de l'outil « curseur » d'Epic Pen : la souris repart au jeu.
          e.preventDefault()
          setPassthrough(true)
          break
        case 'app.panic':
          e.preventDefault()
          eng.clear()
          break
        default:
          break
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const held = heldKeyRef.current
      if (!held || heldToolRef.current == null) return
      if (e.key.toLowerCase() !== held.key && e.code !== held.code) return
      st().setTool(heldToolRef.current)
      heldToolRef.current = null
      heldKeyRef.current = null
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [keymapPreset, keymapOverrides])

  const exportSession = () => {
    const eng = engineRef.current
    if (!eng) return
    const data = JSON.stringify(eng.exportSession(), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hexa-session-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={isElectron ? 'app' : 'app demo'}>
      {!isElectron && (
        <div className="wallpaper" aria-hidden>
          <div className="hint-card">
            <div className="hint-title">
              <span className="hexa-mark" /> Hexa · démo navigateur
            </div>
            <p>
              Dessine n'importe où. En version overlay (Electron), cette couche est transparente
              au-dessus de ton écran ou de ton jeu.
            </p>
            <ul>
              <li>
                <b>Formes intelligentes</b> : dessine un rectangle, un cercle ou une flèche à main
                levée, Hexa le redresse (Ctrl+Z rend le tracé brut)
              </li>
              <li>
                <b>R</b> rectangle · <b>O</b> ellipse · <b>T</b> texte · <b>N</b> numéroteur ·{' '}
                <b>M</b> mesure
              </li>
              <li>
                <b>Shift</b> : carré/cercle et angles 15° · <b>Alt</b> : forme remplie, guides
                suspendus
              </li>
              <li>
                <b>Ctrl+V</b> : coller une image, la molette la redimensionne
              </li>
              <li>
                <b>Clic droit</b> : attraper une annotation · <b>Molette</b> : taille · <b>1–7</b> :
                couleurs
              </li>
              <li>
                <b>Clic droit maintenu dans le vide</b> : menu radial — glisse vers l'outil ou la
                couleur, relâche, c'est pris
              </li>
              <li>
                <b>D</b> : fondu (2s/4s/8s/∞) · <b>C</b> : tout effacer · <b>Maintenir Z</b> : laser
                · <b>Q</b> : ping
              </li>
              <li>
                <b>X</b> : spotlight — le disque suit la souris (molette = rayon), <b>glisse</b>{' '}
                pour éclairer un rectangle, <b>Alt + glisse</b> pour une forme libre au lasso
              </li>
              <li>
                <b>Ctrl+Maj+G</b> : grille / règle des tiers (molette sur le bouton = discrétion) ·{' '}
                <b>Ctrl+Maj+Y</b> : chrono · <b>Ctrl+Maj+B</b> : note posée à l'écran
              </li>
              <li>
                <b>Maintenir A</b> : loupe (molette = grossissement, <b>V</b> fige le disque) ·{' '}
                <b>V</b> : gel d'image · <b>B</b> : masque flou · <b>U</b> : avant/après
                <br />
                <i>
                  ces quatre-là lisent l'écran : le navigateur demande l'autorisation de partage au
                  premier clic, l'application overlay n'a rien à demander.
                </i>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Grille / règle des tiers (§5.8.1) : AVANT la scène dans le document,
          donc peinte sous les annotations. Du CSS pur — zéro image de rendu. */}
      <StageGrid />

      <div ref={stageRef} className="stage" data-tool={tool}>
        <canvas ref={staticRef} />
        <canvas ref={liveRef} />
      </div>

      {/* Chronos, comptes à rebours et notes posés à l'écran (§5.8.2, §5.8.3).
          Les notes sont immunisées au fondu et à la touche panique : elles
          vivent dans le store, pas dans la liste des annotations. */}
      <StageWidgets />

      {/* liseré lumineux : seul repère indiquant que le mode dessin est actif (brief §9.7) */}
      {!passthrough && <div className="edge-glow" aria-hidden />}

      {indicator && (
        <div className="tool-indicator" key={indicator}>
          {indicator}
        </div>
      )}

      {/* Pastille d'état (barre masquée) et messages éphémères de changement
          de mode : à aucun moment l'utilisateur ne doit se demander « qu'est-ce
          qui se passe » ni « comment je reviens en arrière ». */}
      <StatusHud passthrough={passthrough} />

      {toolbarVisible && (
        <Toolbar
          onUndo={() => {
            engineRef.current?.undo()
            signalTour('erase')
          }}
          onRedo={() => engineRef.current?.redo()}
          onClear={() => {
            engineRef.current?.clear()
            signalTour('erase')
          }}
          onExport={exportSession}
          onFreeze={() => fxRef.current?.toggleFreeze()}
          onCompare={() => fxRef.current?.toggleCompare()}
          frozen={fxState.frozen}
          comparing={fxState.compare}
        />
      )}

      {/* Menu radial (§8.2) : clic droit maintenu 220 ms dans le vide.
          Le moteur décide de l'ouverture, la roue gère le geste et se referme
          elle-même au relâché. */}
      {radial && (
        <RadialMenu
          x={radial.x}
          y={radial.y}
          onClose={() => {
            engineRef.current?.closeRadial()
            setRadial(null)
          }}
        />
      )}

      {/* Réglages complets : thèmes, hygiène à l'écran, session et exports,
          OBS, profils, raccourcis. Le panneau embarque ProfilesPanel et
          KeymapEditor, qui sont autonomes. */}
      {settingsOpen && (
        <SettingsPanel
          getSession={() => engineRef.current?.exportSession() ?? null}
          loadSession={(s) => engineRef.current?.loadSession(s)}
          onClose={() => useUiStore.getState().setSettingsOpen(false)}
        />
      )}

      {/* Aide (touche ?) : les gestes, la table complète du clavier actif, la
          marche à suivre pour le stream, et un onglet « au secours » qui
          répond aux vrais symptômes. La fiche imprimable s'ouvre depuis là. */}
      {cheatsheetOpen && (
        <HelpPanel
          onClose={() => useUiStore.getState().setCheatsheetOpen(false)}
          onEdit={() => {
            useUiStore.getState().setCheatsheetOpen(false)
            useUiStore.getState().setSettingsOpen(true)
          }}
          onReplayTour={() => {
            useUiStore.getState().setCheatsheetOpen(false)
            useUiStore.getState().setOnboarded(false)
          }}
        />
      )}

      {/* Rejeu de session (§11) : calque dédié, la session vive reste intacte */}
      {replayOpen && <ReplayBar onClose={() => useUiStore.getState().setReplayOpen(false)} />}

      {/* Miroir OBS + obs-websocket (§10.2, §7.3) — silencieux par défaut */}
      <ObsBridge onSceneChange={() => engineRef.current?.clear()} />

      {/* Découverte guidée — premier lancement seulement (ou ?onboarding=1) */}
      <Onboarding />
    </div>
  )
}
