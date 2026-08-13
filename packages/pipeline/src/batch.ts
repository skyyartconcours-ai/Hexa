/**
 * Batch generation.
 *
 * A season of thumbnails is dozens of requests against the same roster, the same
 * asset library and the same template set, so the expensive setup — opening the
 * library, connecting to the sidecar — is done once and shared.
 *
 * Concurrency is deliberately low by default. Every job holds several decoded
 * images in memory and the render is CPU-bound; running eight at once on a
 * laptop trades a small wall-clock win for swap thrash. Two is a good default,
 * and the sidecar serialises inference anyway.
 */

import { isHexaError } from '@hexa/core';
import type { ThumbnailJobResult, ThumbnailRequest } from '@hexa/core';
import { completeDeps } from './deps.js';
import { generateThumbnail } from './generate.js';
import type { BatchOptions, PipelineDeps } from './types.js';

export const DEFAULT_BATCH_CONCURRENCY = 2;

/**
 * Run many requests, sharing one dependency set.
 *
 * A failing request does not stop the batch — you find out at the end which ones
 * failed, having got the rest. Failures are reported as results with no variants
 * and the reason in `warnings`, so a caller can iterate the array uniformly.
 */
export async function batchGenerate(
  reqs: ThumbnailRequest[],
  deps?: Partial<PipelineDeps>,
  opts: BatchOptions = {},
): Promise<ThumbnailJobResult[]> {
  if (reqs.length === 0) return [];

  const resolved = await completeDeps(deps);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_BATCH_CONCURRENCY, reqs.length));
  const results: ThumbnailJobResult[] = new Array(reqs.length);

  let cursor = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= reqs.length) return;
      const request = reqs[index]!;
      const label = describeRequest(request);

      try {
        results[index] = await generateThumbnail(request, resolved);
      } catch (e) {
        resolved.logger.error(`batch item ${index + 1} failed: ${message(e)}`);
        results[index] = failedResult(request, e);
      } finally {
        done++;
        opts.onProgress?.(done, reqs.length, label);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/** Short human label for progress output: "versus-classic: Peyz vs Viper". */
export function describeRequest(req: ThumbnailRequest): string {
  const players = (req.subjects ?? []).map((s) => s.player).filter(Boolean);
  const who = players.length === 0 ? '(no subjects)' : players.length === 2 ? players.join(' vs ') : players.join(', ');
  return `${req.templateId ?? 'unknown template'}: ${who}`;
}

/**
 * A failure in the same shape as a success.
 *
 * Making the caller handle two shapes for "one item of a batch" is how batch
 * reporting ends up wrong; an empty `variants` array is unambiguous.
 */
function failedResult(request: ThumbnailRequest, error: unknown): ThumbnailJobResult {
  const hint = isHexaError(error) && error.hint ? ` — ${error.hint}` : '';
  return {
    request,
    variants: [],
    bestIndex: -1,
    totalMs: 0,
    warnings: [`${describeRequest(request)} failed: ${message(error)}${hint}`],
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Convenience summary of a finished batch. */
export function summariseBatch(results: readonly ThumbnailJobResult[]): {
  total: number;
  succeeded: number;
  failed: number;
  images: number;
  totalMs: number;
} {
  let succeeded = 0;
  let images = 0;
  let totalMs = 0;
  for (const r of results) {
    if (r.variants.length > 0) succeeded++;
    images += r.variants.length;
    totalMs += r.totalMs;
  }
  return { total: results.length, succeeded, failed: results.length - succeeded, images, totalMs };
}
