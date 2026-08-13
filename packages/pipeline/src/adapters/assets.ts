/**
 * @hexa/assets adapter — the licensed reference library.
 *
 * The load-bearing behaviour here is that **an empty library is not an error**.
 * A new user has no photographs yet, and the tool has to stay usable: every
 * lookup that comes up empty degrades to a schematic placeholder and a warning,
 * never an exception. See `bestAssetOrPlaceholder` in the select stage.
 */

import type { AssetQuery, ReferenceAsset } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule } from './load.js';
import { toBuffer } from './normalise.js';
import {
  ASSETS_EXPORTS,
  type AssetLibrary,
  type AssetsModule,
  type CoverageRow,
  type IngestOptions,
  type IngestReport,
  type LibraryStats,
  type PlaceholderOptions,
} from './contracts.js';

const SPEC = '@hexa/assets';
const HINT = 'The asset library package is not built. Run: pnpm --filter @hexa/assets build';

async function mod(): Promise<AssetsModule> {
  return loadModule<AssetsModule>(SPEC, { needs: ASSETS_EXPORTS, hint: HINT });
}

/**
 * Open a library rooted at `root`, tolerating either an async static `open()` or
 * a plain constructor with a separate `load()`.
 */
export async function openLibrary(root: string): Promise<AssetLibrary> {
  const m = await mod();
  const Ctor = m.AssetLibrary;
  if (typeof Ctor?.open === 'function') {
    return await Ctor.open(root);
  }
  const lib = new Ctor(root);
  if (typeof lib.load === 'function') await lib.load();
  return lib;
}

/** Best asset for a slot, or `undefined` when the library has nothing suitable. */
export async function bestAsset(library: AssetLibrary, query: AssetQuery): Promise<ReferenceAsset | undefined> {
  return library.best(query);
}

/**
 * Candidates for a query, best first.
 *
 * The pipeline needs the *ranked* list, not just the winner: when the identity
 * gate rejects a render, the retry reaches for the next-best asset.
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
  return library.resolvePath(asset);
}

/**
 * Absolute path of an asset's pre-computed cutout, when it has one.
 * Returns `undefined` rather than throwing on a bad path — a broken cutout
 * reference should fall through to segmenting the original, not fail the render.
 */
export function cutoutPath(library: AssetLibrary, asset: ReferenceAsset): string | undefined {
  if (!asset.cutoutPath) return undefined;
  try {
    return library.resolvePath(asset.cutoutPath);
  } catch {
    return undefined;
  }
}

/**
 * A schematic stand-in silhouette. Deliberately *not* a synthesised person:
 * placeholders never depict a fake human face (see docs/IDENTITY.md).
 */
export async function generatePlaceholder(opts: PlaceholderOptions): Promise<Buffer> {
  const m = await mod();
  const out = toBuffer(await m.generatePlaceholder(opts));
  if (!out) {
    throw new HexaError('ASSET_NOT_FOUND', 'Placeholder generation returned no image data', {
      hint: 'generatePlaceholder() in @hexa/assets returned an unexpected shape — see packages/pipeline/src/adapters/assets.ts',
    });
  }
  return out;
}

/** Attribution line for exactly the assets composited into an output. */
export async function creditLine(assets: readonly ReferenceAsset[], opts?: { prefix?: string }): Promise<string> {
  return (await mod()).creditLine(assets, opts);
}

export async function isPublishable(asset: ReferenceAsset): Promise<boolean> {
  return (await mod()).isPublishable(asset);
}

export async function libraryStats(library: AssetLibrary): Promise<LibraryStats> {
  return library.stats();
}

export async function libraryCoverage(library: AssetLibrary): Promise<CoverageRow[]> {
  return library.coverage();
}

export async function ingestDirectory(root: string, dir: string, opts?: IngestOptions): Promise<IngestReport> {
  return (await mod()).ingestDirectory(root, dir, opts);
}

export async function manifestFilename(): Promise<string> {
  return (await mod()).MANIFEST_FILENAME;
}

export async function removeAsset(library: AssetLibrary, id: string): Promise<void> {
  if (typeof library.remove !== 'function') {
    throw new HexaError('IO_ERROR', 'This asset library does not support removal', {
      hint: 'Upgrade @hexa/assets, or delete the entry from manifest.json by hand.',
    });
  }
  await library.remove(id);
  if (typeof library.save === 'function') await library.save();
}

export async function saveLibrary(library: AssetLibrary): Promise<void> {
  if (typeof library.save === 'function') await library.save();
}

export type { AssetLibrary, CoverageRow, IngestOptions, IngestReport, LibraryStats, PlaceholderOptions };
