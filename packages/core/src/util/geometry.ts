/**
 * Geometry helpers shared by the layout resolver, the QA gates and the studio
 * overlay. Rects come in two flavours throughout the codebase: normalised
 * (0–1 canvas units, authored by template designers) and pixel (device units,
 * consumed by the compositor). `resolveRect` is the only sanctioned bridge.
 */

import type { Rect, PixelRect, Vec2, Anchor } from '../types/layout.js';

export function resolveRect(rect: Rect, width: number, height: number): PixelRect {
  return {
    x: Math.round(rect.x * width),
    y: Math.round(rect.y * height),
    w: Math.round(rect.w * width),
    h: Math.round(rect.h * height),
  };
}

export function normaliseRect(rect: PixelRect, width: number, height: number): Rect {
  return { x: rect.x / width, y: rect.y / height, w: rect.w / width, h: rect.h / height };
}

/** Offset applied to place content of size `w×h` at `anchor` within a rect. */
export function anchorOffset(anchor: Anchor, boxW: number, boxH: number, contentW: number, contentH: number): Vec2 {
  const [v, h] = anchor.split('-') as ['top' | 'center' | 'bottom', 'left' | 'center' | 'right'];
  const x = h === 'left' ? 0 : h === 'right' ? boxW - contentW : (boxW - contentW) / 2;
  const y = v === 'top' ? 0 : v === 'bottom' ? boxH - contentH : (boxH - contentH) / 2;
  return { x, y };
}

export function rectCenter(r: Rect | PixelRect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectArea(r: Rect | PixelRect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Overlap as a fraction of the smaller rect's area — 0 means disjoint. */
export function overlapRatio(a: Rect, b: Rect): number {
  const i = intersect(a, b);
  if (!i) return 0;
  const smaller = Math.min(rectArea(a), rectArea(b));
  return smaller === 0 ? 0 : rectArea(i) / smaller;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function clampRect(r: Rect, bounds: Rect = { x: 0, y: 0, w: 1, h: 1 }): Rect {
  const w = Math.min(r.w, bounds.w);
  const h = Math.min(r.h, bounds.h);
  return {
    x: Math.max(bounds.x, Math.min(r.x, bounds.x + bounds.w - w)),
    y: Math.max(bounds.y, Math.min(r.y, bounds.y + bounds.h - h)),
    w,
    h,
  };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/** Rule-of-thirds intersections in normalised units. */
export const THIRDS: readonly Vec2[] = [
  { x: 1 / 3, y: 1 / 3 }, { x: 2 / 3, y: 1 / 3 },
  { x: 1 / 3, y: 2 / 3 }, { x: 2 / 3, y: 2 / 3 },
];

const PHI_INV = 0.381966011;

/** Golden-ratio ("phi grid") intersections — tighter to centre than thirds. */
export const GOLDEN: readonly Vec2[] = [
  { x: PHI_INV, y: PHI_INV }, { x: 1 - PHI_INV, y: PHI_INV },
  { x: PHI_INV, y: 1 - PHI_INV }, { x: 1 - PHI_INV, y: 1 - PHI_INV },
];

/** Distance from `p` to the nearest point in `targets`. */
export function distanceToNearest(p: Vec2, targets: readonly Vec2[]): number {
  return targets.reduce((best, t) => Math.min(best, Math.hypot(p.x - t.x, p.y - t.y)), Infinity);
}

/** Fit `content` inside `box` preserving aspect. Returns a scale factor. */
export function fitScale(contentW: number, contentH: number, boxW: number, boxH: number, mode: 'cover' | 'contain'): number {
  const sx = boxW / contentW;
  const sy = boxH / contentH;
  return mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Smooth Hermite interpolation — used for falloffs in generated gradients. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
