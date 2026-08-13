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
 * ## Before you publish anything from here
 *
 * These are real people's legal names and real people's achievements, and none
 * of it was read from a primary source — the wikis and lolesports are blocked
 * by this environment's egress proxy. Everything came from web search results.
 *
 * ```ts
 * import { unverifiedPlayers, verificationOf } from '@hexa/data';
 *
 * unverifiedPlayers();      // rows still carrying unverified/disputed fields
 * verificationOf('ryu');    // per-field confidence + the URLs behind it
 * ```
 *
 * Data provenance, the accuracy policy and the re-verification procedure live
 * in `./roster.ts` and `./verification.ts`; the honest summary is in
 * `../README.md`. Run `validateRoster()` after editing anything — it now fails
 * on any player carrying career highlights with no sources.
 */

export { TEAMS, TEAM_COLOR_VERIFICATION } from './teams.js';

export {
  PLAYERS,
  ROSTER_SOURCED_AT,
  ROSTER_SOURCES,
  BLOCKED_SOURCES,
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

export {
  VERIFICATION,
  VERIFIABLE_FIELDS,
  confidenceOf,
  sourceCount,
  unverifiedPlayers,
  verificationOf,
  verificationSources,
  verifiedPlayers,
} from './verification.js';

export type {
  Confidence,
  FieldVerification,
  PlayerVerification,
  VerifiableField,
  VerifiedPlayer,
} from './verification.js';
