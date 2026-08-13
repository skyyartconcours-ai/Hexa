/**
 * Stage 7 — render.
 *
 * Thin by design. All the decisions were made by the compiler; this hands the
 * plan and the buffers its layers reference to @hexa/render and gets pixels.
 *
 * The buffer map is rebuilt here rather than carried on the plan because a
 * RenderPlan must stay serialisable — that is what lets it be cached, diffed and
 * shipped to a remote worker. Layers name their bytes by key; `collectBuffers`
 * resolves those keys from the subjects and backplate that are still in memory.
 */

import type { Logger, RenderPlan, RenderResult } from '@hexa/core';
import { renderPlan } from '../adapters/render.js';
import type { PreparedSubject } from '../types.js';
import { collectBuffers } from './compile.js';

export interface RenderStageOptions {
  plan: RenderPlan;
  subjects: PreparedSubject[];
  backplate?: Buffer;
  logos?: Record<string, Buffer>;
  format?: 'png' | 'jpeg' | 'webp' | 'avif';
  quality?: number;
  logger: Logger;
  signal?: AbortSignal;
}

export async function renderVariant(opts: RenderStageOptions): Promise<RenderResult> {
  const buffers = collectBuffers(opts.plan, {
    subjects: opts.subjects,
    backplate: opts.backplate,
    logos: opts.logos,
  });

  opts.logger.debug('rendering', {
    variant: opts.plan.meta.variantId,
    layers: opts.plan.layers.length,
    buffers: Object.keys(buffers).length,
  });

  return renderPlan(opts.plan, {
    buffers,
    // PNG for the intermediate: QA measures contrast and crops faces out of
    // these pixels, and JPEG artefacts around a rim light would be measured as
    // if they were part of the design. Final encoding happens at emit.
    format: 'png',
    quality: opts.quality,
    signal: opts.signal,
  });
}
