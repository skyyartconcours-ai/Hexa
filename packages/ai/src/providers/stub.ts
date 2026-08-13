/**
 * Deterministic stub provider.
 *
 * Exists so tests and CI can exercise the registry, the cache and the guard
 * without invoking the procedural painter (which is comparatively slow) or the
 * network (which is forbidden in tests). Output is a plain two-stop gradient:
 * valid, non-blank, byte-identical for a given seed and size, and instantly
 * recognisable as a stub when it leaks into a render by mistake.
 */

import sharp from 'sharp';
import { createRng, hashString, mix, HexaError } from '@hexa/core';
import type {
  BackplateRequest,
  GeneratedImage,
  ImageProvider,
  ProviderCapabilities,
} from '../types.js';
import { assertNoPersonGeneration } from '../guard.js';

export class StubProvider implements ImageProvider {
  readonly id = 'stub';
  /** Painted from code — never cached; see ImageProvider.local. */
  readonly local = true;

  readonly capabilities: ProviderCapabilities = {
    backplate: true,
    identityGuidedEdit: false,
    inpaint: false,
    upscale: false,
    maxSize: { width: 8192, height: 8192 },
  };

  isConfigured(): boolean {
    return true;
  }

  async generateBackplate(req: BackplateRequest): Promise<GeneratedImage> {
    // Even the test double refuses person prompts: a stub that is more
    // permissive than production is a stub that hides a bug.
    assertNoPersonGeneration(req.prompt ?? '');
    const width = Math.max(1, Math.round(req.width));
    const height = Math.max(1, Math.round(req.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new HexaError('INVALID_REQUEST', 'Stub provider requires finite width and height.');
    }

    const seed = Number.isFinite(req.seed) ? (req.seed as number) : hashString(req.prompt ?? '');
    const rng = createRng(seed >>> 0);
    const palette = (req.palette ?? []).filter((c) => typeof c === 'string' && c.trim() !== '');
    const from = palette[0] ?? '#101828';
    const to = palette[1] ?? mix(from, '#F2F4F7', 0.55);
    const angle = rng.int(0, 3);

    const [x1, y1, x2, y2] = angle === 0 ? [0, 0, 1, 0] : angle === 1 ? [0, 0, 0, 1] : angle === 2 ? [0, 0, 1, 1] : [1, 0, 0, 1];

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs>` +
      `<rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;

    const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

    return {
      buffer,
      width,
      height,
      provider: 'stub',
      model: 'stub/gradient',
      seed: seed >>> 0,
      cost: 0,
      promptUsed: req.prompt ?? '',
    };
  }
}

export const stubProvider = new StubProvider();
