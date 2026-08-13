import { describe, expect, it } from 'vitest';
import type { Slot } from '@hexa/core';
import { overlapRatio } from '@hexa/core';

import {
  KIND_BANDS,
  TEMPLATES,
  Z,
  facePoint,
  listTemplates,
  resolveLayout,
  resolveStyle,
  sampleContext,
  validateTemplate,
} from '../index.js';

const DURATION_PILL = { x: 0.8, y: 0.84, w: 0.2, h: 0.16 };

describe('integrity', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s validates clean', (_id, t) => {
    expect(validateTemplate(t)).toEqual([]);
  });

  it('the whole library is clean', () => {
    const problems = TEMPLATES.flatMap((t) => validateTemplate(t));
    expect(problems).toEqual([]);
  });
});

describe('validateTemplate catches real defects', () => {
  const base = () => {
    const t = TEMPLATES.find((x) => x.id === 'versus-classic')!;
    return JSON.parse(JSON.stringify({ ...t, layout: resolveLayout(t, sampleContext(2, 'youtube')), style: resolveStyle(t, sampleContext(2, 'youtube')) })) as typeof t;
  };

  it('is happy with the untouched clone', () => {
    expect(validateTemplate(base())).toEqual([]);
  });

  it('flags duplicate slot ids', () => {
    const t = base();
    const layout = t.layout as { slots: Slot[] };
    layout.slots.push({ ...layout.slots[0]!, z: 42 });
    expect(validateTemplate(t).join(' ')).toContain('duplicate slot id');
  });

  it('flags a text slot that bleeds off canvas', () => {
    const t = base();
    const layout = t.layout as { slots: Slot[] };
    const headline = layout.slots.find((s) => s.id === 'left-name')!;
    headline.rect.x = -0.1;
    expect(validateTemplate(t).join(' ')).toMatch(/escapes its allowed range|leaves the canvas/);
  });

  it('accepts deliberate subject bleed', () => {
    const t = base();
    const layout = t.layout as { slots: Slot[] };
    const subject = layout.slots.find((s) => s.id === 'subject-left')!;
    subject.rect.x = -0.12;
    expect(validateTemplate(t)).toEqual([]);
  });

  it('flags copy parked under the duration pill', () => {
    const t = base();
    const layout = t.layout as { slots: Slot[] };
    layout.slots.find((s) => s.id === 'right-name')!.rect = { x: 0.62, y: 0.86, w: 0.33, h: 0.1 };
    expect(validateTemplate(t).join(' ')).toContain('duration-pill');
  });

  it('flags overlapping copy', () => {
    const t = base();
    const layout = t.layout as { slots: Slot[] };
    const left = layout.slots.find((s) => s.id === 'left-name')!;
    layout.slots.find((s) => s.id === 'left-team')!.rect = { ...left.rect };
    expect(validateTemplate(t).join(' ')).toContain('overlap');
  });

  it('flags copy printed over a face', () => {
    const t = base();
    const layout = t.layout as { slots: Slot[] };
    layout.slots.find((s) => s.id === 'kicker')!.rect = { x: 0.2, y: 0.28, w: 0.3, h: 0.12 };
    expect(validateTemplate(t).join(' ')).toContain('sits on the face');
  });

  it('flags a missing text slot binding', () => {
    const t = base();
    t.textSlots = [...t.textSlots, { role: 'stat', slotId: 'does-not-exist', required: false }];
    expect(validateTemplate(t).join(' ')).toContain('missing slot');
  });

  it('flags a template with no required copy', () => {
    const t = base();
    t.textSlots = t.textSlots.map((s) => ({ ...s, required: false }));
    expect(validateTemplate(t).join(' ')).toContain('no required text slot');
  });

  it('flags an unknown LUT', () => {
    const t = base();
    (t.style as { grade: { lut?: string } }).grade.lut = 'instagram-1977';
    expect(validateTemplate(t).join(' ')).toContain('unknown LUT');
  });

  it('flags a broken paint-order band', () => {
    const t = base();
    const layout = t.layout as { slots: Slot[] };
    layout.slots.find((s) => s.id === 'subject-left')!.z = Z.text + 5;
    expect(validateTemplate(t).join(' ')).toMatch(/allowed band|share z/);
  });

  it('flags an empty aspect list', () => {
    const t = base();
    t.aspects = [];
    expect(validateTemplate(t).join(' ')).toContain('aspects[] is empty');
  });

  it('flags focal points outside the canvas', () => {
    const t = base();
    (t.layout as { focalPoints: { x: number; y: number }[] }).focalPoints[0] = { x: 1.4, y: 0.3 };
    expect(validateTemplate(t).join(' ')).toContain('outside the canvas');
  });

  it('flags a subject count outside the declared bounds', () => {
    const t = base();
    t.subjects = { min: 3, max: 4 };
    expect(validateTemplate(t).join(' ')).toContain('outside the declared bounds');
  });
});

describe('versus composition rules', () => {
  const versus = listTemplates({ category: 'versus' });

  it('has all six signature layouts', () => {
    expect(versus.length).toBeGreaterThanOrEqual(6);
  });

  it.each(versus.map((t) => [t.id, t] as const))('%s puts exactly two subjects facing inward', (_id, t) => {
    expect(t.subjects).toEqual({ min: 2, max: 2 });
    const layout = resolveLayout(t, sampleContext(2, 'youtube'));
    const subjects = layout.slots.filter((s) => s.kind === 'subject');
    expect(subjects).toHaveLength(2);

    const sorted = [...subjects].sort((a, b) => facePoint(a).x - facePoint(b).x);
    const [left, right] = sorted as [Slot, Slot];
    expect(left.meta?.preferFacing, `${t.id} left slot`).toBe('right');
    expect(right.meta?.preferFacing, `${t.id} right slot`).toBe('left');

    // Faces on opposite sides of the centre line…
    expect(facePoint(left).x).toBeLessThan(0.5);
    expect(facePoint(right).x).toBeGreaterThan(0.5);
    // …near the thirds, with the eyeline high in frame.
    for (const slot of sorted) {
      const p = facePoint(slot);
      expect(Math.min(Math.abs(p.x - 1 / 3), Math.abs(p.x - 2 / 3), Math.abs(p.x - 0.382), Math.abs(p.x - 0.618)))
        .toBeLessThan(0.08);
      expect(p.y).toBeGreaterThan(0.2);
      expect(p.y).toBeLessThan(0.45);
      const faceHeight = slot.meta?.faceHeight as number | undefined;
      expect(faceHeight, `${t.id} ${slot.id} faceHeight`).toBeGreaterThanOrEqual(0.14);
      expect(faceHeight).toBeLessThanOrEqual(0.3);
    }
  });

  it.each(versus.map((t) => [t.id, t] as const))('%s carries a VS mark and both nameplates', (_id, t) => {
    const roles = t.textSlots.map((s) => s.role);
    expect(roles).toContain('vs');
    expect(roles).toContain('left-name');
    expect(roles).toContain('right-name');
    const named = t.textSlots.filter((s) => s.role === 'left-name' || s.role === 'right-name');
    expect(named.every((s) => s.required)).toBe(true);
  });
});

describe('house rules across the whole library', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s keeps copy out of the duration pill', (_id, t) => {
    if (!t.aspects.some((a) => a !== 'shorts')) return;
    const layout = resolveLayout(t, sampleContext(t.subjects.min, t.aspects[0]!));
    const copy = layout.slots.filter((s) => s.kind === 'text' || s.kind === 'badge');
    for (const slot of copy) {
      expect(overlapRatio(slot.rect, DURATION_PILL), `${t.id}/${slot.id}`).toBeLessThanOrEqual(0.02);
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s paints back-to-front in band order', (_id, t) => {
    const layout = resolveLayout(t, sampleContext(t.subjects.min, t.aspects[0]!));
    const zOf = (kind: Slot['kind']) => layout.slots.filter((s) => s.kind === kind).map((s) => s.z);
    const plates = zOf('backplate');
    const subjects = zOf('subject');
    const shapes = zOf('shape');
    const texts = zOf('text');
    if (plates.length && subjects.length) expect(Math.max(...plates)).toBeLessThan(Math.min(...subjects));
    if (subjects.length && shapes.length) expect(Math.max(...subjects)).toBeLessThan(Math.min(...shapes));
    if (shapes.length && texts.length) expect(Math.max(...shapes)).toBeLessThan(Math.min(...texts));
    for (const slot of layout.slots) {
      const bands = KIND_BANDS[slot.kind];
      expect(bands.some((b) => slot.z >= b && slot.z < b + 100), `${t.id}/${slot.id}`).toBe(true);
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s declares a backplate and a focal hierarchy', (_id, t) => {
    const layout = resolveLayout(t, sampleContext(t.subjects.min, t.aspects[0]!));
    expect(layout.slots.some((s) => s.kind === 'backplate')).toBe(true);
    expect(layout.focalPoints.length).toBeGreaterThanOrEqual(2);
    expect(layout.safeZones.length).toBeGreaterThanOrEqual(1);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s grades with real values', (_id, t) => {
    const style = resolveStyle(t, sampleContext(t.subjects.min, t.aspects[0]!));
    expect(style.grade.lut).toBeDefined();
    expect(style.grade.vignette).toBeGreaterThan(0);
    expect(style.grade.contrast).toBeGreaterThan(1);
    expect(style.lightRig).toBeTruthy();
  });

  it('varies light rigs and LUTs across the library', () => {
    const rigs = new Set<string>();
    const luts = new Set<string>();
    const backdrops = new Set<string>();
    for (const t of TEMPLATES) {
      const style = resolveStyle(t, sampleContext(t.subjects.min, t.aspects[0]!));
      rigs.add(style.lightRig);
      if (style.grade.lut) luts.add(style.grade.lut);
      if (style.backdrop) backdrops.add(style.backdrop);
    }
    expect(rigs.size).toBeGreaterThanOrEqual(7);
    expect(luts.size).toBe(6);
    expect(backdrops.size).toBeGreaterThanOrEqual(6);
  });

  it('vertical templates design against 9:16 and honour the Shorts UI', () => {
    for (const t of listTemplates({ aspect: 'shorts' })) {
      const layout = resolveLayout(t, sampleContext(t.subjects.min, 'shorts'));
      expect(layout.designAspect).toBeCloseTo(9 / 16, 3);
      const ids = layout.safeZones.map((z) => z.id);
      expect(ids).toContain('shorts-caption');
      expect(ids).toContain('shorts-action-rail');
    }
  });

  it('wide templates design against 16:9', () => {
    for (const t of TEMPLATES) {
      if (t.aspects.includes('shorts')) continue;
      const layout = resolveLayout(t, sampleContext(t.subjects.min, t.aspects[0]!));
      expect(layout.designAspect, t.id).toBeCloseTo(16 / 9, 3);
    }
  });

  it('every slot rect is expressed in normalised units', () => {
    for (const t of TEMPLATES) {
      const layout = resolveLayout(t, sampleContext(t.subjects.max, t.aspects[0]!));
      for (const slot of layout.slots) {
        expect(slot.rect.w, `${t.id}/${slot.id}`).toBeLessThanOrEqual(1.3);
        expect(slot.rect.h, `${t.id}/${slot.id}`).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('adaptive templates hold together across their whole subject range', () => {
    const adaptive = TEMPLATES.filter((t) => typeof t.layout === 'function' && t.subjects.max > t.subjects.min);
    expect(adaptive.length).toBeGreaterThanOrEqual(5);
    for (const t of adaptive) {
      for (let n = t.subjects.min; n <= t.subjects.max; n++) {
        const layout = resolveLayout(t, sampleContext(n, t.aspects[0]!));
        expect(layout.slots.filter((s) => s.kind === 'subject'), `${t.id} @ ${n}`).toHaveLength(n);
        expect(new Set(layout.slots.map((s) => s.id)).size).toBe(layout.slots.length);
      }
    }
  });
});
