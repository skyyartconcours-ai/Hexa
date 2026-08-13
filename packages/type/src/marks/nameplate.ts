/**
 * Player nameplates.
 *
 * A nameplate has one job: attach a name to a face without competing with it.
 * The hierarchy is always name → team → role, and the accent colour is used
 * for the smallest, most saturated element rather than the largest — a
 * full-bleed accent bar reads as a banner ad, an accent *edge* reads as
 * broadcast graphics.
 *
 * `align: 'right'` mirrors the whole lockup, so the plate for the right-hand
 * player leans into the centre of the frame instead of off the edge.
 */

import { shade, readableOn, mix } from '@hexa/core';
import type { NameplateOptions, Mark, TextStyle } from '../types.js';
import { createIdScope, canonical, type IdScope } from '../ids.js';
import { attrs, escapeXml, n, px, svgDocument } from '../xml.js';
import { fontStack } from '../fonts.js';
import { measureLine } from '../measure.js';
import { resolveFace } from '../fonts.js';

const NAME_FAMILY = 'Anton';
const META_FAMILY = 'Oswald';
const INK = '#0A0A0F';

function safeShade(c: string, amt: number): string {
  try {
    return shade(c, amt);
  } catch {
    return c;
  }
}

function safeReadable(bg: string): string {
  try {
    return readableOn(bg);
  } catch {
    return '#FFFFFF';
  }
}

function safeMix(a: string, b: string, t: number): string {
  try {
    return mix(a, b, t);
  } catch {
    return a;
  }
}

interface LabelOpts {
  family: string;
  weight: number;
  tracking: number;
  fill: string;
  stroke?: { color: string; width: number };
  /** Where `x` sits relative to the drawn run. Defaults to 'left'. */
  anchor?: 'left' | 'center' | 'right';
  /** Shorthand used by the mirrored right-hand lockups. */
  anchorRight?: boolean;
  skewX?: number;
}

/**
 * Fit `text` into `maxW` at no more than `size`, then draw it at a baseline.
 *
 * Shrink-to-fit rather than ellipsis: a nameplate that truncates a player's
 * handle is worse than one that sets it a few points smaller.
 */
function label(text: string, x: number, baseline: number, size: number, maxW: number, o: LabelOpts): string {
  if (!text) return '';
  const probe: TextStyle = { family: o.family, weight: o.weight, size, tracking: o.tracking, case: 'upper' };
  const w = measureLine(text, probe);
  const limit = Math.max(1, maxW);
  const scale = w > limit && w > 0 ? limit / w : 1;
  const finalSize = size * scale;
  const finalW = w * scale;
  const anchor = o.anchor ?? (o.anchorRight ? 'right' : 'left');
  const drawX = anchor === 'right' ? x - finalW : anchor === 'center' ? x - finalW / 2 : x;

  const common = {
    'font-family': fontStack(o.family),
    'font-size': finalSize,
    'font-weight': o.weight,
    'letter-spacing': o.tracking * finalSize,
    'text-anchor': 'start',
  };
  const t = escapeXml(text.toUpperCase());
  const body =
    (o.stroke
      ? `<text${attrs({ ...common, x: drawX, y: baseline, fill: 'none', stroke: o.stroke.color, 'stroke-width': o.stroke.width, 'stroke-linejoin': 'round' })}>${t}</text>`
      : '') +
    `<text${attrs({ ...common, x: drawX, y: baseline, fill: o.fill })}>${t}</text>`;

  if (!o.skewX) return body;
  const cx = drawX + finalW / 2;
  return `<g${attrs({ transform: `translate(${n(cx)},${n(baseline)}) skewX(${n(-o.skewX)}) translate(${n(-cx)},${n(-baseline)})` })}>${body}</g>`;
}

function dropShadow(scope: IdScope, w: number, h: number): string {
  return scope.def('npsh', (id) =>
    `<filter${attrs({
      id, filterUnits: 'userSpaceOnUse',
      x: -h, y: -h, width: w + h * 2, height: h * 3,
      'color-interpolation-filters': 'sRGB',
    })}>` +
    `<feGaussianBlur${attrs({ in: 'SourceAlpha', stdDeviation: h * 0.05, result: 'b' })}/>` +
    `<feOffset${attrs({ in: 'b', dx: 0, dy: h * 0.045, result: 'o' })}/>` +
    `<feFlood${attrs({ 'flood-color': '#000000', 'flood-opacity': 0.55, result: 'c' })}/>` +
    `<feComposite${attrs({ in: 'c', in2: 'o', operator: 'in', result: 's' })}/>` +
    `<feMerge><feMergeNode${attrs({ in: 's' })}/><feMergeNode${attrs({ in: 'SourceGraphic' })}/></feMerge>` +
    `</filter>`,
  );
}

export function nameplate(opts: NameplateOptions): Mark {
  const w = px(Math.max(24, Number(opts.width) || 420));
  const h = px(Math.max(16, Number(opts.height) || 110));
  const style = opts.style ?? 'bar';
  const accent = opts.accent;
  const right = opts.align === 'right';
  const name = opts.name ?? '';
  const team = opts.team ?? '';
  const role = opts.role ?? '';

  const scope = createIdScope(canonical({ mark: 'nameplate', style, w, h, accent, name, team, role, align: opts.align }));

  const dark = safeShade(accent, -0.42);
  const onAccent = safeReadable(accent);
  const plateFill = scope.def('npg', (id) =>
    `<linearGradient${attrs({ id, x1: right ? 1 : 0, y1: 0, x2: right ? 0 : 1, y2: 0.4 })}>` +
    `<stop${attrs({ offset: 0, 'stop-color': safeMix(INK, dark, 0.55) })}/>` +
    `<stop${attrs({ offset: 1, 'stop-color': safeShade(INK, 0.02) })}/>` +
    `</linearGradient>`,
  );

  const pad = h * 0.14;
  const accentW = Math.max(3, h * 0.07);
  const shadowId = dropShadow(scope, w, h);

  // Text origin: lockups grow inwards from the aligned edge.
  const edge = right ? w - pad - accentW * 1.6 : pad + accentW * 1.6;
  const textMaxW = w - pad * 2 - accentW * 2;

  let body = '';

  switch (style) {
    // ── bar: solid plate, accent edge, name over team ──────────────────────
    case 'bar':
    default: {
      const nameSize = h * (role || team ? 0.5 : 0.62);
      const metaSize = h * 0.2;
      const hasMeta = !!(team || role);
      const nameBaseline = hasMeta ? h * 0.55 : h * 0.5 + resolveFace(NAME_FAMILY).capHeight * nameSize * 0.5;
      body =
        `<rect${attrs({ x: 0, y: 0, width: w, height: h, fill: `url(#${plateFill})` })}/>` +
        `<rect${attrs({ x: right ? w - accentW : 0, y: 0, width: accentW, height: h, fill: accent })}/>` +
        `<rect${attrs({ x: 0, y: h - Math.max(1, h * 0.012), width: w, height: Math.max(1, h * 0.012), fill: accent, opacity: 0.5 })}/>` +
        label(name, edge, nameBaseline, nameSize, textMaxW, {
          family: NAME_FAMILY, weight: 400, tracking: 0.005, fill: '#FFFFFF', anchorRight: right, skewX: 6,
        }) +
        (hasMeta
          ? label([team, role].filter(Boolean).join('  ·  '), edge, h * 0.82, metaSize, textMaxW, {
              family: META_FAMILY, weight: 600, tracking: 0.16, fill: accent, anchorRight: right,
            })
          : '');
      break;
    }

    // ── angled: sheared parallelogram, the broadcast lower-third ────────────
    case 'angled': {
      const lean = h * 0.32;
      const pts = right
        ? `${n(lean)},0 ${n(w)},0 ${n(w)},${n(h)} 0,${n(h)}`
        : `0,0 ${n(w - lean)},0 ${n(w)},${n(h)} 0,${n(h)}`;
      const accentPts = right
        ? `${n(w - accentW * 2.4)},0 ${n(w)},0 ${n(w)},${n(h)} ${n(w - accentW * 2.4 - lean)},${n(h)}`
        : `0,0 ${n(accentW * 2.4)},0 ${n(accentW * 2.4 + lean)},${n(h)} ${n(lean)},${n(h)}`;
      const nameSize = h * (team || role ? 0.46 : 0.58);
      body =
        `<polygon${attrs({ points: pts, fill: `url(#${plateFill})` })}/>` +
        `<polygon${attrs({ points: accentPts, fill: accent })}/>` +
        label(name, right ? w - pad * 1.6 : pad + accentW * 3.2, h * 0.55, nameSize, textMaxW - accentW * 2, {
          family: NAME_FAMILY, weight: 400, tracking: 0.005, fill: '#FFFFFF', anchorRight: right, skewX: 10,
        }) +
        (team || role
          ? label([team, role].filter(Boolean).join('  ·  '), right ? w - pad * 1.6 : pad + accentW * 3.2, h * 0.83, h * 0.19, textMaxW - accentW * 2, {
              family: META_FAMILY, weight: 600, tracking: 0.16, fill: accent, anchorRight: right,
            })
          : '');
      break;
    }

    // ── stacked: team tag chip above a big name, no full plate ─────────────
    case 'stacked': {
      const chipH = h * 0.28;
      const chipText = team || role || '';
      const chipW = chipText
        ? Math.min(w * 0.7, measureLine(chipText, { family: META_FAMILY, weight: 700, size: chipH * 0.56, tracking: 0.16, case: 'upper' }) + chipH * 0.9)
        : 0;
      const chipX = right ? w - chipW : 0;
      body =
        (chipText
          ? `<rect${attrs({ x: chipX, y: 0, width: chipW, height: chipH, fill: accent, rx: Math.max(1, chipH * 0.12) })}/>` +
            label(chipText, right ? w - chipH * 0.45 : chipH * 0.45, chipH * 0.72, chipH * 0.56, chipW - chipH * 0.9, {
              family: META_FAMILY, weight: 700, tracking: 0.16, fill: onAccent, anchorRight: right,
            })
          : '') +
        label(name, right ? w : 0, h * 0.94, h * 0.68, w, {
          family: NAME_FAMILY, weight: 400, tracking: 0, fill: '#FFFFFF',
          stroke: { color: INK, width: Math.max(2, h * 0.035) }, anchorRight: right, skewX: 8,
        }) +
        (role && team
          ? label(role, right ? w : 0, h * 0.99 + h * 0.16, h * 0.16, w, {
              family: META_FAMILY, weight: 600, tracking: 0.18, fill: accent, anchorRight: right,
            })
          : '');
      break;
    }

    // ── minimal: a rule and a name. Nothing else. ──────────────────────────
    case 'minimal': {
      const ruleY = h * 0.86;
      const ruleW = Math.min(w * 0.42, h * 1.6);
      body =
        label(name, right ? w : 0, h * 0.66, h * 0.56, w, {
          family: NAME_FAMILY, weight: 400, tracking: 0.01, fill: '#FFFFFF',
          stroke: { color: INK, width: Math.max(1.5, h * 0.028) }, anchorRight: right, skewX: 4,
        }) +
        `<rect${attrs({ x: right ? w - ruleW : 0, y: ruleY, width: ruleW, height: Math.max(2, h * 0.035), fill: accent })}/>` +
        (team || role
          ? label([team, role].filter(Boolean).join('  ·  '), right ? w : 0, h * 0.99, h * 0.15, w, {
              family: META_FAMILY, weight: 600, tracking: 0.2, fill: '#C9CFDB', anchorRight: right,
            })
          : '');
      break;
    }

    // ── ticket: perforated stub, accent block carrying the team tag ────────
    case 'ticket': {
      const stubW = Math.min(w * 0.3, h * 1.15);
      const stubX = right ? w - stubW : 0;
      const perfX = right ? w - stubW : stubW;
      const notch = h * 0.11;
      const bodyX = right ? 0 : stubW;
      const bodyW = w - stubW;
      body =
        `<rect${attrs({ x: 0, y: 0, width: w, height: h, fill: `url(#${plateFill})`, rx: h * 0.08 })}/>` +
        `<rect${attrs({ x: stubX, y: 0, width: stubW, height: h, fill: accent, rx: h * 0.08 })}/>` +
        `<rect${attrs({ x: right ? stubX : stubX + stubW - h * 0.08, y: 0, width: h * 0.08, height: h, fill: accent })}/>` +
        `<circle${attrs({ cx: perfX, cy: 0, r: notch, fill: INK })}/>` +
        `<circle${attrs({ cx: perfX, cy: h, r: notch, fill: INK })}/>` +
        `<line${attrs({
          x1: perfX, y1: notch * 1.2, x2: perfX, y2: h - notch * 1.2,
          stroke: INK, 'stroke-width': Math.max(1, h * 0.02), 'stroke-dasharray': `${n(h * 0.07)} ${n(h * 0.06)}`, opacity: 0.55,
        })}/>` +
        label(team || role || name.slice(0, 3), stubX + stubW / 2, h * 0.62, h * 0.34, stubW * 0.8, {
          family: META_FAMILY, weight: 700, tracking: 0.06, fill: onAccent, anchor: 'center',
        }) +
        label(name, right ? bodyX + bodyW - h * 0.22 : bodyX + h * 0.22, h * 0.62, h * 0.44, bodyW - h * 0.44, {
          family: NAME_FAMILY, weight: 400, tracking: 0.01, fill: '#FFFFFF', anchorRight: right, skewX: 6,
        }) +
        (role
          ? label(role, right ? bodyX + bodyW - h * 0.22 : bodyX + h * 0.22, h * 0.86, h * 0.16, bodyW - h * 0.44, {
              family: META_FAMILY, weight: 600, tracking: 0.2, fill: accent, anchorRight: right,
            })
          : '');
      break;
    }
  }

  return {
    markup: svgDocument(w, h, scope.defs() + `<g${attrs({ filter: `url(#${shadowId})` })}>${body}</g>`),
    width: w,
    height: h,
  };
}
