/**
 * On-disk memoisation for derived artefacts.
 *
 * Segmentation is the slowest step in the pipeline by a wide margin — a matted
 * cutout with refined hair edges costs seconds of Python — and it is perfectly
 * deterministic given the same source file and options. Caching it is the
 * difference between iterating on a design and waiting on one.
 *
 * The key covers the asset id, the options *and* a stamp of the source file, so
 * re-cropping a photograph in place invalidates its cutout rather than serving a
 * stale mask. Every failure here is swallowed: a cache that cannot be read or
 * written is a performance problem, never a correctness one.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface CacheKeyInput {
  /** Namespace, e.g. `cutout`. Becomes a subdirectory. */
  kind: string;
  /** Identity of the source — usually a ReferenceAsset id. */
  id: string;
  /** Anything that changes the output: segmentation options, versions. */
  options?: Record<string, unknown>;
  /** Source file fingerprint; see {@link stampFile}. */
  stamp?: string;
}

/** Stable hash of a key. Object key order does not affect the result. */
export function cacheKey(input: CacheKeyInput): string {
  const canonical = JSON.stringify([input.kind, input.id, sortedEntries(input.options ?? {}), input.stamp ?? '']);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function sortedEntries(o: Record<string, unknown>): [string, unknown][] {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? sortedEntries(v as Record<string, unknown>) : v]);
}

/**
 * Cheap fingerprint of a file: size and mtime. Not a content hash — hashing a
 * 12MP photograph to decide whether to skip work it would take three seconds to
 * redo is a poor trade, and mtime+size catches every realistic edit.
 */
export async function stampFile(file: string): Promise<string | undefined> {
  try {
    const st = await fs.stat(file);
    return `${st.size}:${Math.trunc(st.mtimeMs)}`;
  } catch {
    return undefined;
  }
}

function entryPath(cacheDir: string, input: CacheKeyInput, ext: string): string {
  return path.join(cacheDir, input.kind, `${cacheKey(input)}${ext}`);
}

/** Cached bytes, or `undefined` on any miss or failure. */
export async function readCache(cacheDir: string | undefined, input: CacheKeyInput, ext = '.png'): Promise<Buffer | undefined> {
  if (!cacheDir) return undefined;
  try {
    return await fs.readFile(entryPath(cacheDir, input, ext));
  } catch {
    return undefined;
  }
}

/**
 * Store bytes. Writes to a temporary file and renames, so a crash mid-write
 * cannot leave a truncated PNG that later reads as a valid cache hit.
 *
 * @returns the path written, or `undefined` if caching was skipped or failed
 */
export async function writeCache(
  cacheDir: string | undefined,
  input: CacheKeyInput,
  data: Buffer,
  ext = '.png',
): Promise<string | undefined> {
  if (!cacheDir || data.length === 0) return undefined;
  const dest = entryPath(cacheDir, input, ext);
  const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, dest);
    return dest;
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    return undefined;
  }
}

/** Delete a namespace, or the whole cache. Returns bytes reclaimed. */
export async function clearCache(cacheDir: string | undefined, kind?: string): Promise<number> {
  if (!cacheDir) return 0;
  const target = kind ? path.join(cacheDir, kind) : cacheDir;
  const bytes = await cacheSize(target);
  await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
  return bytes;
}

export async function cacheSize(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await cacheSize(full);
      else {
        const st = await fs.stat(full).catch(() => undefined);
        total += st?.size ?? 0;
      }
    }
  } catch {
    return total;
  }
  return total;
}
