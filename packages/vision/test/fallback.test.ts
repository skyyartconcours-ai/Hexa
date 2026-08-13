/**
 * Exercises the no-sidecar code paths on synthetic images. Assertions are
 * deliberately loose — this path is a heuristic and the tests should catch
 * "it broke", not pin down pixel values it was never meant to guarantee.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@hexa/core';
import { VisionClient } from '../src/client.js';

const W = 240;
const H = 320;
const HEAD_CX = W / 2;
const HEAD_CY = H * 0.34;
const HEAD_RX = W * 0.18;
const HEAD_RY = H * 0.16;

/**
 * Flat blue backdrop, skin-toned head ellipse, team-red jersey block.
 * `alpha` (when given) makes it an RGBA image with that uniform alpha.
 */
async function synthPortrait(alpha?: number): Promise<Buffer> {
  const channels = alpha === undefined ? 3 : 4;
  const data = Buffer.alloc(W * H * channels);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * channels;
      let r = 20;
      let g = 30;
      let b = 60; // backdrop
      const inJersey = y > H * 0.62 && x > W * 0.2 && x < W * 0.8;
      if (inJersey) {
        r = 170;
        g = 40;
        b = 50; // team red — chroma-distant from the backdrop
      }
      const dx = (x - HEAD_CX) / HEAD_RX;
      const dy = (y - HEAD_CY) / HEAD_RY;
      if (dx * dx + dy * dy <= 1) {
        r = 215;
        g = 170;
        b = 140; // skin, inside the Cb 77-127 / Cr 133-173 window
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      if (alpha !== undefined) data[o + 3] = alpha;
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: channels as 3 | 4 } })
    .png()
    .toBuffer();
}

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

let client: VisionClient;
let portrait: Buffer;
let cacheDir: string;

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'hexa-vision-fallback-'));
  client = new VisionClient({
    endpoint: `http://127.0.0.1:${await closedPort()}`,
    cacheDir,
    logger: createLogger('silent'),
  });
  portrait = await synthPortrait();
});

afterAll(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('heuristic face locator (no sidecar)', () => {
  it('finds the skin-toned region and reports low confidence', async () => {
    const faces = await client.detectFaces(portrait);
    expect(faces.length).toBeGreaterThan(0);
    const box = faces[0]!.box;

    // Roughly where the ellipse is, without pretending to be precise.
    const cx = box.x + box.w / 2;
    expect(Math.abs(cx - HEAD_CX)).toBeLessThan(W * 0.2);
    const areaFrac = (box.w * box.h) / (W * H);
    expect(areaFrac).toBeGreaterThan(0.02);
    expect(areaFrac).toBeLessThan(0.35);

    // Honest about what it is: never mistakable for a real detection.
    expect(box.confidence).toBeLessThanOrEqual(0.4);
    // And it must not invent landmarks or pose.
    expect(faces[0]!.landmarks).toBeUndefined();
    expect(faces[0]!.yaw).toBeUndefined();
  });

  it('returns an empty array rather than throwing on a skin-free image', async () => {
    const flat = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 10, b: 200 } },
    })
      .png()
      .toBuffer();
    await expect(client.detectFaces(flat)).resolves.toEqual([]);
  });
});

describe('fallback matte (no sidecar)', () => {
  it('produces an RGBA PNG that keeps the subject and drops the backdrop', async () => {
    const png = await client.segment(portrait);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic

    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(info.width).toBe(W);
    expect(info.height).toBe(H);

    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    expect(alphaAt(2, 2)).toBeLessThan(40); // corner backdrop cut away
    expect(alphaAt(W - 3, 2)).toBeLessThan(40);
    expect(alphaAt(Math.round(HEAD_CX), Math.round(HEAD_CY))).toBeGreaterThan(200); // face kept
    expect(alphaAt(Math.round(W / 2), Math.round(H * 0.75))).toBeGreaterThan(200); // jersey kept
  });

  it('honours feather without changing the output geometry', async () => {
    const soft = await client.segment(portrait, { feather: 4 });
    const meta = await sharp(soft).metadata();
    expect(meta.width).toBe(W);
    expect(meta.height).toBe(H);
    expect(meta.hasAlpha).toBe(true);
  });

  it('bust framing crops to head-and-shoulders', async () => {
    const bust = await client.segment(portrait, { bust: true });
    const meta = await sharp(bust).metadata();
    expect(meta.hasAlpha).toBe(true);
    // Cropped, and taller than it is wide — a bust, not the original frame.
    expect(meta.height!).toBeLessThan(H);
    expect(meta.height!).toBeGreaterThan(meta.width! * 0.8);
  });

  it('reuses an existing alpha channel instead of re-keying', async () => {
    const already = await synthPortrait(128);
    const out = await client.segment(already, { feather: 0 });
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    // The uniform 50% alpha survives rather than being replaced by a hard key.
    expect(alphaAt(4, 4)).toBeGreaterThan(100);
    expect(alphaAt(4, 4)).toBeLessThan(160);
  });
});

describe('fallback metrics (no sidecar)', () => {
  it('reports the pure-CV fields and omits what it cannot know', async () => {
    const m = await client.metrics(portrait);
    expect(m.width).toBe(W);
    expect(m.height).toBe(H);
    expect(m.brightness).toBeGreaterThan(0);
    expect(m.brightness).toBeLessThan(255);
    expect(m.contrast).toBeGreaterThan(0);
    expect(m.contrast).toBeLessThanOrEqual(1);
    expect(m.sharpness).toBeGreaterThanOrEqual(0);
    expect(m.palette?.length).toBeGreaterThan(0);
    expect(m.palette?.[0]).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.faceBox).toBeDefined();
    expect(m.faceArea).toBeGreaterThan(0);

    // Pose and occlusion need landmarks: absent, not guessed.
    expect(m.yaw).toBeUndefined();
    expect(m.occlusion).toBeUndefined();
    // Composite quality scoring belongs to @hexa/assets.
    expect(m.quality).toBeUndefined();
  });

  it('rates a blurred copy as less sharp than the original', async () => {
    const blurred = await sharp(portrait).blur(6).png().toBuffer();
    const a = await client.metrics(portrait);
    const b = await client.metrics(blurred);
    expect(b.sharpness!).toBeLessThan(a.sharpness!);
  });
});
