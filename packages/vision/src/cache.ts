/**
 * Content-addressed disk cache for detections and embeddings.
 *
 * A single thumbnail render can touch the same six reference photos a dozen
 * times (asset scoring, cutout, composition, then the identity gate). Embedding
 * a face costs ~300ms of ONNX on CPU, so re-deriving it every pass is the
 * difference between a snappy tool and a slow one. Entries are keyed by the
 * sha256 of the image bytes, so they survive file moves and are shared between
 * runs.
 *
 * The cache is strictly an accelerator: every operation swallows its own errors
 * and degrades to a miss. A broken cache must never break a render.
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Logger } from '@hexa/core';

/** Bump when a cached payload's shape changes; old entries then read as misses. */
const CACHE_VERSION = 1;

interface Envelope<T> {
  v: number;
  ns: string;
  at: string;
  data: T;
}

export function defaultCacheDir(): string {
  const explicit = process.env.HEXA_VISION_CACHE_DIR;
  if (explicit) return explicit;
  const base = process.env.HEXA_CACHE_DIR;
  if (base) return join(base, 'vision');
  try {
    return join(homedir(), '.cache', 'hexa', 'vision');
  } catch {
    return join(tmpdir(), 'hexa-vision-cache');
  }
}

export class DiskCache {
  private readonly dir: string;
  private readonly log?: Logger;
  private readonly mem = new Map<string, unknown>();
  private disabled = false;

  constructor(dir: string, log?: Logger) {
    this.dir = dir;
    this.log = log;
  }

  private file(ns: string, key: string): string {
    // Two-char fan-out keeps directories from reaching six figures of entries.
    return join(this.dir, sanitise(ns), key.slice(0, 2), `${key}.json`);
  }

  async get<T>(ns: string, key: string): Promise<T | undefined> {
    const memKey = `${ns}/${key}`;
    if (this.mem.has(memKey)) return this.mem.get(memKey) as T;
    if (this.disabled) return undefined;
    try {
      const raw = await readFile(this.file(ns, key), 'utf8');
      const env = JSON.parse(raw) as Envelope<T>;
      if (env.v !== CACHE_VERSION || env.ns !== ns) return undefined;
      this.mem.set(memKey, env.data);
      return env.data;
    } catch {
      return undefined;
    }
  }

  async set<T>(ns: string, key: string, data: T): Promise<void> {
    this.mem.set(`${ns}/${key}`, data);
    if (this.disabled) return;
    const path = this.file(ns, key);
    const env: Envelope<T> = { v: CACHE_VERSION, ns, at: new Date().toISOString(), data };
    try {
      await mkdir(dirname(path), { recursive: true });
      // Write-then-rename would be safer against concurrent writers, but entries
      // are content-addressed and idempotent: the worst case is a truncated file
      // that fails JSON.parse on read and reads as a miss.
      await writeFile(path, JSON.stringify(env), 'utf8');
    } catch (err) {
      // Read-only home, no disk space, sandboxed process — all survivable.
      this.disabled = true;
      this.log?.debug('vision cache disabled (write failed)', String(err));
    }
  }

  /** Drop everything under this cache's directory. */
  async clear(): Promise<void> {
    this.mem.clear();
    try {
      await rm(this.dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function sanitise(ns: string): string {
  return ns.replace(/[^a-zA-Z0-9._-]/g, '_');
}
