/**
 * Contrast gate — WCAG-style ratio between type and whatever is actually behind
 * it in the finished pixels.
 *
 * Two things make this harder than calling `contrastRatio()` on two swatches:
 *
 *  1. The background behind text is rarely one colour. So the text rect is
 *     diced into a 3×3 grid and the *worst* cell decides the verdict — that is
 *     where a headline crossing from a dark plate onto a bright rim light
 *     actually breaks.
 *  2. Glyph pixels have to be excluded from the background sample, or the
 *     average drags toward the text colour and flatters the result. When the
 *     plan declares a text colour we classify by distance to it; when it does
 *     not, an Otsu split separates the two populations and the finding says the
 *     colour was estimated.
 *
 * Thresholds follow WCAG 1.4.3 for large text and its spirit for the rest:
 * 4.5:1 bare, relaxed to 3:1 when a stroke or plate is carrying the separation.
 */

import { contrastRatio, toHex } from '@hexa/core';
import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, collectTextRects, ramp, toNormRect } from '../geom.js';
import { INK_TOLERANCE, colorDistance, cropPixels, loadRgb, luma, meanColor, otsu, parseHexRgb } from '../image.js';
import { resolveTextStyle } from '../plan.js';

export const MIN_RATIO_BARE = 4.5;
export const MIN_RATIO_SUPPORTED = 3;

interface Sample {
  textHex: string;
  bgHex: string;
  ratio: number;
  /** 'declared' when the plan told us the text colour, 'estimated' otherwise. */
  basis: 'declared' | 'estimated';
  cell: string;
}

export const contrastGate: Gate = {
  id: 'contrast',
  weight: 1.6,
  description: 'Text meets a WCAG-style contrast ratio against the pixels actually behind it (4.5:1 bare, 3:1 with a stroke or plate)',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const rects = collectTextRects(ctx);
    if (rects.length === 0) {
      return [{ gate: 'contrast', severity: 'pass', message: 'No text layers in this render — nothing to contrast-check', score: 1 }];
    }

    const img = await loadRgb(ctx.image, { background: ctx.plan.canvas.background });
    const findings: QaFinding[] = [];

    for (const { role, rect } of rects) {
      const style = resolveTextStyle(ctx.plan, role, rect);
      const declared = style.color ? parseHexRgb(style.color) : null;
      const where = toNormRect(rect, ctx.width, ctx.height);

      // Worst 3×3 cell wins; a rect too small to dice is measured whole.
      const cols = rect.w >= 30 ? 3 : 1;
      const rows = rect.h >= 24 ? 3 : 1;
      let worst: Sample | null = null;

      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const cell = {
            x: rect.x + (rect.w / cols) * cx,
            y: rect.y + (rect.h / rows) * cy,
            w: rect.w / cols,
            h: rect.h / rows,
          };
          const px = cropPixels(img, cell);
          if (px.length < 24) continue;
          const s = sample(px, declared, cols === 1 ? 'whole rect' : `cell ${cx + 1},${cy + 1}`);
          if (s && (!worst || s.ratio < worst.ratio)) worst = s;
        }
      }

      if (!worst) {
        findings.push({
          gate: 'contrast',
          severity: 'warn',
          message: style.color
            ? `"${role}" declares text colour ${style.color} but no pixels of it were found in its ${rect.w}×${rect.h}px rect — the type may be missing, clipped, or painted in a different colour than the plan says`
            : `"${role}" has no measurable figure/ground split in its ${rect.w}×${rect.h}px rect — nothing that reads as type is there`,
          score: 0.5,
          where,
          suggestion: 'Check the text layer actually rendered (a missing font falls back to nothing in some rasterisers) and that plan.meta.textStyles records the colour the compositor really used.',
        });
        continue;
      }

      const required = style.hasStroke || style.hasPlate ? MIN_RATIO_SUPPORTED : MIN_RATIO_BARE;
      const support = style.hasPlate ? 'plate' : style.hasStroke ? 'stroke' : 'none';
      const basisNote = worst.basis === 'declared'
        ? `text ${worst.textHex} (declared in the plan)`
        : `text ${worst.textHex} (estimated from pixels — the plan declared no colour for this role)`;
      const detail = `${basisNote} on ${worst.bgHex} at ${worst.cell} = ${worst.ratio.toFixed(2)}:1, needs ${required}:1 (support: ${support})`;
      const score = clamp01(0.5 * ramp(worst.ratio, 1, required) + 0.5 * ramp(worst.ratio, required, 12));

      if (worst.ratio < required) {
        findings.push({
          gate: 'contrast',
          severity: 'fail',
          message: `"${role}" does not have enough contrast against its background — ${detail}`,
          score: clamp01(0.5 * ramp(worst.ratio, 1, required)),
          where,
          suggestion: style.hasStroke || style.hasPlate
            ? 'The stroke/plate is not carrying it. Darken the plate (or raise its opacity), or switch the type to the opposite end of the tonal range.'
            : `Add a 2–4px stroke or a scrim behind "${role}" (drops the requirement to ${MIN_RATIO_SUPPORTED}:1), or recolour the type — ${worst.bgHex} wants near-white or near-black over it.`,
        });
      } else if (worst.ratio < required + 1) {
        findings.push({
          gate: 'contrast',
          severity: 'warn',
          message: `"${role}" only just clears the contrast bar — ${detail}`,
          score,
          where,
          suggestion: 'Fine on a calibrated monitor, marginal on a phone in daylight. A little more separation is cheap insurance.',
        });
      } else {
        findings.push({
          gate: 'contrast',
          severity: 'pass',
          message: `"${role}" contrast ${worst.ratio.toFixed(2)}:1 against ${worst.bgHex} (needs ${required}:1)`,
          score,
          where,
        });
      }
    }

    return findings;
  },
};

/** Split one cell into glyph and background populations and rate them. */
function sample(
  px: { r: number; g: number; b: number }[],
  declared: { r: number; g: number; b: number } | null,
  cell: string,
): Sample | null {
  if (declared) {
    const glyph = px.filter((p) => colorDistance(p, declared) < INK_TOLERANCE);
    const bg = px.filter((p) => colorDistance(p, declared) > INK_TOLERANCE + 50);
    // Enough of both populations to trust the split.
    if (glyph.length >= px.length * 0.02 && bg.length >= px.length * 0.1) {
      const bgHex = toHex(meanColor(bg));
      const textHex = toHex(declared);
      return { textHex, bgHex, ratio: contrastRatio(textHex, bgHex), basis: 'declared', cell };
    }
  }

  const lumas = px.map((p) => luma(p.r, p.g, p.b) | 0);
  const split = otsu(lumas);
  if (split.lowCount < 4 || split.highCount < 4) return null;

  // Without a declared colour we cannot tell "low-contrast type" from "no type
  // in this cell": a smooth plate splits down the middle too, and reporting its
  // ~1:1 ratio would fail perfectly good renders for text that is not there.
  // So an unmeasurable cell is skipped, and legibilityGate — which measures the
  // same Otsu separation and fails below 42 levels — is the backstop that
  // catches genuinely vanished type.
  if (split.highMean - split.lowMean < 12) return null;

  // The minority population is the type: glyphs cover less of a line box than
  // the background they sit on.
  const glyphIsHigh = split.highCount < split.lowCount;
  const glyph: { r: number; g: number; b: number }[] = [];
  const bg: { r: number; g: number; b: number }[] = [];
  for (let i = 0; i < px.length; i++) {
    const isHigh = lumas[i]! > split.threshold;
    (isHigh === glyphIsHigh ? glyph : bg).push(px[i]!);
  }
  const textHex = toHex(meanColor(glyph));
  const bgHex = toHex(meanColor(bg));
  return { textHex, bgHex, ratio: contrastRatio(textHex, bgHex), basis: 'estimated', cell };
}
