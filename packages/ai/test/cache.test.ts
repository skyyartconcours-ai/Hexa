import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cacheKey,
  defaultCacheDir,
  pruneCache,
  readCache,
  resolveCacheOptions,
  writeCache,
  DEFAULT_CACHE_TTL_MS,
} from '../src/cache.js';
import type { GeneratedImage } from '../src/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'hexa-ai-cache-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const image = (over: Partial<GeneratedImage> = {}): GeneratedImage => ({
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
  width: 1280,
  height: 720,
  provider: 'stub',
  model: 'stub/gradient',
  seed: 7,
  cost: 0,
  promptUsed: 'empty arena, no people',
  ...over,
});

describe('cacheKey stability', () => {
  it('is stable for the same request', () => {
    const req = { prompt: 'empty arena', width: 1280, height: 720, seed: 4 };
    expect(cacheKey(req)).toBe(cacheKey({ ...req }));
  });

  it('ignores key order', () => {
    expect(cacheKey({ a: 1, b: 2, c: { d: 3, e: 4 } })).toBe(cacheKey({ c: { e: 4, d: 3 }, b: 2, a: 1 }));
  });

  it('ignores explicitly-undefined fields', () => {
    expect(cacheKey({ prompt: 'x', seed: undefined })).toBe(cacheKey({ prompt: 'x' }));
  });

  it('changes when any pixel-affecting field changes', () => {
    const base = { prompt: 'empty arena', width: 1280, height: 720, seed: 4, palette: ['#FFF'] };
    const key = cacheKey(base);
    expect(cacheKey({ ...base, prompt: 'empty stadium' })).not.toBe(key);
    expect(cacheKey({ ...base, width: 1281 })).not.toBe(key);
    expect(cacheKey({ ...base, height: 721 })).not.toBe(key);
    expect(cacheKey({ ...base, seed: 5 })).not.toBe(key);
    expect(cacheKey({ ...base, palette: ['#000'] })).not.toBe(key);
  });

  it('distinguishes array order', () => {
    expect(cacheKey({ palette: ['#A', '#B'] })).not.toBe(cacheKey({ palette: ['#B', '#A'] }));
  });

  it('hashes buffers by content, not by identity', () => {
    const a = Buffer.from('reference photograph bytes');
    const b = Buffer.from('reference photograph bytes');
    const c = Buffer.from('a different photograph');
    expect(cacheKey({ image: a })).toBe(cacheKey({ image: b }));
    expect(cacheKey({ image: a })).not.toBe(cacheKey({ image: c }));
  });

  it('handles non-finite numbers without collapsing them together', () => {
    expect(cacheKey({ n: Number.NaN })).not.toBe(cacheKey({ n: Number.POSITIVE_INFINITY }));
  });

  it('produces a filesystem-safe fixed-length key', () => {
    const key = cacheKey({ prompt: 'a/b\\c:*?"<>|', width: 10 });
    expect(key).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('cache read/write', () => {
  it('round-trips an image with its metadata', async () => {
    const key = cacheKey({ prompt: 'round trip' });
    await writeCache(key, image(), { dir });
    const hit = await readCache(key, { dir });
    expect(hit).toBeDefined();
    expect(hit!.buffer.equals(image().buffer)).toBe(true);
    expect(hit!.width).toBe(1280);
    expect(hit!.height).toBe(720);
    expect(hit!.provider).toBe('stub');
    expect(hit!.model).toBe('stub/gradient');
    expect(hit!.seed).toBe(7);
    expect(hit!.promptUsed).toBe('empty arena, no people');
  });

  it('misses on an unknown key', async () => {
    expect(await readCache(cacheKey({ nothing: true }), { dir })).toBeUndefined();
  });

  it('respects the TTL', async () => {
    const key = cacheKey({ prompt: 'expiring' });
    await writeCache(key, image(), { dir });
    expect(await readCache(key, { dir, ttlMs: 60_000 })).toBeDefined();
    expect(await readCache(key, { dir, ttlMs: -1 })).toBeUndefined();
  });

  it('is a no-op when disabled', async () => {
    const key = cacheKey({ prompt: 'disabled' });
    await writeCache(key, image(), { dir, enabled: false });
    expect(await readCache(key, { dir })).toBeUndefined();
    await writeCache(key, image(), { dir });
    expect(await readCache(key, { dir, enabled: false })).toBeUndefined();
  });

  it('never throws when the cache directory cannot be created', async () => {
    // A regular file where a directory needs to be: mkdir fails with ENOTDIR.
    const { writeFile } = await import('node:fs/promises');
    const blocker = path.join(dir, 'blocker');
    await writeFile(blocker, 'not a directory');
    const bad = path.join(blocker, 'cache');
    const key = cacheKey({ prompt: 'unwritable' });
    await expect(writeCache(key, image(), { dir: bad })).resolves.toBeUndefined();
    await expect(readCache(key, { dir: bad })).resolves.toBeUndefined();
  });

  it('never throws on a corrupt entry', async () => {
    const key = cacheKey({ prompt: 'corrupt' });
    await writeCache(key, image(), { dir });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, key.slice(0, 2), `${key}.json`), 'not json at all');
    expect(await readCache(key, { dir })).toBeUndefined();
  });

  it('skips empty buffers', async () => {
    const key = cacheKey({ prompt: 'empty' });
    await writeCache(key, image({ buffer: Buffer.alloc(0) }), { dir });
    expect(await readCache(key, { dir })).toBeUndefined();
  });

  it('shards entries so one directory does not accumulate everything', async () => {
    await writeCache(cacheKey({ n: 1 }), image(), { dir });
    await writeCache(cacheKey({ n: 2 }), image(), { dir });
    const shards = await readdir(dir);
    expect(shards.every((s) => /^[0-9a-f]{2}$/.test(s))).toBe(true);
  });

  it('leaves no temporary files behind', async () => {
    const key = cacheKey({ prompt: 'atomic' });
    await writeCache(key, image(), { dir });
    const files = await readdir(path.join(dir, key.slice(0, 2)));
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(files.sort()).toEqual([`${key}.json`, `${key}.png`]);
  });
});

describe('pruneCache', () => {
  it('removes expired entries and keeps fresh ones', async () => {
    const stale = cacheKey({ n: 'stale' });
    await writeCache(stale, image(), { dir });
    expect(await pruneCache({ dir, ttlMs: -1 })).toBe(1);
    expect(await readCache(stale, { dir })).toBeUndefined();

    const fresh = cacheKey({ n: 'fresh' });
    await writeCache(fresh, image(), { dir });
    expect(await pruneCache({ dir, ttlMs: 600_000 })).toBe(0);
    expect(await readCache(fresh, { dir })).toBeDefined();
  });

  it('is a no-op on a missing directory', async () => {
    expect(await pruneCache({ dir: path.join(dir, 'nope') })).toBe(0);
  });
});

describe('cache options', () => {
  it('defaults to a thirty-day TTL and an enabled cache', () => {
    const resolved = resolveCacheOptions();
    expect(resolved.ttlMs).toBe(DEFAULT_CACHE_TTL_MS);
    expect(resolved.enabled).toBe(true);
    expect(resolved.dir.length).toBeGreaterThan(0);
  });

  it('honours HEXA_AI_CACHE=0', () => {
    const prev = process.env.HEXA_AI_CACHE;
    process.env.HEXA_AI_CACHE = '0';
    try {
      expect(resolveCacheOptions().enabled).toBe(false);
      expect(resolveCacheOptions({ enabled: true }).enabled).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.HEXA_AI_CACHE;
      else process.env.HEXA_AI_CACHE = prev;
    }
  });

  it('honours HEXA_AI_CACHE_DIR', () => {
    expect(defaultCacheDir({ HEXA_AI_CACHE_DIR: '/tmp/somewhere' } as NodeJS.ProcessEnv)).toBe('/tmp/somewhere');
    expect(defaultCacheDir({ XDG_CACHE_HOME: '/xdg' } as NodeJS.ProcessEnv)).toBe(path.join('/xdg', 'hexa', 'ai'));
  });
});
