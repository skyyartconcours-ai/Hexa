import { config } from '../config.js';
import { getAccessToken } from './auth.js';

const HELIX = config.twitch.helixUrl;

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}

async function helix<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
  retried = false,
): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(HELIX + path);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: init.method ?? 'GET',
    // Un appel pendu gelait subscribeAll() : ni « ready » ni « degraded ».
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${token}`,
      'client-id': config.twitch.clientId,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  // Token revoque ou invalide avant son expiration locale : un refresh, un seul nouvel essai.
  // https://dev.twitch.tv/docs/authentication/refresh-tokens/
  if (response.status === 401 && !retried) {
    await getAccessToken(true);
    return helix<T>(path, init, true);
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twitch ${init.method ?? 'GET'} ${path} -> ${response.status} ${text}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function getUserByLogin(login: string): Promise<TwitchUser | null> {
  const data = await helix<{ data: TwitchUser[] }>('/users', { query: { login } });
  return data.data[0] ?? null;
}

export async function getCurrentUser(): Promise<TwitchUser> {
  const data = await helix<{ data: TwitchUser[] }>('/users');
  const user = data.data[0];
  if (!user) throw new Error('Impossible de recuperer l\'utilisateur du token Twitch.');
  return user;
}

export interface TwitchSubscriber {
  user_id: string;
  user_login: string;
  user_name: string;
  tier: string;
  is_gift: boolean;
  gifter_name: string | null;
}

/**
 * Liste complete des abonnes actuels de la chaine.
 *
 * API officielle, scope `channel:read:subscriptions` — celui qu'on a deja.
 * Attention a ce que ca ne donne PAS : ni les messages, ni l'anciennete
 * d'abonnement. Twitch renvoie qui est abonne, a quel palier, et qui lui a
 * offert son sub. Rien d'autre.
 */
export async function listSubscribers(broadcasterId: string): Promise<TwitchSubscriber[]> {
  const subscribers: TwitchSubscriber[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const query: Record<string, string> = { broadcaster_id: broadcasterId, first: '100' };
    if (cursor) query['after'] = cursor;

    const page = await helix<{
      data: Array<{
        user_id: string;
        user_login: string;
        user_name: string;
        tier: string;
        is_gift: boolean;
        gifter_name?: string;
      }>;
      pagination: { cursor?: string };
    }>('/subscriptions', { query });

    for (const row of page.data) {
      subscribers.push({
        user_id: row.user_id,
        user_login: row.user_login,
        user_name: row.user_name,
        tier: row.tier,
        is_gift: row.is_gift === true,
        gifter_name: row.gifter_name || null,
      });
    }

    cursor = page.pagination?.cursor;
    if (page.data.length === 0) break;
    // Garde-fou : un curseur qui revient ferait boucler (et grossir) sans fin.
    if (cursor && seenCursors.has(cursor)) break;
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return subscribers;
}

export interface TwitchVideo {
  id: string;
  title: string;
  created_at: string;
  duration: string;
}

/** VODs de rediffusion de la chaine, de la plus recente a la plus ancienne. */
export async function listArchiveVideos(userId: string, limit = 100): Promise<TwitchVideo[]> {
  const videos: TwitchVideo[] = [];
  let cursor: string | undefined;

  while (videos.length < limit) {
    const query: Record<string, string> = {
      user_id: userId,
      type: 'archive',
      first: String(Math.min(100, limit - videos.length)),
    };
    if (cursor) query['after'] = cursor;

    const page = await helix<{ data: TwitchVideo[]; pagination: { cursor?: string } }>('/videos', {
      query,
    });
    videos.push(...page.data);

    cursor = page.pagination?.cursor;
    if (!cursor || page.data.length === 0) break;
  }

  return videos;
}

export async function createEventSubSubscription(
  type: string,
  version: string,
  condition: Record<string, string>,
  sessionId: string,
): Promise<void> {
  await helix('/eventsub/subscriptions', {
    method: 'POST',
    body: { type, version, condition, transport: { method: 'websocket', session_id: sessionId } },
  });
}

export async function sendChatMessage(
  broadcasterId: string,
  senderId: string,
  message: string,
): Promise<void> {
  const result = await helix<{
    data?: Array<{ message_id: string; is_sent: boolean; drop_reason?: { code: string; message: string } | null }>;
  }>('/chat/messages', {
    method: 'POST',
    // Par points de code : slice() sur des unites UTF-16 peut couper un emoji en deux.
    body: { broadcaster_id: broadcasterId, sender_id: senderId, message: [...message].slice(0, 480).join('') },
  });
  // Twitch repond 200 meme quand le message est jete (AutoMod, mode du chat...).
  const sent = result?.data?.[0];
  if (sent && !sent.is_sent) {
    throw new Error(`message jete par Twitch (${sent.drop_reason?.code ?? '?'}) : ${sent.drop_reason?.message ?? ''}`);
  }
}
