/**
 * Stage 8 — QA.
 *
 * The gates are what turn the identity promise into a guarantee. The pipeline
 * does not trust itself: the gates crop the face out of the *finished* render,
 * embed it, and compare it against the player's reference gallery. If it does
 * not match, the render fails and the retry reaches for a different photograph.
 *
 * Two jobs here.
 *
 * **Assembling what the gates need.** They want each subject with the face rect
 * it occupies *in the render* and the embeddings it may be compared against —
 * both of which the compiler recorded into `plan.meta`. Pulling them back out
 * happens here rather than in the adapter, because it is pipeline knowledge:
 * only this package knows that `meta.faceRects` and `meta.textRects` exist.
 *
 * **Building the reference gallery.** The gallery is every embedding the library
 * holds for that player, *excluding* the asset actually composited wherever that
 * leaves anything behind. Verifying a face against the photograph it was cut
 * from is close to a tautology; verifying it against the player's *other*
 * photographs is a real check that the composite still reads as them after
 * cropping, grading, rim lighting and downscaling.
 */

import type { Logger, PlayerId, QaReport, QaRequest, ReferenceAsset, RenderPlan } from '@hexa/core';
import * as qa from '../adapters/qa.js';
import type { AssetLibrary, GateSubject, GateTextRect, QaRect, VisionClient, VisionPort } from '../adapters/contracts.js';
import type { FaceRectRecord, TextRectRecord } from './compile.js';
import type { PreparedSubject } from '../types.js';

export interface QaStageOptions {
  image: Buffer;
  plan: RenderPlan;
  subjects: PreparedSubject[];
  library: AssetLibrary;
  vision: VisionClient;
  request?: QaRequest;
  logger: Logger;
  only?: string[];
  skip?: string[];
}

export interface QaStageResult {
  report: QaReport;
  appeal: number;
  /** Player ids whose identity gate failed — what the retry acts on. */
  identityFailures: PlayerId[];
  warnings: string[];
}

export async function runQaStage(opts: QaStageOptions): Promise<QaStageResult> {
  const warnings: string[] = [];
  const gallery = buildReferenceGallery(opts.subjects, opts.library, warnings);
  const faceRects = readFaceRects(opts.plan);
  const textRects = readTextRects(opts.plan);

  const subjects: GateSubject[] = opts.subjects.map((s) => ({
    playerId: s.player.id,
    handle: s.player.handle,
    faceRect: faceRects.get(s.player.id),
    referenceEmbeddings: gallery[s.player.id],
    anonymous: s.anonymous ?? false,
    assets: [s.asset],
  }));

  const report = await qa.runGates({
    image: opts.image,
    plan: opts.plan,
    subjects,
    textRects,
    request: opts.request,
    // @hexa/vision's client satisfies the structural VisionPort the gates want.
    vision: opts.vision as unknown as VisionPort,
    only: opts.only,
    skip: opts.skip,
  });

  const appeal = await qa.scoreAppeal({
    image: opts.image,
    width: opts.plan.canvas.width,
    height: opts.plan.canvas.height,
    textRects,
    faceRects: [...faceRects.values()],
  });

  return {
    report,
    appeal,
    identityFailures: identityFailuresIn(report, opts.subjects),
    warnings,
  };
}

/** Face rects the compiler recorded, keyed by player. */
export function readFaceRects(plan: RenderPlan): Map<PlayerId, QaRect> {
  const records = (plan.meta['faceRects'] as FaceRectRecord[] | undefined) ?? [];
  const out = new Map<PlayerId, QaRect>();
  for (const r of records) {
    if (r?.playerId && r.rect) out.set(r.playerId, r.rect);
  }
  return out;
}

/** Text rects the compiler recorded, in the shape the gates read. */
export function readTextRects(plan: RenderPlan): GateTextRect[] {
  const records = (plan.meta['textRects'] as TextRectRecord[] | undefined) ?? [];
  return records.filter((r) => r?.rect).map((r) => ({ role: r.role, rect: r.rect }));
}

/**
 * Embeddings per player, from the library.
 *
 * Embeddings are model-specific — a buffalo_l vector and an ArcFace-r100 vector
 * are not comparable and would produce a confident, meaningless similarity — so
 * assets are grouped by `embeddingModel` and only the largest coherent group is
 * used.
 */
export function buildReferenceGallery(
  subjects: readonly PreparedSubject[],
  library: AssetLibrary,
  warnings: string[] = [],
): Record<PlayerId, number[][]> {
  const gallery: Record<PlayerId, number[][]> = {};

  for (const subject of subjects) {
    if (subject.anonymous) continue;

    const owned = library.find({ playerId: subject.player.id }) ?? [];
    const embedded = owned.filter((a): a is ReferenceAsset & { embedding: number[] } =>
      Array.isArray(a.embedding) && a.embedding.length > 0,
    );

    if (embedded.length === 0) {
      if (!subject.placeholder) {
        warnings.push(
          `No reference embeddings for ${subject.player.handle} — identity cannot be verified for this render. ` +
            `Re-run ingestion with the vision sidecar running to embed the photos already on file.`,
        );
      }
      continue;
    }

    const coherent = largestModelGroup(embedded);
    if (coherent.length < embedded.length) {
      warnings.push(
        `${subject.player.handle} has embeddings from more than one model; used the ${coherent.length} from ` +
          `"${coherent[0]?.embeddingModel ?? 'unknown'}" and ignored the rest.`,
      );
    }

    // Prefer references *other than* the one composited. Fall back to the whole
    // set when it is the only photo on file — a weak check beats none.
    const others = coherent.filter((a) => a.id !== subject.asset.id);
    const chosen = others.length > 0 ? others : coherent;
    gallery[subject.player.id] = chosen.map((a) => a.embedding);
  }

  return gallery;
}

function largestModelGroup(
  assets: (ReferenceAsset & { embedding: number[] })[],
): (ReferenceAsset & { embedding: number[] })[] {
  const groups = new Map<string, (ReferenceAsset & { embedding: number[] })[]>();
  for (const a of assets) {
    const key = a.embeddingModel ?? 'unknown';
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  let best: (ReferenceAsset & { embedding: number[] })[] = [];
  for (const list of groups.values()) if (list.length > best.length) best = list;
  return best;
}

/** Which subjects the identity gate rejected. */
export function identityFailuresIn(report: QaReport, subjects: readonly PreparedSubject[]): PlayerId[] {
  const failures = new Set<PlayerId>();
  for (const finding of report.findings) {
    if (finding.severity !== 'fail') continue;
    if (!/identity/i.test(finding.gate)) continue;
    if (finding.subjectId) {
      failures.add(finding.subjectId);
    } else {
      // A gate that failed without naming a subject means "one of these"; with a
      // single subject that is unambiguous, and with several the retry has to
      // try them all rather than guess.
      for (const s of subjects) if (!s.anonymous) failures.add(s.player.id);
    }
  }
  return [...failures];
}

/** Did anything fail, ignoring warnings? */
export function hasHardFailure(report: QaReport): boolean {
  return report.findings.some((f) => f.severity === 'fail');
}

export async function summarise(report: QaReport): Promise<string> {
  return qa.summarise(report);
}
