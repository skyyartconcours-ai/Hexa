import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, config } from './config.js';
import { log } from './log.js';
import type { UserProfile } from './types.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'hexa.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    user_login TEXT NOT NULL,
    text       TEXT NOT NULL,
    ts         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user_ts ON messages(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);

  CREATE TABLE IF NOT EXISTS users (
    user_id       TEXT PRIMARY KEY,
    user_login    TEXT NOT NULL,
    user_name     TEXT NOT NULL,
    first_seen    INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    opted_out     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS roast_history (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    user_name  TEXT NOT NULL,
    event_type TEXT NOT NULL,
    text       TEXT NOT NULL,
    severity   INTEGER NOT NULL,
    status     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_roast_user ON roast_history(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS tokens (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Tokens OAuth ───────────────────────────────────────────────────────────

const stmtGetToken = db.prepare<[string], { value: string }>('SELECT value FROM tokens WHERE key = ?');
const stmtSetToken = db.prepare(
  'INSERT INTO tokens (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);

export function readToken<T>(key: string): T | null {
  const row = stmtGetToken.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function writeToken(key: string, value: unknown): void {
  stmtSetToken.run(key, JSON.stringify(value));
}

// ── Chat ───────────────────────────────────────────────────────────────────

const stmtInsertMessage = db.prepare(
  'INSERT INTO messages (user_id, user_login, text, ts) VALUES (?, ?, ?, ?)',
);

const stmtUpsertUser = db.prepare(`
  INSERT INTO users (user_id, user_login, user_name, first_seen, last_seen, message_count)
  VALUES (@userId, @userLogin, @userName, @ts, @ts, 1)
  ON CONFLICT(user_id) DO UPDATE SET
    user_login    = excluded.user_login,
    user_name     = excluded.user_name,
    last_seen     = excluded.last_seen,
    message_count = users.message_count + 1
`);

const recordMessageTx = db.transaction(
  (userId: string, userLogin: string, userName: string, text: string, ts: number) => {
    stmtInsertMessage.run(userId, userLogin, text, ts);
    stmtUpsertUser.run({ userId, userLogin, userName, ts });
  },
);

export function recordMessage(
  userId: string,
  userLogin: string,
  userName: string,
  text: string,
  ts = Date.now(),
): void {
  recordMessageTx(userId, userLogin, userName, text, ts);
}

// ── Opt-out ────────────────────────────────────────────────────────────────

const stmtSetOptOut = db.prepare(`
  INSERT INTO users (user_id, user_login, user_name, first_seen, last_seen, message_count, opted_out)
  VALUES (@userId, @userLogin, @userName, @ts, @ts, 0, @optedOut)
  ON CONFLICT(user_id) DO UPDATE SET opted_out = excluded.opted_out
`);

const stmtIsOptedOut = db.prepare<[string], { opted_out: number }>(
  'SELECT opted_out FROM users WHERE user_id = ?',
);

const stmtListOptedOut = db.prepare<[], { user_name: string }>(
  'SELECT user_name FROM users WHERE opted_out = 1 ORDER BY user_name',
);

export function setOptOut(
  userId: string,
  userLogin: string,
  userName: string,
  optedOut: boolean,
): void {
  stmtSetOptOut.run({ userId, userLogin, userName, ts: Date.now(), optedOut: optedOut ? 1 : 0 });
}

export function isOptedOut(userId: string): boolean {
  return stmtIsOptedOut.get(userId)?.opted_out === 1;
}

export function listOptedOut(): string[] {
  return stmtListOptedOut.all().map((row) => row.user_name);
}

// ── Profil ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'alors', 'aussi', 'avec', 'avoir', 'bien', 'cest', 'cette', 'chez', 'comme', 'dans', 'depuis',
  'donc', 'elle', 'encore', 'etre', 'faire', 'fait', 'faut', 'ici', 'jamais', 'juste', 'leur',
  'mais', 'meme', 'moins', 'nous', 'ouais', 'parce', 'pas', 'peut', 'plus', 'pour', 'quand',
  'que', 'quoi', 'sans', 'sont', 'sous', 'suis', 'sur', 'tous', 'tout', 'trop', 'tres', 'vais',
  'vers', 'veux', 'voir', 'vous', 'https', 'http', 'the', 'and', 'you', 'for', 'that', 'this',
]);

const stmtUser = db.prepare<[string], {
  user_id: string;
  user_login: string;
  user_name: string;
  first_seen: number;
  message_count: number;
}>('SELECT user_id, user_login, user_name, first_seen, message_count FROM users WHERE user_id = ?');

const stmtRecentMessages = db.prepare<[string, number], { text: string; ts: number }>(
  'SELECT text, ts FROM messages WHERE user_id = ? ORDER BY ts DESC LIMIT ?',
);

/** Fenetre large pour les statistiques (mots recurrents, horaire), independante de l'echantillon. */
const STATS_WINDOW = 400;

export function buildProfile(
  userId: string,
  fallbackLogin: string,
  fallbackName: string,
): UserProfile {
  const user = stmtUser.get(userId);
  const stats = stmtRecentMessages.all(userId, STATS_WINDOW);

  const wordCounts = new Map<string, number>();
  const hourCounts = new Array<number>(24).fill(0);
  let totalLength = 0;

  for (const row of stats) {
    totalLength += row.text.length;
    const hour = new Date(row.ts).getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;

    for (const rawWord of row.text.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
      const word = rawWord.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      if (word.length < 4 || STOPWORDS.has(word)) continue;
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  const signatureWords = [...wordCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  let favouriteHour: number | null = null;
  if (stats.length >= 10) {
    let best = 0;
    for (let hour = 1; hour < 24; hour += 1) {
      if ((hourCounts[hour] ?? 0) > (hourCounts[best] ?? 0)) best = hour;
    }
    favouriteHour = best;
  }

  const sample = stmtRecentMessages
    .all(userId, config.chat.profileSampleSize)
    .map((row) => row.text.slice(0, 200))
    .reverse();

  const firstSeen = user?.first_seen ?? Date.now();

  return {
    userId,
    userLogin: user?.user_login ?? fallbackLogin,
    userName: user?.user_name ?? fallbackName,
    messageCount: user?.message_count ?? 0,
    daysKnown: Math.max(0, Math.floor((Date.now() - firstSeen) / 86_400_000)),
    avgMessageLength: stats.length ? Math.round(totalLength / stats.length) : 0,
    signatureWords,
    favouriteHour,
    recentMessages: sample,
  };
}

// ── Historique des vannes ──────────────────────────────────────────────────

const stmtInsertRoast = db.prepare(`
  INSERT INTO roast_history (id, user_id, user_name, event_type, text, severity, status, created_at)
  VALUES (@id, @userId, @userName, @eventType, @text, @severity, @status, @createdAt)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status
`);

const stmtPastRoasts = db.prepare<[string, number], { text: string }>(
  'SELECT text FROM roast_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
);

const stmtLastRoastAt = db.prepare<[string], { created_at: number }>(
  'SELECT created_at FROM roast_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
);

export function saveRoast(entry: {
  id: string;
  userId: string;
  userName: string;
  eventType: string;
  text: string;
  severity: number;
  status: string;
  createdAt: number;
}): void {
  stmtInsertRoast.run(entry);
}

/** Sert a eviter de resservir deux fois la meme vanne a la meme personne. */
export function pastRoastsFor(userId: string, limit = 5): string[] {
  return stmtPastRoasts.all(userId, limit).map((row) => row.text);
}

export function lastRoastAt(userId: string): number | null {
  return stmtLastRoastAt.get(userId)?.created_at ?? null;
}

// ── Retention ──────────────────────────────────────────────────────────────

const stmtPurge = db.prepare('DELETE FROM messages WHERE ts < ?');

export function purgeOldMessages(): void {
  const cutoff = Date.now() - config.chat.retentionDays * 86_400_000;
  const result = stmtPurge.run(cutoff);
  if (result.changes > 0) {
    log.info(`Purge historique : ${result.changes} messages de plus de ${config.chat.retentionDays} jours supprimes.`);
  }
}

export function chatStats(): { messages: number; users: number } {
  const messages = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM messages').get()?.n ?? 0;
  const users = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users').get()?.n ?? 0;
  return { messages, users };
}

export default db;
