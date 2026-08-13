/**
 * Determinism gate.
 *
 * Hexa's headline promise is that the same request with the same seed produces
 * byte-identical output. Geometry is the first place that can break, and it
 * breaks silently: a layer sort that leans on engine sort internals, a tie
 * resolved by whatever order a Map happened to be populated in, or a float sum
 * accumulated in a different order all produce a *plausible* image that simply
 * is not the same image.
 *
 * Two properties are asserted here, and they are different:
 *
 *  1. REPEATABILITY — running the same inputs N times gives one answer.
 *     Catches ambient state: clocks, RNG, module-level caches.
 *  2. ORDER-INVARIANCE — permuting the input arrays gives the same answer.
 *     Catches non-total comparators, whose ties are settled by input position
 *     rather than by the data. This is the sharper of the two: repeatability
 *     holds by accident on V8 (its sort is stable), so a shuffle is what
 *     actually exposes the tie.
 */

import { describe, expect, it } from 'vitest';
import type { LayoutSpec, Slot } from '@hexa/core';
import {
  adaptLayout,
  fitSubject,
  resolveLayout,
  resolveOverlaps,
  scoreComposition,
  withSlots,
  type ScoredFace,
} from '../src/index.js';
import { face, landmarksFor, rect, versusLayout } from './fixtures.js';

const RUNS = 20;

/** Deterministic shuffle so a failure is reproducible, unlike Math.random. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let s = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Full pipeline slice: resolve a layout, fit two subjects into their slots,
 * separate the overlaps and score the composition. Everything a render's
 * geometry depends on, in one value that can be compared byte-for-byte.
 */
function runPipeline(spec: LayoutSpec, faceOrder = 0): string {
  const layout = resolveLayout(spec, 1280, 720);
  const separated = withSlots(layout, resolveOverlaps(layout.slots, layout.canvas).slots);

  const subjects = separated.slots.filter((s) => s.slot.kind === 'subject');
  const fits = subjects.map((s, i) => {
    const image = { width: 1400 + i * 137, height: 1900 + i * 91 };
    const fb = face(520 + i * 60, 300 + i * 40, 240, 300);
    return {
      id: s.slot.id,
      fit: fitSubject({
        image,
        faceBox: fb,
        landmarks: landmarksFor(fb, i === 0 ? -1 : 1),
        slot: s.slot,
        slotRect: s.rect,
        mode: s.slot.fit ?? 'face-anchor',
      }),
    };
  });

  const faces: ScoredFace[] = fits.map(({ id, fit }) => ({
    slotId: id,
    rect: rect(
      Math.round(fit.faceCenterInDest.x - 60),
      Math.round(fit.faceCenterInDest.y - 75),
      120,
      150,
    ),
    facing: 'front' as const,
  }));

  const textRects = separated.slots
    .filter((s) => s.slot.kind === 'text')
    .map((s) => ({ slotId: s.slot.id, rect: s.rect }));

  const score = scoreComposition({
    layout: separated,
    faces: faceOrder ? shuffled(faces, faceOrder) : faces,
    textRects: faceOrder ? shuffled(textRects, faceOrder) : textRects,
  });

  return JSON.stringify({
    slots: separated.slots.map((s) => ({ id: s.slot.id, z: s.z, rect: s.rect })),
    zones: separated.safeZones.map((z) => ({ id: z.zone.id, rect: z.rect })),
    fits,
    total: score.total,
    parts: score.parts,
    findings: [...score.findings].map((f) => `${f.gate}|${f.severity}|${f.message}`).sort(),
  });
}

describe('determinism — repeatability', () => {
  it(`produces an identical layout + subject fit on ${RUNS} consecutive runs`, () => {
    const spec = versusLayout();
    const first = runPipeline(spec);
    for (let i = 1; i < RUNS; i++) {
      expect(runPipeline(spec), `run ${i + 1} diverged from run 1`).toBe(first);
    }
  });

  it(`reflows to 9:16 identically on ${RUNS} consecutive runs`, () => {
    const spec = versusLayout();
    const first = JSON.stringify(adaptLayout(spec, 9 / 16));
    for (let i = 1; i < RUNS; i++) {
      expect(JSON.stringify(adaptLayout(spec, 9 / 16))).toBe(first);
    }
  });

  it('never mutates its input, so run N+1 starts from the same spec as run 1', () => {
    const spec = versusLayout();
    const before = JSON.stringify(spec);
    resolveLayout(spec, 1280, 720);
    adaptLayout(spec, 9 / 16);
    adaptLayout(adaptLayout(spec, 9 / 16), 16 / 9);
    expect(JSON.stringify(spec)).toBe(before);
  });
});

describe('determinism — order invariance', () => {
  it('resolves every slot to the same rect however the slot array is ordered', () => {
    const spec = versusLayout();
    const byId = (l: ReturnType<typeof resolveLayout>) =>
      JSON.stringify(
        l.slots.map((s) => ({ id: s.slot.id, rect: s.rect })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      );
    const reference = byId(resolveLayout(spec, 1280, 720));

    for (let seed = 1; seed <= 12; seed++) {
      const permuted: LayoutSpec = { ...spec, slots: shuffled(spec.slots, seed) };
      expect(byId(resolveLayout(permuted, 1280, 720)), `slot order seed ${seed} moved a slot`).toBe(reference);
    }
  });

  /**
   * Paint order is `z` ascending, ties keeping the authored order — a
   * documented part of the contract, not an accident of V8's sort. That means
   * equal-z slots ARE array-order sensitive by design, which is safe only for
   * as long as slot arrays are authored literals. Anything that ever builds
   * `LayoutSpec.slots` by iterating an object or a Map inherits that iteration
   * order straight into the render.
   */
  it('paints in z order, resolving ties by authored position and nothing else', () => {
    const spec = versusLayout();
    const resolved = resolveLayout(spec, 1280, 720);
    const authored = new Map(spec.slots.map((s, i) => [s.id, i] as const));

    for (let i = 1; i < resolved.slots.length; i++) {
      const prev = resolved.slots[i - 1]!;
      const cur = resolved.slots[i]!;
      expect(prev.z).toBeLessThanOrEqual(cur.z);
      if (prev.z === cur.z) {
        expect(
          authored.get(prev.slot.id)!,
          `equal-z slots "${prev.slot.id}" and "${cur.slot.id}" are not in authored order`,
        ).toBeLessThan(authored.get(cur.slot.id)!);
      }
    }
  });

  it('keeps the layer sort total even when a z sneaks through as NaN', () => {
    const spec = versusLayout();
    const broken: LayoutSpec = {
      ...spec,
      slots: spec.slots.map((s) => (s.id === 'vs' ? { ...s, z: Number.NaN } : s)),
    };
    // A NaN z makes `a.z - b.z` NaN, which leaves a bare numeric comparator at
    // the mercy of the engine's sort internals. Refuse it at the door instead.
    expect(() => resolveLayout(broken, 1280, 720)).toThrow(/non-finite z/);
  });

  it('scores a composition the same however faces and text are ordered', () => {
    const spec = versusLayout();
    const reference = runPipeline(spec);
    for (let seed = 1; seed <= 12; seed++) {
      expect(runPipeline(spec, seed), `face/text order seed ${seed} changed the score`).toBe(reference);
    }
  });

  it('reflows the same however the slot array is ordered', () => {
    const spec = versusLayout();
    const canonical = (s: LayoutSpec) =>
      JSON.stringify([...s.slots].map((x) => ({ id: x.id, rect: x.rect })).sort((a, b) => (a.id < b.id ? -1 : 1)));
    const reference = canonical(adaptLayout(spec, 9 / 16));

    for (let seed = 1; seed <= 12; seed++) {
      const permuted: LayoutSpec = { ...spec, slots: shuffled(spec.slots, seed) };
      expect(canonical(adaptLayout(permuted, 9 / 16)), `slot order seed ${seed} changed the reflow`).toBe(reference);
    }
  });

  it('breaks subject-stacking ties on id, not on array position', () => {
    // Two subjects with IDENTICAL rects: nothing in the geometry can order
    // them, so the tiebreak is the only thing deciding who ends up on top.
    const twin = (id: string): Slot => ({
      id,
      kind: 'subject',
      rect: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 },
      anchor: 'bottom-center',
      z: 10,
      fit: 'face-anchor',
    });
    const spec: LayoutSpec = {
      id: 'twins',
      name: 'Twins',
      designAspect: 16 / 9,
      slots: [twin('alpha'), twin('beta')],
      safeZones: [],
      focalPoints: [],
    };
    const key = (s: LayoutSpec) => JSON.stringify(s.slots.map((x) => [x.id, x.rect]));
    const forward = key(adaptLayout(spec, 9 / 16));
    const backward = key(adaptLayout({ ...spec, slots: [...spec.slots].reverse() }, 9 / 16));
    // The reversed input lists the same two slots in the other order; after the
    // reflow each id must still own the same band.
    const bands = (s: string) => JSON.parse(s).sort((a: [string], b: [string]) => (a[0] < b[0] ? -1 : 1));
    expect(bands(backward)).toEqual(bands(forward));
  });

  it('resolves overlaps identically however the slot array is ordered', () => {
    const layout = resolveLayout(versusLayout(), 1280, 720);
    const reference = resolveOverlaps(layout.slots, layout.canvas);
    const key = (r: ReturnType<typeof resolveOverlaps>) =>
      JSON.stringify(
        r.slots.map((s) => ({ id: s.slot.id, rect: s.rect })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      );
    // Movable×movable separation splits the push between both slots, so a
    // reordered input must not change who gives way.
    expect(key(resolveOverlaps([...layout.slots].reverse(), layout.canvas))).toBe(key(reference));
  });
});

describe('determinism — no ambient state reaches geometry', () => {
  it('is unaffected by the wall clock', () => {
    const spec = versusLayout();
    const before = runPipeline(spec);
    const realNow = Date.now;
    const realDate = globalThis.Date;
    try {
      // Jump the clock a decade forward mid-test. Anything that reads it —
      // directly or through a default parameter — will show up as a diff.
      const offset = 10 * 365 * 86_400_000;
      globalThis.Date = class extends realDate {
        constructor(...args: unknown[]) {
          // @ts-expect-error — passthrough constructor for the shim
          super(...(args.length ? args : [realNow() + offset]));
        }
        static now() {
          return realNow() + offset;
        }
      } as DateConstructor;
      expect(runPipeline(spec)).toBe(before);
    } finally {
      globalThis.Date = realDate;
    }
  });

  it('is unaffected by Math.random', () => {
    const spec = versusLayout();
    const before = runPipeline(spec);
    const realRandom = Math.random;
    try {
      // A constant RNG makes any hidden dependence on randomness deterministic
      // but WRONG, which is exactly what a diff against `before` detects.
      Math.random = () => 0.123456789;
      expect(runPipeline(spec)).toBe(before);
    } finally {
      Math.random = realRandom;
    }
  });
});
