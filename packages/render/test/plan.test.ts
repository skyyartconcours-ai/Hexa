import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { HexaError, createLogger, type RenderPlan, type Layer, type Canvas } from '@hexa/core';
import { renderPlan, renderLayer, toRaw } from '../src/index.js';

const silent = createLogger('silent');

function plan(layers: Layer[], canvas: Partial<Canvas> = {}, grade = {}): RenderPlan {
  return {
    canvas: { width: 96, height: 64, background: '#101018', ...canvas },
    layers,
    grade,
    seed: 4242,
    meta: { templateId: 'test', subjects: [], createdAt: '2026-01-01T00:00:00.000Z' },
  };
}

const solid = (id: string, color: string, z: number, extra: Partial<Layer> = {}): Layer => ({
  id,
  source: { type: 'solid', color },
  rect: { x: 0, y: 0, w: 96, h: 64 },
  z,
  opacity: 1,
  blend: 'over',
  ...extra,
});

const px = (img: { data: Buffer; width: number }, x: number, y: number): number[] => {
  const p = (y * img.width + x) * 4;
  return [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!, img.data[p + 3]!];
};

describe('renderPlan', () => {
  it('renders the canvas at the declared size and reports timings', async () => {
    const out = await renderPlan(plan([solid('bg', '#FF0000', 0)]), { logger: silent });
    expect(out.width).toBe(96);
    expect(out.height).toBe(64);
    expect(out.format).toBe('png');
    const img = await toRaw(out.buffer);
    expect(px(img, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(out.timings.total).toBeGreaterThan(0);
    expect(out.timings['layer:bg']).toBeGreaterThan(0);
    expect(out.plan).toBeDefined();
  });

  it('fills the background before any layer', async () => {
    const out = await renderPlan(plan([]), { logger: silent });
    const img = await toRaw(out.buffer);
    expect(px(img, 5, 5)).toEqual([16, 16, 24, 255]);
  });

  it('composites by z ascending regardless of array order', async () => {
    const out = await renderPlan(
      plan([solid('top', '#00FF00', 5), solid('bottom', '#FF0000', 1)]),
      { logger: silent },
    );
    expect(px(await toRaw(out.buffer), 10, 10)).toEqual([0, 255, 0, 255]);
  });

  it('honours layer opacity', async () => {
    const out = await renderPlan(
      plan([solid('bg', '#000000', 0), solid('half', '#FFFFFF', 1, { opacity: 0.5 })]),
      { logger: silent },
    );
    const [r] = px(await toRaw(out.buffer), 10, 10);
    expect(r).toBeGreaterThan(110);
    expect(r).toBeLessThan(145);
  });

  it.each([
    ['multiply', [128, 0, 0]],
    ['screen', [255, 128, 128]],
    ['darken', [128, 0, 0]],
    ['lighten', [255, 128, 128]],
  ] as const)('supports the %s blend natively', async (blend, expected) => {
    const out = await renderPlan(
      plan([solid('a', '#FF0000', 0), solid('b', '#808080', 1, { blend })]),
      { logger: silent },
    );
    const got = px(await toRaw(out.buffer), 10, 10);
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! - expected[c]!)).toBeLessThanOrEqual(3);
  });

  it('supports every declared blend mode without falling back silently', async () => {
    const modes = [
      'over', 'add', 'screen', 'multiply', 'overlay', 'soft-light', 'hard-light',
      'color-dodge', 'color-burn', 'lighten', 'darken', 'difference', 'exclusion',
    ] as const;
    const warnings: string[] = [];
    const logger = { ...silent, warn: (m: string) => warnings.push(m) };
    for (const blend of modes) {
      const out = await renderPlan(
        plan([solid('a', '#3366AA', 0), solid('b', '#AA6633', 1, { blend })]),
        { logger },
      );
      expect(out.buffer.length).toBeGreaterThan(0);
    }
    expect(warnings).toEqual([]);
  });

  it('supersamples then downsamples to the declared size', async () => {
    const out = await renderPlan(plan([solid('bg', '#204080', 0)], { supersample: 2 }), { logger: silent });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(96);
    expect(meta.height).toBe(64);
  });

  it('supersampling produces smoother edges than 1×', async () => {
    const rotated = (ss: number): RenderPlan =>
      plan(
        [
          solid('bg', '#000000', 0),
          {
            id: 'blade',
            source: { type: 'solid', color: '#FFFFFF' },
            rect: { x: 20, y: 8, w: 56, h: 48 },
            z: 1,
            opacity: 1,
            blend: 'over',
            rotation: 22,
          },
        ],
        { supersample: ss },
      );
    const countMid = async (ss: number): Promise<number> => {
      const img = await toRaw((await renderPlan(rotated(ss), { logger: silent })).buffer);
      let mids = 0;
      for (let p = 0; p < img.data.length; p += 4) {
        const v = img.data[p]!;
        if (v > 30 && v < 225) mids++;
      }
      return mids;
    };
    // More intermediate values = more anti-aliasing along the rotated edge.
    expect(await countMid(3)).toBeGreaterThan(await countMid(1));
  });

  it('is deterministic for a given seed and diverges for another', async () => {
    const fx = (seed: number): RenderPlan => ({
      ...plan([
        solid('bg', '#000000', 0),
        {
          id: 'fx',
          source: { type: 'generated', generatorId: 'particles', params: { density: 2 } },
          rect: { x: 0, y: 0, w: 96, h: 64 },
          z: 1,
          opacity: 1,
          blend: 'add',
        },
      ]),
      seed,
    });
    const a = await renderPlan(fx(1), { logger: silent });
    const b = await renderPlan(fx(1), { logger: silent });
    const c = await renderPlan(fx(2), { logger: silent });
    expect(a.buffer.equals(b.buffer)).toBe(true);
    expect(a.buffer.equals(c.buffer)).toBe(false);
  });

  it('resolves every source type', async () => {
    const buf = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const out = await renderPlan(
      plan([
        solid('solid', '#123456', 0),
        {
          id: 'gradient',
          source: { type: 'gradient', stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#FFFFFF' }], angle: 0 },
          rect: { x: 0, y: 0, w: 96, h: 16 },
          z: 1,
          opacity: 1,
          blend: 'over',
        },
        {
          id: 'radial',
          source: { type: 'radial', stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#00000000' }], center: [0.5, 0.5], radius: 0.4 },
          rect: { x: 0, y: 16, w: 96, h: 16 },
          z: 2,
          opacity: 1,
          blend: 'over',
        },
        {
          id: 'noise',
          source: { type: 'noise', seed: 9, scale: 6, octaves: 3 },
          rect: { x: 0, y: 32, w: 96, h: 16 },
          z: 3,
          opacity: 1,
          blend: 'over',
        },
        {
          id: 'svg',
          source: { type: 'svg', markup: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#00FF00"/></svg>' },
          rect: { x: 0, y: 48, w: 16, h: 16 },
          z: 4,
          opacity: 1,
          blend: 'over',
        },
        {
          id: 'buffer',
          source: { type: 'buffer', key: 'k' },
          rect: { x: 40, y: 48, w: 16, h: 16 },
          z: 5,
          opacity: 1,
          blend: 'over',
        },
        {
          id: 'generated',
          source: { type: 'generated', generatorId: 'hexgrid', params: {} },
          rect: { x: 60, y: 48, w: 32, h: 16 },
          z: 6,
          opacity: 1,
          blend: 'over',
        },
      ]),
      { buffers: { k: buf }, logger: silent },
    );
    const img = await toRaw(out.buffer);
    // gradient: dark on the left, bright on the right
    expect(px(img, 2, 8)[0]!).toBeLessThan(px(img, 93, 8)[0]!);
    // radial: bright in the middle of its band
    expect(px(img, 48, 24)[0]!).toBeGreaterThan(150);
    // svg + buffer landed where they were told
    expect(px(img, 8, 56)[1]!).toBeGreaterThan(200);
    expect(px(img, 48, 56)[0]!).toBeGreaterThan(200);
    expect(px(img, 48, 56)[2]!).toBeGreaterThan(200);
  });

  it('masks a layer with another layer alpha, and can invert it', async () => {
    const maskLayer: Layer = {
      id: 'mask',
      source: { type: 'solid', color: '#FFFFFF' },
      rect: { x: 0, y: 0, w: 48, h: 64 },
      z: 0,
      opacity: 0,
      blend: 'over',
    };
    const masked = (invert: boolean): RenderPlan =>
      plan([
        solid('bg', '#000000', 0),
        maskLayer,
        solid('fg', '#FFFFFF', 2, { maskLayerId: 'mask', maskInvert: invert }),
      ]);
    const normal = await toRaw((await renderPlan(masked(false), { logger: silent })).buffer);
    expect(px(normal, 10, 32)[0]).toBe(255);
    expect(px(normal, 80, 32)[0]).toBe(0);
    const inverted = await toRaw((await renderPlan(masked(true), { logger: silent })).buffer);
    expect(px(inverted, 10, 32)[0]).toBe(0);
    expect(px(inverted, 80, 32)[0]).toBe(255);
  });

  it('warns but continues when a mask layer id is unknown', async () => {
    const warnings: string[] = [];
    const logger = { ...silent, warn: (m: string) => warnings.push(m) };
    const out = await renderPlan(
      plan([solid('fg', '#FFFFFF', 0, { maskLayerId: 'ghost' })]),
      { logger },
    );
    expect(out.buffer.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toMatch(/ghost/);
  });

  it('draws the debug overlay only when asked', async () => {
    const p = plan([solid('bg', '#000000', 0)]);
    const plainBuf = (await renderPlan(p, { logger: silent })).buffer;
    const withOverlay = (await renderPlan(p, { logger: silent, debugOverlay: true })).buffer;
    expect(plainBuf.equals(withOverlay)).toBe(false);
    const stats = await sharp(withOverlay).stats();
    expect(stats.channels[0]!.max).toBeGreaterThan(50); // dashed boxes and a label
  });

  it('exports the requested format', async () => {
    const p = plan([solid('bg', '#3377BB', 0)]);
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const out = await renderPlan(p, { format, quality: 80, logger: silent });
      expect(out.format).toBe(format);
      expect((await sharp(out.buffer).metadata()).format).toBe(format);
    }
  });

  it('names the offending layer when a file source is missing', async () => {
    const p = plan([
      {
        id: 'hero-portrait',
        source: { type: 'file', path: '/definitely/not/here/player.png' },
        rect: { x: 0, y: 0, w: 32, h: 32 },
        z: 0,
        opacity: 1,
        blend: 'over',
      },
    ]);
    await expect(renderPlan(p, { logger: silent })).rejects.toThrow(HexaError);
    await expect(renderPlan(p, { logger: silent })).rejects.toMatchObject({
      code: 'RENDER_FAILED',
      message: expect.stringContaining('hero-portrait'),
    });
    await expect(renderPlan(p, { logger: silent })).rejects.toThrow(/player\.png/);
  });

  it('names the offending layer for a missing buffer key or unknown generator', async () => {
    await expect(
      renderPlan(plan([{ ...solid('logo', '#fff', 0), source: { type: 'buffer', key: 'nope' } }]), { logger: silent }),
    ).rejects.toMatchObject({ code: 'RENDER_FAILED', message: expect.stringContaining('logo') });

    await expect(
      renderPlan(
        plan([{ ...solid('fx', '#fff', 0), source: { type: 'generated', generatorId: 'sparkles', params: {} } }]),
        { logger: silent },
      ),
    ).rejects.toMatchObject({ code: 'RENDER_FAILED', message: expect.stringContaining('sparkles') });
  });

  it('rejects a degenerate canvas', async () => {
    await expect(renderPlan(plan([], { width: 0 }), { logger: silent })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('handles many layers without exploding', async () => {
    const layers = Array.from({ length: 40 }, (_, i) =>
      solid(`l${i}`, i % 2 ? '#204080' : '#802040', i, { opacity: 0.1, blend: i % 3 === 0 ? 'screen' : 'over' }),
    );
    const out = await renderPlan(plan(layers, { width: 320, height: 180 }), { logger: silent });
    expect(out.width).toBe(320);
    expect(Object.keys(out.timings).filter((k) => k.startsWith('layer:'))).toHaveLength(40);
  });
});

describe('renderLayer', () => {
  const canvas: Canvas = { width: 96, height: 64, background: '#000000' };
  const ctx = { seed: 1, supersample: 1, buffers: {}, logger: silent };

  it('returns the layer raster and its rect', async () => {
    const out = await renderLayer(solid('a', '#FF0000', 0, { rect: { x: 10, y: 5, w: 20, h: 12 } }), canvas, ctx);
    expect(out).not.toBeNull();
    expect(out!.rect).toEqual({ x: 10, y: 5, w: 20, h: 12 });
    const img = await toRaw(out!.buffer);
    expect(img.width).toBe(20);
    expect(px(img, 5, 5)).toEqual([255, 0, 0, 255]);
  });

  it('scales the rect and effect radii by the supersample factor', async () => {
    const out = await renderLayer(
      solid('a', '#FF0000', 0, { rect: { x: 10, y: 5, w: 20, h: 12 } }),
      canvas,
      { ...ctx, supersample: 2 },
    );
    expect(out!.rect).toEqual({ x: 20, y: 10, w: 40, h: 24 });
  });

  it('grows the rect for effects that bleed outside the silhouette', async () => {
    const out = await renderLayer(
      solid('a', '#FF0000', 0, {
        rect: { x: 30, y: 20, w: 20, h: 12 },
        effects: { glow: { radius: 8, color: '#00FF00', intensity: 1 } },
      }),
      canvas,
      ctx,
    );
    expect(out!.rect.w).toBeGreaterThan(20);
    expect(out!.rect.x).toBeLessThan(30);
  });

  it('grows the rect for rotation and keeps the centre', async () => {
    const out = await renderLayer(
      solid('a', '#FF0000', 0, { rect: { x: 20, y: 10, w: 20, h: 20 }, rotation: 45 }),
      canvas,
      ctx,
    );
    expect(out!.rect.w).toBeGreaterThan(26);
    expect(out!.rect.x + out!.rect.w / 2).toBeCloseTo(30, 0);
  });

  it('returns null for a degenerate rect', async () => {
    expect(await renderLayer(solid('a', '#FF0000', 0, { rect: { x: 0, y: 0, w: 0, h: 10 } }), canvas, ctx)).toBeNull();
  });

  it('flips horizontally before lighting, so the rim follows the scene', async () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
      '<rect x="0" y="0" width="10" height="40" fill="#FFFFFF"/></svg>';
    const layer: Layer = {
      id: 'f',
      source: { type: 'svg', markup },
      rect: { x: 0, y: 0, w: 40, h: 40 },
      z: 0,
      opacity: 1,
      blend: 'over',
      flipX: true,
    };
    const img = await toRaw((await renderLayer(layer, canvas, ctx))!.buffer);
    expect(px(img, 36, 20)[3]).toBe(255); // the bar moved to the right
    expect(px(img, 2, 20)[3]).toBe(0);
  });
});
