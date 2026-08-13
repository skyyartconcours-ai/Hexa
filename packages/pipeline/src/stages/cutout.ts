/**
 * Stage 3 — cutout.
 *
 * Produce the alpha-matted subject that gets composited. This is the step the
 * whole approach rests on: professional thumbnail artists cut a real photograph
 * out of its background and build a scene around it, and this is that cut.
 *
 * It is also the slowest step by an order of magnitude, and perfectly
 * deterministic, so results are memoised on disk keyed by asset + options +
 * source fingerprint.
 *
 * The fallback ladder, in order, with a warning at each step down:
 *   1. cache        — a previous run already did this work
 *   2. vision       — matted cutout with refined hair edges (the good one)
 *   3. cutoutPath   — a cutout the library already had
 *   4. raw image    — no alpha at all; composites as a rectangle
 *
 * Step 4 looks bad, and it is meant to: it is visible degradation rather than a
 * failed render, and the warning says exactly which service to start.
 */

import type { ReferenceAsset } from '@hexa/core';
import { HexaError } from '@hexa/core';
import type { Logger } from '@hexa/core';
import { assetPath, cutoutPath } from '../adapters/assets.js';
import type { AssetLibrary, SegmentOptions, VisionClient } from '../adapters/contracts.js';
import { segment } from '../adapters/vision.js';
import { readCache, stampFile, writeCache } from '../cache.js';
import { imageSize, readFileSafe } from '../image.js';

export type CutoutSource = 'placeholder' | 'cache' | 'vision' | 'library-cutout' | 'raw';

export interface CutoutOptions {
  library: AssetLibrary;
  vision: VisionClient;
  asset: ReferenceAsset;
  /** Bytes for a synthesised placeholder, which has no path on disk. */
  placeholderBuffer?: Buffer;
  cacheDir?: string;
  logger: Logger;
  /** Crop to head-and-shoulders — what versus layouts want. */
  bust?: boolean;
  /** Alpha matting on the edges. Slower, dramatically better hair. */
  refine?: boolean;
  /** Skip the cache for this call (a forced re-cut). */
  noCache?: boolean;
}

export interface CutoutResult {
  buffer: Buffer;
  source: CutoutSource;
  size?: { width: number; height: number };
  /** True when the bytes carry a real alpha channel. */
  matted: boolean;
  /**
   * True when the cutout is the same framing as the original photograph, so
   * `asset.metrics.faceBox` coordinates still apply to it. A bust crop breaks
   * that correspondence, which is why the detect stage cannot assume it.
   */
  sameFramingAsOriginal: boolean;
  warnings: string[];
}

export async function cutoutSubject(opts: CutoutOptions): Promise<CutoutResult> {
  const warnings: string[] = [];
  const segOpts: SegmentOptions = { bust: opts.bust ?? true, refine: opts.refine ?? true };

  // 0. Placeholders are already RGBA and already framed.
  if (opts.placeholderBuffer) {
    return {
      buffer: opts.placeholderBuffer,
      source: 'placeholder',
      size: await imageSize(opts.placeholderBuffer),
      matted: true,
      sameFramingAsOriginal: true,
      warnings,
    };
  }

  const sourcePath = resolveSourcePath(opts.library, opts.asset);
  if (!sourcePath) {
    throw new HexaError('ASSET_NOT_FOUND', `Asset ${opts.asset.id} has no readable source file`, {
      hint: 'The manifest references a file that is not in the library. Run `hexa assets prune` to drop dead entries, then re-ingest.',
      details: { assetId: opts.asset.id, path: opts.asset.path },
    });
  }

  const key = {
    kind: 'cutout',
    id: opts.asset.id,
    options: { ...segOpts },
    stamp: await stampFile(sourcePath),
  };

  // 1. Cache.
  if (!opts.noCache) {
    const hit = await readCache(opts.cacheDir, key);
    if (hit) {
      opts.logger.debug('cutout cache hit', { asset: opts.asset.id });
      return {
        buffer: hit,
        source: 'cache',
        size: await imageSize(hit),
        matted: true,
        sameFramingAsOriginal: !segOpts.bust,
        warnings,
      };
    }
  }

  // 2. Vision sidecar — the good path.
  const matted = await segment(opts.vision, sourcePath, segOpts);
  if (matted && matted.length > 0) {
    await writeCache(opts.cacheDir, key, matted);
    opts.logger.debug('segmented subject', { asset: opts.asset.id, bytes: matted.length });
    return {
      buffer: matted,
      source: 'vision',
      size: await imageSize(matted),
      matted: true,
      sameFramingAsOriginal: !segOpts.bust,
      warnings,
    };
  }

  // 3. A cutout the library already holds.
  const preCut = cutoutPath(opts.library, opts.asset);
  if (preCut) {
    const bytes = await readFileSafe(preCut);
    if (bytes) {
      warnings.push(
        `Vision sidecar unavailable — used the stored cutout for ${opts.asset.id} instead of a fresh matte. Start it with: services/vision/run.sh`,
      );
      return {
        buffer: bytes,
        source: 'library-cutout',
        size: await imageSize(bytes),
        matted: true,
        sameFramingAsOriginal: true,
        warnings,
      };
    }
  }

  // 4. The photograph, background and all.
  const raw = await readFileSafe(sourcePath);
  if (!raw) {
    throw new HexaError('ASSET_NOT_FOUND', `Cannot read ${sourcePath}`, {
      hint: 'Check the file exists and is readable, then re-run. `hexa assets prune` removes manifest entries whose files are gone.',
      details: { assetId: opts.asset.id, path: sourcePath },
    });
  }
  warnings.push(
    `No cutout available for ${opts.asset.id} — compositing the full photograph, background included. ` +
      `Start the vision sidecar (services/vision/run.sh) for a matted subject.`,
  );
  return {
    buffer: raw,
    source: 'raw',
    size: await imageSize(raw),
    matted: false,
    sameFramingAsOriginal: true,
    warnings,
  };
}

function resolveSourcePath(library: AssetLibrary, asset: ReferenceAsset): string | undefined {
  try {
    return assetPath(library, asset);
  } catch {
    return undefined;
  }
}
