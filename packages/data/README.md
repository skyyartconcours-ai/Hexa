# `@hexa/data`

The roster, team brand kits and name resolution for Hexa.

---

## ⚠ Read this before you publish anything from this package

**This package contains the legal names, Hangul names, teams and career achievements of 62 real, living professional players and coaches. None of it was read from a primary source.**

Liquipedia, Leaguepedia (`lol.fandom.com`), `lolesports.com`, Wikipedia and several stat sites are blocked by this environment's egress proxy. Every request returns HTTP 403 or `EGRESS_BLOCKED`. You can check for yourself:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://liquipedia.net/leagueoflegends/T1
# CONNECT tunnel failed, response 403
```

Everything here — the original build and the independent re-audit on **2026-08-13** — came from **web search results**: publisher headlines, article snippets, and the canonical name strings that wikis expose in their page titles. That is real evidence, and it is not the same as reading the source.

So: when this package says a field is `'confirmed'`, it means *two independent publishers said so in search results on 2026-08-13*. It does **not** mean an editor checked a primary source. Treat it as a well-researched starting point that still needs a human to sign it off before a real person's name goes on a public thumbnail.

---

## What the 2026-08-13 audit actually found

Nine substantive errors about real people, plus one missing player. All are fixed; all are annotated inline in the source with the reason.

| Person | The dataset said | The truth | Action |
|---|---|---|---|
| **Faker** (Lee Sang-hyeok) | "Worlds 2023 and 2024 Finals MVP" | The 2023 Finals MVP was **Zeus**. Faker's are 2016 and 2024. | Corrected; the award moved to Zeus's row |
| **Faker** | "Part-owner of T1 and the sport's defining figure" | No source found | Deleted |
| **Oner** (Mun Hyeon-jun) | "MSI 2024 runner-up" | Bilibili Gaming were the runners-up. T1 finished **third**. | Deleted |
| **Homme** (Yoon Sung-young) | "Head coach for the LCK 2024 Summer championship side" | That title was won under **Choi "DanDy" In-gyu**. Homme was at JD Gaming, then Top Esports, and joined HLE for **2026**. | Deleted; his real JDG/TES record added |
| **Peanut** (Han Wang-ho) | "Stepped away from play in September 2025 for military service" | He *announced* it in September 2025 and kept playing. His last match was Hanwha Life's Worlds 2025 quarter-final exit, in October. | Corrected |
| **Kanavi** (Seo Jin-hyeok) | "Five-time LPL champion; two-time LPL Jungler of the Year" | Four LPL titles can be named. The Jungler of the Year award had no source. | Corrected + deleted |
| **Canna** (Kim Chang-dong) | "LEC 2025 MVP" | The official LEC Winter 2025 MVP was **Vladi**; the Spring 2025 MVP was **Upset**. Only an opinion piece calls Canna the 2025 MVP. | Deleted |
| **Caps** (Rasmus Winther) | "the **only** player to reach a Worlds final with two different organisations" | No source supports "only". | Rewritten to the sourced claim |
| **Aiming** (Kim Ha-ram) | "LCK 2018 Spring runner-up" with "Kwangdong Freecs" | The placing is the team's, not sourceably his; and the 2018 org was named **Afreeca Freecs**. | Deleted + corrected |
| **KT Rolster support** | Pollu starting, rotating with Ghost | **Effort** (Lee Sang-ho) took the starting job during Spring 2026. Ghost was moved to KT Challengers and back to AD carry. Effort was **not in the dataset at all**. | Effort added; Pollu demoted; Ghost's role corrected |

Also deleted throughout: roughly a dozen editorial lines that read as fact but assert nothing checkable — "widely regarded as the best jungler of his generation", "the widest support champion pool in the LCK", "the team's mechanical prodigy and public face", unsourced All-Pro selections.

One name was **deleted rather than guessed**: **Ryu**'s `nativeName`. Sources split between 유상욱 and 류상욱, and his handle collides with one of the readings — precisely the case where a guess looks confident and is wrong.

### High-risk 2026 claims: all confirmed

Every one of these was independently re-checked and holds up.

| Claim | Verdict | Notes |
|---|---|---|
| Peyz on T1 | ✅ Confirmed | Signed Nov 2025, three-year deal, replacing Gumayusi |
| Gumayusi on Hanwha Life | ✅ Confirmed | Two-year deal, replacing Viper |
| Viper left HLE | ✅ Confirmed | Departed Nov 2025; joined **Bilibili Gaming** in the LPL |
| KT traded Aiming for Jiwoo, late July 2026 | ✅ Confirmed | Aiming pulled 29 July over an internal dispute, traded to Kiwoom DRX **30 July 2026** |
| T1 won Worlds 2025, 3-2 over KT | ✅ Confirmed | Gumayusi Finals MVP; T1's sixth title |
| HLE won MSI 2026, 3-2 over BLG | ✅ Confirmed | Zeus Finals MVP; HLE's first MSI |
| Dplus KIA won EWC 2026 | ✅ Confirmed | 3-0 over Karmine Corp; Smash MVP |
| G2 won LEC Versus 2026 and LEC Spring 2026 | ✅ Confirmed | Both finals over Karmine Corp |
| kkOma on hiatus, Tom interim | ✅ Confirmed | But the date was wrong — announced **23 March 2026**, mid-season, not before it |

And one thing the audit **added** because its absence was misleading: Gen.G won **MSI 2025** as well as MSI 2024 (back-to-back, Chovy Finals MVP). The whole starting five was missing that title.

---

## Confidence ladder

Every audited field carries one of four values. See `src/verification.ts`.

| Value | Meaning |
|---|---|
| `'confirmed'` | Two or more **independent** publishers agree. Independent means different publishers — a wiki and its mirror count once. |
| `'reported'` | One source, or sources that are plausible but derivative (aggregator profiles echoing a wiki). Usable, not citable. |
| `'disputed'` | Sources actively disagree. Both readings are recorded in `variants`. **Do not present a disputed field as fact.** |
| `'unverified'` | Nobody checked it, or the check failed. Treat as absent. |

Current state of the 62-player dataset:

- **391 audited fields**: 309 confirmed, 41 reported, 13 disputed, 28 unverified.
- **31 of 62 players** carry at least one unverified or disputed field.
- Most disputes are **Korean romanisation**, not identity — the Hangul agrees, the Latin spelling does not (Delight, Cuzz, Zeka, Peyz, Gumayusi, Smash, Career). Both spellings are kept as lookup aliases, so search works either way.
- The most common unverified fields are `nativeName` (Hangul that only one outlet carried) and `joinedAt` (transfer-window dates that were not re-checked).

### Fields that are *not* audited

`signatureChampions` is editorial — champions a player is publicly identified with, used only for FX theming. It is not a statistical champion pool and nothing should treat it as one. `referenceQueries` are search strings for asset ingestion, not claims.

---

## Using the provenance data

```ts
import {
  unverifiedPlayers,
  verificationOf,
  confidenceOf,
  verifiedPlayers,
  TEAM_COLOR_VERIFICATION,
} from '@hexa/data';

// The `hexa players --unverified` view: every row still carrying an
// unverified or disputed field, and which fields they are.
unverifiedPlayers();
// [ { player: 'Ryu', fields: ['fullName'] },
//   { player: 'Cuzz', fields: ['fullName', 'nativeName', 'joinedAt'] }, … ]

// Per-field confidence, the competing readings, and the URLs behind them.
verificationOf('delight')?.fields.fullName;
// { confidence: 'disputed',
//   variants: ['Yu Hwan-jung', 'Yoo Hwan-joong'],
//   sources: [ … ],
//   note: 'A genuine split: …' }

confidenceOf('peyz', 'teamId');   // 'confirmed'
verifiedPlayers();                // every Player with its audit attached
```

`VerifiedPlayer` is a **local** extension of `Player` — `@hexa/core` is deliberately untouched so the render pipeline keeps working against the plain shape.

`validateRoster()` now **fails** when a player carries career highlights with no sources behind them, or when a verification entry claims confidence while citing nothing. An unsourced achievement attributed to a real person must not ship.

---

## Team brand colours

Four of seven `primary` values are matched to a published brand swatch. Three are not.

| Team | `primary` | Status |
|---|---|---|
| T1 | `#E2012D` | ✅ Confirmed — T1 red, Pantone 185 C |
| Gen.G | `#A58721` | ✅ Confirmed — Gen.G gold (note: *not* the commonly quoted `#AA8A00`) |
| G2 Esports | `#EE3D23` | ✅ Confirmed — Pantone 3556 C. G2 call it Orange |
| Dplus KIA | `#B8FCCC` | ✅ Confirmed — "Dplus Mint", with `#E2EE83` "Dplus Lime" as the sub colour |
| KT Rolster | `#A3122B` | ❌ **Unverified** — no published hex found |
| Hanwha Life | `#F3721F` | ❌ **Unverified** — orange + grey confirmed as the palette, the hex is not |
| Karmine Corp | `#057E9D` | ❌ **Unverified** — blue confirmed as the brand colour, the hex is not |

`accent`, `dark` and `light` are engine-side derivations for every team by design. They are not brand swatches and will never be marked confirmed. Machine-readable in `TEAM_COLOR_VERIFICATION`.

---

## Rosters change. This one changed twice mid-season.

KT Rolster's 2026 is the cautionary tale: they signed a bot laner and two supports in November, lost the support job to a Challengers call-up in Spring, and traded the bot laner away on 30 July. A signing announcement is not a lineup.

**Any row in this package can be stale within a week.** Re-verify before a season, after any trade window, and any time a render surprises you.

### How to re-verify

1. **Start at the wiki — from a network that can reach it.** `liquipedia.net/leagueoflegends/<Team>` and `lol.fandom.com/wiki/<Team>` both keep dated roster tables with a "Former" section. These are the sources this audit could *not* use, so they are the first thing a re-check should add.
2. **Confirm against a dated transfer report.** Sheep Esports, Inven Global and Esports Insider cover LCK/LEC rostermania and mid-season trades. A wiki edit with no report behind it is worth a second look.
3. **Confirm the current starter, not the contract.** This is where the audit found the worst error. Check who actually played.
4. **Check the match feed.** `gol.gg` and `lolesports.com` show who played the most recent series — the last word on a contested lineup.
5. **For Korean legal names, prefer the Hangul.** Romanisation varies by outlet and is the single most common disagreement in this dataset. If you must print Latin script, use the spelling the player's own org uses.
6. **Run the integrity pass.**

```bash
npx tsc -p packages/data/tsconfig.json
npx vitest run packages/data
```

`validateRoster()` catches broken shape and missing provenance. It cannot catch a wrong fact — only a human with a working network can do that.

### When you find something wrong

1. Fix the row in `src/players/<team>.ts` and leave an inline comment saying what was wrong and why.
2. Update the matching entry in `src/verification.ts` — confidence, sources, and a `note` if the sources disagree.
3. Add the URL to `ROSTER_SOURCES` in `src/roster.ts`.
4. Bump `ROSTER_SOURCED_AT` and the `checkedAt` constant in `src/verification.ts`.
5. Prefer **deleting** a field to guessing it. An absent honour is a gap; an invented one is a lie about someone's career.
