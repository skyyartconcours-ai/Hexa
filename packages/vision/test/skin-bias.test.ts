/**
 * Bias and failure-mode audit for the heuristic YCbCr face locator.
 *
 * `heuristicFaceLocate` is not a detector, and its own docstring says so. This
 * suite exists to keep that honesty measurable rather than aspirational, and in
 * particular to pin down the two ways a colour rule can hurt someone:
 *
 *  1. It can work for some people and not others. The Chai & Ngan YCbCr window
 *     is chroma-based and genuinely luma-tolerant, but the implementation adds
 *     a `Y >= 40` floor to suppress crushed-black noise — and a LUMA floor on a
 *     CHROMA rule is exactly the kind of thing that fails asymmetrically across
 *     skin tones. The sweep below measures where that cliff is instead of
 *     assuming it is harmless.
 *
 *  2. It can be confidently wrong. Returning [] is a safe answer that callers
 *     are documented to read as "unknown". Returning a box around a plank of
 *     stage furniture at the maximum permitted confidence is not.
 *
 * Assertions are the guarantees, not the heuristic's accuracy: nothing here
 * pretends a skin-tone rule should find faces well.
 */

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { heuristicFaceLocate } from '../src/fallback.js';

const W = 320;
const H = 420;
const HEAD = { cx: W * 0.5, cy: H * 0.3, rx: W * 0.17, ry: H * 0.15 };
const TRUE_BOX = { x: HEAD.cx - HEAD.rx, y: HEAD.cy - HEAD.ry, w: HEAD.rx * 2, h: HEAD.ry * 2 };

/** The cap the module promises never to exceed. */
const CONFIDENCE_CAP = 0.4;

type RGB = [number, number, number];

/**
 * A ladder of real skin tones (the common web/emoji ramp, roughly Fitzpatrick
 * I→VI plus two deeper points past the end of that scale).
 */
const TONES: [string, RGB][] = [
  ['I very pale', [255, 219, 172]],
  ['II fair', [241, 194, 125]],
  ['III light-medium', [224, 172, 105]],
  ['IV olive', [198, 134, 66]],
  ['V brown', [141, 85, 36]],
  ['VI deep brown', [97, 61, 31]],
  ['VI+ very deep', [59, 34, 25]],
  ['VI++ deepest', [36, 22, 16]],
];

/** Flat backdrop + shaded skin-tone head ellipse + dark jersey. */
async function portrait(skin: RGB, backdrop: RGB = [20, 30, 60], greyscale = false): Promise<Buffer> {
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      let c: RGB = backdrop;
      if (y > H * 0.58 && x > W * 0.18 && x < W * 0.82) c = [30, 30, 40];
      const dx = (x - HEAD.cx) / HEAD.rx;
      const dy = (y - HEAD.cy) / HEAD.ry;
      if (dx * dx + dy * dy <= 1) {
        // Slight falloff so the head is a shaded ellipse, not a flat plate.
        const k = 1 - 0.12 * (dx * dx + dy * dy);
        c = [skin[0] * k, skin[1] * k, skin[2] * k];
      }
      let [r, g, b] = c;
      if (greyscale) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = l;
      }
      data[o] = Math.round(r);
      data[o + 1] = Math.round(g);
      data[o + 2] = Math.round(b);
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

async function flat(c: RGB, w = W, h = H): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } })
    .png()
    .toBuffer();
}

/** A skin-coloured surface occupying part of the frame, with no person in it. */
async function surface(colour: RGB, areaFraction: number): Promise<Buffer> {
  const data = Buffer.alloc(W * H * 3);
  const bw = Math.round(W * Math.sqrt(areaFraction));
  const bh = Math.round(H * Math.sqrt(areaFraction));
  const bx = Math.round((W - bw) / 2);
  const by = Math.round(H * 0.25);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      let c: RGB = [40, 60, 90];
      if (x >= bx && x < bx + bw && y >= by && y < by + bh) {
        const n = ((x * 7 + y * 13) % 9) - 4; // faint grain
        c = [colour[0] + n, colour[1] + n, colour[2] + n];
      }
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

function iou(a: { x: number; y: number; w: number; h: number }, b: typeof TRUE_BOX): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return 0;
  const i = (x2 - x) * (y2 - y);
  return i / (a.w * a.h + b.w * b.h - i);
}

describe('heuristic face locator — hard guarantees', () => {
  it('never exceeds the confidence cap and never fabricates landmarks or pose', async () => {
    const images = await Promise.all([
      ...TONES.map(([, t]) => portrait(t)),
      ...TONES.slice(0, 3).map(([, t]) => portrait(t, [128, 128, 128])),
      surface([150, 111, 51], 0.18),
      surface([194, 178, 128], 0.18),
      surface([200, 161, 101], 0.25),
      flat([150, 111, 51]),
      flat([255, 255, 255]),
    ]);
    let seen = 0;
    for (const img of images) {
      for (const f of await heuristicFaceLocate(img)) {
        seen++;
        expect(f.box.confidence).toBeLessThanOrEqual(CONFIDENCE_CAP);
        expect(f.box.confidence).toBeGreaterThan(0);
        // Landmarks and pose need a model. Inventing them would let downstream
        // code compute a yaw, a mirror decision and an eye line from a colour blob.
        expect(f.landmarks).toBeUndefined();
        expect(f.yaw).toBeUndefined();
        expect(f.pitch).toBeUndefined();
        expect(f.roll).toBeUndefined();
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 60_000);

  it('returns integer boxes inside the source frame', async () => {
    for (const [, tone] of TONES.slice(0, 5)) {
      for (const f of await heuristicFaceLocate(await portrait(tone))) {
        const b = f.box;
        for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isInteger(v)).toBe(true);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(W);
        expect(b.y + b.h).toBeLessThanOrEqual(H);
      }
    }
  }, 30_000);

  it('is deterministic: the same bytes give the same boxes, 20 times over', async () => {
    const img = await portrait([224, 172, 105]);
    const first = JSON.stringify(await heuristicFaceLocate(img));
    for (let i = 1; i < 20; i++) {
      expect(JSON.stringify(await heuristicFaceLocate(img)), `run ${i + 1} diverged`).toBe(first);
    }
    // A distinct buffer with identical pixels must agree too — nothing may key
    // off buffer identity or arrival order.
    expect(JSON.stringify(await heuristicFaceLocate(Buffer.from(img)))).toBe(first);
  }, 60_000);
});

describe('heuristic face locator — must fail gracefully, not confidently', () => {
  it('returns [] on greyscale, where chroma carries no information at all', async () => {
    for (const [name, tone] of TONES.slice(0, 5)) {
      const faces = await heuristicFaceLocate(await portrait(tone, [20, 30, 60], true));
      expect(faces, `greyscale portrait of ${name} produced a box`).toEqual([]);
    }
    expect(await heuristicFaceLocate(await flat([128, 128, 128]))).toEqual([]);
    // Desaturated-but-not-mathematically-grey is the realistic case (a graded
    // or JPEG-round-tripped mono photo), and must not squeak through either.
    const nearGrey = await sharp(await portrait([224, 172, 105])).modulate({ saturation: 0.12 }).png().toBuffer();
    expect(await heuristicFaceLocate(nearGrey)).toEqual([]);
  }, 30_000);

  it('returns [] on frames with no person in them', async () => {
    const noPerson: [string, Buffer][] = [
      ['blue sky', await flat([90, 150, 220])],
      ['green pitch', await flat([40, 120, 50])],
      ['pure black', await flat([0, 0, 0])],
      ['pure white', await flat([255, 255, 255])],
      // Full-frame skin-coloured surfaces: rejected as "obviously the backdrop".
      ['wall of wood', await flat([150, 111, 51])],
      ['wall of sand', await flat([194, 178, 128])],
      ['1×1 pixel', await flat([200, 160, 120], 1, 1)],
    ];
    for (const [name, img] of noPerson) {
      expect(await heuristicFaceLocate(img), `${name} produced a face box`).toEqual([]);
    }
  }, 30_000);

  it('does not award the confidence cap to skin-coloured furniture', async () => {
    // A colour rule cannot tell a plank from a cheek, so a box here is
    // expected. What must NOT happen is that box outscoring an actual face:
    // a plank is a filled rectangle, and a head is an ellipse that fills only
    // π/4 of its own bounding box, so "fill closer to 1 is better" ranked
    // furniture — and bare forearms — above people.
    const head = (await heuristicFaceLocate(await portrait([224, 172, 105])))[0];
    expect(head).toBeDefined();

    for (const [name, img] of [
      ['wood plank', await surface([150, 111, 51], 0.18)],
      ['sand patch', await surface([194, 178, 128], 0.18)],
      ['cardboard box', await surface([200, 161, 101], 0.25)],
    ] as [string, Buffer][]) {
      const faces = await heuristicFaceLocate(img);
      for (const f of faces) {
        expect(f.box.confidence, `${name} reported ${f.box.confidence}`).toBeLessThan(CONFIDENCE_CAP);
        expect(f.box.confidence!, `${name} outscored a real face`).toBeLessThan(head!.box.confidence!);
      }
    }
  }, 30_000);

  it('ranks the head above bare forearms of the same skin tone', async () => {
    // faces[0] is what fallbackMetrics records as THE face box and what
    // fallbackMatte crops a bust around, so getting this wrong frames the
    // thumbnail on someone's arm.
    for (const [name, tone] of [TONES[2]!, TONES[5]!]) {
      const data = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const o = (y * W + x) * 3;
          let c: RGB = [20, 30, 60];
          const inForearm = y > H * 0.55 && ((x > W * 0.05 && x < W * 0.22) || (x > W * 0.78 && x < W * 0.95));
          if (inForearm) c = tone;
          const dx = (x - HEAD.cx) / HEAD.rx;
          const dy = (y - HEAD.cy) / HEAD.ry;
          if (dx * dx + dy * dy <= 1) c = tone;
          data[o] = c[0];
          data[o + 1] = c[1];
          data[o + 2] = c[2];
        }
      }
      const img = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
      const faces = await heuristicFaceLocate(img);
      expect(faces.length, `${name}: nothing found`).toBeGreaterThan(0);
      expect(iou(faces[0]!.box, TRUE_BOX), `${name}: top-ranked box is not the head`).toBeGreaterThan(0.5);
    }
  }, 30_000);
});

describe('heuristic face locator — skin-tone coverage', () => {
  /**
   * The bias measurement. Tones I→VI must all be found on a non-skin-coloured
   * backdrop; the two points past the end of the Fitzpatrick scale are where
   * the `Y >= 40` luma floor takes over and are asserted only to fail SAFELY —
   * an empty result, or a box that does not claim more confidence than it has
   * earned. A wrong box with a high number attached is the outcome this is
   * guarding against.
   */
  it('locates the head across Fitzpatrick I–VI on a neutral backdrop', async () => {
    for (const [name, tone] of TONES.slice(0, 6)) {
      for (const backdrop of [[20, 30, 60], [128, 128, 128]] as RGB[]) {
        const faces = await heuristicFaceLocate(await portrait(tone, backdrop));
        expect(faces.length, `${name} on ${backdrop.join(',')}: nothing found`).toBeGreaterThan(0);
        expect(iou(faces[0]!.box, TRUE_BOX), `${name} on ${backdrop.join(',')}: box is not the head`).toBeGreaterThan(0.5);
      }
    }
  }, 60_000);

  it('degrades safely below the luma floor rather than reporting a wrong box', async () => {
    // Deep tones, and any tone under a heavy dark grade, cross the Y >= 40
    // floor. The honest outcome there is [] — which is what these produce.
    for (const [name, tone] of TONES.slice(6)) {
      const faces = await heuristicFaceLocate(await portrait(tone));
      for (const f of faces) {
        // If it does return something, it must not be a high-confidence claim.
        expect(f.box.confidence, `${name} claimed ${f.box.confidence} on a sub-floor tone`).toBeLessThanOrEqual(CONFIDENCE_CAP);
      }
    }
    // Heavy blue grading — the failure mode the module docstring calls out by
    // name — takes every tone below the floor and must yield [], not a guess.
    for (const [name, tone] of [TONES[1]!, TONES[4]!]) {
      const graded = await sharp(await portrait(tone))
        .modulate({ brightness: 0.4, saturation: 0.6 })
        .tint({ r: 120, g: 150, b: 255 })
        .png()
        .toBuffer();
      expect(await heuristicFaceLocate(graded), `${name} under a hard blue grade`).toEqual([]);
    }
  }, 60_000);
});
