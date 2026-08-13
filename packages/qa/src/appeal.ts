/**
 * Appeal scoring — a DESIGN HEURISTIC, not a click-through prediction.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE TRUSTING THE NUMBER.
 *
 * `scoreAppeal` is a weighted sum of seven image measurements chosen because
 * they correspond to things thumbnail designers actually argue about: is the
 * face big enough, does it carry any energy, is there colour, is there tonal
 * range, is there one focal point, is the text balanced, is anything on a
 * third. It has NOT been fitted to click-through data. No CTR was harmed,
 * consulted, or regressed in its construction.
 *
 * What that means in practice:
 *   • It cannot tell you a thumbnail will perform. Performance depends on the
 *     title, the channel, the viewer's history, the topic, the moment, and the
 *     competition in that particular sidebar — none of which are in the image.
 *   • It rewards a specific, conventional, high-energy style (big face, punchy
 *     colour, one hero). Deliberately minimal, editorial or typographic designs
 *     will score lower while being better.
 *   • It is a *relative* tool. Comparing two variants of the same concept is
 *     meaningful; comparing across concepts, or reading 71 as "71% good", is
 *     not.
 *   • The `parts` are returned precisely so a UI can show its working and a
 *     human can disagree with any one of them.
 *
 * Treat it as a sortable opinion, and let the QA gates — which measure defects,
 * not taste — be the ones that actually block a render.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { distanceToNearest, THIRDS } from '@hexa/core';
import type { ThumbnailVariant } from '@hexa/core';
import type { AppealContext } from './types.js';
import { clamp01, ramp, toNormRect } from './geom.js';
import {
  connectedRegions, cropPixels, hsvSaturation, loadRgb, meanEdgeEnergy,
  percentile, rmsContrast, saliencyGrid, sobel, toGray,
} from './image.js';
import { analysisGrid } from './gates/clutter.js';

export interface AppealResult {
  /** 0–100 weighted heuristic. Not a CTR estimate. */
  score: number;
  /** Each component 0–1, so a UI can explain the score. */
  parts: Record<string, number>;
  notes: string[];
}

/** Component weights. They sum to 1; changing them changes the house style. */
export const APPEAL_WEIGHTS: Record<string, number> = {
  faceProminence: 0.22,
  expressiveness: 0.13,
  colorPunch: 0.15,
  contrastRange: 0.15,
  focalClarity: 0.15,
  textBalance: 0.1,
  thirds: 0.1,
};

/** Plateau function: 0 below `lowBad`, 1 between `lowGood` and `highGood`,
 *  tapering to `floor` past `highBad`. Most of these measurements have a "too
 *  much" side as well as a "too little" side. */
function band(v: number, lowBad: number, lowGood: number, highGood: number, highBad: number, floor = 0.35): number {
  if (v <= lowGood) return clamp01(ramp(v, lowBad, lowGood));
  if (v <= highGood) return 1;
  return clamp01(1 - (1 - floor) * ramp(v, highGood, highBad));
}

const ANALYSIS_WIDTH = 384;

export async function scoreAppeal(ctx: AppealContext): Promise<AppealResult> {
  const w = Math.min(ANALYSIS_WIDTH, ctx.width);
  const h = Math.max(2, Math.round((w * ctx.height) / ctx.width));
  const rgb = await loadRgb(ctx.image, { width: w, height: h });
  const gray = toGray(rgb);
  const mag = sobel(gray);

  const notes: string[] = ['scoreAppeal is a design heuristic, not a click-through prediction — see the module docstring.'];
  const faces = (ctx.faceRects ?? []).map((r) => toNormRect(r, ctx.width, ctx.height));
  const texts = (ctx.textRects ?? []).map((t) => toNormRect(t.rect, ctx.width, ctx.height));

  // ── face prominence ───────────────────────────────────────────────────────
  let faceProminence = 0.5;
  const faceArea = faces.reduce((a, f) => a + Math.max(0, f.w) * Math.max(0, f.h), 0);
  if (faces.length === 0) {
    notes.push('No face rects supplied, so face prominence and expressiveness were scored neutrally rather than measured.');
  } else {
    faceProminence = band(faceArea, 0.004, 0.05, 0.28, 0.6);
    notes.push(
      faceArea < 0.02
        ? `Faces occupy ${(faceArea * 100).toFixed(1)}% of the canvas — small; faces are the strongest thing a thumbnail can lead with.`
        : `Faces occupy ${(faceArea * 100).toFixed(1)}% of the canvas.`,
    );
  }

  // ── expressiveness proxy ──────────────────────────────────────────────────
  // Edge energy plus local contrast inside the face: a slack, evenly-lit face
  // has neither. This is a proxy for "is there an expression happening", NOT
  // emotion recognition — it cannot tell delight from a shout from a squint.
  let expressiveness = 0.5;
  if (faces.length > 0) {
    let energy = 0;
    let contrast = 0;
    for (const f of faces) {
      const px = { x: f.x * w, y: f.y * h, w: f.w * w, h: f.h * h };
      energy += meanEdgeEnergy(mag, w, h, px);
      contrast += rmsContrast(gray, px);
    }
    energy /= faces.length;
    contrast /= faces.length;
    expressiveness = clamp01(0.5 * ramp(energy, 0.01, 0.09) + 0.5 * ramp(contrast, 0.04, 0.2));
    if (expressiveness < 0.35) notes.push('Faces read flat — low edge energy and local contrast, which usually means soft light and a neutral expression.');
  }

  // ── colour punch ──────────────────────────────────────────────────────────
  const sats: number[] = [];
  for (let i = 0; i < rgb.data.length; i += 3) {
    sats.push(hsvSaturation(rgb.data[i]!, rgb.data[i + 1]!, rgb.data[i + 2]!));
  }
  const meanSat = sats.reduce((a, b) => a + b, 0) / Math.max(1, sats.length);
  const punchSat = percentile(sats, 0.95);
  const colorPunch = clamp01(0.6 * band(meanSat, 0.05, 0.25, 0.7, 0.95) + 0.4 * ramp(punchSat, 0.3, 0.85));
  if (meanSat < 0.15) notes.push(`Colour is washed out (mean saturation ${(meanSat * 100).toFixed(0)}%) — it will disappear next to saturated neighbours in the feed.`);

  // ── contrast range ────────────────────────────────────────────────────────
  const lumas: number[] = [];
  for (let i = 0; i < gray.data.length; i++) lumas.push(gray.data[i]!);
  const range = (percentile(lumas, 0.95) - percentile(lumas, 0.05)) / 255;
  const contrastRange = clamp01(ramp(range, 0.2, 0.8));
  if (range < 0.4) notes.push(`Tonal range is narrow (${(range * 100).toFixed(0)}% between the 5th and 95th percentile) — the image will look grey at small size.`);

  // ── focal clarity ─────────────────────────────────────────────────────────
  const { cols, rows } = analysisGrid(w, h);
  const grid = saliencyGrid(gray, cols, rows, mag);
  const salient = connectedRegions(grid, Math.max(0.12, grid.mean * 1.5), 'above').filter((r) => r.size >= 2);
  const salientTotal = salient.reduce((a, r) => a + r.size, 0);
  const dominantShare = salientTotal > 0 ? salient[0]!.size / salientTotal : 0;
  const focalClarity = salient.length === 0
    ? 0.3
    : clamp01(0.7 * dominantShare + 0.3 * (1 - ramp(salient.length, 1, 8)));
  if (salient.length === 0) notes.push('No dominant region of interest at all — the frame is uniformly flat.');
  else if (dominantShare < 0.4) notes.push(`The strongest region holds only ${(dominantShare * 100).toFixed(0)}% of the frame's interest — several things compete.`);

  // ── text balance ──────────────────────────────────────────────────────────
  let textBalance = 0.4;
  const textArea = texts.reduce((a, t) => a + Math.max(0, t.w) * Math.max(0, t.h), 0);
  if (texts.length === 0) {
    notes.push('No text rects supplied — text balance scored conservatively.');
  } else {
    textBalance = band(textArea, 0.005, 0.05, 0.22, 0.45);
    if (textArea > 0.3) notes.push(`Text covers ${(textArea * 100).toFixed(0)}% of the canvas — at that point the image is a poster, and the picture stops doing any work.`);
  }

  // ── rule of thirds ────────────────────────────────────────────────────────
  const anchors = faces.length > 0
    ? faces.map((f) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 }))
    : salient.slice(0, 1).map((r) => r.center);
  const thirds = anchors.length === 0
    ? 0.5
    : clamp01(1 - Math.min(...anchors.map((a) => distanceToNearest(a, THIRDS))) / 0.3);

  const parts: Record<string, number> = {
    faceProminence: round3(faceProminence),
    expressiveness: round3(expressiveness),
    colorPunch: round3(colorPunch),
    contrastRange: round3(contrastRange),
    focalClarity: round3(focalClarity),
    textBalance: round3(textBalance),
    thirds: round3(thirds),
  };

  const score = Math.round(
    100 * Object.entries(APPEAL_WEIGHTS).reduce((acc, [k, weight]) => acc + weight * (parts[k] ?? 0), 0),
  );

  return { score, parts, notes };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Sort variants best-first: anything that fails QA sinks below everything that
 * passes, no matter how appealing it is. Within each group the ranking is 60%
 * QA score, 40% appeal — defects outrank taste, deliberately.
 *
 * Returns a new array; the input order is left alone so `pickBest` can still
 * report an index into it.
 */
export function rankVariants(variants: ThumbnailVariant[]): ThumbnailVariant[] {
  return [...variants]
    .map((v, i) => ({ v, i, key: combinedScore(v) }))
    .sort((a, b) => {
      const pa = a.v.qa?.passed === false ? 1 : 0;
      const pb = b.v.qa?.passed === false ? 1 : 0;
      if (pa !== pb) return pa - pb;
      if (b.key !== a.key) return b.key - a.key;
      return a.i - b.i; // stable
    })
    .map((e) => e.v);
}

export function combinedScore(v: ThumbnailVariant): number {
  return 0.6 * (v.qa?.score ?? 0) + 0.4 * (v.appeal ?? 0);
}

/** Index into `variants` of the variant `rankVariants` puts first. -1 when empty. */
export function pickBest(variants: ThumbnailVariant[]): number {
  if (variants.length === 0) return -1;
  const best = rankVariants(variants)[0]!;
  return variants.indexOf(best);
}
