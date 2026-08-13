/**
 * Rect plumbing between the three coordinate systems in play: normalised canvas
 * units (what templates author and what `QaFinding.where` reports), device
 * pixels at render size (what the gates measure in), and device pixels at a
 * simulated display size (what legibility measures in).
 */

import { clamp, intersect, rectArea } from '@hexa/core';
import type { PixelRect, Rect, RenderPlan, SafeZone } from '@hexa/core';
import type { GateContext, GateTextRect, QaRect } from './types.js';

/**
 * A rect is treated as normalised when every component fits in 0–1. A device
 * rect that small would be sub-pixel and meaningless, so the heuristic is safe;
 * it is what lets callers hand us either flavour without ceremony.
 */
export function isNormalised(r: QaRect): boolean {
  return r.x >= -0.001 && r.y >= -0.001 && r.w <= 1.001 && r.h <= 1.001 && r.x <= 1.001 && r.y <= 1.001;
}

export function toPixelRect(r: QaRect, width: number, height: number): PixelRect {
  if (!isNormalised(r)) return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  return { x: Math.round(r.x * width), y: Math.round(r.y * height), w: Math.round(r.w * width), h: Math.round(r.h * height) };
}

export function toNormRect(r: QaRect, width: number, height: number): Rect {
  if (isNormalised(r)) return { x: r.x, y: r.y, w: r.w, h: r.h };
  return { x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height };
}

/** Scale a rect from one pixel space into another (render size → display size). */
export function scaleRect(r: PixelRect, from: { w: number; h: number }, to: { w: number; h: number }): PixelRect {
  return {
    x: Math.round((r.x / from.w) * to.w),
    y: Math.round((r.y / from.h) * to.h),
    w: Math.max(1, Math.round((r.w / from.w) * to.w)),
    h: Math.max(1, Math.round((r.h / from.h) * to.h)),
  };
}

/** The ring of background immediately around a rect, as four sub-rects. */
export function surroundRects(r: PixelRect, pad: number, width: number, height: number): PixelRect[] {
  const x0 = Math.max(0, r.x - pad);
  const y0 = Math.max(0, r.y - pad);
  const x1 = Math.min(width, r.x + r.w + pad);
  const y1 = Math.min(height, r.y + r.h + pad);
  const out: PixelRect[] = [
    { x: x0, y: y0, w: x1 - x0, h: Math.max(0, r.y - y0) },                      // above
    { x: x0, y: Math.min(height, r.y + r.h), w: x1 - x0, h: Math.max(0, y1 - (r.y + r.h)) }, // below
    { x: x0, y: r.y, w: Math.max(0, r.x - x0), h: r.h },                          // left
    { x: Math.min(width, r.x + r.w), y: r.y, w: Math.max(0, x1 - (r.x + r.w)), h: r.h }, // right
  ];
  return out.filter((s) => s.w > 0 && s.h > 0);
}

/**
 * Text rects, from the caller if supplied, else recovered from the plan.
 * Recovery keys off the layer id/label convention `text:<role>` (also accepting
 * `text-<role>` and a bare label match) so a gate still has something to check
 * when it is handed only a plan.
 */
export function collectTextRects(ctx: GateContext): { role: string; rect: PixelRect }[] {
  if (ctx.textRects?.length) {
    return ctx.textRects.map((t) => ({ role: t.role, rect: toPixelRect(t.rect, ctx.width, ctx.height) }));
  }
  const out: { role: string; rect: PixelRect }[] = [];
  for (const layer of ctx.plan.layers) {
    const role = textRoleOfLayer(layer.id, layer.label);
    if (role) out.push({ role, rect: layer.rect });
  }
  return out;
}

export function textRoleOfLayer(id: string, label?: string): string | null {
  for (const key of [id, label ?? '']) {
    const m = /^text[:\-.](.+)$/i.exec(key);
    if (m) return m[1]!;
  }
  return null;
}

/** Layers that carry a brand mark or a badge — safe zones care about these. */
export function collectMarkRects(plan: RenderPlan): { role: string; rect: PixelRect }[] {
  const out: { role: string; rect: PixelRect }[] = [];
  for (const layer of plan.layers) {
    const key = `${layer.id} ${layer.label ?? ''}`.toLowerCase();
    if (/\b(logo|badge|watermark|sponsor|crest)\b/.test(key) || /^(logo|badge)[:\-.]/.test(key)) {
      out.push({ role: layer.id, rect: layer.rect });
    }
  }
  return out;
}

/**
 * Safe zones declared by the plan. Templates put their LayoutSpec zones in
 * `plan.meta.safeZones`; when nothing is declared we fall back to the platform
 * furniture YouTube paints over every thumbnail, as *soft* zones only — warning
 * about the duration pill is useful, failing on it when the template never
 * opted in would not be.
 */
export function collectSafeZones(plan: RenderPlan): { zones: SafeZone[]; declared: boolean } {
  const raw = (plan.meta as Record<string, unknown>)['safeZones'];
  if (Array.isArray(raw) && raw.length) {
    const zones = raw.filter(isSafeZone);
    if (zones.length) return { zones, declared: true };
  }
  return { zones: DEFAULT_SAFE_ZONES.map((z) => ({ ...z })), declared: false };
}

function isSafeZone(v: unknown): v is SafeZone {
  if (!v || typeof v !== 'object') return false;
  const z = v as Partial<SafeZone>;
  return typeof z.id === 'string' && !!z.rect && typeof z.rect.x === 'number' && (z.severity === 'hard' || z.severity === 'soft');
}

/**
 * Platform furniture that sits on top of a YouTube thumbnail regardless of what
 * the designer intended: the duration pill (bottom-right), the resume/progress
 * bar (bottom edge), and the hover "watch later"/queue buttons (top-right).
 */
export const DEFAULT_SAFE_ZONES: readonly SafeZone[] = [
  { id: 'yt-duration-pill', rect: { x: 0.79, y: 0.83, w: 0.21, h: 0.17 }, severity: 'soft', reason: 'YouTube paints the duration badge here' },
  { id: 'yt-progress-bar', rect: { x: 0, y: 0.955, w: 1, h: 0.045 }, severity: 'soft', reason: 'Resume-progress bar covers the bottom edge on watched videos' },
  { id: 'yt-hover-actions', rect: { x: 0.78, y: 0, w: 0.22, h: 0.16 }, severity: 'soft', reason: 'Watch-later / queue buttons appear here on hover' },
];

/** How much of `inner` sits inside `zone`, 0–1 of `inner`'s own area. */
export function coverageOf(inner: Rect, zone: Rect): number {
  const i = intersect(inner, zone);
  if (!i) return 0;
  const a = rectArea(inner);
  return a === 0 ? 0 : rectArea(i) / a;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Map a measurement onto 0–1 with a linear ramp between `bad` and `good`.
 *  Works in both directions (`bad` may be the larger number). */
export function ramp(value: number, bad: number, good: number): number {
  if (good === bad) return value >= good ? 1 : 0;
  return clamp01((value - bad) / (good - bad));
}
