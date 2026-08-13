/**
 * Raster primitives shared by every gate.
 *
 * Everything here works on decoded raw pixels rather than on sharp pipelines,
 * because the gates need to ask questions sharp does not answer (edge density
 * inside an arbitrary rect, Otsu splits, banding run-lengths, salient-region
 * counts). Decoding is done once per size and reused.
 */

import sharp from 'sharp';
import { toHex } from '@hexa/core';
import type { QaRect } from './types.js';

export interface RgbImage {
  data: Uint8Array;
  width: number;
  height: number;
  /** Always 3 — alpha is flattened onto `background` on load. */
  channels: 3;
}

export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Rec.709 luma. Matches the channel weighting WCAG uses, before its transfer
 *  function — good enough for thresholding, and `luminance()` from core is used
 *  wherever an actual WCAG ratio is reported. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Decode (and optionally resize) to flat RGB. Transparency is composited over
 * `background` so a gate measures what a viewer would see, not premultiplied
 * garbage. `fit: 'fill'` is deliberate: YouTube's display boxes are not exactly
 * 16:9 and stretching by <1% is invisible, whereas cropping would silently
 * remove the very text we are about to measure.
 *
 * The output is *always* three 8-bit channels in sRGB, whatever went in. That
 * matters more than it looks: a greyscale PNG, a CMYK JPEG or a 16-bit master
 * decodes to 1, 4 or 16-bit-per-sample raw, and every gate here indexes pixels
 * as `i*3` — so without the normalisation below a non-RGB input would not throw,
 * it would silently measure garbage and report a confident verdict about it.
 */
export async function loadRgb(
  image: Buffer,
  opts: { width?: number; height?: number; background?: string } = {},
): Promise<RgbImage> {
  let pipe = sharp(image, { failOn: 'none' })
    .toColourspace('srgb')
    .flatten({ background: opts.background ?? '#000000' });
  if (opts.width && opts.height) {
    pipe = pipe.resize(opts.width, opts.height, { fit: 'fill', kernel: 'lanczos3' });
  }
  const { data, info } = await pipe.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return {
    data: info.channels === 3 ? src : toThreeChannels(src, info.width, info.height, info.channels),
    width: info.width,
    height: info.height,
    channels: 3,
  };
}

/** Re-stride an unexpected channel count (1 = grey, 4 = an alpha that survived
 *  flatten, >4 = a colourspace we did not ask for) into RGB triples. */
function toThreeChannels(src: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  const n = Math.max(1, channels);
  for (let p = 0; p < width * height; p++) {
    const i = p * n;
    const r = src[i] ?? 0;
    out[p * 3] = r;
    out[p * 3 + 1] = n >= 3 ? (src[i + 1] ?? r) : r;
    out[p * 3 + 2] = n >= 3 ? (src[i + 2] ?? r) : r;
  }
  return out;
}

export function toGray(img: RgbImage): GrayImage {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; p < out.length; i += 3, p++) {
    out[p] = luma(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!) | 0;
  }
  return { data: out, width: img.width, height: img.height };
}

export async function loadGray(
  image: Buffer,
  opts: { width?: number; height?: number; background?: string } = {},
): Promise<GrayImage> {
  return toGray(await loadRgb(image, opts));
}

/** Edge magnitude at every pixel, normalised to 0–1 (|G| max is 4·255 per axis).
 *  Borders are left at 0 rather than clamped, so a frame-wide gradient does not
 *  fake an edge. */
export function sobel(img: GrayImage): Float32Array {
  const { data, width: w, height: h } = img;
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) => data[y * w + x]!;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const gx = tl + 2 * l + bl - (tr + 2 * r + br);
      const gy = tl + 2 * t + tr - (bl + 2 * b + br);
      out[y * w + x] = Math.min(1, Math.hypot(gx, gy) / 1020);
    }
  }
  return out;
}

/**
 * Fraction of pixels in `rect` whose edge magnitude clears `threshold`.
 * 0.08 ≈ a 20-level step across two pixels: above film grain, below any real
 * silhouette, glyph or rim light.
 */
export const EDGE_THRESHOLD = 0.08;

export function edgeDensity(
  mag: Float32Array,
  width: number,
  height: number,
  rect?: { x: number; y: number; w: number; h: number },
  threshold = EDGE_THRESHOLD,
): number {
  const r = clampToImage(rect ?? { x: 0, y: 0, w: width, h: height }, width, height);
  if (r.w <= 0 || r.h <= 0) return 0;
  let hits = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (mag[y * width + x]! >= threshold) hits++;
    }
  }
  return hits / (r.w * r.h);
}

/** Mean edge magnitude (not a count) — a softer signal than `edgeDensity`,
 *  used where "how much energy" matters more than "how many edges". */
export function meanEdgeEnergy(
  mag: Float32Array,
  width: number,
  height: number,
  rect?: { x: number; y: number; w: number; h: number },
): number {
  const r = clampToImage(rect ?? { x: 0, y: 0, w: width, h: height }, width, height);
  if (r.w <= 0 || r.h <= 0) return 0;
  let sum = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) sum += mag[y * width + x]!;
  }
  return sum / (r.w * r.h);
}

export function clampToImage(
  rect: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(0, Math.min(width - x, Math.round(rect.w)));
  const h = Math.max(0, Math.min(height - y, Math.round(rect.h)));
  return { x, y, w, h };
}

/** Every pixel of `rect` as packed RGB triples. */
export function cropPixels(img: RgbImage, rect: QaRect): { r: number; g: number; b: number }[] {
  const r = clampToImage(rect, img.width, img.height);
  const out: { r: number; g: number; b: number }[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 3;
      out.push({ r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]! });
    }
  }
  return out;
}

export function meanColor(px: { r: number; g: number; b: number }[]): { r: number; g: number; b: number } {
  if (px.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0, g = 0, b = 0;
  for (const p of px) { r += p.r; g += p.g; b += p.b; }
  return { r: r / px.length, g: g / px.length, b: b / px.length };
}

export function meanHex(px: { r: number; g: number; b: number }[]): string {
  return toHex(meanColor(px));
}

/**
 * Otsu's method: the grey level that best separates a rect into two clusters.
 * Used to find "glyph vs. background" without knowing which is which, and to
 * measure how far apart those two populations actually sit at display size.
 */
export function otsu(values: number[]): { threshold: number; lowMean: number; highMean: number; lowCount: number; highCount: number } {
  const hist = new Array<number>(256).fill(0);
  for (const v of values) hist[Math.max(0, Math.min(255, v | 0))]! += 1;
  const total = values.length;
  if (total === 0) return { threshold: 128, lowMean: 0, highMean: 0, lowCount: 0, highCount: 0 };

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;

  let sumB = 0, wB = 0, best = -1, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }

  let lowSum = 0, lowCount = 0, highSum = 0, highCount = 0;
  for (const v of values) {
    if (v <= threshold) { lowSum += v; lowCount++; } else { highSum += v; highCount++; }
  }
  return {
    threshold,
    lowMean: lowCount ? lowSum / lowCount : 0,
    highMean: highCount ? highSum / highCount : 0,
    lowCount,
    highCount,
  };
}

/** Euclidean distance in RGB. Crude next to ΔE, but it is only ever asked
 *  "is this pixel the declared text colour or is it the plate", and for that a
 *  sphere in RGB is enough. */
export function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → channels, or null when unparseable. */
export function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** How close to the declared colour a pixel must sit to count as glyph ink.
 *  Matches the figure/ground split the contrast gate uses. */
export const INK_TOLERANCE = 90;

export interface InkMask {
  /** 1 = glyph ink, row-major over `rect`. */
  data: Uint8Array;
  rect: { x: number; y: number; w: number; h: number };
  count: number;
  /** 'declared' when the plan told us the colour and the pixels agreed. */
  basis: 'declared' | 'estimated';
}

/**
 * Separate glyph ink from everything else inside a rect.
 *
 * Two paths, and the fallback between them is the interesting part. When the
 * plan declares the text colour we threshold on distance to it — but only after
 * checking the answer is plausible: ink covers roughly 5–40% of a line box, so a
 * "declared" colour that matches 70% of the rect is not the type, it is the
 * plate (a gradient-filled headline whose plan colour is a swatch off the
 * gradient does exactly this), and trusting it would make a plate edge look like
 * a clipped glyph. In that case, and whenever no colour is declared, an Otsu
 * split decides, with the *minority* population taken as the ink.
 *
 * Returns null when there is no measurable figure/ground split at all — better
 * to report "not measurable" than to invent a mask and a verdict from it.
 */
export function inkMask(
  img: RgbImage,
  rect: { x: number; y: number; w: number; h: number },
  declared: { r: number; g: number; b: number } | null,
  opts: { tolerance?: number; minSeparation?: number } = {},
): InkMask | null {
  const r = clampToImage(rect, img.width, img.height);
  const n = r.w * r.h;
  if (n <= 0) return null;

  const tolerance = opts.tolerance ?? INK_TOLERANCE;
  const px: { r: number; g: number; b: number }[] = [];
  const lumas: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 3;
      const p = { r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]! };
      px.push(p);
      lumas.push(luma(p.r, p.g, p.b) | 0);
    }
  }

  if (declared) {
    const data = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (colorDistance(px[i]!, declared) < tolerance) { data[i] = 1; count++; }
    }
    const share = count / n;
    // 0.4% floor: below that the declared colour is effectively absent (the
    // contrast gate is the one that reports "declared but never painted").
    if (share >= 0.004 && share <= 0.45) return { data, rect: r, count, basis: 'declared' };
  }

  const split = otsu(lumas);
  if (split.highMean - split.lowMean < (opts.minSeparation ?? 12)) return null;
  const inkIsHigh = split.highCount < split.lowCount;
  const data = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if ((lumas[i]! > split.threshold) === inkIsHigh) { data[i] = 1; count++; }
  }
  return count === 0 ? null : { data, rect: r, count, basis: 'estimated' };
}

/** Percentile of a numeric sample, p in 0–1. Sorts a copy. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(s.length - 1, Math.round(p * (s.length - 1))));
  return s[i]!;
}

/** RMS contrast, 0–1: the spread of luminance around its own mean. */
export function rmsContrast(gray: GrayImage, rect?: QaRect): number {
  const r = clampToImage(rect ?? { x: 0, y: 0, w: gray.width, h: gray.height }, gray.width, gray.height);
  if (r.w <= 0 || r.h <= 0) return 0;
  let sum = 0, sumSq = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const v = gray.data[y * gray.width + x]! / 255;
      sum += v; sumSq += v * v; n++;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/** HSV saturation of one pixel, 0–1. Cheap stand-in for chroma when scanning
 *  every pixel of a downscale; OKLab is used where accuracy matters. */
export function hsvSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Coarse saliency map: the canvas is diced into a `cols × rows` grid and each
 * cell scores its own edge density. Composition questions ("is there one focal
 * point?", "is there anywhere quiet?") are grid questions, not pixel questions,
 * and the grid keeps them cheap and stable across resolutions.
 */
export interface SaliencyGrid {
  cols: number;
  rows: number;
  /** Edge density per cell, row-major. */
  cells: Float32Array;
  mean: number;
}

export function saliencyGrid(gray: GrayImage, cols = 16, rows = 9, precomputed?: Float32Array): SaliencyGrid {
  const mag = precomputed ?? sobel(gray);
  const cells = new Float32Array(cols * rows);
  const cw = gray.width / cols;
  const ch = gray.height / rows;
  let sum = 0;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const d = edgeDensity(mag, gray.width, gray.height, {
        x: Math.floor(rx * cw), y: Math.floor(ry * ch),
        w: Math.max(1, Math.floor(cw)), h: Math.max(1, Math.floor(ch)),
      });
      cells[ry * cols + rx] = d;
      sum += d;
    }
  }
  return { cols, rows, cells, mean: sum / (cols * rows) };
}

export interface Region {
  /** Number of grid cells in the blob. */
  size: number;
  /** Centroid in normalised canvas units. */
  center: { x: number; y: number };
  /** Mean edge density across the blob. */
  strength: number;
}

/** 4-connected blobs of cells above (`busy`) or below (`quiet`) a threshold. */
export function connectedRegions(grid: SaliencyGrid, threshold: number, mode: 'above' | 'below'): Region[] {
  const { cols, rows, cells } = grid;
  const seen = new Uint8Array(cols * rows);
  const match = (v: number) => (mode === 'above' ? v >= threshold : v < threshold);
  const out: Region[] = [];

  for (let i = 0; i < cells.length; i++) {
    if (seen[i] || !match(cells[i]!)) continue;
    const stack = [i];
    seen[i] = 1;
    let size = 0, sx = 0, sy = 0, strength = 0;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cols;
      const cy = (c / cols) | 0;
      size++; sx += cx + 0.5; sy += cy + 0.5; strength += cells[c]!;
      const neighbours = [
        cx > 0 ? c - 1 : -1,
        cx < cols - 1 ? c + 1 : -1,
        cy > 0 ? c - cols : -1,
        cy < rows - 1 ? c + cols : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && !seen[n] && match(cells[n]!)) { seen[n] = 1; stack.push(n); }
      }
    }
    out.push({ size, center: { x: sx / size / cols, y: sy / size / rows }, strength: strength / size });
  }
  return out.sort((a, b) => b.size - a.size);
}

/** Encode raw RGB back to a PNG — used by the proof sheet and crop exports. */
export async function encodePng(img: RgbImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 3 } })
    .png()
    .toBuffer();
}
