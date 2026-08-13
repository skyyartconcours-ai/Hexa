/**
 * Name resolution.
 *
 * Everything a human might type at the CLI — `peyz`, `Peyz`, `PEYZ`,
 * `Kim Su-hwan`, `kim suhwan`, `김수환`, `t1-peyz`, `geng-peyz` — has to land
 * on the same `Player`. Resolution is therefore done on a normalised key:
 * Unicode-decomposed, combining marks stripped, lower-cased, and reduced to
 * letters and digits only. That folds away punctuation, hyphens, spaces,
 * dots and Latin diacritics in one pass while leaving Hangul intact.
 *
 * Two resolution modes:
 *
 * - {@link findPlayer} / {@link findTeam} are *exact* on the normalised key.
 *   They never guess. This is what the pipeline uses, because silently
 *   rendering the wrong person is the worst failure this tool can have.
 * - {@link searchPlayers} is fuzzy and ranked, for interactive pickers and
 *   "did you mean" affordances.
 */

import { HexaError, ROLE_ORDER, didYouMean } from '@hexa/core';
import type { Player, Region, Role, Team } from '@hexa/core';

import { PLAYERS } from './roster.js';
import { TEAMS } from './teams.js';

/**
 * Fold a human-typed string down to a comparison key: NFKD-decompose, drop
 * combining marks (so `é` → `e`), lower-case, then keep only letters and
 * digits from any script (so `Kim Su-hwan`, `kim suhwan` and `KIM_SU_HWAN`
 * all collapse to `kimsuhwan`, and Hangul survives untouched).
 */
export function normalizeKey(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function playerKeys(player: Player): string[] {
  const keys = [
    player.id,
    player.handle,
    player.fullName,
    ...player.aliases,
    `${player.teamId}-${player.handle}`,
  ];
  if (player.nativeName) keys.push(player.nativeName);
  return keys.map(normalizeKey).filter((k) => k.length > 0);
}

function teamKeys(team: Team): string[] {
  const keys = [team.id, team.name, team.shortName, team.tag, ...(team.aliases ?? [])];
  return keys.map(normalizeKey).filter((k) => k.length > 0);
}

/**
 * Build a lookup index. Active entries are indexed first so that when a
 * historical row shares a key with a current one (a handle reused after a
 * transfer, say) the player who is actually on a roster wins.
 */
function buildIndex<T>(items: T[], keysOf: (item: T) => string[], isPreferred: (item: T) => boolean): Map<string, T> {
  const index = new Map<string, T>();
  const ordered = [...items.filter(isPreferred), ...items.filter((i) => !isPreferred(i))];
  for (const item of ordered) {
    for (const key of keysOf(item)) {
      if (!index.has(key)) index.set(key, item);
    }
  }
  return index;
}

const PLAYER_INDEX: Map<string, Player> = buildIndex(PLAYERS, playerKeys, (p) => p.active);
const TEAM_INDEX: Map<string, Team> = buildIndex(TEAMS, teamKeys, () => true);

/**
 * Resolve a player by id, handle, alias, legal name or native-script name.
 * Case-, punctuation- and diacritic-insensitive. Returns `undefined` rather
 * than guessing.
 */
export function findPlayer(query: string): Player | undefined {
  const key = normalizeKey(query);
  if (!key) return undefined;
  return PLAYER_INDEX.get(key);
}

/**
 * Resolve a team by id, name, short name, competitive tag or alias.
 * Case-, punctuation- and diacritic-insensitive.
 */
export function findTeam(query: string): Team | undefined {
  const key = normalizeKey(query);
  if (!key) return undefined;
  return TEAM_INDEX.get(key);
}

/** Like {@link findPlayer}, but throws a `HexaError` carrying a spelling hint. */
export function requirePlayer(query: string): Player {
  const found = findPlayer(query);
  if (found) return found;

  const candidates = PLAYERS.map((p) => p.handle);
  const suggestions = didYouMean(query, candidates);
  throw new HexaError('PLAYER_NOT_FOUND', `No player matches "${query}".`, {
    hint:
      suggestions.length > 0
        ? `Did you mean ${suggestions.join(', ')}?`
        : 'Run `hexa roster players` to list every player Hexa knows about.',
    details: { query, didYouMean: suggestions },
  });
}

/** Like {@link findTeam}, but throws a `HexaError` carrying a spelling hint. */
export function requireTeam(query: string): Team {
  const found = findTeam(query);
  if (found) return found;

  const candidates = TEAMS.flatMap((t) => [t.tag, t.name]);
  const suggestions = didYouMean(query, candidates);
  throw new HexaError('TEAM_NOT_FOUND', `No team matches "${query}".`, {
    hint:
      suggestions.length > 0
        ? `Did you mean ${suggestions.join(', ')}?`
        : `Known teams: ${TEAMS.map((t) => t.tag).join(', ')}.`,
    details: { query, didYouMean: suggestions },
  });
}

export interface PlayerFilter {
  teamId?: string;
  role?: Role;
  region?: Region;
  active?: boolean;
}

/**
 * Filter the roster. An omitted key means "don't care" — note that
 * `listPlayers()` with no filter returns historical players too; pass
 * `{ active: true }` for current rosters only.
 *
 * `teamId` is resolved leniently, so `'GEN'`, `'gen.g'` and `'geng'` all work.
 */
export function listPlayers(filter: PlayerFilter = {}): Player[] {
  const teamId = filter.teamId === undefined ? undefined : (findTeam(filter.teamId)?.id ?? filter.teamId);

  return PLAYERS.filter((p) => {
    if (teamId !== undefined && p.teamId !== teamId) return false;
    if (filter.role !== undefined && p.role !== filter.role) return false;
    if (filter.region !== undefined && p.region !== filter.region) return false;
    if (filter.active !== undefined && p.active !== filter.active) return false;
    return true;
  });
}

function roleRank(role: Role): number {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

function isStarter(player: Player): boolean {
  return player.active && (player.tags?.includes('starter') ?? false);
}

/**
 * Everyone on a team's books, current and historical: starters in lineup
 * order first, then the rest of the active squad and staff, then former
 * members. Accepts any team alias.
 */
export function playersByTeam(teamId: string): Player[] {
  const id = findTeam(teamId)?.id ?? teamId;
  const roster = PLAYERS.filter((p) => p.teamId === id);

  return roster.sort((a, b) => {
    const tier = (p: Player) => (isStarter(p) ? 0 : p.active ? 1 : 2);
    if (tier(a) !== tier(b)) return tier(a) - tier(b);
    if (roleRank(a.role) !== roleRank(b.role)) return roleRank(a.role) - roleRank(b.role);
    return a.handle.localeCompare(b.handle);
  });
}

/** The team a player belongs to. Throws if the roster references an unknown team. */
export function teamOf(player: Player): Team {
  const team = findTeam(player.teamId);
  if (team) return team;
  throw new HexaError('TEAM_NOT_FOUND', `Player "${player.handle}" references unknown team "${player.teamId}".`, {
    hint: 'The roster and the team table are out of sync — run validateRoster().',
    details: { playerId: player.id, teamId: player.teamId },
  });
}

/**
 * The five starters, in `ROLE_ORDER` (top → jungle → mid → bot → support),
 * ready to drop straight into a lineup layout. Substitutes and staff are
 * excluded; see {@link playersByTeam} for the full squad.
 */
export function rosterOf(teamId: string): Player[] {
  const id = findTeam(teamId)?.id ?? teamId;
  return PLAYERS.filter((p) => p.teamId === id && isStarter(p) && roleRank(p.role) < ROLE_ORDER.length).sort(
    (a, b) => roleRank(a.role) - roleRank(b.role),
  );
}

/** Cheap Levenshtein distance, capped work for short strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, substitution);
    }
    prev = cur;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

function scorePlayer(player: Player, key: string): number {
  if (key.length === 0) return 0;

  const handle = normalizeKey(player.handle);
  const id = normalizeKey(player.id);
  const fullName = normalizeKey(player.fullName);
  const native = player.nativeName ? normalizeKey(player.nativeName) : '';
  const aliases = player.aliases.map(normalizeKey);

  let score = 0;

  if (handle === key || id === key || fullName === key || native === key || aliases.includes(key)) {
    score = 1000;
  } else if (handle.startsWith(key)) {
    score = 700 - (handle.length - key.length);
  } else if (fullName.startsWith(key) || native.startsWith(key)) {
    score = 600 - (fullName.length - key.length);
  } else if (aliases.some((a) => a.startsWith(key))) {
    score = 550;
  } else if (handle.includes(key)) {
    score = 450;
  } else if (fullName.includes(key) || native.includes(key) || aliases.some((a) => a.includes(key))) {
    score = 350;
  } else {
    // Near-miss typo tolerance against the handle, then the legal name.
    const budget = Math.max(1, Math.floor(key.length / 3));
    const handleDistance = levenshtein(key, handle);
    const nameDistance = levenshtein(key, fullName);
    const best = Math.min(handleDistance, nameDistance);
    if (best <= budget) score = 250 - best * 40;
  }

  // An exact team match is a strong independent signal: `searchPlayers('g2')`
  // should surface G2's squad ahead of a player from another org who merely
  // carries a `g2-…` legacy alias.
  const team = findTeam(player.teamId);
  if (team && teamKeys(team).includes(key)) {
    score = Math.max(score, 650);
  }

  if (score === 0) {
    // Fall back to role-, nationality- and champion-scoped matches so
    // `searchPlayers('support')` is useful too.
    if (normalizeKey(player.role) === key) score = 150;
    else if (normalizeKey(player.nationality) === key) score = 120;
    else if (player.signatureChampions.some((c) => normalizeKey(c) === key)) score = 110;
    else if (player.tags?.some((t) => normalizeKey(t) === key)) score = 100;
  }

  if (score > 0) {
    if (player.active) score += 25;
    if (isStarter(player)) score += 15;
  }

  return score;
}

/**
 * Fuzzy, ranked player search for interactive use. Exact hits rank first,
 * then prefixes, then substrings, then close typos; ties break toward active
 * starters. Returns `[]` when nothing scores.
 */
export function searchPlayers(query: string, limit = 10): Player[] {
  const key = normalizeKey(query);
  if (!key || limit <= 0) return [];

  return PLAYERS.map((player) => ({ player, score: scorePlayer(player, key) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.player.active !== b.player.active) return a.player.active ? -1 : 1;
      return a.player.handle.localeCompare(b.player.handle);
    })
    .slice(0, limit)
    .map(({ player }) => player);
}
