/**
 * Team brand kits.
 *
 * The seven organisations Hexa ships with out of the box: five LCK sides and
 * two LEC sides. Each entry carries a `BrandColors` kit that the render layer
 * turns into key light, rim light, glow, vignette and plate text colour.
 *
 * ## How the five slots map onto a real brand
 *
 * Real esports brands are usually specified as "one loud colour plus black and
 * white". `BrandColors` needs five, so the mapping is deliberate rather than
 * mechanical:
 *
 * - `primary`   — the org's published signature colour. Drives key light and
 *                 dominant fills. Always a real, sourced brand swatch.
 * - `secondary` — the second published brand colour, biased toward whichever
 *                 of the org's supporting tones actually *reads* as light on
 *                 camera (a silver/steel/white rather than the brand's black,
 *                 because a near-black rim light is invisible). Sourced where
 *                 the org publishes one, otherwise a value-shifted sibling of
 *                 `primary`.
 * - `accent`    — ENGINE-SIDE DERIVATION. A saturated, lifted form of
 *                 `primary` used for glows, strokes and energy FX. Not an
 *                 official swatch; tuned so opposing sides stay separable.
 * - `dark`      — the org's black, or a near-black tinted toward `primary`.
 *                 Used for vignette and background falloff.
 * - `light`     — near-white for text on dark plates, warmed or cooled a few
 *                 points toward `primary` so type doesn't read as pure #FFF.
 *
 * ## Which of these are actually sourced (audited 2026-08-13)
 *
 * `primary` is supposed to be "always a real, sourced brand swatch". After the
 * audit that is true for four of seven organisations, not all seven:
 *
 * | Team | `primary` | Status |
 * |------|-----------|--------|
 * | T1 | `#E2012D` | **confirmed** — published as T1's brand red (Pantone 185 C) |
 * | Gen.G | `#A58721` | **confirmed** — published as Gen.G gold |
 * | G2 | `#EE3D23` | **confirmed** — published as G2's brand colour (they call it Orange, Pantone 3556 C) |
 * | Dplus KIA | `#B8FCCC` | **confirmed** — "Dplus Mint", with `#E2EE83` "Dplus Lime" as the sub colour |
 * | KT Rolster | `#A3122B` | **UNVERIFIED** — no published hex found |
 * | Hanwha Life | `#F3721F` | **UNVERIFIED** — orange + grey is confirmed as the palette, the hex is not |
 * | Karmine Corp | `#057E9D` | **UNVERIFIED** — blue is confirmed as the brand colour, the hex is not |
 *
 * `accent`, `dark` and `light` are engine-side derivations for every team by
 * design — they are not brand swatches and are never "confirmed". `secondary`
 * is sourced only where the org publishes a second colour.
 *
 * Machine-readable form: {@link TEAM_COLOR_VERIFICATION}.
 *
 * ## Known hue collisions
 *
 * T1 (#E2012D), KT Rolster and G2 (#EE3D23) are all red-family brands, and the
 * Telecom War (T1 vs KT) is one of the most-rendered matchups in the LCK. They
 * are separated here by *value and chroma*, not hue: T1 is a bright vermilion
 * with a silver secondary, KT is a dark crimson with a cool steel secondary,
 * G2 sits on the orange side of red. When composing any two of these against
 * each other, prefer `secondary` for the opposing rim light — using `accent`
 * on both sides will read as one colour.
 *
 * @see ./players/ for the rosters that reference these ids.
 */

import type { Team } from '@hexa/core';

export const TEAMS: Team[] = [
  {
    id: 't1',
    name: 'T1',
    shortName: 'T1',
    tag: 'T1',
    region: 'KR',
    league: 'LCK',
    colors: {
      primary: '#E2012D',
      secondary: '#D9DCE3',
      accent: '#FF2E4D',
      dark: '#0A0A0C',
      light: '#F6F7FA',
    },
    founded: 2004,
    aliases: ['SKT', 'SKT T1', 'SK Telecom T1', 'SK Telecom', 'T1 Esports', 'Telecom'],
  },
  {
    id: 'hle',
    name: 'Hanwha Life Esports',
    shortName: 'Hanwha Life',
    tag: 'HLE',
    region: 'KR',
    league: 'LCK',
    colors: {
      primary: '#F3721F',
      secondary: '#8C9198',
      accent: '#FFA13A',
      dark: '#12100E',
      light: '#F8F4F0',
    },
    founded: 2018,
    aliases: ['Hanwha', 'Hanwha Life', 'HLE', '한화생명e스포츠', 'ROX Tigers'],
  },
  {
    id: 'geng',
    name: 'Gen.G',
    shortName: 'Gen.G',
    tag: 'GEN',
    region: 'KR',
    league: 'LCK',
    colors: {
      primary: '#A58721',
      secondary: '#D4AF37',
      accent: '#FFD873',
      dark: '#0B0B0B',
      light: '#F5F0E2',
    },
    founded: 2017,
    aliases: ['GenG', 'Gen G', 'GEN', 'Gen.G Esports', 'KSV', 'KSV eSports'],
  },
  {
    id: 'kt',
    name: 'KT Rolster',
    shortName: 'KT',
    tag: 'KT',
    region: 'KR',
    league: 'LCK',
    colors: {
      primary: '#A3122B',
      secondary: '#7E858F',
      accent: '#E2384E',
      dark: '#101216',
      light: '#EEF1F5',
    },
    founded: 1999,
    aliases: ['KT', 'kt Rolster', 'Rolster', 'KTR', 'KT Bullets', 'KT Arrows'],
  },
  {
    id: 'dplus',
    name: 'Dplus KIA',
    shortName: 'Dplus',
    tag: 'DK',
    region: 'KR',
    league: 'LCK',
    colors: {
      // Dplus publishes black + white as its main pair, with "Dplus Mint"
      // (#B8FCCC) as the key colour and "Dplus Lime" (#E2EE83) as the sub —
      // lime was effectively retired during 2025 and mint restored as key.
      primary: '#B8FCCC',
      secondary: '#E2EE83',
      accent: '#71F3B4',
      dark: '#07100C',
      light: '#F6FFFA',
    },
    founded: 2017,
    aliases: [
      'DK',
      'Dplus',
      'Dplus Kia',
      'DWG KIA',
      'DWG',
      'DAMWON',
      'DAMWON Gaming',
      'Damwon KIA',
    ],
  },
  {
    id: 'kc',
    name: 'Karmine Corp',
    shortName: 'Karmine',
    tag: 'KC',
    region: 'EU',
    league: 'LEC',
    colors: {
      primary: '#057E9D',
      secondary: '#FFFFFF',
      accent: '#22C3E6',
      dark: '#0D1015',
      light: '#F1F7FA',
    },
    founded: 2020,
    aliases: ['KC', 'KCorp', 'K Corp', 'Karmine', 'Blue Wall'],
  },
  {
    id: 'g2',
    name: 'G2 Esports',
    shortName: 'G2',
    tag: 'G2',
    region: 'EU',
    league: 'LEC',
    colors: {
      primary: '#EE3D23',
      secondary: '#FFFFFF',
      accent: '#FF6A3D',
      dark: '#0A0A0A',
      light: '#F5F5F5',
    },
    founded: 2013,
    aliases: ['G2', 'Gamers2', 'G2 Samurai', 'Samurai'],
  },
];

/**
 * Whether each team's `primary` (and `secondary`, where it is meant to be a
 * real swatch) could be matched to a published brand colour on 2026-08-13.
 *
 * `'derived'` means the value is an engine-side computation and was never
 * intended to be a brand swatch — that is not a gap, it is the design.
 * `'unverified'` means it *is* presented as a brand swatch and no source could
 * be found for it. Do not print an unverified hex next to a client's logo
 * without checking their brand guidelines first.
 */
export const TEAM_COLOR_VERIFICATION: Record<
  string,
  { primary: 'confirmed' | 'unverified'; secondary: 'confirmed' | 'derived' | 'unverified'; sources: string[]; note?: string }
> = {
  t1: {
    primary: 'confirmed',
    secondary: 'derived',
    sources: ['https://www.brandcolorcode.com/t1', 'https://sportsfancovers.com/esports-colors/t1-team-colors/'],
    note: '#E2012D is published as T1 red (Pantone 185 C). The silver secondary is a readability choice, not a published swatch.',
  },
  hle: {
    primary: 'unverified',
    secondary: 'unverified',
    sources: ['https://sportsfancovers.com/esports-colors/hanwha-life-esports-team-colors/'],
    note: 'Orange plus grey is confirmed as the brand palette; no published hex for either could be found.',
  },
  geng: {
    primary: 'confirmed',
    secondary: 'derived',
    sources: ['https://teamcolorcodes.com/gen-g-esports-colors/'],
    note: '#A58721 is published as Gen.G gold. Note this differs from the commonly quoted #AA8A00.',
  },
  kt: {
    primary: 'unverified',
    secondary: 'unverified',
    sources: [],
    note: 'No published KT Rolster brand hex could be found in this audit. Both values are best-guess.',
  },
  dplus: {
    primary: 'confirmed',
    secondary: 'confirmed',
    sources: ['https://en.namu.wiki/w/Dplus%20Kia/%EC%9C%A0%EB%8B%88%ED%8F%BC'],
    note: '#B8FCCC "Dplus Mint" and #E2EE83 "Dplus Lime" are both published brand colours. Which is key and which is sub has swapped over time; mint was restored as key during 2025.',
  },
  kc: {
    primary: 'unverified',
    secondary: 'derived',
    sources: [],
    note: 'Blue is confirmed as the Karmine Corp brand colour; #057E9D itself could not be sourced.',
  },
  g2: {
    primary: 'confirmed',
    secondary: 'derived',
    sources: ['https://www.brandcolorcode.com/g2-esports'],
    note: '#EE3D23 is published as G2\'s brand colour (Pantone 3556 C). G2 call it Orange; this file treats it as the orange side of red.',
  },
};
