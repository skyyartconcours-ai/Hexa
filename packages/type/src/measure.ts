/**
 * Measurement and line breaking.
 *
 * Everything here is linear in `style.size`: advances are stored in em and
 * multiplied through at the end. `autoFit`'s binary search depends on that —
 * if measurement were not monotone in size, the search would not converge.
 */

import { HexaError } from '@hexa/core';
import type { TextStyle } from './types.js';
import { resolveFace, exactAdvance, type ResolvedFace } from './fonts.js';
import { tableAdvance, weightWidthFactor } from './metrics.js';

const ELLIPSIS = '…';

export function applyCase(text: string, mode: TextStyle['case']): string {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return text.replace(/\p{L}[\p{L}\p{M}\p{Nd}'’]*/gu, (w) =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      );
    default:
      return text;
  }
}

/**
 * Collapse runs of horizontal whitespace and trim. SVG collapses whitespace in
 * `<text>` by default, so normalising here is what keeps the measured width and
 * the rasterised width in agreement.
 */
export function normaliseLine(text: string): string {
  return text.replace(/[\t\f\v ]+/g, ' ').trim();
}

function requireStyle(style: TextStyle): void {
  if (!style || typeof style.family !== 'string' || !style.family) {
    throw new HexaError('INVALID_REQUEST', 'TextStyle.family is required');
  }
  if (!Number.isFinite(style.size) || style.size <= 0) {
    throw new HexaError('INVALID_REQUEST', `TextStyle.size must be a positive number, got ${String(style.size)}`, {
      hint: 'Sizes are device pixels. Use autoFit() if you want the size chosen for you.',
    });
  }
}

/** Sum of glyph advances for one line, in em (tracking excluded). */
function advanceEm(face: ResolvedFace, line: string, widthFactor: number): number {
  let sum = 0;
  for (const ch of line) {
    const exact = exactAdvance(face, ch);
    if (exact !== null) sum += exact;
    else sum += tableAdvance(face.table, ch) * widthFactor;
  }
  return sum;
}

/**
 * Width of a single line in device pixels, including tracking.
 *
 * Tracking is applied to the n−1 *interior* gaps, not after the final glyph.
 * That matches the ink extent, which is what matters because this package
 * always positions runs with `text-anchor="start"` at an explicitly computed x
 * rather than letting the renderer centre them.
 */
export function measureLine(text: string, style: TextStyle): number {
  requireStyle(style);
  const line = normaliseLine(applyCase(text, style.case));
  if (!line) return 0;

  const face = resolveFace(style.family, style.weight ?? 400, style.italic ?? false);
  const widthFactor = face.exact ? 1 : weightWidthFactor(face.table, style.weight);
  const count = [...line].length;
  const em = advanceEm(face, line, widthFactor);
  const tracking = (style.tracking ?? 0) * Math.max(0, count - 1);
  return Math.max(0, (em + tracking) * style.size);
}

/** Vertical metrics of a block, in device pixels. */
export interface BlockMetrics {
  ascent: number;
  descent: number;
  lineAdvance: number;
  capHeight: number;
  height: number;
}

/**
 * Vertical extent. All-caps text (the esports default) is measured to the cap
 * height rather than the ascender, which is why headlines sit tight in their
 * boxes instead of floating with a band of dead air above them.
 */
export function blockMetrics(lines: string[], style: TextStyle): BlockMetrics {
  const face = resolveFace(style.family, style.weight ?? 400, style.italic ?? false);
  const size = style.size;
  const joined = lines.join('');

  const hasLower = /\p{Ll}/u.test(joined);
  const hasDescender = /[gjpqyçQ,;_@]|\p{Ll}/u.test(joined);

  const ascent = (hasLower ? face.ascent : face.capHeight) * size;
  const descent = (hasDescender ? face.descent : 0) * size;
  const lineAdvance = size * (style.lineHeight ?? 1);
  const rows = Math.max(1, lines.length);
  return {
    ascent,
    descent,
    lineAdvance,
    capHeight: face.capHeight * size,
    height: (rows - 1) * lineAdvance + ascent + descent,
  };
}

/**
 * Block bounds of `text` (honouring embedded newlines) at `style`, excluding
 * stroke, extrusion and plate padding — those are decoration, added by
 * `renderText`. Both dimensions scale exactly linearly with `style.size`.
 */
export function measureText(text: string, style: TextStyle): { width: number; height: number } {
  requireStyle(style);
  const lines = applyCase(text, style.case).split('\n').map(normaliseLine);
  const width = lines.reduce((max, l) => Math.max(max, measureLine(l, { ...style, case: 'none' })), 0);
  return { width, height: blockMetrics(lines, style).height };
}

/** Break `word` mid-glyph when it cannot fit a line on its own. */
function hardBreak(word: string, style: TextStyle, maxWidth: number): string[] {
  const chars = [...word];
  const out: string[] = [];
  let cur = '';
  for (const ch of chars) {
    const next = cur + ch;
    if (cur && measureLine(next, style) > maxWidth) {
      out.push(cur);
      cur = ch;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [word];
}

/** Trim `line` until it plus an ellipsis fits `maxWidth`. */
function ellipsise(line: string, style: TextStyle, maxWidth: number): string {
  if (measureLine(line, style) <= maxWidth) return line;
  const chars = [...line];
  while (chars.length) {
    chars.pop();
    const candidate = chars.join('').replace(/[\s\-–—]+$/, '') + ELLIPSIS;
    if (measureLine(candidate, style) <= maxWidth) return candidate;
  }
  return ELLIPSIS;
}

/**
 * Greedy word wrap. Explicit `\n` always breaks. Words longer than `maxWidth`
 * are broken mid-word rather than allowed to overflow.
 *
 * When `maxLines` is given and the text does not fit, the last kept line is
 * truncated with a single-character ellipsis so the result *always* has at most
 * `maxLines` entries and every entry fits `maxWidth`.
 */
export function wrapText(text: string, style: TextStyle, maxWidth: number, maxLines?: number): string[] {
  requireStyle(style);
  const cased = applyCase(text, style.case);
  // Case is already applied; measuring must not apply it twice (upper/lower are
  // idempotent, but 'title' is not).
  const m: TextStyle = { ...style, case: 'none' };
  const limit = Math.max(1, maxWidth);

  const lines: string[] = [];
  for (const paragraph of cased.split('\n')) {
    const words = normaliseLine(paragraph).split(' ').filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (measureLine(candidate, m) <= limit) {
        cur = candidate;
        continue;
      }
      if (cur) lines.push(cur);
      if (measureLine(word, m) <= limit) {
        cur = word;
      } else {
        const pieces = hardBreak(word, m, limit);
        for (let i = 0; i < pieces.length - 1; i++) lines.push(pieces[i]!);
        cur = pieces[pieces.length - 1] ?? '';
      }
    }
    if (cur) lines.push(cur);
  }

  if (!lines.length) lines.push('');

  if (maxLines !== undefined && Number.isFinite(maxLines) && maxLines >= 1 && lines.length > maxLines) {
    const kept = lines.slice(0, Math.floor(maxLines));
    const last = kept[kept.length - 1] ?? '';
    // Signal the truncation: append the ellipsis, then shrink until it fits.
    kept[kept.length - 1] = ellipsise(`${last}${ELLIPSIS}`, m, limit);
    return kept;
  }
  return lines;
}
