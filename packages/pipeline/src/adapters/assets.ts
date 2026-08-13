/**
 * @hexa/assets adapter — the licensed reference library.
 *
 * The load-bearing behaviour here is that **an empty library is not an error**.
 * A new user has no press photos yet; if that stops the render they never get to
 * see what the tool does, and never learn what photographs to go and license. So
 * a miss degrades to a schematic placeholder and a warning, never an exception.
 */

import type { AssetKind, AssetQuery, ReferenceAsset } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule } from './load.js';
import {
  ASSETS_EXPORTS,
  type AssetLibrary,
  type AssetsModule,
  type CoverageReport,
  type IngestDefaults,
  type IngestResult,
  type LibraryStats,
  type PlaceholderOptions,
} from './contracts.js';

const SPEC = '@hexa/assets';
const HINT = 'The asset library package is not built. Run: pnpm --filter @hexa/assets build';

async function mod(): Promise<AssetsModule> {
  return loadModule<AssetsModule>(SPEC, { needs: ASSETS_EXPORTS, hint: HINT });
}

/** Open a library rooted at `root`, creating an empty manifest if there is none. */
export async function openLibrary(root: string, opts: { create?: boolean } = { create: true }): Promise<AssetLibrary> {
  const m = await mod();
  return m.AssetLibrary.open(root, opts);
}

/** Best asset for a slot, or `undefined` when the library has nothing suitable. */
export async function bestAsset(library: AssetLibrary, query: AssetQuery): Promise<ReferenceAsset | undefined> {
  return library.best(query);
}

/**
 * Candidates for a query, best first.
 *
 * The pipeline needs the *ranked* list, not just the winner: when the identity
 * gate rejects a render, the retry reaches for the next-best photograph.
 */
export async function rankedAssets(library: AssetLibrary, query: AssetQuery): Promise<ReferenceAsset[]> {
  const m = await mod();
  const found = library.find(query) ?? [];
  try {
    return m.rankAssets(found, query) ?? [];
  } catch {
    // A ranker that dislikes this query shape must not lose us the candidates.
    return [...found];
  }
}

export async function scoreAsset(asset: ReferenceAsset, query?: AssetQuery): Promise<number> {
  return (await mod()).scoreAsset(asset, query);
}

/** Absolute on-disk path for an asset, with library-root containment enforced. */
export function assetPath(library: AssetLibrary, asset: ReferenceAsset | string): string {
  return library.resolvePath(asset, 'source');
}

/**
 * Absolute path of an asset's pre-computed cutout, when it has one. Returns
 * `undefined` rather than throwing — a broken cutout reference should fall
 * through to segmenting the original, not fail the render.
 */
export function cutoutPath(library: AssetLibrary, asset: ReferenceAsset): string | undefined {
  if (!asset.cutoutPath) return undefined;
  try {
    return library.resolvePath(asset, 'cutout');
  } catch {
    return undefined;
  }
}

/**
 * A schematic stand-in silhouette. Deliberately *not* a synthesised person:
 * placeholders never depict a fake human face (docs/IDENTITY.md).
 */
export async function generatePlaceholder(opts: PlaceholderOptions): Promise<Buffer> {
  const m = await mod();
  const out = await m.generatePlaceholder(opts);
  if (!out?.length) {
    throw new HexaError('ASSET_NOT_FOUND', 'Placeholder generation returned no image data', {
      hint: 'generatePlaceholder() in @hexa/assets returned an unexpected shape — see packages/pipeline/src/adapters/assets.ts',
    });
  }
  return out;
}

/** The tag every synthetic asset carries, so gates can spot one instantly. */
export async function placeholderTag(): Promise<string> {
  try {
    return (await mod()).PLACEHOLDER_TAG ?? 'placeholder';
  } catch {
    return 'placeholder';
  }
}

/** Attribution line for exactly the assets composited into an output. */
export async function creditLine(assets: readonly ReferenceAsset[], opts?: { prefix?: string }): Promise<string> {
  return (await mod()).creditLine([...assets], opts);
}

/** Extra obligations the output inherits from the assets used (ShareAlike, etc). */
export async function licenceObligations(assets: readonly ReferenceAsset[]): Promise<string[]> {
  try {
    return (await mod()).licenceObligations?.([...assets]) ?? [];
  } catch {
    return [];
  }
}

export async function isPublishable(asset: ReferenceAsset): Promise<boolean> {
  return (await mod()).isPublishable(asset);
}

/** Why an asset is not publish-grade — the CLI turns these into instructions. */
export async function publishBlockers(asset: ReferenceAsset): Promise<string[]> {
  try {
    return (await mod()).publishBlockers?.(asset) ?? [];
  } catch {
    return [];
  }
}

export async function libraryStats(library: AssetLibrary): Promise<LibraryStats> {
  return library.stats();
}

export async function libraryCoverage(library: AssetLibrary, playerIds?: string[]): Promise<CoverageReport[]> {
  return library.coverage(playerIds);
}

export async function ingestDirectory(
  library: AssetLibrary | string,
  dir: string,
  defaults: IngestDefaults,
): Promise<IngestResult> {
  return (await mod()).ingestDirectory(library, dir, defaults);
}

export async function manifestFilename(): Promise<string> {
  return (await mod()).MANIFEST_FILENAME;
}

export async function removeAsset(library: AssetLibrary, id: string): Promise<boolean> {
  const removed = await library.remove(id);
  if (removed) await library.save();
  return removed;
}

export async function saveLibrary(library: AssetLibrary): Promise<void> {
  await library.save();
}

export type { AssetKind, AssetLibrary, CoverageReport, IngestDefaults, IngestResult, LibraryStats, PlaceholderOptions };
