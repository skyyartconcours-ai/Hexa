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
 * Sample a coherent field at the rate the field actually carries information.
 *
 * A value-noise fBm of `scale` cells across the frame, `octaves` deep, has its
 * finest lattice at `scale · 2^(octaves−1)` cells — for the default fog that is
 * 48 cells, which at 2560 px wide means one cell every 53 pixels. Evaluating
 * `fbm()` per pixel therefore computes the *same* smoothly-interpolated cell
 * fifty times over: it is not detail, it is arithmetic. At 150 ns a call that is
 * ~560 ms per megapixel, and it dominates every noise generator.
 *
 * So the field is evaluated on a lattice with `SAMPLES_PER_CELL` samples per
 * finest cell and bilinearly resampled. Value noise is already built by
 * interpolating a lattice with a C² quintic, so resampling it at four points
 * per cell reproduces it to well under one 8-bit level; the difference is not
 * visible and is not structural — the billows land in exactly the same places.
 *
 * Rows are streamed rather than materialised: memory stays O(width), not
 * O(width · height).
 */
const SAMPLES_PER_CELL = 4;

function stepFor(width: number, scale: number, octaves: number): number {
  const finestCells = Math.max(1e-6, Math.abs(scale) * 2 ** Math.max(0, octaves - 1));
  const pxPerCell = width / finestCells;
  return Math.max(1, Math.floor(pxPerCell / SAMPLES_PER_CELL));
}

/**
 * Row-streaming bilinear resampler over a coarsely evaluated field.
 *
 * `fn(x, y)` is called on integer pixel coordinates of the coarse lattice only.
 * `row(y)` returns a reused buffer of `width` values for output row `y`.
 */
function fieldRows(
  width: number,
  height: number,
  step: number,
  fn: (x: number, y: number) => number,
): (y: number) => Float32Array {
  if (step <= 1) {
    const direct = new Float32Array(width);
    return (y: number): Float32Array => {
      for (let x = 0; x < width; x++) direct[x] = fn(x, y);
      return direct;
    };
  }

  const cw = Math.floor((width - 1) / step) + 2; // +1 for the right edge, +1 for the fence post
  const xs = new Int32Array(cw);
  for (let i = 0; i < cw; i++) xs[i] = Math.min(width - 1, i * step);

  const evalRow = (yPix: number, dest: Float32Array): void => {
    for (let i = 0; i < cw; i++) dest[i] = fn(xs[i]!, yPix);
  };

  let topIndex = -1;
  let top = new Float32Array(cw);
  let bottom = new Float32Array(cw);
  const out = new Float32Array(width);

  return (y: number): Float32Array => {
    const j = Math.floor(y / step);
    const y0 = Math.min(height - 1, j * step);
    const y1 = Math.min(height - 1, y0 + step);
    if (j !== topIndex) {
      // Walking down one row band at a time, the previous bottom is the new top.
      if (j === topIndex + 1) {
        const spare = top;
        top = bottom;
        bottom = spare;
        evalRow(y1, bottom);
      } else {
        evalRow(y0, top);
        evalRow(y1, bottom);
      }
      topIndex = j;
    }
    const ty = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
    for (let x = 0; x < width; x++) {
      const i = (x / step) | 0;
      const tx = (x - i * step) / step;
      const a = top[i]!;
      const b = top[i + 1] ?? a;
      const c = bottom[i]!;
      const d = bottom[i + 1] ?? c;
      const hi = a + (b - a) * tx;
      const lo = c + (d - c) * tx;
      out[x] = hi + (lo - hi) * ty;
    }
    return out;
  };
}

/** `t ** exponent` for t in 0–1 as a table — see the note in atmosphere.ts. */
const RAMP_STEPS = 4096;

function rampTable(exponent: number): Float32Array {
  const table = new Float32Array(RAMP_STEPS + 1);
  for (let i = 0; i <= RAMP_STEPS; i++) table[i] = (i / RAMP_STEPS) ** exponent;
  return table;
}

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

  const rows = fieldRows(width, height, stepFor(width, scale, octaves), (x, y) =>
    noise.fbm((x / width) * scale, (y / height) * scale * aspect, octaves),
  );

  for (let y = 0; y < height; y++) {
    const field = rows(y);
    for (let x = 0; x < width; x++) {
      const n = clamp(0.5 + (field[x]! - 0.5) * contrast, 0, 1);
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
  const step = stepFor(w, scale, octaves);
  const densityRows = fieldRows(w, h, step, (x, y) =>
    density.fbm((x / w) * scale + drift, (y / h) * scale * aspect * stretch, octaves),
  );
  // The shading field is a 3-octave fBm at 1.7× the density field's frequency,
  // so it is sampled on its own (finer) lattice rather than the density one.
  const shadeRows = fieldRows(w, h, stepFor(w, scale * 1.7, 3), (x, y) =>
    shading.fbm(((x / w) * scale + drift) * 1.7 + 4.1, (y / h) * scale * aspect * stretch * 1.7 - 2.3, 3),
  );
  const gate = rampTable(1.25);

  for (let y = 0; y < h; y++) {
    const t = y / h;
    const profile = Math.exp(-(((t - center) / band) ** 2));
    const dRow = densityRows(y);
    const sRow = shadeRows(y);
    let p = y * w * 4;
    for (let x = 0; x < w; x++, p += 4) {
      // Soft gate: a little of the field survives everywhere, which is what
      // separates haze from cloud.
      const gated = clamp((dRow[x]! - 0.34) * 1.85, 0, 1);
      const a = gate[(gated * RAMP_STEPS) | 0]! * amount * profile;
      const shadeMul = 0.78 + sRow[x]! * 0.44;
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
  const rows = fieldRows(w, h, stepFor(w, scale, octaves), (x, y) => {
    const t = y / h;
    return field.warped((x / w) * scale + (1 - t) * rise * 0.35, t * scale * aspect, octaves, warp);
  });
  const gate = rampTable(1.15);

  for (let y = 0; y < h; y++) {
    const t = y / h;
    // Denser low, thinning as it rises and spreads.
    const profile = clamp(0.15 + smoothstep(0, 1, 1 - t) * 1.1, 0, 1.25);
    const nRow = rows(y);
    for (let x = 0; x < w; x++) {
      const n = nRow[x]!;
      const a = gate[(clamp((n - 0.4) * 2.6, 0, 1) * RAMP_STEPS) | 0]! * amount * profile;
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
