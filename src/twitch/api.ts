import { config } from '../config.js';
import { getAccessToken } from './auth.js';

const HELIX = 'https://api.twitch.tv/helix';

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}

async function helix<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(HELIX + path);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'client-id': config.twitch.clientId,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

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
  await helix('/chat/messages', {
    method: 'POST',
    body: { broadcaster_id: broadcasterId, sender_id: senderId, message: message.slice(0, 480) },
  });
}
