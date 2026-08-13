/**
 * Fixture helpers for this package's own tests.
 *
 * Not exported from the barrel and not part of the public API: it exists so the
 * test suite can synthesise real image files (with real, predictable pixel
 * statistics) instead of shipping photographs it would then have to licence.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { AssetProvenance } from '@hexa/core';

export type Pattern = 'checker' | 'flat' | 'waves' | 'waves-alt';

export interface TestImageOptions {
  width?: number;
  height?: number;
  pattern?: Pattern;
  /** Constant luminance for the 'flat' pattern, 0–255. */
  level?: number;
  /** Gaussian blur sigma applied after the pattern — the "soft photo" knob. */
  blur?: number;
  /** Output format; jpeg exercises the lossy re-encode path. */
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  /** Scale the whole image after generation, for near-duplicate fixtures. */
  scale?: number;
}

/** Procedural greyscale-ish pixel data with known sharpness/contrast behaviour. */
function pixelData(width: number, height: number, pattern: Pattern, level: number): Buffer {
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r: number;
      let g: number;
      let b: number;
      switch (pattern) {
        case 'checker': {
          const on = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
          r = g = b = on ? 245 : 10;
          break;
        }
        case 'waves': {
          r = 128 + 100 * Math.sin(x / 23) + 20 * Math.cos(y / 9);
          g = 128 + 80 * Math.cos(y / 17);
          b = 128 + 60 * Math.sin((x + y) / 31);
          break;
        }
        case 'waves-alt': {
          r = 128 + 90 * Math.cos(y / 7);
          g = 128 + 70 * Math.sin(x / 41) + 40 * Math.cos(x / 5);
          b = 128 + 100 * Math.sin((x - y) / 13);
          break;
        }
        default:
          r = g = b = level;
      }
      const i = (y * width + x) * 3;
      buf[i] = clamp(r);
      buf[i + 1] = clamp(g);
      buf[i + 2] = clamp(b);
    }
  }
  return buf;
}

const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** Write a synthetic image to `file` and return its path. */
export async function writeTestImage(file: string, opts: TestImageOptions = {}): Promise<string> {
  const width = opts.width ?? 320;
  const height = opts.height ?? 240;
  const raw = pixelData(width, height, opts.pattern ?? 'waves', opts.level ?? 128);

  let pipeline = sharp(raw, { raw: { width, height, channels: 3 } });
  if (opts.blur) pipeline = pipeline.blur(opts.blur);
  if (opts.scale && opts.scale !== 1) {
    pipeline = pipeline.resize(Math.max(1, Math.round(width * opts.scale)), Math.max(1, Math.round(height * opts.scale)));
  }
  const format = opts.format ?? 'png';
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: opts.quality ?? 80 });
  else if (format === 'webp') pipeline = pipeline.webp({ quality: opts.quality ?? 80 });
  else pipeline = pipeline.png();

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, await pipeline.toBuffer());
  return file;
}

/** A throwaway directory under the OS temp dir. */
export async function tempDir(prefix = 'hexa-assets-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Cleared press-kit provenance — the common "good" case in tests. */
export function testProvenance(over: Partial<AssetProvenance> = {}): AssetProvenance {
  return {
    source: 'LCK Official Media Kit 2025 Spring',
    license: 'press-kit',
    photographer: 'Test Photographer',
    addedAt: '2025-01-01T00:00:00Z',
    cleared: true,
    ...over,
  };
}

/** A logger that records instead of printing — keeps test output clean. */
export function recordingLogger() {
  const lines: { level: string; msg: string }[] = [];
  const make = (): any => ({
    level: 'debug',
    error: (msg: string) => lines.push({ level: 'error', msg }),
    warn: (msg: string) => lines.push({ level: 'warn', msg }),
    info: (msg: string) => lines.push({ level: 'info', msg }),
    debug: (msg: string) => lines.push({ level: 'debug', msg }),
    trace: (msg: string) => lines.push({ level: 'trace', msg }),
    stage: async <T>(_n: string, fn: () => Promise<T>) => fn(),
    child: () => make(),
  });
  return { logger: make(), lines };
}
