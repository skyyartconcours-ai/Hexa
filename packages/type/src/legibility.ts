/**
 * The 210×118 test.
 *
 * YouTube's grid thumbnail is 210×118 px. A 1280×720 render is shown at 16 %
 * of its designed size there, and that is where most viewers first meet it. So
 * the rule that matters is not "is this readable" but "is this readable after a
 * 6× downsample" — which is a rule about *cap height as a fraction of canvas
 * height*, not about font size.
 *
 * The thresholds below are the ones that actually predict failure:
 *
 *  - **Cap height ≥ 3.5 % of canvas height.** Below that a capital renders
 *    under ~4 px in the grid and dissolves into the artwork.
 *  - **Contrast ≥ 4.5:1, or an outline/plate.** Thumbnails sit over busy
 *    imagery; the WCAG body-text threshold is the right floor, and a hard
 *    stroke or a solid plate is the genre's standard way to buy it back.
 *  - **≤ 22 characters in a headline.** Past that, the per-glyph size needed
 *    to fill a 16:9 box collapses.
 *  - **Weight ≥ 600 at small sizes.** Thin strokes are the first thing a
 *    downsample eats.
 */

import { contrastRatio, luminance, toHex } from '@hexa/core';
import type { PixelRect } from '@hexa/core';
import type { TextStyle } from './types.js';
import { resolveFace } from './fonts.js';

/** Minimum cap height as a fraction of canvas height. */
export const MIN_CAP_RATIO = 0.035;
/** WCAG contrast floor below which a stroke or plate becomes mandatory. */
export const MIN_CONTRAST = 4.5;
/** Headline character budget. */
export const MAX_HEADLINE_CHARS = 22;

/** Inverse of `luminance()` for a neutral grey — lets us reuse core's
 *  `contrastRatio` instead of re-deriving the WCAG formula here. */
function greyWithLuminance(L: number): string {
  const l = Math.max(0, Math.min(1, L));
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  const v = c * 255;
  return toHex({ r: v, g: v, b: v });
}

/** The colour a glyph reads as — the dominant stop of a gradient fill. */
function dominantFillColor(style: TextStyle): string {
  const f = style.fill;
  if (!f) return '#FFFFFF';
  if (f.kind === 'solid') return f.color;
  if (f.kind === 'stripe') return f.colors[0];
  const stops = f.stops ?? [];
  if (!stops.length) return '#FFFFFF';
  // The middle of the ramp is what the eye averages to at thumbnail size.
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  return sorted[Math.floor(sorted.length / 2)]?.color ?? '#FFFFFF';
}

function safeContrast(a: string, b: string): number {
  try {
    return contrastRatio(a, b);
  } catch {
    return 21; // Unparseable colour: do not manufacture a failure we cannot prove.
  }
}

/**
 * Score a style in context, 0–100, with concrete issues.
 *
 * `backgroundLuminance` is WCAG relative luminance (0–1) of whatever sits
 * behind the text — `luminance()` from `@hexa/core` on a sampled background
 * colour, or a measured mean from the render pass.
 */
export function legibilityScore(
  style: TextStyle,
  box: PixelRect,
  canvasHeight: number,
  backgroundLuminance: number,
): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;

  const H = canvasHeight > 0 ? canvasHeight : 720;
  const face = resolveFace(style.family, style.weight ?? 400, style.italic ?? false);
  const capPx = face.capHeight * (style.size || 0);
  const capRatio = capPx / H;

  const hasStroke = !!style.stroke && style.stroke.width > 0;
  const hasPlate = !!style.plate;

  // ── 1. Cap height at thumbnail scale ───────────────────────────────────────
  if (capRatio < MIN_CAP_RATIO) {
    const shortfall = (MIN_CAP_RATIO - capRatio) / MIN_CAP_RATIO;
    const penalty = Math.round(14 + 34 * Math.min(1, shortfall));
    score -= penalty;
    issues.push(
      `Cap height is ${capPx.toFixed(1)}px (${(capRatio * 100).toFixed(1)}% of canvas height); ` +
      `needs ≥${(MIN_CAP_RATIO * 100).toFixed(1)}% (${(MIN_CAP_RATIO * H).toFixed(0)}px) to survive a 210×118 render. ` +
      `At 210×118 this renders about ${(capRatio * 118).toFixed(1)}px tall.`,
    );
  }

  // ── 2. Contrast against the background ────────────────────────────────────
  const bg = greyWithLuminance(backgroundLuminance);
  const ink = dominantFillColor(style);
  const contrast = hasPlate ? safeContrast(ink, style.plate!.color) : safeContrast(ink, bg);

  if (contrast < MIN_CONTRAST) {
    if (hasPlate) {
      score -= 26;
      issues.push(
        `Fill ${ink} on plate ${style.plate!.color} is only ${contrast.toFixed(2)}:1; ` +
        `needs ≥${MIN_CONTRAST}:1. Darken the plate or lighten the fill.`,
      );
    } else if (!hasStroke) {
      score -= 34;
      issues.push(
        `Contrast against the background is ${contrast.toFixed(2)}:1 (needs ≥${MIN_CONTRAST}:1) ` +
        `and there is no stroke or plate to buy it back. Add stroke {width, color} or plate {color, padX, padY}.`,
      );
    } else {
      // A stroke is the genre-correct remedy, but it is not free.
      score -= 8;
      issues.push(
        `Contrast against the background is ${contrast.toFixed(2)}:1; the ${style.stroke!.width}px ` +
        `stroke is carrying the legibility. Verify it holds at 210×118.`,
      );
    }
  }

  // A stroke that is only just there does nothing once downsampled.
  if (hasStroke && style.stroke!.width < capPx * 0.03) {
    score -= 6;
    issues.push(
      `Stroke is ${style.stroke!.width}px against a ${capPx.toFixed(0)}px cap height ` +
      `(<3%); it will vanish at thumbnail scale. Use ≥${(capPx * 0.05).toFixed(1)}px.`,
    );
  }

  // ── 3. Headline length ────────────────────────────────────────────────────
  // The signature has no text, so infer the slot's character capacity: at this
  // size, how many glyphs does the box invite? A headline slot that wants more
  // than ~22 is a slot that will be filled with something unreadable, whether
  // or not the caller has written the copy yet.
  const isHeadline = capRatio >= 0.06;
  const avgAdvance = face.table.defaultAdvance * (style.size || 1) * (1 + (style.tracking ?? 0));
  const slotChars = avgAdvance > 0 && box && box.w > 0 ? box.w / avgAdvance : 0;
  if (isHeadline && slotChars > MAX_HEADLINE_CHARS) {
    const over = Math.round(slotChars - MAX_HEADLINE_CHARS);
    score -= Math.min(24, 6 + over * 0.8);
    issues.push(
      `This slot fits about ${Math.round(slotChars)} characters at ${style.size}px; ` +
      `headlines past ~${MAX_HEADLINE_CHARS} characters lose per-glyph size in the grid. ` +
      `Shorten the copy or move detail into a kicker.`,
    );
  }

  // ── 4. Weight vs size ─────────────────────────────────────────────────────
  const weight = style.weight ?? 400;
  if (weight < 600 && capRatio < 0.06) {
    score -= 12;
    issues.push(
      `Weight ${weight} at ${(capRatio * 100).toFixed(1)}% cap height is too thin to survive downsampling; ` +
      `use ≥600, or a heavier family.`,
    );
  }

  // ── 5. Tracking ───────────────────────────────────────────────────────────
  const tracking = style.tracking ?? 0;
  if (tracking < -0.04 && capRatio < 0.08) {
    score -= 8;
    issues.push(
      `Tracking ${tracking}em is tight enough that glyphs will merge at 210×118. ` +
      `Keep tracking above -0.04em below 8% cap height.`,
    );
  }

  // ── 6. Does it even fit its slot? ─────────────────────────────────────────
  if (box && box.h > 0 && style.size > box.h * 1.6) {
    score -= 10;
    issues.push(
      `Font size ${style.size}px is more than 1.6× the slot height (${box.h.toFixed(0)}px); ` +
      `run the style through autoFit() rather than trusting the literal size.`,
    );
  }

  if (style.opacity !== undefined && style.opacity < 0.75 && !hasPlate && !hasStroke) {
    score -= 10;
    issues.push(`Opacity ${style.opacity} on unstroked text loses effective contrast; keep hero text ≥0.85.`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

/**
 * Same rules, but with the actual string in hand so the character-count budget
 * can be applied. `legibilityScore` cannot see the text; this can.
 */
export function legibilityScoreForText(
  text: string,
  style: TextStyle,
  box: PixelRect,
  canvasHeight: number,
  backgroundLuminance: number,
): { score: number; issues: string[] } {
  const base = legibilityScore(style, box, canvasHeight, backgroundLuminance);
  const face = resolveFace(style.family, style.weight ?? 400, style.italic ?? false);
  const capRatio = (face.capHeight * (style.size || 0)) / (canvasHeight > 0 ? canvasHeight : 720);
  const chars = [...(text ?? '')].length;

  if (capRatio >= 0.06 && chars > MAX_HEADLINE_CHARS) {
    const over = chars - MAX_HEADLINE_CHARS;
    const penalty = Math.min(30, 6 + over * 1.2);
    return {
      score: Math.max(0, Math.round(base.score - penalty)),
      issues: [
        ...base.issues,
        `Headline is ${chars} characters; ≤${MAX_HEADLINE_CHARS} keeps per-glyph size high enough to read in the grid. ` +
        `Cut ${over} character${over === 1 ? '' : 's'} or move the detail to a kicker.`,
      ],
    };
  }
  return base;
}

/** Convenience: luminance of a background hex, for feeding `legibilityScore`. */
export function backgroundLuminanceOf(hex: string): number {
  try {
    return luminance(hex);
  } catch {
    return 0.1;
  }
}
