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

  -- Liste des abonnes, rafraichie depuis l'API officielle. Ne contient aucun
  -- message : Twitch n'en expose pas. Sert a deux choses — donner de la matiere
  -- a vanne des le premier jour : palier, et surtout qui a offert le sub.
  CREATE TABLE IF NOT EXISTS subscribers (
    user_id     TEXT PRIMARY KEY,
    user_login  TEXT NOT NULL,
    user_name   TEXT NOT NULL,
    tier        TEXT,
    is_gift     INTEGER NOT NULL DEFAULT 0,
    gifter_name TEXT,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
  );

  -- Personnes ayant demande l'effacement. Cette liste survit a tout : sans
  -- elle, un reimport de VODs avec --force reinjecterait leurs messages.
  CREATE TABLE IF NOT EXISTS forgotten (
    user_id TEXT PRIMARY KEY,
    at      INTEGER NOT NULL
  );

  -- VODs deja importees, pour ne pas compter deux fois les memes messages.
  CREATE TABLE IF NOT EXISTS backfilled_vods (
    video_id     TEXT PRIMARY KEY,
    title        TEXT,
    imported_at  INTEGER NOT NULL,
    message_count INTEGER NOT NULL
  );
`);

// Colonnes ajoutees apres coup : SQLite ne connait pas ALTER TABLE ... IF NOT
// EXISTS, il faut donc regarder ce qui est deja la avant de l'ajouter.
{
  const columns = new Set((db.pragma('table_info(users)') as Array<{ name: string }>).map((c) => c.name));
  // Anciennete d'abonnement lue dans le badge du dernier message (voir
  // readSubMonths dans twitch/eventsub.ts), et date de cette lecture.
  if (!columns.has('sub_months')) db.exec('ALTER TABLE users ADD COLUMN sub_months INTEGER');
  if (!columns.has('sub_months_at')) db.exec('ALTER TABLE users ADD COLUMN sub_months_at INTEGER');
}

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

/**
 * `@subMonthsKnown` distingue deux situations que `NULL` seul confondrait :
 * "on a regarde le badge et il n'y en a pas" (message en direct d'un
 * non-abonne) et "on ne sait pas" (import de VOD). Sans ce drapeau, le
 * deuxieme cas effacerait l'anciennete apprise dans le premier.
 */
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (user_id, user_login, user_name, first_seen, last_seen, message_count,
                     sub_months, sub_months_at)
  VALUES (@userId, @userLogin, @userName, @ts, @ts, 1,
          @subMonths, CASE WHEN @subMonthsKnown = 1 THEN @ts END)
  ON CONFLICT(user_id) DO UPDATE SET
    user_login    = excluded.user_login,
    user_name     = excluded.user_name,
    -- MIN/MAX plutot qu'affectation directe : l'import de VODs insere des
    -- messages plus anciens que ce qu'on a deja vu en direct.
    first_seen    = MIN(users.first_seen, excluded.first_seen),
    last_seen     = MAX(users.last_seen, excluded.last_seen),
    message_count = users.message_count + 1,
    sub_months    = CASE WHEN @subMonthsKnown = 1 THEN @subMonths ELSE users.sub_months END,
    sub_months_at = CASE WHEN @subMonthsKnown = 1 THEN @ts ELSE users.sub_months_at END
`);

export interface ChatRecord {
  userId: string;
  userLogin: string;
  userName: string;
  text: string;
  ts: number;
  /**
   * Mois d'abonnement lus sur le badge. `number` ou `null` quand le badge a
   * ete regarde, `undefined` quand on n'en sait rien (import de VOD).
   */
  subMonths?: number | null;
}

const recordMessageTx = db.transaction((records: ChatRecord[]) => {
  for (const record of records) {
    stmtInsertMessage.run(record.userId, record.userLogin, record.text, record.ts);
    stmtUpsertUser.run({
      ...record,
      subMonths: record.subMonths ?? null,
      subMonthsKnown: record.subMonths === undefined ? 0 : 1,
    });
  }
});

export function recordMessage(
  userId: string,
  userLogin: string,
  userName: string,
  text: string,
  subMonths: number | null = null,
  ts = Date.now(),
): void {
  recordMessageTx([{ userId, userLogin, userName, text, ts, subMonths }]);
}

const stmtNoteSubMonths = db.prepare(`
  INSERT INTO users (user_id, user_login, user_name, first_seen, last_seen, message_count,
                     sub_months, sub_months_at)
  VALUES (@userId, @userLogin, @userName, @ts, @ts, 0, @subMonths, @ts)
  ON CONFLICT(user_id) DO UPDATE SET
    user_login    = excluded.user_login,
    user_name     = excluded.user_name,
    last_seen     = MAX(users.last_seen, excluded.last_seen),
    sub_months    = excluded.sub_months,
    sub_months_at = excluded.sub_months_at
`);

/**
 * Enregistre la seule anciennete, sans le message.
 *
 * Sert au cas qui compte le plus : l'abonne discret, celui qui ne poste que
 * des emotes, des liens ou des commandes. Le sanitiseur jette ces messages,
 * mais leur badge, lui, dit depuis combien de temps la personne est abonnee.
 * Autant garder le chiffre et rien d'autre — c'est aussi la donnee la moins
 * intrusive du lot.
 */
export function noteSubMonths(
  userId: string,
  userLogin: string,
  userName: string,
  subMonths: number,
): void {
  if (isBlockedFromCollection(userId)) return;
  stmtNoteSubMonths.run({ userId, userLogin, userName, subMonths, ts: Date.now() });
}

/** Insertion en lot, pour l'import de VODs (des milliers de lignes). */
const stmtIsBlocked = db.prepare<[string, string], { user_id: string }>(
  `SELECT user_id FROM forgotten WHERE user_id = ?
   UNION SELECT user_id FROM users WHERE user_id = ? AND opted_out = 1`,
);

/** Opposition ou effacement demande : on ne reimporte jamais cette personne. */
export function isBlockedFromCollection(userId: string): boolean {
  return stmtIsBlocked.get(userId, userId) !== undefined;
}

/** Insertion en lot, pour l'import de VODs (des milliers de lignes). */
export function recordMessages(records: ChatRecord[]): void {
  const allowed = records.filter((record) => !isBlockedFromCollection(record.userId));
  if (allowed.length) recordMessageTx(allowed);
}

// ── Import de VODs ─────────────────────────────────────────────────────────

const stmtMarkVod = db.prepare(
  `INSERT INTO backfilled_vods (video_id, title, imported_at, message_count)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(video_id) DO UPDATE SET
     imported_at = excluded.imported_at,
     message_count = excluded.message_count`,
);

const stmtVodDone = db.prepare<[string], { video_id: string }>(
  'SELECT video_id FROM backfilled_vods WHERE video_id = ?',
);

export function isVodImported(videoId: string): boolean {
  return stmtVodDone.get(videoId) !== undefined;
}

export function markVodImported(videoId: string, title: string, messageCount: number): void {
  stmtMarkVod.run(videoId, title, Date.now(), messageCount);
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

// ── Abonnes ────────────────────────────────────────────────────────────────

export interface SubscriberRow {
  userId: string;
  userLogin: string;
  userName: string;
  tier: string;
  isGift: boolean;
  gifterName: string | null;
}

const stmtUpsertSub = db.prepare(`
  INSERT INTO subscribers (user_id, user_login, user_name, tier, is_gift, gifter_name, first_seen, last_seen)
  VALUES (@userId, @userLogin, @userName, @tier, @isGift, @gifterName, @now, @now)
  ON CONFLICT(user_id) DO UPDATE SET
    user_login  = excluded.user_login,
    user_name   = excluded.user_name,
    tier        = excluded.tier,
    is_gift     = excluded.is_gift,
    gifter_name = excluded.gifter_name,
    last_seen   = excluded.last_seen
`);

/** Remplace la photo des abonnes. Les partis sont retires. */
const syncSubsTx = db.transaction((rows: SubscriberRow[], now: number, prune: boolean) => {
  for (const row of rows) {
    stmtUpsertSub.run({ ...row, isGift: row.isGift ? 1 : 0, now });
  }
  if (!prune) return 0;
  // Ceux qui n'ont pas ete revus dans cette passe ne sont plus abonnes.
  return db.prepare('DELETE FROM subscribers WHERE last_seen < ?').run(now).changes;
});

/**
 * `listSubscribers` s'arrete sur une page vide sans distinguer "fin de liste"
 * de "reponse degradee". Une seule pagination tronquee suffirait donc a effacer
 * la majorite de la table. On refuse d'elaguer sur une chute suspecte.
 */
export function syncSubscribers(rows: SubscriberRow[]): {
  total: number;
  gone: number;
  suspicious: boolean;
} {
  const before = subscriberCount();
  const suspicious = before > 50 && rows.length < before * 0.5;
  const gone = syncSubsTx(rows, Date.now(), !suspicious);
  return { total: rows.length, gone, suspicious };
}

const stmtSub = db.prepare<[string], {
  tier: string | null;
  is_gift: number;
  gifter_name: string | null;
  first_seen: number;
}>('SELECT tier, is_gift, gifter_name, first_seen FROM subscribers WHERE user_id = ?');

export interface SubscriberFacts {
  tier: string | null;
  isGift: boolean;
  gifterName: string | null;
}

/**
 * Ce que Twitch donne reellement sur un abonne : palier, sub offert ou non, et
 * par qui. Rien d'autre.
 *
 * Il n'y a deliberement PAS d'anciennete ici. La table connait la date a
 * laquelle l'outil a vu cette personne pour la premiere fois — ce n'est pas sa
 * date d'abonnement. Exposer ce chiffre revenait a affirmer au modele qu'un
 * abonne de quatre ans venait d'arriver, et le prompt lui interdit d'inventer
 * des faits sans pouvoir se defendre de ceux qu'on lui fournit.
 */
export function subscriberFacts(userId: string): SubscriberFacts | null {
  const row = stmtSub.get(userId);
  if (!row) return null;
  return { tier: row.tier, isGift: row.is_gift === 1, gifterName: row.gifter_name };
}

export function isSubscriber(userId: string): boolean {
  return stmtSub.get(userId) !== undefined;
}

export function subscriberCount(): number {
  return db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM subscribers').get()?.n ?? 0;
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
  sub_months: number | null;
}>(
  'SELECT user_id, user_login, user_name, first_seen, message_count, sub_months FROM users WHERE user_id = ?',
);

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
    // Contrairement a `daysKnown`, qui ne dit que depuis quand NOUS l'observons,
    // celui-ci vient de Twitch et vaut pour toute la vie de l'abonnement.
    subMonths: user?.sub_months ?? null,
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

const stmtPurgeMessages = db.prepare('DELETE FROM messages WHERE ts < ?');
const stmtPurgeRoasts = db.prepare('DELETE FROM roast_history WHERE created_at < ?');
// Un viewer dont il ne reste plus rien n'a pas a rester fiche — sauf s'il s'est
// oppose, auquel cas on garde la ligne : c'est elle qui porte son opposition.
const stmtPurgeUsers = db.prepare(`
  DELETE FROM users
  WHERE opted_out = 0
    AND last_seen < ?
    AND user_id NOT IN (SELECT DISTINCT user_id FROM messages)
`);
// Le compteur doit refleter ce qui reste en base, sinon il derive a la hausse
// et finit par mentir au prompt.
const stmtResyncCounts = db.prepare(`
  UPDATE users
  SET message_count = (SELECT COUNT(*) FROM messages WHERE messages.user_id = users.user_id)
`);

// Les abonnes qui ne le sont plus depuis longtemps n'ont plus a etre fiches.
const stmtPurgeSubs = db.prepare('DELETE FROM subscribers WHERE last_seen < ?');

const purgeTx = db.transaction((cutoff: number) => ({
  subs: stmtPurgeSubs.run(cutoff).changes,
  messages: stmtPurgeMessages.run(cutoff).changes,
  roasts: stmtPurgeRoasts.run(cutoff).changes,
  users: (stmtResyncCounts.run(), stmtPurgeUsers.run(cutoff).changes),
}));

export function purgeOldMessages(): void {
  const cutoff = Date.now() - config.chat.retentionDays * 86_400_000;
  const result = purgeTx(cutoff);
  if (result.messages || result.roasts || result.users || result.subs) {
    log.info(
      `Purge (> ${config.chat.retentionDays} j) : ${result.messages} message(s), ` +
        `${result.roasts} vanne(s) archivee(s), ${result.users} profil(s) vide(s), ` +
        `${result.subs} ancien(s) abonne(s).`,
    );
  }
}

/**
 * Droit a l'effacement : `!forgetme`. Retire tout ce qui concerne la personne,
 * y compris sa ligne dans la liste des abonnes.
 *
 * Une seule chose survit, et volontairement : si la personne s'etait aussi
 * opposee via !noroast, on garde une ligne vide portant ce seul drapeau. Sans
 * ca, effacer ses donnees effacerait son opposition, et son message suivant la
 * recreerait comme si elle n'avait jamais rien demande.
 */
const forgetTx = db.transaction((userId: string) => {
  const wasOptedOut = stmtIsOptedOut.get(userId)?.opted_out === 1;

  let removed = db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId).changes;
  removed += db.prepare('DELETE FROM roast_history WHERE user_id = ?').run(userId).changes;
  removed += db.prepare('DELETE FROM subscribers WHERE user_id = ?').run(userId).changes;
  removed += db.prepare('DELETE FROM users WHERE user_id = ?').run(userId).changes;

  if (wasOptedOut) {
    db.prepare(
      `INSERT INTO users (user_id, user_login, user_name, first_seen, last_seen, message_count, opted_out)
       VALUES (?, '', '', ?, ?, 0, 1)`,
    ).run(userId, Date.now(), Date.now());
  }

  // La personne est aussi inscrite comme effacee, pour que le backfill ne la
  // ressuscite pas au prochain import.
  db.prepare('INSERT OR IGNORE INTO forgotten (user_id, at) VALUES (?, ?)').run(userId, Date.now());
  return removed;
});

export function forgetUser(userId: string): number {
  return forgetTx(userId);
}

/** Resolution d'un pseudo vers son user_id reel, pour le bouton de test. */
const stmtUserByLogin = db.prepare<[string], { user_id: string; user_name: string }>(
  'SELECT user_id, user_name FROM users WHERE user_login = ?',
);

export function findUserByLogin(login: string): { userId: string; userName: string } | null {
  const row = stmtUserByLogin.get(login.toLowerCase());
  return row ? { userId: row.user_id, userName: row.user_name } : null;
}

export function chatStats(): { messages: number; users: number } {
  const messages = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM messages').get()?.n ?? 0;
  const users = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users').get()?.n ?? 0;
  return { messages, users };
}

export default db;
