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
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
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

  const data = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / Math.max(1, w - 1);
      const proj = clamp((u - 0.5) * dx + (v - 0.5) * dy + 0.5, 0, 1);
      const ground = floorBias * v * v;
      const a = clamp((proj ** falloff + ground) * density, 0, 1);
      const p = (y * w + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = Math.round(clamp(a * 255 + dither[(x + y) & 63]!, 0, 255));
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

  const data = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / Math.max(1, w - 1);
      const nx = (u - cx) / spread;
      const ny = (v - cy) / squash;
      const d = Math.hypot(nx, ny);
      // Core: steep falloff, small. Ambient: gentle, twice as wide.
      const core = Math.exp(-(d ** 2) * 3.2);
      const ambient = Math.exp(-(d ** 2) * 0.65) * 0.45;
      const a = clamp((core + ambient) * strength, 0, 1);
      const p = (y * w + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = Math.round(a * 255);
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

  const data = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / Math.max(1, w - 1);
      // Project onto the light direction; only the lit hemisphere contributes.
      const proj = (u - 0.5) * dx + (v - 0.5) * dy + 0.5;
      const a = clamp(proj, 0, 1) ** focus * intensity;
      const p = (y * w + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = Math.round(a * 255);
    }
  }
  return fromRaw(data, w, h);
};
