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
  });

  it('renders every preset to visible pixels', async () => {
    for (const name of Object.keys(PRESETS)) {
      const r = autoFit(
        { block: { text: 'HEXA 2026', style: preset(name), align: 'center' }, box: BOX, anchor: 'center' },
        { min: 24, max: 200 },
      );
      await expectVisible(r.markup, `preset:${name}`);
    }
  });

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
  });

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
  });

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
  });

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
  });

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
  });

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
  });

  it('rasterises two text layers concatenated into one document, both visible', async () => {
    const style: TextStyle = {
      family: 'Anton', size: 90, case: 'upper',
      fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#666666' }] },
      glow: { radius: 18, color: '#40E0FF', intensity: 0.7 },
    };
    const a = renderText({ block: { text: 'TOP LINE', style }, box: { x: 0, y: 0, w: 600, h: 140 } });
    const b = renderText({
      block: { text: 'LOWER LINE', style: { ...style, fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFD447' }, { offset: 1, color: '#E01E37' }] } } },
      box: { x: 0, y: 0, w: 600, h: 140 },
    });

    // This is the composition the id scheme exists to protect: two independent
    // renders, both carrying gradients and filters, in one document.
    const combined =
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="280" viewBox="0 0 600 280">` +
      `<g>${a.markup}</g><g transform="translate(0,140)">${b.markup}</g>` +
      `</svg>`;

    const ink = await expectVisible(combined, 'two-layer document', 0.02);

    // If the ids had collided, the second layer would inherit the first's
    // gradient. Sample a row from each half and assert they differ in hue.
    const { data, info } = await sharp(Buffer.from(combined)).flatten({ background: BG }).raw().toBuffer({ resolveWithObject: true });
    const rowAvg = (y: number) => {
      let r = 0, g = 0, b = 0, count = 0;
      for (let x = 0; x < info.width; x++) {
        const o = (y * info.width + x) * info.channels;
        if (data[o]! > 40 || data[o + 1]! > 40 || data[o + 2]! > 60) {
          r += data[o]!; g += data[o + 1]!; b += data[o + 2]!; count++;
        }
      }
      return count ? { r: r / count, g: g / count, b: b / count } : null;
    };
    const top = rowAvg(Math.floor(info.height * 0.25));
    const bottom = rowAvg(Math.floor(info.height * 0.75));
    expect(top, 'no ink in the top layer').not.toBeNull();
    expect(bottom, 'no ink in the bottom layer').not.toBeNull();
    // Top ramp is neutral grey; bottom ramp is amber→red. Blue is the tell.
    expect(top!.b - bottom!.b, 'the two layers painted with the same gradient').toBeGreaterThan(20);
    expect(ink.coverage).toBeGreaterThan(0.02);
  });

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
  });
});
