/**
 * The assembled roster.
 *
 * ============================================================================
 * ⚠ THIS FILE DESCRIBES REAL, LIVING PEOPLE. READ THIS BEFORE YOU TRUST A ROW.
 * ============================================================================
 *
 * **Nothing here was read from a primary source.** Liquipedia, Leaguepedia,
 * lolesports.com and Wikipedia are all blocked by this environment's egress
 * proxy — every request returns HTTP 403 or EGRESS_BLOCKED. This dataset was
 * built, and then independently re-audited on 2026-08-13, entirely from web
 * **search results**: publisher headlines, article snippets, and the canonical
 * name strings that wikis expose in their page titles.
 *
 * That is a real limitation, not a formality. It means:
 *
 * - A field marked `'confirmed'` means "two independent publishers said so in
 *   search results on 2026-08-13". It does not mean an editor checked a primary
 *   source.
 * - Several Korean legal names are **disputed** between outlets. Where sources
 *   split, both readings are recorded and the field is marked `disputed` — see
 *   Delight, Ryu, Cuzz, Zeka, Peyz, Smash, Career, Gumayusi.
 * - Ryu's `nativeName` was **deleted** rather than guessed: sources disagree on
 *   whether his surname is 유 or 류, and his handle collides with one reading.
 *
 * **Per-field provenance, source URLs and confidence live in
 * `./verification.ts`.** Call `unverifiedPlayers()` for the list of rows that
 * still carry unverified or disputed fields. Read `../README.md` before
 * publishing any of this.
 *
 * **Rosters change.** Players get traded mid-split, benched over a weekend,
 * retire into military service, or swap roles between seasons. KT Rolster
 * changed its bot lane *and* its support between January and August 2026. Treat
 * every row as a starting point that needs auditing, not as ground truth that
 * ages well.
 *
 * `sourcedAt` — 2026-08-13. See {@link ROSTER_SOURCED_AT}.
 *
 * ## How to re-verify
 *
 * 1. **Start at the wiki, from a network that can reach it.** Liquipedia
 *    (`liquipedia.net/leagueoflegends/<Team>`) and Leaguepedia
 *    (`lol.fandom.com/wiki/<Team>`) both keep dated roster tables with a
 *    "Former" section. They are the fastest way to see whether a row is stale,
 *    and they are the sources this audit could *not* use.
 * 2. **Confirm against a transfer report.** Sheep Esports, Inven Global and
 *    Esports Insider cover LCK/LEC rostermania and mid-season trades; a wiki
 *    edit without a report behind it is worth a second look.
 * 3. **Confirm the *current starter*, not just the contract.** This is where
 *    the 2026-08-13 audit found the worst error: KT signed Pollu and Ghost as a
 *    rotating support pair, and this dataset recorded Pollu as the starter — but
 *    Effort had taken the job during Spring and was not in the data at all.
 *    A signing announcement is not a lineup.
 * 4. **Check the match feed.** gol.gg and lolesports.com show who actually
 *    played the most recent series — the last word on a contested lineup.
 * 5. **Run the integrity pass.** `validateRoster()` catches mechanical mistakes
 *    (duplicate ids, unknown team, a team without exactly five starters, and —
 *    since the audit — any player carrying career highlights with no sources
 *    behind them). It cannot catch a wrong fact, only a broken shape.
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
 *   champion pool and nothing in the pipeline should treat it as one. It is
 *   **not** audited in `./verification.ts`.
 * - `careerHighlights` are titles and placements, not narrative claims. The
 *   2026-08-13 audit deleted every line that was editorial ("widely regarded
 *   as…", "the team's mechanical prodigy") or that no source supported.
 * - Where a claim survives on one source only, it says so inline —
 *   "(reported, not re-sourced)".
 *
 * @see ./verification.ts for per-field provenance.
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
 * Domains this environment's egress proxy blocks. No page on any of them could
 * be fetched and read while building or auditing this data. Several are the
 * sources you would normally reach for first; that is the single biggest
 * weakness of this dataset.
 *
 * Verified blocked on 2026-08-13:
 * `curl -sS -o /dev/null -w "%{http_code}" https://liquipedia.net/leagueoflegends/T1`
 * returns a CONNECT tunnel failure (403).
 *
 * Note: a few of these hosts still appear as *citations* in
 * `./verification.ts`, because web search surfaced their page titles and
 * snippets even though the pages themselves were unreachable. A wiki page title
 * of the form "Zeka (Kim Geon-woo) — Leaguepedia" is real evidence about a name
 * spelling; it is not the same as having read the article, and it is weighted
 * accordingly. `ROSTER_SOURCES` below deliberately contains no blocked host.
 */
export const BLOCKED_SOURCES: string[] = [
  'https://liquipedia.net/',
  'https://lol.fandom.com/',
  'https://lolesports.com/',
  'https://en.wikipedia.org/',
  'https://escharts.com/',
  'https://teamcolorcodes.com/',
  'https://esportteamcolors.com/',
];

/**
 * Every URL this snapshot and its 2026-08-13 re-audit actually relied on.
 *
 * These are the pages that carried the claims, as surfaced through web search.
 * Wiki URLs appear where the wiki *page title* carried the canonical name
 * string (search exposes titles even when the page body is unreachable) — they
 * are listed for traceability, not because the page was read.
 *
 * `verificationSources()` in `./verification.ts` derives the same list from the
 * per-field audit, so the two can be diffed.
 */
export const ROSTER_SOURCES: string[] = [
  // ── 2026 rosters ─────────────────────────────────────────────────────────
  'https://www.sheepesports.com/en/all/articles/lol-hanwha-life-esports-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-gen-g-s-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-kt-rolster-s-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-dplus-kia-s-completed-2026-lck-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-karmine-corp-s-completed-2026-lec-roster/en',
  'https://www.sheepesports.com/en/all/articles/lol-g2-esports-completed-2026-lec-roster/en',
  'https://esportsinsider.com/2025/11/every-confirmed-lck-roster-2026-league-of-legends',
  'https://esportsinsider.com/2026/01/karmine-corp-unveils-lec-and-vct-2026-rosters',
  'https://esports-news.co.uk/2025/11/25/g2-esports-retain-lol-roster-for-lec-2026/',
  'https://egamersworld.com/lol/news/31707/karmine-corp-announce-their-2026-roster-edpW023tV',
  'https://sccgmanagement.com/sccg-news/2025/12/01/gen-g-finalizes-its-2026-lck-lineup/',
  'https://www.strafe.com/news/read/gen-g-announce-full-roster-lck-2025/',

  // ── Transfers and mid-season moves ───────────────────────────────────────
  'https://esportsinsider.com/2025/11/peyz-joins-t1-2026-lck-league-of-legends',
  'https://esports-news.co.uk/2025/11/19/t1-sign-peyz-for-the-2026-season/',
  'https://gamedaily.com/news/peyz-joins-t1-as-their-new-bot-laner-returns-to-lck-for-league-of-legends-2026-season',
  'https://www.sheepesports.com/en/all/articles/lol-lck-gumayusi-joins-hanwha-life-esports/en',
  'https://egamersworld.com/lol/news/30721/gumayusi-officially-becomes-the-new-adc-of-hanwha--CRku_kA7n',
  'https://www.hotspawn.com/league-of-legends/news/gumayusi-joins-hanwha-life-esports-to-complete-2026-roster',
  'https://esportsinsider.com/2025/11/hanwha-life-esports-zeus-zeka-2026',
  'https://www.sheepesports.com/en/all/articles/lol-zeus-re-signs-with-hanwha-life-esports/en',
  'https://esportsinsider.com/2025/11/geng-canyon-resigning-hanwha-life-esports-viper-departure',
  'https://egamersworld.com/lol/news/30913/viper-joins-bilibili-gaming-for-the-2026-season-aVKkclhr3',
  'https://www.invenglobal.com/articles/19909/canyon-re-signs-with-geng-commits-to-2026-worlds-championship-push',
  'https://www.sheepesports.com/en/all/articles/jiwoo-joins-kt-rolster-as-aiming-heads-the-other-way-to-kiwoom-drx/en',
  'https://www.invenglobal.com/articles/24302/aiming-leaves-kt-rolster-for-krx-following-internal-conflict-traded-for-jiwoo',
  'https://insider-gaming.com/kt-rolster-krx-aiming-jiwoo-swap/',
  'https://egamersworld.com/lol/news/36454/aiming-traded-to-krx-kt-rolster-signs-jiwoo-after--k_9kQSqAx',
  'https://www.sheepesports.com/en/all/articles/aiming-speaks-out-on-his-departure-from-kt-rolster/en',
  'https://www.sheepesports.com/en/all/articles/lol-lck-ghost-and-pollu-join-kt-rolster-as-supports/en',
  'https://egamersworld.com/lol/news/30650/pollu-and-ghost-the-new-supports-of-kt-rolster-la8Cykuup',
  'https://www.sheepesports.com/en/all/articles/kt-challengers-ghost-returns-to-adc-ahead-of-lck-cl-rounds-3-4/en',
  'https://rft.gg/news/kt-rolster-ghost-adc-lck-2026',
  'https://esportsinsider.com/2025/11/kt-rolster-geng-deokdam-peter-canyon-departures',
  'https://esportbet.com/dn-freecs-sign-kt-rolsters-bottom-lane-duo/',
  'https://esports-news.co.uk/2025/11/24/dplus-kia-sign-former-t1-bot-laner/',
  'https://www.hotspawn.com/league-of-legends/news/smash-joins-dplus-kia',
  'https://www.sheepesports.com/en/all/articles/lol-career-joins-dplus-kia/en',
  'https://www.sheepesports.com/en/all/articles/sources-kyeahoo-set-to-join-karmine-corp-as-the-team-s-new-midlaner/en',
  'https://esportsinsider.com/2025/12/fnatic-vladi-signing-lec-2026',
  'https://www.sheepesports.com/en/all/articles/sources-fnatic-and-karmine-corp-have-agreed-on-vladi-s-buyout/en',
  'https://esports.gg/news/league-of-legends/mikyx-part-ways-with-g2-esports/',
  'https://www.hotspawn.com/league-of-legends/news/official-mikyx-says-farewell-to-g2',
  'https://esportsinsider.com/2025/10/fnatic-mikyx-departure-league-of-legends',
  'https://esports-news.co.uk/2025/12/10/lec-legend-jankos-returns-to-g2-esports/',
  'https://esportsinsider.com/2026/02/g2-esports-skewmond-contract-extension-2028',
  'https://www.gosugamers.net/lol/news/78340-keria-signs-new-contract-with-t1-through-2029',

  // ── Retirements and military service ─────────────────────────────────────
  'https://esportsinsider.com/2025/09/peanut-announces-leaving-lol-2026',
  'https://esports-news.co.uk/2025/10/28/peanut-jungler-retires-from-lol-esports-after-hle-worlds-exit/',
  'https://www.sheepesports.com/en/all/articles/lol-peanut-announced-that-he-will-begin-his-military-service-in-2026/en',
  'https://www.sheepesports.com/en/all/articles/lol-deft-joins-the-military-service-and-bids-farewell-on-stream-a-legend-of-the-game/en',
  'https://www.gosugamers.net/lol/news/72860-league-of-legends-deft-confirms-military-service-in-2025',

  // ── Coaching staff ───────────────────────────────────────────────────────
  'https://www.sheepesports.com/en/all/articles/t1-announce-kkoma-hiatus-tom-to-lead-as-interim-head-coach/en',
  'https://insider-gaming.com/t1-coach-tom-interim/',
  'https://www.gosugamers.net/lol/news/78159-league-of-legends-t1-head-coach-kkoma-takes-temporary-break',
  'https://www.strafe.com/news/read/mata-returns-to-t1-as-coach/',
  'https://www.sheepesports.com/en/all/articles/lol-homme-joins-hle-as-head-coach-for-the-2026-lck-season-mowgli-renews/en',
  'https://bo3.gg/lol/news/homme-became-the-head-coach-of-hanwha-life-esports',
  'https://www.invenglobal.com/articles/12639/the-head-coach-for-jdg-homme-parts-ways-with-the-organization-after-two-years-of-tenure',
  'https://www.sheepesports.com/en/all/articles/lol-lck-ryu-leaves-bnk-fearx-to-join-gen-g-as-head-coach/en',
  'https://gamedaily.com/news/gen-g-signs-ryu-as-the-new-head-coach-of-their-league-of-legends-team',
  'https://www.sheepesports.com/us/lol/articles/lol-cvmax-promoted-dplus-kia-head-coach-for-2026/en',
  'https://www.sheepesports.com/en/all/articles/sources-reapered-set-to-join-karmine-corp-as-head-coach-for-the-2026-season/en',
  'https://www.sheepesports.com/en/all/articles/sources-zeph-set-to-join-karmine-corp-in-the-lec-as-assistant-coach/en',
  'https://www.team-aaa.com/fr/actualite/mercato-lol-karmine-corp-recruterait-zeph-comme-assistant-coach_135006',
  'https://www.invenglobal.com/articles/21036/kt-rolster-head-coach-go-dong-bin-on-6-game-winning-streak-we-wont-get-complacent-well-keep-the-momentum-going',

  // ── Results used for careerHighlights ────────────────────────────────────
  'https://esportsinsider.com/2025/11/t1-wins-league-of-legends-lol-worlds-2025',
  'https://egamersworld.com/lol/news/30460/t1-crowned-worlds-2025-champions-after-defeating-k-Rj07outwu',
  'https://www.invenglobal.com/articles/18655/zeus-is-your-worlds-2023-finals-mvp',
  'https://www.oneesports.gg/league-of-legends/t1-zeus-2023-worlds-finals-mvp/',
  'https://www.oneesports.gg/league-of-legends/faker-worlds-2024-final-mvp/',
  'https://esports.gg/news/league-of-legends/list-of-faker-individual-award/',
  'https://www.oneesports.gg/league-of-legends/faker-lol-list-achievements/',
  'https://www.koreaherald.com/article/10806145',
  'https://www.sheepesports.com/us/lol/articles/hanwha-life-esports-crowned-msi-2026-champion-after-3-2-against-bilibili-gaming/en',
  'https://dotesports.com/league-of-legends/news/hanwha-life-esports-win-msi-2026',
  'https://esportsinsider.com/2025/07/gen-g-msi-2025-title-t1-finals',
  'https://www.invenglobal.com/articles/19462/geng-defeats-t1-to-capture-2025-msi-crown-chovy-named-series-mvp-press-conference',
  'https://www.invenglobal.com/articles/19460/gengs-duro-and-ruler-highlight-teamwork-and-fan-support-after-msi-triumph',
  'https://www.invenglobal.com/articles/18832/geng-crowned-champions-of-msi-2024-lehends-named-mvp',
  'https://www.oneesports.gg/league-of-legends/gen-g-msi-2024-champions/',
  'https://www.sportskeeda.com/esports/bilibili-gaming-vs-t1-league-legends-msi-2024-lower-bracket-final-head-to-head-livestream-details',
  'https://www.invenglobal.com/articles/19713/geng-wins-lck-2025-season-playoffs',
  'https://gamedaily.com/news/gen-g-win-lck-2025-season-playoffs-grand-finals',
  'https://dotesports.com/league-of-legends/news/kt-rolster-are-your-2018-lck-summer-split-champions',
  'https://www.espn.com/gaming/story/_/id/19497135/longzhu-debuts-three-new-players-success-kt-rolster',
  'https://esportsworldcup.com/en/press-releases/dplus-kia-win-lol-at-ewc26',
  'https://www.koreajoongangdaily.com/sports/dplus-kia-wins-esports-world-cup-league-of-legends-title/12780581',
  'https://www.gosugamers.net/lol/news/78825-dplus-kia-crowned-2026-league-of-legends-esports-world-cup-champions-after-defeating-karmine-corp',
  'https://win.gg/g2-esports-comeback-karmine-corp-win-lec-spring-2026/',
  'https://egamersworld.com/lol/news/35328/g2-esports-clinch-back-to-back-title-a-hard-fought-v3R9NnCzi',
  'https://egamersworld.com/lol/news/32882/lec-versus-2026-finals-recap-g2-esports-claim-titl--PtJZ8KyV',
  'https://www.gamereactor.eu/esports/1683103/LEC+Versus+2026+G2+Esports+defeats+Karmine+Corp+to+earn+First+Stand+Tournament+slot/',
  'https://egamersworld.com/lol/news/26642/karmine-corp-dominates-g2-esports-3-0-to-win-lec-w-t4AmXuKdL',
  'https://www.strafe.com/news/read/all-2025-lec-spring-season-awards/',
  'https://www.sheepesports.com/en/all/articles/how-many-titles-did-caps-win/en',
  'https://www.invenglobal.com/articles/18693/2023-lck-awards-gen-peyz-named-rookie-of-the-year',
  'https://www.oneesports.gg/league-of-legends/peyz-lck-spring-2023-finals/',
  'https://dotesports.com/league-of-legends/news/t1-peyz-youngest-all-time-pentakill-leader',
  'https://www.yahoo.com/news/asian-games-2023-south-korea-win-gold-for-league-of-legends-with-2-0-sweep-over-chinese-taipei-125012355.html',
  'https://www.invenglobal.com/articles/20395/kt-rolster-sweep-t1-2-0-in-lck-2026-regular-season-opener',

  // ── Name and profile references ──────────────────────────────────────────
  // Aggregator/stat profiles. Weaker than a wiki, and often derivative of one —
  // never counted as two independent sources when they agree with each other.
  'https://ggscore.com/en/lol/player/oner',
  'https://ggscore.com/en/lol/player/peyz',
  'https://ggscore.com/en/lol/player/zeka',
  'https://ggscore.com/en/lol/player/kanavi',
  'https://ggscore.com/en/lol/player/crescent',
  'https://ggscore.com/en/lol/player/kiin',
  'https://ggscore.com/en/lol/player/canyon',
  'https://ggscore.com/en/lol/player/chovy',
  'https://ggscore.com/en/lol/player/bdd',
  'https://ggscore.com/en/lol/player/pollu',
  'https://ggscore.com/en/lol/player/aiming',
  'https://ggscore.com/en/lol/player/lehends',
  'https://ggscore.com/en/lol/player/targamas',
  'https://ggscore.com/en/lol/player/caps',
  'https://bo3.gg/lol/players/keria-1',
  'https://bo3.gg/lol/players/effort',
  'https://bo3.gg/lol/players/jiwoo',
  'https://bo3.gg/lol/players/career',
  'https://egamersworld.com/lol/player/effort-E1clb8NfgIc-',
  'https://egamersworld.com/lol/player/kyeahoo-A-IrjzxHmn',
  'https://egamersworld.com/lol/player/duro-N17PYpxqqT',
  'https://g2esports.com/blogs/team-member/broken-blade',
  'https://g2esports.com/blogs/team-member/skewmond',
  'https://g2esports.com/blogs/team-member/labrov',
  'https://g2esports.com/pages/team-member/hans-sama',
  'https://g2esports.com/pages/team-member/memento',
  'https://www.rtbf.be/article/championnats-de-league-of-legends-qui-est-targamas-le-belge-a-la-premiere-place-avec-la-karmine-corp-11512062',
  'https://esports.gg/guides/league-of-legends/who-is-kc-canna/',
  'https://www.primeleague.gg/en/teams/24126-dplus-kia',

  // ── Brand colour references (see ./teams.ts) ─────────────────────────────
  // Only T1, Gen.G, G2 and Dplus KIA could be confirmed. KT, Hanwha Life and
  // Karmine Corp hex values remain UNVERIFIED — see TEAM_COLOR_VERIFICATION.
  'https://www.brandcolorcode.com/t1',
  'https://sportsfancovers.com/esports-colors/t1-team-colors/',
  'https://www.brandcolorcode.com/g2-esports',
  'https://en.namu.wiki/w/Dplus%20Kia/%EC%9C%A0%EB%8B%88%ED%8F%BC',
  'https://sportsfancovers.com/esports-colors/hanwha-life-esports-team-colors/',
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
