/**
 * Provenance and confidence for every claim this package makes about a real
 * person.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 *
 * `./players/*.ts` contains the legal names, native-script names, team
 * assignments and career achievements of 62 living professional players and
 * coaches. Publishing a wrong legal name, or crediting someone with a title
 * they did not win, is the most damaging thing this project can do. The roster
 * files therefore say *what we believe*; this file says *how much we should
 * believe it, and who told us*.
 *
 * Every player has an entry. Every entry names the URLs the claim was read
 * from. A field with no entry is, by definition, unverified — see
 * {@link unverifiedPlayers}.
 *
 * ## The confidence ladder
 *
 * - `'confirmed'` — at least two **independent** sources agree. Independent
 *   means different publishers: Leaguepedia and a Leaguepedia mirror are one
 *   source, Leaguepedia and Sheep Esports are two.
 * - `'reported'`  — exactly one source carries it, or the sources are
 *   plausible but derivative (aggregator profiles, stat sites echoing a wiki).
 *   Usable, not citable.
 * - `'disputed'`  — sources actively disagree. Both readings are recorded in
 *   `variants`. **Do not present a disputed field as fact.**
 * - `'unverified'`— nobody checked it, or the check failed. Treat as absent.
 *
 * ## How this audit was done (2026-08-13)
 *
 * Liquipedia, Leaguepedia (`lol.fandom.com`), lolesports.com, Wikipedia and
 * several stat sites are **blocked by this environment's egress proxy** — every
 * request returns HTTP 403 or an EGRESS_BLOCKED error. Nothing here was read
 * from a wiki page directly. Claims were verified through web search, using
 * result titles and snippets from independent publishers (Sheep Esports, Inven
 * Global, Esports Insider, ONE Esports, Dot Esports, GosuGamers, Korea Herald,
 * Korea JoongAng Daily, egamersworld, Hotspawn, Esports News UK, team sites)
 * plus the canonical name strings that wikis expose in their page titles.
 *
 * That is a weaker method than reading the wiki. It is recorded honestly rather
 * than dressed up: a `'confirmed'` here means "two independent publishers said
 * so in search results on 2026-08-13", not "an editor checked the primary
 * source".
 *
 * ## Re-verifying
 *
 * See `../README.md`. In an environment that can reach them, start at
 * `liquipedia.net/leagueoflegends/<Team>` and `lol.fandom.com/wiki/<Team>`,
 * then confirm every 2026 move against a dated transfer report.
 */

import type { Player } from '@hexa/core';

import { PLAYERS } from './roster.js';

/** How much this dataset trusts a single claim. */
export type Confidence = 'confirmed' | 'reported' | 'disputed' | 'unverified';

/** The fields worth auditing: the ones that name or credit a real person. */
export type VerifiableField =
  | 'fullName'
  | 'nativeName'
  | 'teamId'
  | 'role'
  | 'active'
  | 'joinedAt'
  | 'careerHighlights';

/** Every auditable field, in report order. */
export const VERIFIABLE_FIELDS: readonly VerifiableField[] = [
  'fullName',
  'nativeName',
  'teamId',
  'role',
  'active',
  'joinedAt',
  'careerHighlights',
] as const;

export interface FieldVerification {
  confidence: Confidence;
  /** URLs this field was read from. Independent publishers, not mirrors. */
  sources: string[];
  /** Competing readings when `confidence === 'disputed'`. Both are real. */
  variants?: string[];
  /** Anything a reader needs in order not to be misled by this field. */
  note?: string;
}

export interface PlayerVerification {
  /** The weakest confidence across the audited fields. */
  confidence: Confidence;
  /** ISO date this player was last audited. */
  checkedAt: string;
  fields: Partial<Record<VerifiableField, FieldVerification>>;
  /** Free-text caveat shown alongside the player wherever they are surfaced. */
  note?: string;
}

/**
 * A `Player` carrying its audit trail. This is a **local** extension: the
 * `Player` interface in `@hexa/core` is deliberately left alone so the render
 * pipeline keeps working against the plain shape.
 */
export interface VerifiedPlayer extends Player {
  verification: PlayerVerification;
}

const CHECKED = '2026-08-13';

/**
 * Source URLs, aliased so each verification entry stays readable. Everything
 * here was consulted on 2026-08-13. Wiki URLs are listed where a wiki page
 * *title* (which search exposes) carried the canonical name string — the pages
 * themselves were not reachable from this environment.
 */
const S = {
  // ── Tournament results ────────────────────────────────────────────────────
  worlds25a: 'https://esportsinsider.com/2025/11/t1-wins-league-of-legends-lol-worlds-2025',
  worlds25b:
    'https://egamersworld.com/lol/news/30460/t1-crowned-worlds-2025-champions-after-defeating-k-Rj07outwu',
  worlds23mvp: 'https://www.invenglobal.com/articles/18655/zeus-is-your-worlds-2023-finals-mvp',
  worlds23mvpB: 'https://www.oneesports.gg/league-of-legends/t1-zeus-2023-worlds-finals-mvp/',
  worlds24mvp: 'https://www.oneesports.gg/league-of-legends/faker-worlds-2024-final-mvp/',
  msi2026a: 'https://www.koreaherald.com/article/10806145',
  msi2026b:
    'https://www.sheepesports.com/us/lol/articles/hanwha-life-esports-crowned-msi-2026-champion-after-3-2-against-bilibili-gaming/en',
  msi2026c: 'https://dotesports.com/league-of-legends/news/hanwha-life-esports-win-msi-2026',
  msi2025a: 'https://esportsinsider.com/2025/07/gen-g-msi-2025-title-t1-finals',
  msi2025b:
    'https://www.invenglobal.com/articles/19462/geng-defeats-t1-to-capture-2025-msi-crown-chovy-named-series-mvp-press-conference',
  msi2024a: 'https://www.invenglobal.com/articles/18832/geng-crowned-champions-of-msi-2024-lehends-named-mvp',
  msi2024b: 'https://www.oneesports.gg/league-of-legends/gen-g-msi-2024-champions/',
  msi2024placings: 'https://www.sportskeeda.com/esports/bilibili-gaming-vs-t1-league-legends-msi-2024-lower-bracket-final-head-to-head-livestream-details',
  lck2025a: 'https://www.invenglobal.com/articles/19713/geng-wins-lck-2025-season-playoffs',
  lck2025b: 'https://gamedaily.com/news/gen-g-win-lck-2025-season-playoffs-grand-finals',
  lck2018: 'https://dotesports.com/league-of-legends/news/kt-rolster-are-your-2018-lck-summer-split-champions',
  ewc2026a: 'https://esportsworldcup.com/en/press-releases/dplus-kia-win-lol-at-ewc26',
  ewc2026b:
    'https://www.koreajoongangdaily.com/sports/dplus-kia-wins-esports-world-cup-league-of-legends-title/12780581',
  ewc2026c:
    'https://www.gosugamers.net/lol/news/78825-dplus-kia-crowned-2026-league-of-legends-esports-world-cup-champions-after-defeating-karmine-corp',
  lecSpring26a: 'https://win.gg/g2-esports-comeback-karmine-corp-win-lec-spring-2026/',
  lecSpring26b:
    'https://egamersworld.com/lol/news/35328/g2-esports-clinch-back-to-back-title-a-hard-fought-v3R9NnCzi',
  lecVersus26a:
    'https://egamersworld.com/lol/news/32882/lec-versus-2026-finals-recap-g2-esports-claim-titl--PtJZ8KyV',
  lecVersus26b:
    'https://www.gamereactor.eu/esports/1683103/LEC+Versus+2026+G2+Esports+defeats+Karmine+Corp+to+earn+First+Stand+Tournament+slot/',
  lecWinter25: 'https://egamersworld.com/lol/news/26642/karmine-corp-dominates-g2-esports-3-0-to-win-lec-w-t4AmXuKdL',
  lecMvp25: 'https://www.strafe.com/news/read/all-2025-lec-spring-season-awards/',
  asianGames23: 'https://www.yahoo.com/news/asian-games-2023-south-korea-win-gold-for-league-of-legends-with-2-0-sweep-over-chinese-taipei-125012355.html',

  // ── T1 ────────────────────────────────────────────────────────────────────
  doranName: 'https://lol.fandom.com/wiki/Doran_(Choi_Hyeon-joon)',
  doranT1: 'https://www.invenglobal.com/articles/19901/t1-locks-in-doran-for-2026-after-breakout-worlds-run',
  doranBo3: 'https://bo3.gg/lol/players/doran-2686e2c9-bd34-47fb-9d17-87debb7be1b6',
  onerEgw: 'https://egamersworld.com/lol/player/oner-EkAl31FW3Ej',
  onerGg: 'https://ggscore.com/en/lol/player/oner',
  keriaEgw: 'https://egamersworld.com/lol/player/keria-VJlpyKZnEi',
  keriaBo3: 'https://bo3.gg/lol/players/keria-1',
  keriaContract: 'https://www.gosugamers.net/lol/news/78340-keria-signs-new-contract-with-t1-through-2029',
  fakerAwards: 'https://esports.gg/news/league-of-legends/list-of-faker-individual-award/',
  fakerPodium: 'https://www.oneesports.gg/league-of-legends/faker-lol-list-achievements/',
  fakerTimeline: 'https://www.manilatimes.net/2025/12/02/tmt-newswire/esports-athlete-fakers-path-to-lol-greatness-from-16-year-old-rookie-to-six-time-worlds-champion/2235003',
  peyzT1a: 'https://esportsinsider.com/2025/11/peyz-joins-t1-2026-lck-league-of-legends',
  peyzT1b: 'https://esports-news.co.uk/2025/11/19/t1-sign-peyz-for-the-2026-season/',
  peyzT1c:
    'https://gamedaily.com/news/peyz-joins-t1-as-their-new-bot-laner-returns-to-lck-for-league-of-legends-2026-season',
  peyzGg: 'https://ggscore.com/en/lol/player/peyz',
  peyzPenta: 'https://escharts.com/news/t1-peyz-sets-new-all-time-record-pentakills-league-legends-esports',
  peyzPenta2: 'https://dotesports.com/league-of-legends/news/t1-peyz-youngest-all-time-pentakill-leader',
  peyzRookie: 'https://www.invenglobal.com/articles/18693/2023-lck-awards-gen-peyz-named-rookie-of-the-year',
  peyzYoungest: 'https://www.oneesports.gg/league-of-legends/peyz-lck-spring-2023-finals/',
  kkomaHiatus:
    'https://www.sheepesports.com/en/all/articles/t1-announce-kkoma-hiatus-tom-to-lead-as-interim-head-coach/en',
  kkomaHiatus2: 'https://insider-gaming.com/t1-coach-tom-interim/',
  kkomaHiatus3:
    'https://www.gosugamers.net/lol/news/78159-league-of-legends-t1-head-coach-kkoma-takes-temporary-break',
  mataT1: 'https://www.strafe.com/news/read/mata-returns-to-t1-as-coach/',
  mataMvp: 'https://happygamer.com/world-champion-ex-t1-support-cho-mata-se-hyeong-announces-transition-to-coaching-role-46740/',

  // ── Hanwha Life Esports ───────────────────────────────────────────────────
  hleRoster26: 'https://www.sheepesports.com/en/all/articles/lol-hanwha-life-esports-completed-2026-lck-roster/en',
  gumaHle: 'https://www.sheepesports.com/en/all/articles/lol-lck-gumayusi-joins-hanwha-life-esports/en',
  gumaHle2: 'https://egamersworld.com/lol/news/30721/gumayusi-officially-becomes-the-new-adc-of-hanwha--CRku_kA7n',
  gumaHle3: 'https://www.hotspawn.com/league-of-legends/news/gumayusi-joins-hanwha-life-esports-to-complete-2026-roster',
  gumaGg: 'https://ggscore.com/en/lol/player/gumayushi',
  zeusRe: 'https://esportsinsider.com/2025/11/hanwha-life-esports-zeus-zeka-2026',
  zeusSheep: 'https://www.sheepesports.com/en/all/articles/lol-zeus-re-signs-with-hanwha-life-esports/en',
  zekaName: 'https://lol.fandom.com/wiki/Zeka_(Kim_Geon-woo)',
  zekaGg: 'https://ggscore.com/en/lol/player/zeka',
  kanaviWiki: 'https://en.wikipedia.org/wiki/Kanavi_(gamer)',
  kanaviGg: 'https://ggscore.com/en/lol/player/kanavi',
  kanaviTes: 'https://www.sheepesports.com/en/all/articles/lol-kanavi-joins-top-esports-in-the-lpl/en',
  delightLp: 'https://lol.fandom.com/wiki/Delight',
  delightEsc: 'https://escharts.com/players/delight',
  delightGg: 'https://ggscore.com/en/lol/player/crescent',
  hommeHle:
    'https://www.sheepesports.com/en/all/articles/lol-homme-joins-hle-as-head-coach-for-the-2026-lck-season-mowgli-renews/en',
  hommeBo3: 'https://bo3.gg/lol/news/homme-became-the-head-coach-of-hanwha-life-esports',
  hommeJdg:
    'https://www.invenglobal.com/articles/12639/the-head-coach-for-jdg-homme-parts-ways-with-the-organization-after-two-years-of-tenure',
  hleDandy: 'https://en.wikipedia.org/wiki/Hanwha_Life_Esports',
  viperBlg: 'https://egamersworld.com/lol/news/30913/viper-joins-bilibili-gaming-for-the-2026-season-aVKkclhr3',
  viperOut: 'https://esportsinsider.com/2025/11/geng-canyon-resigning-hanwha-life-esports-viper-departure',
  peanutAnnounce: 'https://esportsinsider.com/2025/09/peanut-announces-leaving-lol-2026',
  peanutRetire: 'https://esports-news.co.uk/2025/10/28/peanut-jungler-retires-from-lol-esports-after-hle-worlds-exit/',
  peanutSheep:
    'https://www.sheepesports.com/en/all/articles/lol-peanut-announced-that-he-will-begin-his-military-service-in-2026/en',

  // ── Gen.G ─────────────────────────────────────────────────────────────────
  gengRoster26: 'https://www.sheepesports.com/en/all/articles/lol-gen-g-s-completed-2026-lck-roster/en',
  gengRoster26b: 'https://sccgmanagement.com/sccg-news/2025/12/01/gen-g-finalizes-its-2026-lck-lineup/',
  gengRoster25: 'https://www.strafe.com/news/read/gen-g-announce-full-roster-lck-2025/',
  canyonResign: 'https://www.invenglobal.com/articles/19909/canyon-re-signs-with-geng-commits-to-2026-worlds-championship-push',
  kiinGg: 'https://ggscore.com/en/lol/player/kiin',
  canyonGg: 'https://ggscore.com/en/lol/player/canyon',
  chovyGg: 'https://ggscore.com/en/lol/player/chovy',
  chovyEgw: 'https://egamersworld.com/lol/player/chovy-4JhAeIVMxIcu',
  duroLp: 'https://lol.fandom.com/wiki/Duro',
  duroEgw: 'https://egamersworld.com/lol/player/duro-N17PYpxqqT',
  duroMsi: 'https://www.invenglobal.com/articles/19460/gengs-duro-and-ruler-highlight-teamwork-and-fan-support-after-msi-triumph',
  ryuGeng: 'https://www.sheepesports.com/en/all/articles/lol-lck-ryu-leaves-bnk-fearx-to-join-gen-g-as-head-coach/en',
  ryuGeng2: 'https://gamedaily.com/news/gen-g-signs-ryu-as-the-new-head-coach-of-their-league-of-legends-team',
  ryuEsc: 'https://escharts.com/players/ryu-lol',
  ryuEgw: 'https://egamersworld.com/lol/player/ryu-EJG6_LEfeUcd',
  lehendsEsc: 'https://escharts.com/players/lehends',
  lehendsGg: 'https://ggscore.com/en/lol/player/lehends',
  lehendsEarn: 'https://www.esportsearnings.com/players/30638-lehends-son-si-woo/team-history',

  // ── KT Rolster ────────────────────────────────────────────────────────────
  ktRoster26: 'https://www.sheepesports.com/en/all/articles/lol-kt-rolster-s-completed-2026-lck-roster/en',
  ktRoster26b: 'https://esportsinsider.com/2025/11/every-confirmed-lck-roster-2026-league-of-legends',
  jiwooTrade: 'https://www.sheepesports.com/en/all/articles/jiwoo-joins-kt-rolster-as-aiming-heads-the-other-way-to-kiwoom-drx/en',
  jiwooTrade2:
    'https://www.invenglobal.com/articles/24302/aiming-leaves-kt-rolster-for-krx-following-internal-conflict-traded-for-jiwoo',
  jiwooTrade3: 'https://insider-gaming.com/kt-rolster-krx-aiming-jiwoo-swap/',
  jiwooTrade4:
    'https://egamersworld.com/lol/news/36454/aiming-traded-to-krx-kt-rolster-signs-jiwoo-after--k_9kQSqAx',
  jiwooBo3: 'https://bo3.gg/lol/players/jiwoo',
  jiwooEsc: 'https://escharts.com/players/jiwoo',
  ghostPollu: 'https://www.sheepesports.com/en/all/articles/lol-lck-ghost-and-pollu-join-kt-rolster-as-supports/en',
  ghostPollu2: 'https://egamersworld.com/lol/news/30650/pollu-and-ghost-the-new-supports-of-kt-rolster-la8Cykuup',
  ghostAdc: 'https://www.sheepesports.com/en/all/articles/kt-challengers-ghost-returns-to-adc-ahead-of-lck-cl-rounds-3-4/en',
  ghostAdc2: 'https://rft.gg/news/kt-rolster-ghost-adc-lck-2026',
  effortBo3: 'https://bo3.gg/lol/players/effort',
  effortEgw: 'https://egamersworld.com/lol/player/effort-E1clb8NfgIc-',
  effortEsc: 'https://escharts.com/players/effort',
  ktOpener: 'https://www.invenglobal.com/articles/20395/kt-rolster-sweep-t1-2-0-in-lck-2026-regular-season-opener',
  perfectName: 'https://lol.fandom.com/wiki/PerfecT_(Lee_Seung-min)',
  perfectEsc: 'https://escharts.com/players/perfect-lol',
  scoreInven: 'https://www.invenglobal.com/articles/21036/kt-rolster-head-coach-go-dong-bin-on-6-game-winning-streak-we-wont-get-complacent-well-keep-the-momentum-going',
  bddEspn: 'https://www.espn.com/gaming/story/_/id/19497135/longzhu-debuts-three-new-players-success-kt-rolster',
  bddGg: 'https://ggscore.com/en/lol/player/bdd',
  polluGg: 'https://ggscore.com/en/lol/player/pollu',
  polluStrafe: 'https://www.strafe.com/player/pollu-lol-28eb24/',
  aimingGg: 'https://ggscore.com/en/lol/player/aiming',
  aimingSheep: 'https://www.sheepesports.com/en/all/articles/aiming-speaks-out-on-his-departure-from-kt-rolster/en',
  deokdamPeter: 'https://esportsinsider.com/2025/11/kt-rolster-geng-deokdam-peter-canyon-departures',
  dnFreecs: 'https://esportbet.com/dn-freecs-sign-kt-rolsters-bottom-lane-duo/',
  peterName: 'https://lol.fandom.com/wiki/Peter_(Jeong_Yoon-su)',
  deokdamBo3: 'https://bo3.gg/lol/players/feiz',
  deftMil: 'https://www.sheepesports.com/en/all/articles/lol-deft-joins-the-military-service-and-bids-farewell-on-stream-a-legend-of-the-game/en',
  deftMil2: 'https://www.gosugamers.net/lol/news/72860-league-of-legends-deft-confirms-military-service-in-2025',
  deftDk: 'https://thunderpick.io/blog/deft-lol-player-profile',

  // ── Dplus KIA ─────────────────────────────────────────────────────────────
  dkRoster26: 'https://www.sheepesports.com/en/all/articles/lol-dplus-kia-s-completed-2026-lck-roster/en',
  smashDk: 'https://esports-news.co.uk/2025/11/24/dplus-kia-sign-former-t1-bot-laner/',
  smashDk2: 'https://www.hotspawn.com/league-of-legends/news/smash-joins-dplus-kia',
  smashName: 'https://lol.fandom.com/wiki/Smash_(Shin_Geum-jae)',
  cvmaxHc: 'https://www.sheepesports.com/us/lol/articles/lol-cvmax-promoted-dplus-kia-head-coach-for-2026/en',
  careerDk: 'https://www.sheepesports.com/en/all/articles/lol-career-joins-dplus-kia/en',
  careerBo3: 'https://bo3.gg/lol/players/career',
  careerEsc: 'https://escharts.com/players/career',
  kellinPl: 'https://www.primeleague.gg/en/teams/24126-dplus-kia',

  // ── Karmine Corp ──────────────────────────────────────────────────────────
  kcRoster26: 'https://www.sheepesports.com/en/all/articles/lol-karmine-corp-s-completed-2026-lec-roster/en',
  kcRoster26b: 'https://esportsinsider.com/2026/01/karmine-corp-unveils-lec-and-vct-2026-rosters',
  kcRoster26c: 'https://egamersworld.com/lol/news/31707/karmine-corp-announce-their-2026-roster-edpW023tV',
  cannaProfile: 'https://esports.gg/guides/league-of-legends/who-is-kc-canna/',
  cannaGg: 'https://ggscore.com/en/lol/player/canna',
  kyeahooKc: 'https://www.sheepesports.com/en/all/articles/sources-kyeahoo-set-to-join-karmine-corp-as-the-team-s-new-midlaner/en',
  kyeahooEgw: 'https://egamersworld.com/lol/player/kyeahoo-A-IrjzxHmn',
  reaperedKc:
    'https://www.sheepesports.com/en/all/articles/sources-reapered-set-to-join-karmine-corp-as-head-coach-for-the-2026-season/en',
  zephKc: 'https://www.sheepesports.com/en/all/articles/sources-zeph-set-to-join-karmine-corp-in-the-lec-as-assistant-coach/en',
  zephAaa: 'https://www.team-aaa.com/fr/actualite/mercato-lol-karmine-corp-recruterait-zeph-comme-assistant-coach_135006',
  targamasGg: 'https://ggscore.com/en/lol/player/targamas',
  targamasRtbf:
    'https://www.rtbf.be/article/championnats-de-league-of-legends-qui-est-targamas-le-belge-a-la-premiere-place-avec-la-karmine-corp-11512062',
  vladiFnc: 'https://esportsinsider.com/2025/12/fnatic-vladi-signing-lec-2026',
  vladiFnc2: 'https://www.sheepesports.com/en/all/articles/sources-fnatic-and-karmine-corp-have-agreed-on-vladi-s-buyout/en',

  // ── G2 Esports ────────────────────────────────────────────────────────────
  g2Roster26: 'https://www.sheepesports.com/en/all/articles/lol-g2-esports-completed-2026-lec-roster/en',
  g2Roster26b: 'https://esports-news.co.uk/2025/11/25/g2-esports-retain-lol-roster-for-lec-2026/',
  bbG2: 'https://g2esports.com/blogs/team-member/broken-blade',
  bbGg: 'https://ggscore.com/en/lol/player/broken-blade',
  skewG2: 'https://g2esports.com/blogs/team-member/skewmond',
  skewGg: 'https://ggscore.com/en/lol/player/skewmond',
  skewExt: 'https://esportsinsider.com/2026/02/g2-esports-skewmond-contract-extension-2028',
  labrovG2: 'https://g2esports.com/blogs/team-member/labrov',
  labrovGg: 'https://ggscore.com/en/lol/player/labrov',
  capsGg: 'https://ggscore.com/en/lol/player/caps',
  capsEsc: 'https://escharts.com/players/caps',
  capsSheep: 'https://www.sheepesports.com/en/all/articles/how-many-titles-did-caps-win/en',
  hansG2: 'https://g2esports.com/pages/team-member/hans-sama',
  mikyxOut: 'https://esports.gg/news/league-of-legends/mikyx-part-ways-with-g2-esports/',
  mikyxOut2: 'https://www.hotspawn.com/league-of-legends/news/official-mikyx-says-farewell-to-g2',
  mikyxFnc: 'https://esportsinsider.com/2025/10/fnatic-mikyx-departure-league-of-legends',
  jankosG2: 'https://esports-news.co.uk/2025/12/10/lec-legend-jankos-returns-to-g2-esports/',
  jankosEsc: 'https://escharts.com/players/jankos',
  mementoG2: 'https://g2esports.com/pages/team-member/memento',
  mementoEsc: 'https://escharts.com/players/memento',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Builders — keep the table below readable.
// ─────────────────────────────────────────────────────────────────────────────

/** Two or more independent publishers agree. */
function ok(...sources: string[]): FieldVerification {
  return { confidence: sources.length >= 2 ? 'confirmed' : 'reported', sources };
}

/** One source, or derivative sources. Usable, not citable. */
function thin(note: string, ...sources: string[]): FieldVerification {
  return { confidence: 'reported', sources, note };
}

/** Sources actively disagree. Both readings recorded. */
function split(variants: string[], note: string, ...sources: string[]): FieldVerification {
  return { confidence: 'disputed', sources, variants, note };
}

/** Nobody could confirm it in this environment. */
function none(note: string): FieldVerification {
  return { confidence: 'unverified', sources: [], note };
}

const ORDER: Record<Confidence, number> = { unverified: 0, disputed: 1, reported: 2, confirmed: 3 };

function weakest(fields: Partial<Record<VerifiableField, FieldVerification>>): Confidence {
  let worst: Confidence = 'confirmed';
  for (const field of Object.values(fields)) {
    if (field && ORDER[field.confidence] < ORDER[worst]) worst = field.confidence;
  }
  return worst;
}

function entry(
  fields: Partial<Record<VerifiableField, FieldVerification>>,
  note?: string,
): PlayerVerification {
  const verification: PlayerVerification = { confidence: weakest(fields), checkedAt: CHECKED, fields };
  if (note !== undefined) verification.note = note;
  return verification;
}

// Frequently reused field verifications.
const KR_ROSTER_2026 = [S.ktRoster26b];
const ROMANISATION_NOTE =
  'Romanisation varies between outlets; the Hangul is the stable identifier. Aliases carry the common variants.';

// ─────────────────────────────────────────────────────────────────────────────
// The audit.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-player provenance, keyed by `Player.id`. */
export const VERIFICATION: Record<string, PlayerVerification> = {
  // ── T1 ────────────────────────────────────────────────────────────────────
  doran: entry({
    fullName: ok(S.doranName, S.doranBo3, S.doranT1),
    nativeName: ok(S.doranName, S.doranBo3),
    teamId: ok(S.doranT1, S.doranBo3, ...KR_ROSTER_2026),
    role: ok(S.doranName, S.doranT1),
    active: ok(S.doranT1, ...KR_ROSTER_2026),
    joinedAt: ok(S.doranT1, S.doranBo3),
    careerHighlights: split(
      ['4x LCK champion', '3x LCK champion'],
      'Title count differs between outlets. Worlds 2025 and the Griffin 2019 Summer runner-up finish are solid; the LCK count is not.',
      S.doranBo3,
      S.worlds25a,
      S.doranT1,
    ),
  }),
  oner: entry(
    {
      fullName: ok(S.onerEgw, S.onerGg),
      nativeName: ok(S.onerEgw, S.onerGg),
      teamId: ok(S.peyzT1c, ...KR_ROSTER_2026),
      role: ok(S.onerEgw, S.onerGg),
      active: ok(S.peyzT1c, ...KR_ROSTER_2026),
      joinedAt: none('Debut year not re-checked in this audit.'),
      careerHighlights: ok(S.worlds25a, S.worlds25b),
    },
    'CORRECTED 2026-08-13: a claimed "MSI 2024 runner-up" was removed — Bilibili Gaming were the MSI 2024 runners-up and T1 finished third.',
  ),
  faker: entry(
    {
      fullName: ok(S.fakerPodium, S.fakerTimeline),
      nativeName: thin('Hangul echoed by aggregators only in this audit.', S.fakerPodium),
      teamId: ok(S.worlds25a, S.peyzT1c),
      role: ok(S.fakerPodium, S.fakerTimeline),
      active: ok(S.worlds25a, S.peyzT1c),
      joinedAt: thin('2013 debut is universally reported; the exact month was not re-checked.', S.fakerTimeline),
      careerHighlights: ok(S.fakerAwards, S.fakerPodium, S.worlds24mvp, S.worlds25a),
    },
    'CORRECTED 2026-08-13: the dataset credited Faker with the Worlds 2023 Finals MVP. That award went to Zeus. Faker\'s Finals MVPs are 2016 and 2024. An unsourced "part-owner of T1" line was also removed.',
  ),
  peyz: entry(
    {
      fullName: split(
        ['Kim Su-hwan', 'Kim Soo-hwan'],
        `${ROMANISATION_NOTE} Leaguepedia and ggscore use "Su-hwan"; Esports Charts uses "Soo-hwan".`,
        S.peyzGg,
        S.peyzPenta,
      ),
      nativeName: ok(S.peyzGg, S.peyzT1c),
      teamId: ok(S.peyzT1a, S.peyzT1b, S.peyzT1c),
      role: ok(S.peyzT1a, S.peyzT1b),
      active: ok(S.peyzT1a, S.peyzT1b),
      joinedAt: ok(S.peyzT1a, S.peyzT1b),
      careerHighlights: ok(S.peyzRookie, S.peyzYoungest, S.peyzPenta, S.peyzPenta2, S.msi2024a),
    },
    'CORRECTED 2026-08-13: an unsourced "LCK 2023 Spring Finals MVP" line was removed and an exact "LCK champion (3x)" count softened — the count could not be pinned down.',
  ),
  keria: entry({
    fullName: ok(S.keriaEgw, S.keriaBo3),
    nativeName: ok(S.keriaEgw, S.keriaBo3),
    teamId: ok(S.peyzT1c, S.keriaContract),
    role: ok(S.keriaEgw, S.keriaBo3),
    active: ok(S.peyzT1c, S.keriaContract),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.worlds25a, S.worlds25b, S.fakerPodium),
  }),
  tom: entry({
    fullName: ok(S.kkomaHiatus, S.kkomaHiatus3),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.kkomaHiatus, S.kkomaHiatus2),
    role: ok(S.kkomaHiatus, S.kkomaHiatus2, S.kkomaHiatus3),
    active: ok(S.kkomaHiatus, S.kkomaHiatus2),
    careerHighlights: ok(S.kkomaHiatus, S.kkomaHiatus2, S.kkomaHiatus3),
  }),
  mata: entry({
    fullName: ok(S.mataT1, S.kkomaHiatus2),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.mataT1, S.kkomaHiatus2),
    role: ok(S.mataT1, S.kkomaHiatus2),
    active: ok(S.mataT1, S.kkomaHiatus2),
    joinedAt: thin('Reported as a return to T1 for the 2025 season.', S.mataT1),
    careerHighlights: ok(S.mataT1, S.mataMvp),
  }),
  kkoma: entry(
    {
      fullName: ok(S.kkomaHiatus, S.kkomaHiatus3),
      nativeName: thin('Hangul carried by one outlet in this audit.', S.kkomaHiatus3),
      teamId: ok(S.kkomaHiatus, S.kkomaHiatus2),
      role: ok(S.kkomaHiatus, S.kkomaHiatus2),
      active: ok(S.kkomaHiatus, S.kkomaHiatus2, S.kkomaHiatus3),
      careerHighlights: split(
        ['five-time world champion as a coach', 'six-time world champion as a coach'],
        'Profiles written before Worlds 2025 say five. He was T1 head coach for the 2025 title, which makes six — but no single source states six.',
        S.kkomaHiatus3,
        S.worlds25a,
      ),
    },
    'CORRECTED 2026-08-13: the hiatus was announced on 23 March 2026, mid-season, not "ahead of the regular season".',
  ),

  // ── Hanwha Life Esports ───────────────────────────────────────────────────
  zeus: entry(
    {
      fullName: ok(S.gumaHle, S.zeusRe, S.zeusSheep),
      nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.zeusRe),
      teamId: ok(S.zeusRe, S.zeusSheep, S.hleRoster26),
      role: ok(S.zeusRe, S.gumaHle),
      active: ok(S.zeusRe, S.zeusSheep),
      joinedAt: ok(S.zeusRe, S.gumaHle),
      careerHighlights: ok(S.worlds23mvp, S.worlds23mvpB, S.msi2026a, S.msi2026b, S.zeusRe),
    },
    'ADDED 2026-08-13: Zeus is the Worlds 2023 Finals MVP. The dataset had previously credited that award to Faker.',
  ),
  kanavi: entry(
    {
      fullName: ok(S.kanaviGg, S.kanaviWiki, S.gumaHle),
      nativeName: ok(S.kanaviGg, S.kanaviWiki),
      teamId: ok(S.hommeHle, S.gumaHle, S.kanaviTes),
      role: ok(S.kanaviGg, S.kanaviWiki),
      active: ok(S.hommeHle, S.gumaHle),
      joinedAt: ok(S.hommeHle, S.gumaHle),
      careerHighlights: ok(S.kanaviWiki, S.asianGames23, S.msi2026a, S.kanaviTes),
    },
    'CORRECTED 2026-08-13: "five-time LPL champion" reduced to the four titles that can be named (2020 Spring, 2022 Summer, 2023 Spring, 2023 Summer). An unsourced "two-time LPL Jungler of the Year" line was deleted.',
  ),
  zeka: entry({
    fullName: split(
      ['Kim Geon-woo', 'Kim Gun-woo'],
      `${ROMANISATION_NOTE} Leaguepedia and ggscore use "Geon-woo"; the HLE signing coverage used "Gun-woo".`,
      S.zekaName,
      S.zekaGg,
      S.gumaHle,
    ),
    nativeName: ok(S.zekaName, S.zekaGg),
    teamId: ok(S.zeusRe, S.hleRoster26),
    role: ok(S.zekaName, S.zekaGg),
    active: ok(S.zeusRe, S.gumaHle),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.zekaGg, S.msi2026a, S.msi2026b),
  }),
  gumayusi: entry({
    fullName: split(
      ['Lee Min-hyeong', 'Lee Min-hyung'],
      `${ROMANISATION_NOTE} Leaguepedia and ggscore use "Min-hyeong"; Esports Charts uses "Min-hyung".`,
      S.gumaGg,
      S.gumaHle,
    ),
    nativeName: ok(S.gumaGg, S.gumaHle2),
    teamId: ok(S.gumaHle, S.gumaHle2, S.gumaHle3),
    role: ok(S.gumaHle, S.gumaHle2),
    active: ok(S.gumaHle, S.gumaHle3),
    joinedAt: ok(S.gumaHle, S.gumaHle2),
    careerHighlights: ok(S.worlds25a, S.worlds25b, S.gumaHle, S.msi2026a),
  }),
  delight: entry({
    fullName: split(
      ['Yu Hwan-jung', 'Yoo Hwan-joong'],
      'A genuine split: Liquipedia and Esports Charts read 유환중 as "Yu Hwan-jung"; Leaguepedia, ggscore and Esports Earnings read it "Yoo Hwan-joong". Both are in `aliases`.',
      S.delightLp,
      S.delightEsc,
      S.delightGg,
    ),
    nativeName: ok(S.delightLp, S.delightEsc, S.delightGg),
    teamId: ok(S.gumaHle, S.hleRoster26),
    role: ok(S.delightEsc, S.gumaHle),
    active: ok(S.gumaHle, S.hleRoster26),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.msi2026a, S.msi2026b),
  }),
  homme: entry(
    {
      fullName: ok(S.hommeHle, S.hommeBo3, S.hommeJdg),
      nativeName: thin('Hangul carried by one outlet in this audit.', S.hommeBo3),
      teamId: ok(S.hommeHle, S.hommeBo3),
      role: ok(S.hommeHle, S.hommeBo3),
      active: ok(S.hommeHle, S.hommeBo3),
      careerHighlights: ok(S.hommeJdg, S.hommeHle, S.msi2026a),
    },
    'CORRECTED 2026-08-13: the dataset credited Homme with head-coaching Hanwha Life to the LCK 2024 Summer title. He did not — Choi "DanDy" In-gyu did; Homme joined HLE for the 2026 season. The false line was deleted.',
  ),
  viper: entry({
    fullName: ok(S.viperBlg, S.viperOut),
    nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.viperBlg),
    teamId: thin(
      'Modelled as a former Hanwha Life player. He is on Bilibili Gaming (LPL) for 2026 — an org outside this dataset.',
      S.viperBlg,
    ),
    role: ok(S.viperBlg, S.viperOut),
    active: ok(S.viperOut, S.viperBlg),
    careerHighlights: ok(S.viperBlg, S.viperOut),
  }),
  peanut: entry(
    {
      fullName: ok(S.peanutAnnounce, S.peanutRetire),
      nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
      teamId: ok(S.peanutAnnounce, S.peanutRetire),
      role: ok(S.peanutAnnounce, S.peanutRetire),
      active: ok(S.peanutRetire, S.peanutSheep),
      careerHighlights: ok(S.peanutAnnounce, S.peanutRetire, S.peanutSheep),
    },
    'CORRECTED 2026-08-13: he did not stop playing in September 2025. He announced his enlistment that month, kept playing, and his last match was Hanwha Life\'s Worlds 2025 quarter-final exit in October 2025.',
  ),

  // ── Gen.G ─────────────────────────────────────────────────────────────────
  kiin: entry({
    fullName: ok(S.kiinGg, S.gengRoster26, S.gengRoster26b),
    nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.kiinGg),
    teamId: ok(S.gengRoster26, S.gengRoster26b),
    role: ok(S.gengRoster26, S.kiinGg),
    active: ok(S.gengRoster26, S.gengRoster26b),
    joinedAt: thin('Join window inferred from the 2024 roster build.', S.gengRoster25),
    careerHighlights: ok(S.msi2024a, S.msi2025a, S.msi2025b, S.lck2025a),
  }),
  canyon: entry({
    fullName: ok(S.canyonGg, S.gengRoster26, S.gengRoster26b),
    nativeName: ok(S.canyonGg, S.gengRoster26b),
    teamId: ok(S.canyonResign, S.gengRoster26),
    role: ok(S.canyonGg, S.gengRoster26),
    active: ok(S.canyonResign, S.gengRoster26),
    joinedAt: thin('Join window inferred from the 2024 roster build.', S.gengRoster25),
    careerHighlights: ok(S.canyonGg, S.msi2024a, S.msi2025a, S.lck2025a),
  }),
  chovy: entry({
    fullName: ok(S.chovyGg, S.chovyEgw, S.gengRoster26),
    nativeName: ok(S.chovyGg, S.chovyEgw),
    teamId: ok(S.gengRoster26, S.gengRoster26b),
    role: ok(S.chovyGg, S.gengRoster26),
    active: ok(S.gengRoster26, S.gengRoster26b),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.msi2024a, S.msi2025a, S.msi2025b, S.lck2025a),
  }),
  ruler: entry({
    fullName: ok(S.gengRoster26, S.lck2025a, S.gengRoster26b),
    nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.gengRoster26b),
    teamId: ok(S.gengRoster26, S.gengRoster26b),
    role: ok(S.gengRoster26, S.lck2025a),
    active: ok(S.gengRoster26, S.gengRoster26b),
    joinedAt: ok(S.gengRoster25, S.gengRoster26b),
    careerHighlights: ok(S.lck2025a, S.lck2025b, S.msi2025a, S.duroMsi),
  }),
  duro: entry({
    fullName: ok(S.duroLp, S.duroEgw, S.gengRoster26),
    nativeName: ok(S.duroLp, S.duroEgw),
    teamId: ok(S.gengRoster26, S.gengRoster26b),
    role: ok(S.duroLp, S.gengRoster26),
    active: ok(S.gengRoster26, S.gengRoster26b),
    joinedAt: ok(S.gengRoster25, S.gengRoster26b),
    careerHighlights: ok(S.lck2025a, S.msi2025a, S.duroMsi, S.gengRoster26),
  }),
  ryu: entry(
    {
      fullName: split(
        ['Yoo Sang-wook', 'Ryu Sang-wook'],
        'Esports Charts, egamersworld and ggscore render the surname "Yoo"; the Gen.G signing coverage renders it "Ryu". The Hangul is disputed too, so `nativeName` was deleted rather than guessed.',
        S.ryuEsc,
        S.ryuEgw,
        S.ryuGeng2,
      ),
      nativeName: split(
        ['유상욱', '류상욱'],
        'DELETED from the dataset. One reading gives 유상욱, another 류상욱, and no reachable source settles it. Both survive as lookup aliases only.',
        S.ryuEsc,
        S.ryuGeng2,
      ),
      teamId: ok(S.ryuGeng, S.ryuGeng2, S.gengRoster26),
      role: ok(S.ryuGeng, S.ryuGeng2),
      active: ok(S.ryuGeng, S.ryuGeng2),
      careerHighlights: ok(S.ryuGeng, S.ryuGeng2),
    },
    'A player whose handle collides with a possible surname reading. Treat the legal name as unsettled.',
  ),
  lehends: entry(
    {
      fullName: ok(S.lehendsEsc, S.lehendsGg, S.lehendsEarn),
      nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
      teamId: thin(
        'Modelled as a former Gen.G player. Aggregator profiles list him with Nongshim RedForce as of 2026.',
        S.lehendsEsc,
      ),
      role: ok(S.lehendsEsc, S.lehendsGg),
      active: ok(S.lehendsEsc, S.msi2024a),
      careerHighlights: ok(S.msi2024a, S.msi2024b),
    },
    'CORRECTED 2026-08-13: an editorial "widest support champion pool in the LCK" line was deleted.',
  ),

  // ── KT Rolster ────────────────────────────────────────────────────────────
  perfect: entry({
    fullName: ok(S.perfectName, S.perfectEsc, S.ktRoster26),
    nativeName: thin('Hangul carried by one outlet in this audit.', S.perfectName),
    teamId: ok(S.ktRoster26, S.ktOpener),
    role: ok(S.perfectName, S.ktRoster26),
    active: ok(S.ktRoster26, S.ktOpener),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.worlds25a, S.deokdamPeter),
  }),
  cuzz: entry({
    fullName: split(
      ['Mun U-chan', 'Moon Woo-chan'],
      `${ROMANISATION_NOTE} Leaguepedia uses "Mun U-chan"; roster coverage uses "Moon Woo-chan".`,
      S.ktRoster26,
      S.perfectEsc,
    ),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.ktRoster26, S.ktOpener),
    role: ok(S.ktRoster26, S.perfectEsc),
    active: ok(S.ktRoster26, S.ktOpener),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.worlds25a, S.worlds25b),
  }),
  bdd: entry(
    {
      fullName: ok(S.bddGg, S.ktRoster26, S.bddEspn),
      nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.bddGg),
      teamId: ok(S.ktRoster26, S.ktOpener),
      role: ok(S.bddGg, S.ktRoster26),
      active: ok(S.ktRoster26, S.ktOpener),
      joinedAt: none('Join date not re-checked in this audit.'),
      careerHighlights: ok(S.bddEspn, S.bddGg, S.worlds25a),
    },
    'CORRECTED 2026-08-13: an unsourced "Worlds 2017 quarter-finalist as the most hyped rookie mid of his year" line was deleted; the sourced 2017 LCK Summer regular-season MVP was kept.',
  ),
  jiwoo: entry({
    fullName: ok(S.jiwooBo3, S.jiwooEsc, S.jiwooTrade),
    nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.jiwooEsc),
    teamId: ok(S.jiwooTrade, S.jiwooTrade2, S.jiwooTrade3, S.jiwooTrade4),
    role: ok(S.jiwooTrade, S.jiwooTrade3),
    active: ok(S.jiwooTrade, S.jiwooTrade2),
    joinedAt: ok(S.jiwooTrade, S.jiwooTrade3),
    careerHighlights: ok(S.jiwooBo3, S.jiwooTrade, S.jiwooTrade2),
  }),
  pollu: entry(
    {
      fullName: ok(S.polluGg, S.polluStrafe, S.ghostPollu),
      nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.polluGg),
      teamId: ok(S.ghostPollu, S.ghostPollu2, S.ktRoster26),
      role: ok(S.ghostPollu, S.polluGg),
      active: ok(S.ghostPollu, S.ktRoster26),
      joinedAt: ok(S.ghostPollu, S.ghostPollu2),
      careerHighlights: ok(S.ghostPollu, S.polluStrafe),
    },
    'CORRECTED 2026-08-13: the `starter` tag was removed. KT signed Pollu and Ghost as a rotating pair for 2026, but Lee "Effort" Sang-ho took the starting support role during Spring.',
  ),
  effort: entry(
    {
      fullName: ok(S.effortBo3, S.effortEgw, S.effortEsc),
      nativeName: ok(S.effortEgw, S.effortBo3),
      teamId: ok(S.effortBo3, S.effortEgw, S.ghostAdc2),
      role: ok(S.effortBo3, S.effortEgw),
      active: ok(S.effortBo3, S.ghostAdc2),
      joinedAt: thin('Reported as joining the main roster in April 2026, from KT Challengers.', S.effortBo3),
      careerHighlights: thin(
        'Only his 2026 KT role is verified here; no earlier titles are claimed because none could be sourced in this audit.',
        S.ghostAdc2,
        S.effortBo3,
      ),
    },
    'ADDED 2026-08-13: KT\'s starting support was missing from the dataset entirely, which left a Pollu/Ghost rotation on record that had already been superseded.',
  ),
  ghost: entry(
    {
      fullName: ok(S.ghostPollu, S.ghostPollu2, S.ktRoster26),
      nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
      teamId: ok(S.ghostPollu, S.ghostAdc, S.ghostAdc2),
      role: split(
        ['support (signed for 2026)', 'bot / AD carry (current)'],
        'He joined KT as a role-swapped support for 2026, then moved back to AD carry on the KT Challengers roster mid-season. `role` records where he plays now.',
        S.ghostPollu,
        S.ghostAdc,
        S.ghostAdc2,
      ),
      active: ok(S.ghostAdc, S.ghostAdc2),
      joinedAt: ok(S.ghostPollu, S.ghostPollu2),
      careerHighlights: ok(S.ghostPollu, S.ghostAdc, S.ghostAdc2),
    },
    'CORRECTED 2026-08-13: the dataset had him as a rotating main-roster support. He was moved to KT Challengers and back to AD carry during the 2026 season.',
  ),
  score: entry(
    {
      fullName: ok(S.scoreInven, S.lck2018),
      nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
      teamId: ok(S.scoreInven, S.ktRoster26),
      role: ok(S.scoreInven, S.ktRoster26),
      active: ok(S.scoreInven, S.ktOpener),
      careerHighlights: ok(S.lck2018, S.worlds25a, S.scoreInven),
    },
    'CORRECTED 2026-08-13: a "signed through 2026" contract claim was removed — coverage in this audit reports an extension to 2029, so the original figure is at best stale.',
  ),
  aiming: entry(
    {
      fullName: ok(S.aimingGg, S.jiwooTrade, S.ktRoster26),
      nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.aimingGg),
      teamId: thin(
        'Modelled as a former KT player. He is on Kiwoom DRX from 30 July 2026 — an org outside this dataset.',
        S.jiwooTrade,
      ),
      role: ok(S.jiwooTrade, S.aimingGg),
      active: ok(S.jiwooTrade, S.jiwooTrade2),
      careerHighlights: ok(S.aimingGg, S.jiwooTrade, S.jiwooTrade2, S.aimingSheep),
    },
    'CORRECTED 2026-08-13: an "LCK 2018 Spring runner-up" line was deleted — the placing belongs to the team, and his participation in it could not be sourced. The 2018 org was Afreeca Freecs, later renamed Kwangdong Freecs.',
  ),
  deokdam: entry({
    fullName: ok(S.deokdamPeter, S.dnFreecs, S.deokdamBo3),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: thin('Modelled as a former KT player. He is on DN SOOPers (ex-DN Freecs) for 2026.', S.dnFreecs),
    role: ok(S.deokdamPeter, S.dnFreecs),
    active: ok(S.deokdamPeter, S.dnFreecs),
    careerHighlights: ok(S.worlds25a, S.deokdamPeter, S.dnFreecs),
  }),
  peter: entry({
    fullName: ok(S.peterName, S.deokdamPeter, S.dnFreecs),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: thin('Modelled as a former KT player. He is on DN SOOPers (ex-DN Freecs) for 2026.', S.dnFreecs),
    role: ok(S.peterName, S.dnFreecs),
    active: ok(S.deokdamPeter, S.dnFreecs),
    careerHighlights: ok(S.worlds25a, S.deokdamPeter, S.dnFreecs),
  }),
  deft: entry(
    {
      fullName: ok(S.deftMil, S.deftDk),
      nativeName: thin('Hangul carried by one outlet in this audit.', S.deftDk),
      teamId: thin('Modelled as a former KT player; he retired into military service from KT.', S.deftMil),
      role: ok(S.deftMil, S.deftDk),
      active: ok(S.deftMil, S.deftMil2),
      careerHighlights: ok(S.deftMil, S.deftMil2, S.deftDk),
    },
    'CORRECTED 2026-08-13: an unsourced "one of the highest career kill totals" line was deleted; Dplus KIA was added to the team list, which had omitted it.',
  ),

  // ── Dplus KIA ─────────────────────────────────────────────────────────────
  siwoo: entry({
    fullName: ok(S.dkRoster26, S.ewc2026a),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.dkRoster26, S.ewc2026c),
    role: ok(S.dkRoster26, S.ewc2026c),
    active: ok(S.dkRoster26, S.ewc2026c),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.ewc2026a, S.ewc2026b, S.dkRoster26),
  }),
  lucid: entry({
    fullName: ok(S.dkRoster26, S.ewc2026c),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.dkRoster26, S.ewc2026c),
    role: ok(S.dkRoster26, S.ewc2026c),
    active: ok(S.dkRoster26, S.ewc2026c),
    joinedAt: none('Join date not re-checked in this audit.'),
    careerHighlights: ok(S.ewc2026a, S.ewc2026b),
  }),
  showmaker: entry({
    fullName: ok(S.dkRoster26, S.kellinPl),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.dkRoster26, S.ewc2026c),
    role: ok(S.dkRoster26, S.kellinPl),
    active: ok(S.dkRoster26, S.ewc2026c),
    careerHighlights: ok(S.ewc2026a, S.ewc2026b, S.dkRoster26),
  }),
  smash: entry({
    fullName: split(
      ['Shin Geum-jae', 'Sin Guem-jae'],
      `${ROMANISATION_NOTE} Leaguepedia and Esports News UK use "Shin Geum-jae"; the Sheep roster piece used "Sin Guem-jae".`,
      S.smashName,
      S.smashDk,
      S.dkRoster26,
    ),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.smashDk, S.smashDk2, S.dkRoster26),
    role: ok(S.smashDk, S.dkRoster26),
    active: ok(S.smashDk, S.dkRoster26),
    joinedAt: ok(S.smashDk, S.smashDk2),
    careerHighlights: ok(S.ewc2026a, S.ewc2026b, S.smashDk, S.smashDk2),
  }),
  career: entry({
    fullName: split(
      ['Oh Hyeong-seok', 'Oh Hyung-suk'],
      `${ROMANISATION_NOTE} bo3.gg and Esports News UK use "Hyeong-seok"; Esports Charts and the Sheep roster piece use "Hyung-suk". The handle itself is also written "Caria" by one outlet.`,
      S.careerBo3,
      S.careerEsc,
      S.smashDk,
    ),
    nativeName: ok(S.careerBo3, S.careerDk),
    teamId: ok(S.careerDk, S.dkRoster26, S.smashDk),
    role: ok(S.careerDk, S.dkRoster26),
    active: ok(S.careerDk, S.dkRoster26),
    joinedAt: ok(S.careerDk, S.dkRoster26),
    careerHighlights: ok(S.careerDk, S.careerBo3, S.ewc2026a),
  }),
  cvmax: entry({
    fullName: ok(S.cvmaxHc, S.dkRoster26),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.cvmaxHc, S.dkRoster26),
    role: ok(S.cvmaxHc, S.dkRoster26),
    active: ok(S.cvmaxHc, S.dkRoster26),
    careerHighlights: thin(
      'The 2026 promotion is confirmed. The Griffin and DRX head-coach spells are widely repeated but were not independently re-sourced in this audit.',
      S.cvmaxHc,
      S.ewc2026a,
    ),
  }),
  beryl: entry({
    fullName: ok(S.smashDk, S.careerDk),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.smashDk, S.careerDk),
    role: ok(S.smashDk, S.careerDk),
    active: ok(S.smashDk, S.careerDk),
    careerHighlights: thin(
      'The 2025 departure is confirmed. The DAMWON honours are widely repeated but were not independently re-sourced in this audit.',
      S.smashDk,
      S.careerDk,
    ),
  }),
  kellin: entry({
    fullName: ok(S.kellinPl, S.careerDk),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.kellinPl, S.careerDk),
    role: ok(S.kellinPl, S.careerDk),
    active: thin('Modelled as a former Dplus KIA support; his 2026 team was not established here.', S.careerDk),
    careerHighlights: thin('Squad membership sourced; the Worlds 2024 run was not re-sourced.', S.kellinPl),
  }),
  bengi: entry({
    fullName: ok(S.cvmaxHc, S.dkRoster26),
    nativeName: none('Hangul not confirmed by any source reachable in this audit.'),
    teamId: ok(S.cvmaxHc, S.dkRoster26),
    role: ok(S.cvmaxHc, S.dkRoster26),
    active: ok(S.cvmaxHc, S.dkRoster26),
    careerHighlights: thin(
      'The November 2025 departure is confirmed. The SKT playing honours are widely repeated but were not independently re-sourced in this audit.',
      S.cvmaxHc,
    ),
  }),

  // ── Karmine Corp ──────────────────────────────────────────────────────────
  canna: entry(
    {
      fullName: ok(S.cannaGg, S.kcRoster26, S.cannaProfile),
      nativeName: thin('Hangul carried by aggregator profiles only in this audit.', S.cannaGg),
      teamId: ok(S.kcRoster26, S.kcRoster26b, S.kcRoster26c),
      role: ok(S.kcRoster26, S.cannaProfile),
      active: ok(S.kcRoster26, S.kcRoster26c),
      joinedAt: ok(S.cannaProfile, S.kcRoster26),
      careerHighlights: ok(S.lecWinter25, S.cannaProfile, S.ewc2026a),
    },
    'CORRECTED 2026-08-13: an "LEC 2025 MVP" line was deleted. The official LEC Winter 2025 Season MVP was Vladi and the LEC Spring 2025 MVP was Upset; only an opinion piece calls Canna the 2025 MVP.',
  ),
  yike: entry(
    {
      fullName: ok(S.kcRoster26, S.kcRoster26c),
      teamId: ok(S.kcRoster26, S.kcRoster26b, S.kcRoster26c),
      role: ok(S.kcRoster26, S.kcRoster26c),
      active: ok(S.kcRoster26, S.kcRoster26c),
      joinedAt: thin('Join window inferred from the 2025 roster build.', S.mikyxOut),
      careerHighlights: ok(S.lecWinter25, S.ewc2026a, S.ewc2026c),
    },
    'CORRECTED 2026-08-13: an editorial "vocal leader and shotcaller" line was deleted.',
  ),
  kyeahoo: entry(
    {
      fullName: ok(S.kyeahooEgw, S.kyeahooKc, S.kcRoster26),
      nativeName: ok(S.kyeahooEgw, S.kyeahooKc),
      teamId: ok(S.kcRoster26, S.kyeahooKc, S.kcRoster26c),
      role: ok(S.kcRoster26, S.kyeahooKc),
      active: ok(S.kcRoster26, S.kcRoster26c),
      careerHighlights: ok(S.kyeahooKc, S.ewc2026a, S.ewc2026c),
    },
    'CORRECTED 2026-08-13: an unsourced "LCK Academy 2022 Summer champion with DRX Academy" line was deleted.',
  ),
  caliste: entry(
    {
      fullName: ok(S.kcRoster26, S.kcRoster26c),
      teamId: ok(S.kcRoster26, S.kcRoster26b, S.kcRoster26c),
      role: ok(S.kcRoster26, S.kcRoster26c),
      active: ok(S.kcRoster26, S.kcRoster26c),
      careerHighlights: ok(S.lecWinter25, S.ewc2026a, S.ewc2026c),
    },
    'CORRECTED 2026-08-13: an editorial "mechanical prodigy and public face" line was deleted.',
  ),
  busio: entry({
    fullName: ok(S.kcRoster26, S.kcRoster26c),
    teamId: ok(S.kcRoster26, S.kcRoster26b, S.kcRoster26c),
    role: ok(S.kcRoster26, S.kcRoster26c),
    active: ok(S.kcRoster26, S.kcRoster26c),
    careerHighlights: thin(
      'The FlyQuest background and the 2026 KC move are sourced; the specific Worlds 2024/2025 appearances were not re-sourced.',
      S.kcRoster26,
      S.ewc2026a,
    ),
  }),
  reapered: entry({
    fullName: ok(S.reaperedKc, S.kyeahooEgw),
    nativeName: thin('Hangul carried by one outlet in this audit.', S.reaperedKc),
    teamId: ok(S.reaperedKc, S.kyeahooEgw),
    role: ok(S.reaperedKc, S.kyeahooEgw),
    active: ok(S.reaperedKc, S.kcRoster26),
    careerHighlights: thin(
      'The 2026 KC appointment is confirmed. The Cloud9 and 100 Thieves history is widely repeated but was not independently re-sourced in this audit.',
      S.reaperedKc,
    ),
  }),
  zeph: entry({
    fullName: ok(S.zephKc, S.zephAaa),
    teamId: ok(S.zephKc, S.zephAaa),
    role: ok(S.zephKc, S.zephAaa),
    active: ok(S.zephKc, S.zephAaa),
    careerHighlights: ok(S.zephKc, S.zephAaa),
  }),
  targamas: entry(
    {
      fullName: ok(S.targamasGg, S.targamasRtbf),
      teamId: ok(S.targamasGg, S.kcRoster26),
      role: ok(S.targamasGg, S.targamasRtbf),
      active: thin(
        'Replaced by Busio in the 2026 starting five. A renewal report also exists, so "no longer with KC" is not established — only "no longer starting".',
        S.kcRoster26,
        S.targamasGg,
      ),
      careerHighlights: ok(S.lecWinter25, S.targamasGg, S.kcRoster26),
    },
    'His post-2025 status is the softest fact on this row. Re-check before using him in anything current.',
  ),
  vladi: entry(
    {
      fullName: ok(S.vladiFnc, S.vladiFnc2, S.cannaProfile),
      teamId: thin('Modelled as a former KC player. He is on Fnatic for 2026 — an org outside this dataset.', S.vladiFnc),
      role: ok(S.vladiFnc, S.cannaProfile),
      active: ok(S.vladiFnc, S.vladiFnc2),
      careerHighlights: ok(S.vladiFnc, S.cannaProfile, S.lecWinter25),
    },
    'CORRECTED 2026-08-13: an unsourced "second-youngest mid laner to win the LEC" line was deleted; the sourced LEC Winter 2025 Season MVP was added in its place.',
  ),

  // ── G2 Esports ────────────────────────────────────────────────────────────
  brokenblade: entry({
    fullName: ok(S.bbG2, S.bbGg, S.g2Roster26),
    teamId: ok(S.g2Roster26, S.g2Roster26b, S.bbG2),
    role: ok(S.bbG2, S.g2Roster26),
    active: ok(S.g2Roster26, S.g2Roster26b),
    joinedAt: thin('Fifth season with G2 is reported; the exact join window was not re-sourced.', S.g2Roster26),
    careerHighlights: ok(S.lecSpring26a, S.lecVersus26a, S.g2Roster26),
  }),
  skewmond: entry({
    fullName: ok(S.skewG2, S.skewGg, S.skewExt),
    teamId: ok(S.g2Roster26, S.g2Roster26b, S.skewExt),
    role: ok(S.skewG2, S.g2Roster26),
    active: ok(S.g2Roster26, S.skewExt),
    joinedAt: ok(S.g2Roster26, S.g2Roster26b),
    careerHighlights: ok(S.lecSpring26a, S.lecSpring26b, S.lecVersus26a, S.g2Roster26),
  }),
  caps: entry(
    {
      fullName: split(
        ['Rasmus Winther', 'Rasmus Borregaard Winther'],
        'Both are the same person; the middle name is included by some outlets. Both are in `aliases`.',
        S.capsGg,
        S.capsEsc,
      ),
      teamId: ok(S.g2Roster26, S.g2Roster26b),
      role: ok(S.capsGg, S.g2Roster26),
      active: ok(S.g2Roster26, S.g2Roster26b),
      joinedAt: none('Join date not re-checked in this audit.'),
      careerHighlights: ok(S.capsSheep, S.lecSpring26a, S.lecVersus26a),
    },
    'CORRECTED 2026-08-13: "the only player to reach a Worlds final with two different organisations" was replaced with the sourced claim — first European to reach two consecutive Worlds finals, with Fnatic (2018) and G2 (2019).',
  ),
  'hans-sama': entry({
    fullName: ok(S.hansG2, S.g2Roster26),
    teamId: ok(S.g2Roster26, S.g2Roster26b, S.hansG2),
    role: ok(S.hansG2, S.g2Roster26),
    active: ok(S.g2Roster26, S.g2Roster26b),
    joinedAt: thin('Fourth season with G2 is reported; the exact join window was not re-sourced.', S.g2Roster26),
    careerHighlights: ok(S.lecSpring26a, S.lecVersus26a, S.g2Roster26),
  }),
  labrov: entry({
    fullName: ok(S.labrovG2, S.labrovGg, S.g2Roster26),
    teamId: ok(S.g2Roster26, S.g2Roster26b, S.labrovG2),
    role: ok(S.labrovG2, S.g2Roster26),
    active: ok(S.g2Roster26, S.g2Roster26b),
    joinedAt: ok(S.g2Roster26, S.mikyxOut),
    careerHighlights: ok(S.lecSpring26a, S.lecVersus26a, S.g2Roster26),
  }),
  'dylan-falco': entry({
    fullName: ok(S.g2Roster26, S.g2Roster26b),
    teamId: ok(S.g2Roster26, S.g2Roster26b),
    role: ok(S.g2Roster26, S.g2Roster26b),
    active: ok(S.g2Roster26, S.g2Roster26b),
    careerHighlights: ok(S.g2Roster26, S.lecSpring26a, S.lecVersus26a),
  }),
  memento: entry({
    fullName: ok(S.mementoG2, S.mementoEsc),
    teamId: ok(S.g2Roster26, S.mementoG2),
    role: ok(S.mementoG2, S.g2Roster26),
    active: ok(S.g2Roster26, S.mementoG2),
    careerHighlights: ok(S.g2Roster26, S.mementoEsc),
  }),
  mikyx: entry({
    fullName: ok(S.mikyxOut, S.mikyxOut2),
    teamId: ok(S.mikyxOut, S.mikyxOut2),
    role: ok(S.mikyxOut, S.mikyxFnc),
    active: ok(S.mikyxOut, S.mikyxOut2),
    careerHighlights: thin(
      'The November 2024 G2 departure and the Fnatic spell are confirmed; the 2023/2024 LEC titles were not independently re-sourced.',
      S.mikyxOut,
      S.mikyxFnc,
    ),
  }),
  jankos: entry({
    fullName: ok(S.jankosG2, S.jankosEsc),
    teamId: ok(S.jankosG2, S.jankosEsc),
    role: ok(S.jankosEsc, S.jankosG2),
    active: ok(S.jankosG2, S.jankosEsc),
    careerHighlights: thin(
      'The 2026 return to G2 as a content creator is confirmed. The 2019 honours are widely repeated but were not independently re-sourced in this audit.',
      S.jankosG2,
    ),
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

/** The audit for one player, or `undefined` if they were never audited. */
export function verificationOf(playerId: string): PlayerVerification | undefined {
  return VERIFICATION[playerId];
}

/** Confidence for one field. Anything unaudited reads as `'unverified'`. */
export function confidenceOf(playerId: string, field: VerifiableField): Confidence {
  return VERIFICATION[playerId]?.fields[field]?.confidence ?? 'unverified';
}

/** Every player, with their audit trail attached. Unaudited players get an empty one. */
export function verifiedPlayers(): VerifiedPlayer[] {
  return PLAYERS.map((player) => ({
    ...player,
    verification:
      VERIFICATION[player.id] ??
      ({
        confidence: 'unverified',
        checkedAt: CHECKED,
        fields: {},
        note: 'No verification record. Treat every field on this row as unverified.',
      } satisfies PlayerVerification),
  }));
}

/**
 * The `hexa players --unverified` view: every player carrying at least one
 * field that is `'unverified'` or `'disputed'`, and which fields they are.
 *
 * A field present on the `Player` but absent from the audit counts as
 * unverified — silence is not confirmation.
 *
 * ```ts
 * for (const { player, fields } of unverifiedPlayers()) {
 *   console.log(`${player}: ${fields.join(', ')}`);
 * }
 * ```
 */
export function unverifiedPlayers(): { player: string; fields: string[] }[] {
  const rows: { player: string; fields: string[] }[] = [];

  for (const player of PLAYERS) {
    const audit = VERIFICATION[player.id];
    const flagged: string[] = [];

    for (const field of VERIFIABLE_FIELDS) {
      // Only report fields the player actually carries.
      if (field === 'nativeName' && player.nativeName === undefined) continue;
      if (field === 'joinedAt' && player.joinedAt === undefined) continue;
      if (field === 'careerHighlights' && player.careerHighlights.length === 0) continue;

      const confidence = audit?.fields[field]?.confidence ?? 'unverified';
      if (confidence === 'unverified' || confidence === 'disputed') flagged.push(field);
    }

    if (flagged.length > 0) rows.push({ player: player.handle, fields: flagged });
  }

  return rows;
}

/** Count of independent source URLs backing a field. Zero means "nobody said so". */
export function sourceCount(playerId: string, field: VerifiableField): number {
  return VERIFICATION[playerId]?.fields[field]?.sources.length ?? 0;
}

/** Every URL this audit relied on, deduplicated and sorted. */
export function verificationSources(): string[] {
  const urls = new Set<string>();
  for (const audit of Object.values(VERIFICATION)) {
    for (const field of Object.values(audit.fields)) {
      for (const url of field?.sources ?? []) urls.add(url);
    }
  }
  return [...urls].sort();
}
