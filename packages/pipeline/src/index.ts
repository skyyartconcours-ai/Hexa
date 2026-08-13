/**
 * @hexa/pipeline — the compiler and orchestrator.
 *
 * A request goes in; QA'd thumbnails come out. The stages are exported
 * individually as well as through {@link generateThumbnail}, because a studio UI
 * wants to run "prepare subjects" without rendering, and every stage is worth
 * testing on its own.
 *
 *   resolve → select → cutout → detect → backplate → compile → render → QA →
 *   retry → emit
 *
 * Integration with the other nine packages goes through `./adapters/*`,
 * published as `@hexa/pipeline/integration`, so a drifting signature has exactly
 * one place to be fixed.
 */

// ── the public API ───────────────────────────────────────────────────────────

export { generateThumbnail } from './generate.js';
export { batchGenerate, summariseBatch, describeRequest, DEFAULT_BATCH_CONCURRENCY } from './batch.js';
export { createDeps, completeDeps, resolveAssetRoot, resolveCacheDir, resolveVisionEndpoint, resolveLogLevel } from './deps.js';
export { compilePlan } from './stages/compile.js';
export { prepareSubjects, reprepareWithAsset } from './stages/prepare.js';
export { resolvePalette, rimColorFor, separation, NEUTRAL_PALETTE } from './palette.js';
export { planVariants, variantAxesFor, variantSeed, variantId, baseAxes, describeVariant, VARIANT_AXES } from './variants.js';

export type {
  PipelineDeps,
  CompileInput,
  PreparedSubject,
  ResolvedPalette,
  VariantAxes,
  BatchOptions,
  CreateDepsOptions,
  StageTimings,
} from './types.js';
export type { VariantAxisSpec } from './variants.js';

// ── stages, individually ─────────────────────────────────────────────────────

export { resolveRequest, suggestionsFor } from './stages/resolve.js';
export { selectAsset, buildQuery } from './stages/select.js';
export { cutoutSubject } from './stages/cutout.js';
export { detectFace, facingFrom } from './stages/detect.js';
export { prepareBackplate } from './stages/backplate.js';
export { renderVariant } from './stages/render.js';
export { runQaStage, buildReferenceGallery, identityFailuresIn, hasHardFailure } from './stages/qa.js';
export { emitVariant, emitContactSheet, ensureOutputDir, creditFor, variantFilename } from './stages/emit.js';
export {
  assignSubjects,
  arrangeTextRect,
  backdropColorBehind,
  collectBuffers,
  projectFaceRect,
  resolveCopy,
  BUFFER_KEYS,
  Z_SCALE,
  Z_SLOT_BASE,
} from './stages/compile.js';

export type { ResolvedRequest } from './stages/resolve.js';
export type { SelectedAsset, SelectOptions } from './stages/select.js';
export type { CutoutResult, CutoutSource, CutoutOptions } from './stages/cutout.js';
export type { DetectResult, DetectSource, DetectOptions } from './stages/detect.js';
export type { BackplateResult, BackplateSource, BackplateOptions } from './stages/backplate.js';
export type { QaStageResult, QaStageOptions } from './stages/qa.js';
export type { EmittedVariant, EmitOptions } from './stages/emit.js';
export type { BufferRef, TextRectRecord, FaceRectRecord } from './stages/compile.js';
export type { PrepareOptions } from './stages/prepare.js';

// ── validation, style and caching ────────────────────────────────────────────

export {
  validateRequest,
  derivedSeed,
  ASPECTS,
  TEXT_ROLES,
  OUTPUT_FORMATS,
  BACKGROUND_MODES,
  SIDES,
  MAX_SUBJECTS,
  MAX_VARIANTS,
} from './validate.js';
export type { NormalisedRequest } from './validate.js';

export {
  LIGHT_RIGS,
  GRADE_BIASES,
  rimFor,
  glowFor,
  gradeFor,
  atmosphereFor,
  backdropFor,
  lightRigFor,
  rigProfile,
  contactShadowParams,
  separationShadow,
} from './style.js';
export type { RimSpec } from './style.js';

export { cacheKey, readCache, writeCache, clearCache, cacheSize, stampFile } from './cache.js';
export type { CacheKeyInput } from './cache.js';

export { imageSize, cropTo, hasAlpha, readFileSafe, sharpDiagnostics } from './image.js';
export type { SharpDiagnostics } from './image.js';

// ── integration surface ──────────────────────────────────────────────────────

export type { AssetLibrary, VisionClient } from './adapters/contracts.js';
export { INTEGRATIONS } from './adapters/contracts.js';
export { registerModule, clearModuleRegistry, moduleHealth } from './adapters/load.js';
export type { ModuleHealth } from './adapters/load.js';
