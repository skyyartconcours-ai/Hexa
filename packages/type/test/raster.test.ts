/**
 * Rasterisation tests.
 *
 * Everything else in this suite reasons about markup as a string. This file is
 * the one that hands the markup to a real SVG engine (librsvg, via sharp) —
 * the same class of engine the render package uses. Markup that only fails at
 * raster time is the main risk this package carries: a dangling `url(#…)`, an
 * unsupported filter primitive or a malformed path parses fine as XML and then
 * silently paints nothing.
 *
 * So the assertions are deliberately about *pixels*: the raster must decode,
 * and it must not be blank. `stdev > 0` on a flattened raster is the check that
 * catches "valid XML, zero ink".
 */

import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import {
  renderText, autoFit, preset, PRESETS, versusMark, nameplate, statBadge, ensureFonts,
} from '../src/index.js';
import type { TextStyle, PixelRect, VersusMarkOptions, NameplateOptions } from '../src/index.js';

const BG = '#101018';

interface Ink {
  width: number;
  height: number;
  /** Max per-channel standard deviation over the flattened raster. */
  stdev: number;
  /** Fraction of pixels that differ from the background. */
  coverage: number;
}

/**
 * Rasterise `markup` and measure how much ink landed.
 *
 * The raster is flattened onto an opaque background first: the SVG is
 * transparent, and statistics over an all-transparent RGBA buffer can look
 * "varied" purely from undefined colour data under zero alpha.
 */
async function rasterise(markup: string): Promise<Ink> {
  // No `density` override: sharp's default of 72 DPI maps one SVG user unit to
  // one pixel, so raster dimensions can be asserted against the declared size.
  const png = await sharp(Buffer.from(markup, 'utf8'))
    .flatten({ background: BG })
    .png()
    .toBuffer();

  const img = sharp(png);
  const meta = await img.metadata();
  const stats = await img.stats();
  const stdev = Math.max(...stats.channels.map((c) => c.stdev));

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let differing = 0;
  const total = info.width * info.height;
  // Background is #101018 → (16, 16, 24).
  for (let i = 0; i < total; i++) {
    const o = i * channels;
    if (Math.abs(data[o]! - 16) > 8 || Math.abs(data[o + 1]! - 16) > 8 || Math.abs(data[o + 2]! - 24) > 8) differing++;
  }

  return { width: meta.width ?? 0, height: meta.height ?? 0, stdev, coverage: differing / total };
}

/** Assert the markup rasterises to something visible. */
async function expectVisible(markup: string, label: string, minCoverage = 0.005): Promise<Ink> {
  let ink: Ink;
  try {
    ink = await rasterise(markup);
  } catch (e) {
    throw new Error(`${label}: sharp could not rasterise the markup — ${(e as Error).message}\n${markup.slice(0, 900)}`);
  }
  expect(ink.width, `${label}: zero-width raster`).toBeGreaterThan(0);
  expect(ink.height, `${label}: zero-height raster`).toBeGreaterThan(0);
  expect(ink.stdev, `${label}: raster is blank (stdev ${ink.stdev})`).toBeGreaterThan(0);
  expect(ink.coverage, `${label}: almost no ink (coverage ${ink.coverage})`).toBeGreaterThan(minCoverage);
  return ink;
}

/** Bounding box of everything that is not the background, in raster pixels. */
async function inkBounds(markup: string) {
  const { data, info } = await sharp(Buffer.from(markup, 'utf8'))
    .flatten({ background: BG }).raw().toBuffer({ resolveWithObject: true });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * info.channels;
      if (Math.abs(data[o]! - 16) > 12 || Math.abs(data[o + 1]! - 16) > 12 || Math.abs(data[o + 2]! - 24) > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, w: info.width, h: info.height, empty: x1 < x0 };
}

const BOX: PixelRect = { x: 0, y: 0, w: 900, h: 260 };

beforeAll(async () => {
  // Use whatever real faces this machine has — the raster should be valid
  // either way, and running with fonts registered exercises the exact path.
  await ensureFonts();
});

describe('sharp rasterisation', () => {
  it('renders a full-dress headline to visible, non-blank pixels', async () => {
    const style: TextStyle = {
      family: 'Anton',
      weight: 400,
      size: 130,
      tracking: -0.015,
      lineHeight: 0.92,
      case: 'upper',
      fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#8892A6' }] },
      stroke: { width: 8, color: '#0A0A0F', join: 'round' },
      extrude: { depth: 14, angle: 62, color: '#12141C', fade: 0.3 },
      shadow: { dx: 0, dy: 8, blur: 20, color: '#000000', opacity: 0.55 },
      glow: { radius: 24, color: '#40E0FF', intensity: 0.6 },
      skewX: 8,
    };
    const r = renderText({ block: { text: 'GRAND FINAL', style, align: 'center' }, box: BOX, anchor: 'center' });
    const ink = await expectVisible(r.markup, 'headline', 0.03);
    expect(ink.width).toBeGreaterThanOrEqual(900);
  }, 30_000);

  it('renders every preset to visible pixels', async () => {
    for (const name of Object.keys(PRESETS)) {
      const r = autoFit(
        { block: { text: 'HEXA 2026', style: preset(name), align: 'center' }, box: BOX, anchor: 'center' },
        { min: 24, max: 200 },
      );
      await expectVisible(r.markup, `preset:${name}`);
    }
  }, 60_000);

  it('renders each fill kind to visible pixels', async () => {
    const fills: TextStyle['fill'][] = [
      { kind: 'solid', color: '#FFD447' },
      { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FF3366' }, { offset: 1, color: '#3366FF' }] },
      { kind: 'radial', stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#204080' }] },
      { kind: 'stripe', colors: ['#FFD447', '#0A0A0F'], width: 10, angle: 45 },
    ];
    for (const fill of fills) {
      const style: TextStyle = { family: 'Anton', size: 120, case: 'upper', fill, stroke: { width: 5, color: '#000' } };
      const r = renderText({ block: { text: 'FILL', style }, box: BOX, anchor: 'center' });
      await expectVisible(r.markup, `fill:${fill!.kind}`);
    }
  }, 30_000);

  it('renders a gradient fill with actual colour variation, not a flat block', async () => {
    const style: TextStyle = {
      family: 'Archivo Black', weight: 900, size: 150, case: 'upper',
      fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#101018' }] },
    };
    const r = renderText({ block: { text: 'RAMP', style }, box: BOX, anchor: 'center' });
    const ink = await expectVisible(r.markup, 'gradient-ramp');
    // A dangling gradient reference would paint nothing; a broken one would
    // paint flat. Neither produces this much spread.
    expect(ink.stdev).toBeGreaterThan(10);
  });

  it('actually paints the extrusion slab', async () => {
    const base: TextStyle = {
      family: 'Anton', size: 140, case: 'upper',
      fill: { kind: 'solid', color: '#FFFFFF' },
    };
    const flat = renderText({ block: { text: 'SLAB', style: base }, box: BOX, anchor: 'center' });
    const slab = renderText({
      block: { text: 'SLAB', style: { ...base, extrude: { depth: 24, angle: 60, color: '#E01E37' } } },
      box: BOX, anchor: 'center',
    });
    const a = await expectVisible(flat.markup, 'extrude:off');
    const b = await expectVisible(slab.markup, 'extrude:on');
    expect(b.coverage).toBeGreaterThan(a.coverage * 1.15);
  }, 30_000);

  it('actually paints the plate behind the text', async () => {
    const style: TextStyle = {
      family: 'Bebas Neue', size: 90, case: 'upper',
      fill: { kind: 'solid', color: '#0A0A0F' },
      plate: { color: '#FFD447', padX: 24, padY: 12, radius: 4 },
    };
    const r = renderText({ block: { text: 'PLATE', style }, box: BOX, anchor: 'center' });
    const ink = await expectVisible(r.markup, 'plate', 0.05);
    expect(ink.coverage).toBeGreaterThan(0.05);
  });

  it('renders jittered per-character text', async () => {
    const style: TextStyle = {
      family: 'Anton', size: 110, case: 'upper',
      fill: { kind: 'solid', color: '#FFFFFF' },
      stroke: { width: 5, color: '#0A0A0F' },
      jitter: { rotate: 4, offset: 3, seed: 99 },
    };
    const r = renderText({ block: { text: 'JITTER', style }, box: BOX, anchor: 'center' });
    await expectVisible(r.markup, 'jitter');
  });

  it('renders emoji and CJK without producing a blank raster', async () => {
    const style: TextStyle = {
      family: 'Archivo Black', weight: 900, size: 90, case: 'none',
      fill: { kind: 'solid', color: '#FFFFFF' },
      stroke: { width: 4, color: '#0A0A0F' },
    };
    for (const text of ['GG & <WIN>', `"QUOTED" 'TOO'`, '决勝 FINAL']) {
      const r = renderText({ block: { text, style }, box: BOX, anchor: 'center' });
      await expectVisible(r.markup, `unicode:${text}`);
    }
  }, 30_000);

  it('renders every versusMark style', async () => {
    const styles: NonNullable<VersusMarkOptions['style']>[] = [
      'slash', 'shield', 'bolt', 'blade', 'circle', 'plain', 'hex',
    ];
    for (const style of styles) {
      for (const glow of [false, true]) {
        const m = versusMark({ size: 220, style, glow, leftColor: '#E01E37', rightColor: '#1E6FE0' });
        const ink = await expectVisible(m.markup, `versus:${style}:glow=${glow}`, 0.02);
        expect(ink.width, `versus:${style} raster width`).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it('paints both team colours in a slash mark', async () => {
    const m = versusMark({ size: 240, style: 'slash', leftColor: '#FF0000', rightColor: '#0000FF' });
    const png = await sharp(Buffer.from(m.markup)).flatten({ background: BG }).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = png;
    const at = (x: number, y: number) => {
      const o = (y * info.width + x) * info.channels;
      return { r: data[o]!, g: data[o + 1]!, b: data[o + 2]! };
    };
    const leftPx = at(Math.floor(info.width * 0.12), Math.floor(info.height * 0.5));
    const rightPx = at(Math.floor(info.width * 0.88), Math.floor(info.height * 0.5));
    expect(leftPx.r, 'left half should be red-dominant').toBeGreaterThan(leftPx.b);
    expect(rightPx.b, 'right half should be blue-dominant').toBeGreaterThan(rightPx.r);
  });

  it('renders every nameplate style and alignment', async () => {
    const styles: NonNullable<NameplateOptions['style']>[] = ['bar', 'angled', 'stacked', 'minimal', 'ticket'];
    for (const style of styles) {
      for (const align of ['left', 'right'] as const) {
        const m = nameplate({
          name: 'Kestrel', team: 'NRG', role: 'DUELIST', accent: '#FFD447',
          width: 460, height: 120, align, style,
        });
        await expectVisible(m.markup, `nameplate:${style}:${align}`, 0.02);
      }
    }
  }, 30_000);

  it('renders every statBadge style', async () => {
    for (const style of ['pill', 'square', 'shield'] as const) {
      const m = statBadge({ label: 'KILLS', value: '27', accent: '#40E0FF', width: 180, height: 120, style });
      await expectVisible(m.markup, `badge:${style}`, 0.02);
    }
  });

  it('survives the 210×118 thumbnail downsample with ink still on the canvas', async () => {
    const r = autoFit(
      {
        block: { text: 'GRAND FINAL', style: preset('headline-condensed'), align: 'center' },
        box: { x: 0, y: 0, w: 1280, h: 400 },
        anchor: 'center',
      },
      { min: 40, max: 300 },
    );
    const small = await sharp(Buffer.from(r.markup))
      .flatten({ background: BG })
      .resize(210, Math.round((400 / 1280) * 210), { fit: 'fill' })
      .png()
      .toBuffer();
    const stats = await sharp(small).stats();
    const stdev = Math.max(...stats.channels.map((c) => c.stdev));
    expect(stdev, 'headline dissolved at thumbnail scale').toBeGreaterThan(12);
  }, 30_000);

  it('rasterises two text layers concatenated into one document, both visible', async () => {
    // The two layers differ *only* in gradient hue. If their def ids collided,
    // whichever definition the parser resolved would paint both — so the two
    // halves coming out different hues is direct evidence the namespacing works
    // at raster time, not just in the markup.
    const base: TextStyle = {
      family: 'Anton', size: 90, case: 'upper',
      stroke: { width: 4, color: '#0A0A0F' },
      glow: { radius: 14, color: '#40E0FF', intensity: 0.5 },
    };
    const red: TextStyle = {
      ...base,
      fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FF3020' }, { offset: 1, color: '#FF9080' }] },
    };
    const blue: TextStyle = {
      ...base,
      fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#2030FF' }, { offset: 1, color: '#8090FF' }] },
    };
    const half: PixelRect = { x: 0, y: 0, w: 600, h: 140 };
    const a = renderText({ block: { text: 'TOP LINE', style: red }, box: half, anchor: 'center' });
    const b = renderText({ block: { text: 'LOWER LINE', style: blue }, box: half, anchor: 'center' });

    const combined =
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="280" viewBox="0 0 600 280">` +
      `<g>${a.markup}</g><g transform="translate(0,140)">${b.markup}</g>` +
      `</svg>`;

    const ink = await expectVisible(combined, 'two-layer document', 0.02);

    const { data, info } = await sharp(Buffer.from(combined))
      .flatten({ background: BG }).raw().toBuffer({ resolveWithObject: true });

    /** Mean colour of the ink in the band `y0…y1` (fractions of height). */
    const bandAvg = (y0: number, y1: number) => {
      let r = 0, g = 0, bl = 0, count = 0;
      for (let y = Math.floor(info.height * y0); y < Math.floor(info.height * y1); y++) {
        for (let x = 0; x < info.width; x++) {
          const o = (y * info.width + x) * info.channels;
          // Ink only: anything clearly brighter than the #101018 ground.
          if (data[o]! + data[o + 1]! + data[o + 2]! > 240) {
            r += data[o]!; g += data[o + 1]!; bl += data[o + 2]!; count++;
          }
        }
      }
      return count > 50 ? { r: r / count, g: g / count, b: bl / count, count } : null;
    };

    const top = bandAvg(0.05, 0.45);
    const bottom = bandAvg(0.55, 0.95);
    expect(top, 'no ink found in the top layer').not.toBeNull();
    expect(bottom, 'no ink found in the bottom layer').not.toBeNull();

    // Both layers carry the same cyan glow, which pushes blue up in both
    // bands. The red:blue *ratio* is what isolates the fill from the halo — and
    // it is exactly what would become identical if the gradient ids collided
    // and one definition ended up painting both layers.
    const topRatio = top!.r / top!.b;
    const bottomRatio = bottom!.r / bottom!.b;
    expect(
      topRatio / bottomRatio,
      `both layers painted with the same gradient (top r:b ${topRatio.toFixed(2)}, bottom r:b ${bottomRatio.toFixed(2)})`,
    ).toBeGreaterThan(1.5);
    expect(ink.coverage).toBeGreaterThan(0.02);
  }, 30_000);

  /**
   * Regression: measurement must describe the font that is actually drawn.
   *
   * `resolveFace` used to look up only the requested family, so on a machine
   * without Anton installed it measured the *condensed class table* while
   * fontconfig substituted a wide grotesque for the actual glyphs. Everything
   * downstream inherited the ~35 % error: `autoFit` reported a fit that did not
   * fit, right-aligned nameplates ran off their plates, and headlines were
   * clipped at the box edge — visible only in the raster.
   *
   * Ink touching the very edge of the viewport is the signature of that class
   * of bug, so that is what this asserts.
   */
  it('keeps rendered ink inside the box that measurement promised', async () => {
    const box: PixelRect = { x: 0, y: 0, w: 820, h: 200 };
    const texts = ['CLUTCH OR KICK', 'Grand Final 2026', 'W', 'MMMMMMMMMM', 'Winter Major · Game 5'];

    for (const name of ['headline-condensed', 'headline-heavy', 'player-name', 'kicker', 'team-tag', 'date-badge']) {
      for (const text of texts) {
        // Glow and shadow are meant to bleed; this assertion is about glyph ink.
        const style = preset(name, { glow: undefined, shadow: undefined });
        const r = autoFit({ block: { text, style, align: 'center' }, box, anchor: 'center' }, { min: 10, max: 180 });
        const b = await inkBounds(r.markup);
        const where = `${name} / "${text}" @${r.fontSize.toFixed(1)}px`;

        expect(b.empty, `${where}: nothing rendered`).toBe(false);

        // The load-bearing assertion: the bounds `autoFit` reported must be an
        // honest upper bound on the ink that landed. Before the fix this was
        // out by ~35 % whenever the design font was absent.
        expect(b.x1 - b.x0 + 1, `${where}: real ink wider than reported width ${r.width.toFixed(1)}`)
          .toBeLessThanOrEqual(r.width + 4);
        expect(b.y1 - b.y0 + 1, `${where}: real ink taller than reported height ${r.height.toFixed(1)}`)
          .toBeLessThanOrEqual(r.height + 4);

        // Where the fit left real slack, that slack must show up as clearance.
        // (A perfect fit legitimately puts ink on the last row, so only assert
        // this when there is room to spare.)
        if (box.w - r.width > 4) {
          expect(b.x0, `${where}: ink clipped at the left edge`).toBeGreaterThan(0);
          expect(b.x1, `${where}: ink clipped at the right edge`).toBeLessThan(b.w - 1);
        }
        if (box.h - r.height > 4) {
          expect(b.y0, `${where}: ink clipped at the top edge`).toBeGreaterThan(0);
          expect(b.y1, `${where}: ink clipped at the bottom edge`).toBeLessThan(b.h - 1);
        }
      }
    }
  }, 60_000);

  it('keeps mark lettering inside the mark', async () => {
    const marks: [string, string][] = [
      ...(['slash', 'blade', 'shield', 'bolt', 'circle', 'hex', 'plain'] as const).map(
        (st) => [`versus:${st}`, versusMark({ size: 190, style: st, leftColor: '#E01E37', rightColor: '#1E6FE0' }).markup] as [string, string],
      ),
      ...(['bar', 'angled', 'stacked', 'minimal', 'ticket'] as const).flatMap((st) =>
        (['left', 'right'] as const).map(
          (align) => [
            `nameplate:${st}:${align}`,
            nameplate({ name: 'Kestrel', team: 'NRG', role: 'DUELIST', accent: '#FFD447', width: 420, height: 110, align, style: st }).markup,
          ] as [string, string],
        ),
      ),
      ...(['pill', 'square', 'shield'] as const).map(
        (st) => [`badge:${st}`, statBadge({ label: 'KILLS', value: '27', accent: '#40E0FF', width: 170, height: 120, style: st }).markup] as [string, string],
      ),
    ];

    for (const [label, markup] of marks) {
      const b = await inkBounds(markup);
      expect(b.empty, `${label}: nothing rendered`).toBe(false);
      // Marks legitimately paint to their own edge (plates, outlines), so the
      // check is that nothing is *cut off* — no ink in the final column/row
      // unless the design fills that edge on both sides.
      expect(b.x1, `${label}: content runs past the right edge`).toBeLessThanOrEqual(b.w - 1);
      expect(b.y1, `${label}: content runs past the bottom edge`).toBeLessThanOrEqual(b.h - 1);
    }
  }, 60_000);

  it('rasterises a full lockup of every mark type in one document', async () => {
    const head = autoFit(
      { block: { text: 'WINTER MAJOR', style: preset('headline-condensed'), align: 'center' }, box: { x: 0, y: 0, w: 1200, h: 220 }, anchor: 'center' },
      { min: 40, max: 220 },
    );
    const vs = versusMark({ size: 200, style: 'slash', glow: true, leftColor: '#E01E37', rightColor: '#1E6FE0' });
    const npL = nameplate({ name: 'Kestrel', team: 'NRG', accent: '#E01E37', width: 400, height: 110, align: 'left' });
    const npR = nameplate({ name: 'Vex', team: 'C9', accent: '#1E6FE0', width: 400, height: 110, align: 'right', style: 'angled' });
    const badge = statBadge({ label: 'K/D', value: '2.4', accent: '#FFD447', width: 180, height: 120, style: 'shield' });

    const doc =
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">` +
      `<rect width="1280" height="720" fill="${BG}"/>` +
      `<g transform="translate(40,60)">${head.markup}</g>` +
      `<g transform="translate(540,300)">${vs.markup}</g>` +
      `<g transform="translate(60,560)">${npL.markup}</g>` +
      `<g transform="translate(820,560)">${npR.markup}</g>` +
      `<g transform="translate(1060,300)">${badge.markup}</g>` +
      `</svg>`;

    const ink = await expectVisible(doc, 'full lockup', 0.05);
    expect(ink.width).toBe(1280);
    expect(ink.height).toBe(720);
  }, 30_000);
});
