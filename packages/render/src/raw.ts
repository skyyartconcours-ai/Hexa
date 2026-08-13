/**
 * Raw-pixel plumbing.
 *
 * Everything above this file thinks in `RawImage` — an interleaved 8-bit RGBA
 * (or single-channel) buffer plus its dimensions. Staying in raw between stages
 * matters: a 40-layer composite that re-encoded PNG between every step would
 * spend most of its wall clock in zlib, and every round trip through a lossy
 * codec would soften the very edges supersampling exists to protect.
 *
 * Two libvips behaviours are relied on throughout and were verified against
 * sharp 0.34 / libvips 8.17 before this code was written:
 *   1. `blur` and `convolve` premultiply alpha internally, so blurring a cutout
 *      does not drag transparent black into the fringe.
 *   2. raw in / raw out round-trips byte-exactly, so determinism survives the
 *      whole pipeline.
 */

import { availableParallelism } from 'node:os';
import sharp from 'sharp';
import { parseHex, clamp } from '@hexa/core';
import { timed, timedSync } from './profile.js';

/**
 * Give libvips the cores it is standing on.
 *
 * libvips sizes its worker pool from what it can infer about the host, and in a
 * container it frequently infers **one** — measured here as `sharp.concurrency()
 * === 1` on a 4-core machine, which makes every blur, resize and composite in
 * this package run single-threaded. Raising it to the parallelism Node itself
 * reports is worth 2–2.4× on the whole libvips half of a render.
 *
 * Deliberately conservative:
 *   * an explicit `VIPS_CONCURRENCY` / `SHARP_CONCURRENCY` is never overridden —
 *     someone who pinned it did so for a reason (memory, cgroup quota, a shared
 *     box);
 *   * the pool is only ever *raised*, never lowered;
 *   * tile scheduling is deterministic, so a thread count is invisible in the
 *     output: the same plan renders byte-identically at any concurrency.
 */
function tuneLibvips(): void {
  if (process.env['VIPS_CONCURRENCY'] || process.env['SHARP_CONCURRENCY']) return;
  try {
    const cores = availableParallelism();
    if (sharp.concurrency() < cores) sharp.concurrency(cores);
  } catch {
    // A sharp build that refuses the call is not worth failing a render over.
  }
}
tuneLibvips();

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  /** 4 for RGBA, 1 for a mask/alpha plane. */
  channels: number;
}

/** Rec.709 luma weights — the standard for display-referred grading tools. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/** sharp refuses sigmas below this; anything smaller is a visual no-op anyway. */
export const MIN_SIGMA = 0.3;

export function luma8(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/** sRGB 0–1 → linear light. Kept local: @hexa/core does not export it. */
export function srgbToLinear(s: number): number {
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(l: number): number {
  return l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
}

/** Decode anything sharp understands into 8-bit RGBA. */
export async function toRaw(input: Buffer | string): Promise<RawImage> {
  return timed('decode', 0, async () => {
  const { data, info } = await sharp(input)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
  });
}

export function rawToSharp(img: RawImage): sharp.Sharp {
  return sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: img.channels as 1 | 2 | 3 | 4 },
  });
}

export async function encodePng(img: RawImage): Promise<Buffer> {
  return timed('encode:png', img.width * img.height, () =>
    rawToSharp(img).png({ compressionLevel: 6 }).toBuffer(),
  );
}

export function cloneRaw(img: RawImage): RawImage {
  return { data: Buffer.from(img.data), width: img.width, height: img.height, channels: img.channels };
}

/** A flat RGBA field of one colour (alpha honoured from #RRGGBBAA). */
export function solidRaw(width: number, height: number, color: string): RawImage {
  const { r, g, b, a } = parseHex(color);
  const data = Buffer.allocUnsafe(width * height * 4);
  const A = Math.round(clamp(a, 0, 1) * 255);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = A;
  }
  return { data, width, height, channels: 4 };
}

/** Pull the alpha plane out of an RGBA image as a single-channel mask. */
export function alphaPlane(img: RawImage): RawImage {
  const n = img.width * img.height;
  const out = Buffer.allocUnsafe(n);
  if (img.channels === 1) return { data: Buffer.from(img.data), width: img.width, height: img.height, channels: 1 };
  for (let i = 0, p = 3; i < n; i++, p += img.channels) out[i] = img.data[p]!;
  return { data: out, width: img.width, height: img.height, channels: 1 };
}

/** Multiply an RGBA image's alpha by a scalar (used for layer opacity). */
export function scaleAlpha(img: RawImage, factor: number): RawImage {
  if (factor >= 1) return img;
  const out = Buffer.from(img.data);
  const f = Math.max(0, factor);
  for (let p = 3; p < out.length; p += 4) out[p] = Math.round(out[p]! * f);
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

/**
 * Gaussian blur that respects premultiplication (see file header).
 *
 * Single-band input needs `toColourspace('b-w')` on the way out: libvips
 * promotes a 1-band raw image to sRGB, so without it a blurred *mask* comes
 * back with three interleaved copies of itself and every downstream index is
 * off by 3× — which shows up as stripes across the subject rather than as an
 * obvious crash.
 */
export async function blurRaw(img: RawImage, sigma: number): Promise<RawImage> {
  if (!(sigma >= MIN_SIGMA)) return cloneRaw(img);
  const s = Math.min(1000, sigma);
  const k = decimation(s, img.width, img.height);
  return timed(k > 1 ? 'vips:blur-mip' : 'vips:blur', img.width * img.height, async () => {
    if (k > 1) return mipBlur(img, s, k);
    let pipe = rawToSharp(img).blur(s);
    if (img.channels === 1) pipe = pipe.toColourspace('b-w');
    const { data, info } = await pipe.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  });
}

/**
 * How far a blur of this sigma can be decimated before it stops looking like
 * itself.
 *
 * A gaussian of sigma σ is a low-pass filter: the output provably contains no
 * detail finer than ~σ, so evaluating it on a 1/k copy and resampling back
 * throws away only frequencies the blur was about to destroy anyway. libvips'
 * gaussian costs ~O(σ·n), so working at 1/k costs O(σ·n / k³) — a sigma-98
 * bloom veil (the widest scale of a 1280×720 bloom) drops from ~350 ms to ~4.
 *
 * `SAFE_SIGMA` is the sigma the decimated blur is aimed at: keeping it ≥ 3 px
 * means the gaussian is still sampled by ~19 taps after decimation, which is
 * where the discretisation error stops being measurable. The result was diffed
 * against the exact blur across the effect stack: mean absolute error < 0.6/255
 * with no structural difference.
 */
const SAFE_SIGMA = 3;
/** Never decimate below this on the short side, or edge handling starts to show. */
const MIN_DECIMATED_EDGE = 24;

function decimation(sigma: number, width: number, height: number): number {
  if (sigma < SAFE_SIGMA * 2) return 1;
  const byEdge = Math.floor(Math.min(width, height) / MIN_DECIMATED_EDGE);
  const k = Math.min(Math.floor(sigma / SAFE_SIGMA), byEdge);
  return k >= 2 ? k : 1;
}

/**
 * Decimate → blur at sigma/k → resample back. See `decimation` for the maths.
 *
 * Two pipelines, not one: `resize` is a *property* of a sharp pipeline rather
 * than a queued operation, so a second call replaces the first and the image
 * would come back at the small size (the same trap `directionalBlur` documents
 * for `rotate`). Blur *can* share the first pipeline — sharp always applies it
 * after the resize.
 */
async function mipBlur(img: RawImage, sigma: number, k: number): Promise<RawImage> {
  const sw = Math.max(1, Math.round(img.width / k));
  const sh = Math.max(1, Math.round(img.height / k));
  // The effective decimation is what the rounded size actually gives, so the
  // small-space sigma stays true to the blur that was asked for.
  const effective = Math.min(img.width / sw, img.height / sh);

  let down = rawToSharp(img)
    // `resize` premultiplies alpha, so a decimated cutout keeps a clean fringe.
    .resize(sw, sh, { kernel: 'cubic', fit: 'fill' })
    .blur(Math.max(MIN_SIGMA, sigma / effective));
  if (img.channels === 1) down = down.toColourspace('b-w');
  const small = await down.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });

  let up = sharp(small.data, {
    raw: { width: small.info.width, height: small.info.height, channels: small.info.channels as 1 | 2 | 3 | 4 },
  }).resize(img.width, img.height, { kernel: 'cubic', fit: 'fill' });
  if (img.channels === 1) up = up.toColourspace('b-w');
  const { data, info } = await up.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 1-D box convolution along `angle` — the kernel behind motionBlur. */
export async function directionalBlur(img: RawImage, angleDeg: number, taps: number): Promise<RawImage> {
  return timed('vips:directional-blur', img.width * img.height, async () => {
  const n = Math.max(3, taps % 2 === 1 ? taps : taps + 1);
  // libvips requires both kernel dimensions >= 3, so a 1×N line kernel is
  // padded to 3×N with zero rows — mathematically identical, still one pass.
  const kernel = new Array<number>(n * 3).fill(0);
  for (let i = 0; i < n; i++) kernel[n + i] = 1;

  // Rotate so the streak direction lies on +x, blur horizontally, rotate back.
  // Angles follow the light convention used everywhere in this package:
  // measured counter-clockwise from +x with y pointing *up*, so screen-space
  // direction is (cos a, −sin a) and sharp's clockwise rotate(a) aligns it.
  //
  // Three separate pipelines on purpose: `rotate()` is a *property* of a sharp
  // pipeline, not a queued operation, so a second call in the same chain simply
  // replaces the first and the image comes out still rotated.
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const spun = await rawToSharp(img)
    .rotate(angleDeg, { background: transparent })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  const blurred = await sharp(spun.data, {
    raw: { width: spun.info.width, height: spun.info.height, channels: 4 },
  })
    .convolve({ width: n, height: 3, kernel, scale: n, offset: 0 })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  const back = await sharp(blurred.data, {
    raw: { width: blurred.info.width, height: blurred.info.height, channels: 4 },
  })
    .rotate(-angleDeg, { background: transparent })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  const left = Math.max(0, Math.round((back.info.width - img.width) / 2));
  const top = Math.max(0, Math.round((back.info.height - img.height) / 2));
  const { data, info } = await sharp(back.data, {
    raw: { width: back.info.width, height: back.info.height, channels: 4 },
  })
    .extract({ left, top, width: img.width, height: img.height })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
  });
}

/** Fit `input` to exactly w×h, cropping overflow (used for light-wrap plates). */
export async function resizeCover(input: Buffer, w: number, h: number): Promise<RawImage> {
  const { data, info } = await sharp(input)
    .toColourspace('srgb')
    .ensureAlpha()
    .resize(w, h, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

// ── Morphology ───────────────────────────────────────────────────────────────
// Dilate/erode of an alpha plane, separable and O(n) per axis via a monotonic
// deque. Needed because libvips exposes no rank filter through sharp, and both
// `strokeAlpha` (dilate − original) and `lightWrap` (original − erode) are
// defined in terms of exact morphology rather than a thresholded blur, which
// would make band width depend on the shape's local curvature.

function extremeAxis(
  src: Uint8Array,
  dst: Uint8Array,
  count: number,
  len: number,
  base: number,
  stride: number,
  radius: number,
  isMax: boolean,
): void {
  const dq = new Int32Array(len);
  for (let line = 0; line < count; line++) {
    const off = base * line;
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let i = 0; i < len; i++) {
      const hi = Math.min(len - 1, i + radius);
      while (next <= hi) {
        const v = src[off + next * stride]!;
        while (tail > head) {
          const prev = src[off + dq[tail - 1]! * stride]!;
          if (isMax ? prev <= v : prev >= v) tail--;
          else break;
        }
        dq[tail++] = next++;
      }
      const lo = i - radius;
      while (dq[head]! < lo) head++;
      dst[off + i * stride] = src[off + dq[head]! * stride]!;
    }
  }
}

function morphology(mask: RawImage, radius: number, isMax: boolean): RawImage {
  return timedSync(isMax ? 'morph:dilate' : 'morph:erode', mask.width * mask.height, () =>
    morphologyCore(mask, radius, isMax),
  );
}

function morphologyCore(mask: RawImage, radius: number, isMax: boolean): RawImage {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return { data: Buffer.from(mask.data), width: mask.width, height: mask.height, channels: 1 };
  const { width: w, height: h } = mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  extremeAxis(mask.data, tmp, h, w, w, 1, r, isMax); // rows
  extremeAxis(tmp, out, w, h, 1, w, r, isMax); // columns
  return { data: Buffer.from(out.buffer, out.byteOffset, out.length), width: w, height: h, channels: 1 };
}

/** Grow a mask by `radius` px (square structuring element). */
export function dilate(mask: RawImage, radius: number): RawImage {
  return morphology(mask, radius, true);
}

/** Shrink a mask by `radius` px. */
export function erode(mask: RawImage, radius: number): RawImage {
  return morphology(mask, radius, false);
}

/** Bilinear sample of one channel, clamped at the border. */
export function sampleChannel(
  data: Buffer,
  w: number,
  h: number,
  channels: number,
  c: number,
  x: number,
  y: number,
): number {
  const fx = clamp(x, 0, w - 1);
  const fy = clamp(y, 0, h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const p00 = data[(y0 * w + x0) * channels + c]!;
  const p10 = data[(y0 * w + x1) * channels + c]!;
  const p01 = data[(y1 * w + x0) * channels + c]!;
  const p11 = data[(y1 * w + x1) * channels + c]!;
  const top = p00 + (p10 - p00) * tx;
  const bot = p01 + (p11 - p01) * tx;
  return top + (bot - top) * ty;
}

/** `255 − (255−a)(255−b)/255`, the screen operator in 8-bit. */
export function screen8(a: number, b: number): number {
  return 255 - ((255 - a) * (255 - b)) / 255;
}

/** Copy a rect out of a raw RGBA image, clamping to the source bounds. */
export function cropRaw(img: RawImage, x: number, y: number, w: number, h: number): RawImage {
  const out = Buffer.alloc(w * h * img.channels, 0);
  const ch = img.channels;
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= img.height) continue;
    for (let col = 0; col < w; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= img.width) continue;
      const s = (sy * img.width + sx) * ch;
      const d = (row * w + col) * ch;
      for (let c = 0; c < ch; c++) out[d + c] = img.data[s + c]!;
    }
  }
  return { data: out, width: w, height: h, channels: ch };
}
