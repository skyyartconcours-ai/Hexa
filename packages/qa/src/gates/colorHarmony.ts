/**
 * Colour-harmony gate.
 *
 * Two teams, two brand palettes, a grade, a backplate and a set of glows all
 * fight for the same frame. The classic outcomes are mud (everything blended
 * until nothing has chroma) and confetti (five saturated hues, no hierarchy).
 * Both are measured here from a quantised palette of the finished pixels:
 *
 *   • palette extraction — k-means in RGB on a small downscale, seeded from the
 *     plan so a given render always reports the same palette;
 *   • mud — weighted mean OKLab chroma across that palette;
 *   • side separation — the two subject accents must be tellable apart, using
 *     the same distance metric `ensureDistinct` uses when it picks them;
 *   • competing hues — hue bins with real chroma and real area.
 */

import { createRng, hexToOklab, toHex } from '@hexa/core';
import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, ramp, toPixelRect } from '../geom.js';
import { cropPixels, loadRgb, meanColor } from '../image.js';
import { resolvePalette } from '../plan.js';

/** Weighted mean OKLab chroma below which the frame reads as mud. */
const MUDDY_CHROMA = 0.045;
/**
 * Lightness below which a cluster is shadow, not colour.
 *
 * OKLab chroma scales with lightness, so near-black pixels are near-zero chroma
 * *however saturated the grade is*. Averaging them in means any low-key picture
 * reads as mud: `versus-minimal` — a deliberately dark, cold, low-saturation
 * grade with a clean accent — measured 0.017 against a 0.045 floor, purely
 * because 60% of its palette is backdrop. Mud is a property of the *lit* part of
 * a frame, so that is what gets measured, with the dark share reported instead
 * of silently averaged in.
 */
const SHADOW_L = 0.28;
/** A single strong accent is enough to prove the frame is not mud. */
const ACCENT_CHROMA = 0.09;
const ACCENT_SHARE = 0.04;
/** Chroma a cluster needs before it counts as a "colour" rather than a neutral. */
const COLOUR_CHROMA = 0.06;
/** Area share a cluster needs before it counts as competing. */
const COMPETING_SHARE = 0.06;
const MAX_HUES = 4;
/** OKLab distance below which two accents are not tellable apart. */
const MIN_ACCENT_DISTANCE = 0.12;

export interface PaletteEntry {
  hex: string;
  share: number;
  chroma: number;
  hue: number;
  /** OKLab lightness, 0–1. Used to keep shadows out of the mud measurement. */
  lightness: number;
}

/** k-means (k-means++ init, deterministic from `seed`) over RGB pixels. */
export function quantise(pixels: { r: number; g: number; b: number }[], k: number, seed: number): PaletteEntry[] {
  if (pixels.length === 0) return [];
  const rng = createRng(seed >>> 0);
  const centroids: { r: number; g: number; b: number }[] = [pixels[rng.int(0, pixels.length - 1)]!];
  const dist2 = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;

  while (centroids.length < k) {
    const d = pixels.map((p) => Math.min(...centroids.map((c) => dist2(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let target = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < d.length; i++) {
      target -= d[i]!;
      if (target <= 0) { idx = i; break; }
    }
    centroids.push(pixels[idx]!);
  }

  const assign = new Int32Array(pixels.length);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < pixels.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dd = dist2(pixels[i]!, centroids[c]!);
        if (dd < bestD) { bestD = dd; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (let i = 0; i < pixels.length; i++) {
      const s = sums[assign[i]!]!;
      s.r += pixels[i]!.r; s.g += pixels[i]!.g; s.b += pixels[i]!.b; s.n++;
    }
    for (let c = 0; c < centroids.length; c++) {
      const s = sums[c]!;
      if (s.n > 0) centroids[c] = { r: s.r / s.n, g: s.g / s.n, b: s.b / s.n };
    }
    if (!moved && iter > 0) break;
  }

  const counts = new Array<number>(centroids.length).fill(0);
  for (let i = 0; i < pixels.length; i++) counts[assign[i]!]! += 1;

  return centroids
    .map((c, i) => {
      const hex = toHex(c);
      const lab = hexToOklab(hex);
      return {
        hex,
        share: counts[i]! / pixels.length,
        chroma: Math.hypot(lab.a, lab.b),
        hue: (Math.atan2(lab.b, lab.a) * 180) / Math.PI,
        lightness: lab.L,
      };
    })
    .filter((e) => e.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** The metric `ensureDistinct` uses: chroma-plane distance plus half the
 *  lightness difference. */
export function accentDistance(a: string, b: string): number {
  const A = hexToOklab(a);
  const B = hexToOklab(b);
  return Math.hypot(A.a - B.a, A.b - B.b) + Math.abs(A.L - B.L) * 0.5;
}

export const colorHarmonyGate: Gate = {
  id: 'color-harmony',
  weight: 0.6,
  description: 'Palette has chroma (not mud), the two sides are tellable apart, and no more than ~4 hues compete',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const w = Math.min(96, ctx.width);
    const h = Math.max(2, Math.round((w * ctx.height) / ctx.width));
    const img = await loadRgb(ctx.image, { width: w, height: h, background: ctx.plan.canvas.background });
    const pixels = cropPixels(img, { x: 0, y: 0, w, h });
    const palette = quantise(pixels, 5, ctx.plan.seed || 1);
    const findings: QaFinding[] = [];

    // Mud is measured on the lit part of the palette. A dark grade is not mud;
    // a *flat* one is. See the note on SHADOW_L.
    const lit = palette.filter((e) => e.lightness >= SHADOW_L);
    const litWeight = lit.reduce((a, e) => a + e.share, 0);
    const meanChroma = litWeight > 0
      ? lit.reduce((a, e) => a + e.chroma * e.share, 0) / litWeight
      : palette.reduce((a, e) => a + e.chroma * e.share, 0);
    const accent = palette.find((e) => e.chroma >= ACCENT_CHROMA && e.share >= ACCENT_SHARE);
    const shadowShare = 1 - litWeight;

    if (meanChroma < MUDDY_CHROMA && !accent) {
      findings.push({
        gate: 'color-harmony',
        severity: 'warn',
        message: litWeight > 0
          ? `Palette is muddy: mean OKLab chroma ${meanChroma.toFixed(3)} across the lit ${(litWeight * 100).toFixed(0)}% of the frame (want ≥${MUDDY_CHROMA}); ${lit.map((p) => p.hex).join(', ')}${shadowShare > 0.2 ? ` — the other ${(shadowShare * 100).toFixed(0)}% is shadow and was left out of the average, so this is not simply a dark grade` : ''}`
          : `Palette is entirely in shadow: every cluster sits below OKLab L ${SHADOW_L} (${palette.map((p) => p.hex).join(', ')}), so nothing in the frame carries colour`,
        score: clamp01(ramp(meanChroma, 0, MUDDY_CHROMA)),
        suggestion: 'Something is blending the brand colours through grey — usually an overlay/soft-light layer at high opacity or a desaturating grade. Push saturation, or separate the two team colours onto opposite sides instead of mixing them.',
      });
    }

    const competing = palette.filter((e) => e.chroma >= COLOUR_CHROMA && e.share >= COMPETING_SHARE);
    const hueBins = new Set(competing.map((e) => Math.round(((e.hue + 360) % 360) / 30)));
    if (hueBins.size > MAX_HUES) {
      findings.push({
        gate: 'color-harmony',
        severity: 'warn',
        message: `${hueBins.size} distinct hues compete for the frame (${competing.map((c) => `${c.hex} ${(c.share * 100).toFixed(0)}%`).join(', ')}) — more than the ~${MAX_HUES} a thumbnail can hold`,
        score: clamp01(1 - ramp(hueBins.size, MAX_HUES, MAX_HUES + 4)),
        suggestion: 'Reduce to the two team colours plus one accent. Anything else should be pushed to a neutral or tinted toward one of the three.',
      });
    }

    // Side separation: prefer what the plan says the accents are; otherwise
    // sample the rim/halo band around each subject's face.
    const planPalette = resolvePalette(ctx.plan);
    let left = planPalette.left;
    let right = planPalette.right;
    let basis: 'plan' | 'sampled' = 'plan';

    if ((!left || !right) && ctx.subjects.filter((s) => s.faceRect).length >= 2) {
      const sampled = ctx.subjects
        .filter((s) => s.faceRect)
        .slice(0, 2)
        .map((s) => sampleAccent(img, s.faceRect!, ctx.width, ctx.height, w, h));
      left = sampled[0];
      right = sampled[1];
      basis = 'sampled';
    }

    if (left && right) {
      let d: number | null = null;
      try {
        d = accentDistance(left, right);
      } catch {
        findings.push({
          gate: 'color-harmony',
          severity: 'warn',
          message: `plan.meta.palette holds a colour that is not parseable hex (left "${left}", right "${right}"), so the two sides could not be compared`,
          score: 0.7,
          suggestion: 'Write palette entries as #RRGGBB — they are also what the studio UI reads to label the sides.',
        });
      }
      if (d !== null && d < MIN_ACCENT_DISTANCE) {
        findings.push({
          gate: 'color-harmony',
          severity: 'warn',
          message: `The two subject accents are hard to tell apart: ${left} vs ${right}, OKLab distance ${d.toFixed(3)} (want ≥${MIN_ACCENT_DISTANCE})${basis === 'sampled' ? ' — sampled from the render, the plan declared no palette' : ''}`,
          score: clamp01(ramp(d, 0, MIN_ACCENT_DISTANCE)),
          suggestion: 'Run the two team colours through ensureDistinct() before building the plan, or push one side toward its secondary colour. Two teams that both brand in red need help from the layout.',
        });
      }
    }

    if (findings.length === 0) {
      findings.push({
        gate: 'color-harmony',
        severity: 'pass',
        message: `Palette reads: ${palette.slice(0, 3).map((p) => `${p.hex} ${(p.share * 100).toFixed(0)}%`).join(', ')}; mean chroma ${meanChroma.toFixed(3)} over the lit ${(litWeight * 100).toFixed(0)}% of the frame${accent ? `, accent ${accent.hex} holding ${(accent.share * 100).toFixed(0)}%` : ''}, ${hueBins.size} competing hue${hueBins.size === 1 ? '' : 's'}`,
        score: clamp01(0.6 + 0.4 * ramp(meanChroma, MUDDY_CHROMA, 0.12)),
      });
    }

    return findings;
  },
};

/** Dominant colour in the band just outside a face — where rim light and brand
 *  glow live. */
function sampleAccent(
  img: { data: Uint8Array; width: number; height: number; channels: 3 },
  faceRect: { x: number; y: number; w: number; h: number },
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): string {
  const px = toPixelRect(faceRect, srcW, srcH);
  const band = {
    x: (px.x / srcW) * dstW - 4,
    y: (px.y / srcH) * dstH - 4,
    w: (px.w / srcW) * dstW + 8,
    h: (px.h / srcH) * dstH + 8,
  };
  const outer = cropPixels(img, band);
  const inner = cropPixels(img, { x: (px.x / srcW) * dstW, y: (px.y / srcH) * dstH, w: (px.w / srcW) * dstW, h: (px.h / srcH) * dstH });
  // Whatever surrounds the face, minus the face itself: take the most saturated
  // quartile of the surrounding band.
  const innerSet = new Set(inner.map((p) => `${p.r},${p.g},${p.b}`));
  const ring = outer.filter((p) => !innerSet.has(`${p.r},${p.g},${p.b}`));
  const pool = ring.length > 8 ? ring : outer;
  const sorted = [...pool].sort((a, b) => chromaOf(b) - chromaOf(a)).slice(0, Math.max(1, Math.floor(pool.length / 4)));
  return toHex(meanColor(sorted));
}

function chromaOf(p: { r: number; g: number; b: number }): number {
  const max = Math.max(p.r, p.g, p.b);
  const min = Math.min(p.r, p.g, p.b);
  return max === 0 ? 0 : (max - min) / max;
}
