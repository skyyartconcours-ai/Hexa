import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { generators, registerGenerator, toRaw } from '../src/index.js';

const SIZE = { width: 96, height: 64 };
/** Ids templates are allowed to rely on. */
const IDS = [
  'particles',
  'rays',
  'fog',
  'speedlines',
  'grid',
  'shatter',
  'arena',
  'abstract',
  'noise',
  'bokeh',
  'energy-burst',
  'hexgrid',
  'scanlines',
  'smoke',
];
/** Anything else in the registry still has to honour the Generator contract. */
const EXTRA_IDS = Object.keys(generators).filter((id) => !IDS.includes(id));

describe('generator registry', () => {
  it('exposes every required id', () => {
    for (const id of IDS) expect(Object.keys(generators)).toContain(id);
  });

  it('registerGenerator adds and overrides ids', async () => {
    const flat = async (): Promise<Buffer> =>
      sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
        .png()
        .toBuffer();
    registerGenerator('test-flat', flat);
    expect(generators['test-flat']).toBe(flat);
    const meta = await sharp(await generators['test-flat']!({}, { width: 8, height: 8 }, 1)).metadata();
    expect(meta.width).toBe(8);
    delete generators['test-flat'];
  });
});

describe.each([...IDS, ...EXTRA_IDS])('generator %s', (id) => {
  it('produces a valid RGBA PNG of the requested size', async () => {
    const buf = await generators[id]!({}, SIZE, 1234);
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(SIZE.width);
    expect(meta.height).toBe(SIZE.height);
    expect(meta.channels).toBe(4);
    expect(meta.hasAlpha).toBe(true);
  });

  it('draws something — the frame is neither empty nor uniform', async () => {
    const buf = await generators[id]!({}, { width: 256, height: 144 }, 4242);
    const stats = await sharp(buf).stats();
    const coverage = stats.channels[3]!.mean; // mean alpha, 0–255
    // Structure can live in colour or in alpha (a haze wedge is one flat
    // colour with a shaped alpha), so any channel may carry the variation.
    const variation = Math.max(...stats.channels.map((c) => c.stdev));
    expect(coverage).toBeGreaterThan(1);
    expect(variation).toBeGreaterThan(1);
  });

  it('is reproducible for a given seed', async () => {
    const a = await generators[id]!({}, SIZE, 7);
    const b = await generators[id]!({}, SIZE, 7);
    expect(a.equals(b)).toBe(true);
  });
});

describe.each(IDS)('generator %s', (id) => {
  it('varies with the seed', async () => {
    const a = await generators[id]!({}, SIZE, 7);
    const c = await generators[id]!({}, SIZE, 8);
    expect(a.equals(c)).toBe(false);
  });
});

describe('generator params', () => {
  it('honours colour params', async () => {
    const red = await generators.fog!({ color: '#FF0000', density: 1 }, SIZE, 3);
    const blue = await generators.fog!({ color: '#0000FF', density: 1 }, SIZE, 3);
    const [r, b] = await Promise.all([sharp(red).stats(), sharp(blue).stats()]);
    expect(r.channels[0]!.mean).toBeGreaterThan(r.channels[2]!.mean);
    expect(b.channels[2]!.mean).toBeGreaterThan(b.channels[0]!.mean);
  });

  it('honours density/count params', async () => {
    const sparse = await generators.particles!({ density: 0.2 }, { width: 256, height: 144 }, 5);
    const dense = await generators.particles!({ density: 3 }, { width: 256, height: 144 }, 5);
    const [s, d] = await Promise.all([sharp(sparse).stats(), sharp(dense).stats()]);
    expect(d.channels[3]!.mean).toBeGreaterThan(s.channels[3]!.mean);
  });

  it('particles bias moves the population between sides', async () => {
    const size = { width: 256, height: 144 };
    const left = await generators.particles!({ bias: -1, density: 3 }, size, 11);
    const right = await generators.particles!({ bias: 1, density: 3 }, size, 11);
    // NB: sharp's stats() reads the *input* image and ignores pipeline ops such
    // as extract, so the halves are summed from raw pixels instead.
    const halfAlpha = async (buf: Buffer, side: 'left' | 'right'): Promise<number> => {
      const img = await toRaw(buf);
      const x0 = side === 'left' ? 0 : img.width / 2;
      let sum = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = x0; x < x0 + img.width / 2; x++) sum += img.data[(y * img.width + x) * 4 + 3]!;
      }
      return sum;
    };
    expect(await halfAlpha(left, 'left')).toBeGreaterThan(await halfAlpha(left, 'right'));
    expect(await halfAlpha(right, 'right')).toBeGreaterThan(await halfAlpha(right, 'left'));
  });
});
