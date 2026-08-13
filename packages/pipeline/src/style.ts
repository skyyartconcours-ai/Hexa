/**
 * Style resolution — light, grade and atmosphere.
 *
 * Pure functions from (template style + variant axes + palette) to the concrete
 * numbers the compiler puts in a plan. Kept out of `compile.ts` because this is
 * the part with opinions in it, and opinions deserve their own tests.
 *
 * ANGLE CONVENTION
 * Angles are degrees, measured counter-clockwise from screen-right:
 *
 *        90° (above)
 *          │
 *   180° ──┼── 0°   (screen-left ← → screen-right)
 *          │
 *        270° (below)
 *
 * A "rim from the right" is therefore a small positive angle, lifted by the
 * rig's elevation. This is the pipeline's convention; if @hexa/render reads
 * angles differently, `rimFor` is the one place to reconcile it.
 */

import { hexToOklab, mix, rotateHue, saturate, shade, withAlpha } from '@hexa/core';
import type { AtmosphereSpec, GradeSpec, LightRig, StyleSpec } from '@hexa/core';
import { rimColorFor } from './palette.js';
import type { ResolvedPalette, VariantAxes } from './types.js';

/** How each named rig lifts and weights its rim light. */
interface RigProfile {
  /** Degrees above the horizon the rim comes from; negative is uplight. */
  elevation: number;
  /** Rim strength 0–1.5. */
  intensity: number;
  /** Rim width as a fraction of the subject's rendered width. */
  width: number;
  /** Ambient fill on the subject — how much the backplate lifts the shadows. */
  fill: number;
  /** Contact-shadow opacity; hard rigs cast harder shadows. */
  shadow: number;
}

export const LIGHT_RIGS: Readonly<Record<LightRig, RigProfile>> = {
  // The versus signature: two opposing rims, near-horizontal, both strong.
  'split-rim': { elevation: 14, intensity: 0.95, width: 0.03, fill: 0.18, shadow: 0.55 },
  // Overhead key: deep eye shadows, the "cinematic villain" look.
  'top-key': { elevation: 62, intensity: 0.75, width: 0.024, fill: 0.1, shadow: 0.7 },
  // Uplight: menacing, reads as danger because faces are never lit this way.
  'under-glow': { elevation: -52, intensity: 0.85, width: 0.032, fill: 0.14, shadow: 0.35 },
  // Nearly silhouetted against a bright plate — huge separation, low detail.
  backlit: { elevation: 34, intensity: 1.2, width: 0.042, fill: 0.06, shadow: 0.3 },
  // Arena spotlights: high, wide, with visible cones handled by the atmosphere.
  stage: { elevation: 48, intensity: 0.95, width: 0.03, fill: 0.16, shadow: 0.6 },
  // Flat neon fill: little modelling, colour does the work.
  'neon-wash': { elevation: 6, intensity: 0.7, width: 0.036, fill: 0.32, shadow: 0.25 },
  // Volumetric shafts from behind; the rim is the shaft hitting the shoulder.
  'god-rays': { elevation: 56, intensity: 1.05, width: 0.034, fill: 0.12, shadow: 0.45 },
  // Warm particulate; the rim is firelight, low and soft.
  ember: { elevation: -18, intensity: 0.8, width: 0.038, fill: 0.2, shadow: 0.4 },
  // Product-shot neutrality: minimal rim, even fill.
  clean: { elevation: 20, intensity: 0.42, width: 0.02, fill: 0.4, shadow: 0.3 },
};

export function rigProfile(rig: LightRig | undefined): RigProfile {
  return LIGHT_RIGS[rig ?? 'split-rim'] ?? LIGHT_RIGS['split-rim'];
}

/** The effective light rig after the variant axis has had its say. */
export function lightRigFor(style: StyleSpec, axes: VariantAxes): LightRig {
  return axes.lightRig ?? style.lightRig ?? 'split-rim';
}

export interface RimSpec {
  angle: number;
  width: number;
  color: string;
  intensity: number;
}

/**
 * The rim light for one subject.
 *
 * This is the effect that sells a versus composite. The left subject is rimmed
 * from screen-right **in the right team's colour**, and the right subject from
 * screen-left in the left team's — so each player is edged in their opponent's
 * colour. It reads as two light sources fighting across the frame, it separates
 * both subjects from the backplate, and it states the matchup in colour before
 * the viewer has read a single word.
 *
 * @param subjectWidth rendered width of the subject in pixels, so rim width
 * scales with the composite instead of being a fixed number that is invisible at
 * 1280 and a stripe at 2560
 */
/**
 * Below this hue separation (degrees, measured in OKLab) two rim lights read as
 * one colour, and the "two lights fighting across the frame" effect collapses
 * into a single warm wash.
 */
const MIN_RIM_HUE_SEPARATION = 42;

function hueOf(hex: string): number {
  const { a, b } = hexToOklab(hex);
  return (Math.atan2(b, a) * 180) / Math.PI;
}

/** Smallest signed rotation from `from` to `to`, in degrees. */
function hueDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Force the two rims apart when the brands are too close to oppose each other.
 *
 * The palette resolver already guarantees the two *team* colours are separable
 * as fills, but separable is not the same as opposed: an LCK final between a red
 * org and an orange one gives two warm rims, and the composite reads as one
 * light source with a wide spread rather than two players lit against each
 * other. Every real key art solves this the same way — one side is pushed cool
 * and the other warm — so that is what happens here, symmetrically, and only
 * when the brands leave no separation of their own.
 *
 * Only the *rim* moves. The fills, the colour blocking and the nameplates keep
 * the true brand colours, so the teams stay correctly branded while the light
 * on them tells the story.
 */
function opposeRim(color: string, side: 'left' | 'right' | 'center', palette: ResolvedPalette): string {
  if (side === 'center') return color;
  const separation = Math.abs(hueDelta(hueOf(palette.left), hueOf(palette.right)));
  if (separation >= MIN_RIM_HUE_SEPARATION) return color;

  // Split the shortfall between the two sides so neither brand is favoured.
  const push = (MIN_RIM_HUE_SEPARATION - separation) / 2 + 12;
  return saturate(rotateHue(color, side === 'left' ? push : -push), 1.08);
}

export function rimFor(
  side: 'left' | 'right' | 'center',
  palette: ResolvedPalette,
  axes: VariantAxes,
  rig: LightRig,
  subjectWidth: number,
): RimSpec {
  const profile = rigProfile(rig);
  const color = axes.rim === 'unified' ? rimColorFor(side, palette, axes.rim) : opposeRim(rimColorFor(side, palette, axes.rim), side, palette);

  // A rim from the opposite side of where the subject sits: light crosses the
  // frame between them, which is what makes the two subjects feel adjacent
  // rather than pasted side by side.
  const fromRight = axes.rim === 'unified' ? true : side !== 'right';
  const base = fromRight ? profile.elevation : 180 - profile.elevation;

  return {
    angle: normaliseAngle(base + axes.rimAngleOffset),
    width: Math.max(2, Math.round(subjectWidth * profile.width)),
    color,
    intensity: clamp(profile.intensity, 0, 1.5),
  };
}

/** Glow that bleeds the rim colour into the surrounding air. */
export function glowFor(rim: RimSpec, rig: LightRig): { radius: number; color: string; intensity: number } {
  const profile = rigProfile(rig);
  return {
    radius: Math.max(6, Math.round(rim.width * 4.5)),
    color: rim.color,
    intensity: clamp(profile.intensity * 0.55, 0.1, 0.9),
  };
}

/** Drop shadow that keeps the subject's edge off the backplate. */
export function separationShadow(rig: LightRig, palette: ResolvedPalette, subjectWidth: number): {
  dx: number;
  dy: number;
  blur: number;
  color: string;
  opacity: number;
} {
  const profile = rigProfile(rig);
  const unit = Math.max(2, subjectWidth * 0.012);
  return {
    dx: 0,
    dy: Math.round(unit * 0.6),
    blur: Math.round(unit * 3),
    color: shade(palette.dark, -0.05),
    opacity: clamp(profile.shadow * 0.6, 0.1, 0.6),
  };
}

/** Contact shadow params — the dark pool that grounds a subject. */
export function contactShadowParams(
  rig: LightRig,
  palette: ResolvedPalette,
): { color: string; opacity: number; softness: number } {
  const profile = rigProfile(rig);
  return {
    color: withAlpha(shade(palette.dark, -0.08), 1),
    opacity: clamp(profile.shadow, 0.15, 0.85),
    softness: rig === 'clean' || rig === 'neon-wash' ? 0.75 : 0.45,
  };
}

// ── Grade ────────────────────────────────────────────────────────────────────

/** Named grade personalities the variant axis selects between. */
export const GRADE_BIASES: Readonly<Record<Exclude<VariantAxes['gradeBias'], 'template'>, GradeSpec>> = {
  // The classic blockbuster split-tone: teal shadows, amber highlights.
  'teal-orange': {
    contrast: 1.12,
    saturation: 1.08,
    shadowTint: '#1E4F5C',
    highlightTint: '#FFB25E',
    splitToneBalance: 0.45,
    temperature: 6,
  },
  // Lifted blacks and hard contrast — the "film print" look.
  crushed: {
    contrast: 1.28,
    lift: [0.03, 0.03, 0.045],
    gamma: [0.96, 0.96, 1.0],
    saturation: 0.96,
    vignette: 0.32,
  },
  // Washed and bright; reads well against a busy YouTube grid.
  bleach: {
    exposure: 0.25,
    contrast: 1.18,
    saturation: 0.78,
    highlightTint: '#FFF3E0',
    splitToneBalance: 0.6,
  },
  // Monochrome with a cold cast. Extremely legible at small sizes.
  noir: {
    saturation: 0.06,
    contrast: 1.35,
    shadowTint: '#0E1420',
    vignette: 0.4,
    grain: 0.18,
  },
  // Warm, glowing, particulate — pairs with the ember rig.
  ember: {
    temperature: 18,
    saturation: 1.14,
    shadowTint: '#2A1206',
    highlightTint: '#FF9A3C',
    splitToneBalance: 0.35,
    halation: 0.4,
    bloomThreshold: 0.72,
    bloomIntensity: 0.35,
  },
  // Desaturated cool steel; esports-broadcast neutral.
  'cold-steel': {
    temperature: -14,
    tint: -4,
    saturation: 0.88,
    contrast: 1.16,
    shadowTint: '#141C2B',
    highlightTint: '#DCE8F5',
    splitToneBalance: 0.5,
  },
};

/**
 * Final grade for a plan.
 *
 * Precedence, weakest to strongest: the template's own grade, the variant's
 * grade bias, the variant's LUT, then the request's explicit overrides. The
 * request wins outright — someone who typed `--grade-saturation 0` meant it.
 */
export function gradeFor(
  style: StyleSpec,
  axes: VariantAxes,
  lutNames: readonly string[],
  overrides?: Partial<GradeSpec>,
): GradeSpec {
  const base: GradeSpec = { ...(style.grade ?? {}) };
  const bias = axes.gradeBias === 'template' ? {} : (GRADE_BIASES[axes.gradeBias] ?? {});
  const merged: GradeSpec = { ...base, ...bias };

  const lut = axes.lut ?? (axes.lutIndex >= 0 ? lutNames[axes.lutIndex % Math.max(1, lutNames.length)] : undefined);
  if (lut) {
    merged.lut = lut;
    merged.lutStrength = axes.lutStrength;
  }

  return { ...merged, ...(overrides ?? {}) };
}

// ── Atmosphere ───────────────────────────────────────────────────────────────

/** Per-kind defaults so an axis switch produces a coherent effect, not noise. */
const PARTICLE_DEFAULTS: Record<string, { density: number; tint: 'accent' | 'light' | 'dark' }> = {
  dust: { density: 0.35, tint: 'light' },
  ember: { density: 0.45, tint: 'accent' },
  spark: { density: 0.3, tint: 'accent' },
  shard: { density: 0.22, tint: 'light' },
  snow: { density: 0.4, tint: 'light' },
  confetti: { density: 0.5, tint: 'accent' },
  smoke: { density: 0.28, tint: 'dark' },
};

/**
 * Atmosphere after the variant axes are applied.
 *
 * Haze is the biggest single "cinematic" lever there is: it puts air between the
 * subject and the backplate, which is the difference between a composite and a
 * collage. Density multipliers are clamped so a variant can push the look
 * without producing an unusable soup.
 */
export function atmosphereFor(style: StyleSpec, axes: VariantAxes, palette: ResolvedPalette): AtmosphereSpec {
  const base = style.atmosphere ?? {};
  const out: AtmosphereSpec = {
    ...base,
    haze: clamp((base.haze ?? 0.25) * axes.haze, 0, 0.95),
  };

  if (axes.atmosphereKind === 'none') {
    delete out.particles;
    return out;
  }

  const kind = axes.atmosphereKind === 'template' ? base.particles?.kind : axes.atmosphereKind;
  if (kind) {
    const defaults = PARTICLE_DEFAULTS[kind] ?? { density: 0.3, tint: 'accent' as const };
    const density = (base.particles?.kind === kind ? base.particles.density : defaults.density) * axes.atmosphereDensity;
    out.particles = {
      kind,
      density: clamp(density, 0.02, 1),
      color: base.particles?.color ?? tintColor(defaults.tint, palette),
      bias: base.particles?.bias ?? 'none',
    };
  }

  if (base.rays) {
    out.rays = { ...base.rays, intensity: clamp(base.rays.intensity * axes.haze, 0, 1) };
  }
  if (base.speedLines) {
    out.speedLines = { ...base.speedLines, density: clamp(base.speedLines.density * axes.atmosphereDensity, 0, 1) };
  }
  if (base.fog !== undefined) {
    out.fog = clamp(base.fog * axes.haze, 0, 0.6);
  }

  return out;
}

function tintColor(tint: 'accent' | 'light' | 'dark', palette: ResolvedPalette): string {
  if (tint === 'accent') return saturate(palette.accent, 1.1);
  if (tint === 'dark') return mix(palette.dark, palette.left, 0.2);
  return palette.light;
}

/** Backdrop treatment after the variant axis. */
export function backdropFor(style: StyleSpec, axes: VariantAxes): NonNullable<StyleSpec['backdrop']> {
  return axes.backdrop ?? style.backdrop ?? 'gradient';
}

/** How strongly team colour drives the composition, 0–1. */
export function brandStrength(style: StyleSpec): number {
  return clamp(style.brandStrength ?? 0.75, 0, 1);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normaliseAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}
