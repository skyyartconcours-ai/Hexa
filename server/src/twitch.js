import { getKv, setKv } from './db.js';
import { signExtJwt } from './extjwt.js';

const HELIX = 'https://api.twitch.tv/helix';
const OAUTH = 'https://id.twitch.tv/oauth2';

export const BROADCASTER_SCOPES = ['channel:read:subscriptions'];

export class TwitchClient {
  constructor({ config, db, fetch = globalThis.fetch }) {
    this.config = config;
    this.db = db;
    this.fetch = fetch;
    this.appTokenCache = null;
  }

  // ---- OAuth ----

  authorizeUrl({ state, scopes = [] }) {
    const params = new URLSearchParams({
      client_id: this.config.twitch.clientId,
      redirect_uri: `${this.config.publicUrl}/auth/callback`,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });
    return `${OAUTH}/authorize?${params}`;
  }

  async oauthToken(params) {
    const res = await this.fetch(`${OAUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.twitch.clientId,
        client_secret: this.config.twitch.clientSecret,
        ...params,
      }),
    });
    if (!res.ok) throw new Error(`Twitch OAuth ${res.status}: ${await res.text()}`);
    return res.json();
  }

  exchangeCode(code) {
    return this.oauthToken({ code, grant_type: 'authorization_code', redirect_uri: `${this.config.publicUrl}/auth/callback` });
  }

  async appToken() {
    if (this.appTokenCache && this.appTokenCache.expiresAt > Date.now() + 60_000) return this.appTokenCache.token;
    const data = await this.oauthToken({ grant_type: 'client_credentials' });
    this.appTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  // ---- Helix ----

  async helix(path, { method = 'GET', body, token, clientId = this.config.twitch.clientId } = {}) {
    const res = await this.fetch(`${HELIX}${path}`, {
      method,
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token ?? await this.appToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Twitch ${method} ${path.split('?')[0]} ${res.status}: ${data.message ?? ''}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async getUserForToken(accessToken) {
    const data = await this.helix('/users', { token: accessToken });
    return data.data[0];
  }

  async getUser(userId) {
    const data = await this.helix(`/users?id=${encodeURIComponent(userId)}`);
    return data.data[0] ?? null;
  }

  // ---- broadcaster token (needed for the sub check) ----

  saveBroadcasterTokens(tokens) {
    setKv(this.db, 'broadcaster_tokens', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope ?? [],
    });
  }

  hasBroadcasterToken() {
    return Boolean(getKv(this.db, 'broadcaster_tokens'));
  }

  async withBroadcasterToken(fn) {
    const tokens = getKv(this.db, 'broadcaster_tokens');
    if (!tokens) throw new Error('Le streamer doit se reconnecter au tableau de bord (jeton manquant)');
    try {
      return await fn(tokens.access_token);
    } catch (err) {
      if (err.status !== 401) throw err;
      const refreshed = await this.oauthToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
      this.saveBroadcasterTokens(refreshed);
      return fn(refreshed.access_token);
    }
  }

  /** Returns the subset of `userIds` subscribed to the channel. */
  async getSubscribers(userIds) {
    const subs = new Set();
    for (let i = 0; i < userIds.length; i += 100) {
      const query = new URLSearchParams({ broadcaster_id: this.config.broadcasterId });
      for (const id of userIds.slice(i, i + 100)) query.append('user_id', id);
      const data = await this.withBroadcasterToken((token) => this.helix(`/subscriptions?${query}`, { token }));
      for (const s of data.data) subs.add(s.user_id);
    }
    return subs;
  }

  // ---- EventSub ----

  async listEventSubs() {
    const data = await this.helix('/eventsub/subscriptions');
    return data.data.filter((s) => s.condition?.broadcaster_user_id === this.config.broadcasterId);
  }

  async ensureStreamOnlineSub() {
    const callback = `${this.config.publicUrl}/eventsub`;
    const existing = (await this.listEventSubs()).filter((s) => s.type === 'stream.online');
    const healthy = existing.find((s) => s.status === 'enabled' && s.transport?.callback === callback);
    if (healthy) return healthy;
    for (const s of existing) await this.helix(`/eventsub/subscriptions?id=${s.id}`, { method: 'DELETE' });
    const data = await this.helix('/eventsub/subscriptions', {
      method: 'POST',
      body: {
        type: 'stream.online',
        version: '1',
        condition: { broadcaster_user_id: this.config.broadcasterId },
        transport: { method: 'webhook', callback, secret: this.config.eventsubSecret },
      },
    });
    return data.data[0];
  }

  // ---- Extension PubSub ----

  /** Tells every open panel on the channel that something changed. */
  async broadcastToExtension(message) {
    const { clientId, secret, ownerId } = this.config.extension;
    const jwt = signExtJwt({
      exp: Math.floor(Date.now() / 1000) + 60,
      user_id: ownerId,
      role: 'external',
      channel_id: this.config.broadcasterId,
      pubsub_perms: { send: ['broadcast'] },
    }, secret);
    await this.helix('/extensions/pubsub', {
      method: 'POST',
      token: jwt,
      clientId,
      body: {
        target: ['broadcast'],
        broadcaster_id: this.config.broadcasterId,
        message: JSON.stringify(message),
      },
    });
  }
}
