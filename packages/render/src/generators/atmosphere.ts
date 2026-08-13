/**
 * Atmosphere and integration generators.
 *
 * These three exist to solve the problem that makes composites look pasted-on:
 * a cut-out subject shares no air, no ground and no light with the plate behind
 * it. `haze` puts air between them, `contact-shadow` puts them on the same
 * floor, and `light-wrap` lets the background's light spill onto the subject's
 * edge. Skipping them is the single most common reason a technically-correct
 * composite still reads as fake.
 */

import sharp from 'sharp';
import { clamp, createRng, parseColor } from '@hexa/core';
import type { Generator } from '../types.js';

function num(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(p: Record<string, unknown>, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

async function fromRaw(data: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();
}

/**
 * Fill an RGBA buffer with one colour, so the per-pixel loop only writes alpha.
 *
 * `Buffer.fill` with a 4-byte pattern is a memset in C++; the equivalent three
 * JS stores per pixel are three bounds-checked writes. At 3.7 megapixels that
 * is the difference between ~9 ms and ~1 ms of pure overhead.
 */
function fillRgb(data: Buffer, r: number, g: number, b: number): void {
  data.fill(Buffer.from([r, g, b, 0]));
}

/**
 * `t ** exponent` for t in 0–1, as a lookup table.
 *
 * Every atmospheric field here shapes a 0–1 ramp with a fractional exponent,
 * which is a real `pow` — ~40 ns each, so ~150 ms per megapixel, which is more
 * than the rest of the generator put together. The ramp is smooth and lands in
 * an 8-bit alpha channel: with 4096 steps the worst-case error is under 0.05 of
 * one alpha level, i.e. below what the channel can represent.
 */
const RAMP_STEPS = 4096;

function rampTable(exponent: number): Float32Array {
  const table = new Float32Array(RAMP_STEPS + 1);
  for (let i = 0; i <= RAMP_STEPS; i++) table[i] = (i / RAMP_STEPS) ** exponent;
  return table;
}

/**
 * Volumetric haze — a soft luminance wedge that thickens with depth.
 *
 * Rendered as a directional gradient rather than noise: real atmospheric
 * scattering is smooth, and noisy haze reads as dirt on the lens. The subtle
 * vertical lift keeps the bottom of frame denser, which is how stage haze
 * actually settles.
 */
export const haze: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const { r, g, b } = parseColor(str(params, 'color', '#9FB4CC'));
  const density = clamp(num(params, 'density', 0.35), 0, 1);
  const angle = num(params, 'angle', 90);
  const falloff = num(params, 'falloff', 1.35);
  const floorBias = clamp(num(params, 'floorBias', 0.35), 0, 1);

  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);
  const rng = createRng(seed);
  // A touch of dither prevents the smooth ramp from banding in 8-bit output.
  const dither = Array.from({ length: 64 }, () => rng.float(-0.6, 0.6));

  // The projection is affine in x and in y, so it splits into two 1-D terms and
  // the shaping exponent becomes a table lookup. What is left in the inner loop
  // is an add, a clamp and one store.
  const data = Buffer.allocUnsafe(w * h * 4);
  fillRgb(data, r, g, b);
  const ramp = rampTable(falloff);
  const projX = new Float64Array(w);
  for (let x = 0; x < w; x++) projX[x] = (x / Math.max(1, w - 1) - 0.5) * dx + 0.5;

  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1);
    const projY = (v - 0.5) * dy;
    const ground = floorBias * v * v;
    let p = y * w * 4 + 3;
    for (let x = 0; x < w; x++, p += 4) {
      const proj = clamp(projX[x]! + projY, 0, 1);
      const a = clamp((ramp[(proj * RAMP_STEPS) | 0]! + ground) * density, 0, 1);
      data[p] = Math.round(clamp(a * 255 + dither[(x + y) & 63]!, 0, 255));
    }
  }
  return fromRaw(data, w, h);
};

/**
 * Contact shadow — the soft elliptical pool that anchors a subject to a floor.
 *
 * Two overlaid falloffs: a tight, dark core where the subject meets the ground
 * and a wide, faint ambient occlusion pool. One radius alone looks like a
 * drop shadow; two look like contact.
 */
export const contactShadow: Generator = async (params, size, _seed) => {
  const { width: w, height: h } = size;
  const { r, g, b } = parseColor(str(params, 'color', '#000000'));
  const strength = clamp(num(params, 'strength', 0.7), 0, 1);
  const cx = clamp(num(params, 'cx', 0.5), -1, 2);
  const cy = clamp(num(params, 'cy', 0.86), -1, 2);
  const spread = Math.max(0.02, num(params, 'spread', 0.42));
  const squash = Math.max(0.02, num(params, 'squash', 0.16));

  // Both falloffs are gaussians of d² = nx² + ny², and a gaussian of a sum is
  // the product of the gaussians: exp(−k(A+B)) = exp(−kA)·exp(−kB). So the two
  // exponentials per pixel collapse into four 1-D tables and two multiplies —
  // the same field, evaluated the way it factorises.
  const data = Buffer.allocUnsafe(w * h * 4);
  fillRgb(data, r, g, b);
  const coreX = new Float64Array(w);
  const ambX = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const nx = (x / Math.max(1, w - 1) - cx) / spread;
    coreX[x] = Math.exp(-(nx * nx) * 3.2);
    ambX[x] = Math.exp(-(nx * nx) * 0.65);
  }

  for (let y = 0; y < h; y++) {
    const ny = (y / Math.max(1, h - 1) - cy) / squash;
    const coreY = Math.exp(-(ny * ny) * 3.2);
    const ambY = Math.exp(-(ny * ny) * 0.65) * 0.45;
    let p = y * w * 4 + 3;
    for (let x = 0; x < w; x++, p += 4) {
      const a = clamp((coreX[x]! * coreY + ambX[x]! * ambY) * strength, 0, 1);
      data[p] = Math.round(a * 255);
    }
  }
  return fromRaw(data, w, h);
};

/**
 * Light wrap fill — a directional glow the compositor masks to the band just
 * inside a subject's alpha edge.
 *
 * This generator only supplies the *colour field*; the masking to the subject
 * edge happens in the compositor, which is the only place that knows the
 * subject's alpha. Emitted as a soft directional gradient so the wrap is
 * strongest on the lit side and absent on the shadow side.
 */
export const lightWrap: Generator = async (params, size, _seed) => {
  const { width: w, height: h } = size;
  const { r, g, b } = parseColor(str(params, 'color', '#FFFFFF'));
  const angle = num(params, 'angle', 0);
  const intensity = clamp(num(params, 'intensity', 0.6), 0, 1);
  const focus = Math.max(0.2, num(params, 'focus', 1.6));

  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);

  // Affine in x and y, shaped by one exponent — the same factorisation as
  // `haze`, see `rampTable`.
  const data = Buffer.allocUnsafe(w * h * 4);
  fillRgb(data, r, g, b);
  const ramp = rampTable(focus);
  const projX = new Float64Array(w);
  for (let x = 0; x < w; x++) projX[x] = (x / Math.max(1, w - 1) - 0.5) * dx + 0.5;

  for (let y = 0; y < h; y++) {
    // Project onto the light direction; only the lit hemisphere contributes.
    const projY = (y / Math.max(1, h - 1) - 0.5) * dy;
    let p = y * w * 4 + 3;
    for (let x = 0; x < w; x++, p += 4) {
      const proj = clamp(projX[x]! + projY, 0, 1);
      data[p] = Math.round(ramp[(proj * RAMP_STEPS) | 0]! * intensity * 255);
    }
  }
  return fromRaw(data, w, h);
};
