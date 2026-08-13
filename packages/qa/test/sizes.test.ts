import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { YOUTUBE_DISPLAY_SIZES, proofSheet, simulateSizes } from '../src/sizes.js';
import { dHash, hamming } from '../src/hash.js';
import { busyBackground, cleanComposition, flatBackground, noiseImage, withText } from './helpers.js';

describe('simulateSizes', () => {
  it('returns every display size at exactly the right dimensions', async () => {
    const image = await cleanComposition();
    const results = await simulateSizes(image);

    expect(results).toHaveLength(YOUTUBE_DISPLAY_SIZES.length);
    for (const size of YOUTUBE_DISPLAY_SIZES) {
      const r = results.find((x) => x.label === size.label)!;
      expect(r).toBeDefined();
      expect([r.width, r.height]).toEqual([size.w, size.h]);
      const meta = await sharp(r.buffer).metadata();
      expect([meta.width, meta.height]).toEqual([size.w, size.h]);
      expect(meta.format).toBe('png');
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.edgeDensity).toBeGreaterThanOrEqual(0);
    }
  });

  it('accepts custom sizes', async () => {
    const results = await simulateSizes(await flatBackground('#333344'), [{ w: 100, h: 56, label: 'tiny' }]);
    expect(results).toHaveLength(1);
    expect(results[0]!.label).toBe('tiny');
    expect(results[0]!.width).toBe(100);
  });

  it('calls a flat plate illegible and a real composition legible', async () => {
    const flat = await simulateSizes(await flatBackground('#101014'), [{ w: 168, h: 94, label: 'sidebar' }]);
    expect(flat[0]!.legible).toBe(false);
    expect(flat[0]!.notes.join(' ')).toMatch(/dissolve|greys out/);

    const composed = await simulateSizes(
      await withText(await cleanComposition(), { text: 'GRAND FINAL', color: '#FFFFFF', rect: { x: 620, y: 300, w: 560, h: 110 } }),
      [{ w: 168, h: 94, label: 'sidebar' }],
    );
    expect(composed[0]!.legible).toBe(true);
  });

  it('calls pixel static illegible at feed size', async () => {
    const results = await simulateSizes(await noiseImage(), [{ w: 320, h: 180, label: 'mobile' }]);
    expect(results[0]!.legible).toBe(false);
  });
});

describe('proofSheet', () => {
  it('produces one valid PNG wide enough to hold every size', async () => {
    const sheet = await proofSheet(await cleanComposition());
    const meta = await sharp(sheet).metadata();
    expect(meta.format).toBe('png');
    const minWidth = YOUTUBE_DISPLAY_SIZES.reduce((a, s) => a + s.w, 0);
    expect(meta.width!).toBeGreaterThan(minWidth);
    expect(meta.height!).toBeGreaterThan(Math.max(...YOUTUBE_DISPLAY_SIZES.map((s) => s.h)));
  });

  it('honours a background override', async () => {
    const sheet = await proofSheet(await cleanComposition(), { background: '#FFFFFF' });
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
    // Top-left corner is sheet padding, so it is the background colour.
    expect(data[0]).toBeGreaterThan(200);
    expect(info.channels).toBeGreaterThanOrEqual(3);
  });
});

describe('dHash / hamming', () => {
  it('produces a 16-character hex hash', async () => {
    const hash = await dHash(await cleanComposition());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('treats a re-graded variant of the same composition as a near-duplicate', async () => {
    const base = await cleanComposition();
    const regraded = await sharp(base).modulate({ brightness: 1.12, saturation: 1.2 }).png().toBuffer();
    const distance = hamming(await dHash(base), await dHash(regraded));
    expect(distance).toBeLessThanOrEqual(6);
  });

  it('separates genuinely different compositions', async () => {
    const a = await dHash(await cleanComposition());
    const b = await dHash(await busyBackground(120));
    expect(hamming(a, b)).toBeGreaterThan(6);
  });

  it('counts every differing bit and rejects incomparable hashes', () => {
    expect(hamming('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hamming('0f0f0f0f0f0f0f0f', '0f0f0f0f0f0f0f0e')).toBe(1);
    expect(() => hamming('abc', 'abcd')).toThrow(/different lengths/);
    expect(() => hamming('zzzz', '0000')).toThrow(/non-hex/);
  });
});
