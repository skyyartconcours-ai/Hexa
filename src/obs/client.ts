/**
 * Hexa — client obs-websocket v5 (brief §7.3).
 *
 * Un seul service rendu, mais le bon : EFFACER LES ANNOTATIONS AU CHANGEMENT DE
 * SCÈNE OBS. On passe d'une scène « gameplay » à une scène « caméra » et l'écran
 * est déjà propre, sans y penser, en direct.
 *
 * Règles :
 *  - 100 % optionnel. Hexa doit être parfait SANS OBS (§16.5) : si le serveur
 *    n'est pas là, on se tait et on retente doucement, jamais d'erreur à
 *    l'écran, jamais de blocage ;
 *  - le mot de passe n'est JAMAIS journalisé, ni stocké ailleurs que dans le
 *    store local, ni renvoyé à qui que ce soit — il ne sert qu'à calculer le
 *    condensat d'authentification ;
 *  - reconnexion à intervalles croissants, bornée.
 *
 * Protocole (v5) : Hello (op 0) → Identify (op 1) → Identified (op 2), puis les
 * événements (op 5). L'authentification est
 * base64(sha256(base64(sha256(mot de passe + salt)) + challenge)).
 */
import { sha256Base64 } from './sha256'

export type ObsWsStatus = 'off' | 'connecting' | 'connected' | 'auth' | 'retry' | 'denied'

export interface ObsWsConfig {
  enabled: boolean
  /** hôte, toujours local par défaut */
  host: string
  port: number
  password: string
  /** effacer les annotations au changement de scène */
  clearOnScene: boolean
}

export const OBS_WS_DEFAULTS: Omit<ObsWsConfig, 'enabled' | 'password'> = {
  host: '127.0.0.1',
  port: 4455,
  clearOnScene: true,
}

/** Abonnement aux événements de scènes uniquement (EventSubscription.Scenes). */
const SUB_SCENES = 1 << 2

const BACKOFF = [1000, 2000, 4000, 8000, 15_000]

interface OpMessage {
  op: number
  d: Record<string, unknown>
}

export class ObsWebSocketClient {
  private cfg: ObsWsConfig = { enabled: false, password: '', ...OBS_WS_DEFAULTS }
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private disposed = false
  private state: ObsWsStatus = 'off'
  private sceneName = ''

  /** état de connexion, pour l'indicateur discret des réglages */
  onStatus?: (status: ObsWsStatus, scene: string) => void
  /** changement de scène programme (le nom n'est utilisé que pour l'affichage) */
  onSceneChange?: (scene: string) => void

  get status(): ObsWsStatus {
    return this.state
  }

  get scene(): string {
    return this.sceneName
  }

  /** Applique une configuration. Reconnecte seulement si quelque chose a changé. */
  configure(cfg: ObsWsConfig): void {
    const same =
      cfg.enabled === this.cfg.enabled &&
      cfg.host === this.cfg.host &&
      cfg.port === this.cfg.port &&
      cfg.password === this.cfg.password
    this.cfg = { ...cfg }
    if (same) return
    this.close()
    this.attempt = 0
    if (cfg.enabled) this.connect()
    else this.setStatus('off')
  }

  dispose(): void {
    this.disposed = true
    this.close()
  }

  private setStatus(s: ObsWsStatus): void {
    if (this.state === s) return
    this.state = s
    this.onStatus?.(s, this.sceneName)
  }

  private close(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const sock = this.socket
    this.socket = null
    if (sock) {
      sock.onclose = null
      sock.onerror = null
      sock.onmessage = null
      sock.onopen = null
      try {
        sock.close()
      } catch {
        /* ignore */
      }
    }
  }

  private connect(): void {
    if (this.disposed || !this.cfg.enabled) return
    this.setStatus('connecting')
    let sock: WebSocket
    try {
      sock = new WebSocket(`ws://${this.cfg.host}:${this.cfg.port}`)
    } catch {
      this.scheduleRetry()
      return
    }
    this.socket = sock
    sock.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return
      let msg: OpMessage
      try {
        msg = JSON.parse(e.data) as OpMessage
      } catch {
        return
      }
      void this.handle(msg)
    }
    sock.onclose = (e: CloseEvent) => {
      if (this.socket === sock) this.socket = null
      // 4009 = « AuthenticationFailed » côté obs-websocket v5. Réessayer en
      // boucle avec un mot de passe faux ne sert à rien : on le DIT, et on
      // attend que l'utilisateur corrige (ce qui relance tout seul via
      // configure()). Le mot de passe lui-même n'apparaît nulle part.
      if (e.code === 4009) {
        this.setStatus('denied')
        return
      }
      this.scheduleRetry()
    }
    sock.onerror = () => {
      // rien à journaliser : OBS absent est un cas NORMAL, pas une erreur
    }
  }

  private scheduleRetry(): void {
    if (this.disposed || !this.cfg.enabled || this.timer) return
    this.setStatus('retry')
    const delay = BACKOFF[Math.min(this.attempt++, BACKOFF.length - 1)]
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, delay)
  }

  private send(op: number, d: Record<string, unknown>): void {
    try {
      this.socket?.send(JSON.stringify({ op, d }))
    } catch {
      /* ignore */
    }
  }

  private async handle(msg: OpMessage): Promise<void> {
    if (msg.op === 0) {
      // Hello : on répond Identify, avec le condensat si le serveur l'exige
      const auth = msg.d.authentication as { challenge?: string; salt?: string } | undefined
      const rpcVersion = typeof msg.d.rpcVersion === 'number' ? msg.d.rpcVersion : 1
      const payload: Record<string, unknown> = {
        rpcVersion,
        eventSubscriptions: SUB_SCENES,
      }
      if (auth?.challenge && auth.salt) {
        this.setStatus('auth')
        const secret = await sha256Base64(this.cfg.password + auth.salt)
        payload.authentication = await sha256Base64(secret + auth.challenge)
      }
      this.send(1, payload)
      return
    }
    if (msg.op === 2) {
      this.attempt = 0
      this.setStatus('connected')
      return
    }
    if (msg.op === 5) {
      const type = msg.d.eventType
      if (type === 'CurrentProgramSceneChanged') {
        const data = msg.d.eventData as { sceneName?: string } | undefined
        this.sceneName = typeof data?.sceneName === 'string' ? data.sceneName : ''
        this.onStatus?.(this.state, this.sceneName)
        if (this.cfg.clearOnScene) this.onSceneChange?.(this.sceneName)
      }
    }
  }
}

export const obsWsClient = new ObsWebSocketClient()

/** Libellé lisible de l'état, pour l'indicateur discret. */
export function statusLabel(status: ObsWsStatus): string {
  switch (status) {
    case 'connected':
      return 'connecté'
    case 'connecting':
      return 'connexion…'
    case 'auth':
      return 'authentification…'
    case 'retry':
      return 'hors ligne, nouvelle tentative'
    case 'denied':
      return 'mot de passe refusé par OBS'
    default:
      return 'désactivé'
  }
}
