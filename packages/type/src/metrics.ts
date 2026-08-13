/**
 * Advance-width tables.
 *
 * ## Why these exist
 *
 * Hexa cannot assume Anton or Bebas Neue is installed — they are SIL OFL fonts
 * we deliberately do not bundle (see `fonts/README.md`). But layout has to
 * happen anyway: `autoFit` needs to know whether "GRAND FINAL — LOWER BRACKET"
 * fits in a 640 px box *before* anything is rasterised.
 *
 * So this module ships hand-calibrated advance widths for three **classes** of
 * face, normalised to the em box (a value of 0.6 means the glyph advances 0.6 ×
 * font-size):
 *
 *  - `condensed` — heavy condensed display faces: Anton, Bebas Neue, Oswald,
 *    Teko, Impact, Haettenschweiler. Cap height ≈ 0.73 em with uppercase
 *    advances averaging ≈ 0.55 em, i.e. the ~1.0 width-to-cap-height aspect
 *    that reads as "esports headline".
 *  - `grotesque` — normal-width grotesques at display weight: Archivo Black,
 *    Inter, Helvetica/Arial Bold, Montserrat, Chakra Petch.
 *  - `fallback` — a generic regular-weight sans, keyed to Helvetica/Arial
 *    metrics, used for anything unrecognised.
 *
 * ## Accuracy
 *
 * **These are approximations.** They are calibrated so that a full uppercase
 * headline measures within a few percent of the real face, which is what
 * matters for fitting; individual glyphs can be off by more. Exact measurement
 * requires the real font file — register one with `registerFont()` (or let
 * `ensureFonts()` find it) and `measureText` switches to true glyph advances
 * read via opentype.js. The tables are the floor, never the ceiling.
 */

export type FamilyClass = 'condensed' | 'grotesque' | 'fallback';

export interface ClassMetrics {
  /** Normalised advance per character, in em. */
  advance: Record<string, number>;
  /** Cap height as a fraction of the em box. */
  capHeight: number;
  xHeight: number;
  /** Typographic ascent/descent as fractions of the em box, both positive. */
  ascent: number;
  descent: number;
  /** Advance used for characters absent from the table. */
  defaultAdvance: number;
  /** Weight the table was calibrated at; widths scale away from it. */
  baseWeight: number;
}

/** Base punctuation widths, keyed to Helvetica/Arial regular. */
const PUNCT_BASE: Record<string, number> = {
  ' ': 0.278, '!': 0.333, '"': 0.474, '#': 0.556, $: 0.556, '%': 0.889, '&': 0.722,
  "'": 0.238, '(': 0.333, ')': 0.333, '*': 0.389, '+': 0.584, ',': 0.278, '-': 0.333,
  '.': 0.278, '/': 0.278, ':': 0.278, ';': 0.278, '<': 0.584, '=': 0.584, '>': 0.584,
  '?': 0.611, '@': 1.015, '[': 0.278, '\\': 0.278, ']': 0.278, '^': 0.469, _: 0.556,
  '`': 0.333, '{': 0.334, '|': 0.26, '}': 0.334, '~': 0.584,
  // Typographic punctuation that shows up constantly in esports copy.
  '–': 0.556, '—': 1.0, '‘': 0.238, '’': 0.238, '“': 0.474,
  '”': 0.474, '…': 1.0, '×': 0.584, '•': 0.35, '°': 0.4,
};

function letters(spec: string): Record<string, number> {
  // "A .578 B .572" style, kept dense so the tables stay readable.
  const out: Record<string, number> = {};
  const parts = spec.trim().split(/\s+/);
  for (let i = 0; i + 1 < parts.length; i += 2) out[parts[i]!] = Number(parts[i + 1]);
  return out;
}

function buildAdvance(specific: Record<string, number>, punctScale: number, spaceWidth: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(PUNCT_BASE)) out[k] = Number((v * punctScale).toFixed(4));
  Object.assign(out, specific);
  out[' '] = spaceWidth;
  return out;
}

// ── condensed ────────────────────────────────────────────────────────────────
// Anton/Bebas-calibrated. Uppercase averages 0.554 em against a 0.73 em cap
// height, the ~1.0 aspect noted above.
const CONDENSED_GLYPHS = letters(`
  A .578 B .572 C .560 D .590 E .500 F .488 G .583 H .600 I .268 J .470 K .570
  L .478 M .757 N .606 O .603 P .548 Q .607 R .566 S .519 T .506 U .589 V .560
  W .845 X .552 Y .530 Z .512
  a .506 b .524 c .476 d .524 e .506 f .318 g .524 h .524 i .250 j .250 k .500
  l .250 m .790 n .524 o .513 p .524 q .524 r .350 s .450 t .340 u .524 v .470
  w .720 x .466 y .470 z .440
  0 .553 1 .341 2 .530 3 .530 4 .559 5 .530 6 .545 7 .500 8 .545 9 .545
`);

// ── grotesque ────────────────────────────────────────────────────────────────
// Archivo Black / Helvetica Bold-calibrated.
const GROTESQUE_GLYPHS = letters(`
  A .760 B .740 C .760 D .770 E .680 F .650 G .800 H .790 I .340 J .640 K .760
  L .650 M .930 N .790 O .810 P .710 Q .810 R .760 S .710 T .680 U .780 V .740
  W 1.060 X .740 Y .720 Z .670
  a .610 b .640 c .580 d .640 e .610 f .380 g .640 h .630 i .300 j .310 k .600
  l .300 m .950 n .630 o .630 p .640 q .640 r .450 s .560 t .400 u .630 v .580
  w .840 x .580 y .580 z .550
  0 .640 1 .500 2 .640 3 .640 4 .640 5 .640 6 .640 7 .620 8 .640 9 .640
`);

// ── fallback ─────────────────────────────────────────────────────────────────
// Helvetica/Arial regular. Exact for those two faces.
const FALLBACK_GLYPHS = letters(`
  A .667 B .667 C .722 D .722 E .667 F .611 G .778 H .722 I .278 J .500 K .667
  L .556 M .833 N .722 O .778 P .667 Q .778 R .722 S .667 T .611 U .722 V .667
  W .944 X .667 Y .667 Z .611
  a .556 b .556 c .500 d .556 e .556 f .278 g .556 h .556 i .222 j .222 k .500
  l .222 m .833 n .556 o .556 p .556 q .556 r .333 s .500 t .278 u .556 v .500
  w .722 x .500 y .500 z .500
  0 .556 1 .556 2 .556 3 .556 4 .556 5 .556 6 .556 7 .556 8 .556 9 .556
`);

export const FAMILY_METRICS: Record<FamilyClass, ClassMetrics> = {
  condensed: {
    advance: buildAdvance(CONDENSED_GLYPHS, 0.85, 0.24),
    capHeight: 0.73,
    xHeight: 0.53,
    ascent: 0.76,
    descent: 0.2,
    defaultAdvance: 0.554,
    baseWeight: 700,
  },
  grotesque: {
    advance: buildAdvance(GROTESQUE_GLYPHS, 1.06, 0.28),
    capHeight: 0.72,
    xHeight: 0.52,
    ascent: 0.76,
    descent: 0.21,
    defaultAdvance: 0.727,
    baseWeight: 800,
  },
  fallback: {
    advance: buildAdvance(FALLBACK_GLYPHS, 1.0, 0.278),
    capHeight: 0.716,
    xHeight: 0.519,
    ascent: 0.75,
    descent: 0.21,
    defaultAdvance: 0.667,
    baseWeight: 400,
  },
};

const CONDENSED_HINTS = [
  'anton', 'bebas', 'oswald', 'teko', 'impact', 'haettenschweiler', 'narrow',
  'condensed', 'compressed', 'gothic', 'fjalla', 'khand', 'saira condensed',
  'big shoulders', 'pathway', 'archivo narrow', 'six caps', 'stint',
];

const GROTESQUE_HINTS = [
  'archivo black', 'archivo', 'inter', 'helvetica', 'arial', 'roboto', 'montserrat',
  'poppins', 'chakra', 'rajdhani', 'exo', 'orbitron', 'russo', 'barlow', 'lato',
  'open sans', 'noto sans', 'source sans', 'work sans', 'manrope', 'dejavu sans',
  'liberation sans', 'freesans', 'segoe', 'sans',
];

/** Which table best models `family`. Order matters: condensed wins ties. */
export function classifyFamily(family: string): FamilyClass {
  const f = family.toLowerCase();
  for (const h of CONDENSED_HINTS) if (f.includes(h)) return 'condensed';
  for (const h of GROTESQUE_HINTS) if (f.includes(h)) return 'grotesque';
  return 'fallback';
}

const CJK_RANGES: [number, number][] = [
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xfe30, 0xfe4f],
  [0xff00, 0xff60], [0xffe0, 0xffe6],
];

function isFullWidth(cp: number): boolean {
  return CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/**
 * Table-based advance for one code point, in em.
 *
 * Accented Latin decomposes to its base letter (É → E) so European player
 * names measure sensibly; combining marks then contribute zero.
 */
export function tableAdvance(m: ClassMetrics, ch: string): number {
  const direct = m.advance[ch];
  if (direct !== undefined) return direct;

  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0x200b || cp === 0xfeff) return 0;
  if (cp >= 0x0300 && cp <= 0x036f) return 0; // combining marks
  if (cp === 0x00a0) return m.advance[' '] ?? m.defaultAdvance; // nbsp
  if (cp === 0x2009) return (m.advance[' '] ?? 0.25) * 0.5; // thin space
  if (isFullWidth(cp)) return 1.0;
  if (cp > 0xffff) return 1.15; // emoji and other astral glyphs run wide

  const decomposed = ch.normalize('NFD');
  if (decomposed !== ch) {
    let sum = 0;
    for (const part of decomposed) sum += tableAdvance(m, part);
    if (sum > 0) return sum;
  }
  return m.defaultAdvance;
}

/**
 * Heavier faces are wider. The tables sit at each class's `baseWeight`; this
 * scales away from it at roughly 7 % per 500 weight units, which tracks the
 * Regular→Black span of most variable grotesques.
 */
export function weightWidthFactor(m: ClassMetrics, weight: number | undefined): number {
  if (!weight) return 1;
  const f = 1 + (weight - m.baseWeight) * 0.00014;
  return Math.max(0.85, Math.min(1.2, f));
}
