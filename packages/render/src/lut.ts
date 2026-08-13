/**
 * 3D LUTs — the industry-standard way to move a look between tools.
 *
 * A `Lut3D` is a `size³` RGB grid stored in .cube order (red varies fastest),
 * as floats in 0–1. Sampling is trilinear, which is what Resolve/Premiere do
 * and is smooth enough that a 33³ grid is visually indistinguishable from a
 * per-pixel evaluation of the underlying transform.
 *
 * The six built-in looks are *generated*, not shipped as binary assets: each is
 * a documented mathematical transform evaluated on the grid at import time.
 * That keeps the repo free of opaque blobs, makes every look reviewable in a
 * diff, and means a look can be re-derived at any grid resolution.
 */

import { clamp, smoothstep } from '@hexa/core';
import { type RawImage, toRaw, encodePng, LUMA_R, LUMA_G, LUMA_B } from './raw.js';

export interface Lut3D {
  size: number;
  /** `size³ × 3` floats, index = ((b·size + g)·size + r)·3. */
  data: Float32Array;
  title?: string;
}

type Rgb = [number, number, number];

/** Evaluate `fn` over a `size³` lattice to build a LUT. */
export function buildLut(size: number, title: string, fn: (r: number, g: number, b: number) => Rgb): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  const d = size - 1;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const out = fn(ri / d, gi / d, bi / d);
        const i = ((bi * size + gi) * size + ri) * 3;
        data[i] = clamp(out[0], 0, 1);
        data[i + 1] = clamp(out[1], 0, 1);
        data[i + 2] = clamp(out[2], 0, 1);
      }
    }
  }
  return { size, data, title };
}

/** Trilinear fetch. `r/g/b` are 0–1; the result is 0–1. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number): Rgb {
  const { size, data } = lut;
  const d = size - 1;
  const fr = clamp(r, 0, 1) * d;
  const fg = clamp(g, 0, 1) * d;
  const fb = clamp(b, 0, 1) * d;
  const r0 = Math.floor(fr);
  const g0 = Math.floor(fg);
  const b0 = Math.floor(fb);
  const r1 = Math.min(d, r0 + 1);
  const g1 = Math.min(d, g0 + 1);
  const b1 = Math.min(d, b0 + 1);
  const tr = fr - r0;
  const tg = fg - g0;
  const tb = fb - b0;

  const at = (ri: number, gi: number, bi: number, c: number): number =>
    data[((bi * size + gi) * size + ri) * 3 + c]!;

  const out: Rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c000 = at(r0, g0, b0, c);
    const c100 = at(r1, g0, b0, c);
    const c010 = at(r0, g1, b0, c);
    const c110 = at(r1, g1, b0, c);
    const c001 = at(r0, g0, b1, c);
    const c101 = at(r1, g0, b1, c);
    const c011 = at(r0, g1, b1, c);
    const c111 = at(r1, g1, b1, c);
    const c00 = c000 + (c100 - c000) * tr;
    const c10 = c010 + (c110 - c010) * tr;
    const c01 = c001 + (c101 - c001) * tr;
    const c11 = c011 + (c111 - c011) * tr;
    const c0 = c00 + (c10 - c00) * tg;
    const c1 = c01 + (c11 - c01) * tg;
    out[c] = c0 + (c1 - c0) * tb;
  }
  return out;
}

/**
 * Apply a LUT to an RGBA image, mixed back by `strength` (0 = untouched).
 * Transparent pixels are skipped: their RGB is meaningless and grading them
 * only wastes cycles.
 */
export async function applyLut(image: Buffer, lut: Lut3D, strength: number): Promise<Buffer> {
  const img = await toRaw(image);
  return encodePng(applyLutRaw(img, lut, strength));
}

export function applyLutRaw(img: RawImage, lut: Lut3D, strength: number): RawImage {
  const k = clamp(strength, 0, 1);
  if (k === 0) return img;
  const out = Buffer.from(img.data);
  for (let p = 0; p < out.length; p += 4) {
    if (out[p + 3] === 0) continue;
    const [r, g, b] = sampleLut(lut, out[p]! / 255, out[p + 1]! / 255, out[p + 2]! / 255);
    out[p] = Math.round(clamp(out[p]! + (r * 255 - out[p]!) * k, 0, 255));
    out[p + 1] = Math.round(clamp(out[p + 1]! + (g * 255 - out[p + 1]!) * k, 0, 255));
    out[p + 2] = Math.round(clamp(out[p + 2]! + (b * 255 - out[p + 2]!) * k, 0, 255));
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

/**
 * Parse an Adobe .cube file. Supports `TITLE`, `LUT_3D_SIZE`, `DOMAIN_MIN` /
 * `DOMAIN_MAX` (values are renormalised into 0–1) and `#` comments. 1D cubes
 * are rejected loudly rather than silently mis-sampled.
 */
export function parseCube(text: string): Lut3D {
  let size = 0;
  let title: string | undefined;
  let domainMin: Rgb = [0, 0, 0];
  let domainMax: Rgb = [1, 1, 1];
  const values: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      const m = /"([^"]*)"/.exec(line);
      title = m ? m[1] : line.slice(5).trim();
      continue;
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = Number.parseInt(line.split(/\s+/)[1] ?? '', 10);
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('parseCube: 1D LUTs are not supported, expected LUT_3D_SIZE');
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(/\s+/).slice(1, 4).map(Number) as Rgb;
      continue;
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(/\s+/).slice(1, 4).map(Number) as Rgb;
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) values.push(r, g, b);
    }
  }

  if (!Number.isFinite(size) || size < 2) throw new Error('parseCube: missing or invalid LUT_3D_SIZE');
  const expected = size * size * size * 3;
  if (values.length !== expected) {
    throw new Error(`parseCube: expected ${expected} values for size ${size}, got ${values.length}`);
  }

  const data = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    const c = i % 3;
    const lo = domainMin[c]!;
    const hi = domainMax[c]!;
    const span = hi - lo || 1;
    data[i] = (values[i]! - lo) / span;
  }
  return title === undefined ? { size, data } : { size, data, title };
}

// ── Built-in looks ───────────────────────────────────────────────────────────

const luma = (r: number, g: number, b: number): number => LUMA_R * r + LUMA_G * g + LUMA_B * b;

/** Contrast about a pivot; k = 1 is identity. */
function sCurve(x: number, k: number, pivot = 0.5): number {
  return clamp(pivot + (x - pivot) * k, 0, 1);
}

/** Saturation multiplier around the pixel's own luma. */
function satRgb(c: Rgb, k: number): Rgb {
  const l = luma(c[0], c[1], c[2]);
  return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k];
}

function lerp3(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function mul3(c: Rgb, m: Rgb): Rgb {
  return [c[0] * m[0], c[1] * m[1], c[2] * m[2]];
}

/** Photoshop's overlay, per channel. */
function overlay(base: number, blend: number): number {
  return base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend);
}

const GRID = 33;

export const BUILTIN_LUTS: Record<string, Lut3D> = {
  /**
   * teal-orange — the blockbuster complementary split. Shadows are multiplied
   * toward cyan-teal and highlights toward amber, weighted by luminance, then a
   * mild S-curve separates the two ends. Chroma is nudged up slightly because
   * the opposing multipliers cancel a little saturation in the midtones.
   */
  'teal-orange': buildLut(GRID, 'Hexa Teal & Orange', (r, g, b) => {
    const l = luma(r, g, b);
    const t = smoothstep(0.15, 0.85, l);
    let c = mul3([r, g, b], lerp3([0.86, 1.0, 1.16], [1.14, 1.02, 0.82], t));
    c = [sCurve(c[0], 1.16), sCurve(c[1], 1.16), sCurve(c[2], 1.16)];
    return satRgb(c, 1.08);
  }),

  /**
   * bleach-bypass — skipping the bleach step leaves silver in the negative,
   * which behaves like a black-and-white positive laid over the colour image.
   * Modelled as: desaturate 55 %, then overlay-blend the luminance onto itself,
   * then raise contrast. Result: metallic, high-contrast, low-chroma.
   */
  'bleach-bypass': buildLut(GRID, 'Hexa Bleach Bypass', (r, g, b) => {
    const l = luma(r, g, b);
    const desat = lerp3([r, g, b], [l, l, l], 0.55);
    const silver: Rgb = [overlay(desat[0], l), overlay(desat[1], l), overlay(desat[2], l)];
    const c: Rgb = [sCurve(silver[0], 1.22), sCurve(silver[1], 1.22), sCurve(silver[2], 1.22)];
    // A trace of cyan in the toe keeps it from reading sepia.
    return [c[0], c[1] + (1 - l) * 0.012, c[2] + (1 - l) * 0.03];
  }),

  /**
   * neo-noir — sodium-free night city. Chroma cut to 55 %, shadows pushed hard
   * into blue, a per-channel gamma that crushes the toe, and a matte lift so
   * blacks sit just off zero the way anamorphic night exteriors do.
   */
  'neo-noir': buildLut(GRID, 'Hexa Neo Noir', (r, g, b) => {
    const l = luma(r, g, b);
    const desat = lerp3([r, g, b], [l, l, l], 0.45);
    const cooled = mul3(desat, lerp3([0.8, 0.93, 1.24], [1.0, 1.0, 1.08], smoothstep(0, 1, l)));
    const crushed: Rgb = [cooled[0] ** 1.22, cooled[1] ** 1.22, cooled[2] ** 1.16];
    const lift = 0.018;
    return [
      sCurve(lift + crushed[0] * (1 - lift), 1.18),
      sCurve(lift + crushed[1] * (1 - lift), 1.18),
      sCurve(lift + crushed[2] * (1 - lift), 1.18),
    ];
  }),

  /**
   * ember — firelight. Warm brown shadows, hot orange highlights, blues pulled
   * down by a gamma above 1 so the frame never goes cold; slight extra chroma
   * so the fire itself stays vivid rather than clipping to white.
   */
  ember: buildLut(GRID, 'Hexa Ember', (r, g, b) => {
    const l = luma(r, g, b);
    const t = smoothstep(0.1, 0.9, l);
    let c = mul3([r, g, b], lerp3([1.06, 0.86, 0.72], [1.18, 0.98, 0.68], t));
    c = [c[0] ** 0.94, c[1] ** 1.04, c[2] ** 1.2];
    c = [sCurve(c[0], 1.1), sCurve(c[1], 1.1), sCurve(c[2], 1.1)];
    return satRgb(c, 1.12);
  }),

  /**
   * cold-steel — desaturated blue-grey with a matte lift and a soft highlight
   * shoulder. The shoulder is a linear knee starting at 0.7 that removes 12 %
   * of the range above it, which stops speculars from clipping to paper white.
   */
  'cold-steel': buildLut(GRID, 'Hexa Cold Steel', (r, g, b) => {
    const l = luma(r, g, b);
    const desat = lerp3([r, g, b], [l, l, l], 0.35);
    const cooled = mul3(desat, [0.93, 0.99, 1.11]);
    const lift = 0.035;
    const shoulder = (x: number): number => x - 0.12 * smoothstep(0.7, 1, x) * Math.max(0, x - 0.7);
    return [
      shoulder(lift + cooled[0] * (1 - lift)),
      shoulder(lift + cooled[1] * (1 - lift)),
      shoulder(lift + cooled[2] * (1 - lift)),
    ];
  }),

  /**
   * crimson-contrast — aggressive poster look. Per-channel gamma lifts red and
   * suppresses green/blue, a hard S-curve about a low pivot crushes the toe,
   * and a squared shadow mask injects crimson into the blacks.
   */
  'crimson-contrast': buildLut(GRID, 'Hexa Crimson Contrast', (r, g, b) => {
    const l = luma(r, g, b);
    let c: Rgb = [r ** 0.88, g ** 1.12, b ** 1.1];
    c = [sCurve(c[0], 1.32, 0.46), sCurve(c[1], 1.32, 0.46), sCurve(c[2], 1.32, 0.46)];
    const shadow = (1 - l) ** 2;
    c = [c[0] + shadow * 0.07, c[1] - shadow * 0.012, c[2] + shadow * 0.004];
    return satRgb(c, 1.18);
  }),
};
