/**
 * @hexa/render — the pixel engine.
 *
 * Takes a fully-resolved `RenderPlan` from @hexa/core and produces a graded,
 * encoded frame. The public surface is deliberately small:
 *
 *   renderPlan(plan, opts)          the whole pipeline
 *   renderLayer(layer, canvas, ctx) one layer, for previews and tooling
 *   applyGrade(image, grade, …)     the colour pass on its own
 *   exportImage / contactSheet      encoding and review surfaces
 *   generators / registerGenerator  procedural FX sources
 *   effect primitives               individually testable, individually useful
 *
 * Everything is deterministic in `plan.seed`: same plan, same bytes.
 */

export { renderPlan } from './plan.js';
export { renderLayer, renderLayerRaw, type RenderedLayer } from './layer.js';
export { applyGrade, applyGradeRaw } from './grade.js';
export { exportImage, exportRaw, contactSheet, debugOverlaySvg } from './export.js';

export { generators, registerGenerator, resolveGenerator, generatorIds } from './generators/index.js';

// ── Effect primitives ────────────────────────────────────────────────────────
export { rimLight, lightWrap, outerGlow, dropShadow, strokeAlpha } from './effects/edge.js';
export { rimLightRaw, lightWrapRaw, outerGlowRaw, dropShadowRaw, strokeAlphaRaw } from './effects/edge.js';
export { duotone, motionBlur, tintRaw, toneRaw, duotoneRaw, motionBlurRaw } from './effects/color.js';
export {
  bloom,
  halation,
  chromaticAberration,
  filmGrain,
  vignette,
  bloomRaw,
  halationRaw,
  chromaticAberrationRaw,
  filmGrainRaw,
  vignetteRaw,
} from './effects/optical.js';

// ── LUTs ─────────────────────────────────────────────────────────────────────
export { applyLut, applyLutRaw, parseCube, buildLut, sampleLut, BUILTIN_LUTS, type Lut3D } from './lut.js';

// ── Analysis / low-level helpers (used by @hexa/qa and template tooling) ─────
export { alphaBounds } from './alpha.js';
export { createNoise, type NoiseField } from './noise.js';
export { BLEND_FUNCS, manualComposite, compositeLayer } from './blend.js';
export {
  type RawImage,
  toRaw,
  encodePng,
  rawToSharp,
  solidRaw,
  alphaPlane,
  dilate,
  erode,
  blurRaw,
} from './raw.js';
export { gradientSvg, radialSvg, resolveSource } from './sources.js';
export { startProfile, endProfile, snapshotProfile, profiling, type Profile, type ProfileEntry } from './profile.js';

export type { RenderOptions, RenderContext, Generator, PixelRect } from './types.js';
