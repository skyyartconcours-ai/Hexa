/**
 * @hexa/layout adapter — normalised geometry → device pixels.
 *
 * `fitSubject` is the one call in the whole pipeline that decides whether a
 * composite looks professional: it works out the crop, scale and mirror that put
 * the subject's *face* on the slot's focal point. Everything downstream (rim
 * light angle, text placement, the region QA crops for identity) is measured
 * against what it returns, so its result is translated carefully here.
 *
 * Three translations:
 *  - the sibling returns `{srcCrop, destRect, faceCenterInDest}`; the pipeline
 *    works in `{crop, rect, faceRect}`, and the face *rect* is reconstructed
 *    from the centre plus the scaled face box;
 *  - `alphaContentBox` wants a raw alpha plane, so the encoded cutout is
 *    decoded here rather than in every call site;
 *  - the subject-scale variant axis has no parameter on `fitSubject`, so it is
 *    applied through `slot.scale`, which the resolver already honours about the
 *    slot's anchor — a scaled `bottom-center` slot keeps its feet on the line.
 */

import type { AspectPreset, FaceBox, FaceLandmarks, FitMode, LayoutSpec, PixelRect, SafeZone, Slot } from '@hexa/core';
import { HexaError } from '@hexa/core';
import sharp from 'sharp';
import { loadModule } from './load.js';
import { LAYOUT_EXPORTS, type LayoutModule, type ResolvedSlot } from './contracts.js';

const SPEC = '@hexa/layout';
const HINT = 'The layout package is not built. Run: pnpm --filter @hexa/layout build';

async function mod(): Promise<LayoutModule> {
  return loadModule<LayoutModule>(SPEC, { needs: LAYOUT_EXPORTS, hint: HINT });
}

/** What the compiler needs back from layout resolution. */
export interface PixelLayout {
  slots: ResolvedSlot[];
  safeZones: SafeZone[];
  width: number;
  height: number;
}

/**
 * Resolve every slot to pixels.
 *
 * Slots come back in paint order. The sibling already sorts by z, but the
 * compiler's layering depends on it, so it is re-established here rather than
 * assumed — a silent layering bug is expensive to find.
 */
export async function resolveLayoutPixels(layout: LayoutSpec, width: number, height: number): Promise<PixelLayout> {
  const m = await mod();
  const resolved = m.resolveLayout(layout, width, height);

  if (!resolved?.slots || (resolved.slots.length === 0 && layout.slots.length > 0)) {
    throw new HexaError('RENDER_FAILED', `resolveLayout("${layout.id}") produced no usable slots`, {
      hint: 'The return shape of @hexa/layout resolveLayout has drifted — fix packages/pipeline/src/adapters/layout.ts.',
      details: { layout: layout.id, width, height, slots: layout.slots.length },
    });
  }

  return {
    slots: [...resolved.slots].sort((a, b) => (a.z ?? a.slot.z ?? 0) - (b.z ?? b.slot.z ?? 0)),
    safeZones: (resolved.safeZones ?? []).map((s) => s.zone),
    width: resolved.canvas?.width ?? width,
    height: resolved.canvas?.height ?? height,
  };
}

/** Re-proportion a layout authored for one aspect onto another. */
export async function adaptLayout(layout: LayoutSpec, targetAspect: number): Promise<LayoutSpec> {
  const designAspect = layout.designAspect || targetAspect;
  // Same aspect ⇒ nothing to do, and skipping avoids any rounding the adapter
  // might introduce on the common path.
  if (Math.abs(designAspect - targetAspect) < 1e-6) return layout;
  return (await mod()).adaptLayout(layout, targetAspect);
}

export interface SubjectFitResult {
  /** Destination rect in canvas pixels. */
  rect: PixelRect;
  /** Crop applied to the source image before placement. */
  crop: PixelRect;
  scale: number;
  flipX: boolean;
  /** Where the face landed on the canvas, when a face was detected. */
  faceRect?: PixelRect;
  faceCenter?: { x: number; y: number };
}

export interface FitInput {
  slot: Slot;
  slotRect: PixelRect;
  image: { width: number; height: number };
  faceBox?: FaceBox;
  landmarks?: FaceLandmarks;
  contentBox?: PixelRect;
  mode?: FitMode;
  /** Multiplier on the subject's size — the variant tightness axis. */
  scaleBias?: number;
}

/**
 * Work out how to place a cutout in its slot.
 *
 * @throws HexaError `RENDER_FAILED` when no destination rect comes back — a
 * subject we cannot place is not something to paper over.
 */
export async function fitSubject(input: FitInput): Promise<SubjectFitResult> {
  const m = await mod();

  // The variant's scale bias rides on `slot.scale`, which the resolver applies
  // about the slot's anchor. Passing a pre-scaled slot keeps all the anchoring
  // maths in one place instead of re-deriving it here.
  const slot: Slot = input.scaleBias && input.scaleBias !== 1
    ? { ...input.slot, scale: (input.slot.scale ?? 1) * input.scaleBias }
    : input.slot;

  const fit = m.fitSubject({
    image: input.image,
    faceBox: input.faceBox,
    landmarks: input.landmarks,
    slot,
    slotRect: input.slotRect,
    mode: input.mode ?? input.slot.fit ?? 'face-anchor',
    focal: input.slot.focal,
    contentBox: input.contentBox,
  });

  if (!fit?.destRect) {
    throw new HexaError('RENDER_FAILED', `fitSubject returned no destination rect for slot "${input.slot.id}"`, {
      hint: 'The return shape of @hexa/layout fitSubject has drifted — fix packages/pipeline/src/adapters/layout.ts.',
      details: { slot: input.slot.id },
    });
  }

  return {
    rect: fit.destRect,
    crop: fit.srcCrop,
    scale: fit.scale ?? 1,
    flipX: fit.flipX === true,
    faceCenter: fit.faceCenterInDest,
    faceRect: faceRectFrom(fit.faceCenterInDest, input.faceBox, fit.scale ?? 1),
  };
}

/**
 * The face's rect on the canvas, from the centre the fitter reports plus the
 * face box scaled by the same factor. QA crops this region out of the finished
 * render to verify identity, so it has to be the box, not just the point.
 */
function faceRectFrom(
  center: { x: number; y: number } | undefined,
  faceBox: FaceBox | undefined,
  scale: number,
): PixelRect | undefined {
  if (!center || !faceBox) return undefined;
  const w = faceBox.w * scale;
  const h = faceBox.h * scale;
  return { x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w: Math.round(w), h: Math.round(h) };
}

/**
 * Tight bounds of the non-transparent pixels in an encoded cutout.
 *
 * The sibling works on a raw alpha plane; decoding it is this adapter's job so
 * the stage code can stay in "here are the bytes" terms.
 */
export async function alphaContentBox(image: Buffer): Promise<PixelRect | undefined> {
  try {
    const m = await mod();
    const { data, info } = await sharp(image).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    return m.alphaContentBox(data, info.width, info.height) ?? undefined;
  } catch {
    // A cutout we cannot read the alpha of just means no grounding hint.
    return undefined;
  }
}

export async function bustCrop(
  image: { width: number; height: number },
  faceBox: FaceBox,
  landmarks?: FaceLandmarks,
  opts?: { headroom?: number; shoulderRatio?: number },
): Promise<PixelRect | undefined> {
  try {
    return (await mod()).bustCrop(image, faceBox, landmarks, opts);
  } catch {
    return undefined;
  }
}

/** Which way a face is looking, from the eye/nose geometry. */
export async function facingFromLandmarks(landmarks?: FaceLandmarks): Promise<'left' | 'right' | 'front' | undefined> {
  try {
    return (await mod()).facingFromLandmarks(landmarks);
  } catch {
    return undefined;
  }
}

export async function safeZonesFor(aspect: AspectPreset | number): Promise<SafeZone[]> {
  try {
    return (await mod()).safeZonesFor(aspect) ?? [];
  } catch {
    return [];
  }
}

export type { ResolvedSlot };
