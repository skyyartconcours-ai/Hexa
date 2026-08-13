/**
 * Shared plumbing for the procedural FX generators.
 *
 * Two authoring styles are used deliberately:
 *   * **vector** (SVG rendered by librsvg through sharp) wherever the shape is
 *     geometric — rays, hex cells, glass shards, trusses. Vector gives clean
 *     anti-aliased edges at any resolution for a fraction of the code.
 *   * **raster** (raw buffers written from seeded value noise) wherever the
 *     content *is* noise — fog, smoke, grain-like fields. No amount of SVG
 *     makes convincing fractal cloud.
 * Both are deterministic: same seed, same bytes.
 */

import sharp from 'sharp';
import { parseHex, clamp } from '@hexa/core';
import { type RawImage, toRaw, rawToSharp } from '../raw.js';

export interface Size {
  width: number;
  height: number;
}

/** Short float formatter — keeps generated markup small and diffable. */
export function f(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function num(params: Record<string, unknown>, key: string, def: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

export function str(params: Record<string, unknown>, key: string, def: string): string {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : def;
}

export function bool(params: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : def;
}

export function colors(params: Record<string, unknown>, key: string, def: string[]): string[] {
  const v = params[key];
  if (Array.isArray(v)) {
    const out = v.filter((c): c is string => typeof c === 'string' && c.length > 0);
    if (out.length) return out;
  }
  const single = params[key.replace(/s$/, '')];
  if (typeof single === 'string' && single.length > 0) return [single];
  return def;
}

export function vec2(params: Record<string, unknown>, key: string, def: [number, number]): [number, number] {
  const v = params[key];
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    return [v[0], v[1]];
  }
  return def;
}

/** `rgba()` string from a hex plus an explicit alpha — SVG-safe everywhere. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b, a } = parseHex(hex);
  return `rgba(${r},${g},${b},${clamp(alpha * a, 0, 1).toFixed(3)})`;
}

export function svgDoc(width: number, height: number, body: string, defs = ''): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
  );
}

/** Rasterise SVG markup to raw RGBA at its natural size. */
export async function renderSvg(markup: string): Promise<RawImage> {
  return toRaw(Buffer.from(markup));
}

/** Encode a raw image as an RGBA PNG (alpha forced, so every generator agrees). */
export async function toRgbaPng(img: RawImage): Promise<Buffer> {
  return rawToSharp(img).ensureAlpha().png({ compressionLevel: 6 }).toBuffer();
}

/** Additive stack — how light layers actually combine. Runs inside libvips. */
export async function addLayers(width: number, height: number, layers: RawImage[]): Promise<RawImage> {
  let acc = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  const composites = layers.map((l) => ({
    input: l.data,
    raw: { width: l.width, height: l.height, channels: 4 as const },
    top: 0,
    left: 0,
    blend: 'add' as const,
  }));
  if (composites.length) acc = acc.composite(composites);
  const { data, info } = await acc.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Gaussian-blur a raw layer (alpha-correct, see raw.ts header). */
export async function softenLayer(img: RawImage, sigma: number): Promise<RawImage> {
  if (!(sigma >= 0.3)) return img;
  const { data, info } = await rawToSharp(img)
    .blur(sigma)
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
