/**
 * Layout construction helpers used by template authors: uniform grids and the
 * diagonal divide that carries most "versus" designs.
 */

import type { Rect, Vec2 } from '@hexa/core';
import { HexaError, clamp, degToRad } from '@hexa/core';

export interface GridOptions {
  /** Gap between cells, in normalised canvas units. */
  gap?: number;
  /** Padding inside the canvas edge, in normalised canvas units. */
  pad?: number;
}

/**
 * Uniform `cols × rows` grid in normalised units, row-major (left→right,
 * top→bottom). Gaps and padding are expressed in canvas units, so on a
 * non-square canvas a "gap" is wider than it is tall — that is intentional:
 * templates are authored against a design aspect and resolved once.
 */
export function makeGrid(cols: number, rows: number, opts: GridOptions = {}): Rect[] {
  const gap = opts.gap ?? 0;
  const pad = opts.pad ?? 0;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new HexaError('INVALID_REQUEST', `makeGrid needs positive integer cols/rows, got ${cols}×${rows}`);
  }
  if (gap < 0 || pad < 0) {
    throw new HexaError('INVALID_REQUEST', 'makeGrid gap/pad must be >= 0');
  }
  const cellW = (1 - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = (1 - pad * 2 - gap * (rows - 1)) / rows;
  if (cellW <= 0 || cellH <= 0) {
    throw new HexaError(
      'INVALID_REQUEST',
      `makeGrid: gap=${gap} pad=${pad} leaves no room for a ${cols}×${rows} grid`,
      { hint: 'Reduce gap or pad, or use fewer cells.' },
    );
  }
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: pad + c * (cellW + gap),
        y: pad + r * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
  }
  return out;
}

export interface DiagonalSplit {
  /** Polygon covering the left region, clockwise from the top-left. */
  left: Vec2[];
  /** Polygon covering the right region, clockwise from the top-left. */
  right: Vec2[];
}

/**
 * Split the canvas with a single straight divide — the backbone of a versus
 * composition.
 *
 * @param angle  Tilt in degrees away from vertical. 0 is a straight vertical
 *               cut; positive leans the TOP of the divide to the right (the
 *               conventional esports "\" wipe). Clamped to ±80° so the line
 *               never degenerates into a horizontal one.
 * @param offset Shift of the divide's midpoint from the canvas centre, in
 *               normalised units (positive = right).
 *
 * Both polygons are returned in normalised 0–1 units and always cover the whole
 * canvas between them, even when the divide runs off the left or right edge.
 */
export function diagonalSplit(angle: number, offset = 0): DiagonalSplit {
  const a = clamp(angle, -80, 80);
  const mid = 0.5 + offset;
  const half = Math.tan(degToRad(a)) * 0.5;
  const xTop = clamp(mid + half, 0, 1);
  const xBottom = clamp(mid - half, 0, 1);
  return {
    left: [
      { x: 0, y: 0 },
      { x: xTop, y: 0 },
      { x: xBottom, y: 1 },
      { x: 0, y: 1 },
    ],
    right: [
      { x: xTop, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: xBottom, y: 1 },
    ],
  };
}
