import { describe, expect, it } from 'vitest';
import type { AssetKind, AssetMetrics, ReferenceAsset } from '@hexa/core';
import {
  FACING_MISMATCH_PENALTY,
  KIND_WEIGHTS,
  RECENCY_MAX_BONUS,
  computeQuality,
  explainScore,
  facingOf,
  isFaceless,
  rankAssets,
  recencyBonus,
  scoreAsset,
} from './scoring.js';

const NOW = Date.parse('2026-01-01T00:00:00Z');

function metrics(over: Partial<AssetMetrics> = {}): Omit<AssetMetrics, 'quality'> {
  return { width: 2000, height: 3000, sharpness: 200, brightness: 128, contrast: 0.3, ...over };
}

function asset(over: Partial<ReferenceAsset> = {}): ReferenceAsset {
  return {
    id: 'a',
    kind: 'portrait',
    path: 'a.png',
    metrics: { ...metrics(), quality: 0 },
    provenance: { source: 'LCK', license: 'press-kit', addedAt: '2025-01-01T00:00:00Z', cleared: true },
    tags: [],
    ...over,
  };
}

describe('computeQuality — monotonicity', () => {
  it('is strictly increasing in sharpness, all else equal', () => {
    const scores = [0, 10, 40, 120, 400, 2000].map((sharpness) => computeQuality(metrics({ sharpness }), 'portrait'));
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
  });

  it('is strictly increasing in resolution, all else equal', () => {
    const scores = [
      [320, 240],
      [1280, 720],
      [1920, 1080],
      [4000, 3000],
    ].map(([width, height]) => computeQuality(metrics({ width, height }), 'fullbody'));
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
  });

  it('is decreasing in occlusion and in head rotation', () => {
    const occ = [0, 0.25, 0.5, 1].map((occlusion) => computeQuality(metrics({ occlusion }), 'portrait'));
    for (let i = 1; i < occ.length; i++) expect(occ[i]!).toBeLessThan(occ[i - 1]!);

    const yaws = [0, 15, 35, 70].map((yaw) => computeQuality(metrics({ yaw, pitch: 0 }), 'portrait'));
    for (let i = 1; i < yaws.length; i++) expect(yaws[i]!).toBeLessThan(yaws[i - 1]!);
  });

  it('peaks at the per-kind ideal face area rather than rewarding ever-bigger faces', () => {
    const at = (faceArea: number) => computeQuality(metrics({ faceArea }), 'portrait');
    expect(at(0.22)).toBeGreaterThan(at(0.05));
    expect(at(0.22)).toBeGreaterThan(at(0.85));
  });

  it('always lands in 0–100, even for absurd or missing metrics', () => {
    const cases: Omit<AssetMetrics, 'quality'>[] = [
      metrics({ sharpness: -50, contrast: -1, width: 0, height: 0 }),
      metrics({ sharpness: Number.POSITIVE_INFINITY, contrast: 99 }),
      { width: Number.NaN, height: Number.NaN, sharpness: Number.NaN, brightness: Number.NaN, contrast: Number.NaN },
      {} as Omit<AssetMetrics, 'quality'>,
    ];
    for (const m of cases) {
      for (const kind of Object.keys(KIND_WEIGHTS) as AssetKind[]) {
        const q = computeQuality(m, kind);
        expect(Number.isFinite(q)).toBe(true);
        expect(q).toBeGreaterThanOrEqual(0);
        expect(q).toBeLessThanOrEqual(100);
      }
    }
  });

  it('is pure — repeated calls give an identical number', () => {
    const m = metrics({ faceArea: 0.2, yaw: -8, occlusion: 0.1 });
    expect(computeQuality(m, 'portrait')).toBe(computeQuality(m, 'portrait'));
  });
});

describe('computeQuality — kind weighting', () => {
  it('never consults face terms for logos and backplates', () => {
    const bare = metrics();
    const enriched = metrics({
      faceArea: 0.6,
      yaw: 75,
      pitch: 40,
      occlusion: 0.9,
      faceBox: { x: 0, y: 0, w: 100, h: 100, confidence: 0.99 },
    });
    for (const kind of ['logo', 'backplate'] as const) {
      expect(isFaceless(kind)).toBe(true);
      expect(computeQuality(enriched, kind)).toBe(computeQuality(bare, kind));
    }
    // …while the same enrichment absolutely moves a portrait.
    expect(computeQuality(enriched, 'portrait')).not.toBe(computeQuality(bare, 'portrait'));
  });

  it('scores a faceless kind without a faceBox present (no division by an absent box)', () => {
    const q = computeQuality({ width: 1024, height: 1024, sharpness: 300, brightness: 100, contrast: 0.25 }, 'logo');
    expect(Number.isFinite(q)).toBe(true);
    expect(q).toBeGreaterThan(0);
  });

  it('weights face terms far heavier for portraits than for full-body shots', () => {
    const poor = metrics({ faceArea: 0.01, yaw: 55 });
    const good = metrics({ faceArea: 0.22, yaw: 0 });
    const portraitGain = computeQuality(good, 'portrait') - computeQuality(poor, 'portrait');
    const fullbodyGain = computeQuality(good, 'fullbody') - computeQuality(poor, 'fullbody');
    expect(portraitGain).toBeGreaterThan(fullbodyGain * 2);
  });

  it('weights resolution heaviest for full-body shots', () => {
    const small = metrics({ width: 600, height: 900 });
    const large = metrics({ width: 4000, height: 6000 });
    const fullbodyGain = computeQuality(large, 'fullbody') - computeQuality(small, 'fullbody');
    const portraitGain = computeQuality(large, 'portrait') - computeQuality(small, 'portrait');
    expect(fullbodyGain).toBeGreaterThan(portraitGain);
  });

  it('keeps every kind weight table normalised and face-free where it should be', () => {
    for (const [kind, weights] of Object.entries(KIND_WEIGHTS)) {
      const sum = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum).toBeCloseTo(1, 6);
      if (kind === 'logo' || kind === 'backplate') {
        expect(weights.faceArea).toBeUndefined();
        expect(weights.frontality).toBeUndefined();
      }
    }
  });
});

describe('facing', () => {
  it('derives facing from yaw with a ±12° front band', () => {
    expect(facingOf({ yaw: -30 })).toBe('left');
    expect(facingOf({ yaw: -12 })).toBe('front');
    expect(facingOf({ yaw: 0 })).toBe('front');
    expect(facingOf({ yaw: 12 })).toBe('front');
    expect(facingOf({ yaw: 12.5 })).toBe('right');
    expect(facingOf({ yaw: undefined })).toBe('front');
    expect(facingOf(undefined)).toBe('front');
  });

  it('lets a front-facing subject satisfy any request', () => {
    const front = asset({ metrics: { ...metrics({ yaw: 3 }), quality: 0 } });
    expect(explainScore(front, { facing: 'left' }, NOW).facingPenalty).toBe(0);
    expect(explainScore(front, { facing: 'right' }, NOW).facingPenalty).toBe(0);
  });

  it('penalises — but never discards — a subject facing the wrong way', () => {
    const looksLeft = asset({ metrics: { ...metrics({ yaw: -35 }), quality: 0 } });
    const wanted = explainScore(looksLeft, { facing: 'left' }, NOW);
    const mirrored = explainScore(looksLeft, { facing: 'right' }, NOW);
    expect(wanted.facingPenalty).toBe(0);
    expect(mirrored.facingPenalty).toBe(FACING_MISMATCH_PENALTY);
    expect(mirrored.total).toBeCloseTo(Math.max(0, wanted.total - FACING_MISMATCH_PENALTY), 6);
    expect(mirrored.total).toBeGreaterThan(0); // still usable: the compositor mirrors it
  });

  it('ranks a correctly-facing asset above an equal mirrored one, without dropping either', () => {
    const left = asset({ id: 'left', metrics: { ...metrics({ yaw: -35 }), quality: 0 } });
    const right = asset({ id: 'right', metrics: { ...metrics({ yaw: 35 }), quality: 0 } });
    const ranked = rankAssets([left, right], { facing: 'right' }, NOW);
    expect(ranked.map((a) => a.id)).toEqual(['right', 'left']);
  });
});

describe('scoreAsset', () => {
  it('applies query weights as multipliers on the kind weights', () => {
    const bigFace = asset({ id: 'bigface', metrics: { ...metrics({ faceArea: 0.22, sharpness: 90 }), quality: 0 } });
    const sharpSmallFace = asset({ id: 'sharp', metrics: { ...metrics({ faceArea: 0.02, sharpness: 900 }), quality: 0 } });

    const sharpnessFirst = rankAssets([bigFace, sharpSmallFace], { weights: { sharpness: 3 } }, NOW);
    const faceFirst = rankAssets([bigFace, sharpSmallFace], { weights: { faceArea: 4 } }, NOW);

    expect(sharpnessFirst[0]!.id).toBe('sharp');
    expect(faceFirst[0]!.id).toBe('bigface');
  });

  it('adds a recency bonus that decays with age and is absent without a capture date', () => {
    expect(recencyBonus('2026-01-01T00:00:00Z', NOW)).toBeCloseTo(RECENCY_MAX_BONUS, 6);
    expect(recencyBonus('2025-01-01T00:00:00Z', NOW)).toBeLessThan(RECENCY_MAX_BONUS);
    expect(recencyBonus('2025-01-01T00:00:00Z', NOW)).toBeGreaterThan(0);
    expect(recencyBonus('2015-01-01T00:00:00Z', NOW)).toBe(0);
    expect(recencyBonus(undefined, NOW)).toBe(0);
    expect(recencyBonus('not a date', NOW)).toBe(0);
  });

  it('prefers the fresher of two otherwise identical photos', () => {
    const old = asset({ id: 'old', provenance: { ...asset().provenance, capturedAt: '2019-05-01T00:00:00Z' } });
    const fresh = asset({ id: 'fresh', provenance: { ...asset().provenance, capturedAt: '2025-11-01T00:00:00Z' } });
    expect(scoreAsset(fresh, {}, NOW)).toBeGreaterThan(scoreAsset(old, {}, NOW));
    // …and the recency weight can be dialled out entirely.
    expect(scoreAsset(fresh, { weights: { recency: 0 } }, NOW)).toBe(scoreAsset(old, { weights: { recency: 0 } }, NOW));
  });

  it('is deterministic and clamped to 0–100', () => {
    const a = asset({ provenance: { ...asset().provenance, capturedAt: '2025-12-31T00:00:00Z' } });
    const first = scoreAsset(a, { facing: 'left', weights: { faceArea: 2, recency: 3 } }, NOW);
    const second = scoreAsset(a, { facing: 'left', weights: { faceArea: 2, recency: 3 } }, NOW);
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(100);
  });

  it('cannot be inflated past 100 by asking for everything at once', () => {
    const perfect = asset({
      metrics: { ...metrics({ sharpness: 5000, width: 8000, height: 8000, faceArea: 0.22, yaw: 0, pitch: 0, occlusion: 0 }), quality: 0 },
      provenance: { ...asset().provenance, capturedAt: '2026-01-01T00:00:00Z' },
    });
    const score = scoreAsset(perfect, { weights: { faceArea: 99, sharpness: 99, frontality: 99, recency: 99 } }, NOW);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('rankAssets', () => {
  it('sorts best-first and breaks ties by id so runs are reproducible', () => {
    const b = asset({ id: 'b' });
    const a = asset({ id: 'a' });
    expect(rankAssets([b, a], {}, NOW).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const list = [asset({ id: 'b' }), asset({ id: 'a' })];
    const copy = [...list];
    rankAssets(list, {}, NOW);
    expect(list).toEqual(copy);
  });

  it('scores every asset against the same clock within one pass', () => {
    const fresh = asset({ id: 'fresh', provenance: { ...asset().provenance, capturedAt: '2025-12-01T00:00:00Z' } });
    const stale = asset({ id: 'stale', provenance: { ...asset().provenance, capturedAt: '2023-01-01T00:00:00Z' } });
    expect(rankAssets([stale, fresh], {}, NOW).map((a) => a.id)).toEqual(['fresh', 'stale']);
  });
});
