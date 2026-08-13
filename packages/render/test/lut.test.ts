import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { parseCube, applyLut, buildLut, sampleLut, BUILTIN_LUTS, toRaw, type Lut3D } from '../src/index.js';

function identityLut(size = 17): Lut3D {
  return buildLut(size, 'identity', (r, g, b) => [r, g, b]);
}

/** Serialise a LUT back to .cube text — red fastest, as the format requires. */
function formatCube(lut: Lut3D): string {
  const lines = [`TITLE "${lut.title ?? 'untitled'}"`, `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0', ''];
  for (let b = 0; b < lut.size; b++) {
    for (let g = 0; g < lut.size; g++) {
      for (let r = 0; r < lut.size; r++) {
        const i = ((b * lut.size + g) * lut.size + r) * 3;
        lines.push(`${lut.data[i]!.toFixed(6)} ${lut.data[i + 1]!.toFixed(6)} ${lut.data[i + 2]!.toFixed(6)}`);
      }
    }
  }
  return lines.join('\n');
}

/** A colourful test frame: hue sweep horizontally, luminance vertically. */
async function testFrame(w = 64, h = 64): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = Math.round((x / (w - 1)) * 255);
      data[p + 1] = Math.round((y / (h - 1)) * 255);
      data[p + 2] = Math.round(((x + y) / (w + h - 2)) * 255);
      data[p + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe('parseCube', () => {
  it('round-trips a generated LUT', () => {
    const src = BUILTIN_LUTS['teal-orange']!;
    const parsed = parseCube(formatCube(src));
    expect(parsed.size).toBe(src.size);
    expect(parsed.title).toBe(src.title);
    expect(parsed.data.length).toBe(src.data.length);
    for (let i = 0; i < src.data.length; i++) {
      expect(parsed.data[i]!).toBeCloseTo(src.data[i]!, 5);
    }
  });

  it('parses comments, blank lines and titles', () => {
    const text = [
      '# a comment',
      'TITLE "My Look"',
      '',
      'LUT_3D_SIZE 2',
      ...Array.from({ length: 8 }, (_, i) => `${(i % 2) * 1} 0.5 0.25 # trailing`),
    ].join('\n');
    const lut = parseCube(text);
    expect(lut.title).toBe('My Look');
    expect(lut.size).toBe(2);
    expect(lut.data[0]).toBeCloseTo(0, 6);
    expect(lut.data[1]).toBeCloseTo(0.5, 6);
    expect(lut.data[3]).toBeCloseTo(1, 6);
  });

  it('renormalises a non-unit domain', () => {
    const text = ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', ...Array.from({ length: 8 }, () => '1 1 1')].join('\n');
    expect(parseCube(text).data[0]).toBeCloseTo(0.5, 6);
  });

  it('rejects malformed files loudly', () => {
    expect(() => parseCube('nothing here')).toThrow(/LUT_3D_SIZE/);
    expect(() => parseCube('LUT_3D_SIZE 3\n0 0 0')).toThrow(/expected 81 values/);
    expect(() => parseCube('LUT_1D_SIZE 16\n0 0 0')).toThrow(/1D LUTs/);
  });
});

describe('applyLut', () => {
  it('is near-lossless with an identity LUT', async () => {
    const frame = await testFrame();
    const before = await toRaw(frame);
    const after = await toRaw(await applyLut(frame, identityLut(), 1));
    let maxDelta = 0;
    for (let p = 0; p < before.data.length; p++) {
      maxDelta = Math.max(maxDelta, Math.abs(before.data[p]! - after.data[p]!));
    }
    expect(maxDelta).toBeLessThanOrEqual(1);
  });

  it('is an exact no-op at strength 0', async () => {
    const frame = await testFrame();
    const before = await toRaw(frame);
    const after = await toRaw(await applyLut(frame, BUILTIN_LUTS.ember!, 0));
    expect(after.data.equals(before.data)).toBe(true);
  });

  it('interpolates trilinearly between grid points', () => {
    // A LUT that only inverts red: sampling halfway must land halfway.
    const lut = buildLut(3, 'invert-r', (r, g, b) => [1 - r, g, b]);
    const [r] = sampleLut(lut, 0.25, 0, 0);
    expect(r).toBeCloseTo(0.75, 5);
  });

  it('mixes proportionally with strength', async () => {
    const frame = await testFrame();
    const full = await toRaw(await applyLut(frame, BUILTIN_LUTS['neo-noir']!, 1));
    const half = await toRaw(await applyLut(frame, BUILTIN_LUTS['neo-noir']!, 0.5));
    const base = await toRaw(frame);
    const p = (32 * 64 + 32) * 4;
    const expected = base.data[p]! + (full.data[p]! - base.data[p]!) * 0.5;
    expect(Math.abs(half.data[p]! - expected)).toBeLessThanOrEqual(2);
  });
});

describe('BUILTIN_LUTS', () => {
  const names = ['teal-orange', 'bleach-bypass', 'neo-noir', 'ember', 'cold-steel', 'crimson-contrast'];

  it('ships the documented looks', () => {
    for (const n of names) expect(BUILTIN_LUTS[n]).toBeDefined();
  });

  it.each(names)('%s is a well-formed, non-identity transform', async (name) => {
    const lut = BUILTIN_LUTS[name]!;
    expect(lut.size).toBeGreaterThanOrEqual(2);
    expect(lut.data.length).toBe(lut.size ** 3 * 3);
    for (const v of lut.data) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of lut.data) expect(v).toBeLessThanOrEqual(1);

    const frame = await testFrame();
    const before = await toRaw(frame);
    const after = await toRaw(await applyLut(frame, lut, 1));
    let changed = 0;
    for (let p = 0; p < before.data.length; p += 4) {
      if (Math.abs(before.data[p]! - after.data[p]!) > 2) changed++;
    }
    expect(changed / (before.data.length / 4)).toBeGreaterThan(0.2);
  });

  it('teal-orange cools shadows and warms highlights', () => {
    const lut = BUILTIN_LUTS['teal-orange']!;
    const [sr, , sb] = sampleLut(lut, 0.18, 0.18, 0.18);
    const [hr, , hb] = sampleLut(lut, 0.82, 0.82, 0.82);
    expect(sb).toBeGreaterThan(sr); // shadows lean blue/teal
    expect(hr).toBeGreaterThan(hb); // highlights lean amber
  });

  it('bleach-bypass reduces saturation', () => {
    const lut = BUILTIN_LUTS['bleach-bypass']!;
    const [r, g, b] = sampleLut(lut, 0.9, 0.15, 0.15);
    const spreadBefore = 0.9 - 0.15;
    const spreadAfter = Math.max(r, g, b) - Math.min(r, g, b);
    expect(spreadAfter).toBeLessThan(spreadBefore);
  });

  it('neo-noir keeps blacks off zero (matte lift)', () => {
    const [, , b] = sampleLut(BUILTIN_LUTS['neo-noir']!, 0, 0, 0);
    expect(b).toBeGreaterThan(0);
  });
});
