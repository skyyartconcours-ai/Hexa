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

  const acc = new Float32Array(img.width * img.height * 3);
  for (const { sigma, weight } of scales) {
    const b = await blurRaw(highlights, sigma);
    for (let i = 0, p = 0; i < acc.length; i += 3, p += 4) {
      acc[i] = acc[i]! + b.data[p]! * weight;
      acc[i + 1] = acc[i + 1]! + b.data[p + 1]! * weight;
      acc[i + 2] = acc[i + 2]! + b.data[p + 2]! * weight;
    }
  }

  const out = Buffer.from(img.data);
  for (let i = 0, p = 0; i < acc.length; i += 3, p += 4) {
    out[p] = Math.round(screen8(out[p]!, clamp(acc[i]! * amt, 0, 255)));
    out[p + 1] = Math.round(screen8(out[p + 1]!, clamp(acc[i + 1]! * amt, 0, 255)));
    out[p + 2] = Math.round(screen8(out[p + 2]!, clamp(acc[i + 2]! * amt, 0, 255)));
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
  const spread = await blurRaw(highlights, Math.max(MIN_SIGMA, Math.max(img.width, img.height) * 0.02));
  const tint: [number, number, number] = [1.0, 0.3, 0.14]; // deep-layer red bias

  const out = Buffer.from(img.data);
  for (let p = 0; p < out.length; p += 4) {
    for (let c = 0; c < 3; c++) {
      const bleed = spread.data[p + c]! * tint[c]! * amt;
      out[p + c] = Math.round(screen8(out[p + c]!, clamp(bleed, 0, 255)));
    }
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

  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const dx = x - cx;
      out[p] = Math.round(clamp(sampleChannel(img.data, w, h, 4, 0, cx + dx * (1 + e), cy + dy * (1 + e)), 0, 255));
      out[p + 2] = Math.round(clamp(sampleChannel(img.data, w, h, 4, 2, cx + dx * (1 - e), cy + dy * (1 - e)), 0, 255));
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

  for (let y = 0; y < h; y++) {
    const ny = (y - cy) / Math.max(1, cy);
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / Math.max(1, cx);
      const r = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2); // corners → 1
      const fall = smoothstep(inner, 1, r);
      const v = 1 - amt * fall * fall;
      if (v >= 0.999) continue;
      const p = (y * w + x) * 4;
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
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(img.data);
  const strength = amt * 64;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const l = luma8(out[p]!, out[p + 1]!, out[p + 2]!) / 255;
    const response = 1 - Math.abs(2 * l - 1) ** 1.5;
    const d = ((noise[i]! - 128) / 128) * strength * response;
    out[p] = Math.round(clamp(out[p]! + d, 0, 255));
    out[p + 1] = Math.round(clamp(out[p + 1]! + d * 0.94, 0, 255));
    out[p + 2] = Math.round(clamp(out[p + 2]! + d * 0.88, 0, 255));
  }
  return { data: out, width: w, height: h, channels: 4 };
}

export async function filmGrain(image: Buffer, amount: number, seed: number): Promise<Buffer> {
  return encodePng(await filmGrainRaw(await toRaw(image), amount, seed));
}
