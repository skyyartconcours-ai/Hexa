/**
 * Tests for the pure half of the compiler — the parts that decide *which*
 * subject goes in which slot, what a text slot says, and where a face ended up.
 * A mistake in any of these is a silent one: the render succeeds and shows the
 * wrong player, the wrong name, or verifies the wrong region.
 */

import { describe, expect, it } from 'vitest';
import type { FaceBox, PixelRect, RenderPlan, Slot, TextSlotSpec } from '@hexa/core';
import type { ResolvedSlot } from '../adapters/contracts.js';
import { makeSubject } from '../test-fixtures.js';
import { arrangeTextRect, assignSubjects, backdropColorBehind, collectBuffers, projectFaceRect, resolveCopy } from './compile.js';

const CANVAS = { width: 1280, height: 720 };

function slot(over: Partial<Slot> & { id: string }): ResolvedSlot {
  const s: Slot = { kind: 'subject', rect: { x: 0, y: 0, w: 0.5, h: 1 }, anchor: 'center', z: 1, ...over };
  return { slot: s, rect: { x: 0, y: 0, w: 640, h: 720 } };
}

describe('assignSubjects', () => {
  const left = makeSubject({ index: 0, side: 'left' });
  const right = makeSubject({ index: 1, side: 'right' });

  it('honours an explicit subjectIndex above everything else', () => {
    const slots = [slot({ id: 'a', meta: { subjectIndex: 1 } }), slot({ id: 'b', meta: { subjectIndex: 0 } })];
    const assigned = assignSubjects(slots, [left, right]);
    expect(assigned[0]?.subject?.index).toBe(1);
    expect(assigned[1]?.subject?.index).toBe(0);
  });

  it('matches a declared side', () => {
    const slots = [slot({ id: 'a', meta: { side: 'right' } }), slot({ id: 'b', meta: { side: 'left' } })];
    const assigned = assignSubjects(slots, [left, right]);
    expect(assigned[0]?.subject?.side).toBe('right');
    expect(assigned[1]?.subject?.side).toBe('left');
  });

  it('reads a side out of the slot id when meta is silent', () => {
    const slots = [slot({ id: 'subject-right' }), slot({ id: 'subject-left' })];
    const assigned = assignSubjects(slots, [left, right]);
    expect(assigned[0]?.subject?.side).toBe('right');
    expect(assigned[1]?.subject?.side).toBe('left');
  });

  it('falls back to declaration order', () => {
    const assigned = assignSubjects([slot({ id: 'a' }), slot({ id: 'b' })], [left, right]);
    expect(assigned.map((a) => a.subject?.index)).toEqual([0, 1]);
  });

  it('never assigns one subject to two slots', () => {
    const slots = [slot({ id: 'x-left' }), slot({ id: 'y-left' }), slot({ id: 'z' })];
    const assigned = assignSubjects(slots, [left, right]);
    const used = assigned.map((a) => a.subject?.index).filter((i) => i !== undefined);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves surplus slots empty rather than reusing a subject', () => {
    const assigned = assignSubjects([slot({ id: 'a' }), slot({ id: 'b' })], [left]);
    expect(assigned[0]?.subject).toBeDefined();
    expect(assigned[1]?.subject).toBeUndefined();
  });
});

describe('resolveCopy', () => {
  const subjects = [
    makeSubject({ index: 0, side: 'left' }),
    makeSubject({ index: 1, side: 'right' }),
  ];
  const spec = (over: Partial<TextSlotSpec> = {}): TextSlotSpec => ({ role: 'headline', slotId: 's', required: false, ...over });

  it('prefers what the caller supplied', () => {
    expect(resolveCopy('headline', spec(), { text: { headline: 'RIVALS' }, subjects })).toBe('RIVALS');
  });

  it('falls back to the template default', () => {
    expect(resolveCopy('headline', spec({ defaultText: 'CLASH' }), { text: {}, subjects })).toBe('CLASH');
  });

  it('derives player names from the subjects', () => {
    expect(resolveCopy('left-name', spec({ role: 'left-name' }), { text: {}, subjects })).toBe(subjects[0]!.player.handle);
    expect(resolveCopy('right-name', spec({ role: 'right-name' }), { text: {}, subjects })).toBe(subjects[1]!.player.handle);
  });

  it('derives team tags from the subjects', () => {
    expect(resolveCopy('left-team', spec({ role: 'left-team' }), { text: {}, subjects })).toBe(subjects[0]!.team.tag);
  });

  it('supplies VS only when there are two subjects to be between', () => {
    expect(resolveCopy('vs', spec({ role: 'vs' }), { text: {}, subjects })).toBe('VS');
    expect(resolveCopy('vs', spec({ role: 'vs' }), { text: {}, subjects: [subjects[0]!] })).toBeUndefined();
  });

  it('applies the declared casing transform', () => {
    expect(resolveCopy('headline', spec({ transform: 'upper' }), { text: { headline: 'rivals' }, subjects })).toBe('RIVALS');
    expect(resolveCopy('headline', spec({ transform: 'title' }), { text: { headline: 'the GREATEST upset' }, subjects })).toBe('The Greatest Upset');
  });

  it('truncates past maxChars with an ellipsis rather than overflowing the slot', () => {
    const out = resolveCopy('headline', spec({ maxChars: 8 }), { text: { headline: 'ABSOLUTELY ENORMOUS' }, subjects });
    expect(out).toHaveLength(8);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('returns undefined when there is nothing to say', () => {
    expect(resolveCopy('caption', spec({ role: 'caption' }), { text: {}, subjects })).toBeUndefined();
  });
});

describe('arrangeTextRect', () => {
  const rect: PixelRect = { x: 300, y: 80, w: 600, h: 160 };

  it('leaves the template arrangement alone', () => {
    expect(arrangeTextRect(rect, 'headline', 'template', CANVAS)).toEqual(rect);
  });

  it('never moves position-critical roles', () => {
    // A `left-name` belongs under the player it labels and `vs` belongs between
    // the two — rearranging those is a bug, not a variant.
    for (const role of ['vs', 'left-name', 'right-name', 'left-team', 'right-team'] as const) {
      for (const arrangement of ['stacked', 'offset', 'banner', 'split'] as const) {
        expect(arrangeTextRect(rect, role, arrangement, CANVAS)).toEqual(rect);
      }
    }
  });

  it('actually moves free-floating copy', () => {
    for (const arrangement of ['stacked', 'offset', 'banner', 'split'] as const) {
      expect(arrangeTextRect(rect, 'headline', arrangement, CANVAS)).not.toEqual(rect);
    }
  });

  it('keeps every arrangement inside the canvas', () => {
    const wide: PixelRect = { x: 1100, y: 650, w: 600, h: 200 };
    for (const arrangement of ['stacked', 'offset', 'banner', 'split'] as const) {
      const out = arrangeTextRect(wide, 'headline', arrangement, CANVAS);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.x + out.w).toBeLessThanOrEqual(CANVAS.width);
      expect(out.y + out.h).toBeLessThanOrEqual(CANVAS.height);
    }
  });
});

describe('projectFaceRect', () => {
  const face: FaceBox = { x: 100, y: 50, w: 200, h: 240, confidence: 0.99 };

  it('returns nothing when no face was detected', () => {
    expect(projectFaceRect(undefined, { rect: { x: 0, y: 0, w: 100, h: 100 }, scale: 1 }, false)).toBeUndefined();
  });

  it('scales and offsets into canvas space', () => {
    const out = projectFaceRect(face, { rect: { x: 400, y: 100, w: 600, h: 800 }, scale: 2 }, false);
    expect(out).toEqual({ x: 400 + 200, y: 100 + 100, w: 400, h: 480 });
  });

  it('accounts for a source crop', () => {
    const out = projectFaceRect(face, { rect: { x: 0, y: 0, w: 600, h: 800 }, scale: 1, crop: { x: 50, y: 20, w: 500, h: 700 } }, false);
    expect(out).toEqual({ x: 50, y: 30, w: 200, h: 240 });
  });

  it('mirrors within the destination rect when the subject is flipped', () => {
    const dest = { x: 0, y: 0, w: 600, h: 800 };
    const unflipped = projectFaceRect(face, { rect: dest, scale: 1 }, false)!;
    const flipped = projectFaceRect(face, { rect: dest, scale: 1 }, true)!;
    // Mirroring is its own inverse: the two rects reflect about the centre line.
    expect(flipped.x + flipped.w).toBe(dest.w - unflipped.x);
    expect(flipped.y).toBe(unflipped.y);
    expect(flipped.w).toBe(unflipped.w);
  });

  it('stays inside the destination rect for a face at the far edge', () => {
    const dest = { x: 100, y: 0, w: 400, h: 800 };
    const edge: FaceBox = { x: 300, y: 0, w: 100, h: 100, confidence: 1 };
    const out = projectFaceRect(edge, { rect: dest, scale: 1 }, true)!;
    expect(out.x).toBeGreaterThanOrEqual(dest.x);
    expect(out.x + out.w).toBeLessThanOrEqual(dest.x + dest.w);
  });
});

describe('collectBuffers', () => {
  const subjects = [makeSubject({ index: 0, side: 'left', cutout: Buffer.from('left') })];
  const plan = {
    meta: {
      buffers: [
        { key: 'subject:0', kind: 'subject', ref: '0' },
        { key: 'backplate', kind: 'backplate', ref: 'backplate' },
      ],
    },
  } as unknown as RenderPlan;

  it('resolves subject and backplate keys', () => {
    const buffers = collectBuffers(plan, { subjects, backplate: Buffer.from('bg') });
    expect(buffers['subject:0']?.toString()).toBe('left');
    expect(buffers['backplate']?.toString()).toBe('bg');
  });

  it('omits keys with nothing behind them rather than inventing empty buffers', () => {
    const buffers = collectBuffers(plan, { subjects });
    expect(buffers['backplate']).toBeUndefined();
    expect(Object.keys(buffers)).toEqual(['subject:0']);
  });

  it('tolerates a plan with no buffer refs', () => {
    expect(collectBuffers({ meta: {} } as unknown as RenderPlan, { subjects })).toEqual({});
  });
});

describe('backdropColorBehind', () => {
  const palette = { left: '#c8102e', right: '#1b3fc8', accent: '#f5c542', dark: '#0b0b0f', light: '#f5f7fa' };

  it('leans toward the team whose half the text sits in', () => {
    const onLeft = backdropColorBehind({ x: 0, y: 200, w: 200, h: 100 }, palette, CANVAS);
    const onRight = backdropColorBehind({ x: 1080, y: 200, w: 200, h: 100 }, palette, CANVAS);
    expect(onLeft).not.toBe(onRight);
  });

  it('darkens toward the floor, where the backdrop falloff sits', () => {
    const high = backdropColorBehind({ x: 500, y: 40, w: 200, h: 100 }, palette, CANVAS);
    const low = backdropColorBehind({ x: 500, y: 620, w: 200, h: 100 }, palette, CANVAS);
    expect(high).not.toBe(low);
  });

  it('always returns a parseable hex', () => {
    expect(backdropColorBehind({ x: 0, y: 0, w: 1, h: 1 }, palette, CANVAS)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
