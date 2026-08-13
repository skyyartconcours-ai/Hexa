/**
 * Banding gate.
 *
 * Cinematic grading is exactly the recipe for banding: a wide smooth gradient
 * (haze, vignette, backplate falloff), lifted shadows, a LUT, and 8 bits to
 * hold it all. The result is visible stair-steps — concentric arcs in a glow,
 * horizontal bars across a sky — that look like a compression artefact and
 * cheapen an otherwise expensive-looking frame.
 *
 * Detection works on run-lengths at native resolution (resampling destroys the
 * evidence): in a smooth ramp without dither, pixels sit in long runs of one
 * value with neighbouring runs differing by exactly one level. Noise breaks the
 * runs, flat fills produce no ±1 neighbours, so the signature is specific.
 * Scanned along both axes because a vertical ramp bands horizontally.
 */

import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, ramp } from '../geom.js';
import { loadGray } from '../image.js';

/** Shortest plateau that counts as a step rather than as texture. */
const MIN_RUN = 4;
/** Share of scanned pixels sitting in ±1 stair-steps before we complain. */
const WARN_SHARE = 0.1;
const LOUD_SHARE = 0.25;
/** Roughly how many scanlines to sample per axis. */
const SCANLINES = 64;

interface BandScan {
  share: number;
  /** Coarse 4×4 tally of where the banding sits, normalised cell centre. */
  hotspot: { x: number; y: number } | null;
}

function scanAxis(data: Uint8Array, width: number, height: number, axis: 'row' | 'col'): BandScan {
  const lines = axis === 'row' ? height : width;
  const len = axis === 'row' ? width : height;
  const step = Math.max(1, Math.floor(lines / SCANLINES));
  const tally = new Float64Array(16);
  let banded = 0;
  let scanned = 0;

  for (let l = 0; l < lines; l += step) {
    // Run-length encode this scanline.
    const starts: number[] = [];
    const lens: number[] = [];
    const vals: number[] = [];
    let prev = -1;
    for (let i = 0; i < len; i++) {
      const v = axis === 'row' ? data[l * width + i]! : data[i * width + l]!;
      if (v === prev && lens.length) {
        lens[lens.length - 1] = lens[lens.length - 1]! + 1;
      } else {
        starts.push(i); lens.push(1); vals.push(v); prev = v;
      }
    }
    scanned += len;

    const marked = new Set<number>();
    for (let i = 1; i < vals.length; i++) {
      if (Math.abs(vals[i]! - vals[i - 1]!) !== 1) continue;
      if (lens[i]! < MIN_RUN || lens[i - 1]! < MIN_RUN) continue;
      marked.add(i);
      marked.add(i - 1);
    }
    for (const i of marked) {
      banded += lens[i]!;
      const mid = starts[i]! + lens[i]! / 2;
      const cx = axis === 'row' ? mid / width : l / width;
      const cy = axis === 'row' ? l / height : mid / height;
      const cell = Math.min(3, Math.floor(cy * 4)) * 4 + Math.min(3, Math.floor(cx * 4));
      tally[cell] = tally[cell]! + lens[i]!;
    }
  }

  let bestCell = -1;
  let bestVal = 0;
  for (let i = 0; i < 16; i++) if (tally[i]! > bestVal) { bestVal = tally[i]!; bestCell = i; }

  return {
    share: scanned === 0 ? 0 : banded / scanned,
    hotspot: bestCell < 0 ? null : { x: ((bestCell % 4) + 0.5) / 4, y: (Math.floor(bestCell / 4) + 0.5) / 4 },
  };
}

export const bandingGate: Gate = {
  id: 'banding',
  weight: 0.4,
  description: 'Smooth gradients are free of 8-bit stair-stepping (measured from ±1-level run-lengths at native resolution)',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const gray = await loadGray(ctx.image, { background: ctx.plan.canvas.background });
    const rows = scanAxis(gray.data, gray.width, gray.height, 'row');
    const cols = scanAxis(gray.data, gray.width, gray.height, 'col');
    const worst = rows.share >= cols.share ? rows : cols;
    const axis = rows.share >= cols.share ? 'horizontally' : 'vertically';
    const grain = ctx.plan.grade.grain ?? 0;

    if (worst.share < WARN_SHARE) {
      return [{
        gate: 'banding',
        severity: 'pass',
        message: `No significant gradient banding (${(worst.share * 100).toFixed(1)}% of scanned pixels sit in ±1 stair-steps)`,
        score: clamp01(1 - ramp(worst.share, 0, WARN_SHARE) * 0.3),
      }];
    }

    return [{
      gate: 'banding',
      severity: 'warn',
      message: `Gradient banding: ${(worst.share * 100).toFixed(0)}% of scanned pixels sit in ±1-level plateaus running ${axis}${worst.hotspot ? `, worst around (${worst.hotspot.x.toFixed(2)}, ${worst.hotspot.y.toFixed(2)})` : ''}`,
      score: clamp01(1 - ramp(worst.share, WARN_SHARE, LOUD_SHARE)),
      where: worst.hotspot ? { x: Math.max(0, worst.hotspot.x - 0.125), y: Math.max(0, worst.hotspot.y - 0.125), w: 0.25, h: 0.25 } : undefined,
      suggestion: grain < 0.04
        ? `Raise grade.grain to ~0.05 (currently ${grain.toFixed(3)}) — a little noise dithers the steps away — or add a dither pass before the 8-bit write. Rendering the gradient layers at 16-bit and dithering on export also fixes it.`
        : `Grain is already ${grain.toFixed(3)}, so the steps are coming from the grade itself: soften the contrast/LUT strength over the ramp, or render and dither the gradient at 16-bit before export.`,
    }];
  },
};
