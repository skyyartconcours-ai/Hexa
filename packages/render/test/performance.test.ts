/**
 * Performance regression guard.
 *
 * A compositor gets slow the way a room gets untidy: nobody does it, it just
 * happens. This renders a plan shaped like the real product workload — a
 * 1280×720 versus thumbnail: procedural atmosphere, two effect-laden cutouts,
 * vector type and the full grade — and fails if it takes absurdly long.
 *
 * The budget is deliberately generous. It is not a benchmark and it must not
 * flake on a loaded CI box: it is there to catch the *class* of change that put
 * this render at twelve seconds a frame — a supersample factor reinstated, a
 * PNG round trip added between stages, a per-pixel `Math.pow` reintroduced in a
 * hot loop. Each of those costs a multiple, not a percent, and each would blow
 * this budget several times over. Override with `HEXA_PERF_BUDGET_MS` on a
 * machine slower than the one this was written against.
 *
 * The determinism assertion lives here rather than in `plan.test.ts` because
 * this is the plan that actually exercises the concurrent paths: layers are
 * prepared with a lookahead, and a race would show up as two renders of the
 * same seed disagreeing.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createLogger, type GradeSpec, type Layer, type RenderPlan } from '@hexa/core';
import { renderPlan } from '../src/index.js';

const silent = createLogger('silent');

/** Wall-clock ceiling for one standard render. See the file header. */
const BUDGET_MS = Number(process.env['HEXA_PERF_BUDGET_MS'] ?? 6000);

const W = 1280;
const H = 720;

/** A cutout-shaped subject: soft alpha edge, so the edge stack has real work. */
async function subjectPng(): Promise<Buffer> {
  const w = 640;
  const h = 700;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const nx = (x - w / 2) / (w * 0.36);
      const ny = (y - h * 0.55) / (h * 0.46);
      const d = Math.hypot(nx, ny);
      data[p] = 180 - ((y * 40) / h) | 0;
      data[p + 1] = 90 + ((x * 60) / w) | 0;
      data[p + 2] = 120;
      data[p + 3] = d >= 1 ? 0 : Math.round(255 * Math.min(1, (1 - d) * 12));
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

function textSvg(label: string, w: number, h: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<text x="8" y="${h * 0.78}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(h * 0.8)}" ` +
    `font-weight="bold" fill="#F5F3F0">${label}</text></svg>`
  );
}

const GRADE: GradeSpec = {
  exposure: 0.05,
  contrast: 1.14,
  saturation: 1.1,
  temperature: 6,
  shadowTint: '#0B2A3C',
  highlightTint: '#FFB067',
  splitToneBalance: 0.45,
  lut: 'teal-orange',
  lutStrength: 0.55,
  grain: 0.08,
  bloomThreshold: 0.72,
  bloomIntensity: 0.35,
  vignette: 0.36,
  chromaticAberration: 1.2,
  halation: 0.2,
};

function standardPlan(): RenderPlan {
  const full = { x: 0, y: 0, w: W, h: H };
  const base = { opacity: 1, blend: 'over' as const };
  const layers: Layer[] = [
    { id: 'backdrop', source: { type: 'gradient', stops: [{ offset: 0, color: '#1B2340' }, { offset: 1, color: '#0A0B12' }], angle: 96 }, rect: full, z: 0, ...base },
    { id: 'backdrop-glow', source: { type: 'radial', stops: [{ offset: 0, color: '#3E6BFFAA' }, { offset: 1, color: '#00000000' }], center: [0.5, 0.44], radius: 0.7 }, rect: full, z: 4, ...base, blend: 'screen' },
    { id: 'backdrop-floor', source: { type: 'gradient', stops: [{ offset: 0, color: '#00000000' }, { offset: 1, color: '#000000CC' }], angle: 270 }, rect: { x: 0, y: 324, w: W, h: 396 }, z: 6, ...base },
    { id: 'fx-haze', source: { type: 'generated', generatorId: 'haze', params: { density: 0.4 } }, rect: full, z: 20, ...base, blend: 'screen' },
    { id: 'fx-particles-back', source: { type: 'generated', generatorId: 'particles', params: { density: 1 } }, rect: full, z: 22, ...base, blend: 'screen' },
  ];

  for (const [i, side] of (['left', 'right'] as const).entries()) {
    const x = side === 'left' ? -40 : 680;
    layers.push(
      {
        id: `subject-${i}-contact`,
        source: { type: 'generated', generatorId: 'contact-shadow', params: {} },
        rect: { x: x - 60, y: 640, w: 760, h: 110 },
        z: 30 + i * 10,
        ...base,
        blend: 'multiply',
      },
      {
        id: `subject-${i}`,
        source: { type: 'buffer', key: `subject:${i}` },
        rect: { x, y: 30, w: 640, h: 690 },
        z: 32 + i * 10,
        ...base,
        flipX: side === 'right',
        effects: {
          contrast: 1.06,
          saturation: 1.04,
          rimLight: { angle: side === 'left' ? 14 : 166, width: 21, color: '#F3721F', intensity: 0.95 },
          shadow: { dx: 0, dy: 5, blur: 25, color: '#050404', opacity: 0.33 },
          glow: { radius: 95, color: '#F3721F', intensity: 0.52 },
        },
      },
      {
        id: `subject-${i}-lightwrap`,
        source: { type: 'generated', generatorId: 'light-wrap', params: { angle: 20 } },
        rect: { x, y: 30, w: 640, h: 690 },
        z: 34 + i * 10,
        ...base,
        blend: 'screen',
        effects: { blur: 24 },
      },
    );
  }

  layers.push(
    { id: 'fx-fog', source: { type: 'generated', generatorId: 'fog', params: {} }, rect: { x: 0, y: 590, w: W, h: 130 }, z: 60, ...base, blend: 'screen' },
    { id: 'fx-particles-front', source: { type: 'generated', generatorId: 'particles', params: { density: 0.7 } }, rect: full, z: 62, ...base, blend: 'screen', effects: { blur: 3 } },
    { id: 'shape-vs', source: { type: 'solid', color: '#E4002BEE' }, rect: { x: 518, y: 184, w: 243, h: 194 }, z: 70, ...base },
    { id: 'plate-left', source: { type: 'solid', color: '#101018DD' }, rect: { x: 58, y: 508, w: 454, h: 90 }, z: 72, ...base },
    { id: 'plate-right', source: { type: 'solid', color: '#101018DD' }, rect: { x: 768, y: 508, w: 454, h: 90 }, z: 74, ...base },
    { id: 'text-vs', source: { type: 'svg', markup: textSvg('VS', 234, 151) }, rect: { x: 523, y: 205, w: 234, h: 151 }, z: 80, ...base },
    { id: 'text-left', source: { type: 'svg', markup: textSvg('PEYZ', 429, 76) }, rect: { x: 70, y: 515, w: 429, h: 76 }, z: 82, ...base },
    { id: 'text-right', source: { type: 'svg', markup: textSvg('VIPER', 429, 76) }, rect: { x: 781, y: 515, w: 429, h: 76 }, z: 84, ...base },
    { id: 'text-kicker', source: { type: 'svg', markup: textSvg('LCK FINALS', 474, 54) }, rect: { x: 403, y: 40, w: 474, h: 54 }, z: 86, ...base },
  );

  return {
    canvas: { width: W, height: H, background: '#0E0D0D', supersample: 1 },
    layers,
    grade: GRADE,
    seed: 1337,
    meta: { templateId: 'versus-perf', subjects: [], createdAt: '2026-01-01T00:00:00.000Z' },
  };
}

describe('performance', () => {
  it(`renders a standard 1280×720 thumbnail within ${BUDGET_MS}ms`, async () => {
    const subject = await subjectPng();
    const buffers = { 'subject:0': subject, 'subject:1': subject };
    const plan = standardPlan();

    // One warm render first: the first call in a process pays for libvips'
    // module init and librsvg's font cache, which is not what is being guarded.
    const warm = await renderPlan(plan, { buffers, logger: silent });
    expect(warm.width).toBe(W);
    expect(warm.timings.total).toBeGreaterThan(0);

    // Best of three. Test files run in parallel and CI machines have neighbours;
    // the *minimum* of a few runs is the closest thing to an uncontended
    // measurement available from inside a test, and it is what stops this guard
    // from failing for reasons that have nothing to do with the compositor.
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      await renderPlan(plan, { buffers, logger: silent });
      best = Math.min(best, performance.now() - started);
    }

    expect(best).toBeLessThan(BUDGET_MS);
  }, 180_000);

  it('is byte-identical across renders of the same seed', async () => {
    const subject = await subjectPng();
    const buffers = { 'subject:0': subject, 'subject:1': subject };
    const plan = standardPlan();

    const [a, b] = await Promise.all([
      renderPlan(plan, { buffers, logger: silent }),
      renderPlan(plan, { buffers, logger: silent }),
    ]);
    const c = await renderPlan({ ...plan, seed: plan.seed + 1 }, { buffers, logger: silent });

    expect(a.buffer.equals(b.buffer)).toBe(true);
    expect(a.buffer.equals(c.buffer)).toBe(false);
  }, 120_000);
});
