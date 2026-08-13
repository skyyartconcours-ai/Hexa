/**
 * Degenerate-input matrix.
 *
 * Every gate, against every shape of input a caller can plausibly hand it: no
 * subjects, no text, a 1×1 image, pure black, pure white, and a decoded format
 * that is not RGBA. A gate that throws here is not "safe" — `runGates` catches
 * it and turns it into a warning, which means the render ships *unchecked* for
 * that dimension. Crashing is how a quality gate fails open.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { QaFinding } from '@hexa/core';
import { GATES, runGates } from '../src/registry.js';
import { scoreAppeal } from '../src/appeal.js';
import { loadRgb } from '../src/image.js';
import { simulateSizes } from '../src/sizes.js';
import { dHash } from '../src/hash.js';
import type { GateContext } from '../src/types.js';
import { ctx, plan, W, H } from './helpers.js';

/** Single-channel greyscale PNG: decodes to 1 channel, not 3. */
async function greyscalePng(w = 64, h = 36): Promise<Buffer> {
  return sharp(Buffer.alloc(w * h, 128), { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}
/** 16-bit-per-channel PNG: decodes to a wider sample than the gates index. */
async function deepPng(w = 64, h = 36): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#3A5FCD' } })
    .toColourspace('rgb16')
    .png()
    .toBuffer();
}
/** RGBA with real transparency, which must be flattened not read raw. */
async function alphaPng(w = 64, h = 36): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 40, alpha: 0.35 } } })
    .png()
    .toBuffer();
}

const solid = (color: string, w = W, h = H) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

interface Case {
  name: string;
  build: () => Promise<GateContext>;
}

const CASES: Case[] = [
  {
    name: 'no subjects and no text rects',
    build: async () => ctx(await solid('#101018')),
  },
  {
    name: 'subjects declared but no face rects',
    build: async () => ctx(await solid('#101018'), { subjects: [{ playerId: 'p', handle: 'Peyz' }] }),
  },
  {
    name: 'a 1×1 image',
    build: async () => ({
      ...ctx(await solid('#808080', 1, 1)),
      plan: plan({ canvas: { width: 1, height: 1, background: '#000000' } }),
      width: 1,
      height: 1,
    }),
  },
  {
    name: 'an all-black frame',
    build: async () => ctx(await solid('#000000'), {
      subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: { x: 0.3, y: 0.2, w: 0.2, h: 0.3 } }],
      textRects: [{ role: 'headline', rect: { x: 100, y: 500, w: 700, h: 110 } }],
    }),
  },
  {
    name: 'an all-white frame',
    build: async () => ctx(await solid('#FFFFFF'), {
      subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: { x: 0.3, y: 0.2, w: 0.2, h: 0.3 } }],
      textRects: [{ role: 'headline', rect: { x: 100, y: 500, w: 700, h: 110 } }],
    }),
  },
  {
    name: 'a greyscale (1-channel) PNG smaller than the declared canvas',
    build: async () => ctx(await greyscalePng(), {
      subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: { x: 0.3, y: 0.2, w: 0.2, h: 0.3 } }],
      textRects: [{ role: 'headline', rect: { x: 10, y: 10, w: 40, h: 12 } }],
    }),
  },
  {
    name: 'a 16-bit PNG',
    build: async () => ctx(await deepPng(), { textRects: [{ role: 'headline', rect: { x: 4, y: 4, w: 40, h: 12 } }] }),
  },
  {
    name: 'an RGBA PNG with partial transparency',
    build: async () => ctx(await alphaPng(), { textRects: [{ role: 'headline', rect: { x: 4, y: 4, w: 40, h: 12 } }] }),
  },
  {
    name: 'rects that are off-canvas, zero-sized and negative',
    build: async () => ctx(await solid('#202030'), {
      subjects: [
        { playerId: 'a', handle: 'Ghost', faceRect: { x: 9000, y: 9000, w: 100, h: 100 } },
        { playerId: 'b', handle: 'Zero', faceRect: { x: 0.5, y: 0.5, w: 0, h: 0 } },
        { playerId: 'c', handle: 'Neg', faceRect: { x: 0.5, y: 0.5, w: -0.3, h: -0.2 } },
      ],
      textRects: [
        { role: 'off', rect: { x: -400, y: -200, w: 300, h: 90 } },
        { role: 'zero', rect: { x: 100, y: 100, w: 0, h: 0 } },
      ],
    }),
  },
  {
    name: 'a plan whose meta bags are the wrong types',
    build: async () => ctx(await solid('#202030'), {
      plan: plan({
        meta: {
          templateId: 't', subjects: [], createdAt: '',
          safeZones: 'not-an-array' as never,
          textRects: [{ nonsense: true }] as never,
          palette: 'red' as never,
          siblingHashes: [42, null] as never,
          placeholders: 'peyz' as never,
        },
      }),
      subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: { x: 0.3, y: 0.2, w: 0.2, h: 0.3 } }],
    }),
  },
];

describe('every gate survives degenerate input', () => {
  for (const c of CASES) {
    it(`${c.name}`, async () => {
      const context = await c.build();
      for (const gate of GATES) {
        let findings: QaFinding[] = [];
        await expect(
          (async () => { findings = await gate.run(context); })(),
          `gate "${gate.id}" threw on: ${c.name} — a crashed gate means the render ships unchecked for "${gate.description}"`,
        ).resolves.not.toThrow();

        for (const f of findings) {
          expect(typeof f.message, `gate "${gate.id}" produced a finding with no message`).toBe('string');
          expect(f.message.length).toBeGreaterThan(0);
          expect(['pass', 'warn', 'fail']).toContain(f.severity);
          if (f.score !== undefined) {
            expect(Number.isFinite(f.score), `gate "${gate.id}" scored ${f.score}`).toBe(true);
            expect(f.score).toBeGreaterThanOrEqual(0);
            expect(f.score).toBeLessThanOrEqual(1);
          }
          expect(/NaN|undefined|Infinity/.test(f.message), `gate "${gate.id}" leaked a non-number into: ${f.message}`).toBe(false);
        }
      }
    });
  }

  it('runGates itself produces a finite score and no crash warnings on any of them', async () => {
    for (const c of CASES) {
      const report = await runGates(await c.build());
      expect(Number.isFinite(report.score), `${c.name}: score ${report.score}`).toBe(true);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      const crashes = report.findings.filter((f) => /threw and was skipped/.test(f.message));
      expect(crashes.map((f) => f.message), `${c.name} crashed a gate`).toEqual([]);
    }
  });
});

describe('the shared raster helpers normalise what they are given', () => {
  it('always returns three 8-bit channels, whatever the input encoding', async () => {
    for (const [label, buf] of [
      ['greyscale', await greyscalePng()],
      ['16-bit', await deepPng()],
      ['rgba', await alphaPng()],
    ] as const) {
      const img = await loadRgb(buf);
      expect(img.channels, label).toBe(3);
      expect(img.data.length, label).toBe(img.width * img.height * 3);
      expect([...img.data].every((v) => Number.isInteger(v) && v >= 0 && v <= 255), label).toBe(true);
    }
  });

  it('hashes and simulates sizes for a 1×1 image without throwing', async () => {
    const tiny = await solid('#123456', 1, 1);
    await expect(dHash(tiny)).resolves.toMatch(/^[0-9a-f]{16}$/);
    const sizes = await simulateSizes(tiny);
    expect(sizes).toHaveLength(4);
    expect(sizes.every((s) => Number.isFinite(s.edgeDensity))).toBe(true);
  });

  it('scores appeal on degenerate input without producing NaN', async () => {
    for (const [label, buf, w, h] of [
      ['1×1', await solid('#123456', 1, 1), 1, 1],
      ['black', await solid('#000000'), W, H],
      ['white', await solid('#FFFFFF'), W, H],
      ['greyscale', await greyscalePng(), 64, 36],
    ] as const) {
      const result = await scoreAppeal({ image: buf, width: w, height: h });
      expect(Number.isFinite(result.score), label).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      for (const [k, v] of Object.entries(result.parts)) {
        expect(Number.isFinite(v), `${label}: part ${k} = ${v}`).toBe(true);
      }
    }
  });

  it('does not throw when handed an image buffer sharp cannot decode', async () => {
    // The gates catch this in runGates, but the report must say so out loud
    // rather than quietly scoring the render.
    const report = await runGates(ctx(Buffer.from('not an image at all')));
    expect(Number.isFinite(report.score)).toBe(true);
    expect(report.findings.some((f) => /threw and was skipped|NOT checked/.test(f.message ?? ''))).toBe(true);
    expect(report.score).toBeLessThanOrEqual(85);
  });
});
