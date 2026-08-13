/**
 * @hexa/qa adapter — the gates that can veto a render.
 *
 * QA is the mechanism that turns the identity promise into a guarantee, so this
 * adapter deliberately does **not** degrade gracefully on a malformed report. A
 * QA subsystem that half-answers is worse than one that is absent: it produces a
 * green tick nobody checked. If a report comes back unreadable, the synthesised
 * replacement *fails*, and says why.
 *
 * The translation here is assembling `GateContext`: the gates want subjects with
 * their face rects and reference galleries attached, plus the laid-out text
 * rects, all of which the compiler recorded into `plan.meta`. Pulling them back
 * out is this adapter's job.
 */

import type { PlayerId, QaReport, QaRequest, ReferenceAsset, RenderPlan, ThumbnailVariant } from '@hexa/core';
import { loadModule } from './load.js';
import { toNumber } from './normalise.js';
import {
  QA_EXPORTS,
  type DisplaySize,
  type GateSubject,
  type GateTextRect,
  type QaModule,
  type QaRect,
  type VisionPort,
} from './contracts.js';

const SPEC = '@hexa/qa';
const HINT = 'The QA package is not built. Run: pnpm --filter @hexa/qa build';

async function mod(): Promise<QaModule> {
  return loadModule<QaModule>(SPEC, { needs: QA_EXPORTS, hint: HINT });
}

export interface GatesRequest {
  image: Buffer;
  plan: RenderPlan;
  subjects: GateSubject[];
  textRects?: GateTextRect[];
  request?: QaRequest;
  vision?: VisionPort;
  /** Restrict or skip gates by id — used by `hexa qa --only/--skip`. */
  only?: string[];
  skip?: string[];
}

export async function runGates(req: GatesRequest): Promise<QaReport> {
  const m = await mod();
  const report = await m.runGates(
    {
      image: req.image,
      plan: req.plan,
      width: req.plan.canvas.width,
      height: req.plan.canvas.height,
      subjects: req.subjects,
      textRects: req.textRects,
      request: req.request,
      vision: req.vision,
    },
    { only: req.only, skip: req.skip },
  );
  return normaliseReport(report);
}

/**
 * A report we can act on, or an explicit failure saying we could not read one.
 * The fallback is a *failing* report on purpose — see the note at the top.
 */
function normaliseReport(raw: unknown): QaReport {
  if (!raw || typeof raw !== 'object') return unreadable('runGates returned no report');

  const bag = raw as Partial<QaReport>;
  const findings = Array.isArray(bag.findings) ? bag.findings : [];
  const score = toNumber(bag.score);

  if (typeof bag.passed !== 'boolean' && findings.length === 0 && score === undefined) {
    return unreadable('runGates returned a report with no verdict, findings or score');
  }

  return {
    passed: bag.passed === true || (bag.passed === undefined && !findings.some((f) => f.severity === 'fail')),
    score: score ?? 0,
    findings,
    gateScores: bag.gateScores ?? {},
  };
}

function unreadable(why: string): QaReport {
  return {
    passed: false,
    score: 0,
    findings: [{
      gate: 'qa-integration',
      severity: 'fail',
      message: `Quality gates could not be evaluated: ${why}`,
      suggestion:
        'The return shape of @hexa/qa runGates has drifted — fix packages/pipeline/src/adapters/qa.ts. ' +
        'Do not ship output whose gates never ran.',
    }],
    gateScores: {},
  };
}

export interface AppealRequest {
  image: Buffer;
  width: number;
  height: number;
  textRects?: GateTextRect[];
  faceRects?: QaRect[];
}

/**
 * 0–100 heuristic appeal score. A design heuristic, not a CTR prediction.
 * Returns 0 rather than throwing: a missing taste score must not fail a render
 * that passed every correctness gate.
 */
export async function scoreAppeal(req: AppealRequest): Promise<number> {
  try {
    const result = await (await mod()).scoreAppeal(req);
    return toNumber(result?.score) ?? 0;
  } catch {
    return 0;
  }
}

/** Appeal score with its component breakdown, for `hexa qa` output. */
export async function scoreAppealDetailed(req: AppealRequest): Promise<{ score: number; parts: Record<string, number>; notes: string[] }> {
  try {
    const result = await (await mod()).scoreAppeal(req);
    return { score: toNumber(result?.score) ?? 0, parts: result?.parts ?? {}, notes: result?.notes ?? [] };
  } catch {
    return { score: 0, parts: {}, notes: [] };
  }
}

/**
 * Index of the best variant.
 *
 * Prefers the sibling's ranking — it knows about near-duplicate detection via
 * dHash — and falls back to the documented rule so a batch always names a
 * winner even if ranking is unavailable.
 */
export async function pickBest(variants: readonly ThumbnailVariant[]): Promise<number> {
  if (variants.length === 0) return -1;
  try {
    const index = (await mod()).pickBest([...variants]);
    if (Number.isInteger(index) && index >= 0 && index < variants.length) return index;
  } catch {
    // fall through to the local rule
  }
  return localBest(variants);
}

/**
 * Passing variants first, then 60% QA / 40% appeal — mirroring the sibling's
 * documented weighting, so the fallback ranks the same way the real one does.
 * Exported for tests.
 */
export function localBest(variants: readonly { qa: QaReport; appeal: number }[]): number {
  let best = 0;
  let bestKey = -Infinity;
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    const key = (v.qa.passed ? 1000 : 0) + v.qa.score * 0.6 + v.appeal * 0.4;
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  }
  return best;
}

/** One-line human summary of a report. */
export async function summarise(report: QaReport): Promise<string> {
  try {
    const s = (await mod()).summarise(report);
    if (typeof s === 'string' && s.length > 0) return s;
  } catch {
    // fall through
  }
  const fails = report.findings.filter((f) => f.severity === 'fail').length;
  const warns = report.findings.filter((f) => f.severity === 'warn').length;
  return `${report.passed ? 'PASS' : 'FAIL'} ${report.score.toFixed(0)}/100 — ${fails} failure(s), ${warns} warning(s)`;
}

/** Rendered at real display sizes: does it still read at 168×94? */
export async function proofSheet(image: Buffer, opts?: { background?: string }): Promise<Buffer | undefined> {
  try {
    return await (await mod()).proofSheet(image, opts);
  } catch {
    return undefined;
  }
}

export async function displaySizes(): Promise<DisplaySize[]> {
  try {
    return [...((await mod()).YOUTUBE_DISPLAY_SIZES ?? [])];
  } catch {
    return [];
  }
}

export async function gateList(): Promise<{ id: string; weight: number; description: string }[]> {
  try {
    return [...((await mod()).GATES ?? [])];
  } catch {
    return [];
  }
}

export async function perceptualHash(image: Buffer): Promise<string | undefined> {
  try {
    return await (await mod()).dHash(image);
  } catch {
    return undefined;
  }
}

/** Bit distance between two perceptual hashes — how alike two variants are. */
export async function hashDistance(a: string, b: string): Promise<number | undefined> {
  try {
    return toNumber((await mod()).hamming(a, b));
  } catch {
    return undefined;
  }
}

export type { GateSubject, GateTextRect, QaRect, VisionPort };
export type { PlayerId, ReferenceAsset };
