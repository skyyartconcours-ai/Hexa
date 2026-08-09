import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createEventSubSubscription } from './api.js';
import { log } from '../log.js';
import type { RoastTrigger } from '../types.js';

const DEFAULT_URL = 'wss://eventsub.wss.twitch.tv/ws';

interface WelcomeMessage {
  metadata: { message_type: string; subscription_type?: string };
  payload: {
    session?: { id: string; keepalive_timeout_seconds: number | null; reconnect_url: string | null };
    event?: Record<string, unknown>;
    subscription?: { type: string };
  };
}

export interface ChatMessageEvent {
  userId: string;
  userLogin: string;
  userName: string;
  text: string;
  /**
   * Mois d'abonnement lus dans le badge, `null` si la personne n'affiche pas
   * de badge d'abonne. Contrairement au reste, ce n'est pas une deduction :
   * c'est le chiffre exact, envoye par Twitch avec chaque message.
   */
  subMonths: number | null;
}

/**
 * Twitch joint a chaque message la liste des badges affiches, et le badge
 * "subscriber" porte dans son champ `info` le nombre EXACT de mois
 * d'abonnement.
 *
 * C'est la seule source officielle et gratuite d'anciennete : aucun endpoint
 * Helix ne l'expose, la liste des abonnes ne la contient pas, et l'evenement
 * de resub ne la donne qu'au moment precis du resub. Ici, un seul message
 * suffit — et il n'y a rien a scraper, la donnee arrive deja dans le payload.
 *
 * Le badge "founder", porte par les premiers abonnes de la chaine, remplace
 * "subscriber" et transporte la meme information.
 */
function readSubMonths(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  for (const badge of raw as Array<{ set_id?: string; info?: string }>) {
    if (badge?.set_id !== 'subscriber' && badge?.set_id !== 'founder') continue;
    const months = Number.parseInt(badge.info ?? '', 10);
    if (Number.isFinite(months) && months > 0) return months;
  }
  return null;
}

/**
 * Client EventSub en transport WebSocket.
 *
 * Choix du WebSocket plutot que du webhook : le webhook impose une URL HTTPS
 * publique (donc un serveur en ligne + certificat). Le WebSocket se contente
 * d'un token utilisateur et fonctionne depuis le PC du streamer, derriere
 * n'importe quelle box. Limite : 3 connexions, 300 souscriptions chacune —
 * largement au-dessus de nos besoins.
 */
export class EventSubClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private keepaliveMs = 30_000;
  private closing = false;
  private reconnectDelayMs = 1000;
  /** Vrai entre un session_reconnect et le welcome de la nouvelle session. */
  private resuming = false;

  constructor(private readonly broadcasterId: string) {
    super();
  }

  start(url: string = DEFAULT_URL): void {
    this.closing = false;
    this.connect(url);
  }

  stop(): void {
    this.closing = true;
    this.clearKeepalive();
    this.socket?.close();
    this.socket = null;
  }

  private connect(url: string): void {
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on('open', () => log.twitch('WebSocket EventSub ouvert.'));

    socket.on('message', (raw) => {
      let message: WelcomeMessage;
      try {
        message = JSON.parse(raw.toString()) as WelcomeMessage;
      } catch {
        return;
      }
      void this.handleMessage(message);
    });

    socket.on('error', (error) => log.error('EventSub :', error.message));

    socket.on('close', (code) => {
      // Sans ce test, la fermeture volontaire de l'ancienne socket apres un
      // session_reconnect declenchait une TROISIEME connexion : deux sockets
      // vivantes, chaque message de chat enregistre deux fois, et le plafond
      // de 3 connexions Twitch atteint au bout de quelques maintenances.
      if (socket !== this.socket) return;
      this.clearKeepalive();
      if (this.closing) return;
      log.warn(`EventSub ferme (code ${code}). Reconnexion dans ${this.reconnectDelayMs} ms.`);
      setTimeout(() => this.connect(DEFAULT_URL), this.reconnectDelayMs);
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    });
  }

  private async handleMessage(message: WelcomeMessage): Promise<void> {
    const type = message.metadata.message_type;

    switch (type) {
      case 'session_welcome': {
        const session = message.payload.session;
        if (!session) return;
        this.reconnectDelayMs = 1000;
        this.keepaliveMs = (session.keepalive_timeout_seconds ?? 30) * 1000;
        this.resetKeepalive();
        // Twitch transfere les souscriptions sur la session de reconnexion :
        // les rejouer ne produirait que des 409 en pleine emission.
        if (this.resuming) {
          this.resuming = false;
          log.twitch('Reconnexion etablie, souscriptions conservees.');
          this.emit('ready');
          break;
        }
        await this.subscribeAll(session.id);
        break;
      }

      case 'session_keepalive':
        this.resetKeepalive();
        break;

      case 'session_reconnect': {
        const nextUrl = message.payload.session?.reconnect_url;
        if (!nextUrl) return;
        log.twitch('Twitch demande une reconnexion, bascule sur la nouvelle URL.');
        const old = this.socket;
        this.resuming = true;
        this.connect(nextUrl);
        // On garde brievement l'ancienne socket : Twitch envoie encore des
        // evenements dessus jusqu'a ce que la nouvelle recoive son welcome.
        // On coupe ses ecouteurs avant de la fermer, sinon elle relance une
        // reconnexion de son cote.
        setTimeout(() => {
          old?.removeAllListeners();
          old?.close();
        }, 10_000);
        break;
      }

      case 'revocation':
        log.error(
          `Souscription revoquee : ${message.payload.subscription?.type}. ` +
            'Token expire ou scope retire — relance `npm run login`.',
        );
        break;

      case 'notification': {
        this.resetKeepalive();
        const subType = message.metadata.subscription_type;
        const event = message.payload.event;
        if (subType && event) this.dispatch(subType, event);
        break;
      }

      default:
        break;
    }
  }

  private async subscribeAll(sessionId: string): Promise<void> {
    const condition = { broadcaster_user_id: this.broadcasterId };
    const chatCondition = { broadcaster_user_id: this.broadcasterId, user_id: this.broadcasterId };

    const wanted: Array<[string, string, Record<string, string>]> = [
      ['channel.subscribe', '1', condition],
      ['channel.subscription.gift', '1', condition],
      ['channel.subscription.message', '1', condition],
      ['channel.chat.message', '1', chatCondition],
    ];

    const failed: string[] = [];
    for (const [type, version, cond] of wanted) {
      try {
        await createEventSubSubscription(type, version, cond, sessionId);
        log.twitch(`Abonne a ${type}`);
      } catch (error) {
        failed.push(type);
        log.error(
          `Souscription ${type} refusee :`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Avant, "ready" partait meme avec 0 souscription sur 4 : l'outil affichait
    // "En ecoute" alors qu'il ne recevrait jamais rien, et le streamer ne le
    // decouvrait qu'en constatant qu'aucun sub ne declenchait de vanne.
    if (failed.length) {
      this.emit('degraded', failed);
      return;
    }
    this.emit('ready');
  }

  private dispatch(subType: string, event: Record<string, unknown>): void {
    const str = (key: string): string => String(event[key] ?? '');
    const num = (key: string): number | undefined => {
      const value = event[key];
      return typeof value === 'number' ? value : undefined;
    };

    switch (subType) {
      case 'channel.chat.message': {
        const nested = event['message'] as { text?: string } | undefined;
        const chat: ChatMessageEvent = {
          userId: str('chatter_user_id'),
          userLogin: str('chatter_user_login'),
          userName: str('chatter_user_name'),
          text: nested?.text ?? '',
          subMonths: readSubMonths(event['badges']),
        };
        if (chat.userId && chat.text) this.emit('chat', chat);
        break;
      }

      case 'channel.subscribe': {
        // is_gift = true -> c'est un receveur de gift, pas un nouvel abonne spontane.
        const isGift = event['is_gift'] === true;
        const trigger: RoastTrigger = {
          type: isGift ? 'gift_recipient' : 'sub',
          userId: str('user_id'),
          userLogin: str('user_login'),
          userName: str('user_name'),
          tier: str('tier'),
        };
        this.emit('sub', trigger);
        break;
      }

      case 'channel.subscription.message': {
        const nested = event['message'] as { text?: string } | undefined;
        const trigger: RoastTrigger = {
          type: 'resub',
          userId: str('user_id'),
          userLogin: str('user_login'),
          userName: str('user_name'),
          tier: str('tier'),
          cumulativeMonths: num('cumulative_months'),
          streakMonths: num('streak_months'),
          message: nested?.text ?? undefined,
        };
        this.emit('sub', trigger);
        break;
      }

      case 'channel.subscription.gift': {
        const anonymous = event['is_anonymous'] === true;
        const trigger: RoastTrigger = {
          type: 'gift',
          userId: anonymous ? 'anonymous' : str('user_id'),
          userLogin: anonymous ? 'anonymous' : str('user_login'),
          userName: anonymous ? 'un anonyme' : str('user_name'),
          tier: str('tier'),
          giftCount: num('total'),
          giftTotal: num('cumulative_total'),
          anonymous,
        };
        this.emit('sub', trigger);
        break;
      }

      default:
        break;
    }
  }

  private resetKeepalive(): void {
    this.clearKeepalive();
    // Twitch garantit un keepalive dans la fenetre annoncee ; au-dela on
    // considere la connexion morte et on relance.
    this.keepaliveTimer = setTimeout(() => {
      log.warn('Pas de keepalive Twitch, reconnexion.');
      this.socket?.terminate();
    }, this.keepaliveMs + 5000);
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }
}

export interface EventSubClient {
  on(event: 'chat', listener: (message: ChatMessageEvent) => void): this;
  on(event: 'sub', listener: (trigger: RoastTrigger) => void): this;
  on(event: 'ready', listener: () => void): this;
  /** Au moins une souscription a echoue : l'outil ne recevra pas tout. */
  on(event: 'degraded', listener: (failed: string[]) => void): this;
  emit(event: 'chat', message: ChatMessageEvent): boolean;
  emit(event: 'sub', trigger: RoastTrigger): boolean;
  emit(event: 'ready'): boolean;
  emit(event: 'degraded', failed: string[]): boolean;
}
