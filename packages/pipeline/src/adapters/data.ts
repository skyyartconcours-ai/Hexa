/**
 * @hexa/data adapter — the roster database.
 *
 * The only value added over calling the package directly is error quality: a
 * mistyped handle should say "did you mean Peyz?", not throw a bare lookup miss.
 */

import { HexaError, didYouMean } from '@hexa/core';
import type { Player, Region, Role, Team, TeamId } from '@hexa/core';
import { loadModule } from './load.js';
import { DATA_EXPORTS, type DataModule, type PlayerFilter } from './contracts.js';

const SPEC = '@hexa/data';
const HINT = 'The roster database package is not built. Run: pnpm --filter @hexa/data build';

async function mod(): Promise<DataModule> {
  return loadModule<DataModule>(SPEC, { needs: DATA_EXPORTS, hint: HINT });
}

/**
 * Resolve a handle, id or alias to a player.
 *
 * @throws HexaError `PLAYER_NOT_FOUND` with near-miss suggestions.
 */
export async function resolvePlayer(query: string): Promise<Player> {
  const m = await mod();
  const found = m.findPlayer(query);
  if (found) return found;

  const candidates = m.PLAYERS.flatMap((p) => [p.handle, ...(p.aliases ?? [])]);
  const suggestions = didYouMean(query, candidates);
  throw new HexaError('PLAYER_NOT_FOUND', `No player matches "${query}"`, {
    hint: suggestions.length
      ? `Did you mean: ${suggestions.join(', ')}? Run \`hexa players ${query.slice(0, 3)}\` to search.`
      : 'Run `hexa players` to list the roster, or add the player to @hexa/data.',
    details: { query, suggestions },
  });
}

/** @throws HexaError `TEAM_NOT_FOUND` */
export async function resolveTeam(query: string): Promise<Team> {
  const m = await mod();
  const found = m.findTeam(query);
  if (found) return found;

  const candidates = m.TEAMS.flatMap((t) => [t.tag, t.name, t.shortName, ...(t.aliases ?? [])]);
  const suggestions = didYouMean(query, candidates);
  throw new HexaError('TEAM_NOT_FOUND', `No team matches "${query}"`, {
    hint: suggestions.length ? `Did you mean: ${suggestions.join(', ')}?` : 'Run `hexa teams` to list known teams.',
    details: { query, suggestions },
  });
}

/**
 * The player's team. A player with a dangling `teamId` is a data bug, and the
 * pipeline needs the brand colours, so this is fatal rather than defaulted —
 * a silent grey palette would look like a design choice.
 */
export async function teamOfPlayer(player: Player): Promise<Team> {
  const m = await mod();
  const team = m.teamOf(player) ?? m.findTeam(player.teamId);
  if (team) return team;
  throw new HexaError('TEAM_NOT_FOUND', `Player ${player.handle} references unknown team "${player.teamId}"`, {
    hint: 'The roster database is inconsistent. Check the player entry in @hexa/data.',
    details: { player: player.id, teamId: player.teamId },
  });
}

export async function allPlayers(): Promise<readonly Player[]> {
  return (await mod()).PLAYERS;
}

export async function allTeams(): Promise<readonly Team[]> {
  return (await mod()).TEAMS;
}

export async function listPlayers(filter?: PlayerFilter): Promise<Player[]> {
  return (await mod()).listPlayers(filter);
}

export async function searchPlayers(query: string, limit?: number): Promise<Player[]> {
  return (await mod()).searchPlayers(query, limit);
}

/** The five starters, in role order, ready for a lineup layout. */
export async function rosterOf(team: TeamId | Team): Promise<Player[]> {
  return (await mod()).rosterOf(typeof team === 'string' ? team : team.id);
}

export async function playersByTeam(teamId: TeamId): Promise<Player[]> {
  return (await mod()).playersByTeam(teamId);
}
