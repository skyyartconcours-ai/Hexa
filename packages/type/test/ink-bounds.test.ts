/**
 * Ink-bounds regression suite.
 *
 * Every other test in this package reasons about numbers this package produced
 * itself, which is exactly how a measurement bug stays invisible: measurement
 * agreed with measurement, 139 tests were green, and every headline in the
 * product was clipped. So these assertions come from the *raster* — the alpha
 * channel of a real librsvg render — and they are checked against the rect the
 * layout promised.
 *
 * Two properties are asserted, and they are different:
 *
 *  1. The reported `width`/`height` must be an honest **upper bound** on the ink
 *     that lands. Under-reporting is the failure mode that clips: the compiler
 *     hands `renderText`'s box straight to the compositor as the layer rect, and
 *     the emitted document is exactly that size, so a glyph that measurement
 *     did not account for is a glyph with nowhere to go.
 *  2. The ink must actually **fit inside the box** `autoFit` fitted it to.
 *
 * ── Why this file never calls `ensureFonts()` ────────────────────────────────
 *
 * That is the entire point. The pipeline does not call it either, and the
 * original defect was precisely that measurement silently fell back to the
 * requested family's *condensed class table* while fontconfig handed the
 * rasteriser a wide grotesque. `beforeAll(ensureFonts)` — which the sibling
 * raster suite does — papers over that: it registers the faces by hand, so the
 * measurement path under test is not the one the product runs. A regression
 * test for "measurement disagrees with the rasteriser" has to start from the
 * same cold registry a real host starts from.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import type { PixelRect } from '@hexa/core';
import { renderText, autoFit, preset, registeredFonts } from '../src/index.js';
import type { TextStyle, LaidOutText } from '../src/index.js';

/** Room around the declared box, so overflow is measurable instead of clipped. */
const PAD = 240;
/** Alpha at or above which a pixel counts as ink. Low enough to catch an edge. */
const INK_ALPHA = 24;
/** Antialiasing slop, in pixels. Real regressions here are tens of pixels. */
const TOL = 2;

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  empty: boolean;
}

/**
 * Re-frame a standalone document so `PAD` px of margin around it is rendered.
 *
 * The viewBox origin moves, not the content, so every returned coordinate is
 * still in the document's own user space — and ink that the shipped document
 * would have clipped at its edge shows up as a negative x0 or an x1 past the
 * declared width instead of silently vanishing.
 */
function reframe(markup: string, w: number, h: number): string {
  const body = markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w + PAD * 2}" height="${h + PAD * 2}" ` +
    `viewBox="${-PAD} ${-PAD} ${w + PAD * 2} ${h + PAD * 2}">${body}</svg>`
  );
}

/** Raw alpha plane of the reframed document. */
async function alphaOf(markup: string, w: number, h: number) {
  // No `density` override: sharp's default 72 DPI maps one SVG user unit to one
  // raster pixel, which is what makes these coordinates comparable to the box.
  const { data, info } = await sharp(Buffer.from(reframe(markup, w, h), 'utf8'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = info.channels;
  const plane = new Uint8Array(info.width * info.height);
  for (let i = 0; i < plane.length; i++) plane[i] = data[i * stride + stride - 1]!;
  return { plane, width: info.width, height: info.height };
}

/** Bounding box of the ink, in the document's own coordinates. */
async function inkBounds(markup: string, w: number, h: number, minAlpha = INK_ALPHA): Promise<Bounds> {
  const { plane, width, height } = await alphaOf(markup, w, h);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (plane[y * width + x]! >= minAlpha) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0, empty: true };
  return {
    x0: x0 - PAD,
    y0: y0 - PAD,
    x1: x1 - PAD + 1,
    y1: y1 - PAD + 1,
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
    empty: false,
  };
}

/**
 * Assert the ink of `laid` is inside `box` and no larger than it was reported.
 *
 * `laid` must have been produced from a style with no shadow and no glow: those
 * two are documented soft bleed, they are excluded from the fitted bounds on
 * purpose, and including them here would assert a guarantee the package does
 * not make. `filters do not clip the artwork they decorate` covers them.
 */
async function expectInkFits(laid: LaidOutText, box: PixelRect, where: string): Promise<Bounds> {
  const b = await inkBounds(laid.markup, box.w, box.h);
  expect(b.empty, `${where}: nothing rendered at all`).toBe(false);

  const detail =
    `reported ${laid.width.toFixed(1)}×${laid.height.toFixed(1)} @${laid.fontSize.toFixed(1)}px ` +
    `in ${box.w}×${box.h}, ink x ${b.x0}..${b.x1} y ${b.y0}..${b.y1}`;

  // (1) Measurement must be an upper bound on the ink. This is the assertion
  //     that catches measuring one font stack and drawing another.
  expect(b.w, `${where}: ink ${b.w}px wide but only ${laid.width.toFixed(1)}px was reported — ${detail}`)
    .toBeLessThanOrEqual(laid.width + TOL);
  expect(b.h, `${where}: ink ${b.h}px tall but only ${laid.height.toFixed(1)}px was reported — ${detail}`)
    .toBeLessThanOrEqual(laid.height + TOL);

  // (2) …and the ink has to be inside the rect the layer will be composited at.
  expect(b.x0, `${where}: ink runs off the left edge — ${detail}`).toBeGreaterThanOrEqual(-TOL);
  expect(b.y0, `${where}: ink runs off the top edge — ${detail}`).toBeGreaterThanOrEqual(-TOL);
  expect(b.x1, `${where}: ink runs off the right edge — ${detail}`).toBeLessThanOrEqual(box.w + TOL);
  expect(b.y1, `${where}: ink runs off the bottom edge — ${detail}`).toBeLessThanOrEqual(box.h + TOL);
  return b;
}

// ── the matrix ───────────────────────────────────────────────────────────────

/** The copy that was actually clipped in `out/smoke/versus-v02.png`, plus edges. */
const STRINGS = [
  'LCK FINALS',   // kicker: wide positive tracking, lost its final S
  'VIPER',        // right nameplate: ran off its plate and its layer
  'PEYZ',         // left nameplate
  'T1',           // team badge: two glyphs, one of them narrow
  'HLE',          // team badge
  'W',            // single widest glyph
  'CHAMPIONSHIPQUALIFIERSTAGE', // one word too long for any of these boxes
];

const INK = '#0A0A0F';

/** Hand-built styles, one decoration axis at a time, then all of them at once. */
const STYLE_MATRIX: [string, TextStyle][] = [
  ['bare', { family: 'Anton', size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' } }],
  ['tracking+', { family: 'Oswald', weight: 500, size: 96, tracking: 0.22, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' } }],
  ['tracking-', { family: 'Archivo Black', weight: 900, size: 96, tracking: -0.04, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' } }],
  ['stroke', { family: 'Anton', size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' }, stroke: { width: 9, color: INK, join: 'round' } }],
  ['extrude', { family: 'Anton', size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' }, extrude: { depth: 22, angle: 60, color: '#12141C', fade: 0.3 } }],
  ['extrude-back', { family: 'Anton', size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' }, extrude: { depth: 22, angle: 215, color: '#12141C' } }],
  ['skew', { family: 'Anton', size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' }, skewX: 12 }],
  ['skew-negative', { family: 'Anton', size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' }, skewX: -12 }],
  ['italic', { family: 'Inter', weight: 700, italic: true, size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' } }],
  ['plate', { family: 'Bebas Neue', weight: 700, size: 96, tracking: 0.16, case: 'upper', fill: { kind: 'solid', color: INK }, plate: { color: '#FFD447', padX: 18, padY: 9, radius: 3, skewX: 10 } }],
  ['jitter', { family: 'Anton', size: 96, case: 'upper', fill: { kind: 'solid', color: '#FFFFFF' }, jitter: { rotate: 5, offset: 6, seed: 1337 } }],
  ['the-works', {
    family: 'Anton', size: 96, tracking: 0.08, case: 'upper',
    fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#AEB6C6' }] },
    stroke: { width: 8, color: INK, join: 'round' },
    extrude: { depth: 18, angle: 62, color: '#12141C', fade: 0.35 },
    skewX: 9,
  }],
];

/** The presets the compiler actually reaches for on the versus template. */
const PRESET_MATRIX = ['stat-label', 'player-name', 'team-tag', 'headline-heavy', 'headline-condensed', 'vs-mark', 'date-badge'];

/** The slot rects the versus template really produced, plus a couple of shapes. */
const BOXES: [string, PixelRect][] = [
  ['kicker-slot', { x: 0, y: 0, w: 474, h: 54 }],
  ['nameplate-slot', { x: 0, y: 0, w: 429, h: 76 }],
  ['badge-slot', { x: 0, y: 0, w: 307, h: 45 }],
  ['wide', { x: 0, y: 0, w: 900, h: 200 }],
  ['tiny', { x: 0, y: 0, w: 120, h: 40 }],
];

/** Strip the two soft effects; everything else about the style is preserved. */
function hardOnly(style: TextStyle): TextStyle {
  const out: TextStyle = { ...style };
  delete out.shadow;
  delete out.glow;
  return out;
}

describe('rendered ink stays inside the rect the layout promised', () => {
  it('discovers the installed faces without being asked to', () => {
    // Measurement has to know what fontconfig will pick before it can agree
    // with it. Nothing in this file registered a font, so if the registry is
    // still empty after a measurement, every fit below is a guess.
    autoFit({ block: { text: 'PROBE', style: preset('player-name') }, box: { x: 0, y: 0, w: 400, h: 90 } });
    const families = new Set(registeredFonts().map((f) => f.family));
    expect(
      families.size,
      'no faces registered after a measurement — measurement is running on class tables while the rasteriser uses real fonts',
    ).toBeGreaterThan(0);
  });

  it('fits every style × string combination inside its box', async () => {
    for (const [styleName, base] of STYLE_MATRIX) {
      for (const text of STRINGS) {
        for (const [boxName, box] of [BOXES[0]!, BOXES[3]!]) {
          const laid = autoFit(
            { block: { text, style: hardOnly(base), align: 'center' }, box, anchor: 'center', maxLines: 1 },
            { min: 8, max: 200 },
          );
          await expectInkFits(laid, box, `${styleName} / "${text}" / ${boxName}`);
        }
      }
    }
  }, 240_000);

  it('fits every shipped preset in every slot shape the compiler produces', async () => {
    for (const name of PRESET_MATRIX) {
      for (const text of STRINGS) {
        for (const [boxName, box] of BOXES) {
          const laid = autoFit(
            { block: { text, style: hardOnly(preset(name)), align: 'center' }, box, anchor: 'center', maxLines: 1 },
            { min: 8, max: 240 },
          );
          await expectInkFits(laid, box, `preset:${name} / "${text}" / ${boxName}`);
        }
      }
    }
  }, 240_000);

  it('fits the exact copy and slots that were clipped in the versus smoke render', async () => {
    // Reproduces `emitText` in @hexa/pipeline: preset per role, autoFit into the
    // slot, and the resulting document composited at exactly that rect.
    const cases: [string, string, string, PixelRect, 'left' | 'center' | 'right'][] = [
      ['kicker', 'LCK FINALS', 'stat-label', { x: 460, y: 43, w: 474, h: 54 }, 'center'],
      ['left-name', 'PEYZ', 'player-name', { x: 70, y: 515, w: 429, h: 76 }, 'left'],
      ['right-name', 'VIPER', 'player-name', { x: 781, y: 515, w: 429, h: 76 }, 'right'],
      ['left-team', 'T1', 'team-tag', { x: 70, y: 457, w: 307, h: 45 }, 'left'],
      ['right-team', 'HLE', 'team-tag', { x: 902, y: 457, w: 307, h: 45 }, 'right'],
      ['vs', 'VS', 'vs-mark', { x: 485, y: 205, w: 310, h: 151 }, 'center'],
    ];

    for (const [slot, text, name, box, align] of cases) {
      const laid = autoFit(
        { block: { text, style: hardOnly(preset(name)), align }, box, anchor: 'center', maxLines: 1 },
        { min: 8, max: 240 },
      );
      await expectInkFits(laid, box, `smoke:${slot} "${text}"`);
    }
  }, 120_000);

  it('never reports a fit narrower than the glyphs it is about to draw', async () => {
    // The same invariant stated without `autoFit` in the way: renderText is
    // handed a box big enough for anything, so nothing is shrunk to hide an
    // under-measurement.
    const box: PixelRect = { x: 0, y: 0, w: 1600, h: 400 };
    for (const [styleName, base] of STYLE_MATRIX) {
      for (const text of ['LCK FINALS', 'VIPER', 'T1', 'HLE', 'CHAMPIONSHIPQUALIFIERSTAGE']) {
        const style = hardOnly({ ...base, size: 110 });
        const laid = renderText({ block: { text, style, align: 'left' }, box, anchor: 'top-left', wrap: false });
        const b = await inkBounds(laid.markup, box.w, box.h);
        expect(b.empty, `${styleName} / "${text}": nothing rendered`).toBe(false);
        expect(
          b.w,
          `${styleName} / "${text}": drew ${b.w}px of ink but reported ${laid.width.toFixed(1)}px`,
        ).toBeLessThanOrEqual(laid.width + TOL);
      }
    }
  }, 180_000);
});

describe('filters do not clip the artwork they decorate', () => {
  /**
   * A filter region is a hard clip on the filter's whole output, and the drop
   * shadow merges `SourceGraphic` back in — so a region sized to the bare glyph
   * box amputates the outline, the slab and the jitter that sit outside it.
   * Turning an effect on must only ever *add* ink.
   */
  async function expectEffectOnlyAdds(style: TextStyle, text: string, box: PixelRect, where: string) {
    const opts = { block: { text, style: hardOnly(style), align: 'center' as const }, box, anchor: 'center' as const, wrap: false };
    const plain = await alphaOf(renderText(opts).markup, box.w, box.h);
    const withFx = await alphaOf(renderText({ ...opts, block: { ...opts.block, style } }).markup, box.w, box.h);

    let solid = 0;
    let lost = 0;
    for (let i = 0; i < plain.plane.length; i++) {
      if (plain.plane[i]! >= 200) {
        solid++;
        if (withFx.plane[i]! < 8) lost++;
      }
    }
    expect(solid, `${where}: no solid ink to compare`).toBeGreaterThan(200);
    expect(
      lost,
      `${where}: ${lost} of ${solid} solid pixels disappeared when the effect was switched on — the filter region is clipping the artwork`,
    ).toBe(0);
  }

  const box: PixelRect = { x: 0, y: 0, w: 900, h: 260 };

  it('keeps the slab and the outline when a tight drop shadow is added', async () => {
    // A deep slab with a *small* blur: the shadow's own padding is far smaller
    // than the extrusion, so nothing but the decorated bounds can save it.
    await expectEffectOnlyAdds(
      {
        family: 'Anton', size: 120, case: 'upper',
        fill: { kind: 'solid', color: '#FFFFFF' },
        stroke: { width: 10, color: INK, join: 'round' },
        extrude: { depth: 46, angle: 55, color: '#12141C' },
        shadow: { dx: 0, dy: 1, blur: 1, color: '#000000', opacity: 0.6 },
      },
      'RIVALS', box, 'deep slab + tight shadow',
    );
  }, 60_000);

  it('keeps jittered glyphs when a tight drop shadow is added', async () => {
    await expectEffectOnlyAdds(
      {
        family: 'Anton', size: 120, case: 'upper',
        fill: { kind: 'solid', color: '#FFFFFF' },
        jitter: { rotate: 6, offset: 14, seed: 7 },
        shadow: { dx: 0, dy: 1, blur: 1, color: '#000000', opacity: 0.6 },
      },
      'SCREAM', box, 'jitter + tight shadow',
    );
  }, 60_000);

  it('keeps the artwork when a small glow is added', async () => {
    await expectEffectOnlyAdds(
      {
        family: 'Anton', size: 120, case: 'upper',
        fill: { kind: 'solid', color: '#FFFFFF' },
        stroke: { width: 10, color: INK, join: 'round' },
        extrude: { depth: 40, angle: 300, color: '#12141C' },
        glow: { radius: 2, color: '#40E0FF', intensity: 0.5 },
      },
      'HALO', box, 'slab + small glow',
    );
  }, 60_000);
});
