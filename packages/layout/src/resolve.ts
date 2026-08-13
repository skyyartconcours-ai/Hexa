/**
 * Layout resolution: normalised template geometry → device pixels.
 *
 * This is the ONLY place normalised units become pixels for slots, and it
 * happens exactly once per render. Everything downstream (subject fitting,
 * composition scoring, QA) works in the resolved pixel space.
 */

import type { LayoutSpec, PixelRect, SafeZone, Slot, Vec2 } from '@hexa/core';
import { HexaError, anchorOffset, clampRect, resolveRect } from '@hexa/core';

export interface ResolvedSlot {
  slot: Slot;
  rect: PixelRect;
  z: number;
}

export interface ResolvedSafeZone {
  zone: SafeZone;
  rect: PixelRect;
}

export interface ResolvedLayout {
  canvas: { width: number; height: number };
  /** Paint order, ascending `z`. Ties keep the authored order. */
  slots: ResolvedSlot[];
  safeZones: ResolvedSafeZone[];
  byId(id: string): ResolvedSlot | undefined;
  /**
   * Additive extension over the documented minimum: the spec this layout was
   * resolved from. `scoreComposition` needs `focalPoints` and the slots' `meta`
   * to judge hierarchy and declared asymmetry, and carrying the spec beats
   * threading it through every call site.
   */
  spec: LayoutSpec;
  /** Convenience mirror of `spec.focalPoints`. */
  focalPoints: Vec2[];
}

/**
 * Resolve a LayoutSpec against a pixel canvas.
 *
 * Per slot:
 *  1. `rect` is resolved with `geometry.resolveRect` (round-to-nearest pixel).
 *  2. `slot.scale` shrinks/grows the box about the slot's `anchor` — so a
 *     `bottom-center` slot scaled to 0.8 keeps its feet on the same line.
 *  3. `constraints.clampToCanvas` pulls the result fully back inside the frame.
 *
 * Slots are returned sorted by `z` ascending (painter's order). The sort is
 * stable, so equal-z slots keep their authored order.
 */
export function resolveLayout(layout: LayoutSpec, width: number, height: number): ResolvedLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new HexaError('INVALID_REQUEST', `resolveLayout needs a positive canvas, got ${width}×${height}`);
  }
  const canvasBounds: PixelRect = { x: 0, y: 0, w: width, h: height };

  const resolved: ResolvedSlot[] = layout.slots.map((slot) => {
    const box = resolveRect(slot.rect, width, height);
    const scale = slot.scale ?? 1;
    let rect: PixelRect = box;
    if (scale !== 1) {
      const w = Math.round(box.w * scale);
      const h = Math.round(box.h * scale);
      const off = anchorOffset(slot.anchor, box.w, box.h, w, h);
      rect = { x: box.x + Math.round(off.x), y: box.y + Math.round(off.y), w, h };
    }
    if (slot.constraints?.clampToCanvas) {
      rect = clampRect(rect, canvasBounds);
    }
    return { slot, rect, z: slot.z };
  });

  // Stable sort: Array.prototype.sort is spec-stable since ES2019.
  resolved.sort((a, b) => a.z - b.z);

  const index = new Map<string, ResolvedSlot>();
  for (const r of resolved) {
    if (index.has(r.slot.id)) {
      throw new HexaError('INVALID_REQUEST', `Layout "${layout.id}" has duplicate slot id "${r.slot.id}"`, {
        hint: 'Slot ids address text, assets and QA findings — they must be unique.',
      });
    }
    index.set(r.slot.id, r);
  }

  const safeZones: ResolvedSafeZone[] = layout.safeZones.map((zone) => ({
    zone,
    rect: resolveRect(zone.rect, width, height),
  }));

  return {
    canvas: { width, height },
    slots: resolved,
    safeZones,
    byId: (id: string) => index.get(id),
    spec: layout,
    focalPoints: layout.focalPoints.map((p) => ({ ...p })),
  };
}

/** Rebuild a ResolvedLayout with a new slot array (keeps the id index honest). */
export function withSlots(layout: ResolvedLayout, slots: ResolvedSlot[]): ResolvedLayout {
  const sorted = [...slots].sort((a, b) => a.z - b.z);
  const index = new Map(sorted.map((s) => [s.slot.id, s] as const));
  return {
    canvas: layout.canvas,
    slots: sorted,
    safeZones: layout.safeZones,
    byId: (id: string) => index.get(id),
    spec: layout.spec,
    focalPoints: layout.focalPoints,
  };
}
