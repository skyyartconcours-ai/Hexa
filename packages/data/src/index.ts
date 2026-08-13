/**
 * `@hexa/data` — the roster.
 *
 * Five LCK organisations (T1, Hanwha Life Esports, Gen.G, KT Rolster, Dplus
 * KIA) and two LEC organisations (Karmine Corp, G2 Esports): their team brand
 * kits, their players, and the name resolution that turns whatever a human
 * typed into a `Player` the pipeline can bind reference photography to.
 *
 * ```ts
 * import { requirePlayer, teamOf, rosterOf } from '@hexa/data';
 *
 * const peyz = requirePlayer('peyz');      // also: 'Kim Su-hwan', '김수환'
 * const t1 = teamOf(peyz);                 // brand kit for the lighting rig
 * const lineup = rosterOf('T1');           // five starters in ROLE_ORDER
 * ```
 *
 * Data provenance, the accuracy policy and the re-verification procedure live
 * in `./roster.ts`. Run `validateRoster()` after editing anything.
 */

export { TEAMS } from './teams.js';

export {
  PLAYERS,
  ROSTER_SOURCED_AT,
  ROSTER_SOURCES,
  T1_PLAYERS,
  HLE_PLAYERS,
  GENG_PLAYERS,
  KT_PLAYERS,
  DPLUS_PLAYERS,
  KC_PLAYERS,
  G2_PLAYERS,
} from './roster.js';

export {
  findPlayer,
  findTeam,
  requirePlayer,
  requireTeam,
  listPlayers,
  playersByTeam,
  teamOf,
  rosterOf,
  searchPlayers,
  normalizeKey,
} from './lookup.js';

export type { PlayerFilter } from './lookup.js';

export { validateRoster } from './validate.js';
