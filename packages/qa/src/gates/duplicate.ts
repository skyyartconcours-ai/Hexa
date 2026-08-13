/**
 * Duplicate gate.
 *
 * Offering four variants that are the same picture with different grain is a
 * quiet lie: it burns render time and it tells the user they explored options
 * they did not. The renderer records the dHashes of the other variants in the
 * batch (`plan.meta.siblingHashes`); this gate hashes the finished render and
 * complains when it collides with one of them.
 *
 * Warn, never fail — a near-duplicate is wasteful, not broken, and the batch
 * orchestrator is the layer that should drop or re-seed it.
 */

import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, ramp } from '../geom.js';
import { DUPLICATE_DISTANCE, dHash, hamming } from '../hash.js';
import { siblingHashes } from '../plan.js';

export const duplicateGate: Gate = {
  id: 'duplicate',
  weight: 0.3,
  description: 'This variant is perceptually distinct from the others in the batch (dHash hamming distance)',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const hash = await dHash(ctx.image);
    const siblings = siblingHashes(ctx.plan);
    const variantId = ctx.plan.meta.variantId ?? 'this variant';

    if (siblings.length === 0) {
      return [{
        gate: 'duplicate',
        severity: 'pass',
        message: `dHash ${hash}; no sibling variants declared in plan.meta.siblingHashes, so there was nothing to compare against`,
        score: 1,
      }];
    }

    const distances = siblings
      .map((s) => {
        try {
          return { hash: s, distance: hamming(hash, s) };
        } catch {
          return null;
        }
      })
      .filter((d): d is { hash: string; distance: number } => d !== null)
      .sort((a, b) => a.distance - b.distance);

    if (distances.length === 0) {
      return [{
        gate: 'duplicate',
        severity: 'warn',
        message: `dHash ${hash}; the ${siblings.length} sibling hash${siblings.length === 1 ? '' : 'es'} in plan.meta.siblingHashes could not be compared (wrong length or not hex)`,
        score: 0.6,
        suggestion: 'Populate plan.meta.siblingHashes with values from dHash() — 16 hex characters each.',
      }];
    }

    const nearest = distances[0]!;
    if (nearest.distance <= DUPLICATE_DISTANCE) {
      return [{
        gate: 'duplicate',
        severity: 'warn',
        message: `${variantId} is near-identical to another variant in this batch: dHash ${hash} is ${nearest.distance}/64 bits from ${nearest.hash} (≤${DUPLICATE_DISTANCE} counts as the same picture)`,
        score: clamp01(ramp(nearest.distance, 0, DUPLICATE_DISTANCE + 1)),
        suggestion: 'Vary something structural rather than cosmetic — pose/asset choice, layout slot, crop or background treatment. Re-seeding grain or nudging the grade does not produce a different option.',
      }];
    }

    return [{
      gate: 'duplicate',
      severity: 'pass',
      message: `dHash ${hash} is ${nearest.distance}/64 bits from its nearest sibling — a genuinely distinct variant`,
      score: clamp01(0.6 + 0.4 * ramp(nearest.distance, DUPLICATE_DISTANCE, 20)),
    }];
  },
};
