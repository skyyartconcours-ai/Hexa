import { describe, expect, it } from 'vitest';
import type { LayoutSpec, Slot } from '@hexa/core';
import {
  COMPOSITION_WEIGHTS,
  checkSafeZones,
  resolveLayout,
  resolveOverlaps,
  scoreComposition,
  type ScoredFace,
} from '../src/index.js';
import { rect, versusLayout } from './fixtures.js';

const W = 1280;
const H = 720;

/** Textbook versus: faces on the thirds, well sized, looking at each other. */
function goodFaces(): ScoredFace[] {
  return [
    { slotId: 'left-subject', rect: rect(300, 140, 150, 190), facing: 'right' },
    { slotId: 'right-subject', rect: rect(830, 140, 150, 190), facing: 'left' },
  ];
}

/** Everything wrong: tiny faces, stacked dead centre, both looking outward. */
function badFaces(): ScoredFace[] {
  return [
    { slotId: 'left-subject', rect: rect(575, 330, 34, 40), facing: 'left' },
    { slotId: 'right-subject', rect: rect(640, 330, 34, 40), facing: 'right' },
  ];
}

describe('scoreComposition', () => {
  it('ranks a known-good versus far above a known-bad one', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const good = scoreComposition({
      layout,
      faces: goodFaces(),
      textRects: [{ slotId: 'headline', rect: rect(380, 30, 520, 80) }],
    });
    const bad = scoreComposition({
      layout,
      faces: badFaces(),
      textRects: [{ slotId: 'headline', rect: rect(560, 300, 520, 90) }],
    });

    expect(good.total).toBeGreaterThan(80);
    expect(bad.total).toBeLessThan(50);
    expect(good.total - bad.total).toBeGreaterThan(30);
    expect(Object.keys(COMPOSITION_WEIGHTS).reduce((a, k) => a + COMPOSITION_WEIGHTS[k]!, 0)).toBe(100);
    for (const key of Object.keys(COMPOSITION_WEIGHTS)) {
      expect(good.parts[key]).toBeGreaterThanOrEqual(0);
      expect(good.parts[key]).toBeLessThanOrEqual(1);
    }
    expect(good.findings.filter((f) => f.severity === 'fail')).toHaveLength(0);
  });

  it('fails tiny faces with an actionable finding', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const s = scoreComposition({ layout, faces: [{ slotId: 'left-subject', rect: rect(400, 200, 40, 50) }] });
    expect(s.parts['faceSize']).toBeLessThan(0.3);
    const f = s.findings.find((x) => x.gate === 'composition.faceSize');
    expect(f?.severity).toBe('fail');
    expect(f?.suggestion).toMatch(/bust|faceHeightRatio|canvas height/i);
    expect(f?.where).toBeDefined();
  });

  it('penalises two faces stacked on the centre line of a wide canvas', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const spread = scoreComposition({ layout, faces: goodFaces() }).parts['facePlacement']!;
    const stacked = scoreComposition({
      layout,
      faces: [
        { slotId: 'left-subject', rect: rect(560, 140, 150, 190) },
        { slotId: 'right-subject', rect: rect(600, 140, 150, 190) },
      ],
    }).parts['facePlacement']!;
    expect(stacked).toBeLessThan(spread * 0.6);
  });

  it('penalises subjects looking out of frame and suggests the mirror', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const inward = scoreComposition({ layout, faces: goodFaces() });
    const outward = scoreComposition({
      layout,
      faces: [
        { slotId: 'left-subject', rect: rect(300, 140, 150, 190), facing: 'left' },
        { slotId: 'right-subject', rect: rect(830, 140, 150, 190), facing: 'right' },
      ],
    });
    expect(inward.parts['facing']).toBe(1);
    expect(outward.parts['facing']).toBeLessThan(0.1);
    const finding = outward.findings.find((f) => f.gate === 'composition.facing');
    expect(finding?.severity).toBe('fail');
    expect(finding?.suggestion).toMatch(/flipX/);
    // The rule is worth real points.
    expect(inward.total - outward.total).toBeGreaterThan(COMPOSITION_WEIGHTS['facing']! * 0.7);
  });

  it('judges "inward" against the opponent, not just the canvas centre', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    // Both faces sit near the centre line but still face away from each other.
    const s = scoreComposition({
      layout,
      faces: [
        { slotId: 'left-subject', rect: rect(540, 200, 70, 90), facing: 'left' },
        { slotId: 'right-subject', rect: rect(660, 200, 70, 90), facing: 'right' },
      ],
    });
    expect(s.parts['facing']).toBeLessThan(0.15);
    expect(s.findings.filter((f) => f.gate === 'composition.facing').length).toBeGreaterThanOrEqual(2);
  });

  it('does not average away a single subject facing outward', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const one = scoreComposition({
      layout,
      faces: [
        { slotId: 'left-subject', rect: rect(300, 140, 150, 190), facing: 'left' },
        { slotId: 'right-subject', rect: rect(830, 140, 150, 190), facing: 'left' },
      ],
    });
    expect(one.parts['facing']).toBeLessThan(0.4);
    expect(one.findings.some((f) => f.gate === 'composition.facing' && f.subjectId === undefined)).toBe(true);
  });

  it('flags a cropped crown and a floating head', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const cropped = scoreComposition({ layout, faces: [{ slotId: 'left-subject', rect: rect(300, 0, 150, 190) }] });
    expect(cropped.parts['headroom']).toBe(0);
    expect(cropped.findings.some((f) => f.gate === 'composition.headroom' && f.severity === 'fail')).toBe(true);

    const floating = scoreComposition({ layout, faces: [{ slotId: 'left-subject', rect: rect(300, 480, 100, 130) }] });
    expect(floating.parts['headroom']).toBeLessThan(0.6);
    expect(floating.findings.some((f) => /floats/.test(f.message))).toBe(true);
  });

  it('penalises overlapping faces and text over a face', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const merged = scoreComposition({
      layout,
      faces: [
        { slotId: 'left-subject', rect: rect(300, 140, 150, 190) },
        { slotId: 'right-subject', rect: rect(380, 140, 150, 190) },
      ],
    });
    expect(merged.parts['separation']).toBeLessThan(0.6);
    expect(merged.findings.some((f) => f.gate === 'composition.separation')).toBe(true);

    const covered = scoreComposition({
      layout,
      faces: goodFaces(),
      textRects: [{ slotId: 'headline', rect: rect(280, 150, 400, 160) }],
    });
    expect(covered.parts['separation']).toBeLessThan(0.6);
    expect(covered.parts['textFit']).toBeLessThan(0.7);
  });

  it('penalises text that leaves the canvas', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const s = scoreComposition({
      layout,
      faces: goodFaces(),
      textRects: [{ slotId: 'headline', rect: rect(1000, 30, 600, 80) }],
    });
    expect(s.parts['textFit']).toBeLessThan(0.6);
    expect(s.findings.some((f) => f.gate === 'composition.textFit' && /off the canvas/.test(f.message))).toBe(true);
  });

  it('relaxes the balance rule when the layout declares the asymmetry', () => {
    const heroSlots: Slot[] = [
      { id: 'bg', kind: 'backplate', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'center', z: 0 },
      { id: 'hero', kind: 'subject', rect: { x: 0.52, y: 0.05, w: 0.48, h: 0.95 }, anchor: 'bottom-right', z: 10 },
      { id: 'headline', kind: 'text', rect: { x: 0.04, y: 0.3, w: 0.4, h: 0.2 }, anchor: 'center-left', z: 20 },
    ];
    const base: LayoutSpec = {
      id: 'hero',
      name: 'Hero',
      designAspect: 16 / 9,
      slots: heroSlots,
      safeZones: [],
      focalPoints: [{ x: 0.72, y: 0.35 }],
    };
    const faces: ScoredFace[] = [{ slotId: 'hero', rect: rect(830, 120, 220, 260), facing: 'left' }];
    const strict = scoreComposition({ layout: resolveLayout(base, W, H), faces });

    const declared: LayoutSpec = {
      ...base,
      slots: heroSlots.map((s) => (s.id === 'hero' ? { ...s, meta: { intentionalAsymmetry: true } } : s)),
    };
    const relaxed = scoreComposition({ layout: resolveLayout(declared, W, H), faces });

    expect(strict.parts['balance']).toBeLessThan(0.8);
    expect(relaxed.parts['balance']).toBeGreaterThanOrEqual(0.85);
    expect(relaxed.findings.some((f) => f.gate === 'composition.balance')).toBe(false);
  });

  it('checks focal points actually carry content', () => {
    const spec = versusLayout();
    // Dead space between the two subject slots, below the VS badge.
    spec.focalPoints = [{ x: 0.5, y: 0.96 }];
    const s = scoreComposition({ layout: resolveLayout(spec, W, H), faces: goodFaces() });
    expect(s.findings.some((f) => f.gate === 'composition.hierarchy' && /no content near it/.test(f.message))).toBe(true);
    expect(s.parts['hierarchy']).toBeLessThan(0.8);
  });

  it('scores neutrally instead of punishing missing data', () => {
    const s = scoreComposition({ layout: resolveLayout(versusLayout(), W, H), faces: [] });
    expect(s.parts['faceSize']).toBe(1);
    expect(s.parts['facing']).toBe(1);
    expect(s.parts['separation']).toBe(1);
    expect(s.total).toBeGreaterThan(80);
  });
});

describe('checkSafeZones', () => {
  it('fails a badge parked under the YouTube duration pill', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const findings = checkSafeZones(layout, [{ id: 'stat-badge', rect: rect(1050, 620, 180, 60) }]);
    const pill = findings.find((f) => f.message.includes('yt-duration-pill'));
    expect(pill).toBeDefined();
    expect(pill!.severity).toBe('fail');
    expect(pill!.suggestion).toMatch(/Move "stat-badge" ~\d+px (left|right|up|down)/);
    expect(pill!.where).toBeDefined();
  });

  it('warns on soft zones and stays quiet on clean layouts', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const hover = checkSafeZones(layout, [{ id: 'logo', rect: rect(1000, 10, 200, 120) }]);
    expect(hover.some((f) => f.message.includes('yt-hover-controls') && f.severity === 'warn')).toBe(true);
    expect(checkSafeZones(layout, [{ id: 'headline', rect: rect(320, 120, 640, 200) }])).toHaveLength(0);
  });

  it('detects the Shorts action rail on a vertical canvas', () => {
    const spec = versusLayout();
    spec.safeZones = resolveLayout(spec, 1080, 1920).spec.safeZones;
    const vertical = resolveLayout({ ...spec, safeZones: [...spec.safeZones] }, 1080, 1920);
    const withShorts = resolveLayout(
      { ...spec, safeZones: [{ id: 'shorts-action-rail', rect: { x: 0.82, y: 0.35, w: 0.18, h: 0.6 }, severity: 'hard', reason: 'test' }] },
      1080,
      1920,
    );
    expect(vertical.canvas.height).toBe(1920);
    const findings = checkSafeZones(withShorts, [{ id: 'right-name', rect: rect(900, 900, 170, 120) }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('fail');
  });
});

describe('resolveOverlaps', () => {
  it('separates colliding text without moving subjects', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const slots = layout.slots.map((s) =>
      s.slot.id === 'right-name' ? { ...s, rect: { ...layout.byId('left-name')!.rect } } : s,
    );
    const before = slots.map((s) => ({ id: s.slot.id, rect: { ...s.rect } }));
    const { slots: after, moved } = resolveOverlaps(slots, { width: W, height: H });

    expect(moved).toContain('right-name');
    expect(moved).not.toContain('left-subject');
    expect(moved).not.toContain('right-subject');
    expect(moved).not.toContain('bg');

    const l = after.find((s) => s.slot.id === 'left-name')!;
    const r = after.find((s) => s.slot.id === 'right-name')!;
    const overlapW = Math.min(l.rect.x + l.rect.w, r.rect.x + r.rect.w) - Math.max(l.rect.x, r.rect.x);
    const overlapH = Math.min(l.rect.y + l.rect.h, r.rect.y + r.rect.h) - Math.max(l.rect.y, r.rect.y);
    expect(overlapW <= 0 || overlapH <= 0).toBe(true);

    // input array untouched
    for (const b of before) {
      const now = slots.find((s) => s.slot.id === b.id)!;
      expect(now.rect).toEqual(b.rect);
    }
  });

  it('leaves text over a subject alone unless the slot fences it off', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const overSubject = layout.slots.map((s) =>
      s.slot.id === 'left-name' ? { ...s, rect: { x: 120, y: 300, w: 300, h: 90 } } : s,
    );
    expect(resolveOverlaps(overSubject, { width: W, height: H }).moved).not.toContain('left-name');

    const fenced = overSubject.map((s) =>
      s.slot.id === 'left-name'
        ? { ...s, slot: { ...s.slot, constraints: { noOverlapWith: ['left-subject'] } } }
        : s,
    );
    const res = resolveOverlaps(fenced, { width: W, height: H });
    expect(res.moved).toContain('left-name');
    expect(res.slots.find((s) => s.slot.id === 'left-subject')!.rect).toEqual(layout.byId('left-subject')!.rect);
  });

  it('keeps everything inside the canvas', () => {
    const layout = resolveLayout(versusLayout(), W, H);
    const piled = layout.slots.map((s) =>
      s.slot.kind === 'text' || s.slot.kind === 'badge' ? { ...s, rect: { x: 1200, y: 660, w: 200, h: 90 } } : s,
    );
    const { slots } = resolveOverlaps(piled, { width: W, height: H });
    for (const s of slots) {
      if (s.slot.kind !== 'text' && s.slot.kind !== 'badge') continue;
      expect(s.rect.x).toBeGreaterThanOrEqual(0);
      expect(s.rect.y).toBeGreaterThanOrEqual(0);
      expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(W);
      expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(H);
    }
  });
});
