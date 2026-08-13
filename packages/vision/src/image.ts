/**
 * ImageInput resolution and content hashing.
 *
 * Everything downstream keys off the *content* hash, not the path, so moving or
 * renaming a reference photo does not invalidate its cached embedding, and two
 * copies of the same photo share one entry.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { HexaError } from '@hexa/core';
import type { ImageInput } from './types.js';

export interface ResolvedImage {
  bytes: Buffer;
  /** sha256 of the encoded bytes, hex. */
  hash: string;
  /** Absolute path, when the input was a path. */
  path?: string;
}

/**
 * Re-reading and re-hashing a 12MP JPEG for every stage of a render is wasteful,
 * so path inputs are memoised on (path, mtime, size). Bounded so a long-running
 * studio session cannot grow it without limit.
 */
const MEMO_LIMIT = 256;
const memo = new Map<string, ResolvedImage>();

function remember(key: string, value: ResolvedImage): ResolvedImage {
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next();
    if (!oldest.done) memo.delete(oldest.value);
  }
  memo.set(key, value);
  return value;
}

export function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function resolveImage(input: ImageInput): Promise<ResolvedImage> {
  if (Buffer.isBuffer(input)) {
    if (input.length === 0) {
      throw new HexaError('INVALID_REQUEST', 'received an empty image buffer');
    }
    return { bytes: input, hash: hashBytes(input) };
  }

  if (typeof input !== 'string' || input.trim() === '') {
    throw new HexaError('INVALID_REQUEST', 'ImageInput must be a filesystem path or a Buffer of encoded image bytes');
  }

  const path = isAbsolute(input) ? input : resolve(input);
  let info;
  try {
    info = await stat(path);
  } catch (cause) {
    throw new HexaError('IO_ERROR', `cannot read image at ${path}`, {
      hint: 'Pass an absolute path to an existing image, or pass the bytes directly as a Buffer.',
      cause,
    });
  }
  if (!info.isFile()) {
    throw new HexaError('IO_ERROR', `${path} is not a file`);
  }

  const key = `${path}:${info.mtimeMs}:${info.size}`;
  const hit = memo.get(key);
  if (hit) return hit;

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (cause) {
    throw new HexaError('IO_ERROR', `cannot read image at ${path}`, { cause });
  }
  return remember(key, { bytes, hash: hashBytes(bytes), path });
}

/** Maintenance helper: drop the path memo (used by tests that rewrite fixtures). */
export function clearImageMemo(): void {
  memo.clear();
}
