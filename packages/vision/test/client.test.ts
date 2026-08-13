/**
 * Degradation tests. None of these require the Python sidecar — that is the
 * point: they assert the tool keeps working when it is absent.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isHexaError, createLogger } from '@hexa/core';
import { VisionClient } from '../src/client.js';

/** A port nothing is listening on: bind an ephemeral port, then release it. */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        server.close();
        reject(new Error('no port'));
        return;
      }
      const { port } = addr;
      server.close(() => resolve(port));
    });
  });
}

let endpoint: string;
let cacheDir: string;
const silent = createLogger('silent');

/** Throwaway cache dirs, all removed at the end of the file. */
const tempDirs: string[] = [];
function tempCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hexa-vision-test-'));
  tempDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  endpoint = `http://127.0.0.1:${await closedPort()}`;
  cacheDir = tempCacheDir();
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () => new VisionClient({ endpoint, cacheDir, logger: silent });

describe('available()', () => {
  it('returns false quickly when nothing is listening', async () => {
    const started = Date.now();
    const ok = await client().available();
    const elapsed = Date.now() - started;
    expect(ok).toBe(false);
    expect(elapsed).toBeLessThan(2000);
  });

  it('never throws, even on a garbage endpoint', async () => {
    const bad = new VisionClient({ endpoint: 'http://nonexistent.invalid:1', cacheDir, logger: silent, timeoutMs: 500 });
    await expect(bad.available()).resolves.toBe(false);
  });

  it('memoises the probe: repeated calls hit the network once', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = client();
    expect(await c.available()).toBe(false);
    expect(await c.available()).toBe(false);
    expect(await c.available()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight probe between concurrent callers', async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((_, reject) => {
          setTimeout(() => reject(new Error('ECONNREFUSED')), 20);
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = client();
    const results = await Promise.all([c.available(), c.available(), c.available(), c.available()]);
    expect(results).toEqual([false, false, false, false]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps the health probe well below a long request timeout', async () => {
    // A sidecar that accepts the connection then hangs must not stall a render:
    // the probe aborts at ~1.5s even though timeoutMs is 30s.
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = new VisionClient({ endpoint, cacheDir, logger: silent, timeoutMs: 30_000 });
    const started = Date.now();
    expect(await c.available()).toBe(false);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('honours a shorter caller timeout for the probe', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = new VisionClient({ endpoint, cacheDir, logger: silent, timeoutMs: 120 });
    const started = Date.now();
    expect(await c.available()).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('treats a non-ok health body as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'degraded' }), { status: 200 })),
    );
    expect(await client().available()).toBe(false);
  });
});

describe('graceful degradation with no sidecar', () => {
  it('embed() returns null instead of throwing', async () => {
    await expect(client().embed(Buffer.from('not-really-an-image'))).resolves.toBeNull();
  });

  it('embedBatch() returns one null per input, preserving order and length', async () => {
    const inputs = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];
    const out = await client().embedBatch(inputs);
    expect(out).toHaveLength(3);
    expect(out).toEqual([null, null, null]);
  });

  it('embedBatch([]) short-circuits', async () => {
    await expect(client().embedBatch([])).resolves.toEqual([]);
  });

  it('similarity() throws HexaError VISION_UNAVAILABLE with a runnable hint', async () => {
    try {
      await client().similarity(Buffer.from('a'), Buffer.from('b'));
      expect.unreachable('similarity must not silently succeed without the sidecar');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      if (isHexaError(err)) {
        expect(err.code).toBe('VISION_UNAVAILABLE');
        expect(err.hint).toContain('services/vision/run.sh');
      }
    }
  });
});

/** Distinct bytes per call so the content-addressed cache cannot cross-talk. */
let seed = 0;
const uniqueBytes = () => Buffer.from(`hexa-test-${seed++}-${Math.random()}`);

/** A sidecar that is up but whose ML models are missing (failed pip/download). */
function modellessSidecar() {
  return vi.fn(async (url: string) => {
    if (String(url).endsWith('/health')) {
      return new Response(JSON.stringify({ status: 'ok', version: '0.1.0', models: { faceModel: 'buffalo_l' } }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({ error: { code: 'MODEL_UNAVAILABLE', message: 'insightface is not installed' } }),
      { status: 503 },
    );
  });
}

describe('sidecar up, models missing', () => {
  it('embed() returns null and stops re-asking for the missing model', async () => {
    const fetchMock = modellessSidecar();
    vi.stubGlobal('fetch', fetchMock);
    const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });

    expect(await c.embed(uniqueBytes())).toBeNull();
    const afterFirst = fetchMock.mock.calls.length;
    expect(afterFirst).toBe(2); // /health + /embed

    expect(await c.embed(uniqueBytes())).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(afterFirst); // latched: no second 503
  });

  it('similarity() reports VISION_UNAVAILABLE, not a generic provider error', async () => {
    vi.stubGlobal('fetch', modellessSidecar());
    const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });
    try {
      await c.similarity(uniqueBytes(), uniqueBytes());
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      if (isHexaError(err)) expect(err.code).toBe('VISION_UNAVAILABLE');
    }
  });
});

describe('sidecar up and healthy', () => {
  const face = {
    box: { x: 10, y: 20, w: 100, h: 120, confidence: 0.93 },
    landmarks: {
      leftEye: [40, 60],
      rightEye: [80, 60],
      nose: [60, 85],
      mouthLeft: [45, 105],
      mouthRight: [75, 105],
    },
    yaw: -4.2,
    pitch: 1.1,
    roll: 0.3,
  };

  function healthySidecar() {
    return vi.fn(async (url: string) => {
      const path = String(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.endsWith('/health')) {
        return json({ status: 'ok', version: '0.1.0', models: { faceModel: 'buffalo_l' } });
      }
      if (path.endsWith('/detect')) return json({ faces: [face], width: 640, height: 480, model: 'buffalo_l' });
      if (path.endsWith('/embed')) {
        return json({ embedding: [0.1, 0.2, 0.3], model: 'buffalo_l', faceBox: face.box });
      }
      if (path.endsWith('/similarity')) return json({ similarity: 0.71 });
      return json({});
    });
  }

  it('maps detections, including landmarks and pose', async () => {
    vi.stubGlobal('fetch', healthySidecar());
    const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });
    const faces = await c.detectFaces(uniqueBytes());
    expect(faces).toHaveLength(1);
    expect(faces[0]!.box.confidence).toBe(0.93);
    expect(faces[0]!.landmarks?.leftEye).toEqual([40, 60]);
    expect(faces[0]!.yaw).toBe(-4.2);
  });

  it('caches detections on disk so a repeat call costs no round trip', async () => {
    const fetchMock = healthySidecar();
    vi.stubGlobal('fetch', fetchMock);
    const cacheDirLocal = tempCacheDir();
    const bytes = uniqueBytes();

    const first = new VisionClient({ endpoint, cacheDir: cacheDirLocal, logger: silent });
    await first.detectFaces(bytes);
    const afterFirst = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/detect')).length;
    expect(afterFirst).toBe(1);

    // A different client instance — the hit has to come off disk, not memory.
    const second = new VisionClient({ endpoint, cacheDir: cacheDirLocal, logger: silent });
    const faces = await second.detectFaces(bytes);
    expect(faces[0]!.box.confidence).toBe(0.93);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/detect')).length).toBe(1);
  });

  it('returns embeddings and reuses them from cache', async () => {
    const fetchMock = healthySidecar();
    vi.stubGlobal('fetch', fetchMock);
    const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });
    const bytes = uniqueBytes();

    const emb = await c.embed(bytes);
    expect(emb?.vector).toEqual([0.1, 0.2, 0.3]);
    expect(emb?.model).toBe('buffalo_l');
    expect(emb?.box).toEqual(face.box);

    await c.embed(bytes);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/embed')).length).toBe(1);
  });

  it('returns a similarity number when the sidecar can measure one', async () => {
    vi.stubGlobal('fetch', healthySidecar());
    const c = new VisionClient({ endpoint, cacheDir: tempCacheDir(), logger: silent });
    await expect(c.similarity(uniqueBytes(), uniqueBytes())).resolves.toBe(0.71);
  });
});

describe('input validation', () => {
  it('rejects an empty buffer', async () => {
    await expect(client().detectFaces(Buffer.alloc(0))).rejects.toThrow();
  });

  it('reports undecodable bytes as a typed IO_ERROR, not a raw sharp error', async () => {
    try {
      await client().detectFaces(Buffer.from('this is not an image at all'));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      if (isHexaError(err)) expect(err.code).toBe('IO_ERROR');
    }
  });

  it('reports a missing file as IO_ERROR', async () => {
    try {
      await client().detectFaces('/definitely/not/here/nope.png');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      if (isHexaError(err)) expect(err.code).toBe('IO_ERROR');
    }
  });
});
