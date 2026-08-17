/**
 * Hexa — émetteur du miroir OBS (brief §10.2).
 *
 * Reçoit à chaque image active l'état du moteur (hook `onMirror`), calcule le
 * DIFFÉRENTIEL et l'émet en JSON typé. Deux transports, choisis tout seuls :
 *
 *  - en overlay Electron : IPC → serveur HTTP/WebSocket local (127.0.0.1) ;
 *  - en démo navigateur : BroadcastChannel, même origine, zéro serveur — la
 *    page obs.html ouverte dans un autre onglet est synchronisée à l'identique.
 *
 * Budget : un balayage toutes les 33 ms au maximum (~30 Hz), jamais un message
 * par point (§13). Quand rien ne bouge, le moteur n'appelle pas ce module :
 * coût nul au repos.
 *
 * ⚠️ ET SURTOUT : ON NE TRAVAILLE QUE SI QUELQU'UN REGARDE.
 *
 * Le serveur local est allumé d'usine (voir OBS_DEFAULTS) pour que coller
 * l'adresse dans OBS suffise. Mais l'immense majorité des sessions se déroule
 * SANS source navigateur : le streamer a OBS ouvert, il capture son écran, et
 * il n'a jamais ajouté la vue d'Hexa. Le miroir balayait quand même TOUS les
 * traits toutes les 33 ms, en clonait, en sérialisait le JSON et l'envoyait par
 * IPC au processus principal — qui le jetait, faute de destinataire. Mesuré sur
 * une session de 400 traits : 3 761 messages, 877 Kio, cent pour cent perdus, et
 * un coût par image qui grimpe avec le nombre d'annotations puisque le balayage
 * est proportionnel à la scène. C'est exactement la dégradation progressive que
 * décrivent les utilisateurs.
 *
 * `viewers` porte donc le nombre de vues RÉELLEMENT connectées, poussé par le
 * processus principal. À zéro, ce module ne fait plus rien du tout ; à la
 * première connexion, l'état complet part immédiatement (voir ObsBridge).
 */
import type { Stroke } from '../engine/types'
import {
  OBS_BATCH_CHARS,
  OBS_CHANNEL,
  OBS_MAX_MESSAGE,
  type ObsMessage,
  type ObsMode,
} from './protocol'

/** Fenêtre d'échantillonnage des lots de points. */
const SAMPLE_MS = 33

/**
 * En dessous, on ne découpe plus : un lot minuscule ne réglerait rien et
 * multiplierait les messages. Sert de plancher au repli automatique (voir
 * `refus`).
 */
const LOT_MIN = 50_000

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
  if (s.raw) n += s.raw.length * 64
  if (s.ink) for (const k of s.ink) n += 200 + k.points.length * 64
  return n
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
 * ⚠️ C'EST UN ENREGISTREMENT DE CHAMPS, PAS UNE CHAÎNE. La version précédente
 * assemblait un tableau de quatorze cases et le joignait en une chaîne — pour
 * CHAQUE trait de la scène, trente fois par seconde. À trois cents annotations
 * à l'écran, cela faisait neuf mille chaînes jetables par seconde, uniquement
 * pour découvrir que rien n'avait bougé : de la pression sur le ramasse-miettes
 * proportionnelle à la scène, donc une saccade qui s'aggrave à mesure que le
 * tableau se remplit. Comparer les champs un à un donne le MÊME résultat, au
 * bit près, sans allouer quoi que ce soit.
 */
interface SentInfo {
  len: number
  tool: string
  color: string
  size: number
  done: boolean
  filled: boolean
  /** -1 quand le champ est absent : jamais de undefined dans la comparaison */
  dieAt: number
  dyingAt: number
  dyingMode: string
  animAt: number
  x0: number
  y0: number
  xn: number
  yn: number
  text: string
  badge: number
  linkFrom: number
  w: number
}

/** Arrondi tolérant l'absence, pour comparer des nombres et jamais `undefined`. */
function num(v: number | undefined): number {
  return v == null ? -1 : Math.round(v)
}

/** Le trait est-il exactement tel qu'on l'a envoyé ? Aucune allocation. */
function identique(prev: SentInfo, s: Stroke): boolean {
  const p0 = s.points[0]
  const pn = s.points[s.points.length - 1]
  return (
    prev.len === s.points.length &&
    prev.tool === s.tool &&
    prev.color === s.color &&
    prev.size === s.size &&
    prev.done === s.done &&
    prev.filled === (s.filled === true) &&
    prev.dieAt === num(s.dieAt) &&
    prev.dyingAt === num(s.dying?.start) &&
    prev.dyingMode === (s.dying?.mode ?? '') &&
    prev.animAt === num(s.anim?.start) &&
    prev.x0 === (p0 ? p0.x | 0 : 0) &&
    prev.y0 === (p0 ? p0.y | 0 : 0) &&
    prev.xn === (pn ? pn.x | 0 : 0) &&
    prev.yn === (pn ? pn.y | 0 : 0) &&
    prev.text === (s.text ?? '') &&
    prev.badge === (s.badge ?? -1) &&
    prev.linkFrom === (s.linkFrom ?? -1) &&
    prev.w === (s.w ?? -1)
  )
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
  prev.dieAt = num(s.dieAt)
  prev.dyingAt = num(s.dying?.start)
  prev.dyingMode = s.dying?.mode ?? ''
  prev.animAt = num(s.anim?.start)
  prev.x0 = p0 ? p0.x | 0 : 0
  prev.y0 = p0 ? p0.y | 0 : 0
  prev.xn = pn ? pn.x | 0 : 0
  prev.yn = pn ? pn.y | 0 : 0
  prev.text = s.text ?? ''
  prev.badge = s.badge ?? -1
  prev.linkFrom = s.linkFrom ?? -1
  prev.w = s.w ?? -1
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
    dieAt: -1,
    dyingAt: -1,
    dyingMode: '',
    animAt: -1,
    x0: 0,
    y0: 0,
    xn: 0,
    yn: 0,
    text: '',
    badge: -1,
    linkFrom: -1,
    w: -1,
  } as SentInfo
  noter(info, s)
  return info
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
  /** ensemble de travail du balayage, réutilisé : zéro allocation par image */
  private vus = new Set<number>()
  private lastScan = 0
  private lastStrokes: readonly Stroke[] = []
  private lastCurrent: Stroke | null = null
  /** regroupement des demandes d'état complet (voir requestFull) */
  private fullTimer: ReturnType<typeof setTimeout> | null = null
  /** regroupement des changements de résolution */
  private sizeTimer: ReturnType<typeof setTimeout> | null = null
  /** taille visée d'un lot d'état complet — resserrée si le relais refuse */
  private lotMax = OBS_BATCH_CHARS

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
          if ((e.data as { t?: string } | null)?.t === 'obs:hello') this.sendFull()
        }
      } catch {
        this.channel = null
      }
    }
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return
    this.enabled = on
    if (on) this.sendFull()
    else this.sent.clear()
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
    if (n === 0) this.sent.clear()
    // Première vue de la salve : elle doit voir l'écran tel qu'il est MAINTENANT.
    else if (avant <= 0) this.requestFull()
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

  /** Appelé par le moteur à chaque image active. Doit rester très bon marché. */
  publish(strokes: readonly Stroke[], current: Stroke | null): void {
    // Deux affectations, jamais davantage tant que personne ne regarde : c'est
    // ce qu'il faut pour pouvoir servir l'état complet à la première connexion.
    this.lastStrokes = strokes
    this.lastCurrent = current
    if (!this.enabled || !this.audience()) return
    const now = performance.now()
    if (now - this.lastScan < SAMPLE_MS) return
    this.lastScan = now
    this.scan(now)
  }

  /**
   * Renvoie tout l'état, mais au plus une fois par salve : quand OBS ouvre une
   * scène, plusieurs sources peuvent se connecter dans la même milliseconde.
   * Une seule copie complète part alors, au lieu de N.
   */
  requestFull(): void {
    if (this.fullTimer != null) return
    this.fullTimer = setTimeout(() => {
      this.fullTimer = null
      this.sendFull()
    }, 40)
  }

  /**
   * Renvoie tout l'état : à la connexion d'une vue, ou au réveil du miroir.
   *
   * ⚠️ EN LOTS, ET C'EST VITAL. Un `state:full` unique dépassait 4 Mo à partir
   * d'environ 51 000 points — deux mille annotations, soit une heure de fondu
   * infini. Le relais IPC du processus principal jetait alors le message SANS
   * UN MOT, pendant que ce module notait tranquillement dans `sent` que toute la
   * scène était partie : plus rien n'était jamais renvoyé, et la source
   * navigateur du streamer restait vide pour le reste de la session. Découpée,
   * la même scène passe en une poignée de messages dont aucun n'approche la
   * limite. En dessous d'un lot — la quasi-totalité des sessions — le message
   * envoyé est exactement celui d'avant.
   */
  sendFull(): void {
    if (!this.enabled || !this.audience()) return
    const strokes = this.lastCurrent
      ? [...this.lastStrokes, this.lastCurrent]
      : [...this.lastStrokes]
    this.sent.clear()
    for (const s of strokes) this.sent.set(s.id, empreinte(s))
    const { w, h } = this.viewport()
    const now = performance.now()
    let i = 0
    let premier = true
    // `premier` garantit qu'un `state:full` part TOUJOURS, même sur une scène
    // vide : c'est lui qui remet la vue à zéro.
    while (premier || i < strokes.length) {
      const lot: Stroke[] = []
      let poids = 0
      while (i < strokes.length) {
        const cout = coutJson(strokes[i])
        // Un trait seul plus gros que le lot part quand même : le découpage se
        // fait par trait, jamais au milieu de l'un d'eux.
        if (lot.length > 0 && poids + cout > this.lotMax) break
        lot.push(strokes[i])
        poids += cout
        i++
      }
      const reste = i < strokes.length
      if (premier) {
        premier = false
        this.send({
          t: 'state:full',
          now,
          strokes: structuredClone(lot),
          mode: this.mode,
          w,
          h,
          more: reste,
        })
      } else {
        this.send({ t: 'state:more', now, strokes: structuredClone(lot), more: reste })
      }
    }
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
    this.sent.clear()
    this.send({ t: 'clear', now: performance.now() })
  }

  private scan(now: number): void {
    // Ensemble de travail réutilisé d'un balayage à l'autre : trente fois par
    // seconde, un Set jetable de la taille de la scène, c'est encore de la
    // pression sur le ramasse-miettes proportionnelle au nombre d'annotations.
    const seen = this.vus
    seen.clear()
    const visit = (s: Stroke) => {
      seen.add(s.id)
      const prev = this.sent.get(s.id)
      if (!prev) {
        this.send({ t: 'stroke:add', now, stroke: structuredClone(s) })
        this.sent.set(s.id, empreinte(s))
        return
      }
      // Le cas de très loin le plus fréquent : rien n'a bougé sur ce trait-là.
      // Il se règle en quelques comparaisons de champs, sans rien allouer.
      if (identique(prev, s)) return
      if (s.points.length > prev.len) {
        // lot de points : seulement la queue depuis le dernier envoi
        this.send({
          t: 'stroke:points',
          now,
          id: s.id,
          points: s.points.slice(prev.len).map((p) => ({ ...p })),
          done: s.done,
        })
        noter(prev, s)
        return
      }
      // déplacement, redressement, fondu programmé… : on renvoie le trait
      this.send({ t: 'stroke:update', now, stroke: structuredClone(s) })
      noter(prev, s)
    }

    for (const s of this.lastStrokes) visit(s)
    if (this.lastCurrent) visit(this.lastCurrent)

    if (seen.size < this.sent.size) {
      const gone: number[] = []
      for (const id of this.sent.keys()) if (!seen.has(id)) gone.push(id)
      for (const id of gone) this.sent.delete(id)
      if (gone.length > 0) this.send({ t: 'stroke:remove', now, ids: gone })
    }
  }

  private send(msg: ObsMessage): void {
    // Dernier filtre, celui qui garantit qu'AUCUN octet ne part dans le vide.
    // Les rares messages ponctuels perdus ici (mode, taille d'écran, effacement)
    // sont tous reportés dans le prochain `state:full`, envoyé à la connexion.
    if (!this.audience()) return
    const h = host()
    if (h?.obsPublish) {
      try {
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
        this.channel.postMessage(msg)
      } catch {
        /* idem */
      }
    }
  }
}

export const obsLink = new ObsLink()
