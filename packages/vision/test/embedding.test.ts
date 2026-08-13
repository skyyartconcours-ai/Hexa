import { describe, expect, it } from 'vitest';
import { isHexaError } from '@hexa/core';
import {
  DEFAULT_IDENTITY_THRESHOLD,
  bestSimilarity,
  cosineSimilarity,
  identityVerdict,
  meanEmbedding,
} from '../src/embedding.js';

const unit = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
};

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  it('never exceeds 1 despite float drift', () => {
    const v = unit([0.31, -0.77, 0.55, 0.12]);
    expect(cosineSimilarity(v, v)).toBeLessThanOrEqual(1);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 12);
  });

  it('returns 0 for orthogonal vectors and -1 for opposites', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 12);
  });

  it('is scale invariant', () => {
    expect(cosineSimilarity([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12);
  });

  it('returns 0 rather than NaN for a zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('throws a HexaError on dimension mismatch', () => {
    try {
      cosineSimilarity([1, 2, 3], [1, 2]);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      if (isHexaError(err)) expect(err.code).toBe('INVALID_REQUEST');
    }
  });

  it('throws on empty vectors', () => {
    expect(() => cosineSimilarity([], [])).toThrow();
  });
});

describe('meanEmbedding', () => {
  it('returns an L2-normalised vector', () => {
    const out = meanEmbedding([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 12);
    expect(out[0]).toBeCloseTo(out[1]!, 12);
  });

  it('normalises the single-vector case to the unit sphere', () => {
    const out = meanEmbedding([[3, 4]]);
    expect(out[0]).toBeCloseTo(0.6, 12);
    expect(out[1]).toBeCloseTo(0.8, 12);
  });

  it('is unaffected by the magnitude of its inputs', () => {
    const a = meanEmbedding([
      [1, 1, 0],
      [0, 1, 1],
    ]);
    const b = meanEmbedding([
      [100, 100, 0],
      [0, 1, 1],
    ]);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, 12);
  });

  it('sits closer to a tight cluster than to an outlier', () => {
    const cluster = [unit([1, 0.05, 0]), unit([1, -0.05, 0]), unit([0.98, 0.02, 0.02])];
    const centroid = meanEmbedding(cluster);
    expect(cosineSimilarity(centroid, cluster[0]!)).toBeGreaterThan(0.99);
    expect(cosineSimilarity(centroid, unit([0, 1, 0]))).toBeLessThan(0.2);
  });

  it('returns a zero vector when inputs cancel exactly', () => {
    const out = meanEmbedding([
      [1, 0],
      [-1, 0],
    ]);
    expect(out).toEqual([0, 0]);
  });

  it('throws on an empty gallery or a dimension mismatch', () => {
    expect(() => meanEmbedding([])).toThrow();
    expect(() => meanEmbedding([[1, 2], [1]])).toThrow();
  });
});

describe('bestSimilarity', () => {
  const probe = unit([1, 0, 0]);

  it('returns the maximum over the gallery', () => {
    const sim = bestSimilarity(probe, [unit([0, 1, 0]), unit([0.9, 0.1, 0]), unit([0.2, 0.9, 0])]);
    expect(sim).toBeCloseTo(cosineSimilarity(probe, unit([0.9, 0.1, 0])), 12);
  });

  it('is not dragged down by one bad reference angle', () => {
    const good = unit([0.95, 0.1, 0.05]);
    const bad = unit([-0.4, 0.9, 0]);
    expect(bestSimilarity(probe, [bad, good])).toBeGreaterThan(0.9);
  });

  it('returns -1 for an empty gallery so it fails every threshold', () => {
    expect(bestSimilarity(probe, [])).toBe(-1);
    expect(identityVerdict(bestSimilarity(probe, []), DEFAULT_IDENTITY_THRESHOLD).pass).toBe(false);
  });
});

describe('identityVerdict', () => {
  it('passes at or above the threshold', () => {
    expect(identityVerdict(0.45, 0.45).pass).toBe(true);
    expect(identityVerdict(0.62, 0.45).pass).toBe(true);
    expect(identityVerdict(0.4499, 0.45).pass).toBe(false);
  });

  it('reports the signed margin', () => {
    expect(identityVerdict(0.6, 0.45).margin).toBeCloseTo(0.15, 12);
    expect(identityVerdict(0.3, 0.45).margin).toBeCloseTo(-0.15, 12);
  });

  it('bands confidence by distance from the boundary, in both directions', () => {
    expect(identityVerdict(0.7, 0.45).confidence).toBe('high');
    expect(identityVerdict(0.1, 0.45).confidence).toBe('high');
    expect(identityVerdict(0.53, 0.45).confidence).toBe('medium');
    expect(identityVerdict(0.37, 0.45).confidence).toBe('medium');
    expect(identityVerdict(0.46, 0.45).confidence).toBe('low');
    expect(identityVerdict(0.44, 0.45).confidence).toBe('low');
  });

  it('honours a caller-supplied threshold', () => {
    expect(identityVerdict(0.5, 0.6).pass).toBe(false);
    expect(identityVerdict(0.5, 0.3).pass).toBe(true);
  });
});

describe('DEFAULT_IDENTITY_THRESHOLD', () => {
  it('sits in the defensible ArcFace operating band', () => {
    expect(DEFAULT_IDENTITY_THRESHOLD).toBeGreaterThanOrEqual(0.4);
    expect(DEFAULT_IDENTITY_THRESHOLD).toBeLessThanOrEqual(0.55);
  });

  it('rejects a typical impostor score and accepts a typical genuine one', () => {
    // Impostor pairs cluster near 0 with a tail to ~0.35; genuine cross-domain
    // pairs (photo vs graded render) land ~0.55-0.75.
    expect(identityVerdict(0.34, DEFAULT_IDENTITY_THRESHOLD).pass).toBe(false);
    expect(identityVerdict(0.58, DEFAULT_IDENTITY_THRESHOLD).pass).toBe(true);
  });
});
