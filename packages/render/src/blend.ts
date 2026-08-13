/**
 * Blend modes.
 *
 * libvips implements the PDF/SVG separable blend set natively and does its own
 * premultiplication, so the fast path is a straight `composite()` call. The
 * slow path exists because "the compositor silently drew your `color-dodge`
 * layer as `over`" is the kind of bug that costs a template author a day: if a
 * mode is not available it is computed here in raw pixels, and the fallback is
 * always logged.
 */

import sharp from 'sharp';
import type { BlendMode, Logger } from '@hexa/core';
import { clamp } from '@hexa/core';
import { type RawImage, rawToSharp, cropRaw } from './raw.js';
import { timed, timedSync } from './profile.js';

/** Hexa BlendMode → libvips blend nickname. */
const NATIVE: Record<BlendMode, string> = {
  over: 'over',
  add: 'add',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  'color-dodge': 'colour-dodge',
  'color-burn': 'colour-burn',
  lighten: 'lighten',
  darken: 'darken',
  difference: 'difference',
  exclusion: 'exclusion',
};

/** W3C separable blend functions on 0–1 channel values. */
export const BLEND_FUNCS: Record<BlendMode, (b: number, s: number) => number> = {
  over: (_b, s) => s,
  add: (b, s) => Math.min(1, b + s),
  screen: (b, s) => b + s - b * s,
  multiply: (b, s) => b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'hard-light': (b, s) => (s <= 0.5 ? 2 * s * b : 1 - 2 * (1 - s) * (1 - b)),
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    return b + (2 * s - 1) * (d - b);
  },
  'color-dodge': (b, s) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  lighten: (b, s) => Math.max(b, s),
  darken: (b, s) => Math.min(b, s),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
};

const nativeSupport = new Map<string, boolean>();

/** One 1×1 composite per mode, cached — cheaper than guessing at libvips builds. */
async function supportsNative(blend: string): Promise<boolean> {
  const cached = nativeSupport.get(blend);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    const px = Buffer.from([255, 128, 64, 255]);
    await sharp(px, { raw: { width: 1, height: 1, channels: 4 } })
      .composite([{ input: px, raw: { width: 1, height: 1, channels: 4 }, blend: blend as 'over' }])
      .raw()
      .toBuffer();
  } catch {
    ok = false;
  }
  nativeSupport.set(blend, ok);
  return ok;
}

/**
 * Source-over compositing with a separable blend function, per the W3C
 * compositing model:
 *   αo = αs + αb(1 − αs)
 *   Co = (1 − αb)·αs·Cs + αb·αs·B(Cb, Cs) + (1 − αs)·αb·Cb
 * evaluated in premultiplied space and divided back out at the end.
 */
export function manualComposite(base: RawImage, layer: RawImage, left: number, top: number, mode: BlendMode): RawImage {
  const fn = BLEND_FUNCS[mode] ?? BLEND_FUNCS.over;
  const out = Buffer.from(base.data);
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(base.width, left + layer.width);
  const y1 = Math.min(base.height, top + layer.height);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const sp = ((y - top) * layer.width + (x - left)) * 4;
      const as = layer.data[sp + 3]! / 255;
      if (as === 0) continue;
      const bp = (y * base.width + x) * 4;
      const ab = out[bp + 3]! / 255;
      const ao = as + ab * (1 - as);
      if (ao <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const cs = layer.data[sp + c]! / 255;
        const cb = out[bp + c]! / 255;
        const co = (1 - ab) * as * cs + ab * as * fn(cb, cs) + (1 - as) * ab * cb;
        out[bp + c] = Math.round(clamp(co / ao, 0, 1) * 255);
      }
      out[bp + 3] = Math.round(clamp(ao, 0, 1) * 255);
    }
  }
  return { data: out, width: base.width, height: base.height, channels: 4 };
}

/** One layer waiting to be laid onto the accumulator. */
export interface CompositeOp {
  image: RawImage;
  /** Canvas-space position, in render pixels. May be negative — this clips. */
  left: number;
  top: number;
  mode: BlendMode;
}

/** Clip an op to the canvas; null when nothing of it lands on the frame. */
function clipToCanvas(base: RawImage, op: CompositeOp): { image: RawImage; left: number; top: number; mode: BlendMode } | null {
  const x0 = Math.max(0, op.left);
  const y0 = Math.max(0, op.top);
  const x1 = Math.min(base.width, op.left + op.image.width);
  const y1 = Math.min(base.height, op.top + op.image.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const image =
    x0 === op.left && y0 === op.top && x1 === op.left + op.image.width && y1 === op.top + op.image.height
      ? op.image
      : cropRaw(op.image, x0 - op.left, y0 - op.top, x1 - x0, y1 - y0);
  return { image, left: x0, top: y0, mode: op.mode };
}

/**
 * Lay a run of layers onto `base`, in order.
 *
 * libvips takes a *list* of composite operations and applies them in one pass,
 * which is worth having: a per-layer call re-materialises the whole accumulator
 * every time, so a 30-layer frame copies a megapixel of RGBA thirty times for
 * blending that costs a fraction of that. Measured at 1280×720, twenty layers
 * take 430 ms one at a time and 161 ms as one call.
 *
 * The batched result also differs from the sequential one by up to 3/255,
 * because libvips carries the run at working precision instead of rounding to
 * 8 bits between every layer. That is a fidelity *gain*, and it is well under
 * the threshold of visibility; it is noted here because it means a frame
 * composited in one batch is not bit-identical to the same frame composited
 * layer by layer.
 *
 * A mode libvips cannot do breaks the run: everything queued before it goes
 * through libvips, it is computed in raw pixels, and a new run starts.
 */
export async function compositeLayers(base: RawImage, ops: CompositeOp[], logger: Logger): Promise<RawImage> {
  let acc = base;
  let run: { image: RawImage; left: number; top: number; nativeName: string; mode: BlendMode }[] = [];

  const flush = async (): Promise<void> => {
    if (run.length === 0) return;
    const batch = run;
    run = [];
    const label = batch.length === 1 ? `composite:${batch[0]!.mode}` : `composite:batch×${batch.length}`;
    const target = acc;
    const { data, info } = await timed(label, target.width * target.height, () =>
      rawToSharp(target)
        .composite(
          batch.map((op) => ({
            input: op.image.data,
            raw: { width: op.image.width, height: op.image.height, channels: 4 as const },
            left: op.left,
            top: op.top,
            blend: op.nativeName as 'over',
          })),
        )
        .raw({ depth: 'uchar' })
        .toBuffer({ resolveWithObject: true }),
    );
    acc = { data, width: info.width, height: info.height, channels: info.channels };
  };

  for (const raw of ops) {
    const op = clipToCanvas(acc, raw);
    if (!op) continue;

    const nativeName = NATIVE[op.mode];
    if (nativeName && (await supportsNative(nativeName))) {
      run.push({ ...op, nativeName });
      continue;
    }

    await flush();
    if (!nativeName) {
      logger.warn(`blend mode "${op.mode}" is not a known libvips mode — computing it in raw pixels`);
    } else {
      logger.warn(`libvips build does not support blend "${nativeName}" — computing "${op.mode}" in raw pixels`);
    }
    const target = acc;
    acc = timedSync(`composite:manual:${op.mode}`, target.width * target.height, () =>
      manualComposite(target, op.image, op.left, op.top, op.mode),
    );
  }

  await flush();
  return acc;
}

/**
 * Composite `layer` onto `base` at (left, top). Uses libvips where the mode is
 * available, raw pixel math otherwise — and warns, loudly, when it has to.
 */
export async function compositeLayer(
  base: RawImage,
  layer: RawImage,
  left: number,
  top: number,
  mode: BlendMode,
  logger: Logger,
): Promise<RawImage> {
  return compositeLayers(base, [{ image: layer, left, top, mode }], logger);
}
