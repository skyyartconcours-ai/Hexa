import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { config } from '../config.js';
import { createEventSubSubscription } from './api.js';
import { log } from '../log.js';
import type { RoastTrigger } from '../types.js';

const DEFAULT_URL = config.twitch.eventsubUrl;

interface WelcomeMessage {
  metadata: { message_id?: string; message_type: string; subscription_type?: string };
  payload: {
    session?: { id: string; keepalive_timeout_seconds: number | null; reconnect_url: string | null };
    event?: Record<string, unknown>;
    subscription?: { type: string; status?: string };
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
  /** Shared Chat : chaine d'origine du message, null s'il a ete ecrit ici. */
  sourceBroadcasterId: string | null;
  /** Identifiant Twitch du message, pour l'effacer si un modo le supprime. */
  messageId: string;
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
/**
 * Le message d'un cheer contient les cheermotes eux-memes ("Cheer100 gg
 * PogChamp500"). Lus a voix haute par le modele, ca donne "cheer cent" en
 * plein milieu de la vanne. Un cheermote est toujours un prefixe alphabetique
 * colle a un nombre : on retire ces jetons-la et rien d'autre.
 */
function stripCheermotes(message: string): string {
  return message
    .split(/\s+/)
    .filter((token) => !/^[A-Za-z]+\d+$/.test(token))
    .join(' ')
    .trim();
}

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
  /** Ancienne socket apres un session_reconnect : fermee au welcome de la nouvelle. */
  private previous: WebSocket | null = null;
  private sessionId: string | null = null;
  /** Types reellement actifs sur la chaine de sessions en cours (reprises comprises). */
  private readonly active = new Set<string>();
  /** Twitch livre "au moins une fois" : meme message_id = meme evenement. */
  private readonly seen = new Map<string, number>();

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
    // Pas de welcome dans ce delai = connexion morte (sinon on attend sans fin).
    this.keepaliveMs = 10_000;
    this.resetKeepalive();

    socket.on('open', () => log.twitch('WebSocket EventSub ouvert.'));

    socket.on('message', (raw) => {
      let message: WelcomeMessage;
      try {
        message = JSON.parse(raw.toString()) as WelcomeMessage;
      } catch {
        return;
      }
      // Un auditeur qui leve (base verrouillee par un autre programme, disque plein)
      // devenait une promesse rejetee non geree : Node tuait tout le process en direct.
      this.handleMessage(message).catch((error: unknown) => {
        log.error('EventSub : evenement non traite :', error instanceof Error ? error.message : error);
      });
    });

    socket.on('error', (error) => log.error('EventSub :', error.message));

    socket.on('close', (code) => {
      // Sans ce test, la fermeture volontaire de l'ancienne socket apres un
      // session_reconnect declenchait une TROISIEME connexion : deux sockets
      // vivantes, chaque message de chat enregistre deux fois, et le plafond
      // de 3 connexions Twitch atteint au bout de quelques maintenances.
      if (socket !== this.socket) return;
      this.clearKeepalive();
      this.sessionId = null;
      this.active.clear();
      // La socket de reprise est morte avant son welcome : la prochaine session
      // est NEUVE et n'a aucune souscription. Sans cette ligne, elle se croyait
      // reprise, n'abonnait rien, annoncait "ready" et Twitch la fermait en 4003.
      this.resuming = false;
      this.retirePrevious();
      if (this.closing) return;
      // Pendant la coupure, les subs ne sont PAS recus (Twitch ne rejoue rien) :
      // la regie doit le savoir, pas seulement le terminal.
      this.emit('down');
      log.warn(`EventSub ferme (code ${code}). Reconnexion dans ${this.reconnectDelayMs} ms.`);
      setTimeout(() => {
        if (!this.closing) this.connect(DEFAULT_URL);
      }, this.reconnectDelayMs);
      // Plafond court : apres une coupure reseau, chaque seconde d'attente est une
      // seconde de subs perdus (30 s de plafond = jusqu'a 30 s de trou en plus).
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 5_000);
    });
  }

  private async handleMessage(message: WelcomeMessage): Promise<void> {
    const type = message.metadata.message_type;

    switch (type) {
      case 'session_welcome': {
        const session = message.payload.session;
        if (!session) return;
        this.reconnectDelayMs = 1000;
        this.sessionId = session.id;
        this.keepaliveMs = (session.keepalive_timeout_seconds ?? 10) * 1000;
        this.resetKeepalive();
        // Twitch transfere les souscriptions sur la session de reconnexion :
        // les rejouer ne produirait que des 409 en pleine emission.
        if (this.resuming) {
          this.resuming = false;
          // Doc Twitch : ne fermer l'ancienne connexion qu'apres ce welcome.
          this.retirePrevious();
          log.twitch('Reconnexion etablie, souscriptions conservees.');
          // Complete ce qui manquait encore (echec en cours de reessai, revocation).
          await this.subscribeAll(session.id);
          break;
        }
        this.active.clear();
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
        // L'ancienne socket continue de recevoir les evenements jusqu'au welcome
        // de la nouvelle : on la garde ouverte jusque-la (voir session_welcome).
        this.retirePrevious();
        this.previous = this.socket;
        this.resuming = true;
        this.connect(nextUrl);
        break;
      }

      case 'revocation': {
        const revokedType = message.payload.subscription?.type ?? 'inconnue';
        log.error(
          `Souscription revoquee : ${revokedType} (${message.payload.subscription?.status}). ` +
            'Autorisation retiree ou compte modifie — relance `npm run login`.',
        );
        // Sans ca la regie reste au vert alors que ce type d'evenement n'arrivera plus.
        this.active.delete(revokedType);
        this.emit('degraded', [revokedType]);
        if (this.sessionId) void this.subscribeAll(this.sessionId);
        break;
      }

      case 'notification': {
        this.resetKeepalive();
        const messageId = message.metadata.message_id;
        if (messageId) {
          if (this.seen.has(messageId)) return;
          this.seen.set(messageId, Date.now());
          if (this.seen.size > 2000) {
            for (const [id] of this.seen) {
              this.seen.delete(id);
              if (this.seen.size <= 1000) break;
            }
          }
        }
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
      ['channel.cheer', '1', condition],
      ['channel.chat.message', '1', chatCondition],
      // Seule source qui relie un receveur de gift a son donateur (meme scope user:read:chat).
      ['channel.chat.notification', '1', chatCondition],
      // Moderation : un message supprime ou un ban/timeout ne doit pas finir dans une vanne.
      ['channel.chat.message_delete', '1', chatCondition],
      ['channel.chat.clear_user_messages', '1', chatCondition],
    ];

    let pending = wanted.filter(([type]) => !this.active.has(type));
    let failed: string[] = [];
    for (let attempt = 1; attempt <= 3 && pending.length; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      // La session a pu mourir pendant l'attente : la suivante refera tout.
      if (this.sessionId !== sessionId) return;
      const retry: typeof wanted = [];
      for (const entry of pending) {
        const [type, version, cond] = entry;
        try {
          await createEventSubSubscription(type, version, cond, sessionId);
          this.active.add(type);
          log.twitch(`Abonne a ${type}`);
        } catch (error) {
          // 409 = deja abonne sur cette session : c'est un succes.
          if (error instanceof Error && / -> 409 /.test(error.message)) {
            this.active.add(type);
            continue;
          }
          retry.push(entry);
          log.error(
            `Souscription ${type} refusee (essai ${attempt}/3) :`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      pending = retry;
    }
    failed = pending.map(([type]) => type);
    if (this.sessionId !== sessionId) return;

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
          sourceBroadcasterId: event['source_broadcaster_user_id'] ? String(event['source_broadcaster_user_id']) : null,
          messageId: str('message_id'),
        };
        if (chat.userId && chat.text) this.emit('chat', chat);
        break;
      }

      case 'channel.chat.message_delete':
        this.emit('moderation', { userId: str('target_user_id'), messageId: str('message_id') });
        break;

      case 'channel.chat.clear_user_messages':
        this.emit('moderation', { userId: str('target_user_id'), messageId: null });
        break;

      case 'channel.chat.notification': {
        // notice_type "sub_gift" : un par receveur, avec le donateur (chatter_*)
        // et le receveur dans le MEME evenement. "shared_chat_sub_gift" = autre chaine.
        if (event['notice_type'] !== 'sub_gift') break;
        const gift = event['sub_gift'] as
          | { recipient_user_id?: string; recipient_user_login?: string; recipient_user_name?: string; sub_tier?: string }
          | null;
        if (!gift?.recipient_user_id) break;
        const anonymousGifter = event['chatter_is_anonymous'] === true;
        this.emit('sub', {
          type: 'gift_recipient',
          userId: gift.recipient_user_id,
          userLogin: gift.recipient_user_login ?? '',
          userName: gift.recipient_user_name ?? '',
          tier: gift.sub_tier,
          gifterName: anonymousGifter ? undefined : str('chatter_user_name') || undefined,
        });
        break;
      }

      case 'channel.subscribe': {
        // is_gift = true -> receveur de gift : traite via channel.chat.notification
        // (sub_gift), qui porte aussi le donateur. Ici on ne le sait pas.
        if (event['is_gift'] === true) break;
        const trigger: RoastTrigger = {
          type: 'sub',
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
          // Un resub partage sans texte arrive avec text = "" : pas de message.
          message: nested?.text || undefined,
        };
        this.emit('sub', trigger);
        break;
      }

      case 'channel.cheer': {
        const anonymous = event['is_anonymous'] === true;
        const trigger: RoastTrigger = {
          type: 'cheer',
          userId: anonymous ? 'anonymous' : str('user_id'),
          userLogin: anonymous ? 'anonymous' : str('user_login'),
          userName: anonymous ? 'un anonyme' : str('user_name'),
          bits: num('bits'),
          message: stripCheermotes(str('message')) || undefined,
          anonymous,
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

  /** Ferme l'ancienne socket sans qu'elle puisse relancer une reconnexion ni lever d'erreur orpheline. */
  private retirePrevious(): void {
    const old = this.previous;
    this.previous = null;
    if (!old) return;
    old.removeAllListeners();
    old.on('error', () => {});
    old.close();
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
  /** Message supprime (messageId) ou tous ceux d'un banni / timeout (messageId null). */
  on(event: 'moderation', listener: (m: { userId: string; messageId: string | null }) => void): this;
  /** Au moins une souscription a echoue : l'outil ne recevra pas tout. */
  on(event: 'degraded', listener: (failed: string[]) => void): this;
  /** Connexion perdue, reconnexion en cours : aucun evenement recu d'ici la. */
  on(event: 'down', listener: () => void): this;
  emit(event: 'chat', message: ChatMessageEvent): boolean;
  emit(event: 'sub', trigger: RoastTrigger): boolean;
  emit(event: 'ready'): boolean;
  emit(event: 'moderation', m: { userId: string; messageId: string | null }): boolean;
  emit(event: 'degraded', failed: string[]): boolean;
  emit(event: 'down'): boolean;
}
