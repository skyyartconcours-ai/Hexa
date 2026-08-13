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
import { f, svgDoc } from './generators/util.js';
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

    case 'gradient':
      return timed('src:gradient', width * height, () =>
        toRaw(Buffer.from(gradientSvg(width, height, src.stops, src.angle))),
      );

    case 'radial':
      return timed('src:radial', width * height, () =>
        toRaw(Buffer.from(radialSvg(width, height, src.stops, src.center, src.radius))),
      );

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
