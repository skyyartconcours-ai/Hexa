/**
 * Clipping gate — is any of the type actually *there*?
 *
 * This gate exists because of a render that shipped past every other gate in
 * this package: a headline that read "VIPEI" because the R was sliced in half by
 * the edge of its own layer, and a kicker that read "LCK FINAL" because the S
 * fell off the same way. Contrast measured the surviving glyphs and passed them.
 * Legibility measured their cap height and passed it. Nothing was looking at the
 * one thing a human sees instantly: the word is cut.
 *
 * The signature of a cut glyph is ink at a boundary. Type is laid out inside a
 * line box with side bearing, so the outermost columns of a healthy text rect
 * are background — a couple of stray antialiased pixels at most. When a glyph is
 * clipped by the layer's viewport (or by the canvas), the cut leaves a straight
 * wall of ink standing exactly on that boundary, spanning most of the rows the
 * type occupies. That is what is measured here, per side:
 *
 *   coverage = inked pixels in the outermost 2px band
 *              ÷ pixels of that band within the type's own row/column extent
 *
 * Normalising by the ink's extent rather than by the whole rect matters: a
 * headline occupies maybe half the height of its line box, and dividing by the
 * box would halve every number and hide a real cut.
 *
 * Three distinct failures come out of it, and they want different remedies:
 *   • ink standing on the canvas edge — the layout ran off the frame;
 *   • ink standing on the rect edge — the layer clipped its own text, which is
 *     the auto-fit measuring wrong (the case above);
 *   • ink continuing outside the rect — the text overflowed a box that did not
 *     clip, so it is now sitting on top of whatever is next to it.
 *
 * Marks (logos, badges, sponsor lozenges) are checked against the canvas edge
 * too. A half-sponsor-logo is a contractual problem as well as an ugly one.
 */

import type { QaFinding, PixelRect } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, collectMarkRects, collectTextRects, toNormRect } from '../geom.js';
import { clampToImage, inkMask, loadRgb, parseHexRgb } from '../image.js';
import { declaredText, resolveTextStyle } from '../plan.js';

/** Band, in pixels, taken as "the boundary". Two, not one: a single column can
 *  be pure antialiasing, and a real cut always inks both. */
const BAND = 2;
/** Share of the ink's own extent standing on the boundary before it is a cut. */
export const CLIP_COVERAGE = 0.35;
const WARN_COVERAGE = 0.18;
/** Ink found this far outside the declared rect counts as an overflow. */
const OVERFLOW_BAND = 3;
const OVERFLOW_COVERAGE = 0.12;

type Side = 'left' | 'right' | 'top' | 'bottom';

interface SideReading {
  side: Side;
  /** 0–1 of the ink's own extent along that edge. */
  coverage: number;
  /** Same measurement in the strip just *outside* the rect. */
  outside: number;
  /** The boundary is also the canvas boundary. */
  atCanvas: boolean;
}

export const clippingGate: Gate = {
  id: 'clipping',
  weight: 2.2,
  description: 'No glyph or mark is sliced by the canvas edge or by the edge of its own layer rect',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const texts = collectTextRects(ctx);
    const marks = collectMarkRects(ctx.plan);
    if (texts.length === 0 && marks.length === 0) {
      return [{
        gate: 'clipping',
        severity: 'pass',
        message: 'No text or mark layers in this render — nothing that could be clipped',
        score: 1,
      }];
    }

    const img = await loadRgb(ctx.image, { background: ctx.plan.canvas.background });
    const findings: QaFinding[] = [];

    for (const { role, rect } of [...texts, ...marks.map((m) => ({ role: m.role, rect: m.rect }))]) {
      const where = toNormRect(rect, ctx.width, ctx.height);
      const copy = declaredText(ctx.plan, role);
      const label = copy ? `"${role}" (${copy})` : `"${role}"`;

      // 1. The rect itself hangs off the canvas. Pure geometry, no pixels
      //    needed, and it is unambiguous: part of the layer cannot be painted.
      const off = offCanvas(rect, ctx.width, ctx.height);
      if (off.length) {
        findings.push({
          gate: 'clipping',
          severity: 'fail',
          message: `${label} is laid out partly off-canvas — its rect runs past the ${off.join(' and ')} edge${off.length > 1 ? 's' : ''} of the ${ctx.width}×${ctx.height} frame`,
          score: 0.1,
          where,
          suggestion: `Pull the "${role}" slot back inside the frame, or let the type auto-fit to the space that exists. Whatever is outside the canvas was never rendered — the words are gone, not merely tight.`,
        });
        continue;
      }

      const style = resolveTextStyle(ctx.plan, role, rect);
      const declared = style.color ? parseHexRgb(style.color) : null;
      const mask = inkMask(img, rect, declared);
      if (!mask) continue; // nothing measurable here; contrast reports that case

      const readings = sides(mask, img, ctx.width, ctx.height);
      const cut = readings.filter((r) => r.coverage >= CLIP_COVERAGE);
      const overflow = readings.filter((r) => r.outside >= OVERFLOW_COVERAGE);
      const marginal = readings.filter((r) => r.coverage >= WARN_COVERAGE && r.coverage < CLIP_COVERAGE);

      if (cut.length) {
        const worst = cut.reduce((a, b) => (b.coverage > a.coverage ? b : a));
        const canvasSides = cut.filter((r) => r.atCanvas).map((r) => r.side);
        findings.push({
          gate: 'clipping',
          severity: 'fail',
          message: canvasSides.length
            ? `${label} is cut off by the ${canvasSides.join(' and ')} edge of the canvas — ${(worst.coverage * 100).toFixed(0)}% of the type's height is solid ink standing on the frame boundary`
            : `${label} is clipped by its own layer rect on the ${cut.map((r) => r.side).join(' and ')} — ${(worst.coverage * 100).toFixed(0)}% of the type's height is ink hard against the ${worst.side} edge of the ${rect.w}×${rect.h}px box, so at least one glyph is sliced through`,
          score: clamp01(0.3 * (1 - worst.coverage)),
          where,
          suggestion: canvasSides.length
            ? `Move "${role}" inward or shorten the copy. A word running off the frame is the most visible defect a thumbnail can have and no amount of grading hides it.`
            : `The laid-out text is wider than the box the compositor gave it: re-run auto-fit against the real slot, reduce tracking, or shorten "${copy ?? role}". Check the SVG viewBox matches the layer rect — a viewport a few pixels short slices the last glyph and the render looks like a typo.`,
        });
      } else if (overflow.length) {
        const worst = overflow.reduce((a, b) => (b.outside > a.outside ? b : a));
        findings.push({
          gate: 'clipping',
          severity: 'fail',
          message: `${label} spills outside its declared rect on the ${overflow.map((r) => r.side).join(' and ')} — ${(worst.outside * 100).toFixed(0)}% of the strip just beyond the ${rect.w}×${rect.h}px box is the same ink`,
          score: 0.25,
          where,
          suggestion: `The layout measured this text smaller than it rendered, so every downstream check (contrast, safe zones, collision) is looking at the wrong rectangle. Re-measure "${role}" with the font that actually rasterised.`,
        });
      } else if (marginal.length) {
        const worst = marginal.reduce((a, b) => (b.coverage > a.coverage ? b : a));
        findings.push({
          gate: 'clipping',
          severity: 'warn',
          message: `${label} sits hard against the ${worst.side} edge of its rect (${(worst.coverage * 100).toFixed(0)}% of the type's height is ink in the last ${BAND}px) — tight enough that one more character, or a font substitution, would clip it`,
          score: 0.6,
          where,
          suggestion: `Leave a side bearing of at least 2% of the slot width around "${role}", or shorten the copy. Renders that clip on one machine and not another usually look exactly like this first.`,
        });
      } else {
        findings.push({
          gate: 'clipping',
          severity: 'pass',
          message: `${label} sits clear of its rect and of the frame (worst edge ${(Math.max(0, ...readings.map((r) => r.coverage)) * 100).toFixed(0)}% ink, ${mask.basis} ink mask)`,
          score: 1,
          where,
        });
      }
    }

    if (findings.length === 0) {
      findings.push({
        gate: 'clipping',
        severity: 'warn',
        message: `None of the ${texts.length + marks.length} placed element${texts.length + marks.length === 1 ? '' : 's'} had a measurable figure/ground split, so clipping could not be checked on any of them`,
        score: 0.6,
        suggestion: 'Record the text colour the compositor used (plan.meta.textRects[].color) so the ink can be separated from the plate.',
      });
    }

    return findings;
  },
};

function offCanvas(rect: PixelRect, width: number, height: number): Side[] {
  const out: Side[] = [];
  if (rect.x < -1) out.push('left');
  if (rect.y < -1) out.push('top');
  if (rect.x + rect.w > width + 1) out.push('right');
  if (rect.y + rect.h > height + 1) out.push('bottom');
  return out;
}

/**
 * Boundary ink on each of the four sides.
 *
 * `coverage` is measured against the ink's own bounding extent — the rows the
 * type actually occupies for a vertical edge, the columns for a horizontal one —
 * so a line box with generous leading does not dilute the reading.
 */
function sides(
  mask: NonNullable<ReturnType<typeof inkMask>>,
  img: { data: Uint8Array; width: number; height: number },
  canvasW: number,
  canvasH: number,
): SideReading[] {
  const { data, rect } = mask;
  const at = (x: number, y: number) => data[y * rect.w + x] === 1;

  const rowsWithInk: number[] = [];
  const colsWithInk: number[] = [];
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (at(x, y)) { rowsWithInk.push(y); break; }
    }
  }
  for (let x = 0; x < rect.w; x++) {
    for (let y = 0; y < rect.h; y++) {
      if (at(x, y)) { colsWithInk.push(x); break; }
    }
  }
  if (rowsWithInk.length === 0 || colsWithInk.length === 0) return [];

  const band = Math.max(1, Math.min(BAND, Math.floor(Math.min(rect.w, rect.h) / 2)));
  const readings: SideReading[] = [];

  const vertical = (side: 'left' | 'right') => {
    // Every column of the band must carry ink somewhere, or this is one stray
    // antialiased column rather than a wall.
    let hits = 0;
    let columnsInked = 0;
    for (let b = 0; b < band; b++) {
      const x = side === 'left' ? b : rect.w - 1 - b;
      let inked = 0;
      for (const y of rowsWithInk) if (at(x, y)) inked++;
      if (inked > 0) columnsInked++;
      hits += inked;
    }
    const coverage = columnsInked === band ? hits / (band * rowsWithInk.length) : 0;
    const x0 = side === 'left' ? rect.x - OVERFLOW_BAND : rect.x + rect.w;
    return {
      side,
      coverage,
      outside: outsideInk(img, mask, { x: x0, y: rect.y, w: OVERFLOW_BAND, h: rect.h }, rowsWithInk.length, canvasW, canvasH),
      atCanvas: side === 'left' ? rect.x <= 1 : rect.x + rect.w >= canvasW - 1,
    } satisfies SideReading;
  };

  const horizontal = (side: 'top' | 'bottom') => {
    let hits = 0;
    let rowsInked = 0;
    for (let b = 0; b < band; b++) {
      const y = side === 'top' ? b : rect.h - 1 - b;
      let inked = 0;
      for (const x of colsWithInk) if (at(x, y)) inked++;
      if (inked > 0) rowsInked++;
      hits += inked;
    }
    const coverage = rowsInked === band ? hits / (band * colsWithInk.length) : 0;
    const y0 = side === 'top' ? rect.y - OVERFLOW_BAND : rect.y + rect.h;
    return {
      side,
      coverage,
      outside: outsideInk(img, mask, { x: rect.x, y: y0, w: rect.w, h: OVERFLOW_BAND }, colsWithInk.length, canvasW, canvasH),
      atCanvas: side === 'top' ? rect.y <= 1 : rect.y + rect.h >= canvasH - 1,
    } satisfies SideReading;
  };

  readings.push(vertical('left'), vertical('right'), horizontal('top'), horizontal('bottom'));
  return readings;
}

/**
 * How much of the strip just outside the rect is the same ink.
 *
 * The mask itself only covers the rect, so the comparison is done by colour: the
 * mean of the ink inside, matched against the strip outside with the same
 * tolerance. Cheap, and specific enough — a glyph that overflows its box is the
 * *same* colour a few pixels further along, whereas the plate it sits on is not.
 */
function outsideInk(
  img: { data: Uint8Array; width: number; height: number },
  mask: NonNullable<ReturnType<typeof inkMask>>,
  strip: { x: number; y: number; w: number; h: number },
  extent: number,
  canvasW: number,
  canvasH: number,
): number {
  const s = clampToImage(strip, Math.min(img.width, canvasW), Math.min(img.height, canvasH));
  if (s.w <= 0 || s.h <= 0 || extent <= 0) return 0;

  let ir = 0, ig = 0, ib = 0, n = 0;
  for (let y = 0; y < mask.rect.h; y++) {
    for (let x = 0; x < mask.rect.w; x++) {
      if (mask.data[y * mask.rect.w + x] !== 1) continue;
      const i = ((mask.rect.y + y) * img.width + (mask.rect.x + x)) * 3;
      ir += img.data[i]!; ig += img.data[i + 1]!; ib += img.data[i + 2]!; n++;
    }
  }
  if (n === 0) return 0;
  const ink = { r: ir / n, g: ig / n, b: ib / n };

  let hits = 0;
  for (let y = s.y; y < s.y + s.h; y++) {
    for (let x = s.x; x < s.x + s.w; x++) {
      const i = (y * img.width + x) * 3;
      const d = Math.hypot(img.data[i]! - ink.r, img.data[i + 1]! - ink.g, img.data[i + 2]! - ink.b);
      if (d < 60) hits++;
    }
  }
  // Normalised by the ink's own extent along the shared edge, matching the
  // `coverage` scale so the two numbers can be compared to each other.
  return hits / Math.max(1, extent * Math.min(OVERFLOW_BAND, Math.max(s.w, s.h)));
}
