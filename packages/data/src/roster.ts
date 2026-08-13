/**
 * The assembled roster.
 *
 * ============================================================================
 * READ THIS BEFORE YOU TRUST A ROW
 * ============================================================================
 *
 * **Rosters change.** Players get traded mid-split, benched over a weekend,
 * retire into military service, or swap roles between seasons. Everything in
 * `./players/*.ts` is a snapshot of a moving target, taken on the date below.
 * Treat it as a starting point that needs auditing, not as ground truth that
 * ages well.
 *
 * `sourcedAt` — 2026-08-13. See {@link ROSTER_SOURCED_AT}.
 *
 * ## How to re-verify
 *
 * 1. **Start at the wiki.** Liquipedia (`liquipedia.net/leagueoflegends/<Team>`)
 *    and Leaguepedia (`lol.fandom.com/wiki/<Team>`) both keep dated roster
 *    tables with a "Former" section. They are the fastest way to see whether a
 *    row is stale.
 * 2. **Confirm against a transfer report.** Sheep Esports, Inven Global and
 *    Esports Insider cover LCK/LEC rostermania and mid-season trades; a wiki
 *    edit without a report behind it is worth a second look.
 * 3. **Confirm the *current starter*, not just the contract.** Teams that
 *    carry two players in one role (KT Rolster ran Pollu and Ghost at support
 *    through 2026) will rotate them. The `'starter'` tag encodes who is
 *    expected to start; `active: true` without `'starter'` means "on the
 *    roster, not in the starting five".
 * 4. **Check the match feed.** gol.gg and lolesports.com show who actually
 *    played the most recent series — the last word on a contested lineup.
 * 5. **Run the integrity pass.** `validateRoster()` catches the mechanical
 *    mistakes (duplicate ids, unknown team, a team without exactly five
 *    starters). It cannot catch a wrong fact, only a broken shape.
 *
 * ## Accuracy policy applied to this data
 *
 * - Legal names, Hangul, achievements and jersey numbers are only present when
 *   they were verified against a source. **An optional field is omitted rather
 *   than guessed.** No LCK/LEC org in this set publishes jersey numbers, so
 *   `jerseyNumber` is absent throughout — that is deliberate, not an oversight.
 * - `joinedAt` uses reduced-precision ISO 8601 (`YYYY`, `YYYY-MM`) when only
 *   the season or transfer window is known. Full `YYYY-MM-DD` means the exact
 *   date was reported.
 * - `signatureChampions` is editorial: champions the player is publicly
 *   identified with, used only for FX theming. It is not a statistical
 *   champion pool and nothing in the pipeline should treat it as one.
 * - `careerHighlights` are titles and placements, not narrative claims.
 *
 * @see ./validate.ts for the integrity pass.
 */

import type { Player } from '@hexa/core';

import { T1_PLAYERS } from './players/t1.js';
import { HLE_PLAYERS } from './players/hle.js';
import { GENG_PLAYERS } from './players/geng.js';
import { KT_PLAYERS } from './players/kt.js';
import { DPLUS_PLAYERS } from './players/dplus.js';
import { KC_PLAYERS } from './players/kc.js';
import { G2_PLAYERS } from './players/g2.js';

/** ISO date this roster snapshot was researched and last verified. */
export const ROSTER_SOURCED_AT = '2026-08-13';

/**
 * Every URL consulted while building this snapshot, so the data is auditable.
 * Grouped roughly by what each one was used for.
 */
export const ROSTER_SOURCES: string[] = [
  // Wikis — roster tables, real names, native-script names, team history
  'https://liquipedia.net/leagueoflegends/T1',
  'https://liquipedia.net/leagueoflegends/Hanwha_Life_Esports',
  'https://liquipedia.net/leagueoflegends/Gen.G_Esports',
  'https://liquipedia.net/leagueoflegends/KT_Rolster',
  'https://liquipedia.net/leagueoflegends/Dplus',
  'https://liquipedia.net/leagueoflegends/Karmine_Corp',
  'https://liquipedia.net/leagueoflegends/G2_Esports',
  'https://lol.fandom.com/wiki/LCK/2026_Season/Cup/Team_Rosters',

  // 2026 roster confirmations
  'https://www.sheepesports.com/en/all/articles/lol-t1-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-hanwha-life-esports-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-gen-g-s-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-kt-rolster-s-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-dplus-kia-s-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-karmine-corp-s-completed-2026-lec-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-g2-esports-completed-2026-lec-roster/en',
  'https://esportsinsider.com/2025/11/every-confirmed-lck-roster-2026-league-of-legends',
  'https://esportsinsider.com/2026/01/karmine-corp-unveils-lec-and-vct-2026-rosters',
  'https://esports-news.co.uk/2025/11/25/g2-esports-retain-lol-roster-for-lec-2026/',

  // Transfers and mid-season moves
  'https://esportsinsider.com/2025/11/peyz-joins-t1-2026-lck-league-of-legends',
  'https://esportsinsider.com/2025/11/geng-canyon-resigning-hanwha-life-esports-viper-departure',
  'https://esportsinsider.com/2025/11/kt-rolster-geng-deokdam-peter-canyon-departures',
  'https://www.invenglobal.com/articles/19909/canyon-re-signs-with-geng-commits-to-2026-worlds-championship-push',
  'https://www.invenglobal.com/articles/24302/aiming-leaves-kt-rolster-for-krx-following-internal-conflict-traded-for-jiwoo',
  'https://www.sheepesports.com/en/all/articles/jiwoo-joins-kt-rolster-as-aiming-heads-the-other-way-to-kiwoom-drx/en',
  'https://www.sheepesports.com/en/all/articles/lol-lck-ghost-and-pollu-join-kt-rolster-as-supports/en',
  'https://esports-news.co.uk/2025/11/24/dplus-kia-sign-former-t1-bot-laner/',
  'https://esports.gg/news/league-of-legends/mikyx-part-ways-with-g2-esports/',

  // Coaching staff
  'https://www.sheepesports.com/en/all/articles/t1-announce-kkoma-hiatus-tom-to-lead-as-interim-head-coach/en',
  'https://www.sheepesports.com/us/lol/articles/lol-cvmax-promoted-dplus-kia-head-coach-for-2026/en',
  'https://www.sheepesports.com/en/all/articles/sources-reapered-set-to-join-karmine-corp-as-head-coach-for-the-2026-season/en',
  'https://www.invenglobal.com/articles/20354/lck-2026-media-day-geng-named-overwhelming-title-favourite-as-geng-picks-t1',

  // Results used for careerHighlights
  'https://esportsinsider.com/2025/11/t1-wins-league-of-legends-lol-worlds-2025',
  'https://www.koreaherald.com/article/10806145',
  'https://www.sheepesports.com/en/all/articles/hanwha-life-esports-crowned-msi-2026-champion-after-3-2-against-bilibili-gaming/en',
  'https://esportsworldcup.com/en/press-releases/dplus-kia-win-lol-at-ewc26',
  'https://www.koreajoongangdaily.com/sports/dplus-kia-wins-esports-world-cup-league-of-legends-title/12780581',
  'https://www.invenglobal.com/articles/19713/geng-wins-lck-2025-season-playoffs',
  'https://www.invenglobal.com/articles/18832/geng-crowned-champions-of-msi-2024-lehends-named-mvp',
  'https://www.invenglobal.com/articles/12616/worlds-2020-dwg-canyon-wins-finals-mvp-we-worked-harder-than-any-other-team',
  'https://win.gg/g2-esports-comeback-karmine-corp-win-lec-spring-2026/',
  'https://egamersworld.com/lol/news/32882/lec-versus-2026-finals-recap-g2-esports-claim-titl--PtJZ8KyV',
  'https://egamersworld.com/lol/news/26642/karmine-corp-dominates-g2-esports-3-0-to-win-lec-w-t4AmXuKdL',
  'https://en.wikipedia.org/wiki/Kanavi_(gamer)',

  // Brand colour references (see ./teams.ts)
  'https://www.brandcolorcode.com/t1',
  'https://teamcolorcodes.com/gen-g-esports-colors/',
  'https://teamcolorcodes.com/g2-esports-colors/',
  'https://logotyp.us/logo/hanwha/',
  'https://en.namu.wiki/w/Dplus%20Kia',
  'https://brandfetch.com/karminecorp.fr',
  'https://corp.kt.com/eng/html/intro/design/design.html',
];

/** Every player Hexa ships with, active and historical. */
export const PLAYERS: Player[] = [
  ...T1_PLAYERS,
  ...HLE_PLAYERS,
  ...GENG_PLAYERS,
  ...KT_PLAYERS,
  ...DPLUS_PLAYERS,
  ...KC_PLAYERS,
  ...G2_PLAYERS,
];

export {
  T1_PLAYERS,
  HLE_PLAYERS,
  GENG_PLAYERS,
  KT_PLAYERS,
  DPLUS_PLAYERS,
  KC_PLAYERS,
  G2_PLAYERS,
};
