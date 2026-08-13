import { describe, expect, it } from 'vitest';
import type { LayoutSpec, Slot } from '@hexa/core';
import { resolveLayout } from '../src/index.js';
import { versusLayout } from './fixtures.js';

function bare(slots: Slot[], aspect = 16 / 9): LayoutSpec {
  return { id: 't', name: 't', designAspect: aspect, slots, safeZones: [], focalPoints: [] };
}

describe('resolveLayout', () => {
  it('resolves normalised rects to pixels at 1280×720', () => {
    const r = resolveLayout(versusLayout(), 1280, 720);
    expect(r.canvas).toEqual({ width: 1280, height: 720 });

    const left = r.byId('left-subject');
    expect(left).toBeDefined();
    expect(left!.rect).toEqual({ x: Math.round(0.02 * 1280), y: Math.round(0.1 * 720), w: Math.round(0.46 * 1280), h: Math.round(0.9 * 720) });
    expect(left!.rect).toEqual({ x: 26, y: 72, w: 589, h: 648 });

    const headline = r.byId('headline')!;
    expect(headline.rect).toEqual({ x: 320, y: 29, w: 640, h: 101 });
  });

  it('resolves the same spec to 1080×1920 without touching the source', () => {
    const spec = versusLayout();
    const before = JSON.stringify(spec);
    const r = resolveLayout(spec, 1080, 1920);
    expect(r.canvas).toEqual({ width: 1080, height: 1920 });
    expect(r.byId('left-subject')!.rect).toEqual({ x: 22, y: 192, w: 497, h: 1728 });
    expect(r.byId('vs')!.rect).toEqual({ x: 486, y: 806, w: 108, h: 307 });
    expect(JSON.stringify(spec)).toBe(before);
  });

  it('sorts slots into paint order and indexes them by id', () => {
    const r = resolveLayout(versusLayout(), 1280, 720);
    const zs = r.slots.map((s) => s.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(r.slots[0]!.slot.id).toBe('bg');
    expect(r.slots.at(-1)!.slot.id).toBe('vs');
    expect(r.byId('nope')).toBeUndefined();
    expect(r.slots).toHaveLength(versusLayout().slots.length);
  });

  it('scales a slot about its anchor', () => {
    const spec = bare([
      { id: 'a', kind: 'logo', rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, anchor: 'bottom-right', z: 1, scale: 0.5 },
      { id: 'b', kind: 'logo', rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, anchor: 'top-left', z: 1, scale: 0.5 },
      { id: 'c', kind: 'logo', rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, anchor: 'center', z: 1, scale: 0.5 },
    ]);
    const r = resolveLayout(spec, 1000, 500);
    // box is 500×250; half of it is 250×125
    expect(r.byId('a')!.rect).toEqual({ x: 250, y: 125, w: 250, h: 125 });
    expect(r.byId('b')!.rect).toEqual({ x: 0, y: 0, w: 250, h: 125 });
    expect(r.byId('c')!.rect).toEqual({ x: 125, y: 63, w: 250, h: 125 });
  });

  it('honours constraints.clampToCanvas', () => {
    const spec = bare([
      { id: 'bleed', kind: 'text', rect: { x: 0.9, y: -0.1, w: 0.3, h: 0.3 }, anchor: 'center', z: 1 },
      {
        id: 'clamped',
        kind: 'text',
        rect: { x: 0.9, y: -0.1, w: 0.3, h: 0.3 },
        anchor: 'center',
        z: 2,
        constraints: { clampToCanvas: true },
      },
    ]);
    const r = resolveLayout(spec, 1000, 1000);
    expect(r.byId('bleed')!.rect).toEqual({ x: 900, y: -100, w: 300, h: 300 });
    expect(r.byId('clamped')!.rect).toEqual({ x: 700, y: 0, w: 300, h: 300 });
  });

  it('resolves safe zones alongside the slots', () => {
    const r = resolveLayout(versusLayout(), 1280, 720);
    const pill = r.safeZones.find((z) => z.zone.id === 'yt-duration-pill');
    expect(pill).toBeDefined();
    expect(pill!.rect).toEqual({ x: 1024, y: 605, w: 243, h: 94 });
    expect(pill!.zone.severity).toBe('hard');
  });

  it('rejects duplicate slot ids and degenerate canvases', () => {
    const dupe = bare([
      { id: 'x', kind: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'center', z: 1 },
      { id: 'x', kind: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'center', z: 2 },
    ]);
    expect(() => resolveLayout(dupe, 100, 100)).toThrow(/duplicate slot id/);
    expect(() => resolveLayout(versusLayout(), 0, 720)).toThrow(/positive canvas/);
  });
});
