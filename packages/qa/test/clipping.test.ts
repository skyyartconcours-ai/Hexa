/**
 * Clipping gate: it must fire on a sliced glyph and stay silent on type that
 * merely sits close to its box. Both halves are load-bearing — a clipping
 * detector that also flags right-aligned type would be turned off within a day.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { clippingGate } from '../src/gates/clipping.js';
import { ctx, flatBackground, planWithText, textInBox, W } from './helpers.js';

const HEAD = { x: 120, y: 300, w: 700, h: 120 };

function scene(image: Buffer, rect = HEAD, role = 'headline', text = 'GRAND FINAL') {
  return ctx(image, {
    plan: planWithText([{ role, rect, color: '#FFFFFF', text }]),
    textRects: [{ role, rect }],
  });
}

const fails = (f: { severity: string }[]) => f.filter((x) => x.severity === 'fail');

describe('clippingGate', () => {
  it('fails a headline sliced by the edge of its own layer rect', async () => {
    const image = await textInBox(await flatBackground('#0B0B0F'), {
      text: 'CHAMPIONSHIP FINAL', // wider than the 700px box, so the viewport cuts it
      rect: HEAD,
      inset: 12,
    });
    const findings = await clippingGate.run(scene(image, HEAD, 'headline', 'CHAMPIONSHIP FINAL'));

    const fail = fails(findings)[0];
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/clipped by its own layer rect on the right/);
    expect(fail!.message).toMatch(/CHAMPIONSHIP FINAL/);
    expect(fail!.suggestion).toMatch(/auto-fit|viewBox/);
    expect(fail!.score!).toBeLessThan(0.2);
  });

  it('does NOT fire on the same headline that fits its box', async () => {
    const image = await textInBox(await flatBackground('#0B0B0F'), { text: 'GRAND FINAL', rect: HEAD, inset: 12 });
    const findings = await clippingGate.run(scene(image));
    expect(fails(findings)).toEqual([]);
    expect(findings.some((f) => f.severity === 'pass' && /sits clear of its rect/.test(f.message))).toBe(true);
  });

  it('does NOT fire on right-aligned type sitting flush against its box', async () => {
    // The near miss that decides whether this gate is usable: complete glyphs,
    // ending on the boundary, because the slot is right-anchored.
    const image = await textInBox(await flatBackground('#0B0B0F'), { text: 'VIPER', rect: HEAD, anchor: 'end' });
    const findings = await clippingGate.run(scene(image, HEAD, 'headline', 'VIPER'));
    expect(fails(findings)).toEqual([]);
  });

  it('fails type running off the canvas edge, and says so', async () => {
    const rect = { x: 900, y: 300, w: W - 900, h: 120 };
    const image = await textInBox(await flatBackground('#0B0B0F'), { text: 'VIPER WINS', rect, inset: 12 });
    const findings = await clippingGate.run(scene(image, rect, 'headline', 'VIPER WINS'));

    const fail = fails(findings)[0];
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/cut off by the right edge of the canvas/);
  });

  it('fails a rect laid out partly outside the canvas without needing pixels', async () => {
    const rect = { x: 1100, y: 300, w: 400, h: 120 };
    const findings = await clippingGate.run(scene(await flatBackground('#0B0B0F'), rect, 'headline', 'OVERHANG'));
    const fail = fails(findings)[0];
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/laid out partly off-canvas/);
  });

  it('reports "not checked" rather than a verdict when ink cannot be separated', async () => {
    // A rect filled edge to edge with the declared colour: a glow, not type.
    const image = await textInBox(await flatBackground('#0B0B0F'), {
      text: '████████████', rect: HEAD, fontSize: 200, inset: 0,
    });
    const findings = await clippingGate.run(scene(image, HEAD, 'headline', 'GLOW'));
    expect(fails(findings)).toEqual([]);
    expect(findings.some((f) => f.severity === 'warn' && /NOT checked for clipping/.test(f.message))).toBe(true);
  });

  it('does NOT fire when the plan declares a text colour the compositor never painted', async () => {
    // Straight from the sample render: the versus template records
    // right-team.color = "#0e0d0d" for a badge whose glyphs are painted cream,
    // so the "declared" mask lands on the dark backdrop filling the right half
    // of the rect. That slab touches the boundary at 100%, and the gate used to
    // report an intact badge as a sliced glyph.
    const rect = { x: 916, y: 432, w: 333, h: 45 };
    const base = await flatBackground('#0e0d0d');
    const badge = await sharp({ create: { width: 150, height: 45, channels: 3, background: '#F3721F' } }).png().toBuffer();
    const withBadge = await sharp(base).composite([{ input: badge, left: rect.x, top: rect.y }]).png().toBuffer();
    const image = await textInBox(withBadge, { text: 'HLE', rect, inset: 12, color: '#FFF3C4' });

    const findings = await clippingGate.run(
      ctx(image, {
        plan: planWithText([{ role: 'right-team', rect, color: '#0e0d0d', text: 'HLE' }]),
        textRects: [{ role: 'right-team', rect }],
      }),
    );
    expect(fails(findings)).toEqual([]);
    expect(findings.some((f) => /NOT checked for clipping/.test(f.message))).toBe(true);
  });

  it('passes cleanly when there is no text or mark at all', async () => {
    const findings = await clippingGate.run(ctx(await flatBackground('#101018')));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('pass');
  });
});
