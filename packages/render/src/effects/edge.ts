/**
 * Edge treatment — the difference between a cutout that sits *in* a scene and
 * one that sits *on* it.
 *
 * Every effect here derives from the subject's alpha channel. None of them
 * touch a pixel whose alpha is zero except `outerGlow`/`dropShadow`, which are
 * explicitly outside-the-silhouette effects. That invariant is what keeps a
 * composite honest: light appearing where there is no subject reads as sticker
 * halo, which is exactly the AI-slop tell we are trying to avoid.
 *
 * Each effect has a `…Raw` core that works on decoded `RawImage`s and a public
 * Buffer wrapper. The compositor chains the raw cores, so a layer with four
 * effects costs one decode and one encode rather than five of each.
 */

import { degToRad, parseHex, clamp } from '@hexa/core';
import {
  type RawImage,
  toRaw,
  encodePng,
  alphaPlane,
  blurRaw,
  erode,
  dilate,
  screen8,
  resizeCover,
  MIN_SIGMA,
} from '../raw.js';

/** Blur a single-channel mask (sharp handles 1-band raw natively). */
async function blurMask(mask: RawImage, sigma: number): Promise<RawImage> {
  if (!(sigma >= MIN_SIGMA)) return mask;
  return blurRaw(mask, sigma);
}

export interface RimLightOptions {
  angle: number;
  width: number;
  color: string;
  intensity: number;
}

/**
 * Directional rim light — the signature effect.
 *
 * The construction, step by step:
 *   1. take the subject's alpha `A`;
 *   2. blur it into `B` — `width` sets the sigma, so a wide rim is a soft rim;
 *   3. shift `B` *away* from the light, i.e. sample it at
 *      `(x + d·cosθ, y − d·sinθ)`, so on the lit side the shifted blur has
 *      already fallen off while `A` is still solid;
 *   4. `band = max(0, A − B_shifted)` — a crescent hugging the lit contour, and
 *      identically zero on the shadow side where both are solid;
 *   5. multiply by `A/255` so the band cannot leak outside the silhouette;
 *   6. tint and *screen* over the subject, because rim light adds photons — it
 *      never darkens what is underneath.
 *
 * Angles are measured counter-clockwise from +x with y pointing up: 0° lights
 * the right edge, 90° the top, 180° the left.
 */
export async function rimLightRaw(img: RawImage, opts: RimLightOptions): Promise<RawImage> {
  const { width: w, height: h } = img;
  const alpha = alphaPlane(img);

  const widthPx = Math.max(1, opts.width);
  const blurred = await blurMask(alpha, Math.max(MIN_SIGMA, widthPx * 0.6));

  const rad = degToRad(opts.angle);
  const dx = Math.round(Math.cos(rad) * widthPx);
  const dy = Math.round(-Math.sin(rad) * widthPx);

  const { r, g, b } = parseHex(opts.color);
  const intensity = clamp(opts.intensity, 0, 4);
  const out = Buffer.from(img.data);

  // `band^1.25` is a fractional power of an *integer* difference of two 8-bit
  // planes, so there are only 256 possible values of it. Tabulating them turns
  // the one `Math.pow` in the hottest loop in the effect stack into a lookup —
  // exact, not approximate, because the input really is an integer.
  const gamma = new Float64Array(256);
  for (let d = 0; d < 256; d++) gamma[d] = (d / 255) ** 1.25 * intensity;

  for (let y = 0; y < h; y++) {
    const rowStart = y * w;
    const sy = y + dy;
    const rowSafe = sy >= 0 && sy < h;
    const srcRow = rowSafe ? sy * w : 0;
    for (let x = 0; x < w; x++) {
      const i = rowStart + x;
      const a = alpha.data[i]!;
      if (a === 0) continue; // hard invariant: never light empty space
      const sx = x + dx;
      const shifted = !rowSafe || sx < 0 || sx >= w ? 0 : blurred.data[srcRow + sx]!;
      const d = a - shifted;
      if (d <= 0) continue;
      // A slight gamma tightens the crescent against the contour instead of
      // letting it wash across the whole lit half.
      const band = gamma[d]! * (a / 255);
      if (band <= 0) continue;
      const k = Math.min(1, band);
      const p = i * 4;
      out[p] = Math.round(screen8(out[p]!, r * k));
      out[p + 1] = Math.round(screen8(out[p + 1]!, g * k));
      out[p + 2] = Math.round(screen8(out[p + 2]!, b * k));
    }
  }

  return { data: out, width: w, height: h, channels: 4 };
}

export async function rimLight(subject: Buffer, opts: RimLightOptions): Promise<Buffer> {
  return encodePng(await rimLightRaw(await toRaw(subject), opts));
}

/**
 * Light wrap — the most underrated realism trick in compositing.
 *
 * Real light bends around a subject's silhouette, so the backdrop's colour
 * spills a few pixels onto the subject's edge. Without it a cutout keeps a
 * razor-sharp boundary against its background and reads as pasted no matter how
 * good the grade is.
 *
 *   1. heavily blur the background plate (`radius` sigma) — that blur *is* the
 *      spill, a cheap stand-in for light scattering around the edge;
 *   2. build a band that lives strictly inside the alpha, `A − erode(A, r)`,
 *      and soften it;
 *   3. modulate the blurred background by that band and `intensity`;
 *   4. screen the result onto the subject.
 */
export async function lightWrapRaw(
  img: RawImage,
  backdrop: RawImage,
  opts: { radius: number; intensity: number },
): Promise<RawImage> {
  const { width: w, height: h } = img;
  const radius = Math.max(1, opts.radius);
  const bgBlur = await blurRaw(backdrop, Math.max(MIN_SIGMA, radius * 1.6));

  const alpha = alphaPlane(img);
  const inner = erode(alpha, Math.max(1, Math.round(radius)));
  const bandRaw = Buffer.allocUnsafe(w * h);
  for (let i = 0; i < bandRaw.length; i++) bandRaw[i] = Math.max(0, alpha.data[i]! - inner.data[i]!);
  const band = await blurMask(
    { data: bandRaw, width: w, height: h, channels: 1 },
    Math.max(MIN_SIGMA, radius * 0.5),
  );

  const intensity = clamp(opts.intensity, 0, 2);
  const out = Buffer.from(img.data);
  for (let i = 0; i < w * h; i++) {
    const a = alpha.data[i]!;
    if (a === 0) continue;
    const k = (band.data[i]! / 255) * (a / 255) * intensity;
    if (k <= 0.002) continue;
    const p = i * 4;
    out[p] = Math.round(screen8(out[p]!, bgBlur.data[p]! * k));
    out[p + 1] = Math.round(screen8(out[p + 1]!, bgBlur.data[p + 1]! * k));
    out[p + 2] = Math.round(screen8(out[p + 2]!, bgBlur.data[p + 2]! * k));
  }
  return { data: out, width: w, height: h, channels: 4 };
}

export async function lightWrap(
  subject: Buffer,
  background: Buffer,
  opts: { radius: number; intensity: number },
): Promise<Buffer> {
  const img = await toRaw(subject);
  let bg = await toRaw(background);
  if (bg.width !== img.width || bg.height !== img.height) bg = await resizeCover(background, img.width, img.height);
  return encodePng(await lightWrapRaw(img, bg, opts));
}

/**
 * Porter-Duff "subject over backing", where the backing is a coloured mask.
 *
 * The backing arrives as a single-channel plane plus a 256-entry curve rather
 * than as a per-pixel callback: every caller's coverage is some fixed function
 * of one 8-bit value, so the curve is exact, and a plane lookup replaces an
 * indirect megamorphic call (three call sites) per pixel — along with, in the
 * drop shadow's case, an integer divide and modulo per pixel to recover x and y.
 */
function overColouredMask(
  img: RawImage,
  plane: Buffer,
  curve: Float64Array,
  colour: { r: number; g: number; b: number },
): RawImage {
  const out = Buffer.allocUnsafe(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const p = i * 4;
    const back = curve[plane[i]!]!;
    const sAlpha = img.data[p + 3]! / 255;
    const outA = sAlpha + back * (1 - sAlpha);
    if (outA <= 0) {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
      continue;
    }
    const blend = (sub: number, bg: number): number => Math.round((sub * sAlpha + bg * back * (1 - sAlpha)) / outA);
    out[p] = blend(img.data[p]!, colour.r);
    out[p + 1] = blend(img.data[p + 1]!, colour.g);
    out[p + 2] = blend(img.data[p + 2]!, colour.b);
    out[p + 3] = Math.round(outA * 255);
  }
  return { data: out, width: img.width, height: img.height, channels: 4 };
}

/**
 * Outer glow. The silhouette's alpha is blurred, curved so the falloff stays
 * hot near the edge and soft in the tail, tinted, and the subject is laid back
 * on top. Canvas size is preserved — `renderLayer` pads the layer beforehand so
 * the halo has room to breathe.
 */
export async function outerGlowRaw(
  img: RawImage,
  opts: { radius: number; color: string; intensity: number },
): Promise<RawImage> {
  const alpha = alphaPlane(img);
  const radius = Math.max(1, opts.radius);
  const spread = await blurMask(alpha, Math.max(MIN_SIGMA, radius * 0.6));
  const colour = parseHex(opts.color);
  const intensity = clamp(opts.intensity, 0, 4);
  // 1−(1−t)² keeps the near-edge glow hot while the tail stays soft.
  const curve = new Float64Array(256);
  for (let v = 0; v < 256; v++) curve[v] = clamp((1 - (1 - v / 255) ** 2) * intensity, 0, 1);
  return overColouredMask(img, spread.data, curve, colour);
}

export async function outerGlow(
  subject: Buffer,
  opts: { radius: number; color: string; intensity: number },
): Promise<Buffer> {
  return encodePng(await outerGlowRaw(await toRaw(subject), opts));
}

/** Offset, blurred, tinted silhouette laid *under* the subject. */
export async function dropShadowRaw(
  img: RawImage,
  opts: { dx: number; dy: number; blur: number; color: string; opacity: number },
): Promise<RawImage> {
  const { width: w, height: h } = img;
  const alpha = alphaPlane(img);
  const soft = await blurMask(alpha, Math.max(MIN_SIGMA, Math.max(0, opts.blur) * 0.6));
  const colour = parseHex(opts.color);
  const opacity = clamp(opts.opacity, 0, 1);
  const dx = Math.round(opts.dx);
  const dy = Math.round(opts.dy);

  // Offset the silhouette once, by copying whole rows, instead of recovering
  // (x, y) from the linear index for every pixel.
  const shifted = Buffer.alloc(w * h, 0);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    const from = sy * w + Math.max(0, -dx);
    const to = y * w + Math.max(0, dx);
    const len = w - Math.abs(dx);
    if (len > 0) soft.data.copy(shifted, to, from, from + len);
  }
  const curve = new Float64Array(256);
  for (let v = 0; v < 256; v++) curve[v] = (v / 255) * opacity;

  return overColouredMask(img, shifted, curve, colour);
}

export async function dropShadow(
  subject: Buffer,
  opts: { dx: number; dy: number; blur: number; color: string; opacity: number },
): Promise<Buffer> {
  return encodePng(await dropShadowRaw(await toRaw(subject), opts));
}

/**
 * Hard outline. A true morphological dilation of the alpha gives a stroke of
 * exactly `width` px everywhere, including inside concave corners — a
 * blur-and-threshold approximation thins out there.
 */
export async function strokeAlphaRaw(img: RawImage, opts: { width: number; color: string }): Promise<RawImage> {
  const width = Math.max(1, Math.round(opts.width));
  const grown = dilate(alphaPlane(img), width);
  // A sub-pixel feather stops the outline crawling with aliasing.
  const soft = await blurMask(grown, MIN_SIGMA * 2);
  const colour = parseHex(opts.color);
  const curve = new Float64Array(256);
  for (let v = 0; v < 256; v++) curve[v] = v / 255;
  return overColouredMask(img, soft.data, curve, colour);
}

export async function strokeAlpha(subject: Buffer, opts: { width: number; color: string }): Promise<Buffer> {
  return encodePng(await strokeAlphaRaw(await toRaw(subject), opts));
}
