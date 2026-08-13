/**
 * Paint servers and filters.
 *
 * Two deliberate choices here, both about surviving real rasterisers
 * (librsvg via sharp, resvg) rather than looking right in a browser:
 *
 *  - Gradients use `gradientUnits="userSpaceOnUse"` spanning the whole text
 *    block, not `objectBoundingBox`. A three-line headline then gets one
 *    continuous ramp instead of three independent ones.
 *  - Filters use `filterUnits="userSpaceOnUse"` with an explicitly inflated
 *    region. Percentage regions on a wide, short text bbox clip large blurs
 *    vertically, which shows up as a glow with a flat top edge.
 */

import { withAlpha } from '@hexa/core';
import type { FillSpec, TextStyle } from './types.js';
import { attrs, n } from './xml.js';
import type { IdScope } from './ids.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function sortedStops(stops: { offset: number; color: string }[]): { offset: number; color: string }[] {
  return [...stops]
    .map((s) => ({ offset: Math.max(0, Math.min(1, Number(s.offset) || 0)), color: String(s.color) }))
    .sort((a, b) => a.offset - b.offset);
}

function stopMarkup(stops: { offset: number; color: string }[]): string {
  return stops.map((s) => `<stop${attrs({ offset: s.offset, 'stop-color': s.color })}/>`).join('');
}

/**
 * Resolve a `FillSpec` to an SVG paint value — a colour literal or `url(#id)`.
 * `box` is the user-space extent the gradient should span.
 */
export function resolveFill(scope: IdScope, fill: FillSpec | undefined, box: Box): string {
  if (!fill) return '#FFFFFF';

  switch (fill.kind) {
    case 'solid':
      return fill.color;

    case 'linear': {
      const stops = sortedStops(fill.stops);
      if (!stops.length) return '#FFFFFF';
      if (stops.length === 1) return stops[0]!.color;
      // 0° runs left→right, angles increase clockwise, matching LayerSource.
      const rad = ((Number(fill.angle) || 0) * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      // Project the box onto the gradient axis so the ramp covers it exactly.
      const half = (Math.abs(dx) * box.w + Math.abs(dy) * box.h) / 2;
      const id = scope.def('lg', (i) =>
        `<linearGradient${attrs({
          id: i,
          gradientUnits: 'userSpaceOnUse',
          x1: cx - dx * half, y1: cy - dy * half,
          x2: cx + dx * half, y2: cy + dy * half,
        })}>${stopMarkup(stops)}</linearGradient>`,
      );
      return `url(#${id})`;
    }

    case 'radial': {
      const stops = sortedStops(fill.stops);
      if (!stops.length) return '#FFFFFF';
      if (stops.length === 1) return stops[0]!.color;
      const id = scope.def('rg', (i) =>
        `<radialGradient${attrs({
          id: i,
          gradientUnits: 'userSpaceOnUse',
          cx: box.x + box.w / 2,
          cy: box.y + box.h / 2,
          r: Math.max(1, Math.hypot(box.w, box.h) / 2),
        })}>${stopMarkup(stops)}</radialGradient>`,
      );
      return `url(#${id})`;
    }

    case 'stripe': {
      const w = Math.max(0.5, Number(fill.width) || 8);
      const [a, b] = fill.colors;
      const id = scope.def('sp', (i) =>
        `<pattern${attrs({
          id: i,
          patternUnits: 'userSpaceOnUse',
          width: w * 2,
          height: w * 2,
          patternTransform: `rotate(${n(Number(fill.angle) || 0)})`,
        })}>` +
        `<rect${attrs({ x: 0, y: 0, width: w * 2, height: w * 2, fill: a })}/>` +
        `<rect${attrs({ x: 0, y: 0, width: w, height: w * 2, fill: b })}/>` +
        `</pattern>`,
      );
      return `url(#${id})`;
    }

    default:
      return '#FFFFFF';
  }
}

/**
 * Drop shadow, hand-rolled from primitives rather than `feDropShadow` — the
 * shorthand is SVG 2 and support across rasterisers is uneven.
 *
 * Applied by wrapping the artwork; the result is shadow *under* source.
 */
export function shadowFilter(scope: IdScope, s: NonNullable<TextStyle['shadow']>, box: Box): string {
  const blur = Math.max(0, s.blur) / 2;
  const pad = Math.max(Math.abs(s.dx), Math.abs(s.dy)) + blur * 4 + 8;
  return scope.def('sh', (i) =>
    `<filter${attrs({
      id: i, filterUnits: 'userSpaceOnUse',
      x: box.x - pad, y: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2,
      'color-interpolation-filters': 'sRGB',
    })}>` +
    `<feGaussianBlur${attrs({ in: 'SourceAlpha', stdDeviation: blur, result: 'b' })}/>` +
    `<feOffset${attrs({ in: 'b', dx: s.dx, dy: s.dy, result: 'o' })}/>` +
    `<feFlood${attrs({ 'flood-color': s.color, 'flood-opacity': Math.max(0, Math.min(1, s.opacity)), result: 'c' })}/>` +
    `<feComposite${attrs({ in: 'c', in2: 'o', operator: 'in', result: 's' })}/>` +
    `<feMerge><feMergeNode${attrs({ in: 's' })}/><feMergeNode${attrs({ in: 'SourceGraphic' })}/></feMerge>` +
    `</filter>`,
  );
}

/**
 * Outer glow.
 *
 * The final `operator="out"` knocks the source silhouette back out of the
 * halo, leaving only the part that spills beyond the glyphs. That is what lets
 * the glow be painted *last* — the spec order is extrude, stroke, fill, glow —
 * without a blurred copy veiling the fill underneath it.
 */
export function glowFilter(scope: IdScope, g: NonNullable<TextStyle['glow']>, box: Box): string {
  const r = Math.max(0.5, g.radius);
  const spread = Math.max(0, Math.min(r * 0.35, 6));
  const blur = r / 2;
  const pad = r * 3 + 12;
  const intensity = Math.max(0, Math.min(1, g.intensity));
  return scope.def('gl', (i) =>
    `<filter${attrs({
      id: i, filterUnits: 'userSpaceOnUse',
      x: box.x - pad, y: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2,
      'color-interpolation-filters': 'sRGB',
    })}>` +
    (spread > 0.1
      ? `<feMorphology${attrs({ in: 'SourceAlpha', operator: 'dilate', radius: spread, result: 'd' })}/>`
      : `<feOffset${attrs({ in: 'SourceAlpha', dx: 0, dy: 0, result: 'd' })}/>`) +
    `<feGaussianBlur${attrs({ in: 'd', stdDeviation: blur, result: 'b' })}/>` +
    `<feFlood${attrs({ 'flood-color': g.color, 'flood-opacity': 1, result: 'c' })}/>` +
    `<feComposite${attrs({ in: 'c', in2: 'b', operator: 'in', result: 'halo' })}/>` +
    // Stack the halo on itself so `intensity` reads as brightness, not just alpha.
    `<feComponentTransfer${attrs({ in: 'halo', result: 'hot' })}>` +
    `<feFuncA${attrs({ type: 'linear', slope: 0.35 + intensity * 1.65 })}/>` +
    `</feComponentTransfer>` +
    `<feComposite${attrs({ in: 'hot', in2: 'SourceAlpha', operator: 'out' })}/>` +
    `</filter>`,
  );
}

/** `rgba()` string for a colour plus opacity — used for extrusion fades. */
export function fade(color: string, alpha: number): string {
  try {
    return withAlpha(color, alpha);
  } catch {
    return color; // Named colours and `url(#…)` are not ours to reinterpret.
  }
}
