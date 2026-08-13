/**
 * Aspect reflow: 16:9 → 9:16 and back.
 *
 * A naive adapt stretches every rect and produces a squashed disaster. Hexa
 * instead REBUILDS the arrangement, because a wide versus and a vertical versus
 * are genuinely different compositions.
 *
 * ── Reflow rules ─────────────────────────────────────────────────────────────
 *
 * R0. Classify. `orientationOf` buckets both aspects into wide / square / tall.
 *     Aspect changes smaller than ~2% are a no-op (only `designAspect` moves).
 *
 * R1. Same bucket (16:9 → 21:9, 4:5 → 9:16) → SQUEEZE. Rects keep their pixel
 *     size and their pixel offset from the canvas centre: w' = w·(from/to) with
 *     the centre re-mapped the same way. Nothing is re-arranged, because
 *     nothing needs to be.
 *
 * R2. Wide/square → tall → STACK.
 *     R2a. Subject slots become a vertical stack, ordered left→right as
 *          top→bottom so reading order survives. Each gets a
 *          band of the lower 70% of the canvas, with a 6% band overlap so the
 *          subjects interlock rather than sitting in tidy boxes, and alternating
 *          ±5% horizontal offsets so the stack has some rhythm.
 *          Every subject keeps its PIXEL aspect ratio: w' = w·(h'/h)·(from/to).
 *     R2b. The headline (largest 'text' slot) moves to the top third — on a
 *          phone the thumbnail is scrolled past vertically and the top is what
 *          is read first.
 *     R2c. Text slots bound to a subject (their centre sits inside that
 *          subject's horizontal span in the source layout) follow that subject
 *          and dock to the bottom of its new band — name plates stay with their
 *          player. Everything else keeps its half of the frame: sourced above
 *          the middle → top band under the headline, below → bottom band.
 *     R2d. Type gets bigger: text boxes keep their shape but grow 1.5× relative
 *          to canvas width (TEXT_LEGIBILITY_BOOST). In absolute pixels that is
 *          a ~1.27× increase for 16:9 → 9:16, which is roughly the difference
 *          between a desktop grid card and a phone held at arm's length.
 *     R2e. Backplates and fx that already covered the frame go full-bleed.
 *     R2f. Reflowed text stops above the target platform's bottom chrome
 *          (y 0.76 for vertical players, 0.95 for 16:9) instead of being docked
 *          straight under a caption block or a progress bar.
 *
 * R3. Tall → wide/square → SPREAD: the exact inverse. Stacked subjects become
 *     columns ordered top→bottom as left→right, bottoms locked to the canvas
 *     floor; the headline drops into the centre band between the columns (the
 *     classic VS lock-up) or to the upper-left third when there is only one
 *     subject; type shrinks by the same 1.5× factor.
 *
 * R4. Platform safe zones (`yt-*`, `shorts-*`, `sq-*`) are swapped for the
 *     target's set; hand-authored zones are kept and re-clamped.
 *
 * R5. Focal points and guides follow their slot: a point inside a subject slot
 *     is re-emitted at the same slot-local coordinates in that slot's new rect.
 *     Unbound points keep their relative position (cross reflow) or the pixel
 *     mapping (squeeze).
 *
 * R6. Finally everything is clamped inside the canvas and `resolveOverlaps`
 *     runs on a canonical canvas, so a reflow can never emit text stacked on
 *     text. Slot ids, kinds, z-order, count and every non-geometry property are
 *     preserved — only rects (and `designAspect`) change.
 */

import type { LayoutSpec, Rect, SafeZone, Slot, Vec2 } from '@hexa/core';
import { HexaError, clamp, clampRect, normaliseRect, resolveRect } from '@hexa/core';
import { isPlatformZoneId, orientationOf, safeZonesFor } from './safe-zones.js';
import { resolveOverlaps } from './overlap.js';
import type { ResolvedSlot } from './resolve.js';

/** How much bigger type gets, relative to canvas width, on a wide→tall reflow. */
export const TEXT_LEGIBILITY_BOOST = 1.5;
/** Top of the subject band in a stacked (vertical) layout. */
const SUBJECT_BAND_TOP = 0.3;
/** Fraction of a band the subjects overlap into each other. */
const BAND_OVERLAP = 0.06;
/** Horizontal rhythm applied to alternating stacked subjects. */
const STACK_SWAY = 0.05;
/** Side margin for spread columns. */
const COLUMN_MARGIN = 0.02;
/** Widest a text box may get after a reflow. */
const MAX_TEXT_WIDTH = 0.92;
/**
 * Lowest a reflowed text box may sit, per target orientation. Vertical players
 * bury the bottom ~22% under the caption block and the nav bar; 16:9 cards only
 * lose the progress strip. Reflowed text stops above that chrome instead of
 * being dropped straight into it.
 */
const BOTTOM_LIMIT = { stack: 0.76, spread: 0.95 } as const;
/** Canonical canvas width used for the post-reflow overlap pass. */
const CANONICAL_WIDTH = 1200;

const TEXTISH = new Set(['text', 'badge', 'logo']);

/**
 * Reflow a layout for a different canvas aspect (width / height).
 * The input is never mutated.
 */
export function adaptLayout(layout: LayoutSpec, targetAspect: number): LayoutSpec {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) {
    throw new HexaError('INVALID_REQUEST', `adaptLayout: target aspect must be > 0, got ${targetAspect}`);
  }
  const from = Number.isFinite(layout.designAspect) && layout.designAspect > 0 ? layout.designAspect : 16 / 9;
  const to = targetAspect;
  const out = cloneSpec(layout);
  out.designAspect = to;

  // R0 — negligible change.
  if (Math.abs(Math.log(to / from)) < 0.02) return out;

  const fromO = orientationOf(from);
  const toO = orientationOf(to);
  const mode: 'squeeze' | 'stack' | 'spread' =
    toO === 'tall' && fromO !== 'tall' ? 'stack' : fromO === 'tall' && toO !== 'tall' ? 'spread' : 'squeeze';

  const rects = new Map<string, Rect>();
  if (mode === 'squeeze') {
    for (const s of out.slots) rects.set(s.id, squeezeRect(s.rect, from, to));
  } else {
    reflowCross(out, from, to, mode, rects);
  }

  // R6 — clamp, then separate anything that ended up on top of something else.
  for (const s of out.slots) {
    s.rect = clampRect(rects.get(s.id) ?? s.rect);
  }
  separate(out, to);
  if (mode !== 'squeeze') keepTextInBand(out, BOTTOM_LIMIT[mode]);

  // R5 — focal points and guides.
  out.focalPoints = layout.focalPoints.map((p) => mapPoint(p, layout, out, mode, from, to));
  if (out.guides) {
    out.guides = out.guides.map((g) => ({
      ...g,
      points: g.points.map((p) => mapPoint(p, layout, out, mode, from, to)),
    }));
  }

  // R4 — platform safe zones.
  const custom = layout.safeZones.filter((z) => !isPlatformZoneId(z.id));
  out.safeZones = [
    ...safeZonesFor(to),
    ...custom.map((z): SafeZone => ({ ...z, rect: clampRect(mode === 'squeeze' ? squeezeRect(z.rect, from, to) : { ...z.rect }) })),
  ];

  out.description = `${layout.description ? `${layout.description} ` : ''}[reflowed ${fmt(from)} → ${fmt(to)} by ${mode}]`;
  return out;
}

/* ------------------------------------------------------------------------ */
/* cross-orientation reflow                                                  */
/* ------------------------------------------------------------------------ */

function reflowCross(
  spec: LayoutSpec,
  from: number,
  to: number,
  mode: 'stack' | 'spread',
  rects: Map<string, Rect>,
): void {
  const source = new Map(spec.slots.map((s) => [s.id, { ...s.rect }] as const));

  // Backgrounds first (R2e).
  for (const s of spec.slots) {
    if (s.kind !== 'backplate' && s.kind !== 'fx' && s.kind !== 'shape') continue;
    const r = s.rect;
    const covers = r.w * r.h >= 0.85 && r.x <= 0.08 && r.y <= 0.08;
    rects.set(s.id, covers ? { x: 0, y: 0, w: 1, h: 1 } : { ...r });
  }

  // Subjects (R2a / R3).
  const subjects = spec.slots.filter((s) => s.kind === 'subject');
  // Reading order decides who lands top/left, so ties must not be settled by
  // however the caller happened to order `spec.slots` — two subjects sharing a
  // centre line (a symmetric versus, a vertical stack) is ordinary, and the same
  // spec with its slots listed in a different order must reflow identically.
  // Compared by code unit, not `localeCompare`: collation is ICU-version
  // dependent and this ordering has to be byte-stable across machines.
  const ordered = [...subjects].sort(
    (a, b) =>
      (mode === 'stack'
        ? a.rect.x + a.rect.w / 2 - (b.rect.x + b.rect.w / 2)
        : a.rect.y + a.rect.h / 2 - (b.rect.y + b.rect.h / 2)) || compareIds(a.id, b.id),
  );
  const n = ordered.length;
  ordered.forEach((s, i) => {
    rects.set(s.id, mode === 'stack' ? stackBand(s, i, n, from, to) : spreadColumn(s, i, n, from, to));
  });

  // Text (R2b–R2d).
  const texts = spec.slots.filter((s) => TEXTISH.has(s.kind));
  const headline = dominantText(texts);
  const upper: Slot[] = [];
  const lower: Slot[] = [];
  const dockedBy = new Map<string, Slot[]>();

  for (const t of texts) {
    if (t === headline) continue;
    const owner = ownerSubject(t, ordered, source);
    if (owner) {
      const list = dockedBy.get(owner.id) ?? [];
      list.push(t);
      dockedBy.set(owner.id, list);
    } else if (t.rect.y + t.rect.h / 2 < 0.5) upper.push(t);
    else lower.push(t);
  }

  if (headline) {
    const g = textGeom(headline.rect, from, to, mode);
    if (mode === 'stack') {
      rects.set(headline.id, { x: 0.5 - g.w / 2, y: 0.05, w: g.w, h: g.h });
    } else if (n >= 2) {
      // The gap between columns is where a VS lock-up belongs.
      rects.set(headline.id, { x: 0.5 - g.w / 2, y: 0.5 - g.h / 2, w: g.w, h: g.h });
    } else {
      rects.set(headline.id, { x: 0.06, y: 0.1, w: g.w, h: g.h });
    }
  }

  const floor = BOTTOM_LIMIT[mode];
  for (const [ownerId, list] of dockedBy) {
    const band = rects.get(ownerId);
    if (!band) continue;
    let cursor = Math.min(band.y + band.h - 0.015, floor);
    for (const t of list) {
      const g = textGeom(t.rect, from, to, mode);
      cursor -= g.h;
      rects.set(t.id, { x: band.x + band.w / 2 - g.w / 2, y: cursor, w: g.w, h: g.h });
      cursor -= 0.01;
    }
  }

  let topCursor = headline && mode === 'stack' ? 0.05 + (rects.get(headline.id)?.h ?? 0) + 0.015 : 0.04;
  for (const t of upper) {
    const g = textGeom(t.rect, from, to, mode);
    rects.set(t.id, { x: 0.5 - g.w / 2, y: topCursor, w: g.w, h: g.h });
    topCursor += g.h + 0.012;
  }
  let bottomCursor = floor;
  for (const t of [...lower].reverse()) {
    const g = textGeom(t.rect, from, to, mode);
    bottomCursor -= g.h;
    rects.set(t.id, { x: 0.5 - g.w / 2, y: bottomCursor, w: g.w, h: g.h });
    bottomCursor -= 0.012;
  }

  // Anything not covered above keeps its relative position.
  for (const s of spec.slots) if (!rects.has(s.id)) rects.set(s.id, { ...s.rect });
}

/** Vertical band for the i-th subject of a stacked layout. */
function stackBand(slot: Slot, i: number, n: number, from: number, to: number): Rect {
  if (n <= 1) {
    const h = 0.7;
    const w = clamp(keepPixelAspectWidth(slot.rect.w, slot.rect.h, h, from, to), 0.2, 1);
    return { x: 0.5 - w / 2, y: 1 - h, w, h };
  }
  const usable = 1 - SUBJECT_BAND_TOP;
  const bandH = usable / n;
  const h = bandH * (1 + BAND_OVERLAP);
  let y = SUBJECT_BAND_TOP + i * bandH - (i > 0 ? bandH * BAND_OVERLAP : 0);
  y = Math.min(y, 1 - h);
  const w = clamp(keepPixelAspectWidth(slot.rect.w, slot.rect.h, h, from, to), 0.2, 1);
  const sway = n === 2 ? (i === 0 ? -STACK_SWAY : STACK_SWAY) : 0;
  const cx = clamp(0.5 + sway, w / 2, 1 - w / 2);
  return { x: cx - w / 2, y, w, h };
}

/** Column for the i-th subject of a spread (wide) layout, feet on the floor. */
function spreadColumn(slot: Slot, i: number, n: number, from: number, to: number): Rect {
  const cols = Math.max(1, n);
  const colW = (1 - COLUMN_MARGIN * 2) / cols;
  const cx = COLUMN_MARGIN + colW * (i + 0.5);
  let w = Math.min(colW * 1.1, 1);
  let h = keepPixelAspectHeight(slot.rect.w, slot.rect.h, w, from, to);
  if (h > 1) {
    h = 1;
    w = clamp(keepPixelAspectWidth(slot.rect.w, slot.rect.h, h, from, to), 0.1, 1);
  }
  const x = clamp(cx - w / 2, 0, 1 - w);
  return { x, y: 1 - h, w, h };
}

/** Text box geometry after a cross reflow: same shape, legibility-scaled. */
function textGeom(rect: Rect, from: number, to: number, mode: 'stack' | 'spread'): { w: number; h: number } {
  const boost = mode === 'stack' ? TEXT_LEGIBILITY_BOOST : 1 / TEXT_LEGIBILITY_BOOST;
  let h = rect.h * (to / from) * boost;
  let w = keepPixelAspectWidth(rect.w, rect.h, h, from, to);
  if (w > MAX_TEXT_WIDTH) {
    h *= MAX_TEXT_WIDTH / w;
    w = MAX_TEXT_WIDTH;
  }
  return { w: clamp(w, 0.02, MAX_TEXT_WIDTH), h: clamp(h, 0.015, 0.4) };
}

/** Largest 'text' slot — the headline for reflow purposes. */
function dominantText(texts: Slot[]): Slot | undefined {
  let best: Slot | undefined;
  let bestArea = 0;
  for (const t of texts) {
    if (t.kind !== 'text') continue;
    const area = t.rect.w * t.rect.h;
    if (area > bestArea) {
      bestArea = area;
      best = t;
    }
  }
  return best;
}

/** The subject a text slot visually belongs to, if any. */
function ownerSubject(text: Slot, subjects: Slot[], source: Map<string, Rect>): Slot | undefined {
  const cx = text.rect.x + text.rect.w / 2;
  const cy = text.rect.y + text.rect.h / 2;
  for (const s of subjects) {
    const r = source.get(s.id) ?? s.rect;
    // 10% inset so a dead-centre "VS" badge does not bind to either side.
    const inset = r.w * 0.1;
    const insetY = r.h * 0.1;
    if (cx > r.x + inset && cx < r.x + r.w - inset && cy > r.y - insetY && cy < r.y + r.h + insetY) {
      return s;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------------ */
/* shared helpers                                                            */
/* ------------------------------------------------------------------------ */

/** Width that keeps a rect's PIXEL aspect ratio when its height and the canvas aspect change. */
function keepPixelAspectWidth(w: number, h: number, newH: number, from: number, to: number): number {
  if (h <= 0) return w;
  return w * (newH / h) * (from / to);
}

/** Height that keeps a rect's PIXEL aspect ratio when its width and the canvas aspect change. */
function keepPixelAspectHeight(w: number, h: number, newW: number, from: number, to: number): number {
  if (w <= 0) return h;
  return h * (newW / w) * (to / from);
}

/** R1 — same pixels, different canvas: rescale x/w about the centre. */
function squeezeRect(r: Rect, from: number, to: number): Rect {
  const k = from / to;
  const cx = 0.5 + (r.x + r.w / 2 - 0.5) * k;
  const w = r.w * k;
  return { x: cx - w / 2, y: r.y, w, h: r.h };
}

function mapPoint(
  p: Vec2,
  before: LayoutSpec,
  after: LayoutSpec,
  mode: 'squeeze' | 'stack' | 'spread',
  from: number,
  to: number,
): Vec2 {
  // R5 — a point that lives inside a slot travels with that slot.
  for (const s of before.slots) {
    if (s.kind !== 'subject' && s.kind !== 'text') continue;
    const r = s.rect;
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
    const target = after.slots.find((o) => o.id === s.id);
    if (!target) continue;
    const u = r.w > 0 ? (p.x - r.x) / r.w : 0.5;
    const v = r.h > 0 ? (p.y - r.y) / r.h : 0.5;
    return {
      x: clamp(target.rect.x + u * target.rect.w, 0, 1),
      y: clamp(target.rect.y + v * target.rect.h, 0, 1),
    };
  }
  if (mode === 'squeeze') {
    return { x: clamp(0.5 + (p.x - 0.5) * (from / to), 0, 1), y: clamp(p.y, 0, 1) };
  }
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

/**
 * R2f — the separation pass can shove a caption back down into the platform's
 * bottom chrome, so the band is re-imposed afterwards as a hard invariant.
 * Text is translated up, never resized.
 */
function keepTextInBand(spec: LayoutSpec, limit: number): void {
  for (const s of spec.slots) {
    if (!TEXTISH.has(s.kind)) continue;
    const overflow = s.rect.y + s.rect.h - limit;
    if (overflow <= 0) continue;
    s.rect = { ...s.rect, y: Math.max(0, s.rect.y - overflow) };
  }
}

/** R6 — run the real overlap resolver on a canonical canvas, then write back. */
function separate(spec: LayoutSpec, aspect: number): void {
  const width = CANONICAL_WIDTH;
  const height = Math.max(1, Math.round(CANONICAL_WIDTH / aspect));
  const resolved: ResolvedSlot[] = spec.slots.map((slot) => ({
    slot,
    rect: resolveRect(slot.rect, width, height),
    z: slot.z,
  }));
  const { slots } = resolveOverlaps(resolved, { width, height });
  const byId = new Map(slots.map((s) => [s.slot.id, s.rect] as const));
  for (const s of spec.slots) {
    const px = byId.get(s.id);
    if (!px) continue;
    s.rect = clampRect(normaliseRect(px, width, height));
  }
}

function cloneSpec(spec: LayoutSpec): LayoutSpec {
  return {
    ...spec,
    slots: spec.slots.map(cloneSlot),
    safeZones: spec.safeZones.map((z) => ({ ...z, rect: { ...z.rect } })),
    focalPoints: spec.focalPoints.map((p) => ({ ...p })),
    guides: spec.guides?.map((g) => ({ ...g, points: g.points.map((p) => ({ ...p })) })),
  };
}

function cloneSlot(s: Slot): Slot {
  const copy: Slot = { ...s, rect: { ...s.rect } };
  if (s.focal) copy.focal = { ...s.focal };
  if (s.constraints) copy.constraints = { ...s.constraints };
  if (s.meta) copy.meta = { ...s.meta };
  return copy;
}

function fmt(aspect: number): string {
  return `${aspect.toFixed(3)}:1`;
}

/** Total, locale-independent id order — the tiebreak of last resort. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
