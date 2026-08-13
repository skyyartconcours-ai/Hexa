/**
 * Palette derivation.
 *
 * A versus thumbnail is a colour argument: two brands pushed at each other hard
 * enough that the eye reads a conflict before it reads a word. That only works
 * if the two colours are actually distinguishable, which brand kits do not
 * guarantee — half the LCK brands in red, and two reds side by side read as one
 * muddy field rather than a fight.
 *
 * So the palette is *derived*, not copied: team colours go in, and what comes
 * out is guaranteed separable, guaranteed to have a legible dark and light, and
 * deterministic given the same teams. All blending happens in OKLab (via
 * @hexa/core) because sRGB midpoints drag saturated colours through grey.
 */

import { ensureDistinct, hexToOklab, mix, parseHex, rotateHue, saturate, shade, toHex } from '@hexa/core';
import type { PreparedSubject, ResolvedPalette } from './types.js';

/**
 * Used when a request has no subjects at all (template previews).
 * Written in the canonical lowercase form the resolver emits, so the constant
 * compares equal to a resolved palette rather than merely looking equal.
 */
export const NEUTRAL_PALETTE: ResolvedPalette = {
  left: '#3b6be8',
  right: '#e8433b',
  accent: '#f5c542',
  dark: '#0b0b0f',
  light: '#f5f7fa',
};

/** Below this OKLab separation two brand colours read as the same colour. */
const MIN_SIDE_SEPARATION = 0.14;
/** The accent has to stand apart from both sides or the VS mark disappears. */
const MIN_ACCENT_SEPARATION = 0.1;
/**
 * A colour below this OKLab lightness cannot act as a light source. Plenty of
 * brand kits list near-black as a secondary; it makes a fine fill and a useless
 * rim, and a black rim light is indistinguishable from no rim light at all.
 */
const MIN_EMISSIVE_L = 0.3;
/** The accent is drawn small and glowing, so it needs more headroom than a rim. */
const MIN_ACCENT_L = 0.45;

/**
 * Resolve the five working colours from the subjects' teams.
 *
 * @param subjects prepared subjects, in composition order
 * @param overrides explicit colours from the request, which always win
 */
export function resolvePalette(
  subjects: PreparedSubject[],
  overrides?: { left?: string; right?: string; accent?: string },
): ResolvedPalette {
  const leftSubject = subjects.find((s) => s.side === 'left') ?? subjects[0];
  const rightSubject =
    subjects.find((s) => s.side === 'right') ??
    subjects.find((s) => s !== leftSubject) ??
    leftSubject;

  if (!leftSubject) {
    return canonicalise({
      ...NEUTRAL_PALETTE,
      left: normalise(overrides?.left) ?? NEUTRAL_PALETTE.left,
      right: normalise(overrides?.right) ?? NEUTRAL_PALETTE.right,
      accent: normalise(overrides?.accent) ?? NEUTRAL_PALETTE.accent,
    });
  }

  const leftBrand = leftSubject.team.colors;
  const rightBrand = (rightSubject ?? leftSubject).team.colors;
  const sameTeam = leftSubject.team.id === (rightSubject ?? leftSubject).team.id;

  // The subject's own accent (a per-player override) outranks the team primary:
  // a player who is the face of the video should be lit in their colour.
  const left = normalise(overrides?.left) ?? normalise(leftSubject.accent) ?? normalise(leftBrand.primary)!;

  // The right side is chosen from the opposing brand kit, in preference order,
  // taking the first colour that is genuinely separable from the left *and*
  // bright enough to work as a rim light. Reaching into the kit beats computing
  // a colour: `secondary` is documented as the one that "drives rim light on the
  // opposing side", so a designer already answered this question. Rotating the
  // hue is the last resort, because it invents a colour nobody chose.
  const right = overrides?.right
    ? normalise(overrides.right)!
    : pickSideColor(left, sameTeam
        ? [normalise(rightSubject?.accent), rightBrand.secondary, rightBrand.accent, rightBrand.primary]
        : [normalise(rightSubject?.accent), rightBrand.primary, rightBrand.secondary, rightBrand.accent]);

  const accent = normalise(overrides?.accent) ?? deriveAccent(left, right, leftBrand.accent, rightBrand.accent);

  // Canonicalise on the way out. Brand kits spell the same colour `#C8102E` and
  // `#c8102e`, and a palette is hashed into cache keys and serialised into every
  // RenderPlan — two spellings of one colour would produce two plans that differ
  // only in case, defeating both the cache and a plan diff.
  return canonicalise({
    left,
    right,
    accent,
    dark: deriveDark(leftBrand.dark, rightBrand.dark),
    light: deriveLight(leftBrand.light, rightBrand.light),
  });
}

/** Every channel of a palette in one lowercase `#rrggbb` form. */
export function canonicalise(palette: ResolvedPalette): ResolvedPalette {
  return {
    left: normalise(palette.left) ?? NEUTRAL_PALETTE.left,
    right: normalise(palette.right) ?? NEUTRAL_PALETTE.right,
    accent: normalise(palette.accent) ?? NEUTRAL_PALETTE.accent,
    dark: normalise(palette.dark) ?? NEUTRAL_PALETTE.dark,
    light: normalise(palette.light) ?? NEUTRAL_PALETTE.light,
  };
}

/**
 * First candidate that is both separable from `left` and usable as a light.
 *
 * Falls back to forcing separation on the strongest candidate — a computed
 * colour is worse than a designed one, but far better than two teams rendering
 * in the same red.
 */
function pickSideColor(left: string, candidates: (string | undefined)[]): string {
  const usable = candidates.map(normalise).filter((c): c is string => c !== undefined);
  for (const candidate of usable) {
    if (separation(left, candidate) >= MIN_SIDE_SEPARATION && isEmissive(candidate)) return candidate;
  }
  const fallback = usable[0] ?? complementOf(left);
  return liftTo(ensureDistinct(left, fallback, MIN_SIDE_SEPARATION), MIN_EMISSIVE_L);
}

/** Bright enough to read as a light source rather than a shadow. */
function isEmissive(hex: string): boolean {
  return hexToOklab(hex).L >= MIN_EMISSIVE_L;
}

/** Raise lightness to `target` if it falls short, leaving hue and chroma alone. */
function liftTo(hex: string, target: number): string {
  const { L } = hexToOklab(hex);
  return L < target ? shade(hex, target - L) : hex;
}

function complementOf(hex: string): string {
  return rotateHue(hex, 180);
}

/**
 * The accent carries the versus mark, glows and energy FX, so it has to sit
 * apart from both sides rather than between them.
 *
 * Preference order: a brand accent that is already distinct from both sides
 * (free brand equity), else the saturated perceptual midpoint pushed away from
 * both. The midpoint is a genuinely good choice — it is the colour the light
 * would be if both rigs hit the same spot — but only once it is separable.
 */
function deriveAccent(left: string, right: string, leftAccent?: string, rightAccent?: string): string {
  for (const candidate of [leftAccent, rightAccent]) {
    const c = normalise(candidate);
    if (c && separation(c, left) >= MIN_ACCENT_SEPARATION && separation(c, right) >= MIN_ACCENT_SEPARATION) {
      return ensureLively(c);
    }
  }
  const midpoint = saturate(mix(left, right, 0.5), 1.3);
  const fromLeft = ensureDistinct(left, midpoint, MIN_ACCENT_SEPARATION);
  return ensureLively(ensureDistinct(right, fromLeft, MIN_ACCENT_SEPARATION));
}

/**
 * An accent has to survive being drawn small and glowing. Too dark and the VS
 * mark vanishes into the backplate; too desaturated and it reads as a mistake.
 */
function ensureLively(hex: string): string {
  const lifted = liftTo(hex, MIN_ACCENT_L);
  return chroma(lifted) < 0.06 ? saturate(lifted, 1.8) : lifted;
}

/**
 * Background falloff and vignette colour. Blended then pushed down: brand
 * "dark" values are often only mid-dark, and a thumbnail needs somewhere for
 * the subject's rim light to actually read against.
 */
function deriveDark(a: string, b: string): string {
  const blended = mix(normalise(a) ?? '#0B0B0F', normalise(b) ?? '#0B0B0F', 0.5);
  const { L } = hexToOklab(blended);
  return L > 0.22 ? shade(blended, 0.22 - L) : blended;
}

/** Text-on-dark colour. Kept slightly tinted so type belongs to the scene. */
function deriveLight(a: string, b: string): string {
  const blended = mix(normalise(a) ?? '#F5F7FA', normalise(b) ?? '#F5F7FA', 0.5);
  const { L } = hexToOklab(blended);
  return L < 0.9 ? shade(blended, 0.9 - L) : blended;
}

/** OKLab separation, matching the metric @hexa/core's ensureDistinct uses. */
export function separation(a: string, b: string): number {
  const A = hexToOklab(a);
  const B = hexToOklab(b);
  return Math.hypot(A.a - B.a, A.b - B.b) + Math.abs(A.L - B.L) * 0.5;
}

function chroma(hex: string): number {
  const { a, b } = hexToOklab(hex);
  return Math.hypot(a, b);
}

/** Accept `#rgb`, `#rrggbb`, `rrggbb`; reject anything unparseable. */
function normalise(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  try {
    return toHex(parseHex(hex));
  } catch {
    return undefined;
  }
}

/**
 * The rim colour for a subject: the *opposing* team's colour, because that is
 * what sells the clash. A light from screen-right in the right team's colour
 * separates the left subject from the plate and says who they are fighting in
 * the same stroke.
 */
export function rimColorFor(
  side: 'left' | 'right' | 'center',
  palette: ResolvedPalette,
  polarity: 'opposing' | 'unified' | 'inverted' = 'opposing',
): string {
  if (polarity === 'unified') return palette.accent;
  if (side === 'center') return polarity === 'inverted' ? palette.left : palette.accent;
  const own = side === 'right' ? palette.right : palette.left;
  const other = side === 'right' ? palette.left : palette.right;
  // A rim has to emit. A team that brands in near-black would otherwise light
  // their opponent with a colour indistinguishable from no light at all.
  return liftTo(polarity === 'inverted' ? own : other, MIN_EMISSIVE_L);
}
