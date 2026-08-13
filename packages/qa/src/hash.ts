/**
 * Perceptual hashing for variant de-duplication.
 *
 * Generating four variants that differ only in grain seed is worse than
 * generating one: it burns render time and makes the studio's variant strip
 * lie about how much exploration happened. dHash is the right tool — it keys on
 * the direction of local gradients, so it ignores exposure and grade shifts but
 * notices when the composition genuinely changes.
 */

import sharp from 'sharp';
import { HexaError } from '@hexa/core';

/**
 * 64-bit difference hash as 16 lowercase hex chars.
 *
 * Resize to 9×8 greyscale, then emit one bit per horizontally adjacent pair:
 * "is the left pixel brighter than the right?". Uniform brightness/contrast
 * changes preserve every comparison, which is exactly the invariance we want
 * between two variants of the same composite.
 */
export async function dHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image, { failOn: 'none' })
    .flatten({ background: '#000000' })
    .resize(9, 8, { fit: 'fill', kernel: 'lanczos3' })
    .greyscale()
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += data[y * 9 + x]! > data[y * 9 + x + 1]! ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Bit distance between two dHashes. 0 is identical; ≤6 of 64 is "the same
 *  picture" for variant purposes; ≥12 is a genuinely different composition. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new HexaError('INVALID_REQUEST', `Cannot compare hashes of different lengths (${a.length} vs ${b.length})`, {
      hint: 'Both hashes must come from dHash() — 16 hex characters each.',
    });
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const na = Number.parseInt(a[i]!, 16);
    const nb = Number.parseInt(b[i]!, 16);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      throw new HexaError('INVALID_REQUEST', `Hash contains a non-hex character at index ${i}`, {
        hint: 'Both hashes must come from dHash().',
      });
    }
    const x = na ^ nb;
    d += ((x & 1) ? 1 : 0) + ((x & 2) ? 1 : 0) + ((x & 4) ? 1 : 0) + ((x & 8) ? 1 : 0);
  }
  return d;
}

/** Hamming distance at or below which two variants are considered duplicates. */
export const DUPLICATE_DISTANCE = 6;
