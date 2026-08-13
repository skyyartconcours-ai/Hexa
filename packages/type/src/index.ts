/**
 * `@hexa/type` — cinematic esports typography.
 *
 * Turns text specs into self-contained SVG for the render package to
 * rasterise. Every function that emits markup returns a complete `<svg>`
 * document ready to drop into a `LayerSource` as `{ type: 'svg', markup }`.
 *
 * ```ts
 * import { autoFit, preset, ensureFonts } from '@hexa/type';
 *
 * await ensureFonts();                       // register whatever is on disk
 * const laid = autoFit({
 *   block: { text: 'Grand Final', style: preset('headline-condensed'), align: 'center' },
 *   box: { x: 0, y: 0, w: 900, h: 220 },
 *   anchor: 'center',
 *   maxLines: 2,
 * });
 * layers.push({ source: { type: 'svg', markup: laid.markup }, rect: laid.box, ... });
 * ```
 *
 * Three invariants this package holds to:
 *
 *  - **Fonts are optional.** Measurement is exact when a real face is
 *    registered and falls back to calibrated class tables otherwise. Nothing
 *    throws because a font is missing; see `fonts/README.md`.
 *  - **Ids never collide.** Gradient and filter ids are namespaced by a hash
 *    of the whole render input *and* a hash of the def's own body, so any
 *    number of text layers can be concatenated into one document safely.
 *  - **Output is deterministic.** Same input, byte-identical markup — which is
 *    what lets the render cache key on the plan.
 */

// ── types ────────────────────────────────────────────────────────────────────
export type {
  TextStyle,
  FillSpec,
  TextBlock,
  LayoutTextInput,
  LaidOutText,
  VersusMarkOptions,
  NameplateOptions,
  StatBadgeOptions,
  FontRegistration,
  Mark,
} from './types.js';

// ── layout and rendering ─────────────────────────────────────────────────────
export { renderText, autoFit } from './text.js';
export { measureText, measureLine, wrapText, applyCase, blockMetrics } from './measure.js';
export type { BlockMetrics } from './measure.js';

// ── marks ────────────────────────────────────────────────────────────────────
export { versusMark } from './marks/versus.js';
export { nameplate } from './marks/nameplate.js';
export { statBadge } from './marks/badge.js';

// ── styles ───────────────────────────────────────────────────────────────────
export { PRESETS, preset } from './presets.js';
export type { PresetName } from './presets.js';

// ── quality ──────────────────────────────────────────────────────────────────
export {
  legibilityScore,
  legibilityScoreForText,
  backgroundLuminanceOf,
  MIN_CAP_RATIO,
  MIN_CONTRAST,
  MAX_HEADLINE_CHARS,
} from './legibility.js';

// ── fonts ────────────────────────────────────────────────────────────────────
export {
  registerFont,
  registeredFonts,
  fontStack,
  ensureFonts,
  clearFonts,
  defaultFontDir,
  exactMeasurementAvailable,
  WANTED_FAMILIES,
} from './fonts.js';

// ── escape hatches for sibling packages ──────────────────────────────────────
export { escapeXml, svgDocument } from './xml.js';
export { createIdScope, canonical } from './ids.js';
export type { IdScope } from './ids.js';
export { classifyFamily, FAMILY_METRICS } from './metrics.js';
export type { FamilyClass, ClassMetrics } from './metrics.js';
