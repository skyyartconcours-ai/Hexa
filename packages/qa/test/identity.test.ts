import { describe, expect, it } from 'vitest';
import { cosine, identityGate } from '../src/gates/identity.js';
import type { VisionPort } from '../src/types.js';
import { ctx, embedding, flatBackground } from './helpers.js';

const FACE = { x: 0.28, y: 0.16, w: 0.18, h: 0.26 };

function subject(embeddings: number[][], overrides: Record<string, unknown> = {}) {
  return { playerId: 'peyz', handle: 'Peyz', faceRect: FACE, referenceEmbeddings: embeddings, ...overrides };
}

function port(vector: number[] | null, available = true): VisionPort {
  return {
    available: async () => available,
    embed: async () => (vector ? { vector } : null),
  };
}

describe('identityGate', () => {
  it('warns — never silently passes — when no embedder is available', async () => {
    const image = await flatBackground('#202030');
    const findings = await identityGate.run(ctx(image, { subjects: [subject([embedding(1)])] }));

    expect(findings.some((f) => f.severity === 'pass')).toBe(false);
    const warn = findings.find((f) => f.severity === 'warn');
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/could not be verified/i);
    expect(warn!.message).toMatch(/UNVERIFIED/);
    expect(warn!.suggestion).toMatch(/ctx\.vision|HEXA_VISION_URL/);
  });

  it('warns when the port exists but reports itself unavailable', async () => {
    const image = await flatBackground('#202030');
    const findings = await identityGate.run(
      ctx(image, { subjects: [subject([embedding(1)])], vision: port(embedding(1), false) }),
    );
    expect(findings.every((f) => f.severity === 'warn')).toBe(true);
  });

  it('fails a face that does not match the reference gallery', async () => {
    const image = await flatBackground('#202030');
    const findings = await identityGate.run(
      ctx(image, {
        subjects: [subject([embedding(1), embedding(2)])],
        vision: port(embedding(99)), // an unrelated person
      }),
    );
    const fail = findings.find((f) => f.severity === 'fail');
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/does not match the reference gallery/);
    expect(fail!.message).toMatch(/cosine similarity -?\d\.\d{3}/);
    expect(fail!.subjectId).toBe('peyz');
    expect(fail!.suggestion).toBeTruthy();
  });

  it('passes the real player and reports the measured similarity', async () => {
    const image = await flatBackground('#202030');
    const gallery = [embedding(1), embedding(2)];
    const findings = await identityGate.run(
      ctx(image, { subjects: [subject(gallery)], vision: port(gallery[1]!) }),
    );
    expect(findings.filter((f) => f.severity === 'fail')).toEqual([]);
    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass!.message).toMatch(/verified: best cosine similarity 1\.000/);
  });

  it('honours request.identityThreshold', async () => {
    const image = await flatBackground('#202030');
    const gallery = [embedding(1)];
    const near = gallery[0]!.map((v, i) => v + (i % 7 === 0 ? 0.06 : 0)); // partially perturbed
    const loose = await identityGate.run(
      ctx(image, { subjects: [subject(gallery)], vision: port(near), request: { identityThreshold: 0.5 } }),
    );
    const strict = await identityGate.run(
      ctx(image, { subjects: [subject(gallery)], vision: port(near), request: { identityThreshold: 0.999 } }),
    );
    expect(loose.some((f) => f.severity === 'pass')).toBe(true);
    expect(strict.some((f) => f.severity === 'fail')).toBe(true);
  });

  it('skips anonymous subjects and flags subjects with no gallery', async () => {
    const image = await flatBackground('#202030');
    const findings = await identityGate.run(
      ctx(image, {
        subjects: [
          { playerId: 'x', handle: 'Silhouette', anonymous: true },
          { playerId: 'y', handle: 'NoGallery' },
        ],
      }),
    );
    expect(findings.find((f) => f.subjectId === 'x')!.severity).toBe('pass');
    expect(findings.find((f) => f.subjectId === 'y')!.severity).toBe('warn');
  });

  it('refuses to compare embeddings from different models', async () => {
    const image = await flatBackground('#202030');
    const findings = await identityGate.run(
      ctx(image, { subjects: [subject([embedding(1, 512)])], vision: port(embedding(1, 128)) }),
    );
    expect(findings[0]!.severity).toBe('warn');
    expect(findings[0]!.message).toMatch(/different models/);
  });
});

describe('cosine', () => {
  it('is 1 for identical vectors and null for mismatched dimensions', () => {
    const v = embedding(5, 64);
    expect(cosine(v, v)).toBeCloseTo(1, 6);
    expect(cosine(v, embedding(5, 32))).toBeNull();
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });
});
