import { describe, expect, it } from 'vitest';
import type { LayoutSpec } from '@hexa/core';
import { TEXT_LEGIBILITY_BOOST, adaptLayout, resolveLayout, scoreComposition } from '../src/index.js';
import { insideCanvas, rect, verticalVersusLayout, versusLayout } from './fixtures.js';

const WIDE = 16 / 9;
const TALL = 9 / 16;

function byId(spec: LayoutSpec, id: string) {
  const slot = spec.slots.find((s) => s.id === id);
  expect(slot, `slot ${id} survived the reflow`).toBeDefined();
  return slot!;
}

describe('adaptLayout — wide to tall', () => {
  const source = versusLayout();
  const tall = adaptLayout(source, TALL);

  it('preserves every slot, its id, kind and z, and mutates nothing', () => {
    expect(tall.slots).toHaveLength(source.slots.length);
    expect(tall.slots.map((s) => s.id).sort()).toEqual(source.slots.map((s) => s.id).sort());
    for (const s of tall.slots) {
      const original = byId(source, s.id);
      expect(s.kind).toBe(original.kind);
      expect(s.z).toBe(original.z);
      expect(s.fit).toBe(original.fit);
    }
    expect(tall.designAspect).toBe(TALL);
    expect(source.designAspect).toBe(WIDE);
    expect(byId(source, 'left-subject').rect).toEqual({ x: 0.02, y: 0.1, w: 0.46, h: 0.9 });
  });

  it('keeps every slot inside the canvas', () => {
    for (const s of tall.slots) {
      expect(insideCanvas(s.rect), `${s.id} → ${JSON.stringify(s.rect)}`).toBe(true);
    }
    for (const p of tall.focalPoints) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('stacks side-by-side subjects vertically, left→right becoming top→bottom', () => {
    const left = byId(source, 'left-subject');
    const right = byId(source, 'right-subject');
    expect(left.rect.x).toBeLessThan(right.rect.x); // side by side in the source

    const top = byId(tall, 'left-subject');
    const bottom = byId(tall, 'right-subject');
    expect(top.rect.y + top.rect.h / 2).toBeLessThan(bottom.rect.y + bottom.rect.h / 2);
    // they now share the horizontal centre instead of splitting it
    expect(Math.abs(top.rect.x + top.rect.w / 2 - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(bottom.rect.x + bottom.rect.w / 2 - 0.5)).toBeLessThan(0.1);
    // and the stack owns the lower two thirds
    expect(top.rect.y).toBeGreaterThanOrEqual(0.25);
    expect(bottom.rect.y + bottom.rect.h).toBeCloseTo(1, 2);
  });

  it('preserves each subject’s pixel aspect ratio', () => {
    for (const id of ['left-subject', 'right-subject']) {
      const before = byId(source, id).rect;
      const after = byId(tall, id).rect;
      const beforeAspect = (before.w * WIDE) / before.h;
      const afterAspect = (after.w * TALL) / after.h;
      expect(afterAspect).toBeCloseTo(beforeAspect, 2);
    }
  });

  it('moves the headline into the top third and grows the type', () => {
    const headline = byId(tall, 'headline');
    expect(headline.rect.y + headline.rect.h).toBeLessThan(1 / 3);
    // 1.5× bigger relative to canvas width…
    expect(headline.rect.w).toBeCloseTo(byId(source, 'headline').rect.w * TEXT_LEGIBILITY_BOOST, 2);
    // …and bigger in absolute pixels too, on a much narrower canvas
    const beforePx = byId(source, 'headline').rect.h * 720;
    const afterPx = headline.rect.h * 1920;
    expect(afterPx).toBeGreaterThan(beforePx);
    expect(afterPx / beforePx).toBeLessThan(1.6);
  });

  it('docks name plates to the subject they belong to', () => {
    const topSubject = byId(tall, 'left-subject');
    const leftName = byId(tall, 'left-name');
    expect(leftName.rect.y).toBeGreaterThan(topSubject.rect.y);
    expect(leftName.rect.y + leftName.rect.h).toBeLessThanOrEqual(topSubject.rect.y + topSubject.rect.h + 1e-9);
    expect(Math.abs(leftName.rect.x + leftName.rect.w / 2 - (topSubject.rect.x + topSubject.rect.w / 2))).toBeLessThan(0.02);

    const bottomSubject = byId(tall, 'right-subject');
    const rightName = byId(tall, 'right-name');
    expect(rightName.rect.y).toBeGreaterThan(bottomSubject.rect.y);
  });

  it('keeps reflowed text clear of the vertical player’s bottom chrome', () => {
    const caption = tall.safeZones.find((z) => z.id === 'shorts-caption-block')!;
    for (const s of tall.slots) {
      if (s.kind !== 'text' && s.kind !== 'badge') continue;
      expect(s.rect.y + s.rect.h, `${s.id} sits below the caption block`).toBeLessThanOrEqual(caption.rect.y + 1e-9);
    }
  });

  it('swaps YouTube safe zones for the Shorts set and keeps custom ones', () => {
    const withCustom: LayoutSpec = {
      ...source,
      safeZones: [
        ...source.safeZones,
        { id: 'sponsor-strip', rect: { x: 0.3, y: 0.9, w: 0.4, h: 0.08 }, severity: 'hard', reason: 'sponsor bug' },
      ],
    };
    const out = adaptLayout(withCustom, TALL);
    expect(out.safeZones.some((z) => z.id === 'shorts-action-rail')).toBe(true);
    expect(out.safeZones.some((z) => z.id.startsWith('yt-'))).toBe(false);
    expect(out.safeZones.some((z) => z.id === 'sponsor-strip')).toBe(true);
  });

  it('produces a composition that still scores well', () => {
    const resolved = resolveLayout(tall, 1080, 1920);
    const top = resolved.byId('left-subject')!.rect;
    const bottom = resolved.byId('right-subject')!.rect;
    const faceOf = (r: { x: number; y: number; w: number; h: number }) =>
      rect(Math.round(r.x + r.w * 0.32), Math.round(r.y + r.h * 0.12), Math.round(r.w * 0.34), Math.round(r.h * 0.3));
    const score = scoreComposition({
      layout: resolved,
      faces: [
        { slotId: 'left-subject', rect: faceOf(top), facing: 'front' },
        { slotId: 'right-subject', rect: faceOf(bottom), facing: 'front' },
      ],
      textRects: [{ slotId: 'headline', rect: resolved.byId('headline')!.rect }],
    });
    expect(score.total).toBeGreaterThan(65);
    expect(score.findings.filter((f) => f.severity === 'fail')).toHaveLength(0);
  });
});

describe('adaptLayout — tall to wide', () => {
  const source = verticalVersusLayout();
  const wide = adaptLayout(source, WIDE);

  it('spreads stacked subjects into columns with their feet on the floor', () => {
    const first = byId(wide, 'top-subject');
    const second = byId(wide, 'bottom-subject');
    expect(first.rect.x + first.rect.w / 2).toBeLessThan(second.rect.x + second.rect.w / 2);
    expect(first.rect.y + first.rect.h).toBeCloseTo(1, 5);
    expect(second.rect.y + second.rect.h).toBeCloseTo(1, 5);
    for (const s of wide.slots) expect(insideCanvas(s.rect)).toBe(true);
    expect(wide.slots).toHaveLength(source.slots.length);
  });

  it('shrinks the type and drops the headline into the centre band', () => {
    const headline = byId(wide, 'headline');
    expect(headline.rect.w).toBeLessThan(byId(source, 'headline').rect.w);
    expect(headline.rect.y + headline.rect.h / 2).toBeCloseTo(0.5, 1);
  });

  it('swaps the Shorts zones back to YouTube', () => {
    expect(wide.safeZones.some((z) => z.id === 'yt-duration-pill')).toBe(true);
    expect(wide.safeZones.some((z) => z.id.startsWith('shorts-'))).toBe(false);
  });
});

describe('adaptLayout — same orientation and edge cases', () => {
  it('squeezes rather than re-arranges within an orientation', () => {
    const source = versusLayout();
    const ultrawide = adaptLayout(source, 21 / 9);
    expect(ultrawide.slots).toHaveLength(source.slots.length);
    for (const s of ultrawide.slots) expect(insideCanvas(s.rect)).toBe(true);

    // subjects stay side by side
    const l = byId(ultrawide, 'left-subject');
    const r = byId(ultrawide, 'right-subject');
    expect(l.rect.x + l.rect.w / 2).toBeLessThan(0.5);
    expect(r.rect.x + r.rect.w / 2).toBeGreaterThan(0.5);
    // and keep their pixel width: 0.46 of 1280 ≈ 0.28 of a 21:9 frame at 720
    const beforePx = byId(source, 'headline').rect.w * (720 * WIDE);
    const afterPx = byId(ultrawide, 'headline').rect.w * (720 * (21 / 9));
    expect(afterPx).toBeCloseTo(beforePx, 0);
  });

  it('is a no-op for a negligible aspect change', () => {
    const source = versusLayout();
    const same = adaptLayout(source, WIDE * 1.005);
    for (const s of same.slots) {
      expect(s.rect).toEqual(byId(source, s.id).rect);
    }
  });

  it('handles single-subject layouts and rejects nonsense aspects', () => {
    const hero: LayoutSpec = {
      id: 'hero',
      name: 'Hero',
      designAspect: WIDE,
      slots: [
        { id: 'hero', kind: 'subject', rect: { x: 0.3, y: 0.05, w: 0.5, h: 0.95 }, anchor: 'bottom-center', z: 10 },
        { id: 'headline', kind: 'text', rect: { x: 0.05, y: 0.6, w: 0.4, h: 0.16 }, anchor: 'center-left', z: 20 },
      ],
      safeZones: [],
      focalPoints: [{ x: 0.55, y: 0.3 }],
    };
    const tall = adaptLayout(hero, TALL);
    expect(tall.slots).toHaveLength(2);
    for (const s of tall.slots) expect(insideCanvas(s.rect)).toBe(true);
    expect(byId(tall, 'hero').rect.y + byId(tall, 'hero').rect.h).toBeCloseTo(1, 5);
    expect(() => adaptLayout(hero, 0)).toThrow(/aspect/);
    expect(() => adaptLayout(hero, Number.NaN)).toThrow();
  });

  it('round-trips wide → tall → wide back to a sane wide layout', () => {
    const source = versusLayout();
    const back = adaptLayout(adaptLayout(source, TALL), WIDE);
    expect(back.slots).toHaveLength(source.slots.length);
    for (const s of back.slots) expect(insideCanvas(s.rect)).toBe(true);
    const l = byId(back, 'left-subject');
    const r = byId(back, 'right-subject');
    expect(l.rect.x + l.rect.w / 2).toBeLessThan(r.rect.x + r.rect.w / 2);
    // headline is legible-sized again, not the 1.5× phone version
    expect(byId(back, 'headline').rect.w).toBeCloseTo(byId(source, 'headline').rect.w, 1);
  });
});
