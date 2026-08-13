/**
 * Identity gate — the headline promise.
 *
 * Hexa's whole claim is that the face in the thumbnail is the actual player's
 * face, carried from a licensed photograph rather than hallucinated. This gate
 * is what makes that claim mechanical: crop the face out of the *rendered*
 * pixels, embed it, and compare against the player's reference gallery. If the
 * grade, the duotone, the rim light or a generative pass has drifted the
 * likeness away from the real person, the render is rejected.
 *
 * When no embedder is wired up the gate warns loudly. It never silently passes:
 * "we could not check" and "we checked and it is fine" are different claims and
 * the report must not conflate them.
 */

import sharp from 'sharp';
import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, toNormRect, toPixelRect } from '../geom.js';
import { clampToImage } from '../image.js';

export const DEFAULT_IDENTITY_THRESHOLD = 0.45;

/** Cosine similarity. Returns null when the vectors are not comparable — a
 *  dimension mismatch means two different embedding models, and comparing those
 *  numbers would produce a confident, meaningless answer. */
export function cosine(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Map a similarity onto a 0–1 gate score with the threshold pinned at 0.5, so
 *  a bare pass never reads as a good score. */
function scoreFor(similarity: number, threshold: number): number {
  if (similarity >= threshold) return clamp01(0.5 + (0.5 * (similarity - threshold)) / Math.max(0.05, 1 - threshold));
  return clamp01((0.5 * similarity) / Math.max(0.05, threshold));
}

const ENABLE_HINT =
  'Enable verification by passing a vision port to runGates (ctx.vision), e.g. the ONNX face embedder from @hexa/vision, ' +
  'or point HEXA_VISION_URL at the vision service. Without it the identity promise is unenforced.';

export const identityGate: Gate = {
  id: 'identity',
  weight: 3,
  description: 'Rendered faces match the player\'s reference embeddings (cosine similarity against the gallery best match)',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const findings: QaFinding[] = [];
    const threshold = ctx.request?.identityThreshold ?? DEFAULT_IDENTITY_THRESHOLD;
    const checkable = ctx.subjects.filter((s) => !s.anonymous && (s.referenceEmbeddings?.length ?? 0) > 0);

    for (const s of ctx.subjects) {
      if (s.anonymous) {
        findings.push({
          gate: 'identity',
          severity: 'pass',
          message: `${s.handle} is marked anonymous — identity verification intentionally skipped`,
          score: 1,
          subjectId: s.playerId,
        });
      } else if (!s.referenceEmbeddings?.length) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `${s.handle} has no reference embeddings, so the rendered face cannot be verified against the real player`,
          score: 0.4,
          subjectId: s.playerId,
          suggestion: `Ingest cleared reference photography for ${s.handle} and embed it (hexa assets embed --player ${s.handle}) so this render can be checked.`,
        });
      }
    }

    if (checkable.length === 0) return findings;

    const available = ctx.vision ? await ctx.vision.available().catch(() => false) : false;
    if (!available) {
      for (const s of checkable) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `Identity could not be verified for ${s.handle}: no face embedder is available, so this render is UNVERIFIED rather than approved`,
          score: 0.35,
          subjectId: s.playerId,
          suggestion: ENABLE_HINT,
        });
      }
      return findings;
    }

    for (const s of checkable) {
      if (!s.faceRect) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `No face rect was recorded for ${s.handle} in the render, so there is nothing to crop and verify`,
          score: 0.4,
          subjectId: s.playerId,
          suggestion: 'Have the compositor record the resolved face rect per subject (renderer emits it alongside the plan) and pass it in GateContext.subjects[].faceRect.',
        });
        continue;
      }

      const px = toPixelRect(s.faceRect, ctx.width, ctx.height);
      // Embedders expect a little context around the face; 18% margin matches
      // what the ingestion pipeline crops for the reference gallery.
      const margin = 0.18;
      const crop = clampToImage(
        { x: px.x - px.w * margin, y: px.y - px.h * margin, w: px.w * (1 + margin * 2), h: px.h * (1 + margin * 2) },
        ctx.width,
        ctx.height,
      );
      const where = toNormRect(px, ctx.width, ctx.height);

      if (crop.w < 16 || crop.h < 16) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `${s.handle}'s face occupies only ${crop.w}×${crop.h}px in the render — too small to embed reliably`,
          score: 0.3,
          subjectId: s.playerId,
          where,
          suggestion: 'Scale the subject up or switch to a bust-crop layout; faces below ~64px rarely survive embedding, let alone the sidebar.',
        });
        continue;
      }

      const cropped = await sharp(ctx.image, { failOn: 'none' })
        .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
        .png()
        .toBuffer();

      const embedded = await ctx.vision!.embed(cropped);
      if (!embedded || embedded.vector.length === 0) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `The embedder found no usable face for ${s.handle} in the rendered crop — identity is UNVERIFIED (a heavy duotone, occlusion or extreme rim light can do this)`,
          score: 0.3,
          subjectId: s.playerId,
          where,
          suggestion: 'Reduce subject-layer stylisation (duotone amount, rim intensity) or pick an asset with a cleaner frontal face, then re-run.',
        });
        continue;
      }

      let best = -1;
      let comparable = 0;
      for (const ref of s.referenceEmbeddings!) {
        const sim = cosine(embedded.vector, ref);
        if (sim === null) continue;
        comparable++;
        if (sim > best) best = sim;
      }

      if (comparable === 0) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `${s.handle}'s reference embeddings are ${s.referenceEmbeddings![0]?.length ?? 0}-d but the render embedded to ${embedded.vector.length}-d — different models, so no comparison was made`,
          score: 0.2,
          subjectId: s.playerId,
          where,
          suggestion: 'Re-embed the reference gallery with the same model the QA port uses (ReferenceAsset.embeddingModel records which produced each vector).',
        });
        continue;
      }

      const score = scoreFor(best, threshold);
      if (best < threshold) {
        findings.push({
          gate: 'identity',
          severity: 'fail',
          message: `${s.handle} does not match the reference gallery: best cosine similarity ${best.toFixed(3)} < threshold ${threshold.toFixed(2)} across ${comparable} reference${comparable === 1 ? '' : 's'}`,
          score,
          subjectId: s.playerId,
          where,
          suggestion:
            'The rendered face has drifted from the real player. Dial back grade/duotone on the subject layer, pick a more frontal reference asset, ' +
            'or check the compositor did not swap subjects between slots. Never ship this — publishing a face that is not the player is the one failure the tool exists to prevent.',
        });
      } else {
        findings.push({
          gate: 'identity',
          severity: 'pass',
          message: `${s.handle} verified: best cosine similarity ${best.toFixed(3)} ≥ ${threshold.toFixed(2)} (${comparable} reference${comparable === 1 ? '' : 's'} compared)`,
          score,
          subjectId: s.playerId,
          where,
          ...(best < threshold + 0.08
            ? { suggestion: `Only ${(best - threshold).toFixed(3)} above the threshold — worth an eyeball before publishing.` }
            : {}),
        });
      }
    }

    return findings;
  },
};
