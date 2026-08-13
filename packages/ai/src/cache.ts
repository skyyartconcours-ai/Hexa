/**
 * On-disk response cache.
 *
 * Re-rendering is the normal case in this tool: you tweak a headline, nudge a
 * crop, try four variants of the same layout. None of that should re-bill a
 * generation call, and none of it should wait 20 seconds for a plate that has
 * not changed. The key is a hash of the *entire* request — prompt, negative
 * prompt, size, seed, style, palette, provider and model — so any change that
 * would alter the pixels also changes the key, and nothing else does.
 *
 * Cache failures are never fatal. A read miss, a corrupt entry, a read-only
 * cache directory: all of them degrade to "call the provider", because a
 * broken cache must not be able to break a render.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GeneratedImage } from './types.js';

export interface AiCacheOptions {
  dir?: string;
  ttlMs?: number;
  enabled?: boolean;
}

/** Thirty days: long enough to survive a project, short enough to self-clean. */
export const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HEXA_AI_CACHE_DIR?.trim()) return env.HEXA_AI_CACHE_DIR.trim();
  const base = env.XDG_CACHE_HOME?.trim() || path.join(os.homedir() || os.tmpdir(), '.cache');
  return path.join(base, 'hexa', 'ai');
}

export function resolveCacheOptions(opts: AiCacheOptions = {}): Required<AiCacheOptions> {
  const envDisabled = process.env.HEXA_AI_CACHE === '0' || process.env.HEXA_AI_CACHE === 'false';
  return {
    dir: opts.dir ?? defaultCacheDir(),
    ttlMs: opts.ttlMs ?? DEFAULT_CACHE_TTL_MS,
    enabled: opts.enabled ?? !envDisabled,
  };
}

/**
 * Deterministic serialisation. Object keys are sorted so that two structurally
 * identical requests hash the same regardless of construction order, and
 * Buffers collapse to their own digest so a 4 MB reference photo does not have
 * to be stringified to be keyed on.
 */
function stableify(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) {
    return { __buf: createHash('sha256').update(value).digest('hex'), len: value.length };
  }
  if (ArrayBuffer.isView(value)) {
    return stableify(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) return value.map(stableify);
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue;
      out[key] = stableify(src[key]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

/** Stable content hash of an arbitrary request descriptor. */
export function cacheKey(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableify(parts))).digest('hex').slice(0, 40);
}

interface CacheSidecar {
  width: number;
  height: number;
  provider: string;
  model: string;
  seed?: number;
  cost?: number;
  promptUsed: string;
  revisedPrompt?: string;
  storedAt: number;
  ext: string;
}

function paths(dir: string, key: string): { meta: string; bin: (ext: string) => string } {
  const shard = key.slice(0, 2);
  const base = path.join(dir, shard);
  return {
    meta: path.join(base, `${key}.json`),
    bin: (ext: string) => path.join(base, `${key}.${ext}`),
  };
}

/** Look up a cached image. Returns undefined on miss, expiry or any failure. */
export async function readCache(
  key: string,
  opts: AiCacheOptions = {},
): Promise<GeneratedImage | undefined> {
  const { dir, ttlMs, enabled } = resolveCacheOptions(opts);
  if (!enabled) return undefined;
  const p = paths(dir, key);
  try {
    const meta = JSON.parse(await fs.readFile(p.meta, 'utf8')) as CacheSidecar;
    if (!meta || typeof meta.storedAt !== 'number') return undefined;
    if (isExpired(meta.storedAt, ttlMs)) return undefined;
    const buffer = await fs.readFile(p.bin(meta.ext || 'png'));
    if (buffer.length === 0) return undefined;
    return {
      buffer,
      width: meta.width,
      height: meta.height,
      provider: meta.provider,
      model: meta.model,
      seed: meta.seed,
      cost: meta.cost,
      promptUsed: meta.promptUsed,
      revisedPrompt: meta.revisedPrompt,
    };
  } catch {
    return undefined;
  }
}

/** Store an image. Best effort — a failed write is silently ignored. */
export async function writeCache(
  key: string,
  image: GeneratedImage,
  opts: AiCacheOptions = {},
): Promise<void> {
  const { dir, enabled } = resolveCacheOptions(opts);
  if (!enabled || !Buffer.isBuffer(image.buffer) || image.buffer.length === 0) return;
  const ext = sniffExtension(image.buffer);
  const p = paths(dir, key);
  const sidecar: CacheSidecar = {
    width: image.width,
    height: image.height,
    provider: image.provider,
    model: image.model,
    seed: image.seed,
    cost: image.cost,
    promptUsed: image.promptUsed,
    revisedPrompt: image.revisedPrompt,
    storedAt: Date.now(),
    ext,
  };
  try {
    await fs.mkdir(path.dirname(p.meta), { recursive: true });
    // Write the payload first: a sidecar without its image is a miss, but a
    // sidecar pointing at a half-written image would be a corrupt hit.
    await writeAtomic(p.bin(ext), image.buffer);
    await writeAtomic(p.meta, Buffer.from(JSON.stringify(sidecar), 'utf8'));
  } catch {
    /* cache is an optimisation, never a dependency */
  }
}

async function writeAtomic(target: string, data: Buffer): Promise<void> {
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, target);
}

/** Delete expired entries. Returns how many were removed. */
export async function pruneCache(opts: AiCacheOptions = {}): Promise<number> {
  const { dir, ttlMs } = resolveCacheOptions(opts);
  let removed = 0;
  try {
    const shards = await fs.readdir(dir, { withFileTypes: true });
    for (const shard of shards) {
      if (!shard.isDirectory()) continue;
      const shardDir = path.join(dir, shard.name);
      for (const name of await fs.readdir(shardDir)) {
        if (!name.endsWith('.json')) continue;
        const metaPath = path.join(shardDir, name);
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as CacheSidecar;
          if (isExpired(meta.storedAt, ttlMs)) {
            await fs.rm(metaPath, { force: true });
            await fs.rm(path.join(shardDir, `${name.slice(0, -5)}.${meta.ext || 'png'}`), { force: true });
            removed++;
          }
        } catch {
          /* skip unreadable entries */
        }
      }
    }
  } catch {
    /* no cache directory yet */
  }
  return removed;
}

/**
 * A finite TTL expires an entry once it is at least that old; pass `Infinity`
 * for an entry that should never expire. A zero or negative TTL therefore means
 * "nothing is fresh", which is the intuitive reading and makes `ttlMs: 0` a
 * usable way to force a refresh.
 */
function isExpired(storedAt: number, ttlMs: number): boolean {
  if (!Number.isFinite(ttlMs)) return false;
  return Date.now() - storedAt >= ttlMs;
}

function sniffExtension(buf: Buffer): string {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return 'bin';
}
