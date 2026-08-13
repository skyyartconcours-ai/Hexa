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
 *
 * ## Ways this gate has been made to lie, and what stops them
 *
 * Every defence below exists because the attack worked (see
 * `test/identity.attack.test.ts`):
 *
 * - **A threshold that verifies anything.** `identityThreshold: 0` accepts a
 *   stranger, and `NaN` was worse: `best < NaN` is false, so every subject fell
 *   through to "verified". Thresholds are now validated, and a nonsense one is
 *   replaced by the default with a warning rather than honoured.
 * - **A face rect pointing off the canvas.** The crop clamped to a 1px sliver
 *   and the gate warned about a "small face". A rect that is not on the canvas
 *   is a broken claim about where the face is, not a marginal render, so it
 *   fails.
 * - **A degenerate gallery.** A zero vector makes cosine undefined; the gate
 *   reported "different models", which is a different — and false — diagnosis.
 * - **`anonymous: true`.** A legitimate opt-out for silhouette treatments, but
 *   it used to score a perfect 1 and read as a pass, so switching it on for
 *   every subject bought a clean report with nothing checked.
 * - **A placeholder.** The schematic stand-in is registered `license: owned,
 *   cleared: true`, so it sails through the licence gate. Nothing checked
 *   whether the "face" being published was a real person's at all.
 */

import sharp from 'sharp';
import type { QaFinding, ReferenceAsset } from '@hexa/core';
import type { Gate, GateContext, GateSubject, QaRect } from '../types.js';
import { clamp01, toNormRect, toPixelRect } from '../geom.js';
import { clampToImage } from '../image.js';

export const DEFAULT_IDENTITY_THRESHOLD = 0.45;

/**
 * Below this, cosine similarity cannot separate two different people: ArcFace
 * impostor pairs cluster around 0.0, so a threshold down here verifies
 * strangers. A request may still set it — drafts sometimes want to see what a
 * marginal render looks like — but the report says the gate is not gating.
 */
export const MIN_USEFUL_IDENTITY_THRESHOLD = 0.2;

/** Tags that mark an asset as a synthetic stand-in rather than a photograph. */
const PLACEHOLDER_TAGS = ['placeholder', 'synthetic', 'no-identity'];

/** Cosine similarity. Returns null when the vectors are not comparable — a
 *  dimension mismatch means two different embedding models, and comparing those
 *  numbers would produce a confident, meaningless answer. A non-finite result
 *  (a NaN or ±Infinity anywhere in either vector) is equally incomparable: it
 *  must never reach a `>=` against the threshold. */
export function cosine(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return null;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Number.isFinite(sim) ? sim : null;
}

/** Is this vector usable at all — right shape, finite, non-zero? */
function isUsableVector(v: unknown): v is number[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  let norm = 0;
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return false;
    norm += x * x;
  }
  return norm > 0;
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

/**
 * Resolve the operating threshold.
 *
 * A threshold is a safety parameter, so a nonsense value is a misconfiguration
 * to be corrected and reported, not an instruction to be obeyed. `NaN` in
 * particular turned every comparison into a pass, because every `<` against NaN
 * is false.
 */
function resolveThreshold(requested: number | undefined): { threshold: number; note?: QaFinding } {
  if (requested === undefined) return { threshold: DEFAULT_IDENTITY_THRESHOLD };

  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    return {
      threshold: DEFAULT_IDENTITY_THRESHOLD,
      note: {
        gate: 'identity',
        severity: 'warn',
        message:
          `Ignoring an unusable identity threshold (${String(requested)}) and verifying against the default ` +
          `${DEFAULT_IDENTITY_THRESHOLD} instead — a threshold of zero, a negative number or NaN verifies anybody`,
        score: 0.5,
        suggestion: `Pass a cosine threshold in (0, 1]; ${DEFAULT_IDENTITY_THRESHOLD} is the tuned default for buffalo_l.`,
      },
    };
  }

  if (requested > 1) {
    return {
      threshold: requested,
      note: {
        gate: 'identity',
        severity: 'warn',
        message: `Identity threshold ${requested} is above the maximum possible cosine similarity of 1, so every subject will fail`,
        score: 0.5,
        suggestion: 'Cosine similarity is bounded by 1. Use a value in (0, 1].',
      },
    };
  }

  if (requested < MIN_USEFUL_IDENTITY_THRESHOLD) {
    return {
      threshold: requested,
      note: {
        gate: 'identity',
        severity: 'warn',
        message:
          `Identity threshold ${requested} is below ${MIN_USEFUL_IDENTITY_THRESHOLD}, which is inside the impostor ` +
          'distribution — at this setting the gate cannot tell this player from a stranger and is not really gating',
        score: 0.4,
        suggestion: `Raise it to at least ${MIN_USEFUL_IDENTITY_THRESHOLD}, ideally ${DEFAULT_IDENTITY_THRESHOLD}, before publishing anything.`,
      },
    };
  }

  return { threshold: requested };
}

/** Placeholder assets contributing to this subject, if any. */
function placeholdersFor(subject: GateSubject): ReferenceAsset[] {
  return (subject.assets ?? []).filter((a) => (a?.tags ?? []).some((t) => PLACEHOLDER_TAGS.includes(t)));
}

/**
 * Is the claimed face rect actually on the canvas?
 *
 * `toPixelRect` accepts normalised or device rects, so this works in both
 * spaces; what it is looking for is a rect that does not describe a region of
 * this render at all.
 */
function faceRectFault(rect: QaRect, width: number, height: number): string | null {
  const nums = [rect.x, rect.y, rect.w, rect.h];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return 'is not a finite rectangle';
  const px = toPixelRect(rect, width, height);
  if (px.w <= 0 || px.h <= 0) return `has zero or negative area (${px.w}×${px.h}px)`;
  const overlapW = Math.min(px.x + px.w, width) - Math.max(px.x, 0);
  const overlapH = Math.min(px.y + px.h, height) - Math.max(px.y, 0);
  if (overlapW <= 0 || overlapH <= 0) {
    return `lies entirely outside the ${width}×${height} render (origin ${px.x},${px.y})`;
  }
  const inside = (overlapW * overlapH) / (px.w * px.h);
  if (inside < 0.5) return `is mostly outside the ${width}×${height} render (only ${Math.round(inside * 100)}% on canvas)`;
  return null;
}

export const identityGate: Gate = {
  id: 'identity',
  weight: 3,
  description: 'Rendered faces match the player\'s reference embeddings (cosine similarity against the gallery best match)',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const findings: QaFinding[] = [];
    const publishGrade = ctx.request?.requireClearedLicense === true;
    const { threshold, note } = resolveThreshold(ctx.request?.identityThreshold);
    if (note) findings.push(note);

    const checkable = ctx.subjects.filter((s) => !s.anonymous && (s.referenceEmbeddings?.length ?? 0) > 0);

    for (const s of ctx.subjects) {
      const placeholders = placeholdersFor(s);

      if (placeholders.length > 0) {
        // The stand-in is `license: owned, cleared: true`, so the licence gate
        // is satisfied by it. Only this gate knows the difference between a
        // cleared asset and a photograph of the person named in the thumbnail.
        findings.push({
          gate: 'identity',
          severity: publishGrade ? 'fail' : 'warn',
          message:
            `${s.handle} is rendered from a synthetic placeholder (${placeholders.map((a) => a.id).join(', ')}), not a ` +
            'photograph — this render depicts no real likeness and must not be published as a picture of them',
          score: publishGrade ? 0 : 0.25,
          subjectId: s.playerId,
          suggestion:
            `Ingest licensed reference photography before publishing: hexa assets ingest <dir> --player ${s.handle}. ` +
            'The placeholder is cleared for use as artwork — it is simply not a picture of this player, so no ' +
            'identity claim can be made from it.',
        });
        continue;
      }

      if (s.anonymous) {
        // A legitimate opt-out for silhouette and heavy-blur treatments, but it
        // is an opt-out *of verification*, and the report has to say so: an
        // unverified subject scoring 1 is how a whole roster gets waved through.
        findings.push({
          gate: 'identity',
          severity: publishGrade ? 'warn' : 'pass',
          message: `${s.handle} is marked anonymous — identity was NOT verified for this subject (verification intentionally skipped)`,
          score: publishGrade ? 0.5 : 0.75,
          subjectId: s.playerId,
          suggestion:
            'Anonymous is correct for silhouette or blurred treatments. If this subject is meant to be recognisable, ' +
            'clear the flag so the rendered face is checked against their reference gallery.',
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
        if (placeholdersFor(s).length > 0) continue;
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
      if (placeholdersFor(s).length > 0) continue;

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

      // A rect that is not on the canvas is not a small face — it is a false
      // statement about where this person is, and the crop it produces verifies
      // nothing. Failing here also stops it degrading into the "too small to
      // embed" warning, which reads as a quality note rather than a broken input.
      const fault = faceRectFault(s.faceRect, ctx.width, ctx.height);
      if (fault) {
        findings.push({
          gate: 'identity',
          severity: 'fail',
          message: `${s.handle}'s recorded face rect ${fault}, so the rendered face could not be located and verified`,
          score: 0,
          subjectId: s.playerId,
          suggestion:
            'The compositor and the gate disagree about where this face is. Check the coordinate space of ' +
            'plan.meta.faceRects (normalised 0–1 or device pixels) and that the subject was not dropped from the ' +
            'composite. Never ship an unverifiable face.',
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

      if (!isUsableVector(embedded.vector)) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `The embedder returned a degenerate vector for ${s.handle} (zero-length or non-finite), so identity is UNVERIFIED`,
          score: 0.2,
          subjectId: s.playerId,
          where,
          suggestion: 'This is an embedder fault, not a render fault — check the vision sidecar and its model weights, then re-run.',
        });
        continue;
      }

      let best = -1;
      let comparable = 0;
      let degenerate = 0;
      for (const ref of s.referenceEmbeddings!) {
        if (!isUsableVector(ref)) {
          degenerate++;
          continue;
        }
        const sim = cosine(embedded.vector, ref);
        if (sim === null) continue;
        comparable++;
        if (sim > best) best = sim;
      }

      if (comparable === 0) {
        const total = s.referenceEmbeddings!.length;
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message:
            degenerate === total
              ? `${s.handle}'s reference gallery is unusable: all ${total} vector${total === 1 ? ' is' : 's are'} degenerate ` +
                '(zero-length, all-zero or containing NaN/Infinity), so no comparison was made and identity is UNVERIFIED'
              : `${s.handle}'s reference embeddings are ${s.referenceEmbeddings![0]?.length ?? 0}-d but the render embedded to ${embedded.vector.length}-d — different models, so no comparison was made`,
          score: 0.2,
          subjectId: s.playerId,
          where,
          suggestion:
            degenerate === total
              ? `Re-embed the gallery for ${s.handle} (hexa assets embed --player ${s.handle}); an all-zero vector usually means the embedder ran without its weights.`
              : 'Re-embed the reference gallery with the same model the QA port uses (ReferenceAsset.embeddingModel records which produced each vector).',
        });
        continue;
      }

      if (degenerate > 0) {
        findings.push({
          gate: 'identity',
          severity: 'warn',
          message: `${degenerate} of ${s.referenceEmbeddings!.length} reference vectors for ${s.handle} are degenerate and were ignored`,
          score: 0.55,
          subjectId: s.playerId,
          suggestion: `Re-embed ${s.handle}'s gallery so every reference contributes to the comparison.`,
        });
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
