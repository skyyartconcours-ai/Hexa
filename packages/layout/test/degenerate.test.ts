/**
 * Degenerate-input gate for `fitSubject`.
 *
 * `srcCrop` is handed straight to `sharp.extract()`. A NaN or a negative width
 * arriving there does not fail politely — it fails inside libvips, with a
 * message that names neither the asset, the slot nor the template, several
 * stages away from whatever produced the bad number. So the contract is
 * absolute and is asserted here exhaustively rather than by example:
 *
 *   for EVERY input, `fitSubject` either throws a HexaError, or returns a fit
 *   whose srcCrop is an integer rect strictly inside the image, whose destRect
 *   is a positive integer rect, and whose scale and faceCenterInDest are finite.
 *
 * The inputs below are not hypothetical. A detector returning a box that
 * overhangs the frame, a landmark set from a mirrored photo, a zero-area face
 * on a failed detection, a content box measured against a different resolution
 * of the same asset — these are all things upstream code does today.
 */

import { describe, expect, it } from 'vitest';
import type { FaceBox, FaceLandmarks, FitMode, PixelRect, Slot, Vec2 } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { bustCrop, fitSubject, type FitSubjectInput } from '../src/index.js';

const MODES: FitMode[] = ['face-anchor', 'bust', 'full', 'cover', 'contain'];

function subjectSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'subject',
    kind: 'subject',
    rect: { x: 0.02, y: 0.1, w: 0.46, h: 0.9 },
    anchor: 'bottom-left',
    z: 10,
    ...overrides,
  };
}

const IMAGE = { width: 1000, height: 1400 };
const SLOT_RECT: PixelRect = { x: 100, y: 50, w: 500, h: 800 };
const GOOD_FACE: FaceBox = { x: 400, y: 200, w: 200, h: 260, confidence: 0.9 };

/**
 * The whole contract in one assertion. Returns the fit when one was produced,
 * so callers can make extra claims about it.
 */
function expectSaneOrHexaError(input: FitSubjectInput, what: string) {
  let fit;
  try {
    fit = fitSubject(input);
  } catch (err) {
    expect(err, `${what}: threw a non-HexaError, which the CLI cannot map to an exit code`).toBeInstanceOf(HexaError);
    return undefined;
  }

  const { srcCrop: s, destRect: d, scale, faceCenterInDest: c } = fit;
  const iw = Math.floor(input.image.width);
  const ih = Math.floor(input.image.height);

  for (const [k, v] of Object.entries(s)) {
    expect(Number.isInteger(v), `${what}: srcCrop.${k} = ${v} is not an integer (sharp.extract needs integers)`).toBe(true);
  }
  expect(s.w >= 1 && s.h >= 1, `${what}: srcCrop is ${s.w}×${s.h}; sharp.extract throws on a non-positive area`).toBe(true);
  expect(
    s.x >= 0 && s.y >= 0 && s.x + s.w <= iw && s.y + s.h <= ih,
    `${what}: srcCrop ${JSON.stringify(s)} leaves the ${iw}×${ih} image`,
  ).toBe(true);

  for (const [k, v] of Object.entries(d)) {
    expect(Number.isInteger(v), `${what}: destRect.${k} = ${v} is not a finite integer`).toBe(true);
  }
  expect(d.w >= 1 && d.h >= 1, `${what}: destRect is ${d.w}×${d.h}`).toBe(true);
  expect(Number.isFinite(scale) && scale > 0, `${what}: scale = ${scale}`).toBe(true);
  expect(Number.isFinite(c.x) && Number.isFinite(c.y), `${what}: faceCenterInDest = ${JSON.stringify(c)}`).toBe(true);
  return fit;
}

describe('fitSubject — degenerate face boxes', () => {
  const cases: [string, FaceBox][] = [
    ['larger than the image on every side', { x: -500, y: -500, w: 4000, h: 4000, confidence: 0.5 }],
    ['overhanging the left edge', { x: -150, y: 100, w: 200, h: 260, confidence: 0.5 }],
    ['overhanging the top edge', { x: 400, y: -300, w: 200, h: 260, confidence: 0.5 }],
    ['overhanging the bottom-right', { x: 900, y: 1300, w: 400, h: 500, confidence: 0.5 }],
    ['wholly outside, positive', { x: 5000, y: 5000, w: 200, h: 260, confidence: 0.5 }],
    ['wholly outside, negative', { x: -5000, y: -5000, w: 200, h: 260, confidence: 0.5 }],
    ['zero width', { x: 400, y: 200, w: 0, h: 260, confidence: 0.5 }],
    ['zero height', { x: 400, y: 200, w: 200, h: 0, confidence: 0.5 }],
    ['negative width', { x: 400, y: 200, w: -200, h: 260, confidence: 0.5 }],
    ['sub-pixel', { x: 400, y: 200, w: 0.001, h: 0.001, confidence: 0.5 }],
    ['NaN x', { x: Number.NaN, y: 200, w: 200, h: 260, confidence: 0.5 }],
    ['NaN width', { x: 400, y: 200, w: Number.NaN, h: 260, confidence: 0.5 }],
    ['Infinite height', { x: 400, y: 200, w: 200, h: Number.POSITIVE_INFINITY, confidence: 0.5 }],
    ['Infinite y', { x: 400, y: Number.POSITIVE_INFINITY, w: 200, h: 260, confidence: 0.5 }],
    ['-Infinity x', { x: Number.NEGATIVE_INFINITY, y: 200, w: 200, h: 260, confidence: 0.5 }],
  ];

  for (const [label, faceBox] of cases) {
    for (const mode of MODES) {
      it(`survives a face box ${label} (${mode})`, () => {
        expectSaneOrHexaError({ image: IMAGE, faceBox, slot: subjectSlot(), slotRect: SLOT_RECT, mode }, `${label}/${mode}`);
      });
    }
  }

  it('degrades a non-finite face box to a face-less fit rather than throwing', () => {
    // A detector that emits NaN is a bug upstream, but the render must still
    // complete — the same way it does when no detector ran at all.
    const withNaN = fitSubject({
      image: IMAGE,
      faceBox: { x: Number.NaN, y: 200, w: 200, h: 260, confidence: 0.5 },
      slot: subjectSlot(),
      slotRect: SLOT_RECT,
      mode: 'face-anchor',
    });
    const withNone = fitSubject({ image: IMAGE, slot: subjectSlot(), slotRect: SLOT_RECT, mode: 'face-anchor' });
    expect(withNaN).toEqual(withNone);
  });
});

describe('fitSubject — degenerate image and slot geometry', () => {
  const images: [string, { width: number; height: number }][] = [
    ['10000×1 panorama', { width: 10000, height: 1 }],
    ['1×10000 column', { width: 1, height: 10000 }],
    ['1×1', { width: 1, height: 1 }],
    ['fractional dimensions', { width: 100.7, height: 200.3 }],
  ];
  for (const [label, image] of images) {
    for (const mode of MODES) {
      it(`survives a ${label} image (${mode})`, () => {
        expectSaneOrHexaError({ image, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: SLOT_RECT, mode }, `${label}/${mode}`);
        expectSaneOrHexaError({ image, slot: subjectSlot(), slotRect: SLOT_RECT, mode }, `${label}/${mode}/faceless`);
      });
    }
  }

  it('rejects impossible image sizes with a clear HexaError', () => {
    for (const image of [
      { width: 0, height: 100 },
      { width: 100, height: 0 },
      { width: -100, height: 100 },
      { width: Number.NaN, height: 100 },
      { width: 100, height: Number.POSITIVE_INFINITY },
      { width: 0.4, height: 100 },
    ]) {
      expect(() => fitSubject({ image, slot: subjectSlot(), slotRect: SLOT_RECT, mode: 'cover' })).toThrow(HexaError);
    }
  });

  it('rejects impossible slot rects with a clear HexaError', () => {
    for (const slotRect of [
      { x: 10, y: 10, w: 0, h: 100 },
      { x: 10, y: 10, w: 100, h: 0 },
      { x: 10, y: 10, w: -100, h: -100 },
      { x: Number.NaN, y: 10, w: 100, h: 100 },
      { x: 10, y: Number.POSITIVE_INFINITY, w: 100, h: 100 },
      { x: 10, y: 10, w: Number.NaN, h: 100 },
    ]) {
      for (const mode of MODES) {
        expect(() => fitSubject({ image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect, mode }), `${JSON.stringify(slotRect)}/${mode}`).toThrow(HexaError);
      }
    }
  });

  it('accepts a slot rect far larger than the canvas', () => {
    for (const mode of MODES) {
      expectSaneOrHexaError(
        { image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: { x: -500, y: -500, w: 100_000, h: 100_000 }, mode },
        `oversized slot/${mode}`,
      );
    }
  });

  it('accepts a 1×1 slot rect', () => {
    for (const mode of MODES) {
      expectSaneOrHexaError({ image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: { x: 0, y: 0, w: 1, h: 1 }, mode }, `1x1 slot/${mode}`);
    }
  });
});

describe('fitSubject — degenerate focal points', () => {
  const focals: [string, Vec2][] = [
    ['top-left corner', { x: 0, y: 0 }],
    ['bottom-right corner', { x: 1, y: 1 }],
    ['far negative', { x: -5, y: -5 }],
    ['far positive', { x: 9, y: 9 }],
    ['NaN', { x: Number.NaN, y: Number.NaN }],
    ['infinite', { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY }],
  ];
  for (const [label, focal] of focals) {
    for (const mode of MODES) {
      it(`survives a ${label} focal point (${mode})`, () => {
        expectSaneOrHexaError({ image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: SLOT_RECT, mode, focal }, `${label}/${mode}`);
      });
    }
  }

  it('clamps an out-of-range focal into the slot instead of painting off it', () => {
    const fit = fitSubject({
      image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: SLOT_RECT, mode: 'face-anchor',
      focal: { x: 9, y: -4 },
    });
    expect(fit.faceCenterInDest.x).toBeCloseTo(SLOT_RECT.x + SLOT_RECT.w, 0);
    expect(fit.faceCenterInDest.y).toBeCloseTo(SLOT_RECT.y, 0);
  });

  it('falls back to the default focal when one is non-finite, per axis', () => {
    const half = fitSubject({
      image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: SLOT_RECT, mode: 'face-anchor',
      focal: { x: 0.25, y: Number.NaN },
    });
    const explicit = fitSubject({
      image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: SLOT_RECT, mode: 'face-anchor',
      focal: { x: 0.25, y: 0.38 },
    });
    expect(half).toEqual(explicit);
  });
});

describe('fitSubject — inconsistent landmarks and content boxes', () => {
  const landmarkCases: [string, FaceLandmarks][] = [
    ['mirrored (left eye right of the right eye)', {
      leftEye: [560, 300], rightEye: [440, 300], nose: [500, 360], mouthLeft: [540, 400], mouthRight: [460, 400],
    }],
    ['eyes far outside the face box', {
      leftEye: [-900, -900], rightEye: [9000, 9000], nose: [500, 360], mouthLeft: [460, 400], mouthRight: [540, 400],
    }],
    ['all five points coincident', {
      leftEye: [500, 300], rightEye: [500, 300], nose: [500, 300], mouthLeft: [500, 300], mouthRight: [500, 300],
    }],
    ['NaN everywhere', {
      leftEye: [Number.NaN, Number.NaN], rightEye: [Number.NaN, Number.NaN], nose: [Number.NaN, Number.NaN],
      mouthLeft: [Number.NaN, Number.NaN], mouthRight: [Number.NaN, Number.NaN],
    }],
    ['infinite eye span', {
      leftEye: [Number.POSITIVE_INFINITY, 300], rightEye: [Number.NEGATIVE_INFINITY, 300], nose: [500, 360],
      mouthLeft: [460, 400], mouthRight: [540, 400],
    }],
  ];

  for (const [label, landmarks] of landmarkCases) {
    for (const mode of MODES) {
      it(`survives landmarks ${label} (${mode})`, () => {
        expectSaneOrHexaError({ image: IMAGE, faceBox: GOOD_FACE, landmarks, slot: subjectSlot(), slotRect: SLOT_RECT, mode }, `${label}/${mode}`);
        // …and again with the mirror decision switched on, which is the only
        // consumer of landmark handedness.
        expectSaneOrHexaError(
          { image: IMAGE, faceBox: GOOD_FACE, landmarks, slotRect: SLOT_RECT, mode, slot: subjectSlot({ meta: { faceInward: true } }) },
          `${label}/${mode}/faceInward`,
        );
      });
    }
  }

  it('treats a mirrored eye pair as equivalent to the un-mirrored one', () => {
    // Every consumer uses the eye MIDPOINT and the absolute SPAN, so swapping
    // which eye is "left" must be a no-op — a flipped source photo is common.
    const base = { image: IMAGE, faceBox: GOOD_FACE, slot: subjectSlot(), slotRect: SLOT_RECT, mode: 'bust' as const };
    const normal = fitSubject({ ...base, landmarks: {
      leftEye: [440, 300], rightEye: [560, 300], nose: [500, 360], mouthLeft: [460, 400], mouthRight: [540, 400],
    } });
    const swapped = fitSubject({ ...base, landmarks: {
      leftEye: [560, 300], rightEye: [440, 300], nose: [500, 360], mouthLeft: [540, 400], mouthRight: [460, 400],
    } });
    expect(swapped).toEqual(normal);
  });

  const contentCases: [string, PixelRect][] = [
    ['wholly outside the image', { x: 5000, y: 5000, w: 100, h: 100 }],
    ['far larger than the image', { x: -2000, y: -2000, w: 9000, h: 9000 }],
    ['zero area', { x: 100, y: 100, w: 0, h: 0 }],
    ['negative extent', { x: 100, y: 100, w: -400, h: -900 }],
    ['NaN', { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN }],
  ];
  for (const [label, contentBox] of contentCases) {
    for (const mode of MODES) {
      it(`survives a content box ${label} (${mode})`, () => {
        expectSaneOrHexaError({ image: IMAGE, faceBox: GOOD_FACE, contentBox, slot: subjectSlot(), slotRect: SLOT_RECT, mode }, `${label}/${mode}`);
      });
    }
  }
});

describe('fitSubject — hostile slot metadata', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e9, 1e-9, 'big' as unknown as number]) {
    for (const mode of MODES) {
      it(`survives faceHeightRatio/bustHeadroom/shoulderRatio = ${String(bad)} (${mode})`, () => {
        expectSaneOrHexaError(
          {
            image: IMAGE, faceBox: GOOD_FACE, slotRect: SLOT_RECT, mode,
            slot: subjectSlot({ meta: { faceHeightRatio: bad, bustHeadroom: bad, shoulderRatio: bad } }),
          },
          `meta ${String(bad)}/${mode}`,
        );
      });
    }
  }
});

describe('bustCrop — degenerate inputs', () => {
  it('always returns a sampleable integer rect inside the image, or throws HexaError', () => {
    const faces: FaceBox[] = [
      { x: 400, y: 200, w: 200, h: 260, confidence: 0.9 },
      { x: -500, y: -500, w: 4000, h: 4000, confidence: 0.5 },
      { x: -150, y: 100, w: 200, h: 260, confidence: 0.5 },
      { x: 400, y: 200, w: 0, h: 260, confidence: 0.5 },
      { x: 400, y: 200, w: -200, h: 260, confidence: 0.5 },
      { x: Number.NaN, y: 200, w: 200, h: 260, confidence: 0.5 },
      { x: 400, y: Number.POSITIVE_INFINITY, w: 200, h: 260, confidence: 0.5 },
      { x: 400, y: 200, w: 0.001, h: 0.001, confidence: 0.5 },
    ];
    for (const faceBox of faces) {
      let crop: PixelRect;
      try {
        crop = bustCrop(IMAGE, faceBox);
      } catch (err) {
        expect(err, JSON.stringify(faceBox)).toBeInstanceOf(HexaError);
        continue;
      }
      const label = JSON.stringify(faceBox);
      for (const [k, v] of Object.entries(crop)) {
        expect(Number.isInteger(v), `${label}: bustCrop.${k} = ${v}`).toBe(true);
      }
      expect(crop.w >= 1 && crop.h >= 1, `${label}: ${crop.w}×${crop.h}`).toBe(true);
      expect(crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= IMAGE.width && crop.y + crop.h <= IMAGE.height, label).toBe(true);
    }
  });

  it('rejects a non-finite or degenerate image size', () => {
    for (const image of [{ width: 0, height: 10 }, { width: Number.NaN, height: 10 }, { width: 10, height: -5 }]) {
      expect(() => bustCrop(image, GOOD_FACE)).toThrow(HexaError);
    }
  });

  it('honours a zero headroom instead of silently reverting to the default', () => {
    // Face low enough that neither crop is clamped to y = 0, and a tight
    // shoulderRatio so the eye-line rule is not the binding constraint —
    // otherwise headroom has no observable effect either way.
    const low: FaceBox = { x: 400, y: 600, w: 200, h: 260, confidence: 0.9 };
    const at = (headroom?: number) => bustCrop(IMAGE, low, undefined, { headroom, shoulderRatio: 1.2 }).y;
    expect(at(0)).toBeGreaterThan(at(undefined));
    // …and a nonsense headroom still falls back to the documented default.
    expect(at(Number.NaN)).toBe(at(undefined));
    expect(at(-3)).toBe(at(undefined));
  });
});
