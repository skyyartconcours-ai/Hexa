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
  eventCombos,
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
import { download, exportSessionPng, stampName } from './replay/exporter'
import './ui/coach.css'

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

/**
 * PNG TRANSPARENT DE LA PAGE COURANTE, EN UN GESTE.
 *
 * Le chemin existait déjà — Réglages → Session → échelle → « PNG » : quatre
 * gestes pour une miniature, en plein direct. Ici : un bouton de la barre ou
 * une touche. Les annotations seules, sans le fond ni la barre (la session
 * ne contient que les traits), en 2× : net sur une miniature YouTube, léger.
 * Renvoie ce qu'il faut annoncer à l'écran.
 */
async function exporterPng(session: SessionExport | null): Promise<string> {
  if (!session || session.strokes.length === 0) return 'Rien à exporter : la page est vide'
  const blob = await exportSessionPng(session, { scale: 2, crop: false })
  if (!blob) return 'Rien à exporter : la page est vide'
  download(blob, stampName('hexa-page', 'png'))
  // « prêt », pas « exporté » : le fichier part par le téléchargement de
  // Chromium, et sans gestionnaire `will-download` dans le processus principal,
  // Electron ouvre la boîte « Enregistrer sous » du système. Tant que
  // l'utilisateur n'y a pas choisi un dossier, rien n'est écrit — vérifié ici
  // en observant le vrai événement de téléchargement (test sE-6).
  return `PNG transparent prêt (${session.strokes.length} annotation${
    session.strokes.length > 1 ? 's' : ''
  }) : choisis où l’enregistrer`
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
   * Dernier instantané de session reçu de la couche encre (§S11).
   *
   * ⚠️ IL NE SE DEMANDE PLUS À L'OUVERTURE DU PANNEAU, mais au CLIC sur un
   * bouton qui en a besoin (« Exporter », « Rejouer »). L'instantané, c'est
   * `engine.exportSession()` : un `structuredClone` de TOUTE la scène, puis une
   * traversée IPC vers cette fenêtre. Mesuré dans la couche encre — celle qui
   * est à l'antenne — 1 163 points coûtaient 1 ms, 36 818 points 47,7 ms (jusqu'à
   * 87), 82 824 points 94,7 ms (jusqu'à 139) : autant d'images perdues EN DIRECT,
   * à chaque fois que le streamer ouvre ses réglages pour changer une couleur.
   * Deux cents ouvertures faisaient passer le total des processus de 993 à
   * 1 092 Mo, non rendus après trente secondes de repos.
   *
   * Il ne sert donc plus que de filet : si la couche encre ne répond pas (fenêtre
   * en train de se fermer), on rend le dernier instantané connu plutôt que de
   * laisser un bouton sans effet.
   */
  const sessionRef = useRef<SessionExport | null>(null)
  /** Demandes de session en cours d'aller-retour, résolues à la réponse. */
  const sessionAttente = useRef<((s: SessionExport | null) => void)[]>([])

  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const smartShapes = useUiStore((s) => s.smartShapes)
  const guides = useUiStore((s) => s.guides)
  const linkBadges = useUiStore((s) => s.linkBadges)
  const annotationsHidden = useUiStore((s) => s.annotationsHidden)
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
  /** plaque de lisibilité proposée aux nouveaux textes (le champ peut la retirer) */
  const textPlate = useUiStore((s) => s.textPlate)
  /** pages d'annotation : l'interface décide, chaque moteur suit */
  const pageIndex = useUiStore((s) => s.pageIndex)
  const pageCount = useUiStore((s) => s.pageCount)
  const pageDupSeq = useUiStore((s) => s.pageDupSeq)
  const notice = useUiStore((s) => s.notice)

  const [indicator, setIndicator] = useState<string | null>(null)
  const [passthrough, setPassthrough] = useState(false)
  /** menu radial ouvert (clic droit maintenu dans le vide, §8.2) */
  const [radial, setRadial] = useState<{ x: number; y: number } | null>(null)
  /** état des effets de capture — mis à jour sur événement, jamais par image */
  const [fxState, setFxState] = useState({ frozen: false, compare: false })

  /**
   * CET ÉCRAN EST-IL L'ÉCRAN D'ANNOTATION ?
   *
   * L'utilisateur annote sur UN écran, qu'il désigne dans le menu de l'icône
   * système. Les couches des autres écrans doivent être totalement inertes :
   * le moteur du deuxième écran recevait les mouvements de souris (Windows les
   * transmet à TOUTES les fenêtres en clic traversant) et traçait une traînée
   * laser que personne ne regardait — ce qui, en prime, ressortait sa fenêtre
   * du sommeil et la faisait composer par Windows, donc payer par OBS.
   *
   * La valeur initiale vient de l'argument de lancement ; la suite arrive par
   * le canal 'ecran-annotation', pour que changer d'écran dans le menu prenne
   * effet SUR-LE-CHAMP, sans redémarrer.
   */
  const [ecranAnnotation, setEcranAnnotation] = useState(bridge.ecranAnnotation)
  useEffect(() => {
    if (!isElectron) return
    return bridge.on('ecran-annotation', (v) => setEcranAnnotation(v !== false))
  }, [])

  // Le moteur et la couche d'effets s'allument et s'éteignent avec leur écran.
  // On ne les DÉMONTE pas : les annotations déjà posées survivent, et rallumer
  // est instantané. Éteints, ils ne reçoivent plus un geste, ne demandent plus
  // une image et rendent leurs canevas à la mémoire.
  const actifRef = useRef(bridge.ecranAnnotation)
  // Point d'entrée de test, même convention que window.hexaFx / window.hexaEngine :
  // les campagnes doivent pouvoir jouer la bascule « cet écran annote / n'annote
  // plus » sans montage multi-écrans, qui n'existe pas sous xvfb.
  useEffect(() => {
    const g = window as unknown as { __hexaTestEcranAnnotation?: (v: boolean) => void }
    g.__hexaTestEcranAnnotation = (v: boolean) => setEcranAnnotation(v !== false)
    return () => {
      delete g.__hexaTestEcranAnnotation
    }
  }, [])
  useEffect(() => {
    actifRef.current = ecranAnnotation
    engineRef.current?.setActif(ecranAnnotation)
    fxRef.current?.setActif(ecranAnnotation)
    // La fenêtre doit se retirer (ou revenir) tout de suite, sans attendre le
    // prochain changement d'activité — qui, sur un écran éteint, n'arrivera
    // jamais.
    if (porteEncre) bridge.notifyActivity(ecranAnnotation && engineRef.current?.hasContent === true)
  }, [ecranAnnotation])

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
    // On applique l'état AVANT tout le reste : sur un écran qui n'annote pas,
    // rien ne doit jamais s'allumer, pas même une image.
    if (!bridge.ecranAnnotation) {
      engine.setActif(false)
      fx.setActif(false)
    }
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
    // ⚠️ Un écran qui n'annote pas ne déclare JAMAIS d'activité : sa fenêtre
    // reste cachée, donc le compositeur de Windows l'oublie, donc OBS ne la
    // paie pas. C'est la moitié « fenêtre » de la correction ; l'autre moitié
    // est `setActif` dans le moteur.
    const pushActivity = () =>
      bridge.notifyActivity(
        actifRef.current && (live.engine || live.fx || live.widgets),
      )
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
    // la plaque basculée dans le champ de texte devient le défaut (persisté)
    engine.onRequestPlate = (on) => useUiStore.getState().setTextPlate(on)
    // « épinglé » / « détaché » : dit par l'indicateur de la fenêtre d'interface
    // (hors caméra), jamais écrit en clair sur la couche encre, qui est capturée.
    engine.onPin = (on) =>
      useUiStore
        .getState()
        .notify(on ? 'Épinglé : survit à « tout effacer », au fondu, aux pages et à Ctrl+Z' : 'Détaché')
    engine.onWheelCb = (e) => {
      e.preventDefault()
      const st = useUiStore.getState()
      st.setSize(Math.min(18, Math.max(2, st.size + (e.deltaY < 0 ? 1 : -1))))
    }
    // §11 + §10.2 : l'enregistreur de session et le miroir OBS regardent le
    // moteur travailler. Appelé uniquement pendant une image active, donc
    // strictement rien au repos.
    const __dbg = ((window as unknown as Record<string, unknown>).__hexaDbg = {
      recMs: 0,
      obsMs: 0,
      appels: 0,
      recCount: 0,
      obsSent: 0,
      obsRepare: 0,
      vivants: 0,
      points: 0,
      archPoints: 0,
    } as Record<string, number>)
    engine.onMirror = (delta) => {
      const a = performance.now()
      recorder.observe(delta.strokes, delta.current)
      const b = performance.now()
      obsLink.publish(delta)
      const c = performance.now()
      const strokes = delta.strokes
      __dbg.recMs += b - a
      __dbg.obsMs += c - b
      __dbg.appels++
      __dbg.recCount = (recorder as unknown as { entries: Map<number, unknown> }).entries.size
      __dbg.obsSent = (obsLink as unknown as { sent: Map<number, unknown> }).sent.size
      // Divergences rattrapées par le filet de sécurité du miroir : DOIT rester
      // à zéro. Le contrôler, c'est vérifier que le journal du moteur n'oublie
      // aucun chemin de mutation.
      __dbg.obsRepare = obsLink.reparations
      __dbg.vivants = strokes.length
      // §4.8 — numéro que portera la prochaine pastille : c'est ce que la
      // reprise au clic droit modifie, et la seule façon de la vérifier
      // depuis l'extérieur sans ouvrir le moteur.
      __dbg.numSuivant = engine.numeroSuivant
      if (__dbg.appels % 60 === 0) {
        let p = 0
        for (const s of strokes) p += s.points.length
        __dbg.points = p
        let ap = 0
        for (const e of (
          recorder as unknown as { entries: Map<number, { s: { points: unknown[] } }> }
        ).entries.values())
          ap += e.s.points.length
        __dbg.archPoints = ap
      }
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
      else if (m.quoi === 'hints')
        window.dispatchEvent(new CustomEvent('hexa:hints', { detail: m.on }))
      else if (m.quoi === 'tour') signalTour(m.signal as TourSignal)
      else if (m.quoi === 'session') {
        const s = m.session as SessionExport
        sessionRef.current = s
        // On sert TOUTES les demandes en attente d'un coup : deux clics coup sur
        // coup ne provoquent qu'un seul clone dans la couche encre.
        const attentes = sessionAttente.current
        sessionAttente.current = []
        for (const rendre of attentes) rendre(s)
      }
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
    // ⚠️ LA PASTILLE D'ÉTAT COMPTE COMME DU CONTENU, et l'oublier coûte cher :
    // en mode dessin avec la barre masquée (Ctrl+H), cette fenêtre porte le
    // CURSEUR PERSONNALISÉ et la pastille qui rappelle l'outil actif. La cacher
    // laissait l'utilisateur dessiner sans aucun pointeur à l'écran et sans rien
    // qui lui dise comment ramener la barre — la couche encre, elle, a
    // `cursor: none` et son propre curseur éteint.
    const pastille = !passthrough && !toolbarVisible
    // La roue s'ouvre sur l'écran du clic, porteur de la barre ou non : cette
    // fenêtre-là doit donc s'afficher le temps du geste, même si elle n'a
    // d'ordinaire rien à montrer (§8.2).
    const contenu = (isHost && (toolbarVisible || panneau || pastille)) || radial !== null
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
      annotationsHidden,
      handwriting,
      effects: effectIntensity,
      textPlate,
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
    annotationsHidden,
    handwriting,
    effectIntensity,
    textPlate,
  ])

  // ---- PAGES D'ANNOTATION ------------------------------------------------
  // Dupliquer AVANT de suivre l'index : le moteur copie la page source dans la
  // page cible et s'y rend lui-même ; l'effet suivant trouve alors l'index déjà
  // à jour et ne fait rien. (Dans l'autre ordre, il irait d'abord sur une page
  // vide, puis la copie s'y ajouterait : même résultat, un détour de plus.)
  const dupJoue = useRef(0)
  useEffect(() => {
    if (pageDupSeq === dupJoue.current) return
    dupJoue.current = pageDupSeq
    const st = useUiStore.getState()
    engineRef.current?.dupliquerPage(st.pageDupFrom, st.pageIndex)
  }, [pageDupSeq])
  useEffect(() => {
    engineRef.current?.allerPage(pageIndex)
  }, [pageIndex])
  // ⚠️ UNE COUCHE RECHARGÉE RETROUVE SA PAGE. Le numéro de page n'est pas
  // persisté (les pages vivent le temps d'une session), et il n'existe aucun
  // message qui redonne l'état de l'autre fenêtre à une fenêtre qui repart.
  // Mesuré en mode deux fenêtres : interface sur 2/2, couche encre rechargée
  // (le chemin de la reprise après une panne du rendu) → moteur à 1/1, et
  // Page ↑ frappé ensuite ne fait plus rien, puisque le store de l'encre se
  // croit déjà sur la première page. sessionStorage survit au rechargement de
  // CETTE fenêtre et meurt avec elle : au prochain lancement, on repart bien
  // de la page 1.
  useEffect(() => {
    if (!coucheSeparee) return
    try {
      const brut = sessionStorage.getItem('hexa-pages')
      if (brut) {
        const v = JSON.parse(brut) as { index?: unknown; count?: unknown }
        const count = typeof v.count === 'number' && Number.isFinite(v.count) ? Math.max(1, Math.floor(v.count)) : 1
        const index =
          typeof v.index === 'number' && Number.isFinite(v.index) ? Math.min(count - 1, Math.max(0, Math.floor(v.index))) : 0
        if (index !== 0 || count !== 1) useUiStore.setState({ pageIndex: index, pageCount: count })
      }
    } catch {
      /* stockage de session indisponible : on repart de la page 1 */
    }
  }, [])
  useEffect(() => {
    if (!coucheSeparee) return
    try {
      sessionStorage.setItem('hexa-pages', JSON.stringify({ index: pageIndex, count: pageCount }))
    } catch {
      /* ignore */
    }
  }, [pageIndex, pageCount])
  // témoin lisible à chaque changement de page — jamais au montage
  const pageMontee = useRef(true)
  useEffect(() => {
    if (pageMontee.current) {
      pageMontee.current = false
      return
    }
    // l'indicateur n'est rendu que par la couche interface : dans la couche
    // encre, poser cet état ne ferait que re-rendre l'application pour rien
    if (!porteInterface) return
    setIndicator(`Page ${pageIndex + 1} / ${pageCount}`)
    const t = setTimeout(() => setIndicator(null), 1100)
    return () => clearTimeout(t)
  }, [pageIndex, pageCount])
  // messages éphémères venus du store (donc de l'une ou l'autre fenêtre)
  useEffect(() => {
    if (notice.seq === 0 || !notice.text || !porteInterface) return
    setIndicator(notice.text)
    const t = setTimeout(() => setIndicator(null), 1600)
    return () => clearTimeout(t)
  }, [notice])

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
    /** combinaisons de la touche « afficher les raccourcis » (Fin par défaut) */
    const hintsCombos = new Set(bindings['ui.hints'] ?? [])
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
      'tool.marker': 'marker',
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

      // Touche Fin MAINTENUE : la barre vit dans l'autre fenêtre, qui n'a jamais
      // le focus. On lui relaie l'appui, sinon la touche ne fait rien.
      if (hintsCombos.size > 0 && !e.repeat && eventCombos(e).some((c) => hintsCombos.has(c))) {
        annoncerEtatEncre({ quoi: 'hints', on: true })
      }

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
        case 'edit.deleteHovered':
          e.preventDefault()
          // Rien sous le curseur : rien ne part, et c'est silencieux — comme
          // la gomme passée sur une zone vide.
          if (eng.supprimerSousLeCurseur()) signalTour('erase')
          break
        case 'edit.pin':
          e.preventDefault()
          // le retour visuel (onde + « épinglé ») est peint par le moteur sur
          // la couche vive ; rien sous le curseur = rien ne se passe
          eng.epinglerSousLeCurseur()
          break
        case 'page.next':
          e.preventDefault()
          st().nextPage()
          break
        case 'page.prev':
          e.preventDefault()
          st().prevPage()
          break
        case 'page.new':
          e.preventDefault()
          st().newPage()
          break
        case 'page.dup':
          e.preventDefault()
          st().duplicatePage()
          break
        case 'export.png':
          e.preventDefault()
          // Couche encre : le moteur est ici, pas d'aller-retour. L'annonce
          // passe par le store pour s'afficher dans la fenêtre d'interface.
          void exporterPng(eng.exportSession()).then((msg) => st().notify(msg))
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
        case 'ui.hideInk':
          e.preventDefault()
          st().toggleAnnotationsHidden()
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
      if (hintsCombos.size > 0 && eventCombos(e).some((c) => hintsCombos.has(c))) {
        annoncerEtatEncre({ quoi: 'hints', on: false })
      }
      const held = heldKeyRef.current
      if (!held || heldToolRef.current == null) return
      if (e.key.toLowerCase() !== held.key && e.code !== held.code) return
      st().setTool(heldToolRef.current)
      heldToolRef.current = null
      heldKeyRef.current = null
    }

    // Perdre le focus la touche enfoncée laisserait la barre gonflée : on
    // annonce le relâché comme si la touche était rendue.
    const onBlurHints = () => annoncerEtatEncre({ quoi: 'hints', on: false })

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlurHints)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlurHints)
    }
  }, [keymapPreset, keymapOverrides])

  /**
   * Le bouton vit dans la couche interface, le moteur dans la couche encre :
   * l'export part donc en COMMANDE. En démo navigateur, la commande est
   * exécutée sur place — même chemin, aucun détour.
   */
  const exportSession = () => envoyerCommande({ nom: 'export' })

  /** bouton « image PNG » de la barre : l'instantané est réclamé, puis rendu ici */
  const exportPng = () =>
    void demanderSession().then((s) => exporterPng(s).then((msg) => useUiStore.getState().notify(msg)))

  /**
   * Instantané de la scène vive, RÉCLAMÉ SEULEMENT QUAND ON EN A BESOIN.
   *
   * Un aller-retour avec la couche encre, déclenché par un clic sur « Exporter »
   * ou « Rejouer » — plus jamais par la simple ouverture du panneau. Ouvrir les
   * réglages pour changer une couleur ne coûte donc plus rien à l'antenne.
   */
  const demanderSession = (): Promise<SessionExport | null> => {
    if (!coucheSeparee) return Promise.resolve(engineRef.current?.exportSession() ?? null)
    return new Promise((resolve) => {
      let minuteur: ReturnType<typeof setTimeout> | null = null
      let fini = false
      const rendre = (s: SessionExport | null) => {
        if (fini) return
        fini = true
        if (minuteur != null) clearTimeout(minuteur)
        resolve(s)
      }
      sessionAttente.current.push(rendre)
      // Filet : si la couche encre ne répond pas (fenêtre en train de se
      // fermer), on rend le dernier instantané connu au lieu de laisser le
      // bouton sans effet. Une seule minuterie, armée au clic, jamais un
      // intervalle.
      minuteur = setTimeout(() => {
        sessionAttente.current = sessionAttente.current.filter((f) => f !== rendre)
        rendre(sessionRef.current)
      }, 2000)
      envoyerCommande({ nom: 'session-get' })
    })
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
                <b>Clic droit bref sur une pastille du numéroteur</b> : la série repart de ce
                numéro (la suivante s'y relie) — avec un mouvement, c'est un déplacement
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
          {/* ⚠️ `ecranAnnotation` : sur un écran qui n'annote pas, RIEN n'est
              peint — pas même la grille, qui est pourtant du CSS pur. Le store
              d'interface est partagé entre les fenêtres : allumer la grille la
              faisait apparaître sur TOUS les écrans, ce qui ressortait leur
              fenêtre du sommeil et la faisait composer par Windows — donc payer
              par OBS, qui capture l'écran.
              La SCÈNE, elle, reste montée : c'est le support du moteur, et un
              div vide ne coûte rien. Ses canevas sont à 0×0 (voir setActif). */}
          {ecranAnnotation && <StageGrid />}

          <div ref={stageRef} className="stage" data-tool={tool}>
            <canvas ref={staticRef} />
            <canvas ref={liveRef} />
          </div>

          {/* Chronos, comptes à rebours et notes posés à l'écran (§5.8.2, §5.8.3).
              Les notes sont immunisées au fondu et à la touche panique : elles
              vivent dans le store, pas dans la liste des annotations. */}
          {ecranAnnotation && <StageWidgets />}

          {/* Rejeu de session (§11) : calque dédié, la session vive reste intacte.
              Il vit du côté du MOTEUR, avec l'enregistreur qui le nourrit — et
              parce qu'un rejeu se regarde : il doit passer à l'antenne comme
              n'importe quelle annotation. Seule sa réglette de commandes est
              donc visible dans le direct, le temps du rejeu. */}
          {ecranAnnotation && replayOpen && (
            <ReplayBar onClose={() => useUiStore.getState().setReplayOpen(false)} />
          )}

          {/* Miroir OBS + obs-websocket (§10.2, §7.3) — silencieux par défaut.
              Il regarde le moteur travailler : il vit donc du côté du moteur. */}
          {/* Le miroir OBS regarde le MOTEUR travailler : un écran qui n'annote
              pas n'a rien à miroiter, et deux émetteurs pour une même vue se
              disputeraient le fil. */}
          {ecranAnnotation && <ObsBridge onSceneChange={() => engineRef.current?.clear()} />}
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
              onExportPng={exportPng}
              onFreeze={() => envoyerCommande({ nom: 'freeze' })}
              onCompare={() => envoyerCommande({ nom: 'compare' })}
              frozen={fxState.frozen}
              comparing={fxState.compare}
              passthrough={passthrough}
            />
          )}

          {/* Réglages complets : thèmes, hygiène à l'écran, session et exports,
              OBS, profils, raccourcis. Le panneau embarque ProfilesPanel et
              KeymapEditor, qui sont autonomes. */}
          {settingsOpen && (
            <SettingsPanel
              getSession={demanderSession}
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

      {/* ============================================================ *
          MENU RADIAL (§8.2) — VOLONTAIREMENT HORS DU BLOC `isHost`.
          ============================================================
          C'est tout l'objet du correctif « le clic droit apparaît sur
          l'écran de droite ». Le geste se déroule dans la couche ENCRE de
          L'ÉCRAN CLIQUÉ ; le processus principal route donc l'ouverture vers
          la couche interface de CE MÊME écran (electron/main.ts,
          'hexa:etat-encre'), et les deux fenêtres d'un écran ont exactement
          les mêmes bornes : les coordonnées arrivent déjà bonnes, sans aucune
          conversion.
          Restait le dernier verrou, ici : cette fenêtre-là ne rendait RIEN
          quand elle ne portait pas la barre. La roue était bien adressée au
          bon écran… et personne ne la dessinait. Elle sort donc du bloc.
          La fenêtre s'affiche le temps du geste (`contenu` plus haut) et se
          retire ensuite. Sur un écran unique, `isHost` est vrai : strictement
          rien ne change.
          Le curseur personnalisé suit la roue sur cet écran-là : sans lui, la
          couche encre ayant masqué le sien pendant le geste, il n'y aurait
          plus aucun pointeur à l'écran. */}
      {porteInterface && radial && (
        <>
          <RadialMenu
            x={radial.x}
            y={radial.y}
            onClose={() => {
              envoyerCommande({ nom: 'radial-close' })
              setRadial(null)
            }}
          />
          {coucheSeparee && !isHost && <CurseurHexa />}
        </>
      )}
    </div>
  )
}
