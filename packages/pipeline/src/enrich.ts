/**
 * Reference enrichment — the pass that turns the identity gate on.
 *
 * `identityGate` compares the rendered face against `ReferenceAsset.embedding`.
 * Until this module existed, nothing in the repository ever wrote that field:
 * ingestion left it undefined "for a later enrichment pass", the pass did not
 * exist, and the gate therefore reported every render unverified — even with a
 * full cleared library and the sidecar running. The design was sound and the
 * wire was missing, which is the worst kind of gap because everything looks
 * present from the outside.
 *
 * This is that pass. It is deliberately separate from ingestion: embedding
 * needs the vision sidecar, ingestion must work without it, and a library
 * ingested today should become verifiable the moment the sidecar appears —
 * without re-importing anybody's photographs.
 */

import type { Logger, ReferenceAsset } from '@hexa/core';
import { HexaError } from '@hexa/core';
import type { PipelineDeps } from './types.js';

export interface EnrichOptions {
  /** Restrict to these players. Omit to enrich the whole library. */
  playerIds?: string[];
  /** Recompute embeddings that already exist (after a model change). */
  force?: boolean;
  /** How many images to send per sidecar round trip. */
  batchSize?: number;
  onProgress?: (done: number, total: number, assetId: string) => void;
}

export interface EnrichResult {
  /** Assets that gained an embedding in this run. */
  embedded: number;
  /** Already had one and `force` was not set. */
  skipped: number;
  /** The sidecar found no usable face. */
  noFace: number;
  failed: { assetId: string; reason: string }[];
  /** Players who now have at least one embedded reference. */
  playersReady: string[];
  /** Players with photographs but still no usable embedding. */
  playersUnverifiable: string[];
  model?: string;
}

/**
 * Compute and persist face embeddings for reference photographs.
 *
 * Throws only when the sidecar is unreachable — that is a configuration problem
 * the caller must see, not something to degrade past, because degrading here
 * means silently producing a library that can never verify anything.
 */
export async function enrichReferences(
  deps: PipelineDeps,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const { library, vision, logger } = deps;
  const log: Logger = logger.child('enrich');

  if (!(await vision.available())) {
    throw new HexaError('VISION_UNAVAILABLE', 'The vision sidecar is not reachable, so embeddings cannot be computed.', {
      hint:
        'Start it with ./services/vision/run.sh (it serves on :8765), then set ' +
        'HEXA_VISION_URL=http://127.0.0.1:8765 and re-run. Identity verification cannot work without it.',
    });
  }

  // Only photographs of people carry identity. Logos and backplates have no
  // face to embed, and asking for one wastes a round trip per asset.
  const candidates = library
    .all()
    .filter((a) => a.playerId && a.kind !== 'logo' && a.kind !== 'backplate')
    .filter((a) => !opts.playerIds?.length || opts.playerIds.includes(a.playerId!))
    .filter((a) => !a.tags?.includes('placeholder'));

  const todo = opts.force ? candidates : candidates.filter((a) => !a.embedding?.length);
  const skipped = candidates.length - todo.length;

  const result: EnrichResult = {
    embedded: 0,
    skipped,
    noFace: 0,
    failed: [],
    playersReady: [],
    playersUnverifiable: [],
  };

  if (!todo.length) {
    log.info(`Nothing to embed — ${skipped} reference(s) already carry an embedding.`);
    summarise(library.all(), result);
    return result;
  }

  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 8, 32));
  log.info(`Embedding ${todo.length} reference photograph(s) in batches of ${batchSize}…`);

  let done = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const paths = batch.map((a) => library.resolvePath(a, 'source'));

    let embeddings: ({ vector: number[]; model: string } | null)[];
    try {
      embeddings = await vision.embedBatch(paths);
    } catch (err) {
      // One bad batch must not lose the work already done, so record and continue.
      const reason = err instanceof Error ? err.message : String(err);
      for (const a of batch) result.failed.push({ assetId: a.id, reason });
      log.warn(`Batch failed (${batch.length} asset(s)): ${reason}`);
      done += batch.length;
      continue;
    }

    for (const [j, asset] of batch.entries()) {
      const embedding = embeddings[j];
      done++;
      opts.onProgress?.(done, todo.length, asset.id);

      if (!embedding?.vector?.length) {
        result.noFace++;
        log.debug(`No usable face in ${asset.path}`);
        continue;
      }
      await library.update(asset.id, {
        embedding: embedding.vector,
        embeddingModel: embedding.model,
      });
      result.model ??= embedding.model;
      result.embedded++;
    }
  }

  await library.save();
  summarise(library.all(), result);

  log.info(
    `Embedded ${result.embedded}, skipped ${result.skipped}, no face in ${result.noFace}, failed ${result.failed.length}. ` +
      `${result.playersReady.length} player(s) can now be verified.`,
  );
  return result;
}

/** Split players into "can be verified" and "has photos but still cannot". */
function summarise(all: ReferenceAsset[], result: EnrichResult): void {
  const ready = new Set<string>();
  const withPhotos = new Set<string>();
  for (const a of all) {
    if (!a.playerId || a.tags?.includes('placeholder')) continue;
    if (a.kind === 'logo' || a.kind === 'backplate') continue;
    withPhotos.add(a.playerId);
    if (a.embedding?.length) ready.add(a.playerId);
  }
  result.playersReady = [...ready].sort();
  result.playersUnverifiable = [...withPhotos].filter((p) => !ready.has(p)).sort();
}

/**
 * The reference gallery for one player: every embedding on record.
 *
 * This is what the identity gate compares a rendered face against. Returning an
 * empty array is meaningful and must not be mistaken for a pass — it means the
 * player cannot be verified at all.
 */
export function referenceGallery(deps: PipelineDeps, playerId: string): number[][] {
  return deps.library
    .all()
    .filter((a) => a.playerId === playerId && a.embedding?.length && !a.tags?.includes('placeholder'))
    .map((a) => a.embedding!);
}
