/**
 * Hexa — émetteur du miroir OBS (brief §10.2).
 *
 * Reçoit à chaque image active le JOURNAL DES CHANGEMENTS du moteur (hook
 * `onMirror`, voir MirrorDelta) et l'émet en JSON typé. Deux transports,
 * choisis tout seuls :
 *
 *  - en overlay Electron : IPC → serveur HTTP/WebSocket local (127.0.0.1) ;
 *  - en démo navigateur : BroadcastChannel, même origine, zéro serveur — la
 *    page obs.html ouverte dans un autre onglet est synchronisée à l'identique.
 *
 * Budget : un balayage toutes les 33 ms au maximum (~30 Hz), jamais un message
 * par point (§13). Quand rien ne bouge, le moteur n'appelle pas ce module :
 * coût nul au repos.
 *
 * ⚠️ TROIS RÈGLES, TOUTES APPRISES D'UNE MESURE.
 *
 * 1. ON NE TRAVAILLE QUE SI QUELQU'UN REGARDE. Le serveur local est allumé
 *    d'usine pour que coller l'adresse dans OBS suffise, mais l'immense
 *    majorité des sessions se déroule SANS source navigateur. `viewers` porte
 *    le nombre de vues RÉELLEMENT connectées, poussé par le processus
 *    principal. À zéro, ce module ne fait plus rien du tout.
 *
 * 2. LE COÛT SUIT LE CHANGEMENT, JAMAIS LA TAILLE DE LA SCÈNE. Le balayage
 *    comparait les dix-huit champs de CHAQUE trait, trente fois par seconde,
 *    même quand rien ne bougeait : 0,13 ms par image à 50 traits, 0,70 ms à
 *    2 000. Un coût qui grimpe avec le remplissage du tableau, c'est-à-dire
 *    avec la durée du direct — exactement ce que décrivent les streamers. Le
 *    moteur dit maintenant ce qu'il a touché ; on ne relit plus que ça. Un
 *    trait terminé, immobile et déjà envoyé n'est PLUS JAMAIS relu.
 *
 * 3. L'ÉTAT COMPLET NE BLOQUE PLUS LA COUCHE ENCRE. Il part à chaque
 *    reconnexion d'une source — donc, avec « désactiver la source quand elle
 *    n'est pas visible », à CHAQUE CHANGEMENT DE SCÈNE OBS. Il s'envoyait d'un
 *    bloc : 139 ms de gel mesurés à 1 600 traits, en plein direct. Il est
 *    maintenant étalé, un petit lot par tour de boucle (voir `pousserLot`), et
 *    le différentiel se tait tant qu'il n'a pas fini (voir `muet`).
 */
import type { MirrorDelta, Stroke } from '../engine/types'
import {
  OBS_BATCH_CHARS,
  OBS_CHANNEL,
  OBS_MAX_MESSAGE,
  type ObsMessage,
  type ObsMode,
  type ObsStrokePhase,
} from './protocol'

/** Fenêtre d'échantillonnage des lots de points. */
const SAMPLE_MS = 33

/**
 * En dessous, on ne découpe plus : un lot minuscule ne réglerait rien et
 * multiplierait les messages. Sert de plancher au repli automatique (voir
 * `refus`).
 */
const LOT_MIN = 40_000

/**
 * Budget de travail d'un tour d'envoi d'état complet, en millisecondes.
 *
 * On enchaîne les lots tant qu'on tient dans ce budget, puis on rend la main à
 * la boucle d'affichage. C'est ce chiffre qui garantit que la couche encre — la
 * seule qui soit à l'antenne — ne saute jamais d'image à cause du miroir.
 */
const LOT_MS = 3

/**
 * Nombre de traits relus par balayage au titre du FILET DE SÉCURITÉ.
 *
 * Le journal du moteur est la source de vérité. Mais si un jour un nouveau
 * chemin de mutation oubliait de le nourrir, la vue OBS afficherait une
 * annotation périmée pour tout le reste du direct, sans que rien ne le signale.
 * On relit donc quatre traits par balayage, en tournant : un coût CONSTANT,
 * indépendant de la scène, et toute divergence rattrapée en quelques secondes.
 * `reparations` doit rester à zéro — les campagnes le vérifient.
 */
const AUDIT = 4

/** On ne se réaligne pas en boucle : au pire une fois toutes les deux secondes. */
const REALIGN_MS = 2000

/**
 * Coût JSON ESTIMÉ d'un trait, en caractères. Volontairement PESSIMISTE : mieux
 * vaut un lot deux fois trop petit qu'un message refusé.
 *
 * On estime au lieu de sérialiser : mesurer pour de vrai voudrait dire
 * `JSON.stringify` chaque trait puis re-sérialiser le lot entier — le double du
 * travail, sur le chemin même qu'on est en train d'alléger. Un point s'écrit
 * `{"x":1234.5678,"y":567.1234,"p":0.5123,"t":123456.789}`, soit une
 * cinquantaine de caractères au pire : compter 64 laisse de la marge.
 */
function coutJson(s: Stroke): number {
  let n = 200 + s.points.length * 64
  if (s.text) n += s.text.length + 16
  if (s.image) n += s.image.length + 16
  return n
}

/**
 * Le trait tel qu'il part sur le fil.
 *
 * ⚠️ `raw` ET `ink` NE SORTENT PAS D'ICI. Ce sont les mémoires d'annulation du
 * moteur — le tracé brut d'une forme redressée (§4.1.5) et l'encre manuscrite
 * d'un mot typographié — et la vue OBS ne s'en sert JAMAIS pour peindre : elle
 * n'a pas de Ctrl+Z. Les laisser partait pourtant à chaque état complet et à
 * chaque mise à jour. Avec les formes intelligentes allumées — une des
 * fonctions les plus utilisées — chaque trait au stylo garde une soixantaine de
 * points bruts pour une dizaine de points affichés : six fois trop d'octets à
 * sérialiser, et ça grossit avec le nombre d'annotations.
 *
 * Une copie n'est faite QUE pour les traits concernés ; tous les autres partent
 * tels quels, sans allocation.
 */
function pourLeFil(s: Stroke): Stroke {
  if (!s.raw && !s.ink) return s
  return { ...s, raw: undefined, ink: undefined }
}

/** Surface Electron ajoutée par le preload — typée ici pour ne pas toucher bridge.ts. */
interface ObsHost {
  obsPublish?: (payload: string) => void
}

function host(): ObsHost | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { hexa?: ObsHost }).hexa
}

/**
 * Empreinte d'un trait déjà envoyé : tout ce qui peut changer SANS ajouter de
 * point (déplacement, redressement, fondu programmé, édition d'un texte…).
 *
 * ⚠️ C'EST UN ENREGISTREMENT DE CHAMPS, PAS UNE CHAÎNE. Comparer les champs un
 * à un donne le même résultat, au bit près, sans allouer quoi que ce soit.
 *
 * Les quatre derniers champs sont les ÉCHÉANCES : elles bougent toutes seules
 * (fondu programmé, dissolution, animation) et souvent pour toute la scène d'un
 * coup. Elles sont donc séparées du reste, pour pouvoir partir en un seul
 * message compact — voir `ObsStrokePhase`.
 */
interface SentInfo {
  len: number
  tool: string
  color: string
  size: number
  done: boolean
  filled: boolean
  x0: number
  y0: number
  xn: number
  yn: number
  text: string
  badge: number
  linkFrom: number
  w: number
  /* --- échéances --- */
  /** -1 quand le champ est absent : jamais de undefined dans la comparaison */
  dieAt: number
  dyingAt: number
  dyingMode: string
  animAt: number
}

/** Arrondi tolérant l'absence, pour comparer des nombres et jamais `undefined`. */
function num(v: number | undefined): number {
  return v == null ? -1 : Math.round(v)
}

/** Le CORPS du trait (géométrie, style, contenu) a-t-il changé ? */
function corpsChange(prev: SentInfo, s: Stroke): boolean {
  const p0 = s.points[0]
  const pn = s.points[s.points.length - 1]
  return (
    prev.len !== s.points.length ||
    prev.tool !== s.tool ||
    prev.color !== s.color ||
    prev.size !== s.size ||
    prev.done !== s.done ||
    prev.filled !== (s.filled === true) ||
    prev.x0 !== (p0 ? p0.x | 0 : 0) ||
    prev.y0 !== (p0 ? p0.y | 0 : 0) ||
    prev.xn !== (pn ? pn.x | 0 : 0) ||
    prev.yn !== (pn ? pn.y | 0 : 0) ||
    prev.text !== (s.text ?? '') ||
    prev.badge !== (s.badge ?? -1) ||
    prev.linkFrom !== (s.linkFrom ?? -1) ||
    prev.w !== (s.w ?? -1)
  )
}

/** Les ÉCHÉANCES du trait (fondu, dissolution, animation) ont-elles changé ? */
function phaseChange(prev: SentInfo, s: Stroke): boolean {
  return (
    prev.dieAt !== num(s.dieAt) ||
    prev.dyingAt !== num(s.dying?.start) ||
    prev.dyingMode !== (s.dying?.mode ?? '') ||
    prev.animAt !== num(s.anim?.start)
  )
}

/** Le trait est-il exactement tel qu'on l'a envoyé ? Aucune allocation. */
function identique(prev: SentInfo, s: Stroke): boolean {
  return !corpsChange(prev, s) && !phaseChange(prev, s)
}

/** Recopie l'état du trait dans l'enregistrement, en place. */
function noter(prev: SentInfo, s: Stroke): void {
  const p0 = s.points[0]
  const pn = s.points[s.points.length - 1]
  prev.len = s.points.length
  prev.tool = s.tool
  prev.color = s.color
  prev.size = s.size
  prev.done = s.done
  prev.filled = s.filled === true
  prev.x0 = p0 ? p0.x | 0 : 0
  prev.y0 = p0 ? p0.y | 0 : 0
  prev.xn = pn ? pn.x | 0 : 0
  prev.yn = pn ? pn.y | 0 : 0
  prev.text = s.text ?? ''
  prev.badge = s.badge ?? -1
  prev.linkFrom = s.linkFrom ?? -1
  prev.w = s.w ?? -1
  prev.dieAt = num(s.dieAt)
  prev.dyingAt = num(s.dying?.start)
  prev.dyingMode = s.dying?.mode ?? ''
  prev.animAt = num(s.anim?.start)
}

/** Enregistrement neuf pour un trait envoyé pour la première fois. */
function empreinte(s: Stroke): SentInfo {
  const info = {
    len: 0,
    tool: '',
    color: '',
    size: 0,
    done: false,
    filled: false,
    x0: 0,
    y0: 0,
    xn: 0,
    yn: 0,
    text: '',
    badge: -1,
    linkFrom: -1,
    w: -1,
    dieAt: -1,
    dyingAt: -1,
    dyingMode: '',
    animAt: -1,
  } as SentInfo
  noter(info, s)
  return info
}

/** Envoi d'état complet en cours, étalé sur plusieurs tours de boucle. */
interface Envoi {
  /** instantané de la scène, pris au départ */
  liste: readonly Stroke[]
  /** prochain trait à envoyer */
  i: number
  /** le premier message est un `state:full` : c'est lui qui remet la vue à zéro */
  premier: boolean
  w: number
  h: number
}

export class ObsLink {
  private enabled = true
  private mode: ObsMode = 'screen'
  /**
   * Nombre de vues OBS connectées au serveur local. `-1` = on ne sait pas
   * encore (le processus principal n'a pas répondu) : on se tait, ce qui est
   * le bon défaut — une vue qui arrive réclame de toute façon l'état complet.
   */
  private viewers = -1
  private channel: BroadcastChannel | null = null
  private sent = new Map<number, SentInfo>()
  /** traits à relire au prochain balayage, accumulés image par image */
  private aRelire = new Map<number, Stroke>()
  /** identifiants sortis de la scène depuis le dernier balayage */
  private aRetirer = new Set<number>()
  /** échéances à regrouper en un seul message, réutilisé : zéro allocation */
  private phases: ObsStrokePhase['items'] = []
  private lastScan = 0
  private lastStrokes: readonly Stroke[] = []
  private lastCurrent: Stroke | null = null
  /** regroupement des demandes d'état complet (voir requestFull) */
  private fullTimer: ReturnType<typeof setTimeout> | null = null
  /** un état complet est demandé mais pas encore parti : le différentiel se tait */
  private attente = false
  /** état complet en cours d'émission, lot par lot */
  private envoi: Envoi | null = null
  /** rendez-vous du prochain lot — une macro-tâche, jamais une boucle */
  private envoiTimer: ReturnType<typeof setTimeout> | null = null
  /** regroupement des changements de résolution */
  private sizeTimer: ReturnType<typeof setTimeout> | null = null
  /** taille visée d'un lot d'état complet — resserrée si le relais refuse */
  private lotMax = OBS_BATCH_CHARS
  /** curseur tournant du filet de sécurité (voir AUDIT) */
  private auditIdx = 0
  /** dernier réalignement complet : on ne s'acharne pas */
  private dernierRealign = 0
  /** divergences rattrapées par le filet de sécurité — doit rester à zéro */
  reparations = 0

  constructor() {
    // La taille de l'écran annoté suit les changements de résolution (le
    // streamer passe en 1080p pour jouer, revient en 1440p…). Un écouteur
    // passif, aucun sondage : le coût au repos reste nul.
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        if (this.sizeTimer != null) return
        this.sizeTimer = setTimeout(() => {
          this.sizeTimer = null
          this.sendViewport()
        }, 250)
      })
    }
    if (typeof BroadcastChannel !== 'undefined' && !host()?.obsPublish) {
      try {
        this.channel = new BroadcastChannel(OBS_CHANNEL)
        // une vue qui vient d'ouvrir demande l'état complet
        this.channel.onmessage = (e: MessageEvent) => {
          if ((e.data as { t?: string } | null)?.t === 'obs:hello') this.requestFull()
        }
      } catch {
        this.channel = null
      }
    }
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return
    this.enabled = on
    if (on) this.requestFull()
    else this.oublier()
  }

  /**
   * Nombre de sources navigateur connectées, poussé par le processus principal
   * (canal `obs-clients`). C'est l'interrupteur général du miroir : à zéro, plus
   * un balayage, plus un clone, plus un message.
   */
  setViewers(count: number): void {
    const n = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0
    if (n === this.viewers) return
    const avant = this.viewers
    this.viewers = n
    // Plus personne : on lâche l'index des traits déjà envoyés. Il est périmé
    // de toute façon, et il pesait un descripteur par annotation de la session.
    if (n === 0) this.oublier()
    // Première vue de la salve : elle doit voir l'écran tel qu'il est MAINTENANT.
    else if (avant <= 0) this.requestFull()
  }

  /** Tout jeter : plus personne ne regarde, rien de ce qu'on retient ne vaut. */
  private oublier(): void {
    this.arreterEnvoi()
    this.attente = false
    this.sent.clear()
    this.aRelire.clear()
    this.aRetirer.clear()
    this.phases.length = 0
  }

  /** Quelqu'un attend-il vraiment nos messages ? */
  private audience(): boolean {
    // Démo navigateur : le BroadcastChannel n'a pas de compteur d'abonnés, et
    // il ne coûte rien (même processus, pas d'IPC). On publie comme avant.
    if (!host()?.obsPublish) return true
    return this.viewers > 0
  }

  setMode(mode: ObsMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.send({ t: 'mode', now: performance.now(), mode })
  }

  /**
   * Appelé par le moteur à chaque image active. Doit rester très bon marché —
   * et surtout : d'un coût qui ne dépend QUE du changement.
   */
  publish(delta: MirrorDelta): void {
    // Deux affectations, jamais davantage tant que personne ne regarde : c'est
    // ce qu'il faut pour pouvoir servir l'état complet à la première connexion.
    this.lastStrokes = delta.strokes
    this.lastCurrent = delta.current
    if (!this.enabled || !this.audience()) return
    // ACCUMULATION. Le moteur vide son journal juste après cet appel, alors que
    // l'on ne balaie qu'à 30 Hz : ce qui a changé pendant les images sautées
    // doit être retenu ici. Coût : le changement lui-même, rien d'autre.
    for (const id of delta.gone) {
      this.aRelire.delete(id)
      this.aRetirer.add(id)
    }
    for (const s of delta.changed) {
      this.aRetirer.delete(s.id)
      this.aRelire.set(s.id, s)
    }
    if (this.muet()) return
    const now = performance.now()
    if (now - this.lastScan < SAMPLE_MS) return
    this.lastScan = now
    this.scan(now)
  }

  /** Un état complet est demandé ou en route : le différentiel n'a rien à dire. */
  private muet(): boolean {
    return this.attente || this.envoi != null
  }

  /**
   * Renvoie tout l'état, mais au plus une fois par salve : quand OBS ouvre une
   * scène, plusieurs sources peuvent se connecter dans la même milliseconde.
   * Une seule copie complète part alors, au lieu de N.
   *
   * ⚠️ LE DIFFÉRENTIEL SE TAIT DÈS MAINTENANT, pas dans 40 ms. Sans cela, le
   * balayage qui tombe dans la fenêtre de regroupement trouve un index vide
   * (il vient d'être lâché faute de spectateur) et réémet toute la scène, UN
   * MESSAGE PAR TRAIT : mesuré à 1 600 traits, 12 994 messages et 139 ms de gel
   * de la couche encre à chaque changement de scène OBS.
   */
  requestFull(): void {
    this.attente = true
    this.arreterEnvoi()
    if (this.fullTimer != null) return
    this.fullTimer = setTimeout(() => {
      this.fullTimer = null
      this.sendFull()
    }, 40)
  }

  /**
   * Renvoie tout l'état : à la connexion d'une vue, ou au réveil du miroir.
   *
   * ⚠️ EN LOTS ÉTALÉS, ET C'EST VITAL. Deux raisons, l'une après l'autre :
   *
   *  - un `state:full` unique dépassait 4 Mo à partir d'environ 51 000 points,
   *    et le relais IPC le jetait SANS UN MOT — la source navigateur restait
   *    vide pour le reste de la session ;
   *  - découpé mais envoyé d'un seul tenant, il bloquait quand même la couche
   *    encre : tous les lots partaient dans la MÊME tâche. 139 ms mesurés à
   *    1 600 traits, à chaque changement de scène OBS, c'est-à-dire À
   *    L'ANTENNE.
   *
   * On prend donc un instantané de la scène, et on l'écoule par petits lots en
   * rendant la main entre chacun (voir `pousserLot`). Ce qui change pendant
   * l'écoulement continue d'être accumulé et part juste après, en différentiel.
   */
  sendFull(): void {
    if (this.fullTimer != null) {
      clearTimeout(this.fullTimer)
      this.fullTimer = null
    }
    this.arreterEnvoi()
    this.attente = false
    if (!this.enabled || !this.audience()) return
    const liste = this.lastCurrent
      ? [...this.lastStrokes, this.lastCurrent]
      : [...this.lastStrokes]
    // L'index repart de zéro : les empreintes sont reposées lot par lot, au
    // moment exact où chaque trait part vraiment sur le fil.
    this.sent.clear()
    // Le différentiel accumulé est périmé : l'instantané le contient déjà.
    this.aRelire.clear()
    this.aRetirer.clear()
    this.phases.length = 0
    const { w, h } = this.viewport()
    this.envoi = { liste, i: 0, premier: true, w, h }
    this.pousserLot()
  }

  /** Coupe net un envoi en cours (nouvelle demande, plus de spectateur…). */
  private arreterEnvoi(): void {
    if (this.envoiTimer != null) {
      clearTimeout(this.envoiTimer)
      this.envoiTimer = null
    }
    this.envoi = null
  }

  /**
   * Écoule l'état complet tant qu'on tient dans le budget de temps, puis rend
   * la main à la boucle d'affichage. Se rappelle tout seul jusqu'à épuisement,
   * et s'arrête : ce n'est pas une boucle permanente, il n'y a rien à éteindre.
   */
  private pousserLot = (): void => {
    this.envoiTimer = null
    const e = this.envoi
    if (!e) return
    if (!this.enabled || !this.audience()) {
      this.envoi = null
      return
    }
    const debut = performance.now()
    let reste = true
    do {
      const lot: Stroke[] = []
      let poids = 0
      while (e.i < e.liste.length) {
        const s = e.liste[e.i]
        const cout = coutJson(s)
        // Un trait seul plus gros que le lot part quand même : le découpage se
        // fait par trait, jamais au milieu de l'un d'eux.
        if (lot.length > 0 && poids + cout > this.lotMax) break
        lot.push(pourLeFil(s))
        this.sent.set(s.id, empreinte(s))
        poids += cout
        e.i++
      }
      reste = e.i < e.liste.length
      if (e.premier) {
        // `premier` garantit qu'un `state:full` part TOUJOURS, même sur une
        // scène vide : c'est lui qui remet la vue à zéro.
        e.premier = false
        this.send({
          t: 'state:full',
          now: performance.now(),
          strokes: lot,
          mode: this.mode,
          w: e.w,
          h: e.h,
          more: reste,
        })
      } else {
        this.send({ t: 'state:more', now: performance.now(), strokes: lot, more: reste })
      }
      // `arreterEnvoi` a pu passer par là (un refus relance tout à zéro).
      if (this.envoi !== e) return
    } while (reste && performance.now() - debut < LOT_MS)
    if (!reste) {
      this.envoi = null
      return
    }
    this.envoiTimer = setTimeout(this.pousserLot, 0)
  }

  /**
   * Le processus principal a REFUSÉ un message (trop gros pour le relais IPC).
   *
   * Autrefois ce refus était muet et définitif. Maintenant il remonte jusqu'ici :
   * on resserre le découpage et on renvoie tout. Le repli est borné par
   * `LOT_MIN` — sans quoi un trait unique et monstrueux ferait tourner la
   * boucle indéfiniment — et il ne relance rien quand il n'y a plus de marge :
   * mieux vaut une vue incomplète qu'un flot de messages perdus.
   */
  refus(taille: number): void {
    if (this.lotMax <= LOT_MIN) {
      // Plus de marge : on le DIT, au lieu de laisser la vue vide sans raison.
      console.warn(
        `[hexa] miroir OBS : message de ${Math.round(taille / 1024)} Ko refusé et ` +
          'indécoupable (un seul trait démesuré) — la vue OBS restera partielle',
      )
      return
    }
    this.lotMax = Math.max(LOT_MIN, Math.floor(this.lotMax / 2))
    console.warn(
      `[hexa] miroir OBS : message de ${Math.round(taille / 1024)} Ko refusé, ` +
        `découpage resserré à ${Math.round(this.lotMax / 1024)} Ko par lot`,
    )
    this.requestFull()
  }

  /** Taille de l'écran annoté, en pixels logiques. */
  private viewport(): { w: number; h: number } {
    if (typeof window === 'undefined') return { w: 0, h: 0 }
    return { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) }
  }

  /** Annonce la taille de l'écran : sans elle, la vue OBS décale tout (§10.2). */
  sendViewport(): void {
    const { w, h } = this.viewport()
    if (!w || !h) return
    this.send({ t: 'viewport', now: performance.now(), w, h })
  }

  /** Tout effacer côté miroir (touche panique). */
  clear(): void {
    this.oublier()
    this.send({ t: 'clear', now: performance.now() })
  }

  /**
   * LE BALAYAGE. Son coût ne dépend QUE de ce qui a changé.
   *
   * Il n'y a plus de parcours de la scène : ni ensemble des traits vus, ni
   * comparaison des dix-huit champs de chaque annotation. Ce qui n'est pas dans
   * le journal du moteur n'est pas relu — jamais.
   */
  private scan(now: number): void {
    // 1. les départs (annulés, dissous, gommés)
    if (this.aRetirer.size > 0) {
      const gone: number[] = []
      for (const id of this.aRetirer) if (this.sent.delete(id)) gone.push(id)
      this.aRetirer.clear()
      if (gone.length > 0) this.send({ t: 'stroke:remove', now, ids: gone })
    }
    // 2. les arrivées et les changements
    if (this.aRelire.size > 0) {
      for (const s of this.aRelire.values()) this.visiter(s, now)
      this.aRelire.clear()
    }
    // 3. le filet de sécurité, à coût constant (voir AUDIT)
    this.auditer(now)
    // 4. toutes les échéances de ce balayage en UN message
    if (this.phases.length > 0) {
      this.send({ t: 'stroke:phase', now, items: this.phases })
      this.phases.length = 0
    }
  }

  /** Un trait signalé comme changé : décider quel message le décrit le mieux. */
  private visiter(s: Stroke, now: number): void {
    const prev = this.sent.get(s.id)
    if (!prev) {
      this.send({ t: 'stroke:add', now, stroke: pourLeFil(s) })
      this.sent.set(s.id, empreinte(s))
      return
    }
    if (!corpsChange(prev, s)) {
      // Le cas de très loin le plus fréquent en direct : le trait n'a pas
      // bougé d'un pixel, seule son échéance a été touchée (fondu programmé,
      // début de dissolution, animation). Quatre champs suffisent.
      if (phaseChange(prev, s)) {
        this.phases.push({ id: s.id, dieAt: s.dieAt, dying: s.dying, anim: s.anim })
        noter(prev, s)
      }
      return
    }
    if (s.points.length > prev.len) {
      // lot de points : seulement la queue depuis le dernier envoi
      const phase = phaseChange(prev, s)
      this.send({
        t: 'stroke:points',
        now,
        id: s.id,
        points: s.points.slice(prev.len),
        done: s.done,
      })
      // Le trait s'allonge ET son échéance a bougé (fin de geste : `done`,
      // `anim` et `dieAt` arrivent ensemble) : les deux partent, sinon la vue
      // garderait l'ancienne date de fondu.
      if (phase) this.phases.push({ id: s.id, dieAt: s.dieAt, dying: s.dying, anim: s.anim })
      noter(prev, s)
      return
    }
    // déplacement, redressement, édition d'un texte… : on renvoie le trait
    this.send({ t: 'stroke:update', now, stroke: pourLeFil(s) })
    noter(prev, s)
  }

  /**
   * FILET DE SÉCURITÉ — coût constant, quelle que soit la scène.
   *
   * Deux vérifications :
   *  - la COMPOSITION, en deux entiers : un ajout ou un départ qui aurait
   *    échappé au journal se voit immédiatement ;
   *  - AUDIT traits relus en tournant : une modification oubliée est rattrapée
   *    en quelques secondes au lieu de rester à l'écran tout le direct.
   *
   * Le réalignement passe par `requestFull`, donc par l'envoi ÉTALÉ : même une
   * divergence ne peut plus geler la couche encre.
   */
  private auditer(now: number): void {
    const n = this.lastStrokes.length
    const vivants = n + (this.lastCurrent ? 1 : 0)
    if (this.sent.size !== vivants) {
      this.realigner(`composition (${this.sent.size} envoyés, ${vivants} vivants)`)
      return
    }
    if (n === 0) return
    for (let k = 0; k < AUDIT; k++) {
      if (this.auditIdx >= n) this.auditIdx = 0
      const s = this.lastStrokes[this.auditIdx++]
      const prev = this.sent.get(s.id)
      if (!prev) {
        this.realigner('trait inconnu ' + s.id)
        return
      }
      if (identique(prev, s)) continue
      this.reparations++
      this.visiter(s, now)
    }
  }

  /** Divergence constatée : on repart d'un état complet, sans s'acharner. */
  private realigner(raison: string): void {
    const now = performance.now()
    if (now - this.dernierRealign < REALIGN_MS) return
    this.dernierRealign = now
    this.reparations++
    console.warn('[hexa] miroir OBS : réalignement complet —', raison)
    this.requestFull()
  }

  private send(msg: ObsMessage): void {
    // Dernier filtre, celui qui garantit qu'AUCUN octet ne part dans le vide.
    // Les rares messages ponctuels perdus ici (mode, taille d'écran, effacement)
    // sont tous reportés dans le prochain `state:full`, envoyé à la connexion.
    if (!this.audience()) return
    const h = host()
    if (h?.obsPublish) {
      try {
        // Pas de `structuredClone` ici : `JSON.stringify` recopie déjà tout, et
        // le message n'est jamais retenu au-delà de cet appel. La copie
        // supplémentaire doublait purement et simplement le coût de l'état
        // complet — celui-là même qui gelait la couche encre.
        const charge = JSON.stringify(msg)
        // Ceinture et bretelles : le relais du processus principal refusera de
        // toute façon, mais on préfère l'apprendre ICI, où l'on sait quoi faire
        // (resserrer le découpage) plutôt que de laisser tomber un message.
        if (charge.length > OBS_MAX_MESSAGE) {
          this.refus(charge.length)
          return
        }
        h.obsPublish(charge)
      } catch {
        /* un miroir qui tombe ne doit jamais gêner le dessin */
      }
      return
    }
    if (this.channel) {
      try {
        // `postMessage` sérialise à l'appel : la vue ne partage jamais nos
        // objets, là non plus il n'y a rien à cloner d'avance.
        this.channel.postMessage(msg)
      } catch {
        /* idem */
      }
    }
  }
}

export const obsLink = new ObsLink()
