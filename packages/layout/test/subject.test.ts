import { describe, expect, it } from 'vitest';
import type { PixelRect, Slot } from '@hexa/core';
import {
  CROWN_ABOVE_FACE,
  DEFAULT_FOCAL,
  alphaContentBox,
  bustCrop,
  crownY,
  facingFromLandmarks,
  fitSubject,
} from '../src/index.js';
import { face, landmarksFor, rect } from './fixtures.js';

function subjectSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'left-subject',
    kind: 'subject',
    rect: { x: 0.02, y: 0.1, w: 0.46, h: 0.9 },
    anchor: 'bottom-left',
    z: 10,
    fit: 'face-anchor',
    ...overrides,
  };
}

function insideImage(crop: PixelRect, w: number, h: number): boolean {
  return (
    Number.isInteger(crop.x) &&
    Number.isInteger(crop.y) &&
    Number.isInteger(crop.w) &&
    Number.isInteger(crop.h) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.w > 0 &&
    crop.h > 0 &&
    crop.x + crop.w <= w &&
    crop.y + crop.h <= h
  );
}

describe('fitSubject — face-anchor', () => {
  const image = { width: 1600, height: 2000 };
  const slotRect = rect(26, 72, 589, 648);

  it('lands the face centre on the requested focal point for a range of faces', () => {
    const focals = [DEFAULT_FOCAL, { x: 0.35, y: 0.3 }, { x: 0.62, y: 0.45 }];
    let checked = 0;
    for (const fh of [120, 240, 400]) {
      for (const fx of [300, 800, 1300]) {
        for (const fy of [400, 900, 1500]) {
          for (const focal of focals) {
            const fb = face(fx - fh * 0.4, fy - fh / 2, fh * 0.8, fh);
            const fit = fitSubject({ image, faceBox: fb, slot: subjectSlot(), slotRect, mode: 'face-anchor', focal });
            const wantX = slotRect.x + focal.x * slotRect.w;
            const wantY = slotRect.y + focal.y * slotRect.h;
            expect(Math.abs(fit.faceCenterInDest.x - wantX)).toBeLessThanOrEqual(1);
            expect(Math.abs(fit.faceCenterInDest.y - wantY)).toBeLessThanOrEqual(1);
            expect(insideImage(fit.srcCrop, image.width, image.height)).toBe(true);
            expect(fit.scale).toBeGreaterThan(0);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(81);
  });

  it('never crops above the crown, even with an aggressive focal and zoom', () => {
    for (const fh of [150, 300, 600]) {
      for (const fy of [500, 1000, 1600]) {
        for (const focalY of [0.12, 0.2, 0.38, 0.5]) {
          const fb = face(700, fy, fh * 0.8, fh);
          const fit = fitSubject({
            image,
            faceBox: fb,
            slot: subjectSlot({ meta: { faceHeightRatio: 0.45 } }),
            slotRect,
            mode: 'face-anchor',
            focal: { x: 0.5, y: focalY },
          });
          const crown = crownY(fb);
          expect(fit.srcCrop.y).toBeLessThanOrEqual(Math.max(0, crown));
          // and the face is still exactly on its mark
          expect(Math.abs(fit.faceCenterInDest.y - (slotRect.y + focalY * slotRect.h))).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('sizes the face to the requested fraction of SLOT height', () => {
    const fb = face(700, 900, 160, 200);
    const fit = fitSubject({
      image,
      faceBox: fb,
      slot: subjectSlot({ meta: { faceHeightRatio: 0.25 } }),
      slotRect,
      mode: 'face-anchor',
    });
    const paintedFaceHeight = fb.h * fit.scale;
    expect(paintedFaceHeight / slotRect.h).toBeCloseTo(0.25, 2);
  });

  it('letterboxes rather than sliding the face off its mark', () => {
    // Face high in the frame: the ideal window runs off the top of the image.
    const fb = face(700, 20, 160, 200);
    const fit = fitSubject({ image, faceBox: fb, slot: subjectSlot(), slotRect, mode: 'face-anchor' });
    expect(fit.srcCrop.y).toBe(0);
    expect(fit.destRect.h).toBeLessThan(slotRect.h);
    expect(fit.destRect.y).toBeGreaterThan(slotRect.y); // letterbox gap at the top
    const wantY = slotRect.y + DEFAULT_FOCAL.y * slotRect.h;
    expect(Math.abs(fit.faceCenterInDest.y - wantY)).toBeLessThanOrEqual(1);
  });

  it('mirrors the crop when the subject would look out of frame', () => {
    const fb = face(700, 900, 160, 200);
    const looksLeft = landmarksFor(fb, -1);
    // Slot lives on the LEFT of the canvas, so the subject must look RIGHT.
    const slot = subjectSlot({ meta: { faceInward: true } });
    const fit = fitSubject({ image, faceBox: fb, landmarks: looksLeft, slot, slotRect, mode: 'face-anchor' });
    expect(facingFromLandmarks(looksLeft)).toBe('left');
    expect(fit.flipX).toBe(true);
    expect(insideImage(fit.srcCrop, image.width, image.height)).toBe(true);
    // Face still lands on the focal point AFTER the mirror.
    const wantX = slotRect.x + DEFAULT_FOCAL.x * slotRect.w;
    expect(Math.abs(fit.faceCenterInDest.x - wantX)).toBeLessThanOrEqual(1);

    // An inward-looking subject on the same slot is left alone.
    const looksRight = landmarksFor(fb, 1);
    const keep = fitSubject({ image, faceBox: fb, landmarks: looksRight, slot, slotRect, mode: 'face-anchor' });
    expect(keep.flipX).toBe(false);

    // Explicit slot.flipX always wins.
    const forced = fitSubject({
      image,
      faceBox: fb,
      landmarks: looksRight,
      slot: subjectSlot({ flipX: true, meta: { faceInward: true } }),
      slotRect,
      mode: 'face-anchor',
    });
    expect(forced.flipX).toBe(true);
  });

  it('falls back to a cover fit when no face was detected', () => {
    const fit = fitSubject({ image, slot: subjectSlot(), slotRect, mode: 'face-anchor' });
    expect(fit.destRect).toEqual(slotRect);
    expect(insideImage(fit.srcCrop, image.width, image.height)).toBe(true);
  });
});

describe('fitSubject — other modes', () => {
  const image = { width: 1600, height: 2000 };
  const slotRect = rect(100, 50, 500, 700);

  it('bust uses the head-and-shoulders framing', () => {
    const fb = face(700, 500, 200, 260);
    const fit = fitSubject({
      image,
      faceBox: fb,
      landmarks: landmarksFor(fb),
      slot: subjectSlot({ fit: 'bust' }),
      slotRect,
      mode: 'bust',
    });
    expect(insideImage(fit.srcCrop, image.width, image.height)).toBe(true);
    expect(fit.srcCrop.y).toBeLessThanOrEqual(crownY(fb));
    // Head-and-shoulders means the face is a big chunk of the slot.
    const facePainted = (fb.h * fit.scale) / slotRect.h;
    expect(facePainted).toBeGreaterThan(0.2);
    expect(facePainted).toBeLessThan(0.6);
  });

  it('full puts the feet on the slot bottom and honours the content box', () => {
    const content = rect(400, 200, 700, 1600);
    const fb = face(680, 260, 140, 170);
    const fit = fitSubject({
      image,
      faceBox: fb,
      slot: subjectSlot({ fit: 'full' }),
      slotRect,
      mode: 'full',
      contentBox: content,
    });
    expect(fit.destRect.y + fit.destRect.h).toBe(slotRect.y + slotRect.h);
    expect(fit.destRect.h).toBe(slotRect.h);
    expect(fit.srcCrop).toEqual(content);
    // The head is near the top of the painted subject.
    expect(fit.faceCenterInDest.y).toBeLessThan(fit.destRect.y + fit.destRect.h * 0.3);
    expect(fit.scale).toBeCloseTo(slotRect.h / content.h, 2);
  });

  it('cover fills the slot exactly and contain fits inside it', () => {
    const cover = fitSubject({ image, slot: subjectSlot({ fit: 'cover' }), slotRect, mode: 'cover' });
    expect(cover.destRect).toEqual(slotRect);

    const contain = fitSubject({ image, slot: subjectSlot({ fit: 'contain', anchor: 'bottom-center' }), slotRect, mode: 'contain' });
    expect(contain.srcCrop).toEqual({ x: 0, y: 0, w: image.width, h: image.height });
    expect(contain.destRect.w).toBeLessThanOrEqual(slotRect.w);
    expect(contain.destRect.h).toBeLessThanOrEqual(slotRect.h);
    expect(contain.destRect.y + contain.destRect.h).toBe(slotRect.y + slotRect.h);
    expect(contain.destRect.x + contain.destRect.w / 2).toBeCloseTo(slotRect.x + slotRect.w / 2, 0);
  });

  it('rejects impossible inputs', () => {
    expect(() => fitSubject({ image: { width: 0, height: 10 }, slot: subjectSlot(), slotRect, mode: 'cover' })).toThrow();
    expect(() =>
      fitSubject({ image, faceBox: face(5000, 5000, 100, 100), slot: subjectSlot(), slotRect, mode: 'face-anchor' }),
    ).toThrow(/outside/);
  });
});

describe('bustCrop', () => {
  const image = { width: 2000, height: 2600 };
  const fb = face(800, 400, 300, 400);

  it('uses real head proportions', () => {
    const crop = bustCrop(image, fb, landmarksFor(fb));
    const crown = fb.y - CROWN_ABOVE_FACE * fb.h;
    const chin = fb.y + fb.h;

    // headroom: at least the default 0.28 face heights above the crown
    expect(crop.y).toBeLessThanOrEqual(crown - 0.28 * fb.h + 1);
    // …but not an absurd amount of sky
    expect(crown - crop.y).toBeLessThan(1.0 * fb.h);
    // shoulders: ~2.1 face heights below the chin
    expect(crop.y + crop.h).toBeGreaterThanOrEqual(chin + 2.0 * fb.h);
    expect(crop.y + crop.h).toBeLessThanOrEqual(chin + 2.3 * fb.h);
    // wide enough to hold a pair of shoulders
    expect(crop.w).toBeGreaterThanOrEqual(fb.w * 2.2 - 1);
    expect(crop.x + crop.w / 2).toBeCloseTo(fb.x + fb.w / 2, 0);
  });

  it('places the eye line on the upper third, with or without landmarks', () => {
    for (const lm of [landmarksFor(fb), undefined]) {
      const crop = bustCrop(image, fb, lm);
      const eye = lm ? (lm.leftEye[1] + lm.rightEye[1]) / 2 : fb.y + 0.42 * fb.h;
      const frac = (eye - crop.y) / crop.h;
      expect(frac).toBeGreaterThan(0.28);
      expect(frac).toBeLessThan(0.4);
    }
  });

  it('respects headroom and shoulderRatio options', () => {
    const tight = bustCrop(image, fb, undefined, { headroom: 0.1, shoulderRatio: 1.2 });
    const loose = bustCrop(image, fb, undefined, { headroom: 0.6, shoulderRatio: 3.0 });
    expect(loose.y).toBeLessThan(tight.y);
    expect(loose.h).toBeGreaterThan(tight.h);
    expect(tight.y + tight.h).toBeLessThan(loose.y + loose.h);
  });

  it('clips to the image and never returns something unsampleable', () => {
    const small = { width: 500, height: 500 };
    const crop = bustCrop(small, face(200, 40, 120, 160));
    expect(insideImage(crop, small.width, small.height)).toBe(true);
    expect(() => bustCrop(image, face(0, 0, 0, 0))).toThrow(/positive/);
  });
});

describe('alphaContentBox', () => {
  it('finds the tight bounds of the opaque pixels', () => {
    const w = 20;
    const h = 10;
    const alpha = new Uint8Array(w * h);
    for (let y = 3; y <= 6; y++) for (let x = 5; x <= 12; x++) alpha[y * w + x] = 255;
    expect(alphaContentBox(alpha, w, h)).toEqual({ x: 5, y: 3, w: 8, h: 4 });
  });

  it('respects the threshold and reports fully transparent buffers', () => {
    const alpha = new Uint8Array(16);
    alpha[5] = 4; // faint pixel at (1,1)
    expect(alphaContentBox(alpha, 4, 4, 2)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(alphaContentBox(alpha, 4, 4)).toBeNull(); // default threshold is 8
    expect(alphaContentBox(new Uint8Array(16), 4, 4)).toBeNull();
  });

  it('rejects a buffer that cannot hold the image', () => {
    expect(() => alphaContentBox(new Uint8Array(10), 8, 8)).toThrow(/expected at least/);
  });
});

describe('facingFromLandmarks', () => {
  it('reads head turn from the nose offset', () => {
    const fb = face(100, 100, 200, 250);
    expect(facingFromLandmarks(landmarksFor(fb, 1))).toBe('right');
    expect(facingFromLandmarks(landmarksFor(fb, -1))).toBe('left');
    expect(facingFromLandmarks(landmarksFor(fb, 0))).toBe('front');
    expect(facingFromLandmarks(undefined)).toBeUndefined();
  });
});
