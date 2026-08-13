import { describe, expect, it } from 'vitest';
import {
  SHORTS_SAFE_ZONES,
  SQUARE_SAFE_ZONES,
  YOUTUBE_SAFE_ZONES,
  diagonalSplit,
  makeGrid,
  orientationOf,
  safeZonesFor,
} from '../src/index.js';

describe('safe zones', () => {
  it('reflects the real YouTube chrome', () => {
    const pill = YOUTUBE_SAFE_ZONES.find((z) => z.id === 'yt-duration-pill')!;
    expect(pill.severity).toBe('hard');
    expect(pill.rect.x).toBeCloseTo(0.8, 2);
    expect(pill.rect.x + pill.rect.w).toBeCloseTo(0.99, 2);
    expect(pill.rect.y).toBeCloseTo(0.84, 2);
    expect(pill.rect.y + pill.rect.h).toBeCloseTo(0.97, 2);

    const progress = YOUTUBE_SAFE_ZONES.find((z) => z.id === 'yt-progress-bar')!;
    expect(progress.rect.y + progress.rect.h).toBeCloseTo(1, 5);
    expect(progress.rect.w).toBe(1);

    const hover = YOUTUBE_SAFE_ZONES.find((z) => z.id === 'yt-hover-controls')!;
    expect(hover.severity).toBe('soft');
    expect(hover.rect.y).toBe(0);
    expect(hover.rect.x + hover.rect.w).toBeCloseTo(1, 5);

    // 4% outer bleed ring, four strips, all soft
    const bleed = YOUTUBE_SAFE_ZONES.filter((z) => z.id.includes('bleed'));
    expect(bleed).toHaveLength(4);
    expect(bleed.every((z) => z.severity === 'soft')).toBe(true);
    expect(bleed.every((z) => Math.min(z.rect.w, z.rect.h) === 0.04)).toBe(true);

    // every zone documents where its numbers came from
    expect(YOUTUBE_SAFE_ZONES.every((z) => z.reason.length > 20)).toBe(true);
    expect(YOUTUBE_SAFE_ZONES.filter((z) => /APPROX/i.test(z.reason))).toHaveLength(YOUTUBE_SAFE_ZONES.length);
  });

  it('covers the Shorts vertical UI', () => {
    const rail = SHORTS_SAFE_ZONES.find((z) => z.id === 'shorts-action-rail')!;
    expect(rail.severity).toBe('hard');
    expect(rail.rect.x).toBeCloseTo(0.82, 2);
    expect(rail.rect.x + rail.rect.w).toBeCloseTo(1, 5);
    expect(rail.rect.y).toBeCloseTo(0.35, 2);
    expect(rail.rect.y + rail.rect.h).toBeCloseTo(0.95, 2);

    const caption = SHORTS_SAFE_ZONES.find((z) => z.id === 'shorts-caption-block')!;
    expect(caption.rect.x).toBe(0);
    expect(caption.rect.y).toBeGreaterThan(0.7);
    expect(caption.rect.x + caption.rect.w).toBeLessThanOrEqual(rail.rect.x + 1e-9);

    expect(SHORTS_SAFE_ZONES.some((z) => z.id === 'shorts-top-status')).toBe(true);
    expect(SHORTS_SAFE_ZONES.every((z) => /APPROX/i.test(z.reason))).toBe(true);
  });

  it('picks a set per aspect and hands back mutable copies', () => {
    expect(safeZonesFor(16 / 9).map((z) => z.id)).toEqual(YOUTUBE_SAFE_ZONES.map((z) => z.id));
    expect(safeZonesFor(9 / 16).map((z) => z.id)).toEqual(SHORTS_SAFE_ZONES.map((z) => z.id));
    expect(safeZonesFor(1).map((z) => z.id)).toEqual(SQUARE_SAFE_ZONES.map((z) => z.id));
    expect(orientationOf(21 / 9)).toBe('wide');
    expect(orientationOf(4 / 5)).toBe('tall');
    expect(orientationOf(1)).toBe('square');

    const copy = safeZonesFor(16 / 9);
    copy[0]!.rect.x = 0.123;
    expect(YOUTUBE_SAFE_ZONES[0]!.rect.x).not.toBe(0.123);
  });
});

describe('makeGrid', () => {
  it('tiles the canvas exactly when there is no gap or pad', () => {
    const cells = makeGrid(3, 2);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 1 / 3, h: 0.5 });
    expect(cells[5]!.x + cells[5]!.w).toBeCloseTo(1, 10);
    expect(cells[5]!.y + cells[5]!.h).toBeCloseTo(1, 10);
    // row-major
    expect(cells[1]!.y).toBe(cells[0]!.y);
    expect(cells[3]!.y).toBeGreaterThan(cells[0]!.y);
  });

  it('honours gap and pad', () => {
    const cells = makeGrid(2, 1, { gap: 0.04, pad: 0.05 });
    expect(cells[0]!.x).toBeCloseTo(0.05, 10);
    expect(cells[0]!.w).toBeCloseTo((1 - 0.1 - 0.04) / 2, 10);
    expect(cells[1]!.x).toBeCloseTo(cells[0]!.x + cells[0]!.w + 0.04, 10);
    expect(cells[1]!.x + cells[1]!.w).toBeCloseTo(0.95, 10);
  });

  it('rejects impossible grids', () => {
    expect(() => makeGrid(0, 2)).toThrow(/positive integer/);
    expect(() => makeGrid(2.5, 2)).toThrow(/positive integer/);
    expect(() => makeGrid(5, 1, { gap: 0.3 })).toThrow(/no room/);
    expect(() => makeGrid(2, 2, { pad: -0.1 })).toThrow(/>= 0/);
  });
});

describe('diagonalSplit', () => {
  it('returns two polygons that tile the canvas', () => {
    const { left, right } = diagonalSplit(12);
    expect(left).toHaveLength(4);
    expect(right).toHaveLength(4);
    // the divide is shared
    expect(left[1]).toEqual(right[0]);
    expect(left[2]).toEqual(right[3]);
    // positive angle leans the top of the divide to the right
    expect(left[1]!.x).toBeGreaterThan(left[2]!.x);
    // outer corners stay pinned
    expect(left[0]).toEqual({ x: 0, y: 0 });
    expect(right[1]).toEqual({ x: 1, y: 0 });
  });

  it('is vertical at 0° and honours the offset', () => {
    const straight = diagonalSplit(0);
    expect(straight.left[1]!.x).toBeCloseTo(0.5, 10);
    expect(straight.left[2]!.x).toBeCloseTo(0.5, 10);

    const shifted = diagonalSplit(0, 0.15);
    expect(shifted.left[1]!.x).toBeCloseTo(0.65, 10);
    expect(shifted.right[3]!.x).toBeCloseTo(0.65, 10);
  });

  it('clamps extreme angles into the canvas', () => {
    for (const angle of [-89, -75, 0, 45, 89]) {
      const { left, right } = diagonalSplit(angle, 0.4);
      for (const p of [...left, ...right]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });
});
