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
 * The signature of a cut glyph is a wall of ink standing on a boundary. Type is
 * laid out inside a line box with horizontal side bearing, so the outermost
 * *columns* of a healthy text rect are background — a couple of antialiased
 * pixels at most. When a glyph is sliced by the layer's viewport (or by the
 * canvas), the cut leaves ink hard against that boundary, spanning most of the
 * rows the type occupies. That is what is measured, per vertical side:
 *
 *   coverage = inked pixels in the outermost 2px band
 *              ÷ pixels of that band within the type's own row extent
 *
 * Normalising by the ink's extent rather than by the whole rect matters: a
 * headline occupies maybe half the height of its line box, and dividing by the
 * box would halve every number and hide a real cut.
 *
 * Deliberately *not* measured: the top and bottom edges of a text rect. Display
 * faces are routinely set with a font size larger than the line box (86px type
 * in a 76px slot is normal in this renderer), so caps sit flush on the top edge
 * of a perfectly good render — measured across the sample renders in this repo,
 * top-edge ink runs at 50–80% on type nobody would call clipped. Horizontal ink
 * on the same renders is 0.00 on every well-fitting rect, which is what makes
 * the left/right reading worth vetoing on.
 *
 * Three distinct failures come out of it, and they want different remedies:
 *   • ink standing on the canvas edge — the layout ran off the frame;
 *   • ink standing on the rect edge — the layer clipped its own text, which is
 *     the auto-fit measuring wrong (the case above);
 *   • ink continuing outside the rect — the text overflowed a box that did not
 *     clip, so it is now sitting on top of whatever is next to it.
 *
 * Marks (logos, badges, sponsor lozenges) go through the same check. A
 * half-sponsor-logo is a contractual problem as well as an ugly one.
 */

import type { QaFinding, PixelRect } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, collectMarkRects, collectTextRects, toNormRect } from '../geom.js';
import { inkMask, loadRgb, parseHexRgb } from '../image.js';
import { declaredText, resolveTextStyle } from '../plan.js';

/** Band, in pixels, taken as "the boundary". Two, not one: a single column can
 *  be pure antialiasing, and a real cut always inks both. */
const BAND = 2;
/**
 * Share of the type's own height standing on the boundary before it counts as a
 * wall of cut ink. A slice through a heavy display face leaves most of the cap
 * height inked in that band; the outermost column of a *complete* glyph tapers
 * (the leg of an R, the tail of an S) well below this.
 */
export const CLIP_COVERAGE = 0.45;
/**
 * Any ink at all in the boundary band, above pure antialiasing. A cut can land
 * anywhere in a word — through a stem it leaves a wall, through the bowl of an S
 * it leaves 20% — so the boundary is also flagged at this much lower level. What
 * it means depends on which boundary: at the canvas edge there is no innocent
 * reading (pixels past it do not exist, so the glyph is gone), at a layer rect
 * there is (the slot may simply be tight), and the severities differ to match.
 */
const TOUCH_COVERAGE = 0.12;
/** Ink found this far outside the declared rect counts as an overflow. */
const OVERFLOW_BAND = 3;
const OVERFLOW_COVERAGE = 0.2;

type Side = 'left' | 'right';

interface SideReading {
  side: Side;
  /** 0–1 of the ink's own extent along that edge. */
  coverage: number;
  /** Ink reaches the outermost column at all — the taper of a complete glyph
   *  stops short of it, a cut does not. */
  touchesEdge: boolean;
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
    const unmeasurable: string[] = [];

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
      if (!mask || !readsAsType(mask)) {
        // No trustworthy figure/ground split — usually a glow or a plate the
        // same colour as the type, which fills the rect corner to corner. Saying
        // "unchecked" is the honest answer; inventing a verdict off a mask that
        // is really the plate would flag every glowing headline as clipped.
        unmeasurable.push(role);
        continue;
      }

      const readings = sides(mask, img, ctx.width, ctx.height);
      const touching = readings.filter((r) => r.touchesEdge && r.coverage >= TOUCH_COVERAGE);
      const cut = touching.filter((r) => r.coverage >= CLIP_COVERAGE || r.atCanvas);
      const overflow = readings.filter((r) => r.outside >= OVERFLOW_COVERAGE);
      const marginal = touching.filter((r) => !cut.includes(r));

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
          message: `${label} spills outside its declared rect on the ${overflow.map((r) => r.side).join(' and ')} — ${(worst.outside * 100).toFixed(0)}% of the type's rows carry the same ink straight on past the ${rect.w}×${rect.h}px box`,
          score: 0.25,
          where,
          suggestion: `The layout measured this text smaller than it rendered, so every downstream check (contrast, safe zones, collision) is looking at the wrong rectangle. Re-measure "${role}" with the font that actually rasterised.`,
        });
      } else if (marginal.length) {
        const worst = marginal.reduce((a, b) => (b.coverage > a.coverage ? b : a));
        findings.push({
          gate: 'clipping',
          severity: 'warn',
          message: `${label} runs right up to the ${worst.side} edge of its rect (ink in the outermost ${BAND}px, covering ${(worst.coverage * 100).toFixed(0)}% of the type's height) — either the last glyph is already shaved or it is one character away from being`,
          score: 0.55,
          where,
          suggestion: `Leave a side bearing of at least 2% of the slot width around "${role}", or shorten the copy. A render that clips on one machine and not another — different font, different rounding — looks exactly like this first.`,
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

    if (unmeasurable.length) {
      findings.push({
        gate: 'clipping',
        severity: 'warn',
        message: `Could not separate ink from background for ${unmeasurable.map((r) => `"${r}"`).join(', ')} — ${unmeasurable.length === 1 ? 'that element was' : 'those elements were'} NOT checked for clipping`,
        score: findings.length === 0 ? 0.5 : 0.7,
        suggestion: 'Usually a glow or plate painted in the same colour as the type, which fills the rect. Record the actual glyph colour in plan.meta.textRects[].color, or drop the glow radius, so the ink can be told from the halo.',
      });
    }

    return findings;
  },
};

/**
 * Does this mask look like type rather than like a filled box?
 *
 * A glow, a lozenge or a gradient plate painted in the declared text colour
 * produces a mask whose bounding box is the rect itself — ink on all four
 * sides — and every edge reading taken from it is meaningless. Real type is
 * inset on at least one axis, because that is what a line box is for.
 */
function readsAsType(mask: NonNullable<ReturnType<typeof inkMask>>): boolean {
  const { data, rect } = mask;
  let minX = rect.w, maxX = -1, minY = rect.h, maxY = -1;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (data[y * rect.w + x] !== 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return false;
  const spanX = (maxX - minX + 1) / rect.w;
  const spanY = (maxY - minY + 1) / rect.h;
  return !(spanX >= 0.95 && spanY >= 0.95);
}

function offCanvas(rect: PixelRect, width: number, height: number): string[] {
  const out: string[] = [];
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
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (at(x, y)) { rowsWithInk.push(y); break; }
    }
  }
  if (rowsWithInk.length === 0) return [];

  const band = Math.max(1, Math.min(BAND, Math.floor(rect.w / 2)));

  const inkColour = meanInk(img, mask);

  const vertical = (side: Side): SideReading => {
    let hits = 0;
    let edgeInked = false;
    for (let b = 0; b < band; b++) {
      const x = side === 'left' ? b : rect.w - 1 - b;
      let inked = 0;
      for (const y of rowsWithInk) if (at(x, y)) inked++;
      if (b === 0 && inked > 0) edgeInked = true;
      hits += inked;
    }
    return {
      side,
      coverage: hits / (band * rowsWithInk.length),
      touchesEdge: edgeInked,
      outside: continuesOutside(img, mask, rowsWithInk, side, inkColour, canvasW, canvasH),
      atCanvas: side === 'left' ? rect.x <= 1 : rect.x + rect.w >= canvasW - 1,
    };
  };

  return [vertical('left'), vertical('right')];
}

function meanInk(
  img: { data: Uint8Array; width: number; height: number },
  mask: NonNullable<ReturnType<typeof inkMask>>,
): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < mask.rect.h; y++) {
    for (let x = 0; x < mask.rect.w; x++) {
      if (mask.data[y * mask.rect.w + x] !== 1) continue;
      const i = ((mask.rect.y + y) * img.width + (mask.rect.x + x)) * 3;
      r += img.data[i]!; g += img.data[i + 1]!; b += img.data[i + 2]!; n++;
    }
  }
  return n === 0 ? { r: 0, g: 0, b: 0 } : { r: r / n, g: g / n, b: b / n };
}

/**
 * Does the ink carry on past the rect?
 *
 * Continuity, not mere presence: a row only counts when the boundary column
 * *inside* the rect is inked and the pixels immediately outside it are the same
 * colour. Presence alone would flag any headline that happens to sit next to
 * another white element; continuity only fires when a stroke walks out of the
 * box, which is what an overflowing text layer looks like.
 */
function continuesOutside(
  img: { data: Uint8Array; width: number; height: number },
  mask: NonNullable<ReturnType<typeof inkMask>>,
  rowsWithInk: number[],
  side: Side,
  ink: { r: number; g: number; b: number },
  canvasW: number,
  canvasH: number,
): number {
  const { data, rect } = mask;
  const w = Math.min(img.width, canvasW);
  const h = Math.min(img.height, canvasH);
  const boundaryX = side === 'left' ? 0 : rect.w - 1;
  const step = side === 'left' ? -1 : 1;
  let rows = 0;

  for (const y of rowsWithInk) {
    if (data[y * rect.w + boundaryX] !== 1) continue;
    const py = rect.y + y;
    if (py < 0 || py >= h) continue;
    let matched = 0;
    for (let d = 1; d <= OVERFLOW_BAND; d++) {
      const px = rect.x + boundaryX + step * d;
      if (px < 0 || px >= w) { matched = 0; break; }
      const i = (py * img.width + px) * 3;
      if (Math.hypot(img.data[i]! - ink.r, img.data[i + 1]! - ink.g, img.data[i + 2]! - ink.b) < 60) matched++;
    }
    if (matched === OVERFLOW_BAND) rows++;
  }
  return rows / Math.max(1, rowsWithInk.length);
}
