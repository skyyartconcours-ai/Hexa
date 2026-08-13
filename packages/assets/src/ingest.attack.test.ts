/**
 * Malformed and hostile images.
 *
 * The ingester's contract with everything downstream is that a file either
 * becomes metrics or becomes a `HexaError` — never an OOM kill, never a hang,
 * never a half-decoded buffer that a later stage trips over. That contract is
 * only interesting for files nobody would ever hand it on purpose, so this
 * builds them byte by byte: the 128-byte PNG that claims to be 50 000 × 50 000,
 * the JPEG that stops mid-scan, the text file wearing a `.png` extension.
 */

import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { isHexaError } from '@hexa/core';
import { computeBasicMetrics, computeDHash, contentHash, listImageFiles } from './ingest.js';

// ── hand-rolled PNG bytes ────────────────────────────────────────────────────
// Building the header by hand is the point: no encoder will produce a 50 000²
// image in a test, but an attacker does not need an encoder.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let x = 0xffffffff;
  for (const b of buf) x = CRC_TABLE[(x ^ b) & 0xff]! ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** A structurally valid greyscale PNG that *declares* `w × h`. */
function pngDeclaring(w: number, h: number, rows = 1): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(rows * (w + 1)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bytes from a hex string, whitespace ignored. */
function hex(s: string): Buffer {
  return Buffer.from(s.replace(/\s+/g, ''), 'hex');
}

/** A looping GIF89a of `frames` 1×1 frames, alternating black and white. */
function animatedGif(frames: number): Buffer {
  const parts = [
    hex('47 49 46 38 39 61'), // "GIF89a"
    hex('0100 0100 80 00 00'), // 1×1, global colour table of 2
    hex('000000 FFFFFF'),
    hex('21 FF 0B'),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    hex('03 01 0000 00'), // loop forever
  ];
  for (let i = 0; i < frames; i++) {
    parts.push(
      hex('21 F9 04 00 0A00 00 00'), // graphic control extension
      hex('2C 0000 0000 0100 0100 00'), // image descriptor
      // LZW, minimum code size 2: one pixel of colour index 0 or 1.
      i % 2 === 0 ? hex('02 02 44 01 00') : hex('02 02 4C 01 00'),
    );
  }
  parts.push(hex('3B')); // trailer
  return Buffer.concat(parts);
}

async function expectHexaAsync(fn: () => Promise<unknown>, code: string): Promise<Error & { code: string }> {
  try {
    await fn();
  } catch (err) {
    expect(isHexaError(err)).toBe(true);
    expect(isHexaError(err) && err.code).toBe(code);
    return err as Error & { code: string };
  }
  throw new Error(`expected a HexaError(${code})`);
}

describe('decompression bombs', () => {
  it('refuses a 50000×50000 PNG header — 128 bytes on disk, 10 GB decoded', async () => {
    const bomb = pngDeclaring(50_000, 50_000);
    expect(bomb.byteLength).toBeLessThan(1024);

    const err = await expectHexaAsync(() => computeBasicMetrics(bomb), 'IO_ERROR');
    expect(err.message).toMatch(/decode|dimensions/i);
    // Whatever happens, it must not be an unhandled crash or a raw sharp error.
    expect(err.name).toBe('HexaError');
  });

  it('refuses the bomb on the perceptual-hash path too, not just the metrics path', async () => {
    await expectHexaAsync(() => computeDHash(pngDeclaring(50_000, 50_000)), 'IO_ERROR');
  });

  it('rejects a header whose declared size dwarfs the pixel data it carries', async () => {
    // 20 000² is under no single-edge limit but far past the pixel budget.
    await expectHexaAsync(() => computeBasicMetrics(pngDeclaring(20_000, 20_000)), 'IO_ERROR');
  });

  it('still accepts a large-but-sane press photo', async () => {
    const real = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3355aa' } })
      .png()
      .toBuffer();
    const metrics = await computeBasicMetrics(real);
    expect(metrics.width).toBe(3000);
    expect(metrics.height).toBe(2000);
  });
});

describe('malformed files', () => {
  it('reports a truncated JPEG as an IO_ERROR rather than decoding garbage', async () => {
    const whole = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } })
      .jpeg()
      .toBuffer();
    await expectHexaAsync(() => computeBasicMetrics(whole.subarray(0, 200)), 'IO_ERROR');
  });

  it('reports a text file wearing a .png extension as an IO_ERROR', async () => {
    const text = Buffer.from('this is not an image, it is a ransom note\n'.repeat(40));
    const err = await expectHexaAsync(() => computeBasicMetrics(text), 'IO_ERROR');
    expect(err.message).toMatch(/decode/i);
  });

  it('reports an empty buffer as an IO_ERROR', async () => {
    await expectHexaAsync(() => computeBasicMetrics(Buffer.alloc(0)), 'IO_ERROR');
  });

  it('reports a zero-dimension image as an IO_ERROR', async () => {
    await expectHexaAsync(() => computeBasicMetrics(pngDeclaring(0, 0)), 'IO_ERROR');
  });

  it('survives a valid image carrying an enormous embedded ICC profile', async () => {
    // A 4 MB profile on a 32 px image: legal, absurd, and must not be fatal.
    const base = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#204060' } })
      .png()
      .toBuffer();
    const withProfile = Buffer.concat([
      base.subarray(0, 8 + 25), // signature + IHDR
      chunk('iCCP', Buffer.concat([Buffer.from('bloat\0\0', 'ascii'), zlib.deflateSync(Buffer.alloc(4 * 1024 * 1024))])),
      base.subarray(8 + 25),
    ]);
    // Either it decodes or it is a clean HexaError — never a crash.
    try {
      const m = await computeBasicMetrics(withProfile);
      expect(m.width).toBe(32);
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
    }
  });

  it('reads only the first frame of an animated GIF, never the whole strip', async () => {
    // Hand-built rather than encoded: sharp will not *write* an animation from
    // a flat buffer, and the attack is a file, not an API call.
    const animated = animatedGif(4);
    // Proof it really is multi-frame: an unguarded decode stacks the frames.
    const unguarded = await sharp(animated, { pages: -1 }).metadata();
    expect(unguarded.pages).toBe(4);
    expect(unguarded.height).toBe(4); // 4 frames of 1px, stacked

    const metrics = await computeBasicMetrics(animated);
    expect(metrics.width).toBe(1);
    expect(metrics.height).toBe(1); // one frame, not four
  });
});

describe('oversize files', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hexa-ingest-'));
    await fs.writeFile(path.join(dir, 'ok.png'), pngDeclaring(4, 4, 4));
    await fs.writeFile(path.join(dir, 'empty.png'), Buffer.alloc(0));
    await fs.writeFile(path.join(dir, 'notes.txt'), 'ignore me');
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('skips empty and unsupported files with a stated reason instead of failing the walk', async () => {
    const skipped: { file: string; reason: string }[] = [];
    const files = await listImageFiles(dir, { onSkip: (file, reason) => skipped.push({ file, reason }) });

    expect(files.map((f) => path.basename(f))).toEqual(['ok.png']);
    expect(skipped.map((s) => s.reason).sort()).toEqual(['empty-file', 'unsupported-extension']);
  });

  it('hashes a file by streaming it, so the hash never costs the file size in memory', async () => {
    const digest = await contentHash(path.join(dir, 'ok.png'));
    expect(digest).toMatch(/^[0-9a-f]{10}$/);
    // Same bytes through the buffer path must produce the same id.
    const bytes = await fs.readFile(path.join(dir, 'ok.png'));
    expect(await contentHash(bytes)).toBe(digest);
  });

  it('refuses a file past the ingest size ceiling with a clear IO_ERROR', async () => {
    const huge = path.join(dir, 'huge.png');
    const handle = await fs.open(huge, 'w');
    try {
      // Sparse: 300 MB of declared length, a handful of real blocks.
      await handle.truncate(300 * 1024 * 1024);
    } finally {
      await handle.close();
    }

    const err = await expectHexaAsync(() => contentHash(huge), 'IO_ERROR');
    expect(err.message).toMatch(/too large/i);

    const skipped: string[] = [];
    const files = await listImageFiles(dir, { onSkip: (_f, reason) => skipped.push(reason) });
    expect(files.map((f) => path.basename(f))).not.toContain('huge.png');
    expect(skipped.some((r) => r.startsWith('too-large:'))).toBe(true);
  });
});
