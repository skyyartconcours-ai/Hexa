import webpush from 'web-push';

export class PushService {
  constructor({ db, vapid, logger = console }) {
    this.db = db;
    this.logger = logger;
    this.publicKey = vapid.publicKey;
    this.enabled = Boolean(vapid.publicKey && vapid.privateKey);
    if (this.enabled) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  subscribe(subscription, userId = null) {
    const { endpoint, keys } = subscription ?? {};
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !keys?.p256dh || !keys?.auth) {
      throw Object.assign(new Error('invalid_subscription'), { status: 400 });
    }
    this.db.prepare(`
      INSERT INTO push_subscriptions (endpoint, keys, user_id, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET keys = excluded.keys, user_id = COALESCE(excluded.user_id, user_id)`)
      .run(endpoint, JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }), userId, Date.now());
  }

  unsubscribe(endpoint) {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint ?? ''));
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;
  }

  async sendAll(payload) {
    if (!this.enabled) return { sent: 0, removed: 0 };
    const rows = this.db.prepare('SELECT endpoint, keys FROM push_subscriptions').all();
    const body = JSON.stringify(payload);
    let sent = 0;
    let removed = 0;
    for (let i = 0; i < rows.length; i += 50) {
      await Promise.all(rows.slice(i, i + 50).map(async (row) => {
        try {
          await webpush.sendNotification({ endpoint: row.endpoint, keys: JSON.parse(row.keys) }, body, { TTL: 3600 });
          sent++;
        } catch (err) {
          // 404/410: the browser dropped this subscription.
          if (err.statusCode === 404 || err.statusCode === 410) {
            this.unsubscribe(row.endpoint);
            removed++;
          } else {
            this.logger.warn('Push failed:', err.statusCode ?? err.message);
          }
        }
      }));
    }
    return { sent, removed };
  }
}
