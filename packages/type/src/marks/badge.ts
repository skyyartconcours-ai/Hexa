/**
 * Stat badges — "17 KILLS", "2.4 K/D", "#1 SEED".
 *
 * These live at the bottom of the size hierarchy and are almost always
 * rendered small, so the design rule is inverted from the headline: the value
 * gets the accent's *contrast partner* (via `readableOn`) rather than the
 * accent itself, and the label is set in the accent so the eye reads
 * value-then-label instead of hunting.
 */

import { shade, readableOn, mix } from '@hexa/core';
import type { StatBadgeOptions, Mark, TextStyle } from '../types.js';
import { createIdScope, canonical } from '../ids.js';
import { attrs, escapeXml, n, px, svgDocument } from '../xml.js';
import { fontStack } from '../fonts.js';
import { measureLine } from '../measure.js';

const VALUE_FAMILY = 'Teko';
const LABEL_FAMILY = 'Oswald';
const INK = '#0A0A0F';

function safe<T extends (...a: never[]) => string>(fn: T, fallback: string, ...args: Parameters<T>): string {
  try {
    return fn(...args);
  } catch {
    return fallback;
  }
}

/** Centred single-line run, shrunk to fit `maxW`. */
function centred(
  text: string,
  cx: number,
  baseline: number,
  size: number,
  maxW: number,
  family: string,
  weight: number,
  tracking: number,
  fill: string,
): string {
  if (!text) return '';
  const probe: TextStyle = { family, weight, size, tracking, case: 'upper' };
  const w = measureLine(text, probe);
  const limit = Math.max(1, maxW);
  const scale = w > limit && w > 0 ? limit / w : 1;
  const finalSize = size * scale;
  const x = cx - (w * scale) / 2;
  return (
    `<text${attrs({
      'font-family': fontStack(family),
      'font-size': finalSize,
      'font-weight': weight,
      'letter-spacing': tracking * finalSize,
      'text-anchor': 'start',
      x, y: baseline, fill,
    })}>${escapeXml(text.toUpperCase())}</text>`
  );
}

export function statBadge(opts: StatBadgeOptions): Mark {
  const w = px(Math.max(16, Number(opts.width) || 160));
  const h = px(Math.max(12, Number(opts.height) || 90));
  const style = opts.style ?? 'pill';
  const accent = opts.accent;
  const label = opts.label ?? '';
  const value = opts.value ?? '';

  const scope = createIdScope(canonical({ mark: 'statBadge', style, w, h, accent, label, value }));

  const deep = safe(shade, accent, accent, -0.4);
  const ground = safe(mix, INK, INK, deep, 0.35);
  const onGround = safe(readableOn, '#FFFFFF', ground);
  const gradId = scope.def('sbg', (id) =>
    `<linearGradient${attrs({ id, x1: 0, y1: 0, x2: 0, y2: 1 })}>` +
    `<stop${attrs({ offset: 0, 'stop-color': safe(shade, ground, ground, 0.06) })}/>` +
    `<stop${attrs({ offset: 1, 'stop-color': safe(shade, ground, ground, -0.06) })}/>` +
    `</linearGradient>`,
  );
  const fillRef = `url(#${gradId})`;
  const strokeW = Math.max(1.5, h * 0.035);

  const valueSize = h * 0.52;
  const labelSize = h * 0.17;
  const valueBaseline = h * 0.6;
  const labelBaseline = h * 0.85;
  const inner = w * 0.86;

  let plate: string;
  switch (style) {
    case 'square':
      plate =
        `<rect${attrs({ x: strokeW / 2, y: strokeW / 2, width: w - strokeW, height: h - strokeW, fill: fillRef, stroke: accent, 'stroke-width': strokeW })}/>` +
        // Corner ticks — cheap, and instantly reads as a HUD element.
        `<path${attrs({
          d: `M ${n(w * 0.06)} ${n(strokeW)} L ${n(strokeW)} ${n(strokeW)} L ${n(strokeW)} ${n(h * 0.22)} ` +
             `M ${n(w - w * 0.06)} ${n(h - strokeW)} L ${n(w - strokeW)} ${n(h - strokeW)} L ${n(w - strokeW)} ${n(h - h * 0.22)}`,
          fill: 'none', stroke: '#FFFFFF', 'stroke-width': strokeW * 0.8, opacity: 0.5,
        })}/>`;
      break;

    case 'shield': {
      const d =
        `M ${n(strokeW)} ${n(h * 0.06)} L ${n(w / 2)} ${n(strokeW)} L ${n(w - strokeW)} ${n(h * 0.06)} ` +
        `L ${n(w - strokeW)} ${n(h * 0.55)} Q ${n(w - strokeW)} ${n(h * 0.86)} ${n(w / 2)} ${n(h - strokeW)} ` +
        `Q ${n(strokeW)} ${n(h * 0.86)} ${n(strokeW)} ${n(h * 0.55)} Z`;
      plate =
        `<path${attrs({ d, fill: fillRef, stroke: accent, 'stroke-width': strokeW, 'stroke-linejoin': 'round' })}/>` +
        `<path${attrs({ d, fill: 'none', stroke: '#FFFFFF', 'stroke-width': strokeW * 0.35, opacity: 0.22, transform: `translate(0,${n(strokeW * 1.4)})` })}/>`;
      break;
    }

    case 'pill':
    default:
      plate =
        `<rect${attrs({
          x: strokeW / 2, y: strokeW / 2, width: w - strokeW, height: h - strokeW,
          rx: (h - strokeW) / 2, ry: (h - strokeW) / 2,
          fill: fillRef, stroke: accent, 'stroke-width': strokeW,
        })}/>` +
        `<rect${attrs({
          x: strokeW * 2, y: strokeW * 1.6, width: w - strokeW * 4, height: h * 0.3,
          rx: h * 0.15, ry: h * 0.15, fill: '#FFFFFF', opacity: 0.07,
        })}/>`;
      break;
  }

  const body =
    plate +
    centred(value, w / 2, valueBaseline, valueSize, inner, VALUE_FAMILY, 700, 0, onGround) +
    centred(label, w / 2, labelBaseline, labelSize, inner, LABEL_FAMILY, 600, 0.18, accent);

  return { markup: svgDocument(w, h, scope.defs() + body), width: w, height: h };
}
