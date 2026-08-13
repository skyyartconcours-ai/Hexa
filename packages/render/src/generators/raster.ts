/**
 * Raster-authored FX generators — the ones whose content *is* noise.
 *
 * All of them walk pixels directly from a seeded value-noise field, which is
 * both faster than asking librsvg to draw ten thousand blobs and the only way
 * to get genuinely fractal structure.
 */

import { createRng, parseHex, clamp, smoothstep } from '@hexa/core';
import type { Generator } from '../types.js';
import type { RawImage } from '../raw.js';
import { createNoise } from '../noise.js';
import { num, str, bool, toRgbaPng } from './util.js';

/**
 * Grayscale fBm field as an opaque RGBA image — also the engine behind the
 * `{ type: 'noise' }` layer source.
 *
 * `scale` is in lattice cells across the frame width, so scale 4 gives four
 * big billows and scale 40 gives fine detail, independent of resolution.
 */
export function noiseFieldRaw(
  width: number,
  height: number,
  seed: number,
  scale: number,
  octaves: number,
  opts: { contrast?: number; color?: string; asAlpha?: boolean } = {},
): RawImage {
  const noise = createNoise(seed, 128);
  const contrast = opts.contrast ?? 1;
  const tint = opts.color ? parseHex(opts.color) : { r: 255, g: 255, b: 255, a: 1 };
  const aspect = height / Math.max(1, width);
  const data = Buffer.allocUnsafe(width * height * 4);

  for (let y = 0; y < height; y++) {
    const ny = (y / height) * scale * aspect;
    for (let x = 0; x < width; x++) {
      const nx = (x / width) * scale;
      const n = clamp(0.5 + (noise.fbm(nx, ny, octaves) - 0.5) * contrast, 0, 1);
      const p = (y * width + x) * 4;
      const v = Math.round(n * 255);
      if (opts.asAlpha) {
        data[p] = tint.r;
        data[p + 1] = tint.g;
        data[p + 2] = tint.b;
        data[p + 3] = v;
      } else {
        data[p] = Math.round((v * tint.r) / 255);
        data[p + 1] = Math.round((v * tint.g) / 255);
        data[p + 2] = Math.round((v * tint.b) / 255);
        data[p + 3] = 255;
      }
    }
  }
  return { data, width, height, channels: 4 };
}

/** noise — raw fBm, opaque by default or as an alpha stencil. */
export const noise: Generator = async (params, size, seed) =>
  toRgbaPng(
    noiseFieldRaw(size.width, size.height, seed, num(params, 'scale', 6), Math.round(num(params, 'octaves', 5)), {
      contrast: num(params, 'contrast', 1),
      color: str(params, 'color', '#FFFFFF'),
      asAlpha: bool(params, 'asAlpha', false),
    }),
  );

/**
 * fog — layered atmospheric haze.
 *
 * Two independent fBm fields: one drives density, the other modulates
 * brightness so the bank is not a flat wash of one colour. The field is
 * horizontally stretched (fog spreads sideways, not vertically) and gated by a
 * gaussian band so it pools at a chosen height instead of filling the frame.
 *
 * Low contrast on purpose: haze that reads as "smoke machine" rather than
 * "cotton wool" spends most of its alpha between 0.05 and 0.4.
 */
export const fog: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const density = createNoise(seed, 128);
  const shading = createNoise(seed ^ 0x9e37, 96);
  const { r, g, b } = parseHex(str(params, 'color', '#AFC2D6'));
  const amount = num(params, 'density', 0.6);
  const scale = num(params, 'scale', 3.0);
  const octaves = Math.round(num(params, 'octaves', 5));
  const stretch = num(params, 'stretch', 2.6);
  const center = num(params, 'center', 0.68);
  const band = num(params, 'band', 0.45);
  const drift = num(params, 'drift', 0);

  const data = Buffer.allocUnsafe(w * h * 4);
  const aspect = h / Math.max(1, w);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const profile = Math.exp(-(((t - center) / band) ** 2));
    const ny = t * scale * aspect * stretch;
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale + drift;
      const n = density.fbm(nx, ny, octaves);
      const s = shading.fbm(nx * 1.7 + 4.1, ny * 1.7 - 2.3, 3);
      // Soft gate: a little of the field survives everywhere, which is what
      // separates haze from cloud.
      const a = clamp((n - 0.34) * 1.85, 0, 1) ** 1.25 * amount * profile;
      const shadeMul = 0.78 + s * 0.44;
      const p = (y * w + x) * 4;
      data[p] = Math.round(clamp(r * shadeMul, 0, 255));
      data[p + 1] = Math.round(clamp(g * shadeMul, 0, 255));
      data[p + 2] = Math.round(clamp(b * shadeMul, 0, 255));
      data[p + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  return toRgbaPng({ data, width: w, height: h, channels: 4 });
};

/**
 * smoke — fog's angrier sibling.
 *
 * Uses domain-warped fBm (`warped()`), so the isolines curl instead of
 * billowing symmetrically, plus a height-dependent horizontal shear that makes
 * columns lean as they rise. Higher contrast and a rising density profile.
 */
export const smoke: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const field = createNoise(seed, 160);
  const { r, g, b } = parseHex(str(params, 'color', '#C8CDD6'));
  const amount = num(params, 'density', 0.75);
  const scale = num(params, 'scale', 2.6);
  const octaves = Math.round(num(params, 'octaves', 5));
  const rise = num(params, 'rise', 0.9);
  const warp = num(params, 'warp', 1.9);

  const data = Buffer.allocUnsafe(w * h * 4);
  const aspect = h / Math.max(1, w);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    // Denser low, thinning as it rises and spreads.
    const profile = clamp(0.15 + smoothstep(0, 1, 1 - t) * 1.1, 0, 1.25);
    const shear = (1 - t) * rise;
    const ny = t * scale * aspect;
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * scale + shear * 0.35;
      const n = field.warped(nx, ny, octaves, warp);
      const a = clamp((n - 0.4) * 2.6, 0, 1) ** 1.15 * amount * profile;
      const shadeMul = 0.7 + n * 0.6;
      const p = (y * w + x) * 4;
      data[p] = Math.round(clamp(r * shadeMul, 0, 255));
      data[p + 1] = Math.round(clamp(g * shadeMul, 0, 255));
      data[p + 2] = Math.round(clamp(b * shadeMul, 0, 255));
      data[p + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  return toRgbaPng({ data, width: w, height: h, channels: 4 });
};

/**
 * scanlines — CRT/broadcast texture.
 *
 * Dark lines every `spacing` px with a soft profile (a hard 1-px line aliases
 * horribly once the frame is downsampled), per-line brightness jitter from the
 * seeded RNG, and an optional chroma offset that mimics a mistimed shadow mask.
 */
export const scanlines: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(97);
  const spacing = Math.max(2, num(params, 'spacing', 4));
  const opacity = num(params, 'opacity', 0.35);
  const chroma = num(params, 'chroma', 0.35);
  const { r, g, b } = parseHex(str(params, 'color', '#000000'));

  const rowAlpha = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const phase = (y % spacing) / spacing;
    // Cosine profile ⇒ band-limited, so it survives the Lanczos downsample.
    const line = (1 - Math.cos(phase * Math.PI * 2)) * 0.5;
    rowAlpha[y] = clamp(line * opacity * (0.75 + rng.next() * 0.5), 0, 1);
  }

  const data = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    const a = rowAlpha[y]!;
    const shift = Math.sin(y * 0.7) * chroma;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = Math.round(clamp(r + shift * 40, 0, 255));
      data[p + 1] = Math.round(g);
      data[p + 2] = Math.round(clamp(b - shift * 40, 0, 255));
      data[p + 3] = Math.round(a * 255);
    }
  }
  return toRgbaPng({ data, width: w, height: h, channels: 4 });
};
