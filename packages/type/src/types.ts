/**
 * Typography domain types.
 *
 * A `TextStyle` is a complete, serialisable description of one esports text
 * treatment — the heavy condensed caps, the hard outline, the faux-3D slab, the
 * neon halo. Nothing here is a promise or a closure, so a style survives JSON
 * round-tripping and can be diffed between template variants.
 */

import type { PixelRect, Anchor } from '@hexa/core';

/** How the glyph interiors are painted. */
export type FillSpec =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; stops: { offset: number; color: string }[]; angle: number }
  | { kind: 'radial'; stops: { offset: number; color: string }[] }
  | { kind: 'stripe'; colors: [string, string]; width: number; angle: number };

export interface TextStyle {
  family: string;
  weight?: number;
  italic?: boolean;
  /** Font size in device pixels (em box, not cap height). */
  size: number;
  /** Letter spacing in em. Negative is the tight esports default. */
  tracking?: number;
  /** Baseline-to-baseline distance as a multiple of `size`. */
  lineHeight?: number;
  case?: 'upper' | 'lower' | 'title' | 'none';
  fill?: FillSpec;
  stroke?: { width: number; color: string; join?: 'round' | 'miter' | 'bevel' };
  /** Faux-3D extrusion: repeated offset copies behind the face. */
  extrude?: { depth: number; angle: number; color: string; fade?: number };
  shadow?: { dx: number; dy: number; blur: number; color: string; opacity: number };
  glow?: { radius: number; color: string; intensity: number };
  /** Skew in degrees — the classic esports forward lean (positive = top leans right). */
  skewX?: number;
  /** Per-character random rotation/offset for a rough, aggressive look. */
  jitter?: { rotate?: number; offset?: number; seed?: number };
  /** Draw a solid plate behind the text for guaranteed legibility. */
  plate?: { color: string; padX: number; padY: number; radius?: number; opacity?: number; skewX?: number };
  opacity?: number;
}

export interface TextBlock {
  text: string;
  style: TextStyle;
  align?: 'left' | 'center' | 'right';
}

export interface LayoutTextInput {
  block: TextBlock;
  /** Destination rect in device pixels. The emitted SVG is exactly this size. */
  box: PixelRect;
  anchor?: Anchor;
  /** Word-wrap to the box width. Defaults to true. */
  wrap?: boolean;
  /** Hard cap on line count; the last line is ellipsised when it is exceeded. */
  maxLines?: number;
}

export interface LaidOutText {
  /**
   * A complete, self-contained `<svg>` document of exactly `box.w × box.h`,
   * ready to drop into a `LayerSource` as `{ type: 'svg', markup }`.
   */
  markup: string;
  /** Measured content bounds, including stroke, extrusion and plate padding. */
  width: number;
  height: number;
  lines: string[];
  /** The size actually used — differs from `style.size` after `autoFit`. */
  fontSize: number;
  box: PixelRect;
}

export interface VersusMarkOptions {
  size: number;
  style?: 'slash' | 'shield' | 'bolt' | 'blade' | 'circle' | 'plain' | 'hex';
  leftColor: string;
  rightColor: string;
  text?: string;
  strokeColor?: string;
  glow?: boolean;
}

export interface NameplateOptions {
  name: string;
  team?: string;
  role?: string;
  accent: string;
  width: number;
  height: number;
  align: 'left' | 'right';
  style?: 'bar' | 'angled' | 'stacked' | 'minimal' | 'ticket';
}

export interface StatBadgeOptions {
  label: string;
  value: string;
  accent: string;
  width: number;
  height: number;
  style?: 'pill' | 'square' | 'shield';
}

export interface FontRegistration {
  family: string;
  path: string;
  weight?: number;
  italic?: boolean;
}

/** A rendered SVG fragment plus the size of the box it was drawn into. */
export interface Mark {
  markup: string;
  width: number;
  height: number;
}
