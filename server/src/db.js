import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// All timestamps are milliseconds since epoch.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prize TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'claiming', 'done', 'cancelled')),
  started_at INTEGER NOT NULL,
  draw_at INTEGER NOT NULL,
  interval_sec INTEGER NOT NULL,
  min_tickets INTEGER NOT NULL,
  max_tickets INTEGER NOT NULL,
  loyalty_bonus INTEGER NOT NULL,
  loyalty_lives INTEGER NOT NULL,
  sub_multiplier REAL NOT NULL,
  sub_free_alternative INTEGER NOT NULL,
  claim_timeout_sec INTEGER NOT NULL,
  min_account_age_days INTEGER NOT NULL,
  candidate_opaque_id TEXT,
  claim_deadline INTEGER,
  ended_at INTEGER
);

-- One row per viewer per checkpoint window ("slot") in which the extension saw them watching.
CREATE TABLE IF NOT EXISTS presence (
  giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  opaque_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, opaque_id, slot)
);

CREATE TABLE IF NOT EXISTS entries (
  giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  opaque_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  login TEXT,
  display_name TEXT,
  joined_at INTEGER NOT NULL,
  tickets INTEGER,
  forfeited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (giveaway_id, opaque_id),
  UNIQUE (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id INTEGER NOT NULL REFERENCES giveaways(id),
  user_id TEXT NOT NULL,
  login TEXT,
  display_name TEXT,
  prize TEXT NOT NULL,
  won_at INTEGER NOT NULL,
  contact TEXT,
  delivered_at INTEGER
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  keys TEXT NOT NULL,
  user_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS eventsub_messages (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways(status);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id);
CREATE INDEX IF NOT EXISTS idx_winners_user ON winners(user_id);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function getKv(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setKv(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
