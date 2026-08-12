/**
 * Hexa — effets de CAPTURE D'ÉCRAN (brief §5.5, §5.6, §5.7 et §6).
 *
 * Quatre outils qui ont tous besoin de voir ce qu'il y a SOUS la fenêtre
 * transparente d'Hexa :
 *   · la LOUPE       (§6)   — un disque qui grossit la zone visée
 *   · le GEL d'image (§5.5) — l'écran se fige, on annote la photo
 *   · les MASQUES    (§5.6) — un rectangle flouté en continu (chat, mot de passe)
 *   · l'AVANT/APRÈS  (§5.7) — un curseur vertical entre la photo et le direct
 *
 * Cette classe est AUTONOME : deux canvas à elle, sa propre boucle rAF
 * DORMANTE, ses propres écouteurs. Elle n'alourdit pas engine.ts d'une ligne.
 *
 * ── Budget de performance ────────────────────────────────────────────────
 * Au repos : aucun canvas peint, aucune image demandée, AUCUN flux vidéo
 * ouvert (les pistes sont réellement stoppées, pas juste mises en pause).
 * Le flux ne démarre qu'à la demande du premier outil qui en a besoin, et
 * s'éteint tout seul 1,2 s après le dernier. Les masques, qui doivent vivre
 * en continu, se rafraîchissent sur `requestVideoFrameCallback` : une image
 * peinte par image vidéo décodée, jamais plus — et rien du tout quand le flux
 * est coupé. Aucun setInterval nulle part.
 *
 * ── Piège documenté n°1 : backdrop-filter ne peut PAS servir ici ─────────
 * On pourrait croire qu'un `backdrop-filter: blur()` en CSS suffirait à
 * flouter la zone. C'est faux, et c'est structurel : le « backdrop » d'un
 * élément, ce sont les pixels peints DERRIÈRE lui DANS LA MÊME PAGE. Le
 * bureau de Windows, le jeu ou le navigateur qui se trouvent sous notre
 * fenêtre transparente n'appartiennent pas à la page : ils sont composés par
 * le système, après nous. `backdrop-filter` ne voit donc rien du tout et
 * produit un rectangle parfaitement transparent. Le seul chemin honnête est
 * celui-ci : relire l'écran (desktopCapturer → getUserMedia), redessiner la
 * région dans notre canvas, et la flouter nous-mêmes avec `ctx.filter`.
 *
 * ── Piège documenté n°2 : la récursion de capture ────────────────────────
 * Notre fenêtre fait partie de l'écran capturé. Tout ce que l'on peint est
 * donc relu à l'image suivante :
 *   · pour la LOUPE, si le disque recouvrait le point visé on obtiendrait un
 *     tunnel infini. D'où la règle §6 « JAMAIS au-dessus du point visé » :
 *     le centre du disque est maintenu à au moins rayon + demi-zone-source du
 *     point, sur les quatre diagonales, et jamais rogné en deçà.
 *   · pour un MASQUE, la plaque floutée est relue puis refloutée : le flou
 *     s'accumule et la zone converge en quelques dixièmes de seconde vers un
 *     aplat de la couleur moyenne. C'est inévitable sans exclure notre fenêtre
 *     de la capture (`setContentProtection`), ce qu'on ne peut pas faire :
 *     cela masquerait AUSSI les annotations pour OBS, c'est-à-dire tout le
 *     produit. On assume donc : la zone est illisible dès la première image,
 *     et le devient encore plus ensuite. C'est le bon sens du masquage.
 */
import { bridge, isElectron } from '../bridge'
import type { ToolId } from './types'

const TAU = Math.PI * 2

/* ------------------------------------------------------------------ *
 * PEAU DU THÈME (§ thèmes)
 *
 * Cette couche est peinte au CANVAS : ni classe ni variable CSS ne
 * l'atteignent. Elle gardait donc le nickel-néon du thème par défaut dans les
 * huit peaux — plaque bleu nuit et texte blanc au milieu d'un Glacier ou d'un
 * Sakura, où c'est un corps étranger. On relit ici les mêmes tokens que le
 * reste de l'interface, UNE fois par changement de thème (jamais par image).
 * ------------------------------------------------------------------ */

interface Peau {
  /** fond des plaques et pastilles (opaque, teinté par le thème) */
  panneau: [number, number, number]
  /** couleur de texte du thème */
  texte: [number, number, number]
  /** rayon des pastilles, borné : 0 sur les thèmes à angles droits */
  rayon: number
}

const PEAU_DEFAUT: Peau = { panneau: [12, 16, 28], texte: [255, 255, 255], rayon: 11 }
let peauVue = ' '
let peau: Peau = PEAU_DEFAUT

function lireCanal(v: string, repli: [number, number, number]): [number, number, number] {
  const m = v.trim().match(/-?[\d.]+/g)
  if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])]
  const h = v.trim().match(/^#([0-9a-f]{6})$/i)
  if (h) {
    const n = parseInt(h[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return repli
}

/** Peau du thème actif. Relue seulement quand `data-theme` change. */
function skin(): Peau {
  if (typeof document === 'undefined') return peau
  const t = document.documentElement.dataset.theme ?? ''
  if (t === peauVue) return peau
  peauVue = t
  const s = getComputedStyle(document.documentElement)
  const rayon = parseFloat(s.getPropertyValue('--chip-radius')) || 0
  peau = {
    // `--wall-1` est la couleur de fond que le thème revendique : c'est elle qui
    // dit si l'on travaille sur du sombre ou sur du clair.
    panneau: lireCanal(s.getPropertyValue('--wall-1'), PEAU_DEFAUT.panneau),
    texte: lireCanal(s.getPropertyValue('--text-1'), PEAU_DEFAUT.texte),
    rayon: Math.max(0, Math.min(11, rayon)),
  }
  return peau
}

/** Fond de plaque du thème, à l'opacité demandée. */
function fondPanneau(a: number): string {
  const [r, g, b] = skin().panneau
  return `rgba(${r},${g},${b},${a})`
}

/** Couleur de texte du thème, à l'opacité demandée. */
function encrePanneau(a: number): string {
  const [r, g, b] = skin().texte
  return `rgba(${r},${g},${b},${a})`
}

/** Rayon du disque de la loupe, en pixels CSS (§6 : disque de 400 px). */
const MAG_R = 200
/**
 * Grossissement par défaut. À ×2, la zone source fait exactement 200 px de
 * côté pour 400 px de disque : c'est la valeur décrite au §6.
 */
/** Grossissement par défaut de la loupe. 1,7 plutôt que 2 : à 2, le contexte
 *  autour du point visé disparaît trop vite et on perd ses repères sur une
 *  minimap. La molette monte jusqu'à 8 quand on veut vraiment coller au pixel. */
const MAG_ZOOM_DEFAULT = 1.7
const MAG_ZOOM_MIN = 1.2
const MAG_ZOOM_MAX = 8
/** Ressort amorti du disque (§6) : ces deux nombres FONT l'impression de luxe. */
const SPRING_K = 0.15
const SPRING_D = 0.75
/** Marge de sécurité anti-récursion, en plus de rayon + demi-source. */
const MAG_GAP = 22

/** Rayon du flou des masques (§5.6). */
const BLUR_PX = 14
/** Marge échantillonnée autour du masque : sans elle le flou aspire du vide. */
const BLUR_PAD = BLUR_PX * 2

/** Fondus du gel d'image (§5.5) : entrée franche, sortie douce de 300 ms. */
const FREEZE_IN = 140
const FREEZE_OUT = 300

/** Taille minimale d'un masque, en pixels CSS : en dessous c'est un clic raté. */
const MASK_MIN = 24
/** Zone cliquable de la croix de suppression d'un masque. */
const MASK_X_R = 13

/** Délai avant extinction réelle du flux quand plus personne ne le regarde. */
const FEED_RELEASE_MS = 1200
/** Repli quand `requestVideoFrameCallback` n'existe pas : ~15 images/s. */
const FEED_FALLBACK_MS = 66

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Rectangle arrondi (les navigateurs sans ctx.roundRect existent encore). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** État public de la couche, à destination de l'interface et des tests. */
export interface FxState {
  tool: ToolId
  magnifier: boolean
  pinned: boolean
  zoom: number
  frozen: boolean
  compare: boolean
  masks: number
  feed: boolean
  disc: { x: number; y: number } | null
}

/** Un masque flou posé par l'utilisateur. Coordonnées en pixels CSS. */
interface FxMask {
  id: number
  x: number
  y: number
  w: number
  h: number
  /** horodatage de pose : sert à l'animation d'apparition */
  born: number
}

/** Source dessinable : la vidéo du flux, ou l'image gelée. */
type FxSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement

/** `requestVideoFrameCallback` n'existe pas partout : on l'atteint par ce biais. */
type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/* ══════════════════════════════════════════════════════════════════════════
   Flux d'écran — allumé à la demande, éteint dès que plus personne ne regarde
   ══════════════════════════════════════════════════════════════════════════ */

class ScreenFeed {
  private video: RvfcVideo | null = null
  private stream: MediaStream | null = null
  private pending: Promise<boolean> | null = null
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private rvfc: number | null = null
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
  /** flux injecté par les tests : on ne demande alors rien au système */
  private injected: MediaStream | null = null

  /** dernier refus du système, à afficher discrètement une seule fois */
  refusal: string | null = null

  /** Vidéo prête à être dessinée, ou null tant qu'aucune image n'est décodée. */
  get frame(): HTMLVideoElement | null {
    const v = this.video
    if (!v || v.readyState < 2 || v.videoWidth === 0) return null
    return v
  }

  get live(): boolean {
    return this.stream != null
  }

  /**
   * POINT D'ENTRÉE DE TEST (et seulement de test) : injecte un flux fabriqué
   * à la main — typiquement un canvas animé passé à `captureStream()`. Permet
   * de valider la loupe, les masques et l'avant/après là où le partage
   * d'écran n'existe pas (machine d'intégration continue, xvfb…).
   */
  useTestStream(stream: MediaStream): void {
    this.injected = stream
    this.refusal = null
    this.stop()
  }

  /**
   * Démarre le flux si besoin. `gesture` indique qu'on est dans un geste
   * utilisateur : en démo navigateur, `getDisplayMedia` n'est autorisé que là.
   */
  request(gesture: boolean): Promise<boolean> {
    if (this.stream) {
      this.keepAlive()
      return Promise.resolve(true)
    }
    if (this.pending) return this.pending
    this.pending = this.open(gesture).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async open(gesture: boolean): Promise<boolean> {
    this.cancelRelease()
    try {
      let stream: MediaStream | null = this.injected
      if (!stream) {
        const sourceId = await bridge.getScreenSourceId()
        if (sourceId) {
          // Chemin Electron : desktopCapturer nous donne un identifiant de
          // source, getUserMedia ouvre le flux CONTINU correspondant. Bien
          // moins coûteux qu'une rafale de captures d'écran.
          const constraints = {
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                maxFrameRate: 30,
              },
            },
          } as unknown as MediaStreamConstraints
          stream = await navigator.mediaDevices.getUserMedia(constraints)
        } else if (navigator.mediaDevices?.getDisplayMedia) {
          // Démo navigateur : on ne peut demander l'écran QUE dans un geste.
          if (!gesture) return false
          stream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: { frameRate: 30 },
          })
        }
      }
      if (!stream) {
        this.refusal = 'Hexa ne peut pas lire l’écran ici (partage d’écran indisponible).'
        return false
      }
      const video = document.createElement('video') as RvfcVideo
      video.className = 'fx-feed'
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      document.body.appendChild(video)
      await video.play().catch(() => undefined)
      this.stream = stream
      this.video = video
      this.refusal = null
      return true
    } catch (err) {
      this.refusal =
        'Partage d’écran refusé : la loupe et les masques ne peuvent pas voir ton écran.'
      bridge.log('fx', `flux écran indisponible : ${String(err)}`)
      return false
    }
  }

  /** Le flux sert encore : on annule toute extinction programmée. */
  keepAlive(): void {
    this.cancelRelease()
  }

  /** Plus personne ne regarde : extinction réelle après un court sursis. */
  release(): void {
    if (!this.stream || this.releaseTimer) return
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null
      this.stop()
    }, FEED_RELEASE_MS)
  }

  private cancelRelease(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
  }

  /** Coupe tout : pistes stoppées, srcObject vidé, élément retiré du DOM. */
  stop(): void {
    this.cancelRefresh()
    this.cancelRelease()
    const v = this.video
    if (v) {
      v.pause()
      v.srcObject = null
      v.remove()
    }
    this.video = null
    // Un flux injecté par les tests n'est pas à nous : on le laisse vivre.
    if (this.stream && this.stream !== this.injected) {
      for (const track of this.stream.getTracks()) track.stop()
    }
    this.stream = null
  }

  /**
   * Réveille `cb` à la PROCHAINE image vidéo décodée. C'est l'équivalent d'un
   * rAF, mais cadencé par le flux : si l'écran ne bouge pas, rien ne se passe.
   */
  onNextFrame(cb: () => void): void {
    if (this.rvfc != null || this.fallbackTimer != null) return
    const v = this.video
    if (v?.requestVideoFrameCallback) {
      this.rvfc = v.requestVideoFrameCallback(() => {
        this.rvfc = null
        cb()
      })
      return
    }
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null
      cb()
    }, FEED_FALLBACK_MS)
  }

  private cancelRefresh(): void {
    if (this.rvfc != null && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.rvfc)
    }
    this.rvfc = null
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
  }

  destroy(): void {
    this.stop()
    this.injected = null
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   FxLayer
   ══════════════════════════════════════════════════════════════════════════ */

export class FxLayer {
  private stage: HTMLElement
  private below: HTMLDivElement
  private underCv: HTMLCanvasElement
  private uCtx: CanvasRenderingContext2D
  private overCv: HTMLCanvasElement
  private oCtx: CanvasRenderingContext2D
  private hud: HTMLDivElement
  private badge: HTMLDivElement
  private toast: HTMLDivElement
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  private w = 0
  private h = 0
  private dpr = 1
  private detach: (() => void)[] = []

  private tool: ToolId = 'pen'
  private accent = '#00e5ff'
  /** premier setTool passé ? (voir le commentaire de setTool) */
  private booted = false

  /* ---- loupe ---- */
  private magZoom = MAG_ZOOM_DEFAULT
  private magPinned = false
  private magCx = 0
  private magCy = 0
  private magVx = 0
  private magVy = 0
  private magPlaced = false

  /* ---- pointeur : alimenté MÊME en clic traversant (§6.5) ---- */
  private px = -1e4
  private py = -1e4

  /* ---- gel d'image ---- */
  private frozen: HTMLCanvasElement | null = null
  private freezeIn = 0
  private freezeOut = 0
  private freezing = false

  /* ---- masques flous ---- */
  private masks: FxMask[] = []
  private maskSeq = 1
  private drawingMask: FxMask | null = null
  private movingMask: { mask: FxMask; dx: number; dy: number } | null = null

  /* ---- avant/après ---- */
  private compare = false
  private compareX = 0.5
  private compareDrag = false

  private feed = new ScreenFeed()
  private raf = 0
  private painted = false
  private lastActivity = false

  /** la couche contient quelque chose de vivant → la fenêtre doit rester visible */
  onActivity?: (has: boolean) => void

  /**
   * Changement d'ÉTAT (pas d'image) : gel allumé/éteint, comparateur ouvert,
   * masque posé ou retiré. Appelé sur des événements discrets uniquement —
   * jamais pendant le rendu — pour que l'interface puisse allumer ses boutons
   * sans coûter une image de plus.
   */
  onChange?: (state: FxState) => void

  private notify(): void {
    this.onChange?.(this.state())
  }

  constructor(stage: HTMLElement) {
    this.stage = stage
    const parent = stage.parentElement ?? document.body
    // DEUX plans, de part et d'autre de la scène du moteur. On ne pose RIEN
    // dans `.stage` : ses trois canvas (voile · statique · vif) appartiennent
    // au moteur, et tout le reste du projet compte dessus.
    //   · `.fx-below`, inséré juste avant la scène → image gelée et masques
    //     passent SOUS les annotations (§5.5)
    //   · `.fx-hud`, ajouté après → disque de la loupe, poignées et badges
    this.below = document.createElement('div')
    this.below.className = 'fx-below'
    this.underCv = document.createElement('canvas')
    this.below.appendChild(this.underCv)
    parent.insertBefore(this.below, stage)

    this.hud = document.createElement('div')
    this.hud.className = 'fx-hud'
    this.overCv = document.createElement('canvas')
    this.badge = document.createElement('div')
    this.badge.className = 'fx-badge'
    this.toast = document.createElement('div')
    this.toast.className = 'fx-toast'
    this.hud.append(this.overCv, this.badge, this.toast)
    parent.appendChild(this.hud)

    this.uCtx = this.underCv.getContext('2d')!
    this.oCtx = this.overCv.getContext('2d')!

    const move = (e: PointerEvent) => this.onMove(e)
    const down = (e: PointerEvent) => this.onDown(e)
    const up = (e: PointerEvent) => this.onUp(e)
    const wheel = (e: WheelEvent) => this.onWheel(e)
    const resize = () => this.resize()
    // Capture : nos gestes doivent être vus AVANT ceux du moteur, sinon un
    // rectangle de masque déclencherait aussi un tracé.
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('wheel', wheel, { capture: true, passive: false })
    window.addEventListener('resize', resize)
    this.detach.push(() => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('wheel', wheel, true)
      window.removeEventListener('resize', resize)
    })

    this.resize()
    // Point d'entrée de test : voir ScreenFeed.useTestStream.
    ;(window as unknown as { hexaFx?: FxLayer }).hexaFx = this
  }

  /* ---------------------------------------------------------------- API */

  /**
   * Outil courant. Trois d'entre eux nous appartiennent :
   *   'magnifier' → loupe active tant qu'il est choisi
   *   'freeze'    → BASCULE le gel puis rend la main (§5.5 : on doit pouvoir
   *                 dessiner sur l'image gelée, donc le gel survit à l'outil)
   *   'blur'      → pose de masques
   */
  setTool(tool: ToolId): void {
    if (tool === this.tool) return
    const prev = this.tool
    // Le tout premier appel n'est pas un choix de l'utilisateur : c'est l'outil
    // RESTAURÉ du lancement précédent. Il ne doit surtout pas déclencher un
    // gel d'écran ni ouvrir un flux au démarrage — imaginez lancer Hexa et
    // trouver son écran figé sans avoir rien demandé.
    const demarrage = !this.booted
    this.booted = true
    this.tool = tool
    if (tool === 'magnifier') {
      this.magPlaced = false
      this.magPinned = false
      void this.feed.request(false)
    }
    if (tool === 'freeze' && prev !== 'freeze' && !demarrage) this.toggleFreeze()
    if (tool === 'blur' && !demarrage) void this.feed.request(false)
    if (prev === 'blur' && this.drawingMask) this.drawingMask = null
    this.syncFeedNeed()
    this.notify()
    this.wake()
  }

  setAccent(color: string): void {
    if (color === this.accent) return
    this.accent = color
    this.wake()
  }

  /** Le disque de la loupe se fige sur place, le contenu continue de suivre (§6). */
  toggleMagnifierPin(): void {
    if (this.tool !== 'magnifier') return
    this.magPinned = !this.magPinned
    this.flash(this.magPinned ? 'Loupe figée sur place' : 'Loupe libérée')
    this.notify()
    this.wake()
  }

  /** Gel d'image (§5.5) : capture l'écran, l'affiche SOUS les annotations. */
  toggleFreeze(): void {
    if (this.frozen && this.freezeOut === 0) {
      this.unfreeze()
      return
    }
    if (this.freezing) return
    this.freezing = true
    void this.grabStill().then((still) => {
      this.freezing = false
      if (!still) {
        this.flash(this.feed.refusal ?? 'Hexa n’a pas pu photographier l’écran.')
        return
      }
      this.frozen = still
      this.freezeIn = performance.now()
      this.freezeOut = 0
      this.badge.textContent = 'GEL'
      this.badge.classList.add('on')
      this.syncFeedNeed()
      this.notify()
      this.wake()
    })
  }

  /** Dégel avec fondu de 300 ms (§5.5). */
  unfreeze(): void {
    if (!this.frozen || this.freezeOut !== 0) return
    this.freezeOut = performance.now()
    this.compare = false
    this.badge.classList.remove('on')
    this.notify()
    this.wake()
  }

  /** Avant/après (§5.7) : à gauche l'image gelée, à droite le direct. */
  toggleCompare(): void {
    if (this.compare) {
      this.compare = false
      this.badge.classList.remove('on')
      this.notify()
      this.wake()
      return
    }
    if (!this.frozen || this.freezeOut !== 0) {
      // Sans photo, comparer n'a aucun sens : on la prend, puis on ouvre.
      if (this.freezing) return
      this.freezing = true
      void this.grabStill().then((still) => {
        this.freezing = false
        if (!still) {
          this.flash(this.feed.refusal ?? 'Hexa n’a pas pu photographier l’écran.')
          return
        }
        this.frozen = still
        this.freezeIn = performance.now()
        this.freezeOut = 0
        this.compare = true
        this.compareX = 0.5
        this.badge.textContent = 'AVANT / APRÈS'
        this.badge.classList.add('on')
        this.syncFeedNeed()
        this.notify()
        this.wake()
      })
      return
    }
    this.compare = true
    this.compareX = 0.5
    this.badge.textContent = 'AVANT / APRÈS'
    this.badge.classList.add('on')
    this.notify()
    this.wake()
  }

  /**
   * Touche panique / tout effacer : le gel et la comparaison disparaissent
   * avec le reste. Les MASQUES, eux, survivent — c'est la règle §5.6 : ce qui
   * cache une information sensible ne doit jamais partir par accident.
   */
  panic(): void {
    this.unfreeze()
    this.compare = false
    this.drawingMask = null
    this.movingMask = null
    if (this.masks.length > 0) {
      // On explique pourquoi il reste quelque chose à l'écran : sans ça,
      // l'utilisateur croit que la touche panique n'a pas tout nettoyé.
      const n = this.masks.length
      this.flash(
        `${n} zone${n > 1 ? 's' : ''} masquée${n > 1 ? 's' : ''} conservée${n > 1 ? 's' : ''} ` +
          '— touche B, puis la croix, pour la retirer.',
      )
    }
    this.wake()
  }

  /** Retire tous les masques (bouton explicite, jamais la touche panique). */
  clearMasks(): void {
    if (this.masks.length === 0) return
    this.masks = []
    this.syncFeedNeed()
    this.notify()
    this.wake()
  }

  maskCount(): number {
    return this.masks.length
  }

  /** État lisible depuis les tests et l'interface. */
  state(): FxState {
    return {
      tool: this.tool,
      magnifier: this.tool === 'magnifier',
      pinned: this.magPinned,
      zoom: this.magZoom,
      frozen: this.frozen != null && this.freezeOut === 0,
      compare: this.compare,
      masks: this.masks.length,
      feed: this.feed.live,
      disc: this.magPlaced ? { x: Math.round(this.magCx), y: Math.round(this.magCy) } : null,
    }
  }

  /** Voir ScreenFeed.useTestStream — uniquement pour les tests automatisés. */
  useTestStream(stream: MediaStream): void {
    this.feed.useTestStream(stream)
    this.syncFeedNeed()
    void this.feed.request(true).then(() => this.wake())
  }

  destroy(): void {
    for (const fn of this.detach) fn()
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.feed.destroy()
    this.below.remove()
    this.hud.remove()
    const g = window as unknown as { hexaFx?: FxLayer }
    if (g.hexaFx === this) delete g.hexaFx
  }

  /* ------------------------------------------------------------- entrées */

  private onMove(e: PointerEvent): void {
    // En clic traversant, Electron nous transmet quand même les mouvements :
    // c'est CE qui permet à la loupe de continuer à suivre le curseur pendant
    // que la souris appartient au jeu (§6.5).
    this.px = e.clientX
    this.py = e.clientY
    if (this.drawingMask) {
      const m = this.drawingMask
      m.w = e.clientX - m.x
      m.h = e.clientY - m.y
      e.stopPropagation()
      this.wake()
      return
    }
    if (this.movingMask) {
      const { mask, dx, dy } = this.movingMask
      mask.x = e.clientX - dx
      mask.y = e.clientY - dy
      e.stopPropagation()
      this.wake()
      return
    }
    if (this.compareDrag) {
      this.compareX = clamp(e.clientX / Math.max(1, this.w), 0.02, 0.98)
      e.stopPropagation()
      this.wake()
      return
    }
    if (this.tool === 'magnifier' || this.masks.length > 0 || this.compare) this.wake()
  }

  /**
   * Le geste vise-t-il la scène de dessin ? Nos écouteurs sont en phase de
   * CAPTURE sur window : sans ce garde-fou, un clic sur la barre d'outils qui
   * passerait près de la poignée de l'avant/après serait avalé et le bouton
   * ne réagirait jamais.
   */
  private onStage(e: Event): boolean {
    const t = e.target
    return t instanceof Element && t.closest('.stage') != null
  }

  private onDown(e: PointerEvent): void {
    if (!this.onStage(e)) return
    this.px = e.clientX
    this.py = e.clientY

    // La poignée de l'avant/après passe avant tout le reste.
    if (this.compare && e.button === 0 && Math.abs(e.clientX - this.compareX * this.w) < 26) {
      this.compareDrag = true
      this.claim(e)
      return
    }

    // Clic droit sur un masque : on l'attrape (§5.6). Valable avec n'importe
    // quel outil, exactement comme l'attrapé d'annotation du moteur.
    if (e.button === 2) {
      const hit = this.maskAt(e.clientX, e.clientY)
      if (hit) {
        this.movingMask = { mask: hit, dx: e.clientX - hit.x, dy: e.clientY - hit.y }
        this.claim(e)
        return
      }
    }

    // Suppression d'un masque par sa croix : valable avec l'outil flou ET avec
    // la gomme, où c'est le geste que tout le monde tente en premier.
    if ((this.tool === 'blur' || this.tool === 'eraser') && e.button === 0) {
      const del = this.maskCloseAt(e.clientX, e.clientY)
      if (del) {
        this.masks = this.masks.filter((m) => m !== del)
        this.syncFeedNeed()
        this.notify()
        this.claim(e)
        this.wake()
        return
      }
    }

    if (this.tool === 'blur' && e.button === 0) {
      // on trace un nouveau masque
      this.drawingMask = {
        id: this.maskSeq++,
        x: e.clientX,
        y: e.clientY,
        w: 0,
        h: 0,
        born: performance.now(),
      }
      // Démo navigateur : le partage d'écran ne peut se demander QUE dans un
      // geste utilisateur. Ce clic en est un.
      void this.feed.request(true).then((ok) => this.afterFeed(ok))
      this.claim(e)
      return
    }

    if (this.tool === 'magnifier') {
      void this.feed.request(true).then((ok) => this.afterFeed(ok))
    }
  }

  /**
   * Le flux vient de répondre. S'il a été refusé, on le DIT — l'utilisateur
   * doit comprendre pourquoi son masque est une plaque dépolie plutôt qu'un
   * vrai flou, au lieu de croire que l'application est cassée.
   */
  private afterFeed(ok: boolean): void {
    if (!ok) {
      this.flash(
        this.feed.refusal ??
          'Hexa ne peut pas lire l’écran : les zones masquées restent des plaques dépolies.',
      )
    }
    this.wake()
  }

  private onUp(e: PointerEvent): void {
    if (this.drawingMask) {
      const m = this.drawingMask
      this.drawingMask = null
      // normalisation : on accepte les rectangles tracés dans tous les sens
      const x = Math.min(m.x, m.x + m.w)
      const y = Math.min(m.y, m.y + m.h)
      const w = Math.abs(m.w)
      const h = Math.abs(m.h)
      if (w >= MASK_MIN && h >= MASK_MIN) {
        this.masks.push({ id: m.id, x, y, w, h, born: performance.now() })
        void this.feed.request(true)
      }
      this.syncFeedNeed()
      this.notify()
      this.claim(e)
      this.wake()
      return
    }
    if (this.movingMask) {
      this.movingMask = null
      this.claim(e)
      this.wake()
      return
    }
    if (this.compareDrag) {
      this.compareDrag = false
      this.claim(e)
    }
  }

  private onWheel(e: WheelEvent): void {
    if (this.tool !== 'magnifier' || !this.onStage(e)) return
    // Molette = grossissement 1,5 → 8 (§6). On confisque l'événement : sinon
    // le moteur changerait aussi l'épaisseur du pinceau derrière.
    e.preventDefault()
    e.stopPropagation()
    const next = clamp(this.magZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MAG_ZOOM_MIN, MAG_ZOOM_MAX)
    if (next !== this.magZoom) {
      this.magZoom = next
      this.wake()
    }
  }

  /** Le geste nous appartient : ni le moteur ni l'interface ne doivent le voir. */
  private claim(e: PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  private maskAt(x: number, y: number): FxMask | null {
    for (let i = this.masks.length - 1; i >= 0; i--) {
      const m = this.masks[i]
      if (x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) return m
    }
    return null
  }

  private maskCloseAt(x: number, y: number): FxMask | null {
    for (let i = this.masks.length - 1; i >= 0; i--) {
      const m = this.masks[i]
      const cx = m.x + m.w - MASK_X_R
      const cy = m.y + MASK_X_R
      if ((x - cx) ** 2 + (y - cy) ** 2 <= (MASK_X_R + 4) ** 2) return m
    }
    return null
  }

  /* ------------------------------------------------------------- capture */

  /** Photographie de l'écran : capture native si possible, flux sinon. */
  private async grabStill(): Promise<HTMLCanvasElement | null> {
    const url = await bridge.captureScreen()
    if (url) {
      const img = await this.loadImage(url)
      if (img) {
        const cv = document.createElement('canvas')
        cv.width = img.naturalWidth
        cv.height = img.naturalHeight
        cv.getContext('2d')?.drawImage(img, 0, 0)
        return cv
      }
    }
    // Repli : une image prélevée dans le flux continu (démo navigateur, test).
    const ok = await this.feed.request(true)
    if (!ok) return null
    const v = this.feed.frame
    if (!v) {
      // le flux vient d'ouvrir : on laisse une image arriver
      await new Promise<void>((res) => setTimeout(res, 120))
    }
    const vid = this.feed.frame
    if (!vid) return null
    const cv = document.createElement('canvas')
    cv.width = vid.videoWidth
    cv.height = vid.videoHeight
    cv.getContext('2d')?.drawImage(vid, 0, 0)
    return cv
  }

  private loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((res) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = () => res(null)
      img.src = url
    })
  }

  /** Le flux est-il encore utile ? Sinon on l'éteint pour de bon. */
  private syncFeedNeed(): void {
    const need = this.tool === 'magnifier' || this.tool === 'blur' || this.masks.length > 0
    if (need) this.feed.keepAlive()
    else this.feed.release()
  }

  private flash(message: string): void {
    this.toast.textContent = message
    this.toast.classList.add('on')
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toast.classList.remove('on')
      this.toastTimer = null
    }, 4200)
  }

  /* --------------------------------------------------------------- rendu */

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.w = this.stage.clientWidth || window.innerWidth
    this.h = this.stage.clientHeight || window.innerHeight
    for (const [cv, ctx] of [
      [this.underCv, this.uCtx],
      [this.overCv, this.oCtx],
    ] as [HTMLCanvasElement, CanvasRenderingContext2D][]) {
      cv.width = Math.round(this.w * this.dpr)
      cv.height = Math.round(this.h * this.dpr)
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    }
    this.painted = true
    this.wake()
  }

  private wake(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(this.loop)
  }

  private loop = (): void => {
    this.raf = 0
    const alive = this.render(performance.now())
    if (alive) this.raf = requestAnimationFrame(this.loop)
  }

  /** Une image. Renvoie `true` s'il faut en redemander une autre. */
  private render(now: number): boolean {
    const magOn = this.tool === 'magnifier'
    const frozenAlpha = this.frozenAlpha(now)
    const hasFrozen = frozenAlpha > 0.001
    const hasMasks = this.masks.length > 0 || this.drawingMask != null

    if (!magOn && !hasFrozen && !hasMasks) {
      if (this.painted) {
        this.uCtx.clearRect(0, 0, this.w, this.h)
        this.oCtx.clearRect(0, 0, this.w, this.h)
        this.painted = false
      }
      if (this.frozen && frozenAlpha <= 0.001 && this.freezeOut !== 0) {
        this.frozen = null
        this.freezeOut = 0
      }
      this.emitActivity(false)
      return false
    }

    this.uCtx.clearRect(0, 0, this.w, this.h)
    this.oCtx.clearRect(0, 0, this.w, this.h)
    this.painted = true
    this.emitActivity(true)

    let again = false
    if (hasFrozen) {
      this.paintFrozen(frozenAlpha)
      if (frozenAlpha < 1 || this.freezeOut !== 0) again = true
    }
    if (hasMasks) this.paintMasks(now)
    if (magOn) again = this.paintMagnifier() || again
    if (this.compare && hasFrozen) this.paintCompareHandle()

    // Les masques doivent rester vivants : on se réveille à la prochaine image
    // vidéo décodée, jamais sur une horloge à nous.
    if (this.masks.length > 0 && this.feed.live && !again) {
      this.feed.onNextFrame(() => this.wake())
    }
    return again
  }

  private emitActivity(has: boolean): void {
    if (has === this.lastActivity) return
    this.lastActivity = has
    this.onActivity?.(has)
  }

  /** Opacité courante de l'image gelée (fondu d'entrée puis de sortie). */
  private frozenAlpha(now: number): number {
    if (!this.frozen) return 0
    if (this.freezeOut !== 0) {
      const k = (now - this.freezeOut) / FREEZE_OUT
      return k >= 1 ? 0 : 1 - k
    }
    const k = (now - this.freezeIn) / FREEZE_IN
    return k >= 1 ? 1 : Math.max(0, k)
  }

  /**
   * Image gelée, plein écran, SOUS les annotations. En mode avant/après, elle
   * n'occupe que la partie gauche du curseur : à droite on ne peint rien, donc
   * on voit l'écran RÉEL à travers la fenêtre transparente. Le « direct » est
   * gratuit, c'est la meilleure idée de tout ce fichier.
   */
  private paintFrozen(alpha: number): void {
    const img = this.frozen
    if (!img) return
    const ctx = this.uCtx
    ctx.save()
    ctx.globalAlpha = alpha
    if (this.compare) {
      const cut = this.compareX * this.w
      ctx.beginPath()
      ctx.rect(0, 0, cut, this.h)
      ctx.clip()
    }
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, this.w, this.h)
    ctx.restore()
  }

  /** Poignée du comparateur : ligne verticale + pastille glissante (§5.7). */
  private paintCompareHandle(): void {
    const ctx = this.oCtx
    const x = this.compareX * this.w
    const y = this.h / 2
    ctx.save()
    ctx.strokeStyle = encrePanneau(0.9)
    ctx.lineWidth = 2
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, this.h)
    ctx.stroke()
    ctx.shadowBlur = 22
    ctx.shadowColor = this.accent
    ctx.fillStyle = fondPanneau(0.92)
    ctx.beginPath()
    ctx.arc(x, y, 22, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.strokeStyle = encrePanneau(0.95)
    ctx.lineWidth = 2
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x + s * 4, y - 5)
      ctx.lineTo(x + s * 10, y)
      ctx.lineTo(x + s * 4, y + 5)
      ctx.stroke()
    }
    // Pastilles sombres derrière les mots : à droite du curseur il n'y a RIEN
    // de peint (c'est le direct, on voit l'écran à travers la fenêtre), un
    // texte blanc nu y serait invisible sur un fond clair.
    ctx.font = '600 12px ui-sans-serif, system-ui, "Segoe UI", sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    for (const [mot, dir] of [
      ['AVANT', -1],
      ['APRÈS', 1],
    ] as [string, number][]) {
      const wl = ctx.measureText(mot).width + 18
      const cx = x + dir * (30 + wl / 2)
      roundRect(ctx, cx - wl / 2, y - 11, wl, 22, skin().rayon)
      ctx.fillStyle = fondPanneau(0.86)
      ctx.fill()
      ctx.fillStyle = encrePanneau(0.94)
      ctx.fillText(mot, cx, y)
    }
    ctx.restore()
  }

  /* ---------------------------------------------------------- masques ---- */

  private paintMasks(now: number): void {
    const ctx = this.uCtx
    const src = this.feed.frame
    const scale = this.sourceScale(src)
    const all: FxMask[] = [...this.masks]
    const d = this.drawingMask
    if (d) {
      all.push({
        id: d.id,
        x: Math.min(d.x, d.x + d.w),
        y: Math.min(d.y, d.y + d.h),
        w: Math.abs(d.w),
        h: Math.abs(d.h),
        born: d.born,
      })
    }
    for (const m of all) {
      if (m.w < 2 || m.h < 2) continue
      const grow = Math.min(1, (now - m.born) / 180)
      ctx.save()
      roundRect(ctx, m.x, m.y, m.w, m.h, 12)
      ctx.clip()
      if (src && scale) {
        // §5.6 : on relit la région réelle de l'écran et on la floute nous-mêmes.
        ctx.filter = `blur(${BLUR_PX}px)`
        ctx.drawImage(
          src,
          (m.x - BLUR_PAD) * scale.x,
          (m.y - BLUR_PAD) * scale.y,
          (m.w + BLUR_PAD * 2) * scale.x,
          (m.h + BLUR_PAD * 2) * scale.y,
          m.x - BLUR_PAD,
          m.y - BLUR_PAD,
          m.w + BLUR_PAD * 2,
          m.h + BLUR_PAD * 2,
        )
        ctx.filter = 'none'
        // voile très léger : garantit que rien ne transparaît sur les bords
        ctx.fillStyle = 'rgba(10,14,24,0.16)'
        ctx.fillRect(m.x, m.y, m.w, m.h)
      } else {
        // Aucun flux : plaque dépolie honnête. On ne PEUT pas flouter le
        // bureau sans le lire (voir le piège n°1 en tête de fichier).
        const g = ctx.createLinearGradient(m.x, m.y, m.x, m.y + m.h)
        g.addColorStop(0, fondPanneau(0.94))
        g.addColorStop(1, fondPanneau(0.98))
        ctx.fillStyle = g
        ctx.fillRect(m.x, m.y, m.w, m.h)
        ctx.fillStyle = encrePanneau(0.055)
        for (let i = -m.h; i < m.w; i += 14) {
          ctx.fillRect(m.x + i, m.y, 6, m.h)
        }
      }
      ctx.restore()

      // cadre de la plaque
      ctx.save()
      ctx.globalAlpha = grow
      roundRect(ctx, m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1, skin().rayon)
      ctx.strokeStyle = encrePanneau(0.22)
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }

    // Poignées d'édition. Elles apparaissent avec l'outil masque, mais AUSSI
    // avec la gomme : « comment j'efface un masque ? » est la première question
    // que se pose l'utilisateur, et chercher la croix en repassant par l'outil
    // flou n'est devinable par personne.
    if (this.tool === 'blur' || this.tool === 'eraser') this.paintMaskHandles()
  }

  private paintMaskHandles(): void {
    const ctx = this.oCtx
    ctx.save()
    ctx.font = '600 11px ui-sans-serif, system-ui, "Segoe UI", sans-serif'
    ctx.textBaseline = 'middle'
    for (const m of this.masks) {
      roundRect(ctx, m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1, skin().rayon)
      ctx.strokeStyle = this.accent
      ctx.globalAlpha = 0.75
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 5])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      const cx = m.x + m.w - MASK_X_R
      const cy = m.y + MASK_X_R
      ctx.beginPath()
      ctx.arc(cx, cy, MASK_X_R, 0, TAU)
      ctx.fillStyle = fondPanneau(0.9)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,120,140,0.95)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - 4, cy - 4)
      ctx.lineTo(cx + 4, cy + 4)
      ctx.moveTo(cx + 4, cy - 4)
      ctx.lineTo(cx - 4, cy + 4)
      ctx.strokeStyle = 'rgba(255,200,210,0.95)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.textAlign = 'left'
      ctx.fillStyle = encrePanneau(0.62)
      ctx.fillText('clic droit : déplacer', m.x + 8, m.y + m.h - 12)
    }
    ctx.restore()
  }

  /* ------------------------------------------------------------- loupe --- */

  /** Facteur pixels-de-la-source → pixels CSS de l'écran. */
  private sourceScale(src: FxSource | null): { x: number; y: number } | null {
    if (!src) return null
    const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width
    const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height
    if (!sw || !sh || !this.w || !this.h) return null
    return { x: sw / this.w, y: sh / this.h }
  }

  /**
   * Le disque. Renvoie `true` tant qu'il faut continuer à animer (ressort en
   * mouvement ou flux vivant qui rafraîchit le contenu).
   */
  private paintMagnifier(): boolean {
    const ctx = this.oCtx
    // Une image gelée est une source PARFAITE : elle ne contient pas notre
    // propre disque, donc aucune récursion possible.
    const src: FxSource | null = this.frozen ?? this.feed.frame
    const scale = this.sourceScale(src)

    // Zone source : carré centré sur le point visé (§6), en pixels CSS.
    const srcSide = (MAG_R * 2) / this.magZoom
    const half = srcSide / 2

    if (!this.magPinned) {
      const t = this.discTarget(half)
      if (!this.magPlaced) {
        this.magCx = t.x
        this.magCy = t.y
        this.magVx = 0
        this.magVy = 0
        this.magPlaced = true
      } else {
        // Ressort amorti (§6) : raideur 0,15 · amortissement 0,75.
        this.magVx = (this.magVx + (t.x - this.magCx) * SPRING_K) * SPRING_D
        this.magVy = (this.magVy + (t.y - this.magCy) * SPRING_K) * SPRING_D
        this.magCx += this.magVx
        this.magCy += this.magVy
      }
    }

    const cx = this.magCx
    const cy = this.magCy

    ctx.save()
    // ombre portée + fond opaque (le disque existe même sans flux)
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 34
    ctx.shadowOffsetY = 10
    ctx.beginPath()
    ctx.arc(cx, cy, MAG_R, 0, TAU)
    ctx.fillStyle = fondPanneau(0.92)
    ctx.fill()
    ctx.restore()

    if (src && scale) {
      const sx = (this.px - half) * scale.x
      const sy = (this.py - half) * scale.y
      const sw = srcSide * scale.x
      const sh = srcSide * scale.y
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, MAG_R - 2, 0, TAU)
      ctx.clip()
      // LISSAGE : à ×1,7 le plus-proche-voisin duplique une colonne sur deux
      // et transforme une minimap en escalier. Une loupe optique interpole ;
      // au-delà de ×5 on le coupe, parce que le streamer veut alors voir LE
      // pixel (une pointe de sort, un pixel de HP) et non une bouillie douce.
      const brut = this.magZoom >= 5
      ctx.imageSmoothingEnabled = !brut
      if (!brut) ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, sx, sy, sw, sh, cx - MAG_R, cy - MAG_R, MAG_R * 2, MAG_R * 2)
      ctx.restore()

      // §6.4 — DÉFORMATION OPTIQUE. Sur les 10 derniers pour cent du rayon, une
      // vraie lentille grossit un peu plus fort : sans ça le contenu est coupé
      // net au bord et le disque a l'air d'un trou découpé aux ciseaux. On
      // repeint juste l'anneau extérieur, agrandi de 5 %, en fondu.
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, MAG_R - 2, 0, TAU)
      ctx.arc(cx, cy, MAG_R * 0.9, 0, TAU, true)
      ctx.clip()
      ctx.globalAlpha = 0.85
      ctx.imageSmoothingEnabled = true
      const k = 1.05
      ctx.drawImage(
        src,
        sx,
        sy,
        sw,
        sh,
        cx - MAG_R * k,
        cy - MAG_R * k,
        MAG_R * 2 * k,
        MAG_R * 2 * k,
      )
      ctx.restore()
    } else if (!isElectron) {
      // Le message d'AUTORISATION n'existe que dans la démo navigateur :
      // l'overlay Electron, lui, n'a rien à demander à personne. Il s'affichait
      // pourtant dans l'application, en gros, sur un disque noir, pendant les
      // ~200 ms que met le flux à s'ouvrir — le premier plan de l'outil
      // pédagogique numéro un était un message d'erreur.
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '500 14px ui-sans-serif, system-ui, "Segoe UI", sans-serif'
      ctx.fillStyle = encrePanneau(0.55)
      ctx.fillText(
        this.feed.live ? 'Lecture de l’écran…' : 'Clique pour autoriser la lecture de l’écran',
        cx,
        cy,
      )
      ctx.restore()
    } else {
      // Dans l'application : pas un mot, juste un verre encore vide qui
      // s'anime — le flux arrive dans la fraction de seconde qui suit.
      ctx.save()
      const g = ctx.createRadialGradient(cx - MAG_R * 0.3, cy - MAG_R * 0.3, 0, cx, cy, MAG_R)
      g.addColorStop(0, encrePanneau(0.1))
      g.addColorStop(1, encrePanneau(0.02))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, MAG_R - 2, 0, TAU)
      ctx.fill()
      ctx.restore()
    }

    // halo externe doux + anneau d'accent de 3 px (§6)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, MAG_R - 1.5, 0, TAU)
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 3
    ctx.shadowColor = this.accent
    ctx.shadowBlur = 26
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.arc(cx, cy, MAG_R + 5, 0, TAU)
    ctx.lineWidth = 1
    ctx.strokeStyle = encrePanneau(0.35)
    ctx.stroke()
    ctx.restore()

    // étiquette du grossissement + état figé
    ctx.save()
    ctx.font = '600 12px ui-sans-serif, system-ui, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = `×${this.magZoom.toFixed(1)}${this.magPinned ? '  ·  figée (V)' : ''}`
    const wLab = ctx.measureText(label).width + 20
    roundRect(ctx, cx - wLab / 2, cy + MAG_R - 30, wLab, 22, skin().rayon)
    ctx.fillStyle = fondPanneau(0.82)
    ctx.fill()
    ctx.fillStyle = encrePanneau(0.9)
    ctx.fillText(label, cx, cy + MAG_R - 19)
    ctx.restore()

    // repères d'angle sur la zone visée : on voit CE qui est grossi, sans
    // dessiner un cadre plein (qui se retrouverait lui-même dans le disque)
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 1.5
    const tick = 9
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = this.px + sx * half
        const y = this.py + sy * half
        ctx.beginPath()
        ctx.moveTo(x - sx * tick, y)
        ctx.lineTo(x, y)
        ctx.lineTo(x, y - sy * tick)
        ctx.stroke()
      }
    }
    ctx.restore()

    const moving = Math.abs(this.magVx) > 0.06 || Math.abs(this.magVy) > 0.06
    // On continue tant que quelque chose peut encore changer :
    //   · le ressort n'est pas arrivé
    //   · la source est le flux d'écran (le contenu bouge tout seul) OU n'est
    //     pas encore prête — c'est CE deuxième cas qui compte : sur un écran
    //     parfaitement immobile, la toute première image vidéo peut mettre
    //     une seconde à arriver, et s'arrêter avant reviendrait à afficher
    //     « Lecture de l'écran… » pour toujours.
    // Seul le cas « image gelée + disque posé » s'endort : plus rien ne peut
    // bouger, la boucle s'éteint d'elle-même.
    return moving || this.frozen == null || !this.magPlaced
  }

  /**
   * Position visée du disque : en haut à droite du point, bascule de côté près
   * des bords, et JAMAIS au-dessus du point visé (§6, anti-récursion).
   */
  private discTarget(half: number): { x: number; y: number } {
    const min = MAG_R + half + MAG_GAP
    const diag = min / Math.SQRT2
    const pad = 8
    // ordre de préférence : haut-droite, haut-gauche, bas-droite, bas-gauche
    const cands = [
      { x: this.px + diag, y: this.py - diag },
      { x: this.px - diag, y: this.py - diag },
      { x: this.px + diag, y: this.py + diag },
      { x: this.px - diag, y: this.py + diag },
    ]
    for (const c of cands) {
      if (
        c.x - MAG_R >= pad &&
        c.x + MAG_R <= this.w - pad &&
        c.y - MAG_R >= pad &&
        c.y + MAG_R <= this.h - pad
      ) {
        return c
      }
    }
    // Aucun coin ne tient : on rentre le disque dans l'écran, PUIS on
    // repousse le centre à la distance minimale du point visé — cet ordre est
    // capital, l'inverse rendrait la récursion possible dans les angles.
    const c = cands[0]
    let x = clamp(c.x, MAG_R + pad, Math.max(MAG_R + pad, this.w - MAG_R - pad))
    let y = clamp(c.y, MAG_R + pad, Math.max(MAG_R + pad, this.h - MAG_R - pad))
    const dx = x - this.px
    const dy = y - this.py
    const d = Math.hypot(dx, dy)
    if (d < min) {
      const k = d < 0.001 ? 0 : min / d
      x = d < 0.001 ? this.px + min : this.px + dx * k
      y = d < 0.001 ? this.py : this.py + dy * k
    }
    return { x, y }
  }
}
