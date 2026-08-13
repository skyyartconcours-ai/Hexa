/**
 * Empirical verification of the two placement guarantees, in real pixels.
 *
 * Every other test in this package checks the ARITHMETIC of `fitSubject`. This
 * one checks the arithmetic describes what actually gets painted: it renders a
 * synthetic subject through the exact operation the compositor performs —
 * `sharp.extract(srcCrop)` → optional horizontal flip → resize to `destRect` —
 * and then measures, from the output raster alone, where the face ended up.
 *
 * The synthetic subject carries two markers in separate colour channels so they
 * can be located independently after resampling:
 *
 *   RED   — a disc whose centroid is *exactly* the face-box centre. Bilinear
 *           resampling preserves the intensity-weighted centroid of a compact
 *           blob, so its measured position is the face's true painted position
 *           to well under a pixel.
 *   GREEN — a bar on the crown line (0.55 face heights above the face box).
 *           If the crop ever cuts above the crown this bar is simply absent
 *           from the output, which is a far stronger check than comparing
 *           numbers that were both derived from the same formula.
 *
 * The assertion is against `faceCenterInDest`, the value the module publishes
 * and that downstream QA trusts — so a bug in the published number is caught
 * even if the internal maths is self-consistent.
 */

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { FaceBox, FitMode, PixelRect, Slot } from '@hexa/core';
import { crownY, fitSubject } from '../src/index.js';

/** Face-centre marker radius, in source pixels. */
const DISC_R = 9;
/** Crown bar thickness, in source pixels. */
const CROWN_BAR_H = 3;

interface Subject {
  png: Buffer;
  image: { width: number; height: number };
  faceBox: FaceBox;
}

/**
 * Build a subject image with a known face rectangle drawn into it.
 *
 * `faceBox.w`/`h` are forced even so the face centre lands on an exact integer
 * boundary between pixels — the marker can then be drawn perfectly symmetric
 * about it, and any measured offset is the algorithm's, not the fixture's.
 */
async function makeSubject(
  width: number,
  height: number,
  faceX: number,
  faceY: number,
  faceW: number,
  faceH: number,
): Promise<Subject> {
  const faceBox: FaceBox = { x: faceX, y: faceY, w: faceW - (faceW % 2), h: faceH - (faceH % 2), confidence: 0.99 };
  const cx = faceBox.x + faceBox.w / 2;
  const cy = faceBox.y + faceBox.h / 2;
  const crown = Math.round(crownY(faceBox));

  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      // Ground carries NO green at all, so the green channel belongs solely to
      // the crown bar. That matters: at the extreme zooms this suite exercises
      // the bar survives as a ~9× averaged smear, and a ground with any green
      // in it drowns that signal long before the crop actually cuts anything.
      data[o] = 40;
      data[o + 1] = 0;
      data[o + 2] = 90;

      // RED disc, centred exactly on (cx, cy). Pixel i covers [i, i+1), so its
      // centre is i + 0.5 — that is the coordinate the distance is measured in.
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d <= DISC_R) {
        // Soft edge: a hard circle quantises, a smooth one keeps the centroid
        // stable under resampling.
        data[o] = Math.round(255 * Math.min(1, DISC_R - d + 1));
      }

      // GREEN crown bar, drawn on the crown row and the two rows below it,
      // spanning the face width. Three rows rather than one so it survives the
      // heavy downscales in this matrix — a single-pixel line averages away to
      // nothing at scale 0.3 and would read as "cropped" when it was not.
      if (y >= crown && y < crown + CROWN_BAR_H && x >= faceBox.x && x < faceBox.x + faceBox.w) {
        data[o] = 0;
        data[o + 1] = 255;
        data[o + 2] = 0;
      }
    }
  }
  const png = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return { png, image: { width, height }, faceBox };
}

/** Apply a SubjectFit exactly as the compositor would, and read back the raster. */
async function paint(subject: Subject, fit: ReturnType<typeof fitSubject>) {
  let pipe = sharp(subject.png).extract({
    left: fit.srcCrop.x,
    top: fit.srcCrop.y,
    width: fit.srcCrop.w,
    height: fit.srcCrop.h,
  });
  if (fit.flipX) pipe = pipe.flop();
  const { data, info } = await pipe
    .resize(fit.destRect.w, fit.destRect.h, { fit: 'fill', kernel: 'linear' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Intensity-weighted centroid of the red marker, in canvas coordinates. */
function measureFaceCentre(
  raster: { data: Buffer; width: number; height: number; channels: number },
  destRect: PixelRect,
): { x: number; y: number; mass: number } {
  const { data, width, height, channels } = raster;
  let sx = 0;
  let sy = 0;
  let mass = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      // The marker is the only strongly-red thing in the frame.
      const w = r - Math.max(g, b);
      if (w <= 20) continue;
      sx += (x + 0.5) * w;
      sy += (y + 0.5) * w;
      mass += w;
    }
  }
  if (mass === 0) return { x: Number.NaN, y: Number.NaN, mass: 0 };
  // Output pixels are canvas pixels offset by the destination origin, and the
  // resize is a pure scale, so no further correction is needed.
  return { x: destRect.x + sx / mass, y: destRect.y + sy / mass, mass };
}

/** Topmost output row containing the green crown bar, or -1 when it is absent. */
function crownRow(raster: { data: Buffer; width: number; height: number; channels: number }): number {
  const { data, width, height, channels } = raster;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Green exists nowhere but the bar, so any of it is the bar. The floor is
      // just enough to ignore resampling ringing.
      if (data[(y * width + x) * channels + 1]! > 8) return y;
    }
  }
  return -1;
}

/**
 * Where the top of the painted crown bar sits back in SOURCE pixels.
 *
 * This is the honest version of the crown check: it reads the answer out of the
 * raster and maps it back through the fit, so it catches a crop that sliced the
 * top of the head even though every intermediate number looked plausible.
 * Returns +Infinity when the bar is missing altogether.
 */
function crownYInSource(
  raster: { data: Buffer; width: number; height: number; channels: number },
  fit: ReturnType<typeof fitSubject>,
): number {
  const row = crownRow(raster);
  if (row < 0) return Number.POSITIVE_INFINITY;
  const scaleY = fit.destRect.h / fit.srcCrop.h;
  return fit.srcCrop.y + row / scaleY;
}

function subjectSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'hero',
    kind: 'subject',
    rect: { x: 0.02, y: 0.1, w: 0.46, h: 0.9 },
    anchor: 'bottom-left',
    z: 10,
    ...overrides,
  };
}

describe('fitSubject — measured against real output pixels', () => {
  it('lands the face on faceCenterInDest across a matrix of slots, focals and modes', async () => {
    const modes: FitMode[] = ['face-anchor', 'bust'];
    const slots: PixelRect[] = [
      { x: 0, y: 0, w: 480, h: 640 },
      { x: 37, y: 11, w: 620, h: 360 },
      { x: 120, y: 40, w: 240, h: 900 },
    ];
    const focals = [
      { x: 0.5, y: 0.38 },
      { x: 0.28, y: 0.22 },
      { x: 0.72, y: 0.55 },
    ];

    // Face high, middle and low in the frame; one image portrait, one wide.
    const subjects = await Promise.all([
      makeSubject(900, 1300, 340, 120, 220, 280),
      makeSubject(900, 1300, 340, 520, 220, 280),
      makeSubject(1400, 800, 600, 180, 180, 230),
    ]);

    const errX: number[] = [];
    const errY: number[] = [];
    const errR: number[] = [];
    let crownCuts = 0;
    let checked = 0;

    for (const subject of subjects) {
      for (const slotRect of slots) {
        for (const focal of focals) {
          for (const mode of modes) {
            for (const flipX of [false, true]) {
              const fit = fitSubject({
                image: subject.image,
                faceBox: subject.faceBox,
                slot: subjectSlot({ flipX }),
                slotRect,
                mode,
                focal,
              });
              const raster = await paint(subject, fit);
              const measured = measureFaceCentre(raster, fit.destRect);

              // The marker must survive the crop — if it did not, the face is
              // not in the output at all and `faceCenterInDest` is fiction.
              expect(measured.mass, `face marker missing entirely (${mode}, flip=${flipX})`).toBeGreaterThan(0);

              const dx = measured.x - fit.faceCenterInDest.x;
              const dy = measured.y - fit.faceCenterInDest.y;
              errX.push(Math.abs(dx));
              errY.push(Math.abs(dy));
              errR.push(Math.hypot(dx, dy));
              checked++;

              // And the face is where the DESIGN asked for it, not merely where
              // the module says it is.
              expect(Math.abs(measured.x - (slotRect.x + focal.x * slotRect.w))).toBeLessThanOrEqual(1.5);
              expect(Math.abs(measured.y - (slotRect.y + focal.y * slotRect.h))).toBeLessThanOrEqual(1.5);

              // Crown: present in the source, therefore required in the output,
              // and at the right place — not merely "some green survived".
              const crown = crownY(subject.faceBox);
              if (crown >= 0) {
                const painted = crownYInSource(raster, fit);
                // Tolerance = bar thickness + a pixel of resampling slop.
                if (!(painted <= crown + CROWN_BAR_H + 1)) crownCuts++;
              }
            }
          }
        }
      }
    }

    expect(checked).toBe(108);
    expect(crownCuts, 'the crown bar was cropped out of the painted result').toBe(0);

    const max = (v: number[]) => v.reduce((a, b) => Math.max(a, b), 0);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    // Measurement floor is resampling noise on the marker centroid, not the
    // algorithm; anything above a pixel would be a genuine placement error.
    expect(max(errX), `worst measured x error ${max(errX).toFixed(3)}px`).toBeLessThan(1);
    expect(max(errY), `worst measured y error ${max(errY).toFixed(3)}px`).toBeLessThan(1);
    expect(mean(errR)).toBeLessThan(0.5);
  }, 60_000);

  it('keeps the crown in frame even when the zoom is asked for the impossible', async () => {
    // faceHeightRatio 0.6 with focal.y 0.08 demands a crop whose top edge is
    // far below the crown; the zoom must give way instead of the skull.
    const subject = await makeSubject(1000, 1400, 380, 500, 240, 300);
    for (const focalY of [0.05, 0.12, 0.25, 0.45]) {
      const fit = fitSubject({
        image: subject.image,
        faceBox: subject.faceBox,
        slot: subjectSlot({ meta: { faceHeightRatio: 0.6 } }),
        slotRect: { x: 10, y: 20, w: 500, h: 700 },
        mode: 'face-anchor',
        focal: { x: 0.5, y: focalY },
      });
      const raster = await paint(subject, fit);
      const crown = crownY(subject.faceBox);
      expect(crownRow(raster), `crown bar missing from the raster at focal.y=${focalY}`).toBeGreaterThanOrEqual(0);
      expect(crownYInSource(raster, fit), `crown cropped at focal.y=${focalY}`).toBeLessThanOrEqual(crown + CROWN_BAR_H + 1);
      expect(fit.srcCrop.y).toBeLessThanOrEqual(Math.max(0, crown));
    }
  }, 30_000);

  it('places the face correctly AFTER a horizontal mirror', async () => {
    const subject = await makeSubject(1000, 1400, 200, 400, 240, 300);
    const slotRect: PixelRect = { x: 64, y: 32, w: 500, h: 700 };
    const focal = { x: 0.3, y: 0.36 };
    const fit = fitSubject({
      image: subject.image,
      faceBox: subject.faceBox,
      slot: subjectSlot({ flipX: true }),
      slotRect,
      mode: 'face-anchor',
      focal,
    });
    expect(fit.flipX).toBe(true);
    const measured = measureFaceCentre(await paint(subject, fit), fit.destRect);
    // The whole point of doing the anchoring in mirrored space: the published
    // face centre is correct for the FLIPPED image, not the original.
    expect(Math.abs(measured.x - fit.faceCenterInDest.x)).toBeLessThan(1);
    expect(Math.abs(measured.y - fit.faceCenterInDest.y)).toBeLessThan(1);
    expect(Math.abs(measured.x - (slotRect.x + focal.x * slotRect.w))).toBeLessThan(1.5);
  }, 30_000);
});
