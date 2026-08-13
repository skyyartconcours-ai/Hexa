/**
 * Pure embedding maths. No IO, no sidecar, no sharp — this file is what the
 * identity gate is actually made of, so it stays trivially testable.
 */

import { HexaError } from '@hexa/core';
import type { IdentityVerdict } from './types.js';

/**
 * Cosine similarity threshold for "this render is the right player", on
 * buffalo_l (ArcFace R100, glint360k) embeddings.
 *
 * Why 0.45:
 *
 * - ArcFace-family embeddings are L2-normalised, so cosine ∈ [-1, 1]. The
 *   impostor distribution (two different people) is tightly centred near 0.0
 *   with a thin tail; on LFW-scale data essentially all impostor pairs land
 *   below ~0.35, and the genuine distribution (same person, different photo)
 *   sits around 0.6–0.8 for clean frontal captures.
 * - Recall-optimised libraries pick a much lower point — DeepFace's ArcFace
 *   default is cosine distance 0.68, i.e. similarity 0.32 — because they want
 *   to *find* matches. We want the opposite: a gate that refuses to ship a
 *   thumbnail of the wrong face. False accepts are the expensive error here, so
 *   we sit above the impostor tail, not on top of it.
 * - But we cannot sit at 0.6 either, because this comparison is cross-domain:
 *   a reference *photograph* against a *relit, colour-graded, composited
 *   render*. Stylisation costs roughly 0.05–0.15 of cosine even when the
 *   identity is objectively correct and untouched, so a photo-vs-photo
 *   threshold would reject good work constantly.
 * - 0.45 is the compromise: ~0.10 clear of the impostor tail, ~0.15 below the
 *   clean-pair genuine mode, which leaves headroom for grading. It is the usual
 *   operating point quoted for ArcFace verification, and it is deliberately
 *   exported as a knob — publish-grade jobs should raise it, rough drafts can
 *   lower it.
 *
 * Compare against the *best* of a player's gallery (`bestSimilarity`), not the
 * centroid alone: one bad reference angle should not sink an otherwise correct
 * render.
 */
export const DEFAULT_IDENTITY_THRESHOLD = 0.45;

/**
 * Absolute distance from the threshold above which a verdict is treated as
 * settled. Inside ±MEDIUM the call is close enough that a human should look.
 */
const CONFIDENCE_HIGH_MARGIN = 0.12;
const CONFIDENCE_MEDIUM_MARGIN = 0.05;

/**
 * Cosine similarity of two equal-length vectors.
 *
 * Returns 0 for a zero-magnitude vector (undefined direction) rather than NaN,
 * so a degenerate embedding fails a gate instead of poisoning comparisons.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new HexaError('INVALID_REQUEST', `embedding dimension mismatch: ${a.length} vs ${b.length}`, {
      hint: 'Embeddings from different models are not comparable — check FaceEmbedding.model on both sides.',
    });
  }
  if (a.length === 0) {
    throw new HexaError('INVALID_REQUEST', 'cannot compare empty embeddings');
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  // Guard against float drift pushing an identical pair to 1.0000000000000002.
  return Math.max(-1, Math.min(1, sim));
}

/**
 * L2-normalised centroid of a set of embeddings — a player's "average face".
 *
 * Averaging then re-normalising is the standard way to fuse multiple references
 * of one identity: it suppresses per-photo lighting/expression noise while
 * staying on the unit sphere where cosine is meaningful.
 */
export function meanEmbedding(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new HexaError('INVALID_REQUEST', 'meanEmbedding requires at least one vector');
  }
  const dim = vectors[0]!.length;
  if (dim === 0) {
    throw new HexaError('INVALID_REQUEST', 'meanEmbedding received a zero-length vector');
  }
  const sum = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    if (vec.length !== dim) {
      throw new HexaError('INVALID_REQUEST', `embedding dimension mismatch: ${vec.length} vs ${dim}`, {
        hint: 'All vectors passed to meanEmbedding must come from the same model.',
      });
    }
    // Normalise each input first so one unnormalised vector cannot dominate.
    let n = 0;
    for (let i = 0; i < dim; i++) n += vec[i]! * vec[i]!;
    const inv = n > 0 ? 1 / Math.sqrt(n) : 0;
    for (let i = 0; i < dim; i++) sum[i]! += vec[i]! * inv;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += sum[i]! * sum[i]!;
  if (norm <= 0) {
    // Vectors cancelled out exactly (or were all zero) — no meaningful centroid.
    return new Array<number>(dim).fill(0);
  }
  const inv = 1 / Math.sqrt(norm);
  return sum.map((v) => v * inv);
}

/**
 * Highest similarity between a probe and any vector in a gallery.
 *
 * Returns -1 for an empty gallery: the minimum possible cosine, so it fails
 * every sane threshold instead of silently reading as "no evidence against".
 */
export function bestSimilarity(probe: number[], gallery: number[][]): number {
  if (gallery.length === 0) return -1;
  let best = -1;
  for (const candidate of gallery) {
    const sim = cosineSimilarity(probe, candidate);
    if (sim > best) best = sim;
  }
  return best;
}

/**
 * Turn a similarity into a gate decision plus a "how sure are we" band.
 *
 * `confidence` describes distance from the decision boundary in either
 * direction, not how good the match is: a clear fail is high-confidence too.
 * A `low` verdict means the observation is inside ±0.05 of the threshold, which
 * is inside the noise floor of cross-domain comparison — surface those for
 * human review rather than trusting the sign.
 */
export function identityVerdict(sim: number, threshold: number): IdentityVerdict {
  const margin = sim - threshold;
  const distance = Math.abs(margin);
  const confidence: IdentityVerdict['confidence'] =
    distance >= CONFIDENCE_HIGH_MARGIN ? 'high' : distance >= CONFIDENCE_MEDIUM_MARGIN ? 'medium' : 'low';
  return { pass: sim >= threshold, confidence, margin };
}
