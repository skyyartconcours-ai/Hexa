/**
 * Ready-made esports text styles.
 *
 * These are the genre's actual visual language, not a neutral type scale: very
 * heavy condensed caps, tracking pulled tight, hard outlines that hold at
 * 210×118, faux-3D slabs on the hero text and nothing on the small text.
 *
 * Sizes are quoted for a 1280×720 canvas. Scale them, or better, hand the style
 * to `autoFit` and let the box decide.
 */

import { HexaError, didYouMean } from '@hexa/core';
import type { TextStyle } from './types.js';

const INK = '#0A0A0F';
const PAPER = '#FFFFFF';

const PRESETS_DEF = {
  /** Hero line. Grotesque black with a slab and a hard outline — reads at any size. */
  'headline-heavy': {
    family: 'Archivo Black',
    weight: 900,
    size: 132,
    tracking: -0.02,
    lineHeight: 0.94,
    case: 'upper',
    fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#C8CEDA' }] },
    stroke: { width: 7, color: INK, join: 'round' },
    extrude: { depth: 12, angle: 60, color: '#171A24', fade: 0.35 },
    shadow: { dx: 0, dy: 10, blur: 26, color: '#000000', opacity: 0.55 },
    skewX: 0,
  },

  /** Hero line, condensed cut — fits a long tournament name on one row. */
  'headline-condensed': {
    family: 'Anton',
    weight: 400,
    size: 148,
    tracking: -0.012,
    lineHeight: 0.9,
    case: 'upper',
    fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 0.55, color: '#F2F4F8' }, { offset: 1, color: '#AEB6C6' }] },
    stroke: { width: 6, color: INK, join: 'round' },
    extrude: { depth: 14, angle: 62, color: '#12141C', fade: 0.3 },
    shadow: { dx: 0, dy: 8, blur: 22, color: '#000000', opacity: 0.5 },
    skewX: 6,
  },

  /** The small line above the headline: "GRAND FINAL", "WEEK 3". */
  kicker: {
    family: 'Oswald',
    weight: 600,
    size: 34,
    tracking: 0.22,
    lineHeight: 1.1,
    case: 'upper',
    fill: { kind: 'solid', color: '#FFD447' },
    stroke: { width: 2, color: INK, join: 'round' },
    shadow: { dx: 0, dy: 2, blur: 6, color: '#000000', opacity: 0.6 },
  },

  /** Under-portrait player name. Plate guarantees legibility over busy art. */
  'player-name': {
    family: 'Anton',
    weight: 400,
    size: 62,
    tracking: 0.005,
    lineHeight: 0.96,
    case: 'upper',
    fill: { kind: 'solid', color: PAPER },
    stroke: { width: 3.5, color: INK, join: 'round' },
    extrude: { depth: 6, angle: 65, color: '#0E1018', fade: 0.4 },
    shadow: { dx: 0, dy: 4, blur: 12, color: '#000000', opacity: 0.6 },
    skewX: 8,
  },

  /** Three-letter org tag. Wide tracking, small plate, high contrast. */
  'team-tag': {
    family: 'Bebas Neue',
    weight: 700,
    size: 40,
    tracking: 0.16,
    lineHeight: 1,
    case: 'upper',
    fill: { kind: 'solid', color: INK },
    plate: { color: '#FFD447', padX: 14, padY: 7, radius: 2, skewX: 10 },
  },

  /** The centre mark's own lettering — see also `versusMark()`. */
  'vs-mark': {
    family: 'Anton',
    weight: 400,
    size: 96,
    tracking: -0.03,
    lineHeight: 0.9,
    case: 'upper',
    fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#9AA4B8' }] },
    stroke: { width: 6, color: INK, join: 'miter' },
    extrude: { depth: 10, angle: 60, color: '#0B0D14', fade: 0.25 },
    glow: { radius: 18, color: '#FFFFFF', intensity: 0.35 },
    skewX: 10,
  },

  /** Big number in a stat block: "17", "2.4 K/D". */
  'stat-value': {
    family: 'Teko',
    weight: 700,
    size: 68,
    tracking: 0,
    lineHeight: 0.88,
    case: 'upper',
    fill: { kind: 'solid', color: PAPER },
    stroke: { width: 2.5, color: INK, join: 'round' },
    shadow: { dx: 0, dy: 3, blur: 8, color: '#000000', opacity: 0.5 },
  },

  /** The caption under a stat value. Deliberately quiet. */
  'stat-label': {
    family: 'Oswald',
    weight: 500,
    size: 20,
    tracking: 0.18,
    lineHeight: 1.15,
    case: 'upper',
    fill: { kind: 'solid', color: '#B9C0CE' },
    shadow: { dx: 0, dy: 1, blur: 4, color: '#000000', opacity: 0.7 },
  },

  /** Seed or placement numeral — huge, semi-transparent, sits behind a subject. */
  'rank-number': {
    family: 'Anton',
    weight: 400,
    size: 240,
    tracking: -0.05,
    lineHeight: 0.82,
    case: 'upper',
    fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#5C6478' }] },
    stroke: { width: 4, color: '#0A0A0F', join: 'miter' },
    opacity: 0.9,
    skewX: 8,
  },

  /** Small print: broadcast handle, patch version, disclaimer. */
  caption: {
    family: 'Inter',
    weight: 600,
    size: 22,
    tracking: 0.04,
    lineHeight: 1.25,
    case: 'none',
    fill: { kind: 'solid', color: '#E6E9EF' },
    shadow: { dx: 0, dy: 1, blur: 5, color: '#000000', opacity: 0.7 },
  },

  /** Date/time chip. Plate-first, because it is always small. */
  'date-badge': {
    family: 'Chakra Petch',
    weight: 700,
    size: 24,
    tracking: 0.1,
    lineHeight: 1.1,
    case: 'upper',
    fill: { kind: 'solid', color: '#0A0A0F' },
    plate: { color: '#FFFFFF', padX: 12, padY: 6, radius: 3, opacity: 0.95 },
  },

  /** Maximum drama: deep slab, hot gradient, jitter, hard lean. Use once. */
  'drama-scream': {
    family: 'Anton',
    weight: 400,
    size: 170,
    tracking: -0.03,
    lineHeight: 0.86,
    case: 'upper',
    fill: { kind: 'linear', angle: 95, stops: [{ offset: 0, color: '#FFF3C4' }, { offset: 0.45, color: '#FF9D2E' }, { offset: 1, color: '#E01E37' }] },
    stroke: { width: 9, color: '#0A0A0F', join: 'round' },
    extrude: { depth: 22, angle: 63, color: '#2A0710', fade: 0.45 },
    glow: { radius: 34, color: '#FF6A1A', intensity: 0.7 },
    shadow: { dx: 0, dy: 14, blur: 30, color: '#000000', opacity: 0.6 },
    jitter: { rotate: 2.2, offset: 2.5, seed: 1337 },
    skewX: 9,
  },
} as const satisfies Record<string, TextStyle>;

export type PresetName = keyof typeof PRESETS_DEF;

export const PRESETS: Record<string, TextStyle> = PRESETS_DEF as unknown as Record<string, TextStyle>;

function clone<T>(v: T): T {
  return (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))) as T;
}

/**
 * Fetch a preset, optionally overridden. The result is a deep copy, so callers
 * can mutate what they get back without poisoning the shared table — a preset
 * is used by every layer in every template, and one stray mutation would be a
 * genuinely miserable bug to track down.
 */
export function preset(name: keyof typeof PRESETS, overrides?: Partial<TextStyle>): TextStyle {
  const base = PRESETS[name as string];
  if (!base) {
    const names = Object.keys(PRESETS);
    const near = didYouMean(String(name), names);
    throw new HexaError('INVALID_REQUEST', `Unknown text preset "${String(name)}"`, {
      hint: near.length ? `Did you mean ${near.map((s) => `"${s}"`).join(' or ')}?` : `Known presets: ${names.join(', ')}`,
      details: { requested: name, known: names },
    });
  }
  const out = clone(base);
  return overrides ? Object.assign(out, clone(overrides)) : out;
}
