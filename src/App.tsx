import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HexaEngine } from './engine/engine'
import { setInkTuning } from './engine/ink-fx'
import { FxLayer } from './engine/fx-capture'
import type { SessionExport, ToolId } from './engine/types'
import { COLORS, useUiStore } from './store'
import { Toolbar, useToolbarHost } from './ui/Toolbar'
import { StageGrid, StageWidgets, spawnClock, spawnNote } from './ui/StageWidgets'
import { RadialMenu } from './ui/RadialMenu'
import { sfx } from './audio'
import { SettingsPanel } from './ui/SettingsPanel'
import { HelpPanel } from './ui/HelpPanel'
import { StatusHud } from './ui/StatusHud'
import { ReplayBar } from './ui/ReplayBar'
import { Onboarding } from './ui/Onboarding'
import { onTourSignal, signalTour, type TourSignal } from './ui/tour'
import { ObsBridge } from './obs/ObsBridge'
import { queueReplay, recorder } from './replay/recorder'
import { obsLink } from './obs/link'
import { setFxIntensity } from './replay/paint'
import { themeFromQuery } from './themes'
import { bridge, isElectron, type CommandeEncre, type EtatEncre } from './bridge'
import {
  buildLookup,
  isKeyCaptureActive,
  matchAction,
  resolveKeymap,
  type KeymapAction,
} from './keymap'
import { claimAction, useGlobalShortcuts } from './globalShortcuts'
// §S11 — séparation en deux fenêtres : l'encre (capturée par OBS) et
// l'interface (exclue des captures). Voir src/couches.ts pour le raisonnement.
import {
  annoncerEtatEncre,
  brancherExecuteur,
  coucheSeparee,
  demarrerSynchro,
  ecouterEtatEncre,
  envoyerCommande,
  porteEncre,
  porteInterface,
} from './couches'
import { useInterfaceCliquable } from './ui/interactivite'
import { exigerPleinEcran } from './ui/fenetre-compacte'
import { CurseurHexa } from './ui/CurseurHexa'

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

/**
 * Écrit la session vive dans un fichier JSON. Exécuté par la couche ENCRE :
 * c'est elle qui détient le moteur, et sur deux écrans une seule couche répond
 * — sinon on obtiendrait autant de fichiers que d'écrans branchés.
 */
function telechargerSession(engine: HexaEngine): void {
  const data = JSON.stringify(engine.exportSession(), null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hexa-session-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
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
  /**
   * Dernier instantané de session reçu de la couche encre (§S11). Le panneau de
   * réglages le lit de façon synchrone : il est rafraîchi à chaque ouverture du
   * panneau — moment où l'on ne dessine pas, par construction.
   */
  const sessionRef = useRef<SessionExport | null>(null)

  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const smartShapes = useUiStore((s) => s.smartShapes)
  const guides = useUiStore((s) => s.guides)
  const linkBadges = useUiStore((s) => s.linkBadges)
  const badgeContinuous = useUiStore((s) => s.badgeContinuous)
  const handwriting = useUiStore((s) => s.handwriting)
  const lexicon = useUiStore((s) => s.lexicon)
  const lexiconCategories = useUiStore((s) => s.lexiconCategories)
  const lexiconWords = useUiStore((s) => s.lexiconWords)
  const theme = useUiStore((s) => s.theme)
  const effectIntensity = useUiStore((s) => s.effectIntensity)
  /** flèches pulsantes : réglage d'apparence des traits déjà posés (ink-fx) */
  const arrowPulse = useUiStore((s) => s.arrowPulse)
  const spotlightRadius = useUiStore((s) => s.spotlightRadius)
  const sound = useUiStore((s) => s.sound)
  const soundVolume = useUiStore((s) => s.soundVolume)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const cheatsheetOpen = useUiStore((s) => s.cheatsheetOpen)
  const replayOpen = useUiStore((s) => s.replayOpen)
  const toolbarVisible = useUiStore((s) => s.toolbarVisible)
  const onboarded = useUiStore((s) => s.onboarded)
  /** masquer l'interface de Hexa dans les captures (OBS, Discord, impr. écran) */
  const hideUiFromCapture = useUiStore((s) => s.hideUiFromCapture)
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)
  const globalShortcutsOn = useUiStore((s) => s.globalShortcutsOn)

  const [indicator, setIndicator] = useState<string | null>(null)
  const [passthrough, setPassthrough] = useState(false)
  /** menu radial ouvert (clic droit maintenu dans le vide, §8.2) */
  const [radial, setRadial] = useState<{ x: number; y: number } | null>(null)
  /** état des effets de capture — mis à jour sur événement, jamais par image */
  const [fxState, setFxState] = useState({ frozen: false, compare: false })

  // création du moteur (une seule fois) — COUCHE ENCRE uniquement.
  // Dans la fenêtre d'interface il n'y a ni canvas ni moteur : elle pilote
  // celui de l'autre fenêtre par commandes (§S11).
  useEffect(() => {
    if (!porteEncre) return
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
    // vraiment actifs : sur un écran figé, on doit VOIR pourquoi rien ne bouge.
    // La barre vit dans l'autre fenêtre : l'état lui est annoncé (§S11).
    fx.onChange = (s) => {
      setFxState({ frozen: s.frozen, compare: s.compare })
      annoncerEtatEncre({ quoi: 'fx', frozen: s.frozen, compare: s.compare })
    }
    // collage d'une image (§4.10) : le moteur demande le passage au tampon
    engine.onRequestTool = (t) => useUiStore.getState().setTool(t)
    // la molette sur le champ texte a choisi une taille : le curseur d'épaisseur
    // de la barre doit la refléter, sinon le texte suivant repartirait de l'ancienne
    engine.onRequestSize = (size) => useUiStore.getState().setSize(size)
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
    /** coupe le relais du geste de la roue (posé plus bas, le temps du geste) */
    let detacherRoue: () => void = () => undefined

    /**
     * §8.2 : le moteur a détecté un clic droit maintenu 220 ms dans le vide.
     *
     * La ROUE est de l'interface : elle s'affiche donc dans l'autre fenêtre,
     * hors caméra. Mais le GESTE, lui, se déroule ici — c'est cette fenêtre-ci
     * qui a le bouton droit enfoncé. Electron ne transmet que les MOUVEMENTS de
     * souris aux fenêtres traversantes, jamais les relâchements : sans relais,
     * la roue s'ouvrirait dans l'autre fenêtre et ne se refermerait jamais.
     * On relaie donc le geste, le temps du geste, et rien de plus.
     */
    engine.onRadial = (x, y) => {
      // la découverte guidée valide son étape « clic droit » sur l'ouverture
      // réelle de la roue — pas sur une heuristique de durée
      signalTour('radial')
      if (!coucheSeparee) {
        setRadial({ x, y })
        return
      }
      annoncerEtatEncre({ quoi: 'radial', x, y })
      const bouge = (e: PointerEvent) =>
        annoncerEtatEncre({ quoi: 'radial-move', x: e.clientX, y: e.clientY })
      const fini = () => {
        detacherRoue()
        annoncerEtatEncre({ quoi: 'radial-up' })
      }
      detacherRoue()
      window.addEventListener('pointermove', bouge)
      window.addEventListener('pointerup', fini)
      window.addEventListener('pointercancel', fini)
      detacherRoue = () => {
        detacherRoue = () => undefined
        window.removeEventListener('pointermove', bouge)
        window.removeEventListener('pointerup', fini)
        window.removeEventListener('pointercancel', fini)
      }
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

    /* ---- §S11 : ce que la barre d'outils demande au moteur -------------- *
     * La barre vit dans l'autre fenêtre : « annuler » ne peut plus être un
     * appel de fonction. Un canal de commandes FERMÉ (neuf ordres, pas un de
     * plus) évite d'ouvrir une porte d'entrée dans le moteur. En démo
     * navigateur, `envoyerCommande` appelle directement cet exécuteur : même
     * code, aucun IPC, aucune latence.                                       */
    const executer = (c: CommandeEncre) => {
      switch (c.nom) {
        case 'undo':
          engine.undo()
          signalTour('erase')
          break
        case 'redo':
          engine.redo()
          break
        case 'clear':
          engine.clear()
          signalTour('erase')
          break
        case 'export':
          telechargerSession(engine)
          break
        case 'freeze':
          fx.toggleFreeze()
          break
        case 'compare':
          fx.toggleCompare()
          break
        case 'radial-close':
          engine.closeRadial()
          break
        case 'session-get':
          annoncerEtatEncre({ quoi: 'session', session: engine.exportSession() })
          break
        case 'session-load':
          engine.loadSession(c.session as SessionExport)
          break
        case 'replay-queue':
          // La barre de rejeu, montée juste après par la synchronisation de
          // `replayOpen`, viendra chercher ce fichier à son montage (§11).
          queueReplay(c.session as SessionExport)
          break
        default:
          break
      }
    }
    brancherExecuteur(executer)
    const stopCommandes = bridge.on('commande', (c) => executer(c))
    // La découverte guidée est affichée par la couche interface : les gestes
    // qu'elle attend (effacer, rendre la souris au jeu) ont lieu ici.
    const stopTour = coucheSeparee
      ? onTourSignal((signal) => annoncerEtatEncre({ quoi: 'tour', signal }))
      : () => undefined

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
      stopCommandes()
      stopTour()
      detacherRoue()
      brancherExecuteur(null)
      dprQuery?.removeEventListener('change', onDpr)
      fx.destroy()
      engine.destroy()
    }
  }, [])

  /* ================================================================== *
   * COUCHE INTERFACE — la fenêtre que le direct ne voit jamais (§S11)
   * ================================================================== */

  // Les deux stores se tiennent au courant l'un l'autre. Sans effet en démo
  // navigateur : il n'y a qu'une page, donc qu'un seul store.
  useEffect(() => demarrerSynchro(), [])

  // Cette fenêtre porte-t-elle la barre ? Sur les autres écrans, la couche
  // interface n'a rien à montrer : elle reste cachée, donc gratuite (§2.5).
  const isHost = useToolbarHost()

  // Un panneau ouvert : la fenêtre interface devient cliquable PARTOUT et
  // accepte la frappe clavier. Sinon, elle n'est cliquable qu'au survol d'un
  // bouton — tout le reste des clics part au jeu ou à la couche encre.
  // `isHost` est indispensable : sur deux écrans, l'état des panneaux est
  // partagé, mais SEUL l'écran porteur les affiche. Sans ce garde-fou, la
  // fenêtre d'interface vide du second écran réclamerait le focus clavier en
  // même temps que le panneau s'ouvre sur le premier.
  // (La barre de rejeu, elle, vit dans la couche encre : la rendre « modale »
  // ici rendrait ses propres commandes inatteignables.)
  useInterfaceCliquable(isHost && (settingsOpen || cheatsheetOpen))

  // Ce que la couche encre annonce : gel d'image, roue, geste de la roue,
  // gestes de la découverte guidée, instantané de session.
  useEffect(() => {
    if (!porteInterface || !coucheSeparee) return
    return ecouterEtatEncre((m: EtatEncre) => {
      if (m.quoi === 'fx') setFxState({ frozen: m.frozen, compare: m.compare })
      else if (m.quoi === 'radial') setRadial({ x: m.x, y: m.y })
      else if (m.quoi === 'radial-move')
        // La roue écoute la fenêtre ; le geste, lui, se déroule dans l'autre.
        // On rejoue donc l'événement ici, à l'identique.
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: m.x, clientY: m.y }))
      else if (m.quoi === 'radial-up') window.dispatchEvent(new PointerEvent('pointerup'))
      else if (m.quoi === 'tour') signalTour(m.signal as TourSignal)
      else if (m.quoi === 'session') sessionRef.current = m.session as SessionExport
    })
  }, [])

  /**
   * Filet de sécurité de la roue (§8.2).
   *
   * La roue est dessinée par la couche INTERFACE, mais le geste qui la ferme
   * (le relâché du clic droit) a lieu dans la couche encre : si ce relâché se
   * perd — alt-tab en plein geste, écran débranché — la roue resterait ouverte
   * à l'écran, et la touche panique elle-même ne la retirerait pas : elle
   * s'adresse au moteur, qui vit dans l'autre fenêtre. « Tout effacer » doit
   * TOUT effacer, roue comprise.
   */
  useEffect(() => {
    if (!porteInterface || !coucheSeparee) return
    return bridge.on('panic-clear', () => setRadial(null))
  }, [])

  // Mode dessin : dans la couche interface, le moteur n'est pas là pour
  // l'écouter. Elle l'apprend directement du processus principal — c'est ce qui
  // fait disparaître le curseur personnalisé quand la souris repart au jeu.
  useEffect(() => {
    if (porteEncre) return
    const stopSet = bridge.on('set-draw', (drawing) => setPassthrough(!drawing))
    const stopToggle = bridge.on('toggle-draw', () => setPassthrough((p) => !p))
    // ⚠️ ET ON DEMANDE L'ÉTAT COURANT, une fois, au démarrage. Le mode n'est
    // annoncé qu'à ses CHANGEMENTS : une couche interface relancée après une
    // panne (ou simplement rechargée) repartait en croyant qu'on dessinait —
    // alors que l'utilisateur jouait. Sa fenêtre reprenait alors l'écran entier
    // au lieu de se réduire à la barre (§S12), et le calque plein écran qui
    // fait saccader le jeu revenait sans que personne ne l'ait demandé.
    let vivant = true
    void bridge.modeDessin().then((dessin) => {
      if (vivant && typeof dessin === 'boolean') setPassthrough(!dessin)
    })
    return () => {
      vivant = false
      stopSet()
      stopToggle()
    }
  }, [])

  /**
   * LE RÉGLAGE DU DIRECT : la fenêtre d'interface est-elle exclue des captures ?
   * Appliqué par la couche interface elle-même, une fois au démarrage puis à
   * chaque changement. La couche encre, elle, n'y touche jamais : elle DOIT
   * rester capturée.
   */
  useEffect(() => {
    if (!porteInterface || !coucheSeparee) return
    void bridge.setProtectionCapture(hideUiFromCapture)
  }, [hideUiFromCapture])

  /**
   * §2.5 appliqué à la couche interface : elle se cache quand elle n'a
   * strictement rien à montrer (barre masquée, aucun panneau) et sur tous les
   * écrans qui ne portent pas la barre. Une fenêtre cachée ne coûte rien au
   * compositeur — c'est la règle de performance numéro un du projet.
   */
  useLayoutEffect(() => {
    if (!porteInterface || !coucheSeparee) return
    // ⚠️ LE POSTE DE CONSOMMATION LE PLUS COÛTEUX, ET LE PLUS INUTILE.
    //
    // Une fenêtre transparente PLEIN ÉCRAN et toujours au-dessus force le
    // compositeur de Windows à empiler un calque de 1920 × 1080 À CHAQUE IMAGE
    // par-dessus le jeu. Ça ne coûte pas un cycle de processeur (rien ne
    // s'anime) : aucune mesure de CPU ne le révèle — le gestionnaire des tâches
    // affichait 0 % pendant que TOUT l'ordinateur saccadait. Mais ça coûte au
    // compositeur et à la carte graphique, et ça se paie en images par seconde
    // dans le jeu.
    //
    // PREMIÈRE PARADE, TROP BRUTALE : cacher cette fenêtre pendant le jeu. Les
    // saccades disparaissaient… et la barre d'outils avec (« je n'ai plus la
    // liste des outils, comment faire ? »). La barre RESTE donc affichée en
    // mode traversant.
    //
    // PARADE JUSTE (§S12) : quand la barre est la SEULE chose à montrer, sa
    // fenêtre est réduite au rectangle de la barre — 117 × 671 au lieu de
    // 1920 × 1080, soit moins de 4 % de la surface composée. Voir
    // src/ui/fenetre-compacte.ts.
    // ⚠️ `toolbarVisible` SEUL, et plus « toolbarVisible && !passthrough » :
    // c'est cette conjonction qui privait l'utilisateur de sa barre pendant
    // qu'il jouait. La barre reste là ; c'est sa FENÊTRE qui rétrécit.
    // Masquée au clavier (Ctrl+H) et sans panneau ouvert, la fenêtre se retire
    // toujours complètement : le coût retombe alors à zéro absolu (§2.5).
    const panneau = settingsOpen || cheatsheetOpen || replayOpen || radial !== null || !onboarded
    // La roue s'ouvre sur l'écran du clic, porteur de la barre ou non : cette
    // fenêtre-là doit donc s'afficher le temps du geste, même si elle n'a
    // d'ordinaire rien à montrer (§8.2).
    const contenu = (isHost && (toolbarVisible || panneau)) || radial !== null
    bridge.notifyActivity(contenu)
    // PLEIN ÉCRAN OBLIGATOIRE dès qu'il y a autre chose que la barre à afficher.
    // ⚠️ ET EN MODE DESSIN, TOUJOURS : le curseur personnalisé (§9.5) vit dans
    // CETTE fenêtre et doit suivre la souris sur tout l'écran. Une fenêtre à la
    // taille de la barre le ferait disparaître dès qu'on s'en éloigne — la
    // régression la plus visible qui soit pendant qu'on dessine.
    exigerPleinEcran('contenu', !passthrough || panneau || !isHost)
  }, [
    isHost,
    toolbarVisible,
    passthrough,
    settingsOpen,
    cheatsheetOpen,
    replayOpen,
    radial,
    onboarded,
  ])

  /**
   * Le curseur personnalisé est repris par la couche interface (il renseigne le
   * streamer, pas ses spectateurs) : celui du moteur s'efface donc — mais
   * UNIQUEMENT sur l'écran qui porte la barre, seul écran où la fenêtre
   * d'interface est affichée. Sur les autres, le moteur garde le sien : mieux
   * vaut un curseur visible à l'antenne que pas de curseur du tout.
   */
  useEffect(() => {
    if (!porteEncre || !coucheSeparee) return
    document.body.classList.toggle('barre-hote', isHost)
  }, [isHost])

  // Le panneau de réglages exporte la session VIVE, qui vit dans l'autre
  // fenêtre : on en redemande un instantané à chaque ouverture.
  useEffect(() => {
    if (!porteInterface || !coucheSeparee || !settingsOpen) return
    envoyerCommande({ nom: 'session-get' })
  }, [settingsOpen])

  /**
   * Clavier de la couche interface. Quand un panneau est ouvert, c'est CETTE
   * fenêtre qui a le focus : sans ces quelques touches, Échap ne fermerait plus
   * rien et l'utilisateur serait coincé devant un panneau qu'il ne peut plus
   * quitter qu'à la souris.
   */
  useEffect(() => {
    if (!porteInterface || porteEncre) return
    const onKey = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA')) return
      if (cible?.isContentEditable || isKeyCaptureActive()) return
      if (e.key !== 'Escape') return
      const s = useUiStore.getState()
      if (!s.settingsOpen && !s.cheatsheetOpen && !s.replayOpen) return
      e.preventDefault()
      s.setSettingsOpen(false)
      s.setCheatsheetOpen(false)
      s.setReplayOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * « Replacer la barre d'outils » (§S4.3), demandé depuis l'icône près de
   * l'horloge.
   *
   * Effet AUTONOME, et c'est tout l'enjeu : il doit vivre dans les DEUX couches
   * (§S11). La barre habite la fenêtre d'interface, qui ne crée aucun moteur —
   * l'abonnement ne pouvait donc pas rester dans l'effet du moteur, réservé à
   * la couche encre. Et il ne peut pas non plus vivre dans la barre elle-même :
   * masquée, elle n'est plus montée, et c'est précisément le moment où l'on a
   * besoin de la faire revenir.
   */
  useEffect(() => bridge.on('toolbar-reset', () => useUiStore.getState().resetToolbarDock()), [])

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
      badgeContinuous,
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
    badgeContinuous,
    handwriting,
    effectIntensity,
  ])

  // correcteur lexical du mode écriture (§S3) : il vit dans la session
  // d'écriture, pas dans les options du moteur — le moteur n'a pas à savoir
  // ce qu'est un dictionnaire.
  useEffect(() => {
    const hw = engineRef.current?.writing
    if (!hw) return
    hw.lexique = {
      actif: lexicon,
      categories: lexiconCategories,
      perso: lexiconWords,
    }
  }, [lexicon, lexiconCategories, lexiconWords])

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

  // encre vivante : les réglages qui changent l'apparence des traits DÉJÀ
  // POSÉS. C'est l'application qui les POUSSE — le moteur n'a pas à connaître
  // le store, sinon la source navigateur d'OBS traînerait toute la table des
  // raccourcis et le schéma des réglages pour dessiner trois traits.
  useEffect(() => {
    setInkTuning({ intensity: effectIntensity, arrowPulse, theme: themeFromQuery() ?? theme })
  }, [effectIntensity, arrowPulse, theme])

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
  // 7/8 épaisseur, plus F8 et la touche panique. Ctrl+E et Ctrl+H, eux, restent
  // volontairement LOCAUX (NEVER_GLOBAL, src/keymap.ts) : ils appartiennent au
  // navigateur et à VLC. Tout est réenregistré à chaud à chaque changement de
  // clavier : on ne demande JAMAIS de relancer l'application.
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
    // §S11 : le clavier complet appartient à la couche ENCRE, celle qui tient
    // le moteur. La couche interface n'a que sa touche Échap (plus haut) : deux
    // fenêtres qui joueraient la même touche doubleraient chaque action
    // relative (épaisseur, fondu).
    if (!porteEncre) return
    const bindings = resolveKeymap(keymapPreset, keymapOverrides)
    const lookup = buildLookup(bindings)
    const st = () => useUiStore.getState()

    /** outils momentanés : action → outil pris tant que la touche est tenue (§8.5) */
    const HOLD_TOOLS: Partial<Record<KeymapAction, ToolId>> = {
      'hold.laser': 'laser',
      'hold.spotlight': 'spotlight',
      'hold.ping': 'ping',
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

    /**
     * Entrée : transcrire tout de suite l'écriture en attente (§S3).
     *
     * Volontairement HORS de la table des raccourcis : ce n'est pas une
     * commande, c'est la validation d'une saisie en cours. Elle ne s'applique
     * que s'il y a vraiment du manuscrit à transcrire, et laisse passer la
     * touche dans tous les autres cas — un raccourci remappable sur Entrée
     * volerait la validation du champ de texte.
     */
    const toucheEntree = (e: KeyboardEvent): boolean => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
      if (e.key !== 'Enter') return false
      if (!engineRef.current?.transcribeNow()) return false
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
        toucheEntree(e)
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
        // Le ping est le seul outil momentané qui AGIT à l'appui : on appuie,
        // un repère part aussitôt sous le curseur, on relâche, l'outil
        // précédent revient. Sans ça, maintenir la touche ne ferait rien.
        if (holdTool === 'ping') eng.ping()
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
        case 'toggle.handwriting':
          e.preventDefault()
          st().toggleHandwriting()
          break
        // Masque flou (§5.6) : bascule. On repose des masques tant que l'outil
        // est choisi, la même touche revient au pinceau quand on a fini.
        case 'tool.blur':
          e.preventDefault()
          st().setTool(st().tool === 'blur' ? 'pen' : 'blur')
          setPassthrough(false)
          break
        // Avant/après (§5.7) : s'il n'y a pas encore de photo, il la prend
        // lui-même — l'utilisateur n'a pas à connaître l'ordre des gestes.
        case 'fx.compare':
          e.preventDefault()
          fxRef.current?.toggleCompare()
          break
        case 'stage.grid':
          e.preventDefault()
          st().cycleGrid()
          break
        case 'stage.clock':
          e.preventDefault()
          spawnClock('chrono')
          break
        case 'stage.note':
          e.preventDefault()
          spawnNote()
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

  /**
   * Le bouton vit dans la couche interface, le moteur dans la couche encre :
   * l'export part donc en COMMANDE. En démo navigateur, la commande est
   * exécutée sur place — même chemin, aucun détour.
   */
  const exportSession = () => envoyerCommande({ nom: 'export' })

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
                <b>F</b> flèche : trace ta courbe, la flèche l'épouse · <b>Shift</b> : flèche droite
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

      {/* ============================================================ *
          COUCHE ENCRE — CAPTURÉE PAR OBS.
          Tout ce qui est ici part dans le direct : c'est exactement ce que
          les spectateurs doivent voir, et rien d'autre.
          ============================================================ */}
      {porteEncre && (
        <>
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

          {/* Rejeu de session (§11) : calque dédié, la session vive reste intacte.
              Il vit du côté du MOTEUR, avec l'enregistreur qui le nourrit — et
              parce qu'un rejeu se regarde : il doit passer à l'antenne comme
              n'importe quelle annotation. Seule sa réglette de commandes est
              donc visible dans le direct, le temps du rejeu. */}
          {replayOpen && <ReplayBar onClose={() => useUiStore.getState().setReplayOpen(false)} />}

          {/* Miroir OBS + obs-websocket (§10.2, §7.3) — silencieux par défaut.
              Il regarde le moteur travailler : il vit donc du côté du moteur. */}
          <ObsBridge onSceneChange={() => engineRef.current?.clear()} />
        </>
      )}

      {/* ============================================================ *
          COUCHE INTERFACE — INVISIBLE DANS LES CAPTURES.
          Barre d'outils, panneaux, bandeaux, roue, curseur : tout ce qui
          renseigne le streamer et n'a RIEN à faire dans son direct.
          Sur plusieurs écrans, seul l'écran porteur de la barre l'affiche.
          ============================================================ */}
      {porteInterface && isHost && (
        <>
          {/* liseré lumineux : seul repère indiquant que le mode dessin est actif
              (brief §9.7) — repère pour l'utilisateur, donc hors caméra */}
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
              onUndo={() => envoyerCommande({ nom: 'undo' })}
              onRedo={() => envoyerCommande({ nom: 'redo' })}
              onClear={() => envoyerCommande({ nom: 'clear' })}
              onExport={exportSession}
              onFreeze={() => envoyerCommande({ nom: 'freeze' })}
              onCompare={() => envoyerCommande({ nom: 'compare' })}
              frozen={fxState.frozen}
              comparing={fxState.compare}
            />
          )}

          {/* Menu radial (§8.2) : clic droit maintenu 220 ms dans le vide.
              Le moteur (autre fenêtre) décide de l'ouverture et relaie le geste,
              la roue gère le choix et se referme elle-même au relâché. */}
          {radial && (
            <RadialMenu
              x={radial.x}
              y={radial.y}
              onClose={() => {
                envoyerCommande({ nom: 'radial-close' })
                setRadial(null)
              }}
            />
          )}

          {/* Réglages complets : thèmes, hygiène à l'écran, session et exports,
              OBS, profils, raccourcis. Le panneau embarque ProfilesPanel et
              KeymapEditor, qui sont autonomes. */}
          {settingsOpen && (
            <SettingsPanel
              getSession={() =>
                coucheSeparee ? sessionRef.current : (engineRef.current?.exportSession() ?? null)
              }
              loadSession={(s) => envoyerCommande({ nom: 'session-load', session: s })}
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

          {/* Découverte guidée — premier lancement seulement (ou ?onboarding=1) */}
          <Onboarding />

          {/* Curseur personnalisé (§9.5). Dans la fenêtre d'interface seulement :
              c'est un repère pour le streamer. Le moteur garde le sien sur les
              écrans qui ne portent pas la barre (voir l'effet `barre-hote`). */}
          {coucheSeparee && <CurseurHexa />}
        </>
      )}
    </div>
  )
}
