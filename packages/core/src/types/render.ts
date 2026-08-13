/**
 * Render domain — the pixel half.
 *
 * A RenderPlan is a fully-resolved, serialisable description of every layer to
 * composite. It contains no promises and no closures, which means a plan can be
 * cached, diffed between variants, replayed deterministically from a seed, and
 * shipped to a remote worker.
 */

import type { PixelRect } from './layout.js';

export type BlendMode =
  | 'over' | 'add' | 'screen' | 'multiply' | 'overlay' | 'soft-light'
  | 'hard-light' | 'color-dodge' | 'color-burn' | 'lighten' | 'darken'
  | 'difference' | 'exclusion';

export interface Canvas {
  width: number;
  height: number;
  /** Background fill applied before any layer. */
  background: string;
  /** Supersampling factor; render at N× then downsample for clean edges. */
  supersample?: number;
}

/** Colour grading applied as a final pass over the flattened composite. */
export interface GradeSpec {
  /** Multiplicative exposure in stops. */
  exposure?: number;
  contrast?: number;
  saturation?: number;
  /** Temperature shift in mireds; positive is warmer. */
  temperature?: number;
  tint?: number;
  /** Lift/gamma/gain per channel, each `[r,g,b]` around a neutral of 0/1/1. */
  lift?: [number, number, number];
  gamma?: [number, number, number];
  gain?: [number, number, number];
  /** Tint pushed into shadows and highlights — the split-tone that reads
   *  "cinematic" (teal shadows, amber highlights being the classic). */
  shadowTint?: string;
  highlightTint?: string;
  splitToneBalance?: number;
  /** Name of a .cube LUT in the LUT library, applied after the above. */
  lut?: string;
  lutStrength?: number;
  /** Film grain 0–1. */
  grain?: number;
  /** Bloom threshold 0–1 and intensity 0–1. */
  bloomThreshold?: number;
  bloomIntensity?: number;
  /** Lens vignette 0–1. */
  vignette?: number;
  /** Chromatic aberration in pixels at the frame edge. */
  chromaticAberration?: number;
  /** Halation strength — red-channel bleed around highlights. */
  halation?: number;
  /** Letterbox bars as a fraction of height, per bar. */
  letterbox?: number;
}

export type LayerSource =
  | { type: 'file'; path: string }
  | { type: 'buffer'; key: string }
  | { type: 'svg'; markup: string }
  | { type: 'solid'; color: string }
  | { type: 'gradient'; stops: { offset: number; color: string }[]; angle: number }
  | { type: 'radial'; stops: { offset: number; color: string }[]; center: [number, number]; radius: number }
  | { type: 'noise'; seed: number; scale: number; octaves: number }
  | { type: 'generated'; generatorId: string; params: Record<string, unknown> };

export interface LayerEffects {
  blur?: number;
  /** Outer glow radius/colour/intensity — the esports rim halo. */
  glow?: { radius: number; color: string; intensity: number };
  /** Hard outline in px. */
  stroke?: { width: number; color: string };
  /** Drop shadow. */
  shadow?: { dx: number; dy: number; blur: number; color: string; opacity: number };
  /** Directional rim light applied to an alpha cutout. */
  rimLight?: { angle: number; width: number; color: string; intensity: number };
  /** Per-layer tint multiply. */
  tint?: { color: string; amount: number };
  /** Duotone remap of a subject for stylised backgrounds. */
  duotone?: { shadow: string; highlight: string; amount: number };
  /** Motion blur along `angle` degrees. */
  motionBlur?: { angle: number; distance: number };
  /** Per-layer exposure/contrast, applied before compositing. */
  exposure?: number;
  contrast?: number;
  saturation?: number;
}

export interface Layer {
  id: string;
  source: LayerSource;
  /** Destination rect in device pixels. */
  rect: PixelRect;
  z: number;
  opacity: number;
  blend: BlendMode;
  effects?: LayerEffects;
  /** Id of another layer whose alpha masks this one. */
  maskLayerId?: string;
  /** Invert the mask. */
  maskInvert?: boolean;
  rotation?: number;
  flipX?: boolean;
  /** Debug/provenance label surfaced in the layer inspector. */
  label?: string;
}

export interface RenderPlan {
  canvas: Canvas;
  layers: Layer[];
  grade: GradeSpec;
  /** Deterministic seed — same plan + same seed ⇒ byte-identical output. */
  seed: number;
  meta: {
    templateId: string;
    variantId?: string;
    subjects: string[];
    createdAt: string;
    /** Which face-bearing layers must pass identity verification. */
    identityLayers?: string[];
    [key: string]: unknown;
  };
}

export interface RenderResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp' | 'avif';
  /** Milliseconds spent, per pipeline stage. */
  timings: Record<string, number>;
  plan: RenderPlan;
}
