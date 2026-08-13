/**
 * Clutter gate — is there a focal point, or just a lot of stuff?
 *
 * A thumbnail is looked at for a fraction of a second in peripheral vision. It
 * needs one thing that wins and somewhere for the eye to rest. Uniform busyness
 * is the failure mode of every "add more energy" note: sparks, shards, speed
 * lines, glows and a screaming headline all at maximum, and the result reads as
 * texture rather than as a picture.
 *
 * Measured on a ~384px-wide downscale on purpose: that is close to the size
 * YouTube actually renders, so grain and micro-detail that vanish in the feed
 * do not get counted as clutter.
 */

import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, ramp } from '../geom.js';
import { EDGE_THRESHOLD, connectedRegions, edgeDensity, loadGray, saliencyGrid, sobel } from '../image.js';

const ANALYSIS_WIDTH = 384;
/** Overall edge density above which the frame is "uniformly busy". */
const BUSY_DENSITY = 0.34;
/** Fraction of the canvas that should be quiet enough to rest the eye on. */
const MIN_QUIET_SHARE = 0.12;
/** More distinct busy blobs than this and the hierarchy is gone. */
const MAX_SALIENT_REGIONS = 6;

export function analysisGrid(width: number, height: number): { cols: number; rows: number } {
  return width >= height
    ? { cols: 16, rows: Math.max(4, Math.round((16 * height) / width)) }
    : { cols: Math.max(4, Math.round((16 * width) / height)), rows: 16 };
}

export const clutterGate: Gate = {
  id: 'clutter',
  weight: 0.9,
  description: 'The frame has a focal hierarchy and somewhere quiet to rest, rather than being busy edge to edge',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const w = Math.min(ANALYSIS_WIDTH, ctx.width);
    const h = Math.max(2, Math.round((w * ctx.height) / ctx.width));
    const gray = await loadGray(ctx.image, { width: w, height: h, background: ctx.plan.canvas.background });
    const mag = sobel(gray);
    const density = edgeDensity(mag, w, h, undefined, EDGE_THRESHOLD);

    const { cols, rows } = analysisGrid(w, h);
    const grid = saliencyGrid(gray, cols, rows, mag);
    const total = cols * rows;

    const busyThreshold = Math.max(0.12, grid.mean * 1.5);
    const salient = connectedRegions(grid, busyThreshold, 'above').filter((r) => r.size >= 2);
    const quietThreshold = Math.max(0.05, grid.mean * 0.5);
    const quiet = connectedRegions(grid, quietThreshold, 'below');
    const quietShare = (quiet[0]?.size ?? 0) / total;

    const findings: QaFinding[] = [];

    if (density > BUSY_DENSITY) {
      findings.push({
        gate: 'clutter',
        severity: 'warn',
        message: `The whole frame is busy: ${(density * 100).toFixed(0)}% of pixels carry an edge at feed size (over ${(BUSY_DENSITY * 100).toFixed(0)}%), so nothing stands out from anything else`,
        score: clamp01(1 - ramp(density, BUSY_DENSITY, 0.7)),
        suggestion: 'Cut one effect layer entirely — particles or speed lines, not both — and blur the background plate. Contrast between busy and calm is what makes the subject read.',
      });
    }

    if (quietShare < MIN_QUIET_SHARE) {
      const biggest = quiet[0];
      findings.push({
        gate: 'clutter',
        severity: 'warn',
        message: `No resting area: the largest quiet region is ${(quietShare * 100).toFixed(0)}% of the canvas (want ≥${(MIN_QUIET_SHARE * 100).toFixed(0)}%)${biggest ? ` and sits around (${biggest.center.x.toFixed(2)}, ${biggest.center.y.toFixed(2)})` : ''}`,
        score: clamp01(ramp(quietShare, 0, MIN_QUIET_SHARE)),
        suggestion: 'Open up a calm zone — darken and blur one corner of the plate. It also gives the headline somewhere safe to live.',
      });
    }

    if (salient.length > MAX_SALIENT_REGIONS) {
      findings.push({
        gate: 'clutter',
        severity: 'warn',
        message: `${salient.length} competing points of interest — the eye has no obvious first stop`,
        score: clamp01(1 - ramp(salient.length, MAX_SALIENT_REGIONS, MAX_SALIENT_REGIONS + 8)),
        suggestion: 'Pick the hero (usually one face) and suppress the rest: darken, desaturate or blur secondary energy so one region wins by a clear margin.',
      });
    }

    if (findings.length === 0) {
      const dominant = salient[0];
      findings.push({
        gate: 'clutter',
        severity: 'pass',
        message: `Focal hierarchy holds: ${(density * 100).toFixed(0)}% edge density, ${salient.length} salient region${salient.length === 1 ? '' : 's'}${dominant ? ` (dominant one around ${dominant.center.x.toFixed(2)}, ${dominant.center.y.toFixed(2)})` : ''}, ${(quietShare * 100).toFixed(0)}% quiet area`,
        score: clamp01(0.6 + 0.4 * ramp(quietShare, MIN_QUIET_SHARE, 0.35)),
      });
    }

    return findings;
  },
};
