/**
 * Overlap resolution.
 *
 * Thumbnails are dense: text sits over chests, badges tuck into corners. So the
 * rule is deliberately narrow — we only pull apart the things that must never
 * collide, and we never move a subject.
 *
 *  • Subjects, backplates, fx and shapes are ANCHORS. They never move: the
 *    composition was designed around them and a subject nudged 20px is a
 *    subject with its face off the focal point.
 *  • Text, badges and logos are MOVABLE.
 *  • Movable × movable pairs are separated (both give half).
 *  • Movable × anchor pairs are separated ONLY when the movable slot names the
 *    anchor in `constraints.noOverlapWith` — text over a subject is normal
 *    design, text over the slot a designer explicitly fenced off is not.
 */

import type { PixelRect } from '@hexa/core';
import { clampRect, intersect } from '@hexa/core';
import type { ResolvedSlot } from './resolve.js';

const MOVABLE_KINDS = new Set(['text', 'badge', 'logo']);

/** Max separation passes before we accept the arrangement as good as it gets. */
const MAX_PASSES = 32;
/** Extra pixels added to each push so rects end up touching, not kissing. */
const PUSH_EPSILON = 1;

export interface ResolveOverlapsResult {
  slots: ResolvedSlot[];
  /** Ids of slots whose rect changed by at least 1px. */
  moved: string[];
}

export function isMovable(slot: ResolvedSlot): boolean {
  return MOVABLE_KINDS.has(slot.slot.kind);
}

/**
 * Nudge colliding non-subject slots apart with iterative separation steps.
 * Input slots are never mutated; new ResolvedSlot objects are returned.
 */
export function resolveOverlaps(
  slots: ResolvedSlot[],
  canvas: { width: number; height: number },
): ResolveOverlapsResult {
  const bounds: PixelRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const work = slots.map((s) => ({ ...s, rect: { ...s.rect } }));
  const original = new Map(slots.map((s) => [s.slot.id, { ...s.rect }] as const));

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let collisions = 0;
    for (let i = 0; i < work.length; i++) {
      const a = work[i]!;
      if (!isMovable(a)) continue;
      for (let j = 0; j < work.length; j++) {
        if (i === j) continue;
        const b = work[j]!;
        const bMovable = isMovable(b);
        if (!bMovable && !fenced(a, b)) continue;
        // Movable×movable pairs are handled once, from the lower index.
        if (bMovable && j < i) continue;
        const hit = intersect(a.rect, b.rect);
        if (!hit || hit.w <= 0 || hit.h <= 0) continue;
        collisions++;
        push(a, b, hit, bMovable, bounds);
      }
    }
    if (collisions === 0) break;
  }

  const moved: string[] = [];
  for (const s of work) {
    const before = original.get(s.slot.id);
    if (!before) continue;
    if (Math.abs(before.x - s.rect.x) >= 1 || Math.abs(before.y - s.rect.y) >= 1) {
      moved.push(s.slot.id);
    }
  }
  return { slots: work, moved };
}

/** Does `a` explicitly refuse to overlap `b`? */
function fenced(a: ResolvedSlot, b: ResolvedSlot): boolean {
  return a.slot.constraints?.noOverlapWith?.includes(b.slot.id) === true;
}

/**
 * Separate along the axis of least penetration — moving 12px sideways beats
 * moving 200px down, and it keeps reflowed layouts recognisable.
 */
function push(
  a: ResolvedSlot,
  b: ResolvedSlot,
  hit: PixelRect,
  shareWithB: boolean,
  bounds: PixelRect,
): void {
  const aCx = a.rect.x + a.rect.w / 2;
  const aCy = a.rect.y + a.rect.h / 2;
  const bCx = b.rect.x + b.rect.w / 2;
  const bCy = b.rect.y + b.rect.h / 2;

  const horizontal = hit.w <= hit.h;
  const total = (horizontal ? hit.w : hit.h) + PUSH_EPSILON;
  const aShare = shareWithB ? total / 2 : total;
  const bShare = shareWithB ? total / 2 : 0;

  if (horizontal) {
    const dir = aCx <= bCx ? -1 : 1;
    a.rect.x = Math.round(a.rect.x + dir * aShare);
    if (shareWithB) b.rect.x = Math.round(b.rect.x - dir * bShare);
  } else {
    const dir = aCy <= bCy ? -1 : 1;
    a.rect.y = Math.round(a.rect.y + dir * aShare);
    if (shareWithB) b.rect.y = Math.round(b.rect.y - dir * bShare);
  }

  a.rect = clampRect(a.rect, bounds);
  if (shareWithB) b.rect = clampRect(b.rect, bounds);
}
