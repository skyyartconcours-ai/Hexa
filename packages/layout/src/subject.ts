/**
 * Subject fitting — the heart of the package.
 *
 * A cut-out player photo is an arbitrary rectangle of pixels. A slot is a
 * designed hole in a composition. `fitSubject` decides which part of the photo
 * is sampled (`srcCrop`), where it is painted (`destRect`) and at what `scale`,
 * with one non-negotiable priority: THE FACE LANDS WHERE THE DESIGN WANTS IT.
 *
 * Coordinate contract
 * -------------------
 *  • `srcCrop` is in ORIGINAL image pixels, integer, always inside the image —
 *    it can be handed straight to `sharp.extract()`.
 *  • `destRect` is in canvas pixels (same space as `slotRect`), integer.
 *  • When `flipX` is true the renderer must mirror the sampled crop
 *    horizontally while drawing it into `destRect`. All anchoring maths is done
 *    in mirrored space and `srcCrop` is converted back at the end, so
 *    `faceCenterInDest` is correct AFTER the flip.
 *  • `faceCenterInDest` is in canvas pixels, computed from the final ROUNDED
 *    rects, so it is what will actually be painted — never the pre-rounding
 *    ideal. Downstream QA can trust it.
 */

import type { FaceBox, FaceLandmarks, FitMode, PixelRect, Slot, Vec2 } from '@hexa/core';
import { HexaError, anchorOffset, clamp, fitScale } from '@hexa/core';

/** Where a face lands inside its slot when the template does not say. */
export const DEFAULT_FOCAL: Readonly<Vec2> = Object.freeze({ x: 0.5, y: 0.38 });

/**
 * Face height as a fraction of SLOT height for 'face-anchor'.
 * 0.24 puts a face at ~12% of canvas height in a half-height slot and ~24% in a
 * full-height hero slot — both comfortably above the ~9% legibility floor the
 * composition scorer enforces. Override per slot with `meta.faceHeightRatio`.
 */
export const DEFAULT_FACE_HEIGHT_RATIO = 0.24;

/**
 * The crown (top of the skull) sits ~0.55 × faceBox height above the top of a
 * detector face box, because detectors box brow-to-chin and ignore hair volume.
 * This constant is what stops Hexa from slicing the top off every head.
 */
export const CROWN_ABOVE_FACE = 0.55;

/** Extra breathing room kept above the crown when capping the zoom. */
const CROWN_SAFETY = 0.06;

/** Default bust headroom above the crown, in face heights. */
export const DEFAULT_BUST_HEADROOM = 0.28;
/** Default distance below the chin for a bust crop, in face heights. */
export const DEFAULT_SHOULDER_RATIO = 2.1;
/** Fallback eye line position inside the face box (fraction of its height). */
const EYE_LINE_IN_FACE = 0.42;
/** Preferred bust crop aspect (w / h) before shoulder-width correction. */
const BUST_ASPECT = 0.75;
/** A bust must be at least this many face-widths wide to hold the shoulders. */
const BUST_MIN_FACE_WIDTHS = 2.2;
/** How much extra headroom the eye-line rule may add, in face heights. */
const EYE_RULE_EXTRA_HEADROOM = 0.45;

export interface SubjectFit {
  srcCrop: PixelRect;
  destRect: PixelRect;
  /** Effective uniform scale actually applied: destRect.w / srcCrop.w. */
  scale: number;
  flipX: boolean;
  /** Canvas-pixel position of the face centre after this fit is painted. */
  faceCenterInDest: Vec2;
}

export interface FitSubjectInput {
  image: { width: number; height: number };
  faceBox?: FaceBox;
  landmarks?: FaceLandmarks;
  slot: Slot;
  slotRect: PixelRect;
  mode: FitMode;
  focal?: Vec2;
  /** Alpha bounding box of the cutout, if known — lets 'full'/'bust' ignore transparent margins. */
  contentBox?: PixelRect;
}

/* ------------------------------------------------------------------------- */
/* alpha analysis                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Tight bounding box of everything more opaque than `threshold` in a single
 * channel alpha buffer (row-major, 1 byte per pixel).
 *
 * Cut-outs routinely carry 20–30% transparent margin; without this, a 'full'
 * fit scales the empty space instead of the player.
 *
 * @returns null when the buffer is fully transparent.
 */
export function alphaContentBox(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold = 8,
): PixelRect | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new HexaError('INVALID_REQUEST', `alphaContentBox needs positive integer dimensions, got ${width}×${height}`);
  }
  if (alpha.length < width * height) {
    throw new HexaError(
      'INVALID_REQUEST',
      `alphaContentBox: buffer holds ${alpha.length} bytes, expected at least ${width * height}`,
      { hint: 'Pass a single-channel alpha buffer, not interleaved RGBA.' },
    );
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let rowMinX = -1;
    let rowMaxX = -1;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x]! >= threshold) {
        if (rowMinX < 0) rowMinX = x;
        rowMaxX = x;
      }
    }
    if (rowMaxX >= 0) {
      if (y < minY) minY = y;
      maxY = y;
      if (rowMinX < minX) minX = rowMinX;
      if (rowMaxX > maxX) maxX = rowMaxX;
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* ------------------------------------------------------------------------- */
/* face geometry                                                              */
/* ------------------------------------------------------------------------- */

/** Which way the head is turned, from the nose's offset within the eye span. */
export function facingFromLandmarks(landmarks?: FaceLandmarks): 'left' | 'right' | 'front' | undefined {
  if (!landmarks) return undefined;
  const mid = (landmarks.leftEye[0] + landmarks.rightEye[0]) / 2;
  const span = Math.abs(landmarks.rightEye[0] - landmarks.leftEye[0]);
  if (span < 1e-6) return 'front';
  const offset = (landmarks.nose[0] - mid) / span;
  if (offset > 0.15) return 'right';
  if (offset < -0.15) return 'left';
  return 'front';
}

/** Estimated y of the top of the skull for a detector face box. */
export function crownY(faceBox: FaceBox): number {
  return faceBox.y - CROWN_ABOVE_FACE * faceBox.h;
}

/** Eye line y — measured from landmarks when available, else estimated. */
export function eyeLineY(faceBox: FaceBox, landmarks?: FaceLandmarks): number {
  if (landmarks) return (landmarks.leftEye[1] + landmarks.rightEye[1]) / 2;
  return faceBox.y + EYE_LINE_IN_FACE * faceBox.h;
}

function usableFace(face?: FaceBox): FaceBox | undefined {
  if (!face) return undefined;
  if (!Number.isFinite(face.w) || !Number.isFinite(face.h) || face.w <= 0 || face.h <= 0) return undefined;
  return face;
}

/* ------------------------------------------------------------------------- */
/* bust crop                                                                  */
/* ------------------------------------------------------------------------- */

export interface BustCropOptions {
  /** Space above the crown, in face heights. */
  headroom?: number;
  /** Space below the chin, in face heights. */
  shoulderRatio?: number;
}

/**
 * Head-and-shoulders crop built from real head proportions.
 *
 *   crown  = faceBox.y − 0.55·faceH          (detectors ignore hair volume)
 *   top    = crown − headroom·faceH          (default headroom 0.28)
 *   bottom = chin + shoulderRatio·faceH      (default 2.1 → mid-chest)
 *
 * The top edge is then allowed to rise (never fall) so the eye line sits on the
 * crop's upper third — the single most reliable portrait framing rule. It may
 * add at most 0.45·faceH of extra headroom, so a low eye line cannot turn the
 * crop into a shot of the ceiling.
 *
 * Width targets a 3:4 portrait but never falls below 2.2 face widths, which is
 * about where a pair of shoulders stops being clipped.
 *
 * The result is intersected with the image, so it is always sampleable.
 */
export function bustCrop(
  image: { width: number; height: number },
  faceBox: FaceBox,
  landmarks?: FaceLandmarks,
  opts: BustCropOptions = {},
): PixelRect {
  const face = usableFace(faceBox);
  if (!face) {
    throw new HexaError('INVALID_REQUEST', 'bustCrop needs a face box with positive width and height');
  }
  const headroom = opts.headroom ?? DEFAULT_BUST_HEADROOM;
  const shoulderRatio = opts.shoulderRatio ?? DEFAULT_SHOULDER_RATIO;

  const fh = face.h;
  const crown = crownY(face);
  const chin = face.y + fh;
  const bottom = chin + shoulderRatio * fh;
  const proportionalTop = crown - headroom * fh;

  // Put the eye line on the upper third: (eye − top) / (bottom − top) = 1/3.
  const eye = eyeLineY(face, landmarks);
  const eyeThirdTop = (3 * eye - bottom) / 2;
  const top = clamp(eyeThirdTop, proportionalTop - EYE_RULE_EXTRA_HEADROOM * fh, proportionalTop);

  const h = bottom - top;
  const w = Math.max(h * BUST_ASPECT, face.w * BUST_MIN_FACE_WIDTHS);

  // Centre on the eye midpoint when we have one — a turned head reads better
  // centred on the eyes than on the box.
  const faceCx = face.x + face.w / 2;
  const cx = landmarks ? (landmarks.leftEye[0] + landmarks.rightEye[0]) / 2 * 0.5 + faceCx * 0.5 : faceCx;

  return intersectImage({ x: cx - w / 2, y: top, w, h }, image.width, image.height, 'bustCrop');
}

/* ------------------------------------------------------------------------- */
/* fitSubject                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Fit a subject image into a slot.
 *
 * Modes:
 *  • 'face-anchor' — scale so the face is `meta.faceHeightRatio` (default 0.24)
 *    of the SLOT height, then translate so the face centre lands exactly on
 *    `focal`. The zoom is capped so the crown never leaves the crop, and when
 *    the source runs out the crop letterboxes rather than sliding the face off
 *    its mark.
 *  • 'bust' — `bustCrop` sets the framing tightness (cover-fitted to the slot),
 *    then the same face anchoring runs. A slot wider than the bust shows more
 *    shoulder instead of letterboxing.
 *  • 'full' — content height fits the slot, feet on the slot bottom, width free.
 *  • 'cover' — fill the slot, crop the overflow, biased so the face sits as
 *    close to `focal` as the image allows (cover never letterboxes, so the face
 *    can end up off its mark; check `faceCenterInDest`).
 *  • 'contain' — whole image inside the slot, positioned by `slot.anchor`.
 */
export function fitSubject(input: FitSubjectInput): SubjectFit {
  const { image, slot, slotRect, mode } = input;
  if (!(image.width > 0) || !(image.height > 0)) {
    throw new HexaError('INVALID_REQUEST', `fitSubject: bad image size ${image.width}×${image.height}`);
  }
  if (!(slotRect.w > 0) || !(slotRect.h > 0)) {
    throw new HexaError('INVALID_REQUEST', `fitSubject: bad slot rect for "${slot.id}"`);
  }

  const flipX = decideFlip(slot, input.landmarks);
  const iw = image.width;

  // Everything below runs in DISPLAY space (post-mirror).
  const face0 = usableFace(input.faceBox);
  const face = face0 && flipX ? mirrorRect(face0, iw) : face0;
  const landmarks = input.landmarks && flipX ? mirrorLandmarks(input.landmarks, iw) : input.landmarks;
  const content = input.contentBox && flipX ? mirrorRect(input.contentBox, iw) : input.contentBox;

  const focal = normaliseFocal(input.focal ?? slot.focal ?? DEFAULT_FOCAL);

  let fit: SubjectFit;
  switch (mode) {
    case 'face-anchor': {
      if (!face) {
        fit = coverFit(input, undefined, focal);
        break;
      }
      const ratio = readRatio(slot.meta?.['faceHeightRatio']) ?? DEFAULT_FACE_HEIGHT_RATIO;
      const wanted = (ratio * slotRect.h) / face.h;
      fit = anchoredFit(input, face, focal, wanted);
      break;
    }
    case 'bust': {
      if (!face) {
        fit = coverFit(input, undefined, focal);
        break;
      }
      const crop = bustCrop(image, face, landmarks, {
        headroom: readRatio(slot.meta?.['bustHeadroom']) ?? undefined,
        shoulderRatio: readRatio(slot.meta?.['shoulderRatio']) ?? undefined,
      });
      const wanted = fitScale(crop.w, crop.h, slotRect.w, slotRect.h, 'cover');
      fit = anchoredFit(input, face, focal, wanted);
      break;
    }
    case 'full':
      fit = fullFit(input, face, content, focal);
      break;
    case 'contain':
      fit = containFit(input, face, focal);
      break;
    case 'cover':
    default:
      fit = coverFit(input, face, focal);
      break;
  }

  // Convert the crop back into original (unmirrored) image coordinates.
  const srcCrop = flipX ? mirrorRect(fit.srcCrop, iw) : fit.srcCrop;
  return { ...fit, srcCrop, flipX };
}

/**
 * Scale-then-translate fit that treats the face anchor as the invariant.
 *
 * `wantedScale` is capped so `crop.top <= crown`, i.e. the zoom gives way
 * before the skull does. Where the ideal window leaves the image the crop is
 * intersected (never slid), so the face keeps its exact focal position and the
 * shortfall shows up as a `destRect` smaller than the slot — a letterbox the
 * compositor can fill with backplate.
 */
function anchoredFit(input: FitSubjectInput, face: FaceBox, focal: Vec2, wantedScale: number): SubjectFit {
  const { image, slotRect } = input;
  const faceCx = face.x + face.w / 2;
  const faceCy = face.y + face.h / 2;

  let scale = wantedScale;
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  // Cap the zoom so the crown survives: crop.top = faceCy − focal.y·cropH ≤ crown.
  const needAbove = faceCy - (crownY(face) - CROWN_SAFETY * face.h);
  if (focal.y > 1e-4 && needAbove > 0) {
    scale = Math.min(scale, (slotRect.h * focal.y) / needAbove);
  }
  // Same idea downwards: never zoom so far that the chin leaves the frame.
  const needBelow = face.y + face.h - faceCy;
  if (focal.y < 1 - 1e-4 && needBelow > 0) {
    scale = Math.min(scale, (slotRect.h * (1 - focal.y)) / needBelow);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const cropW = slotRect.w / scale;
  const cropH = slotRect.h / scale;
  const idealX = faceCx - focal.x * cropW;
  const idealY = faceCy - focal.y * cropH;

  const srcCrop = intersectImage(
    { x: idealX, y: idealY, w: cropW, h: cropH },
    image.width,
    image.height,
    'fitSubject',
  );

  return paintAnchored(srcCrop, scale, slotRect, focal, { x: faceCx, y: faceCy });
}

/** Round the destination so the face lands on the focal point to within ½px. */
function paintAnchored(
  srcCrop: PixelRect,
  scale: number,
  slotRect: PixelRect,
  focal: Vec2,
  faceCentre: Vec2,
): SubjectFit {
  const destW = Math.max(1, Math.round(srcCrop.w * scale));
  const finalScale = destW / srcCrop.w;
  const destH = Math.max(1, Math.round(srcCrop.h * finalScale));

  const faceOffX = (faceCentre.x - srcCrop.x) * finalScale;
  const faceOffY = (faceCentre.y - srcCrop.y) * finalScale;
  const targetX = slotRect.x + focal.x * slotRect.w;
  const targetY = slotRect.y + focal.y * slotRect.h;
  const destX = Math.round(targetX - faceOffX);
  const destY = Math.round(targetY - faceOffY);

  return {
    srcCrop,
    destRect: { x: destX, y: destY, w: destW, h: destH },
    scale: finalScale,
    flipX: false,
    faceCenterInDest: { x: destX + faceOffX, y: destY + faceOffY },
  };
}

/** Fill the slot; crop the overflow. Biased toward the face when we have one. */
function coverFit(input: FitSubjectInput, face: FaceBox | undefined, focal: Vec2): SubjectFit {
  const { image, slotRect } = input;
  const scale = fitScale(image.width, image.height, slotRect.w, slotRect.h, 'cover');
  const cropW = Math.min(image.width, slotRect.w / scale);
  const cropH = Math.min(image.height, slotRect.h / scale);

  const faceCx = face ? face.x + face.w / 2 : image.width / 2;
  const faceCy = face ? face.y + face.h / 2 : image.height / 2;
  const wantX = face ? faceCx - focal.x * cropW : (image.width - cropW) / 2;
  const wantY = face ? faceCy - focal.y * cropH : (image.height - cropH) / 2;

  // Cover must fill the slot, so the window slides inside the image instead of
  // letterboxing — the face may end up off its focal mark.
  const x = clamp(Math.round(wantX), 0, Math.max(0, image.width - Math.round(cropW)));
  const y = clamp(Math.round(wantY), 0, Math.max(0, image.height - Math.round(cropH)));
  const srcCrop: PixelRect = {
    x,
    y,
    w: Math.max(1, Math.min(Math.round(cropW), image.width - x)),
    h: Math.max(1, Math.min(Math.round(cropH), image.height - y)),
  };
  const finalScale = slotRect.w / srcCrop.w;
  const destRect: PixelRect = { ...slotRect };
  const faceCenterInDest = face
    ? {
        x: destRect.x + (faceCx - srcCrop.x) * finalScale,
        y: destRect.y + (faceCy - srcCrop.y) * (destRect.h / srcCrop.h),
      }
    : { x: destRect.x + focal.x * destRect.w, y: destRect.y + focal.y * destRect.h };
  return { srcCrop, destRect, scale: finalScale, flipX: false, faceCenterInDest };
}

/** Whole image inside the slot, positioned by the slot's anchor. */
function containFit(input: FitSubjectInput, face: FaceBox | undefined, focal: Vec2): SubjectFit {
  const { image, slot, slotRect } = input;
  const scale = fitScale(image.width, image.height, slotRect.w, slotRect.h, 'contain');
  const destW = Math.max(1, Math.round(image.width * scale));
  const destH = Math.max(1, Math.round(image.height * scale));
  const off = anchorOffset(slot.anchor, slotRect.w, slotRect.h, destW, destH);
  const destRect: PixelRect = {
    x: slotRect.x + Math.round(off.x),
    y: slotRect.y + Math.round(off.y),
    w: destW,
    h: destH,
  };
  const srcCrop: PixelRect = { x: 0, y: 0, w: image.width, h: image.height };
  const finalScale = destW / image.width;
  const faceCenterInDest = face
    ? {
        x: destRect.x + (face.x + face.w / 2) * finalScale,
        y: destRect.y + (face.y + face.h / 2) * (destH / image.height),
      }
    : { x: destRect.x + focal.x * destRect.w, y: destRect.y + focal.y * destRect.h };
  return { srcCrop, destRect, scale: finalScale, flipX: false, faceCenterInDest };
}

/**
 * Full-height subject: the content box (alpha bounds when known) fills the slot
 * height and the feet sit on the slot's bottom edge. Width is free — a standing
 * player is allowed to be narrower, or to bleed wider, than the slot.
 */
function fullFit(
  input: FitSubjectInput,
  face: FaceBox | undefined,
  content: PixelRect | undefined,
  focal: Vec2,
): SubjectFit {
  const { image, slotRect } = input;
  const box = content ?? { x: 0, y: 0, w: image.width, h: image.height };
  const srcCrop = intersectImage(box, image.width, image.height, 'fitSubject');

  const scale = slotRect.h / srcCrop.h;
  const destH = Math.max(1, Math.round(srcCrop.h * scale));
  const destW = Math.max(1, Math.round(srcCrop.w * scale));
  const finalScale = destW / srcCrop.w;
  const destRect: PixelRect = {
    x: Math.round(slotRect.x + focal.x * slotRect.w - destW / 2),
    y: slotRect.y + slotRect.h - destH,
    w: destW,
    h: destH,
  };
  const faceCenterInDest = face
    ? {
        x: destRect.x + (face.x + face.w / 2 - srcCrop.x) * finalScale,
        y: destRect.y + (face.y + face.h / 2 - srcCrop.y) * (destH / srcCrop.h),
      }
    : // No face box: assume the head occupies the top ~8% of a standing body.
      { x: destRect.x + destRect.w / 2, y: destRect.y + destRect.h * 0.08 };
  return { srcCrop, destRect, scale: finalScale, flipX: false, faceCenterInDest };
}

/* ------------------------------------------------------------------------- */
/* helpers                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Explicit `slot.flipX` always wins. Otherwise, when the slot opts in with
 * `meta.faceInward`, a subject whose head is turned away from the canvas centre
 * is mirrored so both halves of a versus look at each other.
 */
function decideFlip(slot: Slot, landmarks?: FaceLandmarks): boolean {
  if (typeof slot.flipX === 'boolean') return slot.flipX;
  if (slot.meta?.['faceInward'] !== true) return false;
  const facing = facingFromLandmarks(landmarks);
  if (!facing || facing === 'front') return false;
  const cx = slot.rect.x + slot.rect.w / 2;
  if (Math.abs(cx - 0.5) < 0.02) return false;
  const wanted = cx < 0.5 ? 'right' : 'left';
  return facing !== wanted;
}

function mirrorRect<T extends PixelRect>(r: T, imageWidth: number): T {
  return { ...r, x: imageWidth - (r.x + r.w) };
}

function mirrorLandmarks(l: FaceLandmarks, imageWidth: number): FaceLandmarks {
  const mx = (p: [number, number]): [number, number] => [imageWidth - p[0], p[1]];
  // Mirroring swaps which physical eye is on the left of the frame.
  return {
    leftEye: mx(l.rightEye),
    rightEye: mx(l.leftEye),
    nose: mx(l.nose),
    mouthLeft: mx(l.mouthRight),
    mouthRight: mx(l.mouthLeft),
  };
}

function normaliseFocal(f: Vec2): Vec2 {
  return { x: clamp(f.x, 0, 1), y: clamp(f.y, 0, 1) };
}

function readRatio(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Integer crop clipped to the image. Throws when nothing is left to sample. */
function intersectImage(r: { x: number; y: number; w: number; h: number }, iw: number, ih: number, who: string): PixelRect {
  const x0 = clamp(Math.round(r.x), 0, iw);
  const y0 = clamp(Math.round(r.y), 0, ih);
  const x1 = clamp(Math.round(r.x + r.w), 0, iw);
  const y1 = clamp(Math.round(r.y + r.h), 0, ih);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) {
    throw new HexaError('INVALID_REQUEST', `${who}: crop falls entirely outside the ${iw}×${ih} image`, {
      hint: 'Check the face box / content box are in this image’s pixel space.',
    });
  }
  return { x: x0, y: y0, w, h };
}
