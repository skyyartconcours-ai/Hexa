import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  rimLight,
  lightWrap,
  outerGlow,
  dropShadow,
  strokeAlpha,
  duotone,
  motionBlur,
  bloom,
  chromaticAberration,
  filmGrain,
  vignette,
  halation,
  alphaBounds,
  toRaw,
  type RawImage,
} from '../src/index.js';

const W = 120;
const H = 120;
const BOX = { x: 30, y: 30, w: 60, h: 60 };

/** A mid-grey square on a transparent field — a stand-in for a cutout. */
async function subject(grey = 110): Promise<Buffer> {
  const data = Buffer.alloc(W * H * 4, 0);
  for (let y = BOX.y; y < BOX.y + BOX.h; y++) {
    for (let x = BOX.x; x < BOX.x + BOX.w; x++) {
      const p = (y * W + x) * 4;
      data[p] = grey;
      data[p + 1] = grey;
      data[p + 2] = grey;
      data[p + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** A flat coloured plate to sit behind the subject. */
async function plate(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 4, background: { ...color, alpha: 1 } } })
    .png()
    .toBuffer();
}

const lum = (img: RawImage, x: number, y: number): number => {
  const p = (y * img.width + x) * 4;
  return 0.2126 * img.data[p]! + 0.7152 * img.data[p + 1]! + 0.0722 * img.data[p + 2]!;
};

function bandMean(img: RawImage, x0: number, x1: number, y0: number, y1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += lum(img, x, y);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

describe('rimLight', () => {
  it('never writes outside the subject alpha', async () => {
    const src = await subject();
    const before = await toRaw(src);
    const after = await toRaw(await rimLight(src, { angle: 45, width: 12, color: '#FFFFFF', intensity: 2 }));
    for (let i = 0; i < W * H; i++) {
      const p = i * 4;
      if (before.data[p + 3] === 0) {
        expect(after.data[p]).toBe(before.data[p]);
        expect(after.data[p + 1]).toBe(before.data[p + 1]);
        expect(after.data[p + 2]).toBe(before.data[p + 2]);
        expect(after.data[p + 3]).toBe(0);
      }
    }
  });

  it('lights the right edge at 0° and the left edge at 180°', async () => {
    const src = await subject();
    const base = await toRaw(src);
    const right = await toRaw(await rimLight(src, { angle: 0, width: 8, color: '#FFFFFF', intensity: 1.5 }));
    const left = await toRaw(await rimLight(src, { angle: 180, width: 8, color: '#FFFFFF', intensity: 1.5 }));

    const leftEdge = [BOX.x, BOX.x + 8, BOX.y + 10, BOX.y + BOX.h - 10] as const;
    const rightEdge = [BOX.x + BOX.w - 8, BOX.x + BOX.w, BOX.y + 10, BOX.y + BOX.h - 10] as const;

    const baseL = bandMean(base, ...leftEdge);
    const baseR = bandMean(base, ...rightEdge);
    // 0°: right edge brightens, left edge does not.
    expect(bandMean(right, ...rightEdge)).toBeGreaterThan(baseR + 10);
    expect(bandMean(right, ...leftEdge)).toBeCloseTo(baseL, 0);
    // 180°: mirrored.
    expect(bandMean(left, ...leftEdge)).toBeGreaterThan(baseL + 10);
    expect(bandMean(left, ...rightEdge)).toBeCloseTo(baseR, 0);
  });

  it('lights the top edge at 90° and the bottom at 270°', async () => {
    const src = await subject();
    const base = await toRaw(src);
    const top = await toRaw(await rimLight(src, { angle: 90, width: 8, color: '#FFFFFF', intensity: 1.5 }));
    const bottom = await toRaw(await rimLight(src, { angle: 270, width: 8, color: '#FFFFFF', intensity: 1.5 }));
    const topBand = [BOX.x + 10, BOX.x + BOX.w - 10, BOX.y, BOX.y + 8] as const;
    const botBand = [BOX.x + 10, BOX.x + BOX.w - 10, BOX.y + BOX.h - 8, BOX.y + BOX.h] as const;
    expect(bandMean(top, ...topBand)).toBeGreaterThan(bandMean(base, ...topBand) + 10);
    expect(bandMean(top, ...botBand)).toBeCloseTo(bandMean(base, ...botBand), 0);
    expect(bandMean(bottom, ...botBand)).toBeGreaterThan(bandMean(base, ...botBand) + 10);
  });

  it('leaves the interior untouched — it is a rim, not a fill', async () => {
    const src = await subject();
    const out = await toRaw(await rimLight(src, { angle: 0, width: 6, color: '#FFFFFF', intensity: 2 }));
    const centre = bandMean(out, BOX.x + 20, BOX.x + 40, BOX.y + 20, BOX.y + 40);
    const base = bandMean(await toRaw(src), BOX.x + 20, BOX.x + 40, BOX.y + 20, BOX.y + 40);
    expect(centre).toBeCloseTo(base, 0);
  });

  it('scales with intensity and tints with colour', async () => {
    const src = await subject();
    const weak = await toRaw(await rimLight(src, { angle: 0, width: 8, color: '#FFFFFF', intensity: 0.3 }));
    const strong = await toRaw(await rimLight(src, { angle: 0, width: 8, color: '#FFFFFF', intensity: 2 }));
    const edge = [BOX.x + BOX.w - 6, BOX.x + BOX.w, BOX.y + 10, BOX.y + BOX.h - 10] as const;
    expect(bandMean(strong, ...edge)).toBeGreaterThan(bandMean(weak, ...edge));

    const red = await toRaw(await rimLight(src, { angle: 0, width: 8, color: '#FF0000', intensity: 2 }));
    const p = ((BOX.y + 30) * W + BOX.x + BOX.w - 2) * 4;
    expect(red.data[p]!).toBeGreaterThan(red.data[p + 2]! + 20);
  });
});

describe('lightWrap', () => {
  it('pulls backdrop colour onto the subject edge only', async () => {
    const src = await subject(40);
    const bg = await plate({ r: 0, g: 255, b: 0 });
    const out = await toRaw(await lightWrap(src, bg, { radius: 8, intensity: 1 }));
    const before = await toRaw(src);

    // Edge band picks up green; the centre stays as it was.
    const edgeP = ((BOX.y + 30) * W + BOX.x + 1) * 4;
    expect(out.data[edgeP + 1]!).toBeGreaterThan(before.data[edgeP + 1]! + 20);
    const midP = ((BOX.y + 30) * W + BOX.x + 30) * 4;
    expect(out.data[midP + 1]!).toBe(before.data[midP + 1]!);
  });

  it('never writes outside the subject alpha', async () => {
    const src = await subject(40);
    const bg = await plate({ r: 255, g: 255, b: 255 });
    const out = await toRaw(await lightWrap(src, bg, { radius: 10, intensity: 1 }));
    for (let i = 0; i < W * H; i++) {
      const p = i * 4;
      if (out.data[p + 3] === 0) {
        expect(out.data[p]).toBe(0);
        expect(out.data[p + 1]).toBe(0);
        expect(out.data[p + 2]).toBe(0);
      }
    }
  });

  it('resizes a mismatched backdrop instead of failing', async () => {
    const src = await subject(40);
    const bg = await sharp({ create: { width: 40, height: 500, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
      .png()
      .toBuffer();
    const out = await toRaw(await lightWrap(src, bg, { radius: 6, intensity: 1 }));
    expect(out.width).toBe(W);
    expect(out.height).toBe(H);
  });
});

describe('silhouette effects', () => {
  it('outerGlow adds alpha outside the subject', async () => {
    const src = await subject();
    const out = await toRaw(await outerGlow(src, { radius: 12, color: '#00FF00', intensity: 1 }));
    const bounds = alphaBounds(out.data, W, H)!;
    expect(bounds.w).toBeGreaterThan(BOX.w);
    expect(bounds.h).toBeGreaterThan(BOX.h);
    const p = ((BOX.y + 30) * W + BOX.x - 4) * 4;
    expect(out.data[p + 3]!).toBeGreaterThan(0);
    expect(out.data[p + 1]!).toBeGreaterThan(out.data[p]!);
  });

  it('dropShadow lands on the offset side', async () => {
    const src = await subject();
    const out = await toRaw(await dropShadow(src, { dx: 10, dy: 10, blur: 4, color: '#000000', opacity: 1 }));
    const below = ((BOX.y + BOX.h + 5) * W + BOX.x + 40) * 4;
    const above = ((BOX.y - 5) * W + BOX.x + 40) * 4;
    expect(out.data[below + 3]!).toBeGreaterThan(50);
    expect(out.data[above + 3]!).toBe(0);
  });

  it('strokeAlpha grows the silhouette by the requested width', async () => {
    const src = await subject();
    const out = await toRaw(await strokeAlpha(src, { width: 5, color: '#FF00FF' }));
    const bounds = alphaBounds(out.data, W, H, 128)!;
    expect(bounds.w).toBeGreaterThanOrEqual(BOX.w + 8);
    expect(bounds.w).toBeLessThanOrEqual(BOX.w + 14);
    const p = ((BOX.y + 30) * W + BOX.x - 3) * 4;
    expect(out.data[p]!).toBeGreaterThan(200);
    expect(out.data[p + 1]!).toBeLessThan(60);
  });
});

describe('colour and motion', () => {
  it('duotone maps luminance onto the ramp', async () => {
    const grad = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const v = Math.round((x / (W - 1)) * 255);
        grad[p] = v;
        grad[p + 1] = v;
        grad[p + 2] = v;
        grad[p + 3] = 255;
      }
    }
    const png = await sharp(grad, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const out = await toRaw(await duotone(png, '#001133', '#FFCC00', 1));
    const dark = (60 * W + 2) * 4;
    const light = (60 * W + W - 3) * 4;
    expect(out.data[dark + 2]!).toBeGreaterThan(out.data[dark]!); // shadows go blue
    expect(out.data[light]!).toBeGreaterThan(out.data[light + 2]!); // highlights go warm
  });

  it('motionBlur smears along the angle and keeps the canvas size', async () => {
    const src = await subject();
    const out = await toRaw(await motionBlur(src, 0, 16));
    expect(out.width).toBe(W);
    expect(out.height).toBe(H);
    // Horizontal smear: alpha bleeds sideways, not vertically.
    const sideP = ((BOX.y + 30) * W + BOX.x - 4) * 4;
    const topP = ((BOX.y - 4) * W + BOX.x + 30) * 4;
    expect(out.data[sideP + 3]!).toBeGreaterThan(20);
    expect(out.data[topP + 3]!).toBeLessThan(20);
  });

  it('motionBlur does not leave the layer rotated', async () => {
    const src = await subject();
    const out = await toRaw(await motionBlur(src, 30, 10));
    const bounds = alphaBounds(out.data, W, H, 200)!;
    // A rotated square would no longer be axis-aligned around the original box.
    expect(Math.abs(bounds.x + bounds.w / 2 - (BOX.x + BOX.w / 2))).toBeLessThan(3);
    expect(Math.abs(bounds.y + bounds.h / 2 - (BOX.y + BOX.h / 2))).toBeLessThan(3);
  });
});

describe('optical effects', () => {
  it('bloom spreads highlights and only adds light', async () => {
    const data = Buffer.alloc(W * H * 4, 0);
    for (let i = 0; i < W * H; i++) data[i * 4 + 3] = 255;
    for (let y = 58; y < 62; y++) {
      for (let x = 58; x < 62; x++) {
        const p = (y * W + x) * 4;
        data[p] = 255;
        data[p + 1] = 255;
        data[p + 2] = 255;
      }
    }
    const png = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const before = await toRaw(png);
    const after = await toRaw(await bloom(png, 0.6, 1.5, 6));
    const near = (60 * W + 70) * 4;
    expect(after.data[near]!).toBeGreaterThan(before.data[near]! + 5);
    for (let p = 0; p < after.data.length; p += 4) {
      expect(after.data[p]!).toBeGreaterThanOrEqual(before.data[p]!);
    }
  });

  it('halation bleeds warm, not cool', async () => {
    const data = Buffer.alloc(W * H * 4, 0);
    for (let i = 0; i < W * H; i++) data[i * 4 + 3] = 255;
    for (let y = 50; y < 70; y++) {
      for (let x = 50; x < 70; x++) {
        const p = (y * W + x) * 4;
        data[p] = 255;
        data[p + 1] = 255;
        data[p + 2] = 255;
      }
    }
    const png = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const out = await toRaw(await halation(png, 1));
    const p = (60 * W + 78) * 4;
    expect(out.data[p]!).toBeGreaterThan(out.data[p + 2]!);
  });

  it('chromaticAberration fringes at the edges but not the centre', async () => {
    const data = Buffer.alloc(W * H * 4, 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const v = x % 8 < 4 ? 240 : 15;
        data[p] = v;
        data[p + 1] = v;
        data[p + 2] = v;
        data[p + 3] = 255;
      }
    }
    const png = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const out = await toRaw(await chromaticAberration(png, 4));
    const centreSplit = Math.abs(out.data[(60 * W + 60) * 4]! - out.data[(60 * W + 60) * 4 + 2]!);
    let edgeSplit = 0;
    for (let x = 2; x < 20; x++) {
      const p = (60 * W + x) * 4;
      edgeSplit = Math.max(edgeSplit, Math.abs(out.data[p]! - out.data[p + 2]!));
    }
    expect(centreSplit).toBeLessThan(12);
    expect(edgeSplit).toBeGreaterThan(40);
  });

  it('vignette darkens corners and spares the centre', async () => {
    const png = await plate({ r: 200, g: 200, b: 200 });
    const out = await toRaw(await vignette(png, 0.8, 0.3));
    expect(out.data[0]!).toBeLessThan(160);
    expect(out.data[(60 * W + 60) * 4]!).toBe(200);
  });

  it('filmGrain is deterministic and midtone-weighted', async () => {
    const mid = await plate({ r: 128, g: 128, b: 128 });
    const white = await plate({ r: 255, g: 255, b: 255 });
    const a = await filmGrain(mid, 0.5, 99);
    const b = await filmGrain(mid, 0.5, 99);
    const c = await filmGrain(mid, 0.5, 100);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    const midStd = (await sharp(a).stats()).channels[0]!.stdev;
    const highStd = (await sharp(await filmGrain(white, 0.5, 99)).stats()).channels[0]!.stdev;
    expect(midStd).toBeGreaterThan(highStd);
  });
});

describe('alphaBounds', () => {
  it('finds the cutout box', async () => {
    const img = await toRaw(await subject());
    expect(alphaBounds(img.data, W, H)).toEqual(BOX);
  });

  it('returns null for a fully transparent image', () => {
    expect(alphaBounds(Buffer.alloc(16 * 16 * 4, 0), 16, 16)).toBeNull();
  });

  it('honours the threshold', () => {
    const data = Buffer.alloc(4 * 4 * 4, 0);
    data[(1 * 4 + 1) * 4 + 3] = 40;
    expect(alphaBounds(data, 4, 4, 8)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(alphaBounds(data, 4, 4, 60)).toBeNull();
  });
});
