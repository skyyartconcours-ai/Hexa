/**
 * Optical / photochemical effects — everything that happens to light *after*
 * the scene is composed: lens bloom, film halation, chromatic aberration,
 * vignetting and grain.
 *
 * These are what make a render read as a photographed frame. They are also the
 * easiest to overdo, so every one of them is written so a zero parameter is an
 * exact identity, and the defaults are conservative.
 *
 * As in `edge.ts`, each effect has a `…Raw` core (used by `applyGrade`, which
 * chains six of them) and a public Buffer wrapper.
 */

import { createRng, clamp, smoothstep } from '@hexa/core';
import {
  type RawImage,
  toRaw,
  encodePng,
  blurRaw,
  luma8,
  screen8,
  rawToSharp,
  sampleChannel,
  MIN_SIGMA,
} from '../raw.js';

/**
 * How far a field whose finest feature is a `sigma`-blur can be decimated.
 *
 * Unlike `blurRaw`, which must beat a *single* libvips gaussian to be worth the
 * two extra resizes, bloom amortises one decimation over three blurs and three
 * accumulation passes — so it pays from a much lower sigma. Aim for ~4 px after
 * decimation and never shrink the short side below something that resamples
 * cleanly.
 */
function decimateFor(sigma: number, width: number, height: number): number {
  const byEdge = Math.floor(Math.min(width, height) / 32);
  const k = Math.min(Math.floor(sigma / 4), byEdge);
  return k >= 2 ? k : 1;
}

/** Straight box/cubic resample of a raw image — no blur, no alpha games. */
async function resample(img: RawImage, w: number, h: number): Promise<RawImage> {
  const { data, info } = await rawToSharp(img)
    .resize(Math.max(1, w), Math.max(1, h), { kernel: 'cubic', fit: 'fill' })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Soft-knee highlight extraction, shared by bloom and halation. */
function extractHighlights(img: RawImage, threshold: number, knee = 0.15): RawImage {
  const out = Buffer.allocUnsafe(img.data.length);
  for (let p = 0; p < img.data.length; p += 4) {
    const l = luma8(img.data[p]!, img.data[p + 1]!, img.data[p + 2]!) / 255;
    const k = smoothstep(threshold, Math.min(1, threshold + knee), l);
    out[p] = Math.round(img.data[p]! * k);
    out[p + 1] = Math.round(img.data[p + 1]! * k);
    out[p + 2] = Math.round(img.data[p + 2]! * k);
    out[p + 3] = img.data[p + 3]!;
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

/**
 * Multi-scale bloom.
 *
 * A single gaussian gives a doughnut of light with an obvious radius; real
 * lens/sensor bloom is a sum of scales — a tight core, a mid halo and a very
 * wide veil. Three octaves at 1×/2.6×/6.4× sigma with weights 0.5/0.32/0.18
 * approximate that energy distribution closely enough that the eye stops
 * noticing a radius at all. Screened back, so bloom can only add light.
 */
export async function bloomRaw(
  img: RawImage,
  threshold: number,
  intensity: number,
  radius?: number,
): Promise<RawImage> {
  const amt = clamp(intensity, 0, 4);
  if (amt <= 0) return img;

  const base = radius ?? Math.max(img.width, img.height) * 0.012;
  const highlights = extractHighlights(img, clamp(threshold, 0, 1));
  const scales: { sigma: number; weight: number }[] = [
    { sigma: Math.max(MIN_SIGMA, base), weight: 0.5 },
    { sigma: Math.max(MIN_SIGMA, base * 2.6), weight: 0.32 },
    { sigma: Math.max(MIN_SIGMA, base * 6.4), weight: 0.18 },
  ];

  // The tightest scale is already a `base`-sigma blur (≈15 px at 720p), so the
  // sum of the three carries nothing finer than that. Building the veil on a
  // decimated copy therefore costs a resize instead of three full-resolution
  // blurs *and* three full-resolution accumulation passes; the widest scale in
  // particular stops being a sigma-98 convolution over a megapixel. See
  // `decimateFor` for how the factor is chosen.
  const k = decimateFor(scales[0]!.sigma, img.width, img.height);
  const plate = k > 1 ? await resample(highlights, Math.round(img.width / k), Math.round(img.height / k)) : highlights;
  const kx = img.width / plate.width;
  const ky = img.height / plate.height;

  const acc = new Float32Array(plate.width * plate.height * 3);
  for (const { sigma, weight } of scales) {
    const b = await blurRaw(plate, Math.max(MIN_SIGMA, sigma / Math.min(kx, ky)));
    for (let i = 0, p = 0; i < acc.length; i += 3, p += 4) {
      acc[i] = acc[i]! + b.data[p]! * weight;
      acc[i + 1] = acc[i + 1]! + b.data[p + 1]! * weight;
      acc[i + 2] = acc[i + 2]! + b.data[p + 2]! * weight;
    }
  }

  // Back to full resolution as 8-bit: the veil is a smooth field and the screen
  // below quantises to 8 bits anyway.
  const small = Buffer.allocUnsafe(plate.width * plate.height * 4);
  for (let i = 0, p = 0; i < acc.length; i += 3, p += 4) {
    small[p] = Math.round(clamp(acc[i]! * amt, 0, 255));
    small[p + 1] = Math.round(clamp(acc[i + 1]! * amt, 0, 255));
    small[p + 2] = Math.round(clamp(acc[i + 2]! * amt, 0, 255));
    small[p + 3] = 255;
  }
  const veil =
    k > 1
      ? await resample({ data: small, width: plate.width, height: plate.height, channels: 4 }, img.width, img.height)
      : { data: small, width: plate.width, height: plate.height, channels: 4 };

  const out = Buffer.from(img.data);
  for (let p = 0; p < out.length; p += 4) {
    out[p] = Math.round(screen8(out[p]!, veil.data[p]!));
    out[p + 1] = Math.round(screen8(out[p + 1]!, veil.data[p + 1]!));
    out[p + 2] = Math.round(screen8(out[p + 2]!, veil.data[p + 2]!));
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

export async function bloom(image: Buffer, threshold: number, intensity: number, radius?: number): Promise<Buffer> {
  return encodePng(await bloomRaw(await toRaw(image), threshold, intensity, radius));
}

/**
 * Halation — light that punches through the emulsion, scatters off the film
 * base and re-exposes the layers from behind. The red-sensitive layer sits
 * deepest, so the bleed is overwhelmingly warm; that is why blown practicals on
 * film glow orange-red rather than white. Wider and weaker than bloom.
 */
export async function halationRaw(img: RawImage, amount: number): Promise<RawImage> {
  const amt = clamp(amount, 0, 2);
  if (amt <= 0) return img;

  const highlights = extractHighlights(img, 0.72, 0.2);
  const sigma = Math.max(MIN_SIGMA, Math.max(img.width, img.height) * 0.02);
  // Same argument as bloom: a sigma-26 bleed has no fine structure to lose.
  const k = decimateFor(sigma, img.width, img.height);
  const plate =
    k > 1 ? await resample(highlights, Math.round(img.width / k), Math.round(img.height / k)) : highlights;
  const blurred = await blurRaw(plate, Math.max(MIN_SIGMA, sigma / Math.max(1, img.width / plate.width)));
  const spread = k > 1 ? await resample(blurred, img.width, img.height) : blurred;
  const tint: [number, number, number] = [1.0, 0.3, 0.14]; // deep-layer red bias

  const tr = tint[0] * amt;
  const tg = tint[1] * amt;
  const tb = tint[2] * amt;
  const out = Buffer.from(img.data);
  for (let p = 0; p < out.length; p += 4) {
    out[p] = Math.round(screen8(out[p]!, clamp(spread.data[p]! * tr, 0, 255)));
    out[p + 1] = Math.round(screen8(out[p + 1]!, clamp(spread.data[p + 1]! * tg, 0, 255)));
    out[p + 2] = Math.round(screen8(out[p + 2]!, clamp(spread.data[p + 2]! * tb, 0, 255)));
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

export async function halation(image: Buffer, amount: number): Promise<Buffer> {
  return encodePng(await halationRaw(await toRaw(image), amount));
}

/**
 * Transverse chromatic aberration: a lens focuses red and blue at slightly
 * different magnifications, so fringing grows radially from the optical centre
 * and is zero in the middle of frame. `amount` is the displacement in pixels at
 * the frame edge — sub-pixel values are still visible and are sampled
 * bilinearly.
 */
export function chromaticAberrationRaw(img: RawImage, amount: number): RawImage {
  if (Math.abs(amount) < 0.01) return img;
  const { width: w, height: h } = img;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const e = amount / Math.max(cx, cy); // relative scale at the frame edge
  const out = Buffer.from(img.data);

  // The displacement is a pure radial *scale*, so the source coordinate
  // separates: sx depends only on x and sy only on y. Both channels therefore
  // need four 1-D tables of (integer index, fractional weight) instead of a
  // clamp-and-floor per pixel per channel, and the inner loop collapses to two
  // bilinear taps over precomputed neighbours.
  const axis = (n: number, centre: number, scale: number): { i0: Int32Array; i1: Int32Array; t: Float64Array } => {
    const i0 = new Int32Array(n);
    const i1 = new Int32Array(n);
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const f = clamp(centre + (i - centre) * scale, 0, n - 1);
      const lo = Math.floor(f);
      i0[i] = lo;
      i1[i] = Math.min(n - 1, lo + 1);
      t[i] = f - lo;
    }
    return { i0, i1, t };
  };

  const rx = axis(w, cx, 1 + e);
  const ry = axis(h, cy, 1 + e);
  const bx = axis(w, cx, 1 - e);
  const by = axis(h, cy, 1 - e);
  const src = img.data;

  for (let y = 0; y < h; y++) {
    const rRow0 = ry.i0[y]! * w;
    const rRow1 = ry.i1[y]! * w;
    const rty = ry.t[y]!;
    const bRow0 = by.i0[y]! * w;
    const bRow1 = by.i1[y]! * w;
    const bty = by.t[y]!;
    let p = (y * w) * 4;
    for (let x = 0; x < w; x++, p += 4) {
      const rtx = rx.t[x]!;
      const ra = src[(rRow0 + rx.i0[x]!) * 4]!;
      const rb = src[(rRow0 + rx.i1[x]!) * 4]!;
      const rc = src[(rRow1 + rx.i0[x]!) * 4]!;
      const rd = src[(rRow1 + rx.i1[x]!) * 4]!;
      const rTop = ra + (rb - ra) * rtx;
      const rBot = rc + (rd - rc) * rtx;
      out[p] = Math.round(rTop + (rBot - rTop) * rty);

      const btx = bx.t[x]!;
      const ba = src[(bRow0 + bx.i0[x]!) * 4 + 2]!;
      const bb = src[(bRow0 + bx.i1[x]!) * 4 + 2]!;
      const bc = src[(bRow1 + bx.i0[x]!) * 4 + 2]!;
      const bd = src[(bRow1 + bx.i1[x]!) * 4 + 2]!;
      const bTop = ba + (bb - ba) * btx;
      const bBot = bc + (bd - bc) * btx;
      out[p + 2] = Math.round(bTop + (bBot - bTop) * bty);
    }
  }
  return { data: out, width: w, height: h, channels: 4 };
}

export async function chromaticAberration(image: Buffer, amount: number): Promise<Buffer> {
  return encodePng(chromaticAberrationRaw(await toRaw(image), amount));
}

/**
 * Lens vignette. `feather` is the normalised radius at which darkening begins
 * (corners are exactly 1.0), so a small feather means a deep tunnel and a large
 * one only kisses the corners.
 */
export function vignetteRaw(img: RawImage, amount: number, feather = 0.55): RawImage {
  const amt = clamp(amount, 0, 1);
  if (amt <= 0) return img;
  const { width: w, height: h } = img;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const inner = clamp(feather, 0, 0.99);
  const out = Buffer.from(img.data);

  // The darkening depends only on r² = nx² + ny², which separates by axis, and
  // the falloff is a fixed function of it — so the hypot, the smoothstep and the
  // square per pixel all collapse into one table lookup on a sum of two
  // precomputed terms. r² runs 0–2 (the corners), tabulated in 4096 steps: the
  // curve is smooth and the result lands in 8 bits, so the step is invisible.
  const STEPS = 4096;
  const fallTable = new Float64Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) {
    const r = Math.min(1, Math.sqrt((i / STEPS) * 2) / Math.SQRT2);
    const fall = smoothstep(inner, 1, r);
    fallTable[i] = 1 - amt * fall * fall;
  }
  const nx2 = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const nx = (x - cx) / Math.max(1, cx);
    nx2[x] = nx * nx;
  }

  for (let y = 0; y < h; y++) {
    const ny = (y - cy) / Math.max(1, cy);
    const ny2 = ny * ny;
    let p = y * w * 4;
    for (let x = 0; x < w; x++, p += 4) {
      const q = nx2[x]! + ny2;
      const v = fallTable[q >= 2 ? STEPS : ((q * (STEPS / 2)) | 0)]!;
      if (v >= 0.999) continue;
      out[p] = Math.round(out[p]! * v);
      out[p + 1] = Math.round(out[p + 1]! * v);
      out[p + 2] = Math.round(out[p + 2]! * v);
    }
  }
  return { data: out, width: w, height: h, channels: 4 };
}

export async function vignette(image: Buffer, amount: number, feather?: number): Promise<Buffer> {
  return encodePng(vignetteRaw(await toRaw(image), amount, feather));
}

/**
 * Film grain.
 *
 * Two details separate believable grain from a noise overlay:
 *   * grain has *size*. It is synthesised at half resolution and bicubically
 *     upsampled, so clumps span ~2 px whatever the output resolution;
 *   * grain is strongest in the midtones — emulsion crystals cannot expose
 *     further once blown out and the toe holds almost none — so the response is
 *     weighted by `1 − |2L − 1|^1.5`.
 *
 * Fully deterministic: every sample comes from `createRng(seed)`.
 */
export async function filmGrainRaw(img: RawImage, amount: number, seed: number): Promise<RawImage> {
  const amt = clamp(amount, 0, 1);
  if (amt <= 0) return img;
  const { width: w, height: h } = img;
  const gw = Math.max(1, Math.ceil(w / 2));
  const gh = Math.max(1, Math.ceil(h / 2));
  const rng = createRng(seed >>> 0);
  const small = Buffer.allocUnsafe(gw * gh);
  for (let i = 0; i < small.length; i++) {
    // Gaussian, because photographic grain is a sum of many crystal events.
    small[i] = Math.round(clamp(128 + rng.gaussian(0, 46), 0, 255));
  }
  const { data: noise } = await rawToSharp({ data: small, width: gw, height: gh, channels: 1 })
    .resize(w, h, { kernel: 'cubic', fit: 'fill' })
    // b-w or libvips hands back three interleaved copies of the field.
    .toColourspace('b-w')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  // The midtone response is `1 − |2L − 1|^1.5` — a fractional power of the
  // luminance and nothing else, so it is a 256-entry table rather than a
  // `Math.pow` per pixel. Luminance is quantised to the 8-bit level it was
  // computed from, so the table is exact at those inputs to within rounding.
  const response = new Float32Array(256);
  for (let i = 0; i < 256; i++) response[i] = 1 - Math.abs((2 * i) / 255 - 1) ** 1.5;

  const out = Buffer.from(img.data);
  const strength = amt * 64;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const li = luma8(out[p]!, out[p + 1]!, out[p + 2]!) | 0;
    const d = ((noise[i]! - 128) / 128) * strength * response[li]!;
    out[p] = Math.round(clamp(out[p]! + d, 0, 255));
    out[p + 1] = Math.round(clamp(out[p + 1]! + d * 0.94, 0, 255));
    out[p + 2] = Math.round(clamp(out[p + 2]! + d * 0.88, 0, 255));
  }
  return { data: out, width: w, height: h, channels: 4 };
}

export async function filmGrain(image: Buffer, amount: number, seed: number): Promise<Buffer> {
  return encodePng(await filmGrainRaw(await toRaw(image), amount, seed));
}
