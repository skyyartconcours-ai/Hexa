import type {
  EngineOptions,
  LaserPoint,
  MirrorDelta,
  Particle,
  SessionExport,
  Stroke,
  StrokePoint,
  ToolId,
} from './types'
import { clamp, dist, easeInQuad, easeOutCubic, pointToSegment, rgba, whiteMix } from './geometry'
import { renderEmber, renderStroke } from './render'
import {
  paintSpotDraft,
  paintVeil,
  pushLassoPoint,
  regionUsable,
  type SpotRegion,
} from './stream-fx'
import { emberSprite, fxKeepsAlive, inkLayer, setInkInvalidate } from './ink-fx'
import { dissolveDuration, emberAt, panicDying } from './dissolve'
import { OneEuro } from './oneEuro'
import { sfx } from '../audio'
import {
  hitShape,
  renderMorph,
  resample,
  shapeOutline,
  squarify,
  alignLoop,
  easeOutBack,
} from './shapes'
import type { MorphAnim, Pt } from './shapes'
import { beautifyArrow, cumLen, pathLen } from './arrow'
import { recognize } from './recognizer'
import { DEMORPH_MS, Handwriting, clearMorphs } from './handwriting'
import { GuideOverlay, buildAnchors, snapPoint } from './guides'
import type { Anchor } from './guides'
import {
  BADGE_ANIM,
  BADGE_LINK_ANIM,
  REPRISE_CUE_MS,
  badgeRadius,
  imageFromClipboard,
  openTextInput,
  renderReprise,
  setImageInvalidate,
  textBox,
  textSizeOf,
} from './teaching'
import type { RepriseCue } from './teaching'

/** durée de vie de la traînée laser (§5.3) — une vraie comète, pas un pointillé */
const LASER_TTL = 650
const SNAP_RAD = (15 * Math.PI) / 180
/** durée du morph entre le tracé brut et la forme parfaite (§4.1.5) */
const MORPH_MS = 150
const MORPH_SAMPLES = 72

/** clic droit maintenu dans le vide → menu radial (§8.2) */
const RADIAL_HOLD = 220
/** au-delà, le geste est un déplacement, pas un maintien : on annule la roue */
const RADIAL_SLOP = 18
/** ping (§5.4) : deux contractions puis disparition */
const PING_MS = 900
/** spotlight (§5.2) : ouverture/fermeture élastique douce */
const SPOT_MS = 250
/** attrapé au clic droit : léger grossissement autour du centroïde */
const GRAB_SCALE = 1.04
const GRAB_IN_MS = 150
const GRAB_BACK_MS = 520

/**
 * CLIC DROIT BREF SUR UNE PASTILLE = REPRISE DE LA NUMÉROTATION (§4.8).
 *
 * Le clic droit sert à DÉPLACER une annotation, et ce geste-là est central :
 * il n'est pas question de le sacrifier. On distingue donc les deux par ce
 * qu'ils sont réellement — un déplacement DÉPLACE, un clic ne bouge pas :
 *
 *   • relâché sous REPRISE_MS et sans avoir bougé de plus de REPRISE_SLOP
 *     → la pastille n'a pas été déplacée, c'était un clic : la série repart
 *       d'elle, et la pastille est remise à l'IMAGE PRÈS là où elle était ;
 *   • tout le reste → déplacement, exactement comme avant.
 *
 * Le seuil de durée donne en prime une porte de sortie : maintenir sans bouger
 * puis relâcher ne fait rien du tout, comme aujourd'hui.
 */
const REPRISE_MS = 450
const REPRISE_SLOP = 8

/** retour élastique (relâché d'une annotation attrapée) */
const easeOutElastic = (t: number): number => {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

/** Étincelle : une particule enrichie d'un éclat en croix pour les plus grosses.
 *  Défini ici (et pas dans types.ts) pour rester purement interne au moteur. */
interface Spark extends Particle {
  /** 0 = braise ronde, 1 = éclat à quatre branches */
  glint: number
  /** rotation de l'éclat, en radians */
  rot: number
}

/** Ping éphémère (§5.4) : jamais dans l'undo, jamais dans l'export */
interface Ping {
  x: number
  y: number
  t: number
  color: string
}

/** outils qui démarrent un tracé au clic gauche */
const FREEHAND_TOOLS = new Set(['pen', 'highlight'])
const TWO_POINT_TOOLS = new Set(['line', 'rect', 'ellipse', 'measure'])
/**
 * Outils dont le GESTE ENTIER est capturé puis embelli (§4.2.2). La flèche
 * en fait partie : on trace sa courbe à main levée, elle l'épouse. Shift
 * maintenu la redresse. Capture à la main levée, mais ni comète ni
 * dissolution en queue : ces flèches restent des objets nets.
 */
const GESTURE_TOOLS = new Set(['arrow'])
/** outils qui posent une annotation d'un seul clic */
const CLICK_TOOLS = new Set(['text', 'badge', 'marker', 'stamp'])

/** nombre d'effacements complets qu'on sait encore rendre (§64 : Ctrl+Z) */
const CLEAR_HISTORY = 8

/**
 * Une entrée de la pile de RÉTABLISSEMENT (Ctrl+Y).
 *
 * Annuler, dans Hexa, ne se résume pas à retirer un trait : le premier Ctrl+Z
 * défait aussi un redressement de forme, une transcription d'écriture ou un
 * effacement complet. Chacun de ces gestes doit donc avoir sa marche avant,
 * sinon la moitié des annulations n'a aucun retour possible — le brief §182
 * promet « annuler et rétablir, illimités ».
 */
type RedoEntry =
  /** trait retiré de la scène : on le repose tel quel */
  | { kind: 'stroke'; stroke: Stroke }
  /** forme rendue à son gribouillis (§4.1.5) : on rejoue le redressement */
  | { kind: 'reshape'; id: number }
  /** mode écriture : on refait l'échange encre → mot typographié */
  | { kind: 'swap'; remove: Stroke[]; add: Stroke[] }
  /** touche panique annulée : on refait l'effacement */
  | { kind: 'clear' }
  /** coup de gomme annulé : on regomme exactement les mêmes traits */
  | { kind: 'erase'; strokes: Stroke[] }

/**
 * Un lot de traits retirés d'un coup — touche panique ou passage de gomme —
 * gardé le temps qu'un Ctrl+Z puisse les rendre (§64, « undo parfait »).
 */
interface RemovedBatch {
  /** traits retirés, avec leur place d'origine dans la pile de rendu */
  strokes: { s: Stroke; i: number }[]
  /**
   * Compteur d'identifiants à l'instant du retrait : tout trait dont
   * l'identifiant est supérieur a été posé APRÈS, et s'annule donc AVANT lui.
   * C'est ce qui garde l'ordre de l'historique juste sans pile globale.
   */
  seq: number
  /** la panique se refait d'un bloc (Ctrl+Y), la gomme trait par trait */
  mode: 'panic' | 'erase'
}

/**
 * Moteur de rendu et d'interaction de Hexa.
 *
 * Règles de performance (brief §13) :
 *  - zéro boucle quand rien n'est animé : la rAF ne tourne que pendant un tracé,
 *    une dissolution, une traînée laser ou des particules, puis s'arrête ;
 *  - deux canvas : `staticCv` (annotations posées, redessiné seulement quand
 *    nécessaire) et `liveCv` (trait en cours, laser, particules) ;
 *  - les réveils différés (fondu auto) passent par un setTimeout unique.
 */
export class HexaEngine {
  private stage: HTMLElement
  private staticCv: HTMLCanvasElement
  private liveCv: HTMLCanvasElement
  private sCtx: CanvasRenderingContext2D
  private lCtx: CanvasRenderingContext2D
  private cursor: HTMLDivElement

  private opts: EngineOptions = {
    tool: 'pen',
    color: '#00e5ff',
    size: 6,
    fadeDelay: 4000,
    sparkles: true,
    smartShapes: true,
    guides: true,
    linkBadges: true,
    badgeContinuous: false,
    annotationsHidden: false,
  }

  private strokes: Stroke[] = []
  private redoStack: RedoEntry[] = []
  /** retraits encore annulables : touche panique et coups de gomme */
  private cleared: RemovedBatch[] = []
  /** lot de la gomme EN COURS : tout un passage s'annule d'un seul Ctrl+Z */
  private eraseLot: RemovedBatch | null = null
  /** mode écriture : mot dont le dé-morph (Ctrl+Z) est encore en vol.
   *  Un Ctrl+Y pendant ces ~340 ms doit le rattraper au vol, pas se tromper
   *  d'entrée dans la pile. */
  private hwUndoing: Stroke | null = null
  private current: Stroke | null = null
  private particles: Spark[] = []
  private laser: LaserPoint[] = []
  private grabbed: Stroke | null = null
  private grabLast = { x: 0, y: 0 }
  /** point et instant de l'appui : c'est ce qui sépare le clic du déplacement */
  private grabFrom = { x: 0, y: 0 }
  private grabAt = 0
  /** signal « la série repart d'ici » affiché sur la pastille désignée */
  private repriseCue: RepriseCue | null = null
  private erasing = false
  private pointer = { x: -200, y: -200 }
  private shiftHeld = false
  private altHeld = false
  /** geste brut d'une flèche en cours — `current.points` porte la version embellie */
  private gesture: StrokePoint[] = []

  /** pings en cours (§5.4) — effet éphémère, hors undo et hors fondu auto */
  private pings: Ping[] = []

  /** spotlight (§5.2) : voile sombre + trou dégradé, rendu SOUS les annotations */
  private veilCv: HTMLCanvasElement
  private vCtx: CanvasRenderingContext2D
  private spotOn = false
  /** valeur de l'ouverture au démarrage de l'animation en cours */
  private spotFrom = 0
  private spotAt = -1e9
  private spotR = 180
  /** le voile a-t-il encore quelque chose de dessiné à effacer ? */
  private veilPainted = false
  /** §5.2 — zone figée par un geste : rectangle tracé à la volée ou lasso.
   *  `null` = variante par défaut, le disque qui suit le curseur. */
  private spotRegion: SpotRegion | null = null
  /** zone en cours de tracé (le geste n'est pas encore relâché) */
  private spotDraw: SpotRegion | null = null

  /** clic droit maintenu dans le vide → menu radial (§8.2) */
  private radialTimer: ReturnType<typeof setTimeout> | null = null
  private radialFrom = { x: 0, y: 0 }
  private radialOpen = false

  /** effet de RENDU de l'attrapé : grossissement + retour élastique.
   *  Ne touche JAMAIS les points de l'annotation (l'export reste exact). */
  private grabAnim: { id: number; start: number; from: number; back: boolean } | null = null

  /** morphs en cours (hors Stroke : jamais sérialisé) */
  private morphs = new Map<number, MorphAnim>()
  /** mode écriture : file d'analyse, reconnaissance et morph typographique */
  private hw = new Handwriting()
  /** guides magnétiques : index des points remarquables + calque de rendu */
  private overlay = new GuideOverlay()
  private anchors: Anchor[] = []
  private anchorsDirty = true
  /** numéroteur */
  private badgeSeq = 1
  private lastBadgeId: number | null = null
  /**
   * Compteur des JALONS, strictement séparé de celui du numéroteur : on doit
   * pouvoir tracer un parcours 1→5 au numéroteur ET poser des jalons 1, 2, 3
   * sur la même carte sans que l'un décale l'autre.
   */
  private jalonSeq = 1
  /** jalon qui tient la série après une reprise au clic droit */
  private ancreJalon: number | null = null
  /**
   * Pastille qui tient la série en cours : la dernière posée, ou celle que
   * l'utilisateur a désignée au clic droit bref. Tant qu'elle est à l'écran,
   * c'est elle qui donne le numéro suivant — sinon la première pastille qui
   * s'efface au fondu rappellerait `syncBadgeSeq` et effacerait le choix.
   */
  private ancreSerie: number | null = null
  /** éditeur de texte flottant en cours (fonction de fermeture) */
  private closeText: (() => void) | null = null
  /** dernière image collée, prête à être tamponnée */
  private pendingStamp: { src: string; w: number; h: number } | null = null

  private running = false
  private raf = 0
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  /** une image de rendu a déjà échoué : on ne noie pas la console à 60 Hz */
  private renderFailed = false
  private staticDirty = true
  private lastFrame = 0
  private idSeq = 1
  private w = 0
  private h = 0
  /**
   * Dernier rapport pixels physiques / pixels CSS appliqué aux canvas. Gardé
   * pour repérer un changement de mise à l'échelle Windows (100 % → 125 %) :
   * la taille en pixels CSS peut alors rester identique alors que le fond de
   * rendu, lui, doit être réalloué (§12.3).
   */
  private dpr = 0
  private fx: OneEuro | null = null
  private fy: OneEuro | null = null
  private lastActivity = false
  private detachFns: (() => void)[] = []

  /** notifié quand la couche passe de vide à non-vide (et inversement) —
   *  sert à la règle §2.5 du brief : masquer la fenêtre quand il n'y a rien */
  onActivity?: (hasContent: boolean) => void

  /**
   * Miroir de l'état, appelé À CHAQUE IMAGE ACTIVE (donc jamais au repos, la
   * boucle étant dormante). Sert à l'enregistreur de session (§11) et au miroir
   * OBS (§10.2). Les tableaux fournis appartiennent au moteur : les lire, ne
   * jamais les modifier. Les consommateurs s'échantillonnent eux-mêmes.
   *
   * ⚠️ LE MOTEUR DIT CE QU'IL A TOUCHÉ (voir MirrorDelta). Sans ça, le miroir
   * OBS n'a d'autre choix que de relire toute la scène à chaque image, et le
   * coût par image se met à suivre le remplissage du tableau — donc la durée
   * du direct.
   */
  onMirror?: (delta: MirrorDelta) => void

  /* --- journal des changements, remis à zéro à chaque image -------------- */
  /** traits apparus ou modifiés depuis l'image précédente */
  private sales = new Set<Stroke>()
  /** identifiants sortis de la scène depuis l'image précédente */
  private partis = new Set<number>()
  /** objet remis au miroir, RÉUTILISÉ : zéro allocation par image */
  private delta: MirrorDelta = {
    strokes: [],
    current: null,
    changed: this.sales,
    gone: this.partis,
  }

  /**
   * Ce trait vient de changer (ou d'arriver) : le miroir devra le relire.
   *
   * Coût : une entrée dans un ensemble. À appeler partout où l'on touche un
   * champ d'un trait — c'est le prix, minuscule, de ne plus jamais relire les
   * traits qui, eux, n'ont pas bougé.
   */
  private salir(s: Stroke): void {
    this.partis.delete(s.id)
    this.sales.add(s)
  }

  /** Ce trait quitte la scène (annulé, dissous, geste avorté). */
  private sortir(s: Stroke): void {
    this.sales.delete(s)
    this.partis.add(s.id)
  }

  constructor(stage: HTMLElement, staticCv: HTMLCanvasElement, liveCv: HTMLCanvasElement) {
    this.stage = stage
    this.staticCv = staticCv
    this.liveCv = liveCv
    this.sCtx = staticCv.getContext('2d')!
    this.lCtx = liveCv.getContext('2d')!
    // Voile du spotlight : un troisième canvas glissé SOUS les annotations.
    // C'est ce qui fait que l'écran s'assombrit mais que le trait, lui, reste
    // parfaitement lumineux — un voile posé par-dessus ternirait tout.
    this.veilCv = document.createElement('canvas')
    this.veilCv.className = 'veil-canvas'
    stage.insertBefore(this.veilCv, stage.firstChild)
    this.vCtx = this.veilCv.getContext('2d')!
    this.cursor = document.createElement('div')
    this.cursor.className = 'cursor-dot'
    stage.appendChild(this.cursor)

    const down = (e: PointerEvent) => this.onDown(e)
    const move = (e: PointerEvent) => this.onMove(e)
    const up = (e: PointerEvent) => this.onUp(e)
    const menu = (e: Event) => e.preventDefault()
    const resize = () => this.resize()
    const wheel = (e: WheelEvent) => this.onWheel(e)
    const paste = (e: ClipboardEvent) => this.onPaste(e)
    window.addEventListener('paste', paste)
    this.detachFns.push(() => window.removeEventListener('paste', paste))
    // Shift pressé ou relâché SANS bouger la souris doit redresser (ou
    // recourber) la flèche en cours immédiatement : le clavier ne produit
    // aucun pointermove, il faut donc l'écouter. Rien ne se réveille en
    // dehors d'un geste en cours.
    const shiftWatch = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || !this.current || !GESTURE_TOOLS.has(this.current.tool)) return
      const held = e.type === 'keydown'
      if (held === this.shiftHeld) return
      this.shiftHeld = held
      this.refreshGesture(this.current)
      this.wake()
    }
    window.addEventListener('keydown', shiftWatch)
    window.addEventListener('keyup', shiftWatch)
    this.detachFns.push(() => {
      window.removeEventListener('keydown', shiftWatch)
      window.removeEventListener('keyup', shiftWatch)
    })
    // une image qui finit de charger doit relancer un rendu (jamais de boucle)
    setImageInvalidate(() => {
      this.staticDirty = true
      this.wake()
    })
    // ---- calque consolidé (S4) : un réglage qui change l'apparence des
    // traits déjà posés (thème clair, intensité) doit repeindre tout de suite
    setInkInvalidate(() => {
      this.staticDirty = true
      this.wake()
    })
    stage.addEventListener('pointerdown', down)
    stage.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    stage.addEventListener('pointercancel', up)
    stage.addEventListener('contextmenu', menu)
    stage.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('resize', resize)
    this.detachFns.push(() => {
      stage.removeEventListener('pointerdown', down)
      stage.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      stage.removeEventListener('pointercancel', up)
      stage.removeEventListener('contextmenu', menu)
      stage.removeEventListener('wheel', wheel)
      window.removeEventListener('resize', resize)
    })

    this.resize()
    this.syncCursor()
    // Point d'entrée de test, même convention que la couche d'effets
    // (`window.hexaFx`) : les campagnes bout en bout pilotent la VRAIE
    // application et doivent pouvoir lire ce que le moteur tient vraiment,
    // plutôt que de le déduire de pixels.
    ;(window as unknown as { hexaEngine?: HexaEngine }).hexaEngine = this
  }

  /** la molette est gérée par l'app (taille du pinceau) — seam volontaire */
  onWheelCb?: (e: WheelEvent) => void

  /** le moteur demande un changement d'outil (collage d'image → tampon) */
  onRequestTool?: (tool: ToolId) => void

  /** le moteur demande un changement d'épaisseur (molette sur le champ texte) */
  onRequestSize?: (size: number) => void

  /** clic droit maintenu 220 ms dans le vide : l'interface ouvre la roue (§8.2) */
  onRadial?: (x: number, y: number) => void

  /** tout vient d'être effacé : l'interface referme roue, spotlight, panneaux */
  onPanic?: () => void

  /** la molette a changé le rayon du spotlight : à persister dans le store */
  onSpotRadius?: (r: number) => void

  destroy(): void {
    for (const fn of this.detachFns) fn()
    clearMorphs()
    cancelAnimationFrame(this.raf)
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    if (this.radialTimer) clearTimeout(this.radialTimer)
    this.closeText?.()
    setImageInvalidate(null)
    // le calque consolidé est un cache : on rend la mémoire tout de suite
    setInkInvalidate(null)
    inkLayer.reset()
    this.cursor.remove()
    this.veilCv.remove()
  }

  setOptions(patch: Partial<EngineOptions>): void {
    const prevFade = this.opts.fadeDelay
    const prevTool = this.opts.tool
    const prevColor = this.opts.color
    const prevHidden = this.opts.annotationsHidden
    const prevFx = this.opts.effects
    this.opts = { ...this.opts, ...patch }
    // ---- calque consolidé (S4) ----------------------------------------
    // L'intensité des effets change l'apparence des traits DÉJÀ POSÉS : sans
    // ça, le curseur des réglages ne se voyait qu'au trait suivant. On salit
    // la couche statique, le calque se reconstruit tout seul à l'image d'après.
    if (this.opts.effects !== prevFx) {
      this.staticDirty = true
      this.wake()
    }
    // ---- fin ----------------------------------------------------------
    // RALLUMAGE des annotations : le fondu a été suspendu pendant la coupure,
    // on lui rend un compte à rebours complet — sinon tout ce qui était « presque
    // mort » disparaîtrait dans la seconde qui suit le retour à l'écran.
    if (
      patch.annotationsHidden === false &&
      prevHidden === true &&
      this.opts.fadeDelay != null
    ) {
      const t = performance.now()
      for (const s of this.strokes) {
        if (s.dying) continue
        s.dieAt = t + this.opts.fadeDelay
        this.salir(s)
      }
    }
    if (patch.annotationsHidden !== undefined && patch.annotationsHidden !== prevHidden) {
      this.staticDirty = true
      this.emitActivity()
      this.wake()
    }

    // NUMÉROTEUR : changer de couleur ouvre une NOUVELLE série, qui repart de 1.
    // C'est ainsi qu'on annote une carte — un parcours cyan pour une équipe, un
    // parcours rose pour l'autre — et la liaison automatique ne doit surtout pas
    // relier la dernière pastille d'une série à la première de la suivante.
    // L'option « poursuivre » rend l'ancien comportement continu.
    if (patch.color !== undefined && patch.color !== prevColor && !this.opts.badgeContinuous) {
      this.badgeSeq = 1
      this.lastBadgeId = null
      // Même règle pour les jalons : une couleur, une série.
      this.jalonSeq = 1
      this.ancreJalon = null
      this.ancreSerie = null
    }
    if (this.opts.tool !== prevTool && prevTool === 'text') this.closeText?.()
    // le spotlight vit tant que son outil est sélectionné (§8.5 : maintien de
    // touche = il s'ouvre à l'appui et se referme au relâchement)
    if (this.opts.tool !== prevTool) this.setSpot(this.opts.tool === 'spotlight')
    // mode écriture coupé : la file d'analyse en attente est abandonnée, le
    // gribouillis déjà posé reste tel quel
    if ('handwriting' in patch && this.opts.handwriting !== true) this.hw.reset()
    if ('fadeDelay' in patch && this.opts.fadeDelay !== prevFade) {
      const now = performance.now()
      // RATTRAPAGE — allonger le fondu (ou le couper) alors qu'un schéma
      // commence à s'effacer doit le SAUVER : c'est le geste réflexe « non non,
      // garde ça à l'écran ! » pendant qu'on parle encore dessus. Seules les
      // dissolutions dues au fondu automatique sont rattrapées : ce que la
      // gomme ou la touche panique viennent d'emporter reste emporté.
      const rattrape =
        this.opts.fadeDelay == null || prevFade == null || this.opts.fadeDelay > prevFade
      for (const s of this.strokes) {
        if (s.dying) {
          if (!rattrape || s.dying.cause !== 'fade') continue
          s.dying = undefined
          this.staticDirty = true
        }
        s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
        this.salir(s)
      }
      this.wake()
    }
    this.syncCursor()
  }

  /* ------------------------------------------------------------------ *
   * Effets stream : spotlight, ping, menu radial (§5.2, §5.4, §8.2)
   * ------------------------------------------------------------------ */

  /** rayon du disque éclairé, réglable à la molette (80 → 500 px) */
  setSpotRadius(r: number): void {
    const next = clamp(r, 80, 500)
    if (next === this.spotR) return
    this.spotR = next
    if (this.spotVisible(performance.now())) this.wake()
  }

  /** l'interface a refermé la roue : le moteur reprend la main sur le pointeur */
  closeRadial(): void {
    this.radialOpen = false
    this.cursor.classList.remove('is-hidden')
  }

  /** ping au curseur (§5.4) — aussi appelé par la touche momentanée */
  ping(): void {
    this.spawnPing(this.pointer.x, this.pointer.y)
  }

  /**
   * Mode écriture : transcrire tout de suite ce qui est en attente, sans
   * attendre les 600 ms d'inactivité (raccourci de déclenchement manuel).
   * Renvoie false si la file est vide — l'appelant peut alors laisser la
   * touche à quelqu'un d'autre.
   */
  transcribeNow(): boolean {
    if (!this.hw.trigger(performance.now())) return false
    this.wake()
    return true
  }

  /** y a-t-il de l'écriture en attente de transcription ? */
  get writingPending(): boolean {
    return this.hw.hasPending
  }

  /**
   * Session d'écriture, exposée telle quelle : c'est par elle qu'un
   * correcteur lexical s'abonne au mot en construction (`onWord`), le lit
   * (`currentWord()`) et le remet en forme (`rewrite(id, texte)`).
   * Voir le contrat HwWord / HwLetter dans engine/handwriting/index.ts.
   */
  get writing(): Handwriting {
    return this.hw
  }

  undo(): void {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]
      if (s.dying) continue
      // Un effacement complet plus RÉCENT que ce trait passe d'abord : sans ce
      // test, Ctrl+Z rongerait le tableau restauré avant de rendre l'effacement.
      if (this.undoCleared(s)) return
      // 1er Ctrl+Z après une transcription : on REND LE GRIBOUILLIS, le morph
      // se rejoue à l'envers (mode écriture). L'échange effectif est fait par
      // la boucle quand le dé-morph est terminé — c'est là que la marche avant
      // (Ctrl+Y) est empilée, quand on sait exactement ce qui a été échangé.
      if (s.tool === 'glyph' && s.ink) {
        if (this.hw.demorph(s, performance.now())) {
          s.anim = { start: performance.now(), duration: DEMORPH_MS }
          this.salir(s)
          this.hwUndoing = s
          this.staticDirty = true
          this.wake()
          return
        }
        continue
      }
      // 1er Ctrl+Z après un redressement : on rend le TRACÉ BRUT (§4.1.5).
      // Le rétablissement rejoue la reconnaissance sur ce même tracé : elle
      // est déterministe, donc Ctrl+Y redonne exactement la même forme.
      if (s.raw) {
        const now = performance.now()
        this.morphs.delete(s.id)
        s.points = s.raw
        s.raw = undefined
        s.tool = 'pen'
        s.filled = undefined
        s.anim = undefined
        s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
        this.salir(s)
        this.redoStack.push({ kind: 'reshape', id: s.id })
        this.anchorsDirty = true
        this.staticDirty = true
        this.wake()
        return
      }
      this.strokes.splice(i, 1)
      this.sortir(s)
      this.redoStack.push({ kind: 'stroke', stroke: s })
      if (s.tool === 'badge') this.syncBadgeSeq()
      else if (s.tool === 'marker') this.syncJalonSeq()
      this.anchorsDirty = true
      this.staticDirty = true
      this.wake()
      return
    }
    // plus aucun trait vivant : reste peut-être un effacement complet à rendre
    this.undoCleared(null)
  }

  /** enregistre un lot retiré, en bornant la mémoire de l'historique */
  private pousserLot(lot: RemovedBatch): void {
    this.cleared.push(lot)
    if (this.cleared.length > CLEAR_HISTORY) this.cleared.shift()
  }

  /**
   * Rend le dernier lot retiré (touche panique ou coup de gomme) s'il est plus
   * récent que `plusRecent`, le dernier trait encore à l'écran. Renvoie false
   * s'il n'y a rien à rendre ou si un trait posé APRÈS doit s'annuler d'abord.
   */
  private undoCleared(plusRecent: Stroke | null): boolean {
    const lot = this.cleared[this.cleared.length - 1]
    if (!lot) return false
    if (plusRecent && plusRecent.id >= lot.seq) return false
    this.cleared.pop()
    if (lot === this.eraseLot) this.eraseLot = null
    const now = performance.now()
    const revenus = new Set(lot.strokes.map((e) => e.s))
    // les exemplaires encore en cours de dissolution sont retirés puis remis
    // À LEUR PLACE : un trait gommé par erreur revient SOUS ceux qui le
    // recouvraient, jamais par-dessus. La pile de rendu retrouve sa profondeur.
    const liste = this.strokes.filter((s) => !revenus.has(s))
    for (const e of [...lot.strokes].sort((a, b) => a.i - b.i)) {
      e.s.dying = undefined
      e.s.anim = undefined
      e.s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
      this.salir(e.s)
      liste.splice(Math.min(e.i, liste.length), 0, e.s)
    }
    this.strokes = liste
    this.redoStack.push(
      lot.mode === 'panic' ? { kind: 'clear' } : { kind: 'erase', strokes: lot.strokes.map((e) => e.s) },
    )
    this.syncBadgeSeq()
    this.syncJalonSeq()
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
    return true
  }

  redo(): void {
    // un dé-morph d'écriture encore en vol : on le rattrape avant de lire la
    // pile, sinon Ctrl+Y rétablirait une action bien plus ancienne
    if (this.hwUndoing) {
      const g = this.hwUndoing
      this.pumpHandwriting(performance.now())
      if (this.hwUndoing === g) {
        this.hwUndoing = null
        const t = performance.now()
        if (this.hw.remorph(g, t)) g.anim = { start: t, duration: DEMORPH_MS }
        this.salir(g)
        this.staticDirty = true
        this.wake()
        return
      }
    }
    const e = this.redoStack.pop()
    if (!e) return
    const now = performance.now()
    if (e.kind === 'clear') {
      this.clear()
      return
    }
    if (e.kind === 'erase') {
      // on regomme, exactement comme la gomme elle-même l'avait fait
      const lot: RemovedBatch = { strokes: [], seq: this.idSeq, mode: 'erase' }
      for (const s of e.strokes) {
        const i = this.strokes.indexOf(s)
        if (i < 0 || s.dying) continue
        s.dying = { start: now, duration: 160, mode: 'pop', cause: 'erase' }
        this.salir(s)
        lot.strokes.push({ s, i })
      }
      if (lot.strokes.length > 0) this.pousserLot(lot)
      this.anchorsDirty = true
      this.staticDirty = true
      this.wake()
      return
    }
    if (e.kind === 'reshape') {
      const s = this.strokes.find((k) => k.id === e.id && !k.dying)
      // le trait a pu être gommé ou dissous entre-temps : on passe au suivant
      if (!s || s.raw) {
        this.redo()
        return
      }
      this.applySmartShape(s, now)
      this.anchorsDirty = true
      this.staticDirty = true
      this.wake()
      return
    }
    if (e.kind === 'swap') {
      const partis = new Set(e.remove)
      this.strokes = this.strokes.filter((s) => {
        if (!partis.has(s)) return true
        this.sortir(s)
        return false
      })
      for (const s of e.add) {
        s.dying = undefined
        s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
        // le mot se réécrit devant l'utilisateur, comme à la transcription.
        // L'animation est OBLIGATOIRE : sans elle le calque consolidé prendrait
        // le mot pour un trait posé et figerait l'image intermédiaire du morph.
        if (s.tool === 'glyph' && this.hw.remorph(s, now)) {
          s.anim = { start: now, duration: DEMORPH_MS }
        }
        this.strokes.push(s)
        this.salir(s)
      }
      this.anchorsDirty = true
      this.staticDirty = true
      this.emitActivity()
      this.wake()
      return
    }
    const s = e.stroke
    s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
    this.strokes.push(s)
    this.salir(s)
    if (s.tool === 'badge') this.syncBadgeSeq()
    else if (s.tool === 'marker') this.syncJalonSeq()
    this.anchorsDirty = true
    this.staticDirty = true
    this.wake()
  }

  /**
   * Numéro que portera la PROCHAINE pastille du numéroteur (§4.8). Lecture
   * seule : c'est ce que la reprise au clic droit vient de changer, et ce que
   * le retour visuel annonce à l'écran.
   */
  get numeroSuivant(): number {
    return this.badgeSeq
  }

  /**
   * Recale le compteur du numéroteur après une annulation, un rétablissement
   * ou la disparition d'une pastille.
   *
   * L'ANCRE D'ABORD. Tant que la pastille qui tient la série est à l'écran,
   * c'est elle qui commande : la suivante porte son numéro + 1 et s'y relie.
   * Sans cette règle, la reprise au clic droit (« repars du 3 ») ne survivait
   * pas à la première pastille qui s'efface au fondu — le compteur repartait
   * silencieusement sur le plus grand numéro présent, et l'utilisateur voyait
   * son choix s'annuler tout seul quelques secondes plus tard.
   *
   * L'ancre partie, on retombe sur la règle simple d'avant : le plus grand
   * numéro encore visible, relié à la dernière pastille de la pile.
   */
  /**
   * Même mécanique que `syncBadgeSeq`, pour la série des jalons. Séparée parce
   * que les deux compteurs sont indépendants : annuler un jalon ne doit pas
   * toucher au parcours du numéroteur, et réciproquement.
   */
  private syncJalonSeq(): void {
    if (this.ancreJalon != null) {
      for (let i = this.strokes.length - 1; i >= 0; i--) {
        const s = this.strokes[i]
        if (s.id !== this.ancreJalon || s.tool !== 'marker' || s.dying) continue
        this.jalonSeq = (s.badge ?? 0) + 1
        return
      }
      this.ancreJalon = null
    }
    let max = 0
    for (const s of this.strokes) {
      if (s.tool !== 'marker' || s.dying) continue
      max = Math.max(max, s.badge ?? 0)
    }
    this.jalonSeq = max + 1
  }

  /** Numéro que portera le PROCHAIN jalon (retour visuel de la reprise). */
  get jalonSuivant(): number {
    return this.jalonSeq
  }

  private syncBadgeSeq(): void {
    if (this.ancreSerie != null) {
      // en partant de la fin : l'ancre est presque toujours la dernière
      // pastille posée, donc trouvée en une poignée de comparaisons
      for (let i = this.strokes.length - 1; i >= 0; i--) {
        const s = this.strokes[i]
        if (s.id !== this.ancreSerie || s.tool !== 'badge' || s.dying) continue
        this.badgeSeq = (s.badge ?? 0) + 1
        this.lastBadgeId = s.id
        return
      }
      this.ancreSerie = null
    }
    let max = 0
    let last: number | null = null
    for (const s of this.strokes) {
      if (s.tool !== 'badge' || s.dying) continue
      max = Math.max(max, s.badge ?? 0)
      last = s.id
    }
    this.badgeSeq = max + 1
    this.lastBadgeId = last
  }

  /**
   * §4.8 — « clic droit sur un nœud : je reprends la numérotation à partir de
   * ce numéro ». La série repart de la pastille `s` : la prochaine portera son
   * numéro + 1 et la flèche de liaison partira d'ELLE, pas de la dernière
   * posée. Le changement de couleur continue, lui, de remettre à 1 (c'est le
   * défaut voulu) — cette reprise est la façon de revenir dans une série.
   */
  private reprendreSerie(s: Stroke): void {
    const suivant = (s.badge ?? 0) + 1
    if (s.tool === 'marker') {
      // Les jalons n'ont pas de fil : il n'y a rien à rebrancher, juste un
      // compteur à replacer.
      this.ancreJalon = s.id
      this.jalonSeq = suivant
    } else {
      this.ancreSerie = s.id
      this.lastBadgeId = s.id
      this.badgeSeq = suivant
    }
    this.repriseCue = {
      x: s.points[0].x,
      y: s.points[0].y,
      r: badgeRadius(s.size),
      color: s.color,
      suivant,
      start: performance.now(),
    }
    sfx.tick()
    this.wake()
  }

  /**
   * Touche panique : tout part en dissolution, léger décalage en cascade.
   *
   * Deux règles non négociables ici (§169 du brief, « efface tout
   * instantanément, avec un fondu de 200 ms ») :
   *
   *  1. le décalage est PLAFONNÉ et le fondu est court : 150 annotations
   *     quittent l'écran en moins d'une demi-seconde, comme 3. Cette touche
   *     existe pour faire disparaître MAINTENANT ce qui ne doit pas rester à
   *     l'antenne — jamais pour offrir un joli balayage de 7 secondes ;
   *  2. l'effacement est UNE entrée d'historique : Ctrl+Z le rend (§64,
   *     « undo parfait »), et la pile de rétablissement est vidée pour qu'un
   *     Ctrl+Y réflexe ne puisse PAS repeindre à l'écran ce que l'on vient de
   *     faire disparaître devant les spectateurs.
   */
  clear(): void {
    const now = performance.now()
    const efface: { s: Stroke; i: number }[] = []
    let n = 0
    for (let i = 0; i < this.strokes.length; i++) {
      const s = this.strokes[i]
      if (s.dying) continue
      s.dying = panicDying(n, now)
      this.salir(s)
      efface.push({ s, i })
      n++
    }
    this.eraseLot = null
    if (efface.length > 0) this.pousserLot({ strokes: efface, seq: this.idSeq, mode: 'panic' })
    // rien ne survit à la panique dans la pile de rétablissement : ce qui a
    // été annulé AVANT n'a plus aucune raison de pouvoir revenir APRÈS
    this.redoStack = []
    this.badgeSeq = 1
    this.lastBadgeId = null
    this.jalonSeq = 1
    this.ancreJalon = null
    this.ancreSerie = null
    this.repriseCue = null
    this.anchorsDirty = true
    // mode écriture : la file d'analyse en attente part avec le reste
    this.hwUndoing = null
    this.hw.reset()
    // la touche panique nettoie AUSSI les effets vivants : roue, spotlight,
    // pings, traînée laser, étincelles. Un seul geste, écran net.
    this.cancelRadial()
    if (this.radialOpen) this.closeRadial()
    this.pings.length = 0
    this.laser.length = 0
    this.particles.length = 0
    this.setSpot(false)
    sfx.clearSfx()
    this.onPanic?.()
    this.wake()
  }

  exportSession(): SessionExport {
    return {
      app: 'hexa',
      version: 1,
      exportedAt: new Date().toISOString(),
      strokes: structuredClone(this.strokes.filter((s) => !s.dying)),
    }
  }

  get hasContent(): boolean {
    // Masquées, les annotations ne sont plus « du contenu » au sens de §2.5 :
    // il n'y a rien à l'écran, donc la fenêtre peut se retirer et le coût
    // compositeur retombe à zéro pendant toute la coupure.
    if (this.opts.annotationsHidden) return this.current != null
    return this.strokes.length > 0 || this.current != null
  }

  /** recharge une session exportée (§11 du brief — rejeu/montage) */
  loadSession(data: SessionExport): void {
    if (data.app !== 'hexa' || !Array.isArray(data.strokes)) return
    const now = performance.now()
    // importer, c'est une action neuve : un Ctrl+Y ne doit pas faire réapparaître
    // par-dessus un trait annulé dans la session précédente
    this.redoStack = []
    const remap = new Map<number, number>()
    const loaded = structuredClone(data.strokes)
    for (const s of loaded) {
      s.dying = undefined
      s.anim = undefined
      s.dieAt = this.opts.fadeDelay == null ? undefined : now + this.opts.fadeDelay
      const old = s.id
      s.id = this.idSeq++
      remap.set(old, s.id)
    }
    // les liens du numéroteur pointent vers des ids : on les réécrit
    for (const s of loaded) {
      if (s.linkFrom != null) s.linkFrom = remap.get(s.linkFrom)
      this.strokes.push(s)
      this.salir(s)
    }
    // une session importée est une scène NEUVE : la pastille qui tenait la
    // série d'avant n'a plus à commander le compteur de celle-ci
    this.ancreSerie = null
    this.syncBadgeSeq()
    this.syncJalonSeq()
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  private toLocal(e: { clientX: number; clientY: number; pressure?: number }): StrokePoint {
    const r = this.stage.getBoundingClientRect()
    const p = e.pressure != null && e.pressure > 0 ? e.pressure : 0.5
    return { x: e.clientX - r.left, y: e.clientY - r.top, p, t: performance.now() }
  }

  private strokeAt(x: number, y: number): Stroke | null {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]
      if (s.dying) continue
      const pad = Math.max(14, s.size * 2)
      const pts = s.points
      // formes, textes, pastilles et tampons ont leur propre zone de saisie
      if (s.tool === 'rect' || s.tool === 'ellipse') {
        if (hitShape(s, x, y, pad)) return s
        continue
      }
      if (s.tool === 'badge' || s.tool === 'marker') {
        if (dist(x, y, pts[0].x, pts[0].y) < badgeRadius(s.size) + 4) return s
        continue
      }
      if (s.tool === 'stamp') {
        const w = (s.w ?? 0) / 2
        const h = (s.h ?? 0) / 2
        if (Math.abs(x - pts[0].x) < w && Math.abs(y - pts[0].y) < h) return s
        continue
      }
      // mot typographié (mode écriture) : boîte du texte, ligne de base en pts[0]
      if (s.tool === 'glyph') {
        const fw = s.w ?? 0
        const fh = s.h ?? 0
        const top = pts[0].y - fh * 0.82
        const bottom = pts[0].y + fh * 0.24
        if (x > pts[0].x - 8 && x < pts[0].x + fw + 8 && y > top && y < bottom) return s
        continue
      }
      if (s.tool === 'text') {
        const box = textBox(this.sCtx, s)
        if (x > pts[0].x - 6 && x < pts[0].x + box.w + 6 && Math.abs(y - pts[0].y) < box.h / 2 + 4) {
          return s
        }
        continue
      }
      if (pts.length === 1) {
        if (dist(x, y, pts[0].x, pts[0].y) < pad) return s
        continue
      }
      if (s.tool === 'arrow' && pts.length > 2) {
        for (let j = 0; j < pts.length - 1; j++) {
          if (pointToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) < pad) return s
        }
        continue
      }
      if (s.tool === 'arrow' || s.tool === 'line' || s.tool === 'measure') {
        const a = pts[0]
        const b = pts[pts.length - 1]
        if (pointToSegment(x, y, a.x, a.y, b.x, b.y) < pad) return s
        continue
      }
      for (let j = 0; j < pts.length - 1; j++) {
        if (pointToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) < pad) return s
      }
    }
    return null
  }

  private onDown(e: PointerEvent): void {
    // clic dans l'éditeur de texte flottant : ce n'est pas un geste de dessin
    if (e.target !== this.stage && !(e.target instanceof HTMLCanvasElement)) return
    // la roue est ouverte : c'est elle qui pilote le geste, le moteur se tait
    if (this.radialOpen) return
    const pt = this.toLocal(e)
    this.pointer = pt
    this.shiftHeld = e.shiftKey
    this.altHeld = e.altKey
    this.stage.setPointerCapture(e.pointerId)

    if (e.button === 2) {
      // Priorité absolue au comportement historique : s'il y a une annotation
      // sous le curseur, le clic droit l'ATTRAPE (l'utilisateur y tient).
      // Ce n'est que dans le vide que le maintien ouvre le menu radial (§8.2).
      const s = this.strokeAt(pt.x, pt.y)
      if (s) {
        this.grabbed = s
        this.grabLast = { x: pt.x, y: pt.y }
        // point et instant de départ : au relâché, ils diront si la main a
        // réellement déplacé quelque chose ou si c'était un simple clic
        this.grabFrom = { x: pt.x, y: pt.y }
        this.grabAt = performance.now()
        s.dieAt = undefined // le compte à rebours est suspendu pendant le drag
        this.salir(s)
        this.grabAnim = { id: s.id, start: performance.now(), from: 1, back: false }
        this.cursor.classList.add('is-grab')
        this.staticDirty = true
        this.wake()
        return
      }
      this.radialFrom = { x: pt.x, y: pt.y }
      this.cancelRadial()
      this.radialTimer = setTimeout(() => {
        this.radialTimer = null
        this.radialOpen = true
        this.cursor.classList.add('is-hidden')
        this.onRadial?.(this.radialFrom.x, this.radialFrom.y)
      }, RADIAL_HOLD)
      return
    }
    if (e.button !== 0) return

    const t = this.opts.tool
    if (t === 'ping') {
      this.spawnPing(pt.x, pt.y)
      return
    }
    // §5.2 — les deux autres variantes du spotlight : on TRACE la zone à
    // éclairer. Glisser = rectangle · Alt + glisser = forme libre au lasso.
    // Un simple clic (sans glisser) rend la main au disque suiveur.
    if (t === 'spotlight') {
      this.spotDraw = e.altKey
        ? { shape: 'lasso', path: [{ x: pt.x, y: pt.y }] }
        : { shape: 'rect', a: { x: pt.x, y: pt.y }, b: { x: pt.x, y: pt.y } }
      this.spotRegion = null
      this.wake()
      return
    }
    if (t === 'eraser') {
      this.erasing = true
      this.eraseAt(pt)
      this.wake()
      return
    }
    if (t === 'laser') {
      this.pushLaser(pt, true)
      this.wake()
      return
    }
    if (CLICK_TOOLS.has(t)) {
      this.redoStack = []
      // les outils posés au clic profitent aussi des guides (alignement,
      // espacement égal) : c'est ce qui rend une série de pastilles nette
      const p = this.guidesOn() ? this.snapClick(pt) : pt
      this.overlay.clear(performance.now())
      if (t === 'text') this.openText(p)
      else if (t === 'badge') this.placeBadge(p)
      else if (t === 'marker') this.placeJalon(p)
      else this.placeStamp(p)
      return
    }

    if (FREEHAND_TOOLS.has(t) || TWO_POINT_TOOLS.has(t) || GESTURE_TOOLS.has(t)) {
      this.redoStack = []
      // Mode écriture : le lissage est ASSOUPLI pour le stylo. Le réglage
      // par défaut est taillé pour de grands gestes d'annotation, où un léger
      // retard ne se voit pas ; à l'échelle d'une lettre il arrondit la
      // pointe du V, du Y, du W — au point de les faire lire « U ». Le filtre
      // reste actif (le tremblement de souris est toujours gommé), il suit
      // simplement la main de plus près.
      const writing = this.opts.handwriting === true && t === 'pen'
      this.fx = writing ? new OneEuro(6, 0.02) : new OneEuro()
      this.fy = writing ? new OneEuro(6, 0.02) : new OneEuro()
      const first: StrokePoint = { ...pt, x: this.fx.filter(pt.x, pt.t), y: this.fy.filter(pt.y, pt.t) }
      // le point de DÉPART s'accroche aussi aux points remarquables
      if ((TWO_POINT_TOOLS.has(t) || GESTURE_TOOLS.has(t)) && this.guidesOn()) {
        const snapped = snapPoint(null, first, this.anchorList())
        first.x = snapped.x
        first.y = snapped.y
      }
      this.current = {
        id: this.idSeq++,
        tool: t as Stroke['tool'],
        color: this.opts.color,
        size: this.opts.size,
        points: [first],
        simulatePressure: e.pointerType !== 'pen',
        done: false,
        startedAt: pt.t,
      }
      if (TWO_POINT_TOOLS.has(t)) {
        this.current.points.push({ ...first })
        // Alt = forme remplie translucide (rect / ellipse)
        if ((t === 'rect' || t === 'ellipse') && e.altKey) this.current.filled = true
      }
      // la flèche mémorise son geste brut à part : `points` ne porte que la
      // courbe embellie, recalculée à chaque déplacement
      if (GESTURE_TOOLS.has(t)) {
        this.gesture = [{ ...first }]
        this.current.points.push({ ...first })
      }
      this.salir(this.current)
      this.emitActivity()
      this.wake()
    }
  }

  /* ---------------- outils à un clic ---------------- */

  private openText(pt: StrokePoint): void {
    this.closeText?.()
    const color = this.opts.color
    // La molette peut changer la taille PENDANT la saisie : on retient la
    // dernière valeur choisie, et on la retraduit en épaisseur pour que le
    // texte posé fasse exactement la taille aperçue.
    let size = this.opts.size
    this.closeText = openTextInput(
      this.stage,
      {
        x: pt.x,
        y: pt.y,
        color,
        fontSize: textSizeOf(size),
        onSize: (fs) => {
          size = clamp(fs / 5.2, 2, 18)
          this.onRequestSize?.(size)
        },
      },
      (value) => {
        const now = performance.now()
        const s: Stroke = {
          id: this.idSeq++,
          tool: 'text',
          color,
          size,
          points: [{ x: pt.x, y: pt.y, p: 0.5, t: now }],
          simulatePressure: false,
          done: true,
          startedAt: now,
          endedAt: now,
          text: value,
          anim: { start: now, duration: 260 },
        }
        if (this.opts.fadeDelay != null) s.dieAt = now + this.opts.fadeDelay + 260
        this.strokes.push(s)
        this.salir(s)
        this.anchorsDirty = true
        this.staticDirty = true
        this.emitActivity()
        this.wake()
      },
    )
  }

  private placeBadge(pt: StrokePoint): void {
    const now = performance.now()
    const link = this.opts.linkBadges ? this.lastBadgeId : null
    const s: Stroke = {
      id: this.idSeq++,
      tool: 'badge',
      color: this.opts.color,
      size: this.opts.size,
      points: [{ x: pt.x, y: pt.y, p: 0.5, t: now }],
      simulatePressure: false,
      done: true,
      startedAt: now,
      endedAt: now,
      badge: this.badgeSeq,
      anim: { start: now, duration: link != null ? BADGE_LINK_ANIM : BADGE_ANIM },
    }
    if (link != null) s.linkFrom = link
    if (this.opts.fadeDelay != null) s.dieAt = now + this.opts.fadeDelay + (s.anim?.duration ?? 0)
    this.strokes.push(s)
    this.salir(s)
    this.badgeSeq++
    this.lastBadgeId = s.id
    // la pastille qu'on vient de poser tient la série : une pastille plus
    // ancienne qui s'efface au fondu ne peut plus dérégler le compteur
    this.ancreSerie = s.id
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  /**
   * JALON : le même geste que le numéroteur, sans le fil.
   *
   * Aucun `linkFrom`, jamais : c'est toute la raison d'être de cet outil. Le
   * compteur est le sien, et il repart de 1 au changement de couleur comme
   * celui des pastilles.
   */
  private placeJalon(pt: StrokePoint): void {
    const now = performance.now()
    const s: Stroke = {
      id: this.idSeq++,
      tool: 'marker',
      color: this.opts.color,
      size: this.opts.size,
      points: [{ x: pt.x, y: pt.y, p: 0.5, t: now }],
      simulatePressure: false,
      done: true,
      startedAt: now,
      endedAt: now,
      badge: this.jalonSeq,
      anim: { start: now, duration: BADGE_ANIM },
    }
    if (this.opts.fadeDelay != null) s.dieAt = now + this.opts.fadeDelay + BADGE_ANIM
    this.strokes.push(s)
    this.salir(s)
    this.jalonSeq++
    this.ancreJalon = s.id
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  private placeStamp(pt: StrokePoint): void {
    const img = this.pendingStamp
    if (!img) return
    const now = performance.now()
    const s: Stroke = {
      id: this.idSeq++,
      tool: 'stamp',
      color: this.opts.color,
      size: this.opts.size,
      points: [{ x: pt.x, y: pt.y, p: 0.5, t: now }],
      simulatePressure: false,
      done: true,
      startedAt: now,
      endedAt: now,
      image: img.src,
      w: img.w,
      h: img.h,
      anim: { start: now, duration: 260 },
    }
    if (this.opts.fadeDelay != null) s.dieAt = now + this.opts.fadeDelay + 260
    this.strokes.push(s)
    this.salir(s)
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  /** collage d'une image du presse-papier (§4.10) : bascule sur le tampon */
  private async onPaste(e: ClipboardEvent): Promise<void> {
    const img = await imageFromClipboard(e.clipboardData?.items ?? null)
    if (!img) return
    this.pendingStamp = img
    this.onRequestTool?.('stamp')
  }

  /** molette : rayon du spotlight, taille du tampon survolé, sinon l'app */
  private onWheel(e: WheelEvent): void {
    if (this.opts.tool === 'spotlight') {
      e.preventDefault()
      const r = clamp(this.spotR * (e.deltaY < 0 ? 1.09 : 1 / 1.09), 80, 500)
      if (r !== this.spotR) {
        this.spotR = r
        this.onSpotRadius?.(Math.round(r))
        this.wake()
      }
      return
    }
    if (this.opts.tool !== 'eraser') {
      const s = this.strokeAt(this.pointer.x, this.pointer.y)
      if (s && s.tool === 'stamp' && s.w && s.h) {
        e.preventDefault()
        const k = e.deltaY < 0 ? 1.09 : 1 / 1.09
        const w = clamp(s.w * k, 48, 1600)
        s.h = (s.h / s.w) * w
        s.w = w
        this.salir(s)
        this.staticDirty = true
        this.wake()
        return
      }
    }
    this.onWheelCb?.(e)
  }

  private onMove(e: PointerEvent): void {
    // roue ouverte : le geste appartient au menu radial
    if (this.radialOpen) return
    this.shiftHeld = e.shiftKey
    this.altHeld = e.altKey
    const coalesced = e.getCoalescedEvents?.() ?? []
    const list = coalesced.length > 0 ? coalesced : [e]
    for (const ev of list) {
      const pt = this.toLocal(ev)
      this.pointer = pt
      if (this.grabbed) {
        const dx = pt.x - this.grabLast.x
        const dy = pt.y - this.grabLast.y
        this.grabLast = { x: pt.x, y: pt.y }
        for (const p of this.grabbed.points) {
          p.x += dx
          p.y += dy
        }
        this.salir(this.grabbed)
        this.anchorsDirty = true
        this.staticDirty = true
      } else if (this.current) {
        const c = this.current
        this.salir(c)
        if (GESTURE_TOOLS.has(c.tool)) {
          this.pushGesture(c, pt)
        } else if (TWO_POINT_TOOLS.has(c.tool)) {
          c.points[c.points.length - 1] = this.resolveTwoPoint(c, pt)
        } else {
          const fpt: StrokePoint = {
            ...pt,
            x: this.fx ? this.fx.filter(pt.x, pt.t) : pt.x,
            y: this.fy ? this.fy.filter(pt.y, pt.t) : pt.y,
          }
          const lastP = c.points[c.points.length - 1]
          if (dist(lastP.x, lastP.y, fpt.x, fpt.y) > 0.7) {
            c.points.push(fpt)
            if (c.tool === 'pen' && this.opts.sparkles) this.spawnSparkles(fpt)
          }
        }
      } else if (this.spotDraw) {
        if (this.spotDraw.shape === 'rect') this.spotDraw.b = { x: pt.x, y: pt.y }
        else pushLassoPoint(this.spotDraw.path!, pt)
      } else if (this.erasing) {
        this.eraseAt(pt)
      } else if (this.opts.tool === 'laser') {
        this.pushLaser(pt, (e.buttons & 1) === 1)
      } else if (CLICK_TOOLS.has(this.opts.tool)) {
        // aperçu des guides sous le curseur avant même de cliquer
        if (this.guidesOn()) this.snapClick(pt)
        else this.overlay.clear(pt.t)
      }
    }
    // un vrai déplacement pendant le maintien = ce n'est plus un maintien
    if (
      this.radialTimer &&
      dist(this.pointer.x, this.pointer.y, this.radialFrom.x, this.radialFrom.y) > RADIAL_SLOP
    ) {
      this.cancelRadial()
    }
    this.moveCursor()
    if (
      this.grabbed ||
      this.current ||
      this.erasing ||
      this.spotDraw ||
      this.opts.tool === 'laser' ||
      // le spotlight suit le curseur SANS clic (§5.2), donc même en traversant
      this.opts.tool === 'spotlight' ||
      CLICK_TOOLS.has(this.opts.tool)
    ) {
      this.wake()
    }
  }

  /**
   * Flèche en cours de tracé : le geste brut est accumulé de son côté
   * (lissage One Euro, même filtre que le stylo) et `points` reçoit la
   * courbe EMBELLIE recalculée dans la foulée. C'est ce qui rend le retour
   * visuel immédiat, Shift compris.
   */
  private pushGesture(c: Stroke, pt: StrokePoint): void {
    const fpt: StrokePoint = {
      ...pt,
      x: this.fx ? this.fx.filter(pt.x, pt.t) : pt.x,
      y: this.fy ? this.fy.filter(pt.y, pt.t) : pt.y,
    }
    const last = this.gesture[this.gesture.length - 1]
    if (last && dist(last.x, last.y, fpt.x, fpt.y) <= 0.7) return
    this.gesture.push(fpt)
    this.refreshGesture(c)
  }

  /** recalcule la courbe embellie de la flèche `c` depuis son geste brut */
  private refreshGesture(c: Stroke): void {
    const g = this.gesture
    if (g.length < 2) return
    const origin = g[0]
    let raw: Pt[] = g
    if (this.shiftHeld) {
      // Shift : flèche parfaitement droite, ET accroche aux angles de 15°
      this.overlay.clear(performance.now())
      const end = this.maybeSnap(origin, g[g.length - 1])
      raw = [origin, end]
    } else if (this.guidesOn()) {
      // guides magnétiques sur le point d'ARRIVÉE seulement (`origin` à null :
      // imposer un angle remarquable n'aurait aucun sens sur une courbe)
      const res = snapPoint(null, g[g.length - 1], this.anchorList())
      this.overlay.set(res.guides, performance.now())
      raw = [...g.slice(0, -1), { ...g[g.length - 1], x: res.x, y: res.y }]
    } else {
      this.overlay.clear(performance.now())
    }
    const curve = beautifyArrow(raw, this.shiftHeld)
    // horodatage réparti le long de la courbe : le rejeu et l'export gardent
    // la cadence réelle du geste, même si les points ont été recalculés
    const t1 = g[g.length - 1].t
    const cum = cumLen(curve)
    const total = cum[cum.length - 1] || 1
    c.points = curve.map((p, i) => ({
      x: p.x,
      y: p.y,
      p: 0.5,
      t: origin.t + (t1 - origin.t) * (cum[i] / total),
    }))
    this.salir(c)
  }

  /** accroche d'un outil posé au clic + affichage des guides correspondants */
  private snapClick(pt: StrokePoint): StrokePoint {
    const res = snapPoint(null, pt, this.anchorList())
    this.overlay.set(res.guides, performance.now())
    return { ...pt, x: res.x, y: res.y }
  }

  /** accroche aux angles de 15° quand Shift est maintenu (lignes et flèches) */
  private maybeSnap(origin: StrokePoint, pt: StrokePoint): StrokePoint {
    if (!this.shiftHeld) return pt
    const ang = Math.atan2(pt.y - origin.y, pt.x - origin.x)
    const snapped = Math.round(ang / SNAP_RAD) * SNAP_RAD
    const len = dist(origin.x, origin.y, pt.x, pt.y)
    return { ...pt, x: origin.x + Math.cos(snapped) * len, y: origin.y + Math.sin(snapped) * len }
  }

  /** guides actifs ? (réglage global, et Alt les suspend le temps du geste) */
  private guidesOn(): boolean {
    return this.opts.guides && !this.altHeld
  }

  /** index paresseux des points remarquables — jamais reconstruit pour rien */
  private anchorList(): Anchor[] {
    if (this.anchorsDirty) {
      this.anchors = buildAnchors(this.strokes)
      this.anchorsDirty = false
    }
    return this.anchors
  }

  /**
   * Point courant d'une forme à deux points : Shift (carré/cercle ou angles
   * de 15°) l'emporte, sinon les guides magnétiques prennent la main.
   */
  private resolveTwoPoint(c: Stroke, pt: StrokePoint): StrokePoint {
    const origin = c.points[0]
    if (this.shiftHeld) {
      this.overlay.clear(performance.now())
      if (c.tool === 'rect' || c.tool === 'ellipse') {
        const sq = squarify(origin, pt)
        return { ...pt, x: sq.x, y: sq.y }
      }
      return this.maybeSnap(origin, pt)
    }
    if (!this.guidesOn()) {
      this.overlay.clear(performance.now())
      return pt
    }
    const boxTool = c.tool === 'rect' || c.tool === 'ellipse'
    const res = snapPoint(boxTool ? null : origin, pt, this.anchorList())
    this.overlay.set(res.guides, performance.now())
    return { ...pt, x: res.x, y: res.y }
  }

  private onUp(_e: PointerEvent): void {
    // relâché avant 220 ms : ni roue, ni rien. Le clic droit dans le vide
    // reste inoffensif, exactement comme avant.
    this.cancelRadial()
    // §5.2 — fin du tracé d'une zone de spotlight. Trop court pour être un
    // geste ? On revient au disque suiveur : un clic ne « casse » jamais
    // l'outil, il le remet simplement dans son état de départ.
    if (this.spotDraw) {
      const drawn = this.spotDraw
      this.spotDraw = null
      this.spotRegion = regionUsable(drawn) ? drawn : null
      this.staticDirty = true
      this.wake()
      return
    }
    if (this.grabbed) {
      const now = performance.now()
      const g = this.grabbed
      // §4.8 — CLIC DROIT BREF SUR UNE PASTILLE : la numérotation reprend là.
      // La main n'a pas bougé et le bouton est déjà relâché : ce n'était pas un
      // déplacement. On rend d'abord à la pastille le micro-décalage éventuel
      // (jusqu'à REPRISE_SLOP pixels) — un clic ne doit RIEN déplacer.
      const dx = this.grabLast.x - this.grabFrom.x
      const dy = this.grabLast.y - this.grabFrom.y
      if (
        (g.tool === 'badge' || g.tool === 'marker') &&
        now - this.grabAt <= REPRISE_MS &&
        Math.hypot(dx, dy) <= REPRISE_SLOP
      ) {
        if (dx !== 0 || dy !== 0) {
          for (const p of g.points) {
            p.x -= dx
            p.y -= dy
          }
        }
        this.reprendreSerie(g)
      }
      if (this.opts.fadeDelay != null) {
        this.grabbed.dieAt = now + this.opts.fadeDelay
      }
      this.salir(this.grabbed)
      // retour élastique du grossissement (effet de rendu uniquement)
      this.grabAnim = {
        id: this.grabbed.id,
        start: now,
        from: this.grabFactor(now),
        back: true,
      }
      this.grabbed = null
      this.cursor.classList.remove('is-grab')
      this.anchorsDirty = true
      this.staticDirty = true
      this.wake()
      return
    }
    this.erasing = false
    // fin du passage de gomme : le lot est clos, le prochain geste en ouvrira
    // un nouveau (un coup de gomme = une annulation)
    this.eraseLot = null
    const c = this.current
    if (!c) return
    this.current = null
    this.fx = null
    this.fy = null
    const now = performance.now()
    this.overlay.clear(now)
    c.done = true
    c.endedAt = now
    this.salir(c)
    if (GESTURE_TOOLS.has(c.tool)) {
      const gesture = this.gesture
      this.gesture = []
      // geste trop court : on n'ajoute rien (mesuré sur la LONGUEUR PARCOURUE,
      // une flèche peut légitimement revenir près de son point de départ)
      if (gesture.length < 2 || pathLen(gesture) < 14) {
        this.sortir(c)
        this.emitActivity()
        this.wake()
        return
      }
      // Shift est revérifié au relâché : le dernier état pressé fait foi
      this.refreshGesture(c)
      this.overlay.clear(now)
      if (c.points.length < 2) {
        this.sortir(c)
        this.emitActivity()
        this.wake()
        return
      }
      // LA POINTE ÉCLOT, LE FÛT NE S'EFFONDRE PAS.
      // Sans `kind: 'head'`, `renderCurvedArrow` repart de t = 0 et redessine
      // la flèche depuis son point de départ : au relâché, l'aperçu complet —
      // que le streamer vient de voir pendant tout son geste — disparaissait
      // d'un coup (−31 % d'encre en une image) et repoussait en 300 ms. À
      // l'antenne, ça se lit comme un bug de l'overlay, pas comme un effet.
      // C'est exactement ce que fait déjà la branche des formes intelligentes.
      // (Le tracé progressif reste disponible pour le « mode trajet » §4.2.3,
      // qui est un MODE, pas le comportement par défaut.)
      c.anim = { start: now, duration: 260, kind: 'head' }
    }
    if (TWO_POINT_TOOLS.has(c.tool)) {
      const a = c.points[0]
      const b = c.points[c.points.length - 1]
      if (dist(a.x, a.y, b.x, b.y) < 8) {
        this.sortir(c)
        this.emitActivity()
        this.wake()
        return // geste trop court : on n'ajoute rien
      }
      if (c.tool === 'rect' || c.tool === 'ellipse') c.anim = { start: now, duration: 220 }
    }
    // Mode écriture : le trait rejoint la file d'analyse. Les formes
    // intelligentes sont volontairement mises en veille pendant ce mode —
    // sinon un « O » deviendrait une ellipse avant même d'être lu.
    const writing = this.opts.handwriting === true && c.tool === 'pen'
    if (writing) this.hw.push(c, now)
    // formes intelligentes : le geste au stylo est redressé (§4.1)
    if (c.tool === 'pen' && this.opts.smartShapes && !writing) this.applySmartShape(c, now)
    if (this.opts.fadeDelay != null) c.dieAt = now + this.opts.fadeDelay + (c.anim?.duration ?? 0)
    this.strokes.push(c)
    sfx.strokeSfx()
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
    this.wake()
  }

  /**
   * Reconnaît une forme dans le tracé et l'anime vers la version parfaite
   * en 150 ms (§4.1.5). Le tracé brut est conservé dans `raw` : le premier
   * Ctrl+Z le rend au lieu de supprimer l'annotation.
   */
  private applySmartShape(c: Stroke, now: number): void {
    const rec = recognize(c.points)
    if (!rec) return
    // une flèche née d'un crochet passe par LE MÊME embellissement que la
    // flèche tracée à la main : une seule géométrie pour toutes les flèches
    const target: Pt[] = rec.kind === 'arrow' ? beautifyArrow(rec.points) : rec.points
    const from = resample(
      c.points.map((p) => ({ x: p.x, y: p.y })),
      MORPH_SAMPLES,
      rec.closed,
    )
    let to = shapeOutline(rec.kind, target, MORPH_SAMPLES)
    if (rec.closed) to = alignLoop(to, from)
    this.morphs.set(c.id, { from, to, start: now, duration: MORPH_MS, closed: rec.closed })
    c.raw = c.points
    c.tool = rec.kind
    c.points = target.map((p) => ({ x: p.x, y: p.y, p: 0.5, t: now }))
    // la pointe de la flèche éclot juste après l'atterrissage du morph
    c.anim =
      rec.kind === 'arrow' ? { start: now + MORPH_MS, duration: 260, kind: 'head' } : undefined
    this.salir(c)
  }

  /**
   * Gomme le trait sous le pointeur. Tout un PASSAGE de gomme forme un seul
   * lot : le Ctrl+Z du « oups, pas celui-là » rend d'un coup ce que le geste a
   * emporté, et à sa place exacte dans la pile de rendu.
   */
  private eraseAt(pt: StrokePoint): void {
    const s = this.strokeAt(pt.x, pt.y)
    if (!s) return
    s.dying = { start: performance.now(), duration: 160, mode: 'pop', cause: 'erase' }
    this.salir(s)
    const i = this.strokes.indexOf(s)
    if (!this.eraseLot) {
      this.eraseLot = { strokes: [], seq: this.idSeq, mode: 'erase' }
      this.pousserLot(this.eraseLot)
    }
    this.eraseLot.strokes.push({ s, i })
    // la gomme est une action neuve : plus rien à rétablir derrière elle
    this.redoStack = []
    this.wake()
  }

  /**
   * Ctrl+D — SUPPRIMER L'ANNOTATION SOUS LE CURSEUR.
   *
   * Le geste manquant. Jusqu'ici, retirer UNE annotation au milieu de dix
   * imposait de prendre la gomme, de la passer dessus, puis de reprendre son
   * outil : trois actions et un changement d'outil pour défaire un trait de
   * trop, en plein direct. Ici : on vise, on appuie, c'est parti — et l'outil
   * courant ne bouge pas d'un pouce.
   *
   * Techniquement, c'est exactement une gomme d'un seul trait : même
   * dissolution, même lot d'annulation, donc le Ctrl+Z suivant le rend à sa
   * place exacte dans la pile. Le lot est refermé tout de suite, pour que deux
   * Ctrl+D successifs restent deux annulations distinctes.
   *
   * Renvoie false s'il n'y avait rien sous le curseur : l'appelant peut alors
   * le dire au lieu de laisser croire à une touche morte.
   */
  supprimerSousLeCurseur(): boolean {
    const p = this.pointer
    if (!p) return false
    const s = this.strokeAt(p.x, p.y)
    if (!s || s.dying) return false
    const lotEnCours = this.eraseLot
    this.eraseLot = null
    this.eraseAt({ x: p.x, y: p.y, p: 0.5, t: performance.now() })
    // Un Ctrl+D en plein passage de gomme ne doit pas se greffer sur ce
    // passage : on referme, et l'on rend son lot à la gomme si elle en avait un.
    this.eraseLot = lotEnCours
    this.anchorsDirty = true
    this.staticDirty = true
    return true
  }

  private pushLaser(pt: StrokePoint, pressed: boolean): void {
    this.laser.push({ x: pt.x, y: pt.y, t: pt.t, pressed })
    if (this.laser.length > 260) this.laser.splice(0, this.laser.length - 260)
  }

  /**
   * Étincelles du tracé : la densité suit la VITESSE du geste (un trait rapide
   * crache des braises), la population est bornée, et l'ensemble s'éteint en
   * moins d'une demi-seconde — le trait doit rester la vedette.
   */
  private spawnSparkles(pt: StrokePoint): void {
    // Plafond ramené de 420 à 90 : au-delà, ce n'est plus une gerbe de braises,
    // c'est un voile qui recouvre le trait.
    if (this.particles.length > 90) return
    const boost = this.opts.effects ?? 1
    const c = this.current
    let speed = 0
    if (c && c.points.length > 1) {
      const a = c.points[c.points.length - 2]
      speed = clamp(dist(a.x, a.y, pt.x, pt.y) / Math.max(1, pt.t - a.t), 0, 1.6)
    }
    const count = Math.max(1, Math.round((0.9 + speed * 0.7) * boost))
    const spread = this.opts.size * 2.4 + 3
    for (let i = 0; i < count; i++) {
      // une braise sur quinze porte un éclat en croix (une sur cinq avant :
      // le cliché du sprite d'étincelle sautait aux yeux)
      const glint = Math.random() < 0.065 ? 1 : 0
      this.particles.push({
        x: pt.x + (Math.random() - 0.5) * spread,
        y: pt.y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * (140 + speed * 110),
        vy: -28 - Math.random() * 105,
        born: pt.t,
        // 300 à 480 ms au lieu de 460 à 1080 : plus rien ne traîne à l'écran
        // une seconde après la fin du geste
        life: 300 + Math.random() * 180,
        size: (glint ? 1.5 + Math.random() * 1.6 : 0.8 + Math.random() * 1.8) * (0.8 + boost * 0.3),
        color: this.opts.color,
        glint,
        rot: Math.random() * Math.PI,
      })
    }
  }

  /* ------------------------------------------------------------------ *
   * Ping (§5.4) — effet éphémère : hors undo, hors export, hors fondu auto
   * ------------------------------------------------------------------ */

  private spawnPing(x: number, y: number): void {
    const now = performance.now()
    this.pings.push({ x, y, t: now, color: this.opts.color })
    if (this.pings.length > 10) this.pings.shift()
    if (this.opts.sparkles) {
      const boost = this.opts.effects ?? 1
      const n = Math.round(9 * boost)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
        const v = 70 + Math.random() * 90
        this.particles.push({
          x: x + Math.cos(a) * 14,
          y: y + Math.sin(a) * 14,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 20,
          born: now,
          life: 420 + Math.random() * 380,
          size: 1 + Math.random() * 1.7,
          color: this.opts.color,
          glint: Math.random() < 0.35 ? 1 : 0,
          rot: a,
        })
      }
    }
    sfx.pingSfx()
    this.wake()
  }

  /* ------------------------------------------------------------------ *
   * Spotlight (§5.2) — voile sombre + trou à bord dégradé, sous le trait
   * ------------------------------------------------------------------ */

  private setSpot(on: boolean): void {
    if (this.spotOn === on) return
    const now = performance.now()
    this.spotFrom = this.spotState(now).a
    this.spotAt = now
    this.spotOn = on
    // en quittant l'outil, la zone tracée s'oublie : au retour, le spotlight
    // repart sur le disque suiveur, jamais sur une zone d'il y a dix minutes
    if (!on) {
      this.spotRegion = null
      this.spotDraw = null
    }
    this.wake()
  }

  /** `a` : opacité du voile (0→1) · `r` : facteur de rayon, avec dépassement */
  private spotState(now: number): { a: number; r: number } {
    const target = this.spotOn ? 1 : 0
    const p = clamp((now - this.spotAt) / SPOT_MS, 0, 1)
    return {
      a: this.spotFrom + (target - this.spotFrom) * easeOutCubic(p),
      r: this.spotFrom + (target - this.spotFrom) * easeOutBack(p),
    }
  }

  private spotVisible(now: number): boolean {
    return this.spotOn || this.spotState(now).a > 0.002
  }

  /** annule le maintien du clic droit (relâché tôt, geste, ou panique) */
  private cancelRadial(): void {
    if (this.radialTimer) {
      clearTimeout(this.radialTimer)
      this.radialTimer = null
    }
  }

  /** échelle de RENDU de l'annotation attrapée : 1 → 1,04 puis retour élastique */
  private grabFactor(now: number): number {
    const g = this.grabAnim
    if (!g) return 1
    if (!g.back) return 1 + (GRAB_SCALE - 1) * easeOutCubic(clamp((now - g.start) / GRAB_IN_MS, 0, 1))
    const p = clamp((now - g.start) / GRAB_BACK_MS, 0, 1)
    if (p >= 1) return 1
    return 1 + (g.from - 1) * (1 - easeOutElastic(p))
  }

  /** centre d'une annotation (boîte englobante) — pivot du grossissement */
  private centroid(s: Stroke): { x: number; y: number } {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of s.points) {
      if (p.x < x0) x0 = p.x
      if (p.y < y0) y0 = p.y
      if (p.x > x1) x1 = p.x
      if (p.y > y1) y1 = p.y
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  }

  private moveCursor(): void {
    this.cursor.style.transform = `translate3d(${this.pointer.x}px, ${this.pointer.y}px, 0) translate(-50%, -50%)`
  }

  private syncCursor(): void {
    const t = this.opts.tool
    this.cursor.dataset.tool = t
    this.cursor.style.setProperty('--c', this.opts.color)
    const d = t === 'eraser' ? 30 : t === 'ping' ? 26 : clamp(this.opts.size * 1.6, 8, 26)
    this.cursor.style.setProperty('--d', `${d}px`)
    // laser et spotlight ont leur propre signe à l'écran : pas de pastille
    this.cursor.style.opacity = t === 'laser' || t === 'spotlight' ? '0' : '1'
  }

  private emitActivity(): void {
    const has = this.hasContent
    if (has !== this.lastActivity) {
      this.lastActivity = has
      this.onActivity?.(has)
    }
  }

  private resize(): void {
    // Le fond de rendu est en pixels PHYSIQUES, les coordonnées de la souris en
    // pixels CSS : c'est `setTransform(dpr, …)` qui relie les deux. Tant que ce
    // rapport est juste, le trait tombe exactement sous le curseur, à 100 %
    // comme à 125 % ou 150 % (§12.3).
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const w = this.stage.clientWidth
    const h = this.stage.clientHeight
    // Rien n'a bougé : ne PAS réallouer. Windows émet des `resize` en rafale
    // (barre des tâches, retour de veille, écran reconfiguré) et réallouer les
    // trois canvas efface le calque statique pour le repeindre à l'identique —
    // du travail et un clignotement pour rien. Ce garde-fou rend aussi
    // inoffensif le `resize` synthétique émis quand seul le DPI change (App.tsx).
    if (w === this.w && h === this.h && dpr === this.dpr) return
    this.dpr = dpr
    this.w = w
    this.h = h
    // Le voile du spotlight n'est PAS dans cette liste : il gère sa propre
    // taille dans renderVeil() et reste à 0×0 tant que le spotlight est
    // éteint. Le redimensionner ici lui rendrait un plein écran permanent.
    for (const [cv, ctx] of [
      [this.staticCv, this.sCtx],
      [this.liveCv, this.lCtx],
    ] as const) {
      cv.width = Math.round(this.w * dpr)
      cv.height = Math.round(this.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    this.staticDirty = true
    this.wake()
  }

  private wake(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    if (!this.running) {
      this.running = true
      this.lastFrame = performance.now()
      this.raf = requestAnimationFrame(this.loop)
    }
  }

  private loop = (): void => {
    const now = performance.now()
    const dt = clamp(now - this.lastFrame, 0, 48) / 1000
    this.lastFrame = now

    // Déclencher les dissolutions programmées (fondu auto). SUSPENDU tant que
    // les annotations sont masquées : sans ça, elles mourraient en douce
    // pendant qu'on ne les voit pas, et l'on rallumerait sur un écran vide.
    for (const s of this.strokes) {
      if (this.opts.annotationsHidden) break
      if (!s.dying && s.dieAt != null && now >= s.dieAt) {
        s.dying = { start: now, duration: dissolveDuration(s), mode: 'dissolve', cause: 'fade' }
        this.salir(s)
      }
    }
    // purger les traits entièrement dissous
    let purged = false
    let purgedBadge = false
    let purgedJalon = false
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const st = this.strokes[i]
      const d = st.dying
      if (d && now - d.start >= d.duration) {
        this.morphs.delete(st.id)
        if (st.tool === 'badge') purgedBadge = true
        else if (st.tool === 'marker') purgedJalon = true
        this.strokes.splice(i, 1)
        this.sortir(st)
        purged = true
      }
    }
    if (purged) {
      if (purgedBadge) this.syncBadgeSeq()
      if (purgedJalon) this.syncJalonSeq()
      this.anchorsDirty = true
      this.staticDirty = true
      this.emitActivity()
    }

    // particules
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      if (now - p.born > p.life) {
        this.particles.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 1 - 1.4 * dt
      p.vy += 26 * dt
    }
    // traînée laser
    while (this.laser.length > 0 && now - this.laser[0].t > LASER_TTL) this.laser.shift()
    // pings arrivés au bout de leur vie (effet éphémère, rien à purger ailleurs)
    while (this.pings.length > 0 && now - this.pings[0].t > PING_MS) this.pings.shift()
    // fin du retour élastique de l'annotation relâchée
    if (this.grabAnim && this.grabAnim.back && now - this.grabAnim.start >= GRAB_BACK_MS) {
      this.grabAnim = null
      this.staticDirty = true
    }

    // mode écriture : échéance de transcription et fins de dé-morph
    this.pumpHandwriting(now)

    const dyingActive = this.strokes.some((s) => s.dying)
    const animActive = this.strokes.some((s) => s.anim && now - s.anim.start < s.anim.duration)
    const morphActive = this.morphs.size > 0
    const hwActive = this.hw.active(now)
    const guidesActive = this.overlay.active(now)
    const spotAnim = now - this.spotAt < SPOT_MS
    // encre vivante : allumage d'un trait fraîchement posé, flèches pulsantes.
    // Sans rien à animer, renvoie false — et la boucle s'endort comme avant.
    const fxActive = fxKeepsAlive(this.strokes, now)
    // Filet de sécurité : une exception levée ici (un rayon négatif, une police
    // introuvable, une image cassée…) sortirait de la boucle AVANT le prochain
    // requestAnimationFrame — l'overlay se figerait alors définitivement, en
    // plein direct, sans aucun message. On préfère une image ratée à une
    // application morte : on note l'incident une fois, et la boucle continue.
    try {
      if (
        this.staticDirty ||
        dyingActive ||
        animActive ||
        morphActive ||
        fxActive ||
        this.grabbed ||
        this.grabAnim
      ) {
        this.renderStatic(now)
      }
      // voile du spotlight : canvas dédié, sous les annotations (se nettoie seul)
      this.renderVeil(now)
      this.renderLive(now)
    } catch (err) {
      if (!this.renderFailed) {
        this.renderFailed = true
        console.error('[hexa] rendu interrompu sur une image, la boucle continue :', err)
      }
    }
    // miroir : enregistreur de session (§11) et vue OBS (§10.2). Uniquement
    // pendant que la boucle tourne, donc jamais au repos.
    //
    // Le journal des changements accompagne l'état : le miroir n'a plus à
    // deviner ce qui a bougé, donc plus à relire toute la scène. Il est vidé
    // JUSTE APRÈS — un consommateur qui s'échantillonne plus lentement doit
    // accumuler de son côté (voir MirrorDelta).
    this.delta.strokes = this.strokes
    this.delta.current = this.current
    this.onMirror?.(this.delta)
    this.sales.clear()
    this.partis.clear()

    const busy =
      this.current != null ||
      this.grabbed != null ||
      this.erasing ||
      this.particles.length > 0 ||
      this.laser.length > 0 ||
      this.pings.length > 0 ||
      this.grabAnim != null ||
      this.repriseCue != null ||
      spotAnim ||
      dyingActive ||
      animActive ||
      morphActive ||
      fxActive ||
      hwActive ||
      guidesActive
    if (busy) {
      this.raf = requestAnimationFrame(this.loop)
      return
    }
    this.running = false
    // programmer le prochain réveil si un fondu auto est en attente
    let next = Infinity
    for (const s of this.strokes) {
      if (!s.dying && s.dieAt != null) next = Math.min(next, s.dieAt)
    }
    // …ou si une transcription d'écriture est programmée (mode écriture)
    const hwDue = this.hw.nextDue()
    if (hwDue != null) next = Math.min(next, hwDue)
    if (next < Infinity) {
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = null
        this.wake()
      }, Math.max(16, next - now))
    }
  }

  /**
   * Mode écriture : applique les échanges décidés par le module d'écriture
   * (encre → mot typographié, ou l'inverse après un Ctrl+Z). Le module ne
   * touche jamais lui-même à la liste des traits : ici seulement.
   */
  private pumpHandwriting(now: number): void {
    const swaps = this.hw.tick(now, this.strokes, {
      nextId: () => this.idSeq++,
      glow: 1,
      drawing: this.current != null,
    })
    if (swaps.length === 0) return
    // Une transcription est une action NEUVE : elle invalide le rétablissement.
    // Le retour d'un dé-morph, lui, est la seconde moitié d'un Ctrl+Z : il doit
    // au contraire DÉPOSER sa marche avant, sans effacer la pile.
    if (swaps.some((sw) => sw.undo !== true)) this.redoStack = []
    for (const swap of swaps) {
      for (const s of swap.remove) {
        const i = this.strokes.indexOf(s)
        if (i >= 0) this.strokes.splice(i, 1)
        this.sortir(s)
      }
      for (const s of swap.add) {
        s.dying = undefined
        s.dieAt =
          this.opts.fadeDelay == null
            ? undefined
            : now + this.opts.fadeDelay + (s.anim?.duration ?? 0)
        this.strokes.push(s)
        this.salir(s)
      }
      // tant qu'un mot s'écrit, ses lettres déjà posées ne doivent pas
      // s'effacer sous le nez de l'utilisateur : leur fondu est repoussé
      if (swap.keep && this.opts.fadeDelay != null) {
        for (const s of swap.keep) {
          if (s.dying) continue
          s.dieAt = now + this.opts.fadeDelay + (s.anim?.duration ?? 0)
          this.salir(s)
        }
      }
      // marche avant du Ctrl+Z qui vient d'atterrir : refaire l'échange dans
      // l'autre sens rend le mot typographié (§182 — rétablir, illimité)
      if (swap.undo === true) {
        if (this.hwUndoing && swap.remove.includes(this.hwUndoing)) this.hwUndoing = null
        this.redoStack.push({ kind: 'swap', remove: [...swap.add], add: [...swap.remove] })
      }
    }
    this.anchorsDirty = true
    this.staticDirty = true
    this.emitActivity()
  }

  private renderStatic(now: number): void {
    const ctx = this.sCtx
    ctx.clearRect(0, 0, this.w, this.h)
    // Annotations masquées : on efface et on s'arrête là. Rien n'est détruit —
    // la liste des traits est intacte, seul l'affichage est coupé.
    if (this.opts.annotationsHidden) return
    // ---- calque consolidé (src/engine/ink-fx.ts) --------------------------
    // Les traits POSÉS (terminés, immobiles, sans animation) sont peints une
    // seule fois hors écran puis restitués en un appel : 200 annotations ne
    // coûtent plus 200 recalculs de contour par image. Le vectoriel reste la
    // source de vérité — le calque se reconstruit tout seul dès que la liste
    // change (annuler, dissolution, thème, redimensionnement).
    const glow = this.opts.effects ?? 1
    const settled = inkLayer.compose(ctx, this.strokes, {
      w: this.w,
      h: this.h,
      now,
      glow,
      hot: (s) => s === this.grabbed || this.morphs.has(s.id) || this.grabAnim?.id === s.id,
      paint: (c, s) => renderStroke(c, s, { alpha: 1, from: 0, glowBoost: glow, now }),
    })
    // ---- fin du calque consolidé -----------------------------------------
    for (const s of this.strokes) {
      if (settled.has(s.id)) continue
      let alpha = 1
      let from = 0
      // intensité des effets (réglages) : multiplie le halo, 1 par défaut
      const glowBoost = (s === this.grabbed ? 1.45 : 1) * (this.opts.effects ?? 1)
      // seuls les tracés à main levée se consument en comète : les formes,
      // textes, pastilles et tampons partent en fondu
      const comet = FREEHAND_TOOLS.has(s.tool)
      if (s.dying) {
        const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
        if (p > 0) {
          if (s.dying.mode === 'pop' || !comet) {
            alpha = 1 - p
          } else {
            const n = s.points.length
            from = Math.floor(easeInQuad(p) * Math.max(0, n - 2))
            alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25
          }
        }
      }
      // annotation attrapée : léger grossissement autour de son centre, puis
      // retour élastique au relâché. C'est un effet de RENDU : les points de
      // l'annotation ne bougent pas d'un pixel (export et rejeu intacts).
      const gk = this.grabAnim?.id === s.id ? this.grabFactor(now) : 1
      if (gk !== 1) {
        const c = this.centroid(s)
        ctx.save()
        ctx.translate(c.x, c.y)
        ctx.scale(gk, gk)
        ctx.translate(-c.x, -c.y)
      }
      // morph en cours : on dessine l'image intermédiaire, pas la forme finale
      const morph = this.morphs.get(s.id)
      if (morph) {
        const mt = clamp((now - morph.start) / morph.duration, 0, 1)
        renderMorph(ctx, morph, mt, s, alpha)
        if (mt >= 1) this.morphs.delete(s.id)
        if (gk !== 1) ctx.restore()
        continue
      }
      renderStroke(ctx, s, { alpha, from, glowBoost, now, link: this.linkAnchor(s) })
      if (s.dying && s.dying.mode === 'dissolve') {
        const p = clamp((now - s.dying.start) / s.dying.duration, 0, 1)
        if (p > 0 && p < 1) {
          const head = !comet
            ? s.points[s.points.length - 1]
            : s.points[Math.min(from, s.points.length - 1)]
          const e = emberAt(p)
          const r = Math.max(6, s.size * (1.7 + Math.sin(now * 0.02) * 0.35)) * e.scale
          renderEmber(ctx, head.x, head.y, r, s.color, e.alpha)
        }
      }
      if (gk !== 1) ctx.restore()
    }
    this.staticDirty = false
  }

  /** centre de la pastille précédente, pour la flèche de liaison du numéroteur */
  private linkAnchor(s: Stroke): Pt | null {
    if (s.tool !== 'badge' || s.linkFrom == null) return null
    // on garde l'ancre même si la pastille source se dissout : le lien part
    // en fondu avec elle au lieu de disparaître d'un coup
    for (const o of this.strokes) {
      if (o.id === s.linkFrom) return { x: o.points[0].x, y: o.points[0].y }
    }
    return null
  }

  private renderLive(now: number): void {
    const ctx = this.lCtx
    ctx.clearRect(0, 0, this.w, this.h)
    // guides magnétiques : couche LIVE uniquement, jamais dans l'export
    this.overlay.render(ctx, now, this.opts.color)
    if (this.current) {
      renderStroke(ctx, this.current, { alpha: 1, from: 0, glowBoost: 1, now })
    }
    // §5.2 — zone de spotlight en cours de tracé : un contour pointillé, le
    // temps du geste seulement (le voile montre déjà le résultat)
    if (this.spotDraw) paintSpotDraft(ctx, this.spotDraw, this.opts.color)
    // §4.8 — « la série repart de cette pastille-là » : anneau, onde et numéro
    // suivant, sur la couche LIVE. Elle se nettoie d'elle-même à l'image
    // suivante, donc rien à purger et rien qui traîne à l'antenne.
    if (this.repriseCue) {
      if (now - this.repriseCue.start >= REPRISE_CUE_MS) this.repriseCue = null
      // annotations masquées : la pastille désignée n'est pas à l'écran, son
      // anneau n'a rien à y faire non plus
      else if (!this.opts.annotationsHidden) renderReprise(ctx, this.repriseCue, now)
    }
    if (this.particles.length > 0) this.renderSparks(ctx, now)
    if (this.pings.length > 0) this.renderPings(ctx, now)
    if (this.laser.length > 0) this.renderLaser(ctx, now)
    // mode écriture : confirmation du mot lu, couche live donc hors export
    this.hw.renderChip(ctx, now)
  }

  /**
   * Étincelles du tracé.
   *
   * ⚠️ UNE ÉTINCELLE N'A PAS DE BORD. Chaque particule était peinte en TROIS
   * disques pleins concentriques (`arc` + `fill` à opacité constante) : trois
   * bords circulaires NETS, c'est-à-dire une bulle de savon, et jusqu'à 39 px
   * de diamètre autour d'un cœur de trait de 4 px. Le trait — l'argument
   * numéro un du produit — finissait enterré sous du bokeh.
   * Ici, une seule braise à dégradé radial (la MÊME que la dissolution, via
   * `emberSprite`) : elle fond dans le fond, elle ne le tache pas.
   */
  private renderSparks(ctx: CanvasRenderingContext2D, now: number): void {
    const boost = this.opts.effects ?? 1
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (const p of this.particles) {
      const age = (now - p.born) / p.life
      if (age >= 1) continue
      const k = 1 - age
      // allumage franc, extinction douce : c'est ce qui fait la braise
      const a = Math.min(1, age * 9) * k * k
      const sprite = emberSprite(p.color)
      const R = p.size * 3.8 * (1 + age * 0.5)
      if (sprite) {
        ctx.globalAlpha = Math.min(1, a * 1.15 * boost)
        ctx.drawImage(sprite, p.x - R, p.y - R, R * 2, R * 2)
        ctx.globalAlpha = 1
      }
      if (p.glint === 1) {
        // éclat en croix : court et discret, pas le sprite d'étincelle du
        // catalogue. Il ne doit se remarquer qu'une fois sur quinze.
        const l = R * 1.5 * k
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot + age * 1.1)
        ctx.strokeStyle = whiteMix(p.color, 0.6, 0.5 * a)
        ctx.lineWidth = Math.max(0.6, p.size * 0.36)
        ctx.beginPath()
        ctx.moveTo(-l, 0)
        ctx.lineTo(l, 0)
        ctx.moveTo(0, -l * 0.55)
        ctx.lineTo(0, l * 0.55)
        ctx.stroke()
        ctx.restore()
      }
    }
    ctx.restore()
  }

  /**
   * Ping (§5.4) : deux anneaux qui se contractent l'un après l'autre, avec un
   * dépassement élastique, sur un halo qui pulse. Très lisible pour le viewer,
   * même sur une image de jeu chargée.
   */
  private renderPings(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    const boost = this.opts.effects ?? 1
    for (const p of this.pings) {
      const age = (now - p.t) / PING_MS
      if (age < 0 || age >= 1) continue
      const fade = age > 0.74 ? 1 - (age - 0.74) / 0.26 : 1
      // halo qui respire sous les anneaux (deux battements)
      const pulse = Math.abs(Math.sin(age * Math.PI * 2))
      const hr = 40 + 34 * pulse
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, hr)
      halo.addColorStop(0, rgba(p.color, 0.42 * fade * boost))
      halo.addColorStop(0.4, rgba(p.color, 0.2 * fade))
      halo.addColorStop(1, rgba(p.color, 0))
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(p.x, p.y, hr, 0, Math.PI * 2)
      ctx.fill()
      // les deux contractions : départ large, convergence douce (smoothstep),
      // puis un léger dépassement élastique juste avant l'extinction
      for (let k = 0; k < 2; k++) {
        const q = (age - k * 0.3) / 0.56
        if (q <= 0 || q >= 1) continue
        const s = q * q * (3 - 2 * q)
        const wobble = q > 0.8 ? Math.sin((q - 0.8) * 15.7) * 4 * (1 - q) * 5 : 0
        const r = Math.max(9, 104 - 84 * s + wobble)
        const a = Math.min(1, q * 6) * (1 - q * q) * fade
        const w = 2 + 6.5 * (1 - q)
        ctx.strokeStyle = rgba(p.color, 0.26 * a * boost)
        ctx.lineWidth = w * 3.6
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = rgba(p.color, 0.5 * a)
        ctx.lineWidth = w * 1.7
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = whiteMix(p.color, 0.6, 0.95 * a)
        ctx.lineWidth = w
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      // cœur : un point blanc qui bat au rythme des anneaux
      const beat = 5 + 3.4 * pulse
      const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, beat * 2.4)
      core.addColorStop(0, whiteMix(p.color, 0.92, 0.98 * fade))
      core.addColorStop(0.4, rgba(p.color, 0.55 * fade))
      core.addColorStop(1, rgba(p.color, 0))
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(p.x, p.y, beat * 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /**
   * Spotlight (§5.2) : voile sombre à 70 %, trou dégradé sur 40 px autour du
   * curseur. Le voile vit sur SON canvas, sous les annotations : l'écran
   * s'assombrit, le trait reste éclatant.
   */
  private renderVeil(now: number): void {
    const ctx = this.vCtx
    const st = this.spotState(now)
    if (st.a <= 0.002) {
      if (this.veilPainted) {
        ctx.clearRect(0, 0, this.w, this.h)
        this.veilPainted = false
      }
      // MÉMOIRE : le voile ne sert qu'au spotlight, un outil qu'on ouvre
      // quelques secondes par session. Un canvas plein écran gardé « au cas
      // où » coûte largeur × hauteur × dpr² × 4 octets en permanence — une
      // centaine de mégaoctets sur un 4K. On le rend à zéro, il repart à sa
      // taille réelle dès que le spotlight se rallume.
      if (this.veilCv.width !== 0) {
        this.veilCv.width = 0
        this.veilCv.height = 0
      }
      return
    }
    // le spotlight s'allume : le voile reprend sa taille réelle
    const vw = Math.round(this.w * this.dpr)
    const vh = Math.round(this.h * this.dpr)
    if (this.veilCv.width !== vw || this.veilCv.height !== vh) {
      this.veilCv.width = vw
      this.veilCv.height = vh
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    }
    // Trois variantes, un seul voile (src/engine/stream-fx.ts) : disque
    // suiveur quand aucune zone n'est tracée, sinon le rectangle ou le lasso
    // — et pendant le geste, la zone en cours, déjà éclairée.
    paintVeil(ctx, this.w, this.h, this.spotDraw ?? this.spotRegion, this.pointer, this.spotR, {
      accent: this.opts.color,
      boost: this.opts.effects ?? 1,
      alpha: st.a,
      scale: st.r,
    })
    this.veilPainted = true
  }

  private renderLaser(ctx: CanvasRenderingContext2D, now: number): void {
    const pts = this.laser
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const color = this.opts.color
    const boost = this.opts.effects ?? 1
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const age = (now - b.t) / LASER_TTL
      if (age >= 1) continue
      // la queue s'affine vite, la tête reste large : c'est ce qui fait comète
      const k = Math.pow(1 - age, 0.72)
      const w = (b.pressed ? 15 : 11) * k + 1.2
      ctx.strokeStyle = rgba(color, 0.13 * k * boost)
      ctx.lineWidth = w * 4.2
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.strokeStyle = rgba(color, 0.3 * k)
      ctx.lineWidth = w * 2
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.strokeStyle = whiteMix(color, 0.7, 0.72 * k)
      ctx.lineWidth = w * 0.62
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    const head = pts[pts.length - 1]
    const r = head.pressed ? 38 : 28
    const grad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r)
    grad.addColorStop(0, whiteMix(color, 0.85, 0.95))
    grad.addColorStop(0.25, rgba(color, 0.5))
    grad.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}
