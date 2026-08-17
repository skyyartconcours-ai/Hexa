/**
 * Hexa — enregistreur de session (brief §11).
 *
 * Problème à résoudre : le moteur PURGE les traits dissous. Une session live
 * avec fondu automatique ne laisse donc rien derrière elle, et un rejeu de la
 * session courante serait vide. L'enregistreur archive tout ce qu'il a vu
 * passer, avec les horodatages d'origine, afin de pouvoir tout rejouer et tout
 * réexporter en vectoriel des heures après (§11.1 à §11.3).
 *
 * Coût : quasi nul. On garde la RÉFÉRENCE de chaque trait (le moteur le mute en
 * place : points ajoutés, dieAt posé, dissolution démarrée), donc aucune copie
 * par image. On ne clone qu'au moment de l'export.
 *
 * Aucune boucle : l'enregistreur est nourri par le hook `onMirror` du moteur,
 * qui n'est appelé que pendant que la rAF du moteur tourne (§2.5, §13).
 *
 * ⚠️ TROIS RÈGLES, apprises d'une saccade qui empirait d'heure en heure.
 *
 * 1. LE TRAVAIL SUIT LE CHANGEMENT, PAS LA TAILLE. `observe` était appelé
 *    soixante fois par seconde et relisait à chaque fois TOUTE la scène. Un
 *    trait terminé et déjà archivé n'a pourtant plus rien à dire : le relire
 *    trois mille fois par minute ne change pas une virgule de l'archive. On
 *    compare donc d'abord la COMPOSITION (longueur, dernier trait, trait en
 *    cours) : inchangée, on repart aussitôt. Coût par image : trois
 *    comparaisons, quel que soit le nombre d'annotations.
 *
 * 2. UN DÉPART SE CHERCHE PARMI LES VIVANTS, PAS DANS TOUTE L'ARCHIVE. Repérer
 *    le trait qui vient de disparaître coûtait un balayage de l'archive
 *    ENTIÈRE — donc de plus en plus cher à mesure que la session avançait,
 *    alors même que le nombre de traits à l'écran, lui, restait constant. On
 *    tient maintenant l'ensemble des identifiants vivants et on ne compare que
 *    lui : le coût suit l'écran, plus jamais l'ancienneté de la session.
 *
 * 3. L'ARCHIVE EST BORNÉE EN MÉMOIRE, PAS SEULEMENT EN NOMBRE. Un plafond en
 *    nombre de traits ne borne rien : un trait, c'est cinq points ou cinq
 *    cents. Le plafond qui compte est celui des POINTS — voir MAX_POINTS.
 *
 *    Et un plafond ne vaut que par deux choses, toutes deux corrigées après
 *    mesure : il doit COMPTER CE QU'IL RETIENT (le tracé brut d'une forme
 *    redressée et l'encre manuscrite d'un mot pèsent souvent plus lourd que le
 *    trait lui-même — voir `peser`), et il doit MORDRE (sauter les traits encore
 *    à l'écran au lieu d'abandonner devant le premier — voir `borner`). Sans
 *    l'un ou l'autre, il ne se déclenche jamais et la mémoire monte toute la
 *    session : c'est exactement ce qui a été observé.
 */
import type { SessionExport, Stroke } from '../engine/types'
import { coucheSeparee, envoyerCommande, porteEncre, porteInterface } from '../couches'
import { dissolveDuration } from './paint'

/** Au-delà, on oublie les plus vieux traits : une session de stream reste bornée. */
const MAX_STROKES = 6000

/**
 * ET SURTOUT le plafond en POINTS — le seul qui borne vraiment la mémoire.
 *
 * L'archive garde les traits par référence, points compris, et le moteur, lui,
 * les a déjà jetés (fondu automatique). Passé un certain temps, l'enregistreur
 * est donc le SEUL à les retenir : c'est lui qui fait grossir le processus,
 * heure après heure, sans que rien ne redescende jamais.
 *
 * Le plafond en nombre de traits ne borne rien de sûr : un trait, c'est cinq
 * points ou cinq cents. 6000 traits de pinceau bien fournis, c'est déjà de
 * l'ordre de 400 000 points.
 *
 * Un point archivé est un objet de quatre nombres ({x, y, p, t}) : compter
 * 70 à 80 octets pièce, une fois l'en-tête d'objet payé. 200 000 points
 * plafonnent donc l'archive aux alentours de 15 Mo — assez pour des milliers de
 * traits, c'est-à-dire une très longue session annotée, et assez peu pour qu'un
 * overlay qui tourne huit heures d'affilée ne finisse pas par peser plus lourd
 * que ce qu'il annote. Au-delà, les plus anciens traits sortent dans l'ordre où
 * ils sont arrivés, et le nombre d'oubliés est dit honnêtement dans les
 * réglages : un rejeu tronqué qui s'annonce vaut mieux qu'un direct qui saccade.
 */
const MAX_POINTS = 200_000

interface Entry {
  s: Stroke
  /** instant où le trait a quitté le moteur SANS se dissoudre (undo) */
  gone?: number
  /**
   * Points comptés dans le budget mémoire, figés à l'entrée dans l'archive.
   * On garde le chiffre RETENU plutôt que de relire `s.points.length` à la
   * sortie : un trait redressé par les formes intelligentes change de nombre de
   * points en cours de route, et le compteur dériverait à chaque redressement —
   * exactement le genre de fuite lente qu'on est en train de corriger.
   */
  pts?: number
}

/**
 * POIDS RÉEL d'un trait archivé, en points.
 *
 * ⚠️ NE PAS SE CONTENTER DE `points`. Un budget qui ne compte pas ce qu'il
 * retient ne borne rien du tout :
 *
 *  - une forme intelligente garde le tracé BRUT dans `raw` pour que le premier
 *    Ctrl+Z le restitue (§4.1.5) : trois points affichés, soixante retenus ;
 *  - un mot du mode écriture garde toute l'encre manuscrite d'origine dans
 *    `ink` pour rejouer le morph à l'envers : un point affiché, des centaines
 *    retenus.
 *
 * Mesuré avant correction : une forme redressée et un mot manuscrit étaient
 * facturés 4 points à eux deux alors que 424 étaient réellement gardés en
 * mémoire — un facteur cent six. Le plafond mordait donc cent fois trop tard,
 * c'est-à-dire jamais.
 */
function peser(s: Stroke): number {
  let n = s.points.length + (s.raw?.length ?? 0)
  if (s.ink) for (const k of s.ink) n += k.points.length
  return n
}

export class SessionRecorder {
  private entries = new Map<number, Entry>()
  private listeners = new Set<() => void>()
  private notifyQueued = false
  /** dernier compte notifié : évite de notifier pour rien */
  private lastCount = 0
  private lastForgotten = 0

  /* --- composition observée à l'appel précédent (le filtre d'entrée) ----- */
  private prevLen = -1
  private prevTail: Stroke | null = null
  private prevCurrent: Stroke | null = null

  /* --- identifiants présents dans le moteur, pour repérer les départs ---- */
  private vivants = new Set<number>()
  /** second ensemble réutilisé en alternance : zéro allocation par balayage */
  private tampon = new Set<number>()

  /** points archivés — c'est la mémoire, et c'est elle qu'on plafonne */
  private points = 0
  /** dernière entrée archivée, encore susceptible de grossir (tracé en cours) */
  private enCours: Entry | null = null
  /** traits sortis de l'archive faute de place — dit tel quel dans l'interface */
  private oubliesCount = 0

  /**
   * Appelé par le moteur à chaque image active.
   *
   * Le cas de très loin le plus fréquent — on dessine, la scène ne change pas
   * de composition — sort ici en trois comparaisons.
   */
  observe(strokes: readonly Stroke[], current: Stroke | null): void {
    const len = strokes.length
    const tail = len > 0 ? strokes[len - 1] : null
    if (len === this.prevLen && tail === this.prevTail && current === this.prevCurrent) return
    this.prevLen = len
    this.prevTail = tail
    this.prevCurrent = current

    // Ce qui est présent MAINTENANT, dans l'ensemble de réserve (pas d'allocation).
    const present = this.tampon
    present.clear()
    for (const s of strokes) {
      present.add(s.id)
      this.remember(s)
    }
    if (current) {
      present.add(current.id)
      this.remember(current)
    }

    // Un trait a disparu de la liste du moteur ? Deux cas :
    //  - il s'était mis à mourir (fondu, touche panique) → l'archive garde son
    //    `dying`, le rejeu montrera la dissolution telle qu'elle a eu lieu ;
    //  - il a été annulé (Ctrl+Z) → on note l'instant, le rejeu le fera
    //    disparaître d'un pop à ce moment précis.
    // On ne compare qu'aux VIVANTS d'hier : le coût suit l'écran, jamais l'archive.
    let now = 0
    for (const id of this.vivants) {
      if (present.has(id)) continue
      const e = this.entries.get(id)
      if (!e) continue
      // Dissous tout seul, puis purgé par le moteur : plus rien ne peut le
      // ramener, donc plus rien ne peut réclamer son tracé brut.
      if (e.s.dying?.cause === 'fade') this.purgerRaw(e)
      if (e.gone != null || e.s.dying) continue
      if (now === 0) now = performance.now()
      e.gone = now
    }
    this.tampon = this.vivants
    this.vivants = present
    // Le budget vient peut-être de se libérer, et surtout : des traits jusque-là
    // vivants ne le sont plus, donc oubliables. C'est ICI que le plafond mord
    // vraiment sur une session en fondu infini.
    this.borner()

    // L'archive pleine se stabilise en nombre tout en continuant d'oublier :
    // sans ce second témoin, le compteur des réglages figerait sur un chiffre
    // rond en laissant croire que plus rien ne bouge.
    if (this.entries.size !== this.lastCount || this.oubliesCount !== this.lastForgotten) {
      this.lastCount = this.entries.size
      this.lastForgotten = this.oubliesCount
      this.queueNotify()
    }
  }

  private remember(s: Stroke): void {
    const e = this.entries.get(s.id)
    if (e) {
      // réapparition (Ctrl+Y) : le trait est revenu, il n'est plus « parti »
      if (e.gone != null) e.gone = undefined
      return
    }
    // Le trait archivé juste avant a fini de grossir : on peut enfin compter
    // ses points pour de bon. (Un budget mémoire, pas une comptabilité : le
    // seul trait jamais compté est celui qu'on est en train de tracer.)
    this.solder()
    const entree: Entry = { s }
    this.entries.set(s.id, entree)
    this.enCours = entree
    this.borner()
  }

  /** Fige le poids du dernier trait archivé dans le budget. */
  private solder(): void {
    const e = this.enCours
    if (!e) return
    this.enCours = null
    e.pts = peser(e.s)
    this.points += e.pts
  }

  /** L'archive dépasse-t-elle l'une de ses bornes ? */
  private deborde(): boolean {
    return this.entries.size > MAX_STROKES || this.points > MAX_POINTS
  }

  /**
   * Fait sortir les plus anciens tant que l'archive dépasse ses bornes.
   *
   * ⚠️ ON SAUTE LES VIVANTS, ON N'ABANDONNE PAS DEVANT EUX. La version
   * précédente sortait de la fonction dès que le plus ancien trait était encore
   * à l'écran — un seul suffisait, et en fondu infini c'est systématique : le
   * plafond ne mordait alors PLUS JAMAIS de toute la session. Mesuré : trois
   * mille entrées pour trois cent mille points, plafond à deux cent mille, zéro
   * trait oublié ; puis trois mille six cents entrées, toujours zéro.
   *
   * On n'évince toujours aucun trait vivant — le moteur le retient de toute
   * façon, l'oublier ne libérerait pas un octet et le balayage suivant le
   * ré-archiverait aussitôt — mais on continue simplement vers le suivant. Un
   * parcours, du plus ancien au plus récent, qui s'arrête quand le budget est
   * revenu sous ses bornes ou qu'il n'y a plus rien à oublier (scène entièrement
   * vivante : c'est le moteur qui la porte, pas nous).
   */
  private borner(): void {
    if (!this.deborde()) return
    const parcours = this.entries.keys()
    while (this.deborde()) {
      const suivant = parcours.next()
      if (suivant.done) return
      const id = suivant.value
      if (this.vivants.has(id)) continue
      const partant = this.entries.get(id)
      this.entries.delete(id)
      if (partant) {
        this.points -= partant.pts ?? 0
        if (partant === this.enCours) this.enCours = null
      }
      if (this.points < 0) this.points = 0
      this.oubliesCount++
    }
  }

  /**
   * Le tracé brut d'une forme redressée, quand plus personne ne peut le rendre.
   *
   * `raw` n'existe que pour un usage : le premier Ctrl+Z après un redressement
   * restitue le geste d'origine (§4.1.5). Or l'annulation ne parcourt que les
   * traits ENCORE DANS LE MOTEUR, et le rattrapage du fondu non plus. Un trait
   * qui s'est dissous tout seul et que le moteur a purgé ne reviendra donc
   * jamais : son tracé brut ne sert plus à rien, et il pèse souvent plus lourd
   * que la forme elle-même. L'archive le lâche, et rend les points au budget.
   *
   * On ne touche à RIEN d'autre : un trait emporté par la gomme ou par la touche
   * panique reste restituable (le moteur en garde les derniers lots), et un
   * trait annulé revient tel quel au Ctrl+Y.
   */
  private purgerRaw(e: Entry): void {
    const raw = e.s.raw
    if (!raw) return
    e.s.raw = undefined
    if (e.pts == null) return
    e.pts -= raw.length
    this.points -= raw.length
    if (this.points < 0) this.points = 0
  }

  /** Nombre de traits archivés (affiché dans les réglages). */
  get count(): number {
    return this.entries.size
  }

  /**
   * Traits sortis de l'archive faute de place. L'interface le dit : sur une
   * très longue session, « toute la session » ne peut pas vouloir dire
   * « depuis le lancement » sans mentir.
   */
  get oublies(): number {
    return this.oubliesCount
  }

  /** Fenêtre temporelle couverte, en ms d'horloge `performance.now()`. */
  span(): { start: number; end: number } | null {
    let start = Infinity
    let end = -Infinity
    for (const { s, gone } of this.entries.values()) {
      start = Math.min(start, s.startedAt, s.points[0]?.t ?? s.startedAt)
      const last = s.points[s.points.length - 1]?.t ?? s.endedAt ?? s.startedAt
      let e = Math.max(s.endedAt ?? last, last)
      if (s.dying) e = Math.max(e, s.dying.start + s.dying.duration)
      else if (s.dieAt != null) e = Math.max(e, s.dieAt + dissolveDuration(s))
      if (gone != null) e = Math.max(e, gone + 200)
      end = Math.max(end, e)
    }
    if (!Number.isFinite(start)) return null
    return { start, end }
  }

  /** Durée rejouable en millisecondes. */
  get duration(): number {
    const s = this.span()
    return s ? Math.max(0, s.end - s.start) : 0
  }

  /**
   * Session complète, prête à rejouer ou exporter. Les traits annulés portent
   * un `dying` de type « pop » posé à l'instant de leur annulation : le rejeu
   * est fidèle à ce que le spectateur a vu.
   */
  session(): SessionExport {
    const out: Stroke[] = []
    for (const { s, gone } of this.entries.values()) {
      if (s.points.length === 0) continue
      const clone = structuredClone(s)
      if (gone != null && !clone.dying) {
        clone.dying = { start: gone, duration: 200, mode: 'pop' }
      }
      out.push(clone)
    }
    out.sort((a, b) => a.startedAt - b.startedAt)
    return { app: 'hexa', version: 1, exportedAt: new Date().toISOString(), strokes: out }
  }

  /** Session « à plat » : tout est vivant et terminé (export PNG, §11.2). */
  flatSession(): SessionExport {
    const s = this.session()
    for (const st of s.strokes) {
      st.dying = undefined
      st.anim = undefined
      st.dieAt = undefined
      st.done = true
    }
    return s
  }

  reset(): void {
    this.entries.clear()
    this.vivants.clear()
    this.tampon.clear()
    this.prevLen = -1
    this.prevTail = null
    this.prevCurrent = null
    this.points = 0
    this.enCours = null
    this.oubliesCount = 0
    this.lastCount = 0
    this.lastForgotten = 0
    this.queueNotify()
  }

  /** Abonnement pour l'interface (compteur de traits), sans le moindre sondage. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Une seule notification par micro-tâche, même si l'archive bouge 60 fois/s. */
  private queueNotify(): void {
    if (this.notifyQueued || this.listeners.size === 0) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const cb of this.listeners) cb()
    })
  }
}

/** Instance unique : l'app n'a qu'un moteur. */
export const recorder = new SessionRecorder()

/* ------------------------------------------------------------------ *
 * Session mise en file d'attente pour le rejeu.
 * Permet aux réglages de dire « rejoue CE fichier » sans que l'App ait à
 * transporter l'objet : la barre de rejeu vient le chercher à son montage.
 * ------------------------------------------------------------------ */

let queued: SessionExport | null = null

export function queueReplay(session: SessionExport | null): void {
  queued = session
  /**
   * §S11 — la barre de rejeu et l'enregistreur vivent avec le MOTEUR, dans la
   * couche encre : un rejeu se regarde, donc il doit passer à l'antenne comme
   * n'importe quelle annotation. Quand la demande vient du panneau de réglages,
   * qui est dans l'autre fenêtre, on transmet la session AVANT que l'ouverture
   * de la barre ne soit diffusée — l'ordre des messages est garanti, donc la
   * barre trouve bien son fichier en arrivant.
   */
  if (coucheSeparee && porteInterface && !porteEncre && session) {
    envoyerCommande({ nom: 'replay-queue', session })
  }
}

/** Récupère (et consomme) la session en attente, sinon null. */
export function takeQueuedReplay(): SessionExport | null {
  const s = queued
  queued = null
  return s
}
