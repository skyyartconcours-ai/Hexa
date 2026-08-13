/**
 * Per-layer colour manipulation: duotone remap, tint, tonal trim and motion
 * blur. These run *before* the edge treatments in `renderLayer`, so a rim light
 * is computed from the colours the layer will actually show.
 */

import { mix, parseHex, clamp } from '@hexa/core';
import {
  type RawImage,
  toRaw,
  encodePng,
  directionalBlur,
  luma8,
  srgbToLinear,
  linearToSrgb,
} from '../raw.js';

/**
 * Duotone: remap luminance onto a two-colour ramp.
 *
 * The ramp is interpolated in OKLab via `mix()` from @hexa/core, not in sRGB —
 * an sRGB ramp between deep blue and hot orange passes through mud around the
 * midpoint, which is exactly where most of a face's pixels live. The 256-entry
 * ramp is precomputed, so per-pixel cost is a table lookup.
 */
export function duotoneRaw(img: RawImage, shadow: string, highlight: string, amount: number): RawImage {
  const k = clamp(amount, 0, 1);
  if (k === 0) return img;

  const rampR = new Uint8Array(256);
  const rampG = new Uint8Array(256);
  const rampB = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const c = parseHex(mix(shadow, highlight, i / 255));
    rampR[i] = c.r;
    rampG[i] = c.g;
    rampB[i] = c.b;
  }

  const out = Buffer.from(img.data);
  for (let p = 0; p < out.length; p += 4) {
    if (out[p + 3] === 0) continue;
    const l = Math.round(clamp(luma8(out[p]!, out[p + 1]!, out[p + 2]!), 0, 255));
    out[p] = Math.round(out[p]! + (rampR[l]! - out[p]!) * k);
    out[p + 1] = Math.round(out[p + 1]! + (rampG[l]! - out[p + 1]!) * k);
    out[p + 2] = Math.round(out[p + 2]! + (rampB[l]! - out[p + 2]!) * k);
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

export async function duotone(image: Buffer, shadow: string, highlight: string, amount: number): Promise<Buffer> {
  return encodePng(duotoneRaw(await toRaw(image), shadow, highlight, amount));
}

/**
 * Motion blur along `angle` (same convention as the rim light: CCW from +x,
 * y up). Implemented as rotate → 1-D box convolution → rotate back → centre
 * crop, which keeps the cost linear in kernel length instead of quadratic and
 * runs entirely inside libvips.
 */
export async function motionBlurRaw(img: RawImage, angle: number, distance: number): Promise<RawImage> {
  const taps = Math.round(Math.abs(distance));
  if (taps < 2) return img;
  return directionalBlur(img, angle, Math.min(601, taps));
}

export async function motionBlur(image: Buffer, angle: number, distance: number): Promise<Buffer> {
  return encodePng(await motionBlurRaw(await toRaw(image), angle, distance));
}

/** Multiply-tint a layer toward `color` by `amount` (0–1). */
export function tintRaw(img: RawImage, color: string, amount: number): RawImage {
  const k = clamp(amount, 0, 1);
  if (k === 0) return img;
  const { r, g, b } = parseHex(color);
  const out = Buffer.from(img.data);
  for (let p = 0; p < out.length; p += 4) {
    if (out[p + 3] === 0) continue;
    const mr = (out[p]! * r) / 255;
    const mg = (out[p + 1]! * g) / 255;
    const mb = (out[p + 2]! * b) / 255;
    out[p] = Math.round(out[p]! + (mr - out[p]!) * k);
    out[p + 1] = Math.round(out[p + 1]! + (mg - out[p + 1]!) * k);
    out[p + 2] = Math.round(out[p + 2]! + (mb - out[p + 2]!) * k);
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

/**
 * Per-layer exposure (stops, applied in linear light), contrast (multiplier
 * about a 0.5 pivot) and saturation (multiplier). Every neutral value is an
 * exact identity, so a layer with `{}` effects is byte-unchanged.
 */
export function toneRaw(
  img: RawImage,
  opts: { exposure?: number; contrast?: number; saturation?: number },
): RawImage {
  const ev = opts.exposure ?? 0;
  const contrast = opts.contrast ?? 1;
  const sat = opts.saturation ?? 1;
  if (ev === 0 && contrast === 1 && sat === 1) return img;

  const curve = new Uint8Array(256);
  const gain = 2 ** ev;
  for (let i = 0; i < 256; i++) {
    let s = i / 255;
    if (ev !== 0) s = linearToSrgb(clamp(srgbToLinear(s) * gain, 0, 1));
    if (contrast !== 1) s = 0.5 + (s - 0.5) * contrast;
    curve[i] = Math.round(clamp(s, 0, 1) * 255);
  }

  const out = Buffer.from(img.data);
  for (let p = 0; p < out.length; p += 4) {
    if (out[p + 3] === 0) continue;
    let r = curve[out[p]!]!;
    let g = curve[out[p + 1]!]!;
    let b = curve[out[p + 2]!]!;
    if (sat !== 1) {
      const l = luma8(r, g, b);
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
    }
    out[p] = Math.round(clamp(r, 0, 255));
    out[p + 1] = Math.round(clamp(g, 0, 255));
    out[p + 2] = Math.round(clamp(b, 0, 255));
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}
