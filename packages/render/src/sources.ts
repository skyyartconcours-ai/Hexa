/**
 * Layer source resolution: `LayerSource` → an RGBA raster of exactly the size
 * the compositor asked for.
 *
 * Fit policy for bitmap sources: images that carry an alpha channel are treated
 * as cutouts and fitted with `contain` — cropping a player's arm off to fill a
 * slot is never the right answer. Images without alpha are photographic plates
 * and are fitted with `cover`, because a background that does not reach the
 * edges of its rect is always wrong.
 */

import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import {
  HexaError,
  hashString,
  parseHex,
  clamp,
  degToRad,
  type Layer,
  type LayerSource,
} from '@hexa/core';
import type { RenderContext } from './types.js';
import { type RawImage, toRaw, solidRaw } from './raw.js';
import { resolveGenerator, generatorIds } from './generators/index.js';
import { noiseFieldRaw } from './generators/raster.js';
import { f, svgDoc, rawCoreFor } from './generators/util.js';
import { timed } from './profile.js';

function fail(layer: Layer, message: string, hint?: string, cause?: unknown): never {
  throw new HexaError('RENDER_FAILED', `layer "${layer.id}": ${message}`, {
    hint,
    details: { layerId: layer.id, source: layer.source.type, label: layer.label },
    cause,
  });
}

/** Deterministic per-layer stream: plan seed folded with the layer's identity. */
export function layerSeed(ctx: RenderContext, layer: Layer): number {
  return (ctx.seed ^ hashString(layer.id)) >>> 0;
}

function stopsMarkup(stops: { offset: number; color: string }[]): string {
  const list = stops.length ? stops : [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF' }];
  return list
    .map((s) => {
      const { r, g, b, a } = parseHex(s.color);
      return (
        `<stop offset="${clamp(s.offset, 0, 1).toFixed(4)}" stop-color="rgb(${r},${g},${b})" ` +
        `stop-opacity="${a.toFixed(3)}"/>`
      );
    })
    .join('');
}

/** Linear gradient across the rect; `angle` is CCW from +x with y up. */
export function gradientSvg(width: number, height: number, stops: { offset: number; color: string }[], angle: number): string {
  const a = degToRad(angle);
  const dx = Math.cos(a) * 0.5;
  const dy = -Math.sin(a) * 0.5;
  const defs =
    `<linearGradient id="g" x1="${f(0.5 - dx)}" y1="${f(0.5 - dy)}" x2="${f(0.5 + dx)}" y2="${f(0.5 + dy)}">` +
    `${stopsMarkup(stops)}</linearGradient>`;
  return svgDoc(width, height, `<rect width="${width}" height="${height}" fill="url(#g)"/>`, defs);
}

export function radialSvg(
  width: number,
  height: number,
  stops: { offset: number; color: string }[],
  center: [number, number],
  radius: number,
): string {
  const cx = center[0] * width;
  const cy = center[1] * height;
  const r = Math.max(1, radius * Math.max(width, height));
  const defs =
    `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}">` +
    `${stopsMarkup(stops)}</radialGradient>`;
  return svgDoc(width, height, `<rect width="${width}" height="${height}" fill="url(#g)"/>`, defs);
}

/**
 * Rasterise a gradient at the resolution the gradient actually needs.
 *
 * A gradient carries no detail except at its stops: between two stops it is, by
 * definition, an interpolation, and upsampling an interpolation reproduces it.
 * The finest feature is therefore the narrowest gap between consecutive stops,
 * measured across the ramp — so the raster only has to be fine enough to put a
 * handful of samples inside that gap. A two-stop backdrop wash across 1280 px
 * needs nothing like 1280 px of librsvg, and librsvg costs what the surface
 * costs: full-canvas gradient layers were ~15% of the layer stage.
 *
 * `SAMPLES_ACROSS_STOP` keeps eight samples inside the narrowest band, and the
 * factor is capped at 4 (a sixteenth of the pixels) — past that the resample
 * costs more than the rasterise it saves. A gradient with tightly-spaced stops
 * decimates less, and one with adjacent stops (a hard edge) not at all.
 */
const SAMPLES_ACROSS_STOP = 8;
const MAX_GRADIENT_DECIMATION = 4;

function gradientDecimation(stops: { offset: number }[], extentPx: number): number {
  if (stops.length > 1) {
    const offsets = stops.map((s) => clamp(s.offset, 0, 1)).sort((a, b) => a - b);
    let narrowest = 1;
    for (let i = 1; i < offsets.length; i++) narrowest = Math.min(narrowest, offsets[i]! - offsets[i - 1]!);
    if (!(narrowest > 0)) return 1; // coincident stops: a hard edge, keep it hard
    const finest = narrowest * extentPx;
    return Math.max(1, Math.min(MAX_GRADIENT_DECIMATION, Math.floor(finest / SAMPLES_ACROSS_STOP)));
  }
  return MAX_GRADIENT_DECIMATION;
}

/** Rasterise `markup(w, h)` decimated by `k`, then resample up to w×h. */
async function rasteriseSmooth(
  markup: (w: number, h: number) => string,
  width: number,
  height: number,
  k: number,
): Promise<RawImage> {
  if (k <= 1) return toRaw(Buffer.from(markup(width, height)));
  const sw = Math.max(2, Math.round(width / k));
  const sh = Math.max(2, Math.round(height / k));
  const { data, info } = await sharp(Buffer.from(markup(sw, sh)))
    .ensureAlpha()
    // `cubic` rather than lanczos: a lanczos upsample overshoots at a stop and
    // a gradient has nothing to gain from the extra sharpness.
    .resize(width, height, { kernel: 'cubic', fit: 'fill' })
    .toColourspace('srgb')
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Decode a bitmap and fit it to the slot (see fit policy in the file header). */
async function fitBitmap(input: Buffer | string, width: number, height: number): Promise<RawImage> {
  return timed('src:bitmap', width * height, () => fitBitmapCore(input, width, height));
}

async function fitBitmapCore(input: Buffer | string, width: number, height: number): Promise<RawImage> {
  const pipeline = sharp(input, { failOn: 'none' });
  const meta = await pipeline.metadata();
  const fit = meta.hasAlpha ? 'contain' : 'cover';
  const { data, info } = await sharp(input, { failOn: 'none' })
    .toColourspace('srgb')
    .ensureAlpha()
    .resize(width, height, {
      fit,
      position: 'centre',
      kernel: 'lanczos3',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

export async function resolveSource(
  layer: Layer,
  size: { width: number; height: number },
  ctx: RenderContext,
): Promise<RawImage> {
  const { width, height } = size;
  const src: LayerSource = layer.source;

  switch (src.type) {
    case 'file': {
      try {
        await fs.access(src.path);
      } catch (cause) {
        // A raw ENOENT tells a template author nothing about *which* slot broke.
        fail(layer, `source image not found: ${src.path}`, 'Check the asset path in the plan, or pass it via opts.buffers.', cause);
      }
      try {
        return await fitBitmap(src.path, width, height);
      } catch (cause) {
        fail(layer, `could not decode image: ${src.path}`, 'Is the file a supported image format?', cause);
      }
      break;
    }

    case 'buffer': {
      const buf = ctx.buffers[src.key];
      if (!buf) {
        const known = Object.keys(ctx.buffers);
        fail(
          layer,
          `no buffer supplied for key "${src.key}"`,
          known.length ? `Available keys: ${known.join(', ')}` : 'Pass assets via renderPlan(plan, { buffers }).',
        );
      }
      try {
        return await fitBitmap(buf, width, height);
      } catch (cause) {
        fail(layer, `could not decode buffer "${src.key}"`, undefined, cause);
      }
      break;
    }

    case 'svg': {
      try {
        const { data, info } = await timed('src:svg', width * height, () =>
          sharp(Buffer.from(src.markup))
          .ensureAlpha()
          .resize(width, height, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            kernel: 'lanczos3',
          })
          .raw({ depth: 'uchar' })
          .toBuffer({ resolveWithObject: true }),
        );
        return { data, width: info.width, height: info.height, channels: info.channels };
      } catch (cause) {
        fail(layer, 'SVG markup could not be rasterised', 'librsvg rejected the markup — check for unclosed tags.', cause);
      }
      break;
    }

    case 'solid':
      return solidRaw(width, height, src.color);

    case 'gradient': {
      // The ramp runs along the gradient axis, so that projection is its extent.
      const a = degToRad(src.angle);
      const extent = Math.abs(Math.cos(a)) * width + Math.abs(Math.sin(a)) * height;
      const k = gradientDecimation(src.stops, extent);
      return timed('src:gradient', width * height, () =>
        rasteriseSmooth((w, h) => gradientSvg(w, h, src.stops, src.angle), width, height, k),
      );
    }

    case 'radial': {
      const extent = Math.max(1, src.radius * Math.max(width, height));
      const k = gradientDecimation(src.stops, extent);
      return timed('src:radial', width * height, () =>
        rasteriseSmooth((w, h) => radialSvg(w, h, src.stops, src.center, src.radius), width, height, k),
      );
    }

    case 'noise':
      return noiseFieldRaw(width, height, (src.seed ^ ctx.seed) >>> 0, src.scale, Math.max(1, Math.round(src.octaves)));

    case 'generated': {
      const gen = resolveGenerator(src.generatorId);
      if (!gen) {
        fail(
          layer,
          `unknown generator "${src.generatorId}"`,
          `Known generators: ${generatorIds().join(', ')}`,
        );
      }
      try {
        // Built-in generators publish a raw core behind the PNG contract (see
        // `fromRawCore`), so the compositor can take the pixels straight out
        // instead of encoding a PNG only to decode it again on the next line.
        const core = rawCoreFor(gen);
        if (core) {
          return await timed(`gen:${src.generatorId}`, width * height, () =>
            core(src.params ?? {}, { width, height }, layerSeed(ctx, layer)),
          );
        }
        const png = await timed(`gen:${src.generatorId}`, width * height, () =>
          gen(src.params ?? {}, { width, height }, layerSeed(ctx, layer)),
        );
        return await timed('gen:decode', width * height, () => toRaw(png));
      } catch (cause) {
        if (cause instanceof HexaError) throw cause;
        fail(layer, `generator "${src.generatorId}" failed`, undefined, cause);
      }
      break;
    }

    default: {
      const exhaustive: never = src;
      fail(layer, `unsupported source type: ${JSON.stringify(exhaustive)}`);
    }
  }

  // Unreachable: every branch either returns or throws.
  fail(layer, 'source could not be resolved');
}
