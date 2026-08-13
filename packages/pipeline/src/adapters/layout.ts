/**
 * @hexa/layout adapter — normalised geometry → device pixels.
 *
 * `fitSubject` is the one call in the whole pipeline that decides whether a
 * composite looks professional: it works out the crop, scale and mirror that put
 * the subject's *face* on the slot's focal point. Everything downstream (rim
 * light angle, text placement, the identity crop QA takes) is measured against
 * what it returns, so its result is normalised carefully here.
 */

import type { AspectPreset, FaceBox, LayoutSpec, PixelRect, Rect, SafeZone, Slot } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule } from './load.js';
import { toArray, toNumber, toRect } from './normalise.js';
import {
  LAYOUT_EXPORTS,
  type CompositionScore,
  type FitSubjectInput,
  type LayoutModule,
  type ResolvedLayout,
  type ResolvedSlot,
  type SubjectFit,
} from './contracts.js';

const SPEC = '@hexa/layout';
const HINT = 'The layout package is not built. Run: pnpm --filter @hexa/layout build';

async function mod(): Promise<LayoutModule> {
  return loadModule<LayoutModule>(SPEC, { needs: LAYOUT_EXPORTS, hint: HINT });
}

/**
 * Resolve every slot to pixels.
 *
 * Slots come back in **z order**, because the compiler walks them in paint order
 * and relying on the sibling's array order would be a silent layering bug.
 */
export async function resolveLayoutPixels(layout: LayoutSpec, width: number, height: number): Promise<ResolvedLayout> {
  const m = await mod();
  const raw = m.resolveLayout(layout, width, height) as unknown;
  const slots = normaliseSlots(raw, layout, width, height);
  const safeZones = normaliseSafeZones(raw, layout);
  return {
    slots: [...slots].sort((a, b) => (a.slot.z ?? 0) - (b.slot.z ?? 0)),
    safeZones,
    width,
    height,
    focalPoints: layout.focalPoints,
  };
}

function normaliseSlots(raw: unknown, layout: LayoutSpec, width: number, height: number): ResolvedSlot[] {
  const list = toArray<Record<string, unknown>>(
    raw && typeof raw === 'object' && 'slots' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>)['slots']
      : raw,
  );

  const bySlotId = new Map(layout.slots.map((s) => [s.id, s]));
  const out: ResolvedSlot[] = [];

  for (const entry of list) {
    // Two plausible spellings: `{slot, rect}` or a Slot flattened with a rect
    // already in pixels. Both carry an id we can reconcile against the spec.
    const nested = entry['slot'];
    const slot = (nested && typeof nested === 'object' ? (nested as Slot) : (entry as unknown as Slot));
    const spec = bySlotId.get(slot?.id) ?? slot;
    if (!spec?.id) continue;

    const rect = toRect(entry['rect'] ?? entry['pixelRect'] ?? entry['bounds'] ?? slot?.rect);
    if (!rect) continue;

    out.push({ slot: spec, rect, focal: focalPixels(spec, rect) });
  }

  if (out.length === 0 && layout.slots.length > 0) {
    throw new HexaError('RENDER_FAILED', `resolveLayout("${layout.id}") produced no usable slots`, {
      hint: 'The return shape of @hexa/layout resolveLayout has drifted — fix packages/pipeline/src/adapters/layout.ts.',
      details: { layout: layout.id, width, height, slots: layout.slots.length },
    });
  }
  return out;
}

function normaliseSafeZones(raw: unknown, layout: LayoutSpec): SafeZone[] {
  const fromRaw = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['safeZones'] : undefined;
  const list = toArray<SafeZone>(fromRaw);
  return list.length > 0 ? list : [...(layout.safeZones ?? [])];
}

/** Focal point of a subject slot in absolute canvas pixels. */
function focalPixels(slot: Slot, rect: PixelRect): { x: number; y: number } | undefined {
  if (slot.kind !== 'subject') return undefined;
  // (0.5, 0.38) is the documented default: centred horizontally with natural
  // headroom, which is where an eye expects a face to sit.
  const fx = slot.focal?.x ?? 0.5;
  const fy = slot.focal?.y ?? 0.38;
  return { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy };
}

/** Re-proportion a layout authored for one aspect onto another. */
export async function adaptLayout(layout: LayoutSpec, targetAspect: number): Promise<LayoutSpec> {
  const m = await mod();
  const designAspect = layout.designAspect || targetAspect;
  // Same aspect ⇒ nothing to do, and skipping the call avoids any rounding the
  // adapter might introduce on the common path.
  if (Math.abs(designAspect - targetAspect) < 1e-6) return layout;
  return m.adaptLayout(layout, targetAspect);
}

/**
 * Work out how to place a cutout in its slot.
 *
 * @throws HexaError `RENDER_FAILED` when the returned fit has no rect — a
 * subject we cannot place is not something to paper over.
 */
export async function fitSubject(input: FitSubjectInput): Promise<SubjectFit> {
  const m = await mod();
  const raw = m.fitSubject(input) as unknown;
  const bag = (raw ?? {}) as Record<string, unknown>;
  const rect = toRect(bag['rect'] ?? bag['dest'] ?? bag['destRect'] ?? raw);
  if (!rect) {
    throw new HexaError('RENDER_FAILED', `fitSubject returned no destination rect for slot "${input.slot.id}"`, {
      hint: 'The return shape of @hexa/layout fitSubject has drifted — fix packages/pipeline/src/adapters/layout.ts.',
      details: { slot: input.slot.id, got: raw === undefined ? 'undefined' : typeof raw },
    });
  }
  return {
    rect,
    scale: toNumber(bag['scale']) ?? 1,
    flipX: bag['flipX'] === true || bag['flip'] === true,
    crop: toRect(bag['crop'] ?? bag['srcRect'] ?? bag['source']),
    faceRect: toRect(bag['faceRect'] ?? bag['face']),
  };
}

/** Tight bounds of non-transparent pixels — used to sit a subject on the floor. */
export async function alphaContentBox(image: Buffer): Promise<PixelRect | undefined> {
  try {
    const m = await mod();
    return toRect(await m.alphaContentBox(image));
  } catch {
    return undefined;
  }
}

export async function bustCrop(input: {
  image: { width: number; height: number };
  faceBox: FaceBox;
  landmarks?: FitSubjectInput['landmarks'];
  padding?: number;
}): Promise<PixelRect | undefined> {
  try {
    const m = await mod();
    return toRect(m.bustCrop(input));
  } catch {
    return undefined;
  }
}

export async function safeZonesFor(aspect: AspectPreset): Promise<SafeZone[]> {
  const m = await mod();
  return m.safeZonesFor(aspect) ?? [];
}

export async function scoreComposition(layout: LayoutSpec, width: number, height: number): Promise<CompositionScore | undefined> {
  try {
    const m = await mod();
    return m.scoreComposition({ layout, width, height });
  } catch {
    return undefined;
  }
}

/** Nudge slots apart when a template's own geometry self-overlaps. */
export async function resolveOverlaps(slots: readonly Slot[]): Promise<Slot[]> {
  try {
    const m = await mod();
    return m.resolveOverlaps(slots) ?? [...slots];
  } catch {
    return [...slots];
  }
}

export async function checkSafeZones(rects: { id: string; rect: Rect }[], safeZones: readonly SafeZone[]): Promise<unknown> {
  const m = await mod();
  return m.checkSafeZones({ rects, safeZones });
}

export type { ResolvedLayout, ResolvedSlot, SubjectFit, FitSubjectInput };
