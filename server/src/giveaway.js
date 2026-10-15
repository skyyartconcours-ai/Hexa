import { getKv, setKv, transaction } from './db.js';
import { computeTickets, weightedPick } from './draw.js';

export const DEFAULT_SETTINGS = {
  prize: 'Un jeu au choix',
  durationMin: 90,
  intervalMin: 15,
  minTickets: 2,
  maxTickets: 10,
  loyaltyBonus: 2,
  loyaltyLives: 3,
  subMultiplier: 1,
  subFreeAlternative: true,
  claimTimeoutSec: 60,
  minAccountAgeDays: 30,
  autoStart: false,
};

const NUMERIC_LIMITS = {
  durationMin: [5, 600],
  intervalMin: [1, 60],
  minTickets: [1, 100],
  maxTickets: [1, 1000],
  loyaltyBonus: [0, 100],
  loyaltyLives: [0, 20],
  subMultiplier: [1, 5],
  claimTimeoutSec: [15, 600],
  minAccountAgeDays: [0, 3650],
};

// Checkpoints happen at a random moment inside each window, so two consecutive ones
// can be up to two windows apart. Someone is "still here" if seen within that span.
const PRESENCE_GRACE_MS = 2 * 60 * 1000;
const RECENT_RESULT_MS = 2 * 3600 * 1000;
const STATS_TTL_MS = 20 * 1000;

export class GiveawayError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function sanitizeSettings(input, base) {
  const out = { ...base };
  for (const [key, [min, max]] of Object.entries(NUMERIC_LIMITS)) {
    if (input[key] === undefined || input[key] === '') continue;
    const n = Number(input[key]);
    if (!Number.isFinite(n)) throw new GiveawayError(`invalid_${key}`);
    const rounded = key === 'subMultiplier' ? Math.round(n * 10) / 10 : Math.round(n);
    out[key] = Math.min(max, Math.max(min, rounded));
  }
  if (input.prize !== undefined) {
    const prize = String(input.prize).trim().slice(0, 200);
    if (!prize) throw new GiveawayError('invalid_prize');
    out.prize = prize;
  }
  for (const key of ['subFreeAlternative', 'autoStart']) {
    if (input[key] !== undefined) out[key] = Boolean(input[key]);
  }
  out.minTickets = Math.min(out.minTickets, out.maxTickets);
  return out;
}

// Logged-in Twitch viewers have opaque ids starting with "U"; anonymous ones with "A".
export const isLoggedIn = (opaqueId) => typeof opaqueId === 'string' && opaqueId.startsWith('U');

export class GiveawayService {
  constructor({
    db,
    now = () => Date.now(),
    rand,
    broadcast = async () => {},
    fetchSubscribers = async () => new Set(),
    lookupUser = async () => null,
    logger = console,
  }) {
    Object.assign(this, { db, now, rand, broadcast, fetchSubscribers, lookupUser, logger });
    this.drawing = new Set();
    this.statsCache = new Map();
  }

  // ---- settings ----

  settings() {
    return { ...DEFAULT_SETTINGS, ...getKv(this.db, 'settings', {}) };
  }

  updateSettings(patch) {
    const next = sanitizeSettings(patch, this.settings());
    setKv(this.db, 'settings', next);
    return next;
  }

  // ---- lookups ----

  get(id) {
    return this.db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) ?? null;
  }

  active() {
    return this.db.prepare("SELECT * FROM giveaways WHERE status IN ('open', 'claiming') ORDER BY id DESC LIMIT 1").get() ?? null;
  }

  recentlyFinished() {
    return this.db.prepare("SELECT * FROM giveaways WHERE status = 'done' AND ended_at >= ? ORDER BY id DESC LIMIT 1")
      .get(this.now() - RECENT_RESULT_MS) ?? null;
  }

  slotOf(g, t) {
    return Math.floor((t - g.started_at) / (g.interval_sec * 1000));
  }

  // ---- lifecycle ----

  start(overrides = {}) {
    if (this.active()) throw new GiveawayError('already_active', 409);
    const s = sanitizeSettings(overrides, this.settings());
    const now = this.now();
    const { lastInsertRowid } = this.db.prepare(`
      INSERT INTO giveaways (prize, status, started_at, draw_at, interval_sec, min_tickets, max_tickets,
        loyalty_bonus, loyalty_lives, sub_multiplier, sub_free_alternative, claim_timeout_sec, min_account_age_days)
      VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      s.prize, now, now + s.durationMin * 60_000, s.intervalMin * 60, s.minTickets, s.maxTickets,
      s.loyaltyBonus, s.loyaltyLives, s.subMultiplier, s.subFreeAlternative ? 1 : 0, s.claimTimeoutSec,
      s.minAccountAgeDays,
    );
    this.notify();
    return this.get(Number(lastInsertRowid));
  }

  cancel(id) {
    const g = this.get(id);
    if (!g || !['open', 'claiming'].includes(g.status)) throw new GiveawayError('not_active', 409);
    this.db.prepare("UPDATE giveaways SET status = 'cancelled', ended_at = ? WHERE id = ?").run(this.now(), id);
    this.notify();
  }

  /** Records that the viewer is watching right now (one checkpoint per window). */
  heartbeat(opaqueId) {
    const g = this.active();
    if (!g || !isLoggedIn(opaqueId)) return { slot: null };
    const now = this.now();
    const slot = this.slotOf(g, now);
    this.db.prepare(`
      INSERT INTO presence (giveaway_id, opaque_id, slot, seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (giveaway_id, opaque_id, slot) DO UPDATE SET seen_at = excluded.seen_at`).run(g.id, opaqueId, slot, now);
    return { slot };
  }

  async join({ opaqueId, userId }) {
    const g = this.active();
    if (!g || g.status !== 'open') throw new GiveawayError('not_open', 409);
    if (!isLoggedIn(opaqueId)) throw new GiveawayError('login_required', 401);
    if (!userId) throw new GiveawayError('identity_required', 403);

    const existing = this.db.prepare('SELECT 1 FROM entries WHERE giveaway_id = ? AND opaque_id = ?').get(g.id, opaqueId);
    if (!existing) {
      let user = null;
      try {
        user = await this.lookupUser(userId);
      } catch (err) {
        this.logger.warn('User lookup failed:', err.message);
      }
      if (user?.created_at && g.min_account_age_days > 0) {
        const ageDays = (this.now() - Date.parse(user.created_at)) / 86_400_000;
        if (ageDays < g.min_account_age_days) throw new GiveawayError('account_too_recent', 403);
      }
      this.db.prepare(`
        INSERT OR IGNORE INTO entries (giveaway_id, opaque_id, user_id, login, display_name, joined_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(g.id, opaqueId, userId, user?.login ?? null, user?.display_name ?? null, this.now());
      this.statsCache.delete(g.id);
    }
    this.heartbeat(opaqueId);
  }

  /** Entrants who can win right now: enough checkpoints and still watching. */
  eligible(g) {
    const rows = this.db.prepare(`
      SELECT e.opaque_id, e.user_id, e.login, e.display_name,
             COUNT(p.slot) AS slots, MAX(p.seen_at) AS last_seen
      FROM entries e
      LEFT JOIN presence p ON p.giveaway_id = e.giveaway_id AND p.opaque_id = e.opaque_id
      WHERE e.giveaway_id = ? AND e.forfeited = 0
      GROUP BY e.opaque_id`).all(g.id);
    const stillHereSince = this.now() - (2 * g.interval_sec * 1000 + PRESENCE_GRACE_MS);
    return rows.filter((r) => r.slots >= g.min_tickets && r.last_seen >= stillHereSince);
  }

  /** Users who took part in each of the previous `loyalty_lives` completed giveaways. */
  loyalUsers(g) {
    if (g.loyalty_lives <= 0) return new Set();
    const previous = this.db.prepare("SELECT id FROM giveaways WHERE status = 'done' AND id < ? ORDER BY id DESC LIMIT ?")
      .all(g.id, g.loyalty_lives).map((r) => r.id);
    if (previous.length < g.loyalty_lives) return new Set();
    const rows = this.db.prepare(`
      SELECT user_id FROM entries WHERE giveaway_id IN (${previous.map(() => '?').join(',')})
      GROUP BY user_id HAVING COUNT(DISTINCT giveaway_id) = ?`).all(...previous, previous.length);
    return new Set(rows.map((r) => r.user_id));
  }

  /**
   * Weighted draw among eligible entrants; the pick then has to confirm within the claim timeout.
   * With nobody eligible, a scheduled draw ends the giveaway, while an early manual one leaves it open.
   */
  async draw(id, { closeIfEmpty = true } = {}) {
    if (this.drawing.has(id)) return null;
    this.drawing.add(id);
    try {
      const g = this.get(id);
      if (!g || !['open', 'claiming'].includes(g.status)) throw new GiveawayError('not_active', 409);

      const pool = this.eligible(g);
      const loyal = this.loyalUsers(g);
      let subs = new Set();
      if (g.sub_multiplier > 1 && pool.length) {
        try {
          subs = await this.fetchSubscribers(pool.map((c) => c.user_id));
        } catch (err) {
          this.logger.warn('Sub check failed, drawing without the sub bonus:', err.message);
        }
      }
      const weighted = pool.map((c) => ({
        ...c,
        weight: computeTickets({
          slots: c.slots,
          maxTickets: g.max_tickets,
          loyal: loyal.has(c.user_id),
          loyaltyBonus: g.loyalty_bonus,
          isSub: subs.has(c.user_id),
          subMultiplier: g.sub_multiplier,
          subFreeAlternative: Boolean(g.sub_free_alternative),
        }),
      }));
      const pick = weightedPick(weighted, this.rand);
      if (!pick && !closeIfEmpty && g.status === 'open') return null;
      if (pick && !pick.login) await this.fillMissingName(id, pick);
      const now = this.now();

      const drawn = transaction(this.db, () => {
        // The giveaway may have been cancelled while we were waiting on Twitch.
        if (!['open', 'claiming'].includes(this.get(id).status)) return false;
        const setTickets = this.db.prepare('UPDATE entries SET tickets = ? WHERE giveaway_id = ? AND opaque_id = ?');
        for (const c of weighted) setTickets.run(c.weight, id, c.opaque_id);
        if (pick) {
          this.db.prepare("UPDATE giveaways SET status = 'claiming', candidate_opaque_id = ?, claim_deadline = ? WHERE id = ?")
            .run(pick.opaque_id, now + g.claim_timeout_sec * 1000, id);
        } else {
          this.db.prepare("UPDATE giveaways SET status = 'done', candidate_opaque_id = NULL, claim_deadline = NULL, ended_at = ? WHERE id = ?")
            .run(now, id);
        }
        return true;
      });
      if (!drawn) return null;
      this.notify();
      return pick;
    } finally {
      this.drawing.delete(id);
    }
  }

  // The name lookup can fail at join time (Twitch hiccup); retry for the winner so the
  // dashboard and panel can show who won.
  async fillMissingName(id, pick) {
    try {
      const user = await this.lookupUser(pick.user_id);
      if (!user) return;
      this.db.prepare('UPDATE entries SET login = ?, display_name = ? WHERE giveaway_id = ? AND opaque_id = ?')
        .run(user.login, user.display_name, id, pick.opaque_id);
      Object.assign(pick, { login: user.login, display_name: user.display_name });
    } catch (err) {
      this.logger.warn('User lookup failed:', err.message);
    }
  }

  /** The current pick didn't confirm in time (or the streamer skipped them): pick someone else. */
  async redraw(id) {
    const g = this.get(id);
    if (!g || g.status !== 'claiming') throw new GiveawayError('not_claiming', 409);
    this.db.prepare('UPDATE entries SET forfeited = 1 WHERE giveaway_id = ? AND opaque_id = ?').run(id, g.candidate_opaque_id);
    return this.draw(id);
  }

  claim(opaqueId) {
    const g = this.active();
    if (!g || g.status !== 'claiming' || g.candidate_opaque_id !== opaqueId) throw new GiveawayError('not_candidate', 403);
    if (this.now() > g.claim_deadline) throw new GiveawayError('too_late', 410);
    const entry = this.db.prepare('SELECT * FROM entries WHERE giveaway_id = ? AND opaque_id = ?').get(g.id, opaqueId);
    const now = this.now();
    const winnerId = transaction(this.db, () => {
      const { lastInsertRowid } = this.db.prepare(`
        INSERT INTO winners (giveaway_id, user_id, login, display_name, prize, won_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(g.id, entry.user_id, entry.login, entry.display_name, g.prize, now);
      this.db.prepare("UPDATE giveaways SET status = 'done', claim_deadline = NULL, ended_at = ? WHERE id = ?").run(now, g.id);
      return Number(lastInsertRowid);
    });
    this.notify();
    return this.db.prepare('SELECT * FROM winners WHERE id = ?').get(winnerId);
  }

  /** Called periodically: runs scheduled draws and expires unclaimed picks. */
  async tick() {
    const g = this.active();
    if (!g || this.drawing.has(g.id)) return;
    const now = this.now();
    if (g.status === 'open' && now >= g.draw_at) await this.draw(g.id);
    else if (g.status === 'claiming' && now > g.claim_deadline) await this.redraw(g.id);
  }

  notify() {
    this.statsCache.clear();
    Promise.resolve()
      .then(() => this.broadcast({ t: 'update' }))
      .catch((err) => this.logger.warn('Extension broadcast failed:', err.message));
  }

  // ---- read models ----

  stats(g) {
    const cached = this.statsCache.get(g.id);
    if (cached && cached.at > this.now() - STATS_TTL_MS) return cached.value;
    const row = this.db.prepare(`
      SELECT COUNT(*) AS entrants, COALESCE(SUM(MIN(slots, ?)), 0) AS total_tickets FROM (
        SELECT COUNT(p.slot) AS slots FROM entries e
        LEFT JOIN presence p ON p.giveaway_id = e.giveaway_id AND p.opaque_id = e.opaque_id
        WHERE e.giveaway_id = ? GROUP BY e.opaque_id)`).get(g.max_tickets, g.id);
    const value = { entrants: row.entrants, totalTickets: row.total_tickets };
    this.statsCache.set(g.id, { at: this.now(), value });
    return value;
  }

  /** What the extension panel shows to one viewer. */
  viewerState(opaqueId) {
    const now = this.now();
    const g = this.active() ?? this.recentlyFinished();
    if (!g) return { serverNow: now, giveaway: null, me: null, stats: null };

    const loggedIn = isLoggedIn(opaqueId);
    const entry = loggedIn
      ? this.db.prepare('SELECT * FROM entries WHERE giveaway_id = ? AND opaque_id = ?').get(g.id, opaqueId)
      : null;
    const presence = loggedIn
      ? this.db.prepare('SELECT COUNT(*) AS slots, MAX(slot) AS last_slot FROM presence WHERE giveaway_id = ? AND opaque_id = ?').get(g.id, opaqueId)
      : { slots: 0, last_slot: null };
    const winner = g.status === 'done' ? this.db.prepare('SELECT * FROM winners WHERE giveaway_id = ?').get(g.id) : null;

    return {
      serverNow: now,
      giveaway: {
        id: g.id,
        prize: g.prize,
        status: g.status,
        startedAt: g.started_at,
        drawAt: g.draw_at,
        intervalSec: g.interval_sec,
        minTickets: g.min_tickets,
        maxTickets: g.max_tickets,
        claimDeadline: g.status === 'claiming' ? g.claim_deadline : null,
        winner: winner ? (winner.display_name || winner.login) : null,
      },
      me: {
        loggedIn,
        joined: Boolean(entry),
        forfeited: Boolean(entry?.forfeited),
        slots: presence.slots,
        tickets: Math.min(presence.slots, g.max_tickets),
        lastSlot: presence.last_slot,
        isCandidate: g.status === 'claiming' && g.candidate_opaque_id === opaqueId,
        isWinner: Boolean(winner && entry && entry.user_id === winner.user_id),
      },
      stats: this.stats(g),
    };
  }

  adminOverview() {
    const g = this.active() ?? this.db.prepare('SELECT * FROM giveaways ORDER BY id DESC LIMIT 1').get() ?? null;
    const entrants = g ? this.db.prepare(`
      SELECT e.user_id, e.login, e.display_name, e.joined_at, e.tickets, e.forfeited,
             COUNT(p.slot) AS slots, MAX(p.seen_at) AS last_seen
      FROM entries e
      LEFT JOIN presence p ON p.giveaway_id = e.giveaway_id AND p.opaque_id = e.opaque_id
      WHERE e.giveaway_id = ? GROUP BY e.opaque_id ORDER BY slots DESC, e.joined_at ASC LIMIT 500`).all(g.id) : [];
    const candidate = g?.status === 'claiming'
      ? this.db.prepare('SELECT login, display_name FROM entries WHERE giveaway_id = ? AND opaque_id = ?').get(g.id, g.candidate_opaque_id)
      : null;
    const history = this.db.prepare(`
      SELECT g.id, g.prize, g.status, g.started_at, g.ended_at,
             (SELECT COUNT(*) FROM entries e WHERE e.giveaway_id = g.id) AS entrants,
             (SELECT COALESCE(w.display_name, w.login) FROM winners w WHERE w.giveaway_id = g.id) AS winner
      FROM giveaways g ORDER BY g.id DESC LIMIT 20`).all();
    const winners = this.db.prepare('SELECT * FROM winners ORDER BY id DESC LIMIT 100').all();
    return {
      settings: this.settings(),
      giveaway: g ? { ...g, candidate, stats: this.stats(g) } : null,
      entrants,
      history,
      winners,
    };
  }

  // ---- winners (viewer app + dashboard) ----

  winsFor(userId) {
    return this.db.prepare('SELECT id, prize, won_at, contact, delivered_at FROM winners WHERE user_id = ? ORDER BY id DESC').all(userId);
  }

  setContact(winnerId, userId, contact) {
    const text = String(contact ?? '').trim().slice(0, 1000);
    if (!text) throw new GiveawayError('invalid_contact');
    const { changes } = this.db.prepare('UPDATE winners SET contact = ? WHERE id = ? AND user_id = ? AND delivered_at IS NULL')
      .run(text, winnerId, userId);
    if (!changes) throw new GiveawayError('not_found', 404);
  }

  setDelivered(winnerId, delivered) {
    const { changes } = this.db.prepare('UPDATE winners SET delivered_at = ? WHERE id = ?')
      .run(delivered ? this.now() : null, winnerId);
    if (!changes) throw new GiveawayError('not_found', 404);
  }

  /** GDPR: removes the personal data we hold beyond what's needed to keep the draw history auditable. */
  forgetUser(userId) {
    transaction(this.db, () => {
      this.db.prepare('UPDATE winners SET contact = NULL WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    });
  }
}
