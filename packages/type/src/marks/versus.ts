/**
 * The VS mark.
 *
 * The centre mark is the single most-copied element in the genre, and the
 * reason most of them look cheap is that the two team colours are simply
 * butted together. Every style here instead gives the colours a *shape* to
 * meet along — a diagonal, a blade sweep, a crest seam — and puts a dark
 * bevel between them so neither bleeds into the other.
 *
 * All seven styles share the same anatomy: a coloured ground split
 * left/right, a bevel seam, an outline, the lettering, and an optional halo.
 */

import { mix, shade } from '@hexa/core';
import type { VersusMarkOptions, Mark, TextStyle } from '../types.js';
import { createIdScope, canonical } from '../ids.js';
import { attrs, escapeXml, n, px, svgDocument } from '../xml.js';
import { fontStack } from '../fonts.js';
import { measureLine, blockMetrics } from '../measure.js';
import { resolveFace } from '../fonts.js';

const LETTER_FAMILY = 'Anton';

function safeShade(c: string, amt: number): string {
  try {
    return shade(c, amt);
  } catch {
    return c;
  }
}

function safeMix(a: string, b: string, t: number): string {
  try {
    return mix(a, b, t);
  } catch {
    return a;
  }
}

/** Clip halves of a plate to left/right of a diagonal seam. */
function halfClips(scope: ReturnType<typeof createIdScope>, w: number, h: number, lean: number): [string, string] {
  const dx = (h / 2) * Math.tan((lean * Math.PI) / 180);
  const cx = w / 2;
  const left = scope.def('cl', (id) =>
    `<clipPath${attrs({ id })}><polygon${attrs({
      points: `0,0 ${n(cx + dx)},0 ${n(cx - dx)},${n(h)} 0,${n(h)}`,
    })}/></clipPath>`,
  );
  const right = scope.def('cl', (id) =>
    `<clipPath${attrs({ id })}><polygon${attrs({
      points: `${n(cx + dx)},0 ${n(w)},0 ${n(w)},${n(h)} ${n(cx - dx)},${n(h)}`,
    })}/></clipPath>`,
  );
  return [left, right];
}

/** Centred, outlined lettering sized to fit `maxW × maxH`. */
function lettering(
  text: string,
  cx: number,
  cy: number,
  maxW: number,
  maxH: number,
  fillColor: string,
  strokeColor: string,
  skewX: number,
): string {
  if (!text) return '';
  const style: TextStyle = {
    family: LETTER_FAMILY,
    weight: 400,
    size: 100,
    tracking: -0.02,
    case: 'upper',
  };
  const face = resolveFace(LETTER_FAMILY, 400, false);
  const w100 = measureLine(text, style) || 1;
  const size = Math.max(6, Math.min((maxW / w100) * 100, maxH / face.capHeight));
  const sized: TextStyle = { ...style, size };
  const width = measureLine(text, sized);
  const m = blockMetrics([text.toUpperCase()], sized);
  const x = cx - width / 2;
  const y = cy + m.capHeight / 2;
  const strokeW = Math.max(1.5, size * 0.075);

  const common = {
    'font-family': fontStack(LETTER_FAMILY),
    'font-size': size,
    'font-weight': 400,
    'letter-spacing': -0.02 * size,
    'text-anchor': 'start',
  };
  const label = escapeXml(text.toUpperCase());
  const body =
    `<text${attrs({ ...common, x, y, fill: 'none', stroke: strokeColor, 'stroke-width': strokeW, 'stroke-linejoin': 'round' })}>${label}</text>` +
    `<text${attrs({ ...common, x, y, fill: fillColor })}>${label}</text>`;

  return skewX
    ? `<g${attrs({ transform: `translate(${n(cx)},${n(cy)}) skewX(${n(-skewX)}) translate(${n(-cx)},${n(-cy)})` })}>${body}</g>`
    : body;
}

/**
 * Build a VS mark.
 *
 * The returned SVG is square-ish (`size` tall) and self-contained; drop it in
 * as a `LayerSource` of `{ type: 'svg', markup }`.
 */
export function versusMark(opts: VersusMarkOptions): Mark {
  const size = Math.max(8, Number(opts.size) || 160);
  const style = opts.style ?? 'slash';
  const left = opts.leftColor;
  const right = opts.rightColor;
  const text = opts.text ?? 'VS';
  const outline = opts.strokeColor ?? '#0A0A0F';
  const wantGlow = !!opts.glow;

  // Each style declares its own aspect; the mark is `size` tall.
  const aspect: Record<string, number> = {
    slash: 1.55, blade: 2.05, shield: 0.86, bolt: 1.05, circle: 1, plain: 1.45, hex: 1.1,
  };
  // Rounded to serialisation precision so the reported size and the size the
  // document declares are the same number.
  const w = px(size * (aspect[style] ?? 1.4));
  const h = px(size);

  const scope = createIdScope(canonical({ mark: 'versus', style, size, left, right, text, outline, glow: wantGlow }));

  const seam = safeShade(safeMix(left, right, 0.5), -0.32);
  const bevelW = Math.max(2, size * 0.035);
  const strokeW = Math.max(2, size * 0.028);

  // Shared gradients give each half depth instead of reading as flat vinyl.
  const gradFor = (color: string, flip: boolean): string => {
    const id = scope.def('vg', (i) =>
      `<linearGradient${attrs({ id: i, x1: flip ? 1 : 0, y1: 0, x2: flip ? 0 : 1, y2: 1 })}>` +
      `<stop${attrs({ offset: 0, 'stop-color': safeShade(color, 0.14) })}/>` +
      `<stop${attrs({ offset: 0.55, 'stop-color': color })}/>` +
      `<stop${attrs({ offset: 1, 'stop-color': safeShade(color, -0.18) })}/>` +
      `</linearGradient>`,
    );
    return `url(#${id})`;
  };

  const glowId = wantGlow
    ? scope.def('vgl', (id) =>
        `<filter${attrs({
          id, filterUnits: 'userSpaceOnUse',
          x: -size * 0.5, y: -size * 0.5, width: w + size, height: h + size,
          'color-interpolation-filters': 'sRGB',
        })}>` +
        `<feGaussianBlur${attrs({ in: 'SourceAlpha', stdDeviation: size * 0.05, result: 'b' })}/>` +
        `<feFlood${attrs({ 'flood-color': safeMix(left, right, 0.5), 'flood-opacity': 0.9, result: 'c' })}/>` +
        `<feComposite${attrs({ in: 'c', in2: 'b', operator: 'in', result: 'halo' })}/>` +
        `<feMerge><feMergeNode${attrs({ in: 'halo' })}/><feMergeNode${attrs({ in: 'halo' })}/>` +
        `<feMergeNode${attrs({ in: 'SourceGraphic' })}/></feMerge>` +
        `</filter>`,
      )
    : null;

  let body: string;

  switch (style) {
    // ── slash: two parallelograms meeting at a hard diagonal ────────────────
    case 'slash': {
      const lean = 16;
      const [clipL, clipR] = halfClips(scope, w, h, lean);
      const dx = (h / 2) * Math.tan((lean * Math.PI) / 180);
      body =
        `<g${attrs({ 'clip-path': `url(#${clipL})` })}><rect${attrs({ x: 0, y: 0, width: w, height: h, fill: gradFor(left, false) })}/></g>` +
        `<g${attrs({ 'clip-path': `url(#${clipR})` })}><rect${attrs({ x: 0, y: 0, width: w, height: h, fill: gradFor(right, true) })}/></g>` +
        `<line${attrs({ x1: w / 2 + dx, y1: 0, x2: w / 2 - dx, y2: h, stroke: seam, 'stroke-width': bevelW })}/>` +
        `<rect${attrs({ x: strokeW / 2, y: strokeW / 2, width: w - strokeW, height: h - strokeW, fill: 'none', stroke: outline, 'stroke-width': strokeW })}/>` +
        lettering(text, w / 2, h / 2, w * 0.62, h * 0.6, '#FFFFFF', outline, 14);
      break;
    }

    // ── blade: a katana sweep — squared tang, curved sori, chisel point ─────
    case 'blade': {
      // The failure mode here is drawing a lens: two mirrored bulges meeting at
      // both ends. A katana is asymmetric along *both* axes — the spine and the
      // cutting edge run near-parallel (roughly constant width) and arc the
      // same way, the butt end is a squared tang, and only the last tenth of
      // the length tapers to a point.
      // Every extreme is inset by half the outline width: the point is the one
      // place where a clipped stroke is instantly obvious.
      const inset = strokeW / 2 + 1;
      const tangX = inset;
      const tangY = h * 0.93 - inset; // butt end sits low-left
      const thick = h * 0.26;         // blade width, near-constant along the arc
      const rise = h * 0.6;           // total climb from tang to tip (the sori)
      const tipX = w - inset;
      const tipY = tangY - thick - rise;

      const blade =
        `M ${n(tangX)} ${n(tangY)} ` +
        `L ${n(tangX)} ${n(tangY - thick)} ` +                       // squared tang face
        `C ${n(w * 0.34)} ${n(tangY - thick - rise * 0.55)} ` +       // spine, arcing up
        `${n(w * 0.7)} ${n(tangY - thick - rise * 0.86)} ` +
        `${n(tipX)} ${n(tipY)} ` +
        `C ${n(w * 0.7)} ${n(tangY - rise * 0.76)} ` +                // cutting edge, back down
        `${n(w * 0.34)} ${n(tangY - rise * 0.42)} ` +
        `${n(tangX)} ${n(tangY)} Z`;

      const clipId = scope.def('cl', (id) => `<clipPath${attrs({ id })}><path${attrs({ d: blade })}/></clipPath>`);
      const lean = 22;
      const dx = (h / 2) * Math.tan((lean * Math.PI) / 180);
      // Centre of the blade at mid-length, where the lettering rides.
      const bellyX = w * 0.45;
      const bellyY = tangY - thick / 2 - rise * 0.42;

      body =
        `<g${attrs({ 'clip-path': `url(#${clipId})` })}>` +
        `<polygon${attrs({ points: `0,0 ${n(w / 2 + dx)},0 ${n(w / 2 - dx)},${n(h)} 0,${n(h)}`, fill: gradFor(left, false) })}/>` +
        `<polygon${attrs({ points: `${n(w / 2 + dx)},0 ${n(w)},0 ${n(w)},${n(h)} ${n(w / 2 - dx)},${n(h)}`, fill: gradFor(right, true) })}/>` +
        // The hamon — the tempered line above the cutting edge. It is what
        // makes the silhouette read as forged steel rather than a coloured leaf.
        `<path${attrs({
          d: `M ${n(tangX)} ${n(tangY - thick * 0.3)} ` +
             `C ${n(w * 0.34)} ${n(tangY - thick * 0.3 - rise * 0.42)} ` +
             `${n(w * 0.7)} ${n(tangY - thick * 0.35 - rise * 0.76)} ` +
             `${n(w * 0.97)} ${n(tipY + thick * 0.5)}`,
          fill: 'none', stroke: '#FFFFFF', 'stroke-width': Math.max(1, size * 0.016), opacity: 0.45,
        })}/>` +
        `<line${attrs({ x1: w / 2 + dx, y1: 0, x2: w / 2 - dx, y2: h, stroke: seam, 'stroke-width': bevelW })}/>` +
        `</g>` +
        `<path${attrs({ d: blade, fill: 'none', stroke: outline, 'stroke-width': strokeW, 'stroke-linejoin': 'round' })}/>` +
        lettering(text, bellyX, bellyY, w * 0.3, h * 0.34, '#FFFFFF', outline, 16);
      break;
    }

    // ── shield: a crest, split down the middle with a raised seam ───────────
    case 'shield': {
      const inset = strokeW / 2;
      const crest =
        `M ${n(inset)} ${n(h * 0.08)} L ${n(w / 2)} ${n(inset)} L ${n(w - inset)} ${n(h * 0.08)} ` +
        `L ${n(w - inset)} ${n(h * 0.52)} ` +
        `Q ${n(w - inset)} ${n(h * 0.84)} ${n(w / 2)} ${n(h - inset)} ` +
        `Q ${n(inset)} ${n(h * 0.84)} ${n(inset)} ${n(h * 0.52)} Z`;
      const clipId = scope.def('cl', (id) => `<clipPath${attrs({ id })}><path${attrs({ d: crest })}/></clipPath>`);
      body =
        `<g${attrs({ 'clip-path': `url(#${clipId})` })}>` +
        `<rect${attrs({ x: 0, y: 0, width: w / 2, height: h, fill: gradFor(left, false) })}/>` +
        `<rect${attrs({ x: w / 2, y: 0, width: w / 2, height: h, fill: gradFor(right, true) })}/>` +
        `<rect${attrs({ x: 0, y: 0, width: w, height: h * 0.22, fill: '#FFFFFF', opacity: 0.1 })}/>` +
        `<line${attrs({ x1: w / 2, y1: 0, x2: w / 2, y2: h, stroke: seam, 'stroke-width': bevelW })}/>` +
        `</g>` +
        `<path${attrs({ d: crest, fill: 'none', stroke: outline, 'stroke-width': strokeW, 'stroke-linejoin': 'round' })}/>` +
        `<path${attrs({ d: crest, fill: 'none', stroke: '#FFFFFF', 'stroke-width': Math.max(1, strokeW * 0.4), opacity: 0.25, transform: `translate(0,${n(strokeW)})` })}/>` +
        lettering(text, w / 2, h * 0.5, w * 0.6, h * 0.42, '#FFFFFF', outline, 0);
      break;
    }

    // ── bolt: lightning, the two colours meeting across the fracture ────────
    case 'bolt': {
      // Chunky enough to carry lettering across the waist — a hairline bolt
      // looks sharper on its own but leaves the VS nowhere to sit.
      const bolt =
        `M ${n(w * 0.62)} ${n(h * 0.02)} L ${n(w * 0.05)} ${n(h * 0.58)} ` +
        `L ${n(w * 0.4)} ${n(h * 0.58)} L ${n(w * 0.32)} ${n(h * 0.98)} ` +
        `L ${n(w * 0.95)} ${n(h * 0.42)} L ${n(w * 0.58)} ${n(h * 0.42)} Z`;
      const clipId = scope.def('cl', (id) => `<clipPath${attrs({ id })}><path${attrs({ d: bolt })}/></clipPath>`);
      body =
        `<g${attrs({ 'clip-path': `url(#${clipId})` })}>` +
        `<rect${attrs({ x: 0, y: 0, width: w, height: h * 0.5, fill: gradFor(left, false) })}/>` +
        `<rect${attrs({ x: 0, y: h * 0.5, width: w, height: h * 0.5, fill: gradFor(right, true) })}/>` +
        `<line${attrs({ x1: 0, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: seam, 'stroke-width': bevelW })}/>` +
        `</g>` +
        `<path${attrs({ d: bolt, fill: 'none', stroke: outline, 'stroke-width': strokeW, 'stroke-linejoin': 'miter' })}/>` +
        lettering(text, w * 0.5, h * 0.5, w * 0.42, h * 0.24, '#FFFFFF', outline, 12);
      break;
    }

    // ── circle: a coin, split on a diagonal, with an inner ring ─────────────
    case 'circle': {
      const r = Math.min(w, h) / 2 - strokeW / 2;
      const cx = w / 2;
      const cy = h / 2;
      const lean = 18;
      const dx = r * Math.tan((lean * Math.PI) / 180);
      const clipId = scope.def('cl', (id) =>
        `<clipPath${attrs({ id })}><circle${attrs({ cx, cy, r })}/></clipPath>`,
      );
      body =
        `<g${attrs({ 'clip-path': `url(#${clipId})` })}>` +
        `<polygon${attrs({ points: `0,0 ${n(cx + dx)},0 ${n(cx - dx)},${n(h)} 0,${n(h)}`, fill: gradFor(left, false) })}/>` +
        `<polygon${attrs({ points: `${n(cx + dx)},0 ${n(w)},0 ${n(w)},${n(h)} ${n(cx - dx)},${n(h)}`, fill: gradFor(right, true) })}/>` +
        `<line${attrs({ x1: cx + dx, y1: 0, x2: cx - dx, y2: h, stroke: seam, 'stroke-width': bevelW })}/>` +
        `</g>` +
        `<circle${attrs({ cx, cy, r, fill: 'none', stroke: outline, 'stroke-width': strokeW })}/>` +
        `<circle${attrs({ cx, cy, r: r - strokeW * 1.6, fill: 'none', stroke: '#FFFFFF', 'stroke-width': Math.max(1, strokeW * 0.45), opacity: 0.35 })}/>` +
        lettering(text, cx, cy, r * 1.15, r * 0.8, '#FFFFFF', outline, 10);
      break;
    }

    // ── hex: the Hexa house mark — a hexagonal plate with a chevron seam ────
    case 'hex': {
      const cx = w / 2;
      const cy = h / 2;
      const rx = w / 2 - strokeW / 2;
      const ry = h / 2 - strokeW / 2;
      const pts = [0, 1, 2, 3, 4, 5]
        .map((i) => {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          return `${n(cx + rx * Math.cos(a) * 0.98)},${n(cy + ry * Math.sin(a))}`;
        })
        .join(' ');
      const clipId = scope.def('cl', (id) => `<clipPath${attrs({ id })}><polygon${attrs({ points: pts })}/></clipPath>`);
      const chevron = `M ${n(cx - w * 0.2)} 0 L ${n(cx + w * 0.06)} ${n(cy)} L ${n(cx - w * 0.2)} ${n(h)} L ${n(cx + w * 0.26)} ${n(h)} L ${n(cx + w * 0.52)} ${n(cy)} L ${n(cx + w * 0.26)} 0 Z`;
      body =
        `<g${attrs({ 'clip-path': `url(#${clipId})` })}>` +
        `<rect${attrs({ x: 0, y: 0, width: w, height: h, fill: gradFor(left, false) })}/>` +
        `<path${attrs({ d: chevron, fill: gradFor(right, true) })}/>` +
        `<path${attrs({ d: chevron, fill: 'none', stroke: seam, 'stroke-width': bevelW })}/>` +
        `</g>` +
        `<polygon${attrs({ points: pts, fill: 'none', stroke: outline, 'stroke-width': strokeW, 'stroke-linejoin': 'round' })}/>` +
        lettering(text, cx, cy, w * 0.5, h * 0.42, '#FFFFFF', outline, 8);
      break;
    }

    // ── plain: no plate at all — just the lettering, split-coloured ─────────
    case 'plain':
    default: {
      const gradId = scope.def('vg', (id) =>
        `<linearGradient${attrs({ id, x1: 0, y1: 0, x2: 1, y2: 0 })}>` +
        `<stop${attrs({ offset: 0.46, 'stop-color': left })}/>` +
        `<stop${attrs({ offset: 0.54, 'stop-color': right })}/>` +
        `</linearGradient>`,
      );
      body = lettering(text, w / 2, h / 2, w * 0.82, h * 0.7, `url(#${gradId})`, outline, 12);
      break;
    }
  }

  // No baked-in contact shadow: the mark composites over artwork we cannot see,
  // and a painted-on ground ellipse reads as a smudge rather than as weight.
  const wrapped = glowId ? `<g${attrs({ filter: `url(#${glowId})` })}>${body}</g>` : body;
  return { markup: svgDocument(w, h, scope.defs() + wrapped), width: w, height: h };
}
