/**
 * Adversarial suite for what the client will accept as "an embedding".
 *
 * The identity gate compares whatever `VisionClient.embed()` hands it, and
 * whatever it hands back is also written to the on-disk cache and, through the
 * ingest path, into `ReferenceAsset.embedding` in the library manifest. So a
 * sidecar having a bad day — weights that failed to download, a model returning
 * zeros, a numeric overflow — does not just produce one wrong answer: it
 * *persists* one.
 *
 * A degenerate vector must therefore be refused at the boundary, and must never
 * be cached. "No usable face" is the honest answer; a zero vector dressed up as
 * an embedding is not.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hexa/core';
import { VisionClient } from '../src/client.js';

const silent = createLogger('silent');
const endpoint = 'http://127.0.0.1:8765';
const tempDirs: string[] = [];

function tempCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hexa-vision-trust-'));
  tempDirs.push(dir);
  return dir;
}

let counter = 0;
/** Distinct bytes per call so nothing is served from a content-addressed hit. */
function uniqueBytes(): Buffer {
  counter++;
  return Buffer.from(`bytes-${counter}-${Math.random()}`);
}

/** A sidecar that is healthy but returns `embedding` for every /embed call. */
function sidecarReturning(embedding: unknown) {
  return vi.fn(async (url: string) => {
    const path = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path.endsWith('/health')) {
      return json({ status: 'ok', version: '0.1.0', models: { faceModel: 'buffalo_l' } });
    }
    if (path.endsWith('/embed')) return json({ embedding, model: 'buffalo_l' });
    if (path.endsWith('/embed_batch')) return json({ embeddings: [{ embedding, model: 'buffalo_l' }], model: 'buffalo_l' });
    return json({});
  });
}

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('attack: a sidecar that returns a degenerate embedding', () => {
  const degenerate: Array<[string, unknown]> = [
    ['an all-zero vector', new Array(512).fill(0)],
    ['a vector containing NaN', [0.1, Number.NaN, 0.3]],
    ['a vector containing Infinity', [0.1, Number.POSITIVE_INFINITY, 0.3]],
    ['an empty vector', []],
    ['a vector of strings', ['0.1', '0.2']],
    ['a non-array', { '0': 0.1, '1': 0.2 }],
    ['null', null],
  ];

  for (const [label, embedding] of degenerate) {
    it(`refuses ${label} rather than passing it to the identity gate`, async () => {
      vi.stubGlobal('fetch', sidecarReturning(embedding));
      const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });
      await expect(c.embed(uniqueBytes())).resolves.toBeNull();
    });
  }

  it('refuses a degenerate vector from the batch path too', async () => {
    vi.stubGlobal('fetch', sidecarReturning(new Array(512).fill(0)));
    const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });
    await expect(c.embedBatch([uniqueBytes()])).resolves.toEqual([null]);
  });

  it('does not persist a degenerate vector to the cache', async () => {
    const fetchMock = sidecarReturning(new Array(512).fill(0));
    vi.stubGlobal('fetch', fetchMock);
    const cacheDir = tempCacheDir();
    const bytes = uniqueBytes();

    await new VisionClient({ endpoint, cacheDir, logger: silent }).embed(bytes);

    // A fresh client with a working sidecar must get the real answer, not a
    // cached zero vector from the run where the weights were missing.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', sidecarReturning([0.1, 0.2, 0.3]));
    const healthy = await new VisionClient({ endpoint, cacheDir, logger: silent }).embed(bytes);
    expect(healthy?.vector).toEqual([0.1, 0.2, 0.3]);
  });

  it('still returns a good embedding unchanged', async () => {
    vi.stubGlobal('fetch', sidecarReturning([0.1, 0.2, 0.3]));
    const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });
    const emb = await c.embed(uniqueBytes());
    expect(emb?.vector).toEqual([0.1, 0.2, 0.3]);
    expect(emb?.model).toBe('buffalo_l');
  });
});
