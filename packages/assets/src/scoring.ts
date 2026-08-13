/**
 * Quality scoring and query-weighted ranking.
 *
 * Two layers, deliberately separated:
 *
 *   computeQuality(metrics, kind) → 0–100
 *     "How good is this photograph, for this *kind* of asset?" Intrinsic to the
 *     file. Stored on the asset and shown in the CLI.
 *
 *   scoreAsset(asset, query)      → 0–100
 *     "How good is it for *this slot*?" Same blend, re-weighted by what the
 *     layout asked for, plus a recency bonus and a facing penalty.
 *
 * Both are pure: same inputs ⇒ same number, no clock, no filesystem, no
 * randomness. `scoreAsset` takes an explicit `now` (defaulting to the real
 * clock) so a ranking pass is internally consistent and tests are exact.
 *
 * Terms are all normalised to 0–1 before weighting, so the weight tables below
 * are directly comparable and a weight change is a legible diff.
 */

import type { AssetKind, AssetMetrics, AssetQuery, ReferenceAsset } from '@hexa/core';

/** |yaw| below this reads as facing the camera. */
export const YAW_FRONT_THRESHOLD = 12;

/** Points deducted when the subject faces away from the requested side. */
export const FACING_MISMATCH_PENALTY = 12;

/** Maximum points a freshly-captured photo can gain over an ancient one. */
export const RECENCY_MAX_BONUS = 6;

/** Photos older than this stop losing recency points — they are all "archive". */
export const RECENCY_HORIZON_DAYS = 1095; // three seasons

/** The six normalised terms every quality blend is built from. */
export interface QualityTerms {
  sharpness: number;
  resolution: number;
  faceArea: number;
  frontality: number;
  occlusion: number;
  contrast: number;
}

export type QualityWeights = Partial<QualityTerms>;

/**
 * Per-kind weights. Each column is the share of the final score that term
 * carries; the used weights are renormalised, so dropping a term (see
 * logo/backplate) redistributes rather than deflating the score.
 *
 * Rationale:
 *  - portrait     — a versus bust is 80% face. Face area + frontality dominate
 *                   (0.52 combined); resolution matters least because the head
 *                   is cropped anyway.
 *  - jersey       — kit legibility, so resolution and occlusion climb while the
 *                   face still needs to read.
 *  - action       — mid-game shots are motion-blurred and half-occluded by
 *                   design; sharpness and occlusion lead, pose is forgiven.
 *  - celebration  — emotional peak; occlusion (trophies, arms, confetti) is the
 *                   real risk, frontality is not expected.
 *  - fullbody     — used at full height, so resolution is the dominant term
 *                   (0.38); the face is small on screen and weighted lightly.
 *  - logo         — a vector-ish mark: crisp edges and pixels. NO face terms.
 *  - backplate    — an environment plate: resolution first, then clean tone.
 *                   NO face terms.
 *
 * Face terms are simply absent for logo/backplate, which is what keeps the
 * blend from ever reaching for a faceBox that does not exist.
 */
export const KIND_WEIGHTS: Record<AssetKind, QualityWeights> = {
  portrait:    { sharpness: 0.22, resolution: 0.12, faceArea: 0.26, frontality: 0.26, occlusion: 0.09, contrast: 0.05 },
  jersey:      { sharpness: 0.22, resolution: 0.16, faceArea: 0.18, frontality: 0.22, occlusion: 0.12, contrast: 0.10 },
  action:      { sharpness: 0.28, resolution: 0.18, faceArea: 0.14, frontality: 0.12, occlusion: 0.16, contrast: 0.12 },
  celebration: { sharpness: 0.24, resolution: 0.16, faceArea: 0.16, frontality: 0.14, occlusion: 0.18, contrast: 0.12 },
  fullbody:    { sharpness: 0.22, resolution: 0.38, faceArea: 0.08, frontality: 0.10, occlusion: 0.10, contrast: 0.12 },
  logo:        { sharpness: 0.40, resolution: 0.45, contrast: 0.15 },
  backplate:   { sharpness: 0.30, resolution: 0.45, contrast: 0.25 },
};

/** Kinds whose usefulness depends on a human face being present and readable. */
export const FACE_KINDS: readonly AssetKind[] = ['portrait', 'jersey', 'action', 'celebration', 'fullbody'] as const;

/** True when the kind has no face to measure (logos, backplates). */
export function isFaceless(kind: AssetKind): boolean {
  return !FACE_KINDS.includes(kind);
}

/**
 * Ideal face area (fraction of frame) per kind. Above it the crop is too tight
 * to composite; below it the face is too small to carry identity.
 */
const IDEAL_FACE_AREA: Record<AssetKind, number> = {
  portrait: 0.22,
  jersey: 0.12,
  action: 0.06,
  celebration: 0.08,
  fullbody: 0.04,
  logo: 0,
  backplate: 0,
};

/**
 * Neutral priors for terms the ML enrichment pass has not filled in yet.
 * A freshly ingested photo must not score 0 just because no detector has run —
 * it scores "unknown", and enrichment can only sharpen the estimate.
 */
const PRIOR = {
  faceArea: 0.5,
  frontality: 0.5,
  /** Absent occlusion data reads as "probably fine": most photos are unoccluded. */
  occlusion: 0.8,
} as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Saturating map for unbounded positive measures: `v/(v+half)`, i.e. `half`
 * scores 0.5 and the curve never quite reaches 1. Strictly monotone increasing,
 * which is what makes "sharper always ranks higher, all else equal" provable.
 */
function saturate(v: number, half: number): number {
  const x = Math.max(0, v);
  return x / (x + half);
}

// ── individual terms ─────────────────────────────────────────────────────────

/** Variance-of-Laplacian: <40 is soft, ~120 is the 0.5 mark, 600+ is crisp. */
export function sharpnessTerm(sharpness: number): number {
  return finite(sharpness) ? saturate(sharpness, 120) : 0.5;
}

/** Megapixels, saturating: 2 MP ⇒ 0.5, 8 MP ⇒ 0.8. Aspect-agnostic on purpose. */
export function resolutionTerm(width: number, height: number): number {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return 0;
  return saturate((width * height) / 1_000_000, 2);
}

/**
 * Face size against the per-kind ideal: linear rise up to the ideal, then a
 * gentle (max 50%) penalty for crops so tight the compositor cannot re-frame.
 */
export function faceAreaTerm(faceArea: number | undefined, kind: AssetKind): number {
  if (!finite(faceArea) || faceArea < 0) return PRIOR.faceArea;
  const ideal = IDEAL_FACE_AREA[kind] || 0.15;
  if (faceArea <= ideal) return clamp01(faceArea / ideal);
  return clamp01(1 - 0.5 * ((faceArea - ideal) / Math.max(1e-6, 1 - ideal)));
}

/**
 * Head pose. Gaussian falloff so small deviations are free and big ones bite:
 * yaw is 65% of the term (a profile is unusable for a bust), pitch 35%
 * (chin-up/chin-down is recoverable with a crop). Roll is ignored — the
 * compositor rotates.
 */
export function frontalityTerm(yaw: number | undefined, pitch: number | undefined): number {
  if (!finite(yaw) && !finite(pitch)) return PRIOR.frontality;
  const y = finite(yaw) ? Math.exp(-((yaw / 35) ** 2)) : PRIOR.frontality;
  const p = finite(pitch) ? Math.exp(-((pitch / 25) ** 2)) : PRIOR.frontality;
  return clamp01(0.65 * y + 0.35 * p);
}

/** 1 − occlusion. Absent data uses the "probably fine" prior. */
export function occlusionTerm(occlusion: number | undefined): number {
  return finite(occlusion) ? clamp01(1 - clamp01(occlusion)) : PRIOR.occlusion;
}

/**
 * RMS contrast. Rises to full marks at 0.28 (a normal, well-exposed frame),
 * stays flat through 0.55, then eases off for crushed/over-graded sources that
 * fight the template's own grade.
 *
 * Brightness is deliberately NOT scored: exposure is a gradeable property the
 * render pipeline fixes for free, so penalising it would reject good frames.
 */
export function contrastTerm(contrast: number | undefined): number {
  if (!finite(contrast) || contrast <= 0) return 0;
  if (contrast <= 0.28) return clamp01(contrast / 0.28);
  if (contrast <= 0.55) return 1;
  return clamp01(1 - 0.4 * ((contrast - 0.55) / 0.45));
}

/** All six normalised terms for a metrics record. */
export function qualityTerms(m: Omit<AssetMetrics, 'quality'>, kind: AssetKind): QualityTerms {
  return {
    sharpness: sharpnessTerm(m?.sharpness as number),
    resolution: resolutionTerm(m?.width as number, m?.height as number),
    faceArea: faceAreaTerm(faceAreaOf(m), kind),
    frontality: frontalityTerm(m?.yaw, m?.pitch),
    occlusion: occlusionTerm(m?.occlusion),
    contrast: contrastTerm(m?.contrast),
  };
}

/**
 * Face area from explicit `faceArea`, else derived from the faceBox against the
 * frame. Never divides by an absent box.
 */
function faceAreaOf(m: Omit<AssetMetrics, 'quality'>): number | undefined {
  if (finite(m?.faceArea)) return m.faceArea;
  const box = m?.faceBox;
  if (!box || !finite(box.w) || !finite(box.h)) return undefined;
  const frame = (m?.width ?? 0) * (m?.height ?? 0);
  if (!finite(frame) || frame <= 0) return undefined;
  return clamp01((box.w * box.h) / frame);
}

/** Weighted mean over the weights actually present, renormalised to 0–1. */
function blend(terms: QualityTerms, weights: QualityWeights): number {
  let acc = 0;
  let total = 0;
  for (const key of Object.keys(weights) as (keyof QualityTerms)[]) {
    const w = weights[key];
    if (!finite(w) || w <= 0) continue;
    acc += w * clamp01(terms[key]);
    total += w;
  }
  return total > 0 ? acc / total : 0;
}

/**
 * Intrinsic 0–100 usability score for a photograph, weighted by what its kind
 * is for. Face terms are skipped entirely for logos and backplates.
 */
export function computeQuality(m: Omit<AssetMetrics, 'quality'>, kind: AssetKind): number {
  const weights = KIND_WEIGHTS[kind] ?? KIND_WEIGHTS.portrait;
  const value = blend(qualityTerms(m ?? ({} as Omit<AssetMetrics, 'quality'>), kind), weights);
  return round2(clamp01(value) * 100);
}

// ── query-time scoring ───────────────────────────────────────────────────────

/** Which way the subject is looking, derived from head yaw. */
export type Facing = 'left' | 'right' | 'front';

/**
 * Facing from yaw: negative yaw ⇒ the subject faces frame-left, positive ⇒
 * frame-right, within ±12° ⇒ straight at camera. Unknown yaw is treated as
 * 'front', which satisfies any request — an un-enriched asset is never punished
 * for data we have not computed yet.
 */
export function facingOf(m: Pick<AssetMetrics, 'yaw'> | undefined): Facing {
  const yaw = m?.yaw;
  if (!finite(yaw)) return 'front';
  if (yaw < -YAW_FRONT_THRESHOLD) return 'left';
  if (yaw > YAW_FRONT_THRESHOLD) return 'right';
  return 'front';
}

/**
 * Does the asset satisfy the requested facing outright? A front-facing subject
 * satisfies everything. A wrong-way subject still *can* be used — the
 * compositor mirrors the cutout — it just pays {@link FACING_MISMATCH_PENALTY},
 * because mirroring flips jersey text, logos and hair partings.
 */
export function facingMatches(asset: ReferenceAsset, want: AssetQuery['facing']): boolean {
  if (!want || want === 'any') return true;
  const have = facingOf(asset?.metrics);
  return have === 'front' || have === want;
}

/** Recency bonus in points, 0 when `capturedAt` is missing or unparseable. */
export function recencyBonus(capturedAt: string | undefined, now: number): number {
  if (!capturedAt) return 0;
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return 0;
  const ageDays = (now - t) / 86_400_000;
  if (ageDays <= 0) return RECENCY_MAX_BONUS; // future/just-taken: treat as brand new
  return RECENCY_MAX_BONUS * clamp01(1 - ageDays / RECENCY_HORIZON_DAYS);
}

/** Full breakdown of a score — powers `hexa assets explain` and the tests. */
export interface ScoreBreakdown {
  id: string;
  /** Intrinsic kind-weighted quality, 0–100. */
  base: number;
  /** Quality after the query's weight multipliers, 0–100. */
  weighted: number;
  recency: number;
  facingPenalty: number;
  facing: Facing;
  total: number;
  terms: QualityTerms;
}

/**
 * Score an asset against a slot's requirements.
 *
 *   total = blend(terms, kindWeights × queryWeights)   // 0–100
 *         + recencyBonus × (query.weights.recency ?? 1)
 *         − facingMismatchPenalty
 *
 * Query weights are *multipliers* on the kind weights (1 = leave alone, 2 =
 * "this slot cares twice as much about face area"), and the blend renormalises,
 * so a query cannot inflate a score past 100 by asking for everything.
 *
 * Pure given `(asset, query, now)`; `now` defaults to the wall clock so callers
 * that do not care need not pass it.
 */
export function scoreAsset(a: ReferenceAsset, q: AssetQuery = {}, now: number = Date.now()): number {
  return explainScore(a, q, now).total;
}

/** {@link scoreAsset} with its working shown. */
export function explainScore(a: ReferenceAsset, q: AssetQuery = {}, now: number = Date.now()): ScoreBreakdown {
  const kind = a?.kind ?? 'portrait';
  const metrics = (a?.metrics ?? {}) as AssetMetrics;
  const terms = qualityTerms(metrics, kind);
  const kindWeights = KIND_WEIGHTS[kind] ?? KIND_WEIGHTS.portrait;

  // Query weights multiply the kind weights for the three visual terms they
  // name; a term the kind does not use stays unused (a logo query asking for
  // faceArea still gets no face terms).
  const qw = q?.weights ?? {};
  const weights: QualityWeights = { ...kindWeights };
  for (const key of ['faceArea', 'sharpness', 'frontality'] as const) {
    const mul = qw[key];
    if (weights[key] !== undefined && finite(mul) && mul >= 0) weights[key] = weights[key]! * mul;
  }

  const base = clamp01(blend(terms, kindWeights)) * 100;
  const weighted = clamp01(blend(terms, weights)) * 100;

  const recencyMul = finite(qw.recency) && qw.recency >= 0 ? qw.recency : 1;
  const recency = recencyBonus(a?.provenance?.capturedAt, now) * recencyMul;

  const facing = facingOf(metrics);
  const facingPenalty = facingMatches(a, q?.facing) ? 0 : FACING_MISMATCH_PENALTY;

  const total = clamp(weighted + recency - facingPenalty, 0, 100);
  return {
    id: a?.id ?? '',
    base: round2(base),
    weighted: round2(weighted),
    recency: round2(recency),
    facingPenalty,
    facing,
    total: round2(total),
    terms,
  };
}

/**
 * Rank best-first. Ties break on intrinsic quality, then id, so ordering is
 * total and stable — two runs of the same pipeline pick the same photo.
 */
export function rankAssets(list: readonly ReferenceAsset[], q: AssetQuery = {}, now: number = Date.now()): ReferenceAsset[] {
  const scored = (list ?? []).map((a) => ({ a, s: explainScore(a, q, now) }));
  scored.sort((x, y) => {
    if (y.s.total !== x.s.total) return y.s.total - x.s.total;
    if (y.s.base !== x.s.base) return y.s.base - x.s.base;
    return (x.a?.id ?? '').localeCompare(y.a?.id ?? '', 'en');
  });
  return scored.map(({ a }) => a);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Two decimals: enough resolution to order assets, stable across platforms. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
