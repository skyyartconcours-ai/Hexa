/**
 * @hexa/qa adapter — the gates that can veto a render.
 *
 * QA is the mechanism that turns the identity promise into a guarantee, so this
 * adapter deliberately does **not** degrade gracefully on a malformed report. A
 * QA subsystem that half-answers is worse than one that is absent: it produces a
 * green tick nobody checked. If a report comes back unreadable we synthesise a
 * report whose findings say exactly that, and it does not pass.
 */

import type { QaReport, RenderPlan, ReferenceAsset, PlayerId } from '@hexa/core';
import { loadModule } from './load.js';
import { toArray, toBuffer, toNumber } from './normalise.js';
import { QA_EXPORTS, type AppealInput, type QaModule, type RunGatesInput, type VisionClient } from './contracts.js';

const SPEC = '@hexa/qa';
const HINT = 'The QA package is not built. Run: pnpm --filter @hexa/qa build';

async function mod(): Promise<QaModule> {
  return loadModule<QaModule>(SPEC, { needs: QA_EXPORTS, hint: HINT });
}

export interface GatesRequest {
  image: Buffer;
  plan: RenderPlan;
  references?: Record<PlayerId, number[][]>;
  vision?: VisionClient;
  assets?: readonly ReferenceAsset[];
  thresholds?: { identity?: number };
  options?: RunGatesInput['options'];
}

export async function runGates(req: GatesRequest): Promise<QaReport> {
  const m = await mod();
  const raw = (await m.runGates(req)) as unknown;
  return normaliseReport(raw);
}

/**
 * A report we can act on, or an explicit failure saying we could not read one.
 * The fallback is a *failing* report on purpose — see the note at the top.
 */
function normaliseReport(raw: unknown): QaReport {
  if (!raw || typeof raw !== 'object') {
    return unreadable('runGates returned no report');
  }
  const bag = raw as Record<string, unknown>;
  const findings = toArray<Record<string, unknown>>(bag['findings']).map((f) => ({
    gate: String(f['gate'] ?? 'unknown'),
    severity: (f['severity'] === 'fail' || f['severity'] === 'warn' || f['severity'] === 'pass'
      ? f['severity']
      : 'warn') as QaReport['findings'][number]['severity'],
    message: String(f['message'] ?? ''),
    score: toNumber(f['score']),
    where: f['where'] as QaReport['findings'][number]['where'],
    subjectId: typeof f['subjectId'] === 'string' ? f['subjectId'] : undefined,
    suggestion: typeof f['suggestion'] === 'string' ? f['suggestion'] : undefined,
  }));

  const score = toNumber(bag['score']);
  if (typeof bag['passed'] !== 'boolean' && findings.length === 0 && score === undefined) {
    return unreadable('runGates returned a report with no verdict, findings or score');
  }

  return {
    passed: bag['passed'] === true || (bag['passed'] === undefined && !findings.some((f) => f.severity === 'fail')),
    score: score ?? 0,
    findings,
    gateScores: (bag['gateScores'] as Record<string, number>) ?? {},
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
      suggestion: 'The return shape of @hexa/qa runGates has drifted — fix packages/pipeline/src/adapters/qa.ts. Re-render with --no-qa only if you intend to ship unverified output.',
    }],
    gateScores: {},
  };
}

/** 0–100 heuristic appeal score. A design heuristic, not a CTR prediction. */
export async function scoreAppeal(input: AppealInput): Promise<number> {
  try {
    const m = await mod();
    return toNumber(await m.scoreAppeal(input)) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Index of the best variant.
 *
 * Prefers the sibling's ranking (it knows about near-duplicate detection via
 * dHash), and falls back to the documented rule — highest combined QA and
 * appeal, passing variants first — so a batch always names a winner.
 */
export async function pickBest(variants: readonly { qa: QaReport; appeal: number }[]): Promise<number> {
  if (variants.length === 0) return -1;
  try {
    const m = await mod();
    const raw = await m.pickBest(variants);
    const idx = toNumber(typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['index'] : raw);
    if (idx !== undefined && Number.isInteger(idx) && idx >= 0 && idx < variants.length) return idx;
  } catch {
    // fall through to the local rule
  }
  return localBest(variants);
}

/** Exported for tests: passing variants first, then QA+appeal, ties to the earlier seed. */
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
    const m = await mod();
    const s = m.summarise(report);
    if (typeof s === 'string' && s.length > 0) return s;
  } catch {
    // fall through
  }
  const fails = report.findings.filter((f) => f.severity === 'fail').length;
  const warns = report.findings.filter((f) => f.severity === 'warn').length;
  return `${report.passed ? 'PASS' : 'FAIL'} ${report.score.toFixed(0)}/100 — ${fails} failure(s), ${warns} warning(s)`;
}

/** Rendered-at-real-sizes proof sheet: does it still read at 210×118? */
export async function proofSheet(input: { image: Buffer; report?: QaReport }): Promise<Buffer | undefined> {
  try {
    const m = await mod();
    return toBuffer(await m.proofSheet(input));
  } catch {
    return undefined;
  }
}

export async function displaySizes(): Promise<{ width: number; height: number; label?: string }[]> {
  try {
    const m = await mod();
    return [...(m.YOUTUBE_DISPLAY_SIZES ?? [])];
  } catch {
    return [];
  }
}

export async function simulateSizes(image: Buffer, sizes?: readonly { width: number; height: number }[]): Promise<unknown> {
  const m = await mod();
  return m.simulateSizes(image, sizes);
}

export async function perceptualHash(image: Buffer): Promise<string | undefined> {
  try {
    const m = await mod();
    const h = await m.dHash(image);
    return typeof h === 'string' ? h : undefined;
  } catch {
    return undefined;
  }
}

/** Hamming distance between two perceptual hashes — how alike two variants are. */
export async function hashDistance(a: string, b: string): Promise<number | undefined> {
  try {
    const m = await mod();
    return toNumber(m.hamming(a, b));
  } catch {
    return undefined;
  }
}
