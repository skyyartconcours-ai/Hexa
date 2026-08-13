import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import type { Canvas, GradeSpec } from '@hexa/core';
import { applyGrade, toRaw } from '../src/index.js';

const W = 96;
const H = 64;
const CANVAS: Canvas = { width: W, height: H, background: '#000000' };

/** Hue sweep × luminance ramp — enough variety to see any grade move. */
async function frame(): Promise<Buffer> {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const l = y / (H - 1);
      data[p] = Math.round(255 * l * (0.4 + 0.6 * (x / (W - 1))));
      data[p + 1] = Math.round(255 * l * 0.7);
      data[p + 2] = Math.round(255 * l * (1 - 0.5 * (x / (W - 1))));
      data[p + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

const graded = async (g: GradeSpec, seed = 1): Promise<ReturnType<typeof toRaw>> =>
  toRaw(await applyGrade(await frame(), g, CANVAS, seed));

function meanChannel(img: { data: Buffer }, c: number): number {
  let sum = 0;
  let n = 0;
  for (let p = 0; p < img.data.length; p += 4) {
    sum += img.data[p + c]!;
    n++;
  }
  return sum / n;
}

describe('applyGrade', () => {
  it('an identity grade is byte-exact', async () => {
    const src = await frame();
    const before = await toRaw(src);
    const after = await toRaw(await applyGrade(src, {}, CANVAS, 1));
    expect(after.data.equals(before.data)).toBe(true);
  });

  it('explicit neutral values are also byte-exact', async () => {
    const src = await frame();
    const before = await toRaw(src);
    const after = await toRaw(
      await applyGrade(
        src,
        { exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] },
        CANVAS,
        1,
      ),
    );
    expect(after.data.equals(before.data)).toBe(true);
  });

  it('exposure moves the whole image', async () => {
    const up = await graded({ exposure: 1 });
    const down = await graded({ exposure: -1 });
    const base = await graded({});
    expect(meanChannel(up, 0)).toBeGreaterThan(meanChannel(base, 0) + 10);
    expect(meanChannel(down, 0)).toBeLessThan(meanChannel(base, 0) - 5);
  });

  it('contrast separates shadows from highlights', async () => {
    const base = await graded({});
    const high = await graded({ contrast: 1.6 });
    const dark = (y: number, x: number, img: { data: Buffer }): number => img.data[(y * W + x) * 4]!;
    expect(dark(4, 80, high)).toBeLessThanOrEqual(dark(4, 80, base));
    expect(dark(60, 80, high)).toBeGreaterThanOrEqual(dark(60, 80, base));
  });

  it('temperature warms and cools', async () => {
    const warm = await graded({ temperature: 60 });
    const cool = await graded({ temperature: -60 });
    expect(meanChannel(warm, 0) - meanChannel(warm, 2)).toBeGreaterThan(meanChannel(cool, 0) - meanChannel(cool, 2));
  });

  it('saturation 0 produces neutral grey', async () => {
    const flat = await graded({ saturation: 0 });
    for (let p = 0; p < flat.data.length; p += 4) {
      expect(Math.abs(flat.data[p]! - flat.data[p + 1]!)).toBeLessThanOrEqual(1);
      expect(Math.abs(flat.data[p + 1]! - flat.data[p + 2]!)).toBeLessThanOrEqual(1);
    }
  });

  it('split-toning tints shadows and highlights independently', async () => {
    const out = await graded({ shadowTint: '#0040FF', highlightTint: '#FF8000' });
    const base = await graded({});
    const shadowP = (6 * W + 48) * 4;
    const highP = ((H - 4) * W + 48) * 4;
    const blueShift = out.data[shadowP + 2]! - base.data[shadowP + 2]!;
    const warmShift = out.data[highP]! - base.data[highP]!;
    expect(blueShift).toBeGreaterThan(3);
    expect(warmShift).toBeGreaterThan(3);
  });

  it('splitToneBalance shifts weight between the ends', async () => {
    const toShadow = await graded({ shadowTint: '#0040FF', splitToneBalance: -1 });
    const toHighlight = await graded({ shadowTint: '#0040FF', splitToneBalance: 1 });
    const p = (20 * W + 48) * 4;
    expect(toShadow.data[p + 2]!).toBeGreaterThan(toHighlight.data[p + 2]!);
  });

  it('lift/gamma/gain behave like an ASC CDL', async () => {
    const lifted = await graded({ lift: [0.2, 0, 0] });
    const base = await graded({});
    expect(lifted.data[0]!).toBeGreaterThan(base.data[0]! + 30);
    const gained = await graded({ gain: [1, 1, 1.5] });
    expect(meanChannel(gained, 2)).toBeGreaterThan(meanChannel(base, 2));
  });

  it('applies a named LUT and honours its strength', async () => {
    const full = await graded({ lut: 'ember', lutStrength: 1 });
    const none = await graded({ lut: 'ember', lutStrength: 0 });
    const base = await graded({});
    expect(none.data.equals(base.data)).toBe(true);
    expect(full.data.equals(base.data)).toBe(false);
  });

  it('ignores an unknown LUT name without throwing', async () => {
    const out = await graded({ lut: 'no-such-lut' });
    const base = await graded({});
    expect(out.data.equals(base.data)).toBe(true);
  });

  it('vignette darkens the corners', async () => {
    const out = await graded({ exposure: 1, vignette: 0.9 });
    const base = await graded({ exposure: 1 });
    const corner = ((H - 1) * W + W - 1) * 4;
    const centre = ((H / 2) * W + W / 2) * 4;
    expect(out.data[corner]!).toBeLessThan(base.data[corner]!);
    expect(out.data[centre]!).toBe(base.data[centre]!);
  });

  it('letterbox draws bars last, over everything', async () => {
    const out = await graded({ exposure: 1, grain: 0.5, vignette: 0.5, letterbox: 0.1 });
    const barRow = 2;
    for (let x = 0; x < W; x++) {
      const p = (barRow * W + x) * 4;
      expect(out.data[p]).toBe(0);
      expect(out.data[p + 1]).toBe(0);
      expect(out.data[p + 2]).toBe(0);
      expect(out.data[p + 3]).toBe(255);
    }
    const bottom = ((H - 3) * W + 10) * 4;
    expect(out.data[bottom]).toBe(0);
    // ...but the middle of the frame is untouched by the bars.
    const mid = ((H / 2) * W + 10) * 4;
    expect(out.data[mid]! + out.data[mid + 1]! + out.data[mid + 2]!).toBeGreaterThan(0);
  });

  it('grain is seeded, so a re-render is identical', async () => {
    const a = await applyGrade(await frame(), { grain: 0.4 }, CANVAS, 5);
    const b = await applyGrade(await frame(), { grain: 0.4 }, CANVAS, 5);
    const c = await applyGrade(await frame(), { grain: 0.4 }, CANVAS, 6);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('bloom only adds light, and needs an intensity to fire', async () => {
    const base = await graded({});
    const off = await graded({ bloomThreshold: 0.5, bloomIntensity: 0 });
    expect(off.data.equals(base.data)).toBe(true);
    const on = await graded({ bloomThreshold: 0.4, bloomIntensity: 1 });
    for (let p = 0; p < on.data.length; p += 4) {
      expect(on.data[p]!).toBeGreaterThanOrEqual(base.data[p]!);
    }
  });

  it('runs the full stack without clipping to nonsense', async () => {
    const out = await graded({
      exposure: 0.2,
      contrast: 1.15,
      saturation: 1.1,
      temperature: 15,
      tint: -5,
      lift: [0.01, 0.01, 0.02],
      gamma: [1, 1, 0.98],
      gain: [1.02, 1, 0.99],
      shadowTint: '#1E6E8C',
      highlightTint: '#FFB870',
      splitToneBalance: 0.2,
      lut: 'teal-orange',
      lutStrength: 0.6,
      bloomThreshold: 0.7,
      bloomIntensity: 0.5,
      halation: 0.3,
      chromaticAberration: 1.5,
      vignette: 0.4,
      grain: 0.15,
      letterbox: 0.04,
    });
    expect(out.width).toBe(W);
    expect(out.height).toBe(H);
    let min = 255;
    let max = 0;
    for (let p = 0; p < out.data.length; p += 4) {
      min = Math.min(min, out.data[p]!);
      max = Math.max(max, out.data[p]!);
    }
    expect(max - min).toBeGreaterThan(60);
  });
});
