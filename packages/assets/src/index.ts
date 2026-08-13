/**
 * `@hexa/assets` — the licensed reference library.
 *
 * Hexa's central rule is that a generative model never invents a human face:
 * every face pixel in a render traces back to a real, licensed photograph. This
 * package is the machinery that makes that rule operable —
 *
 *   library.ts     the manifest-backed store (atomic writes, filtered ranking)
 *   scoring.ts     kind-weighted quality + query-weighted ranking
 *   ingest.ts      ML-free pixel metrics, dHash de-duplication, directory walk
 *   provenance.ts  licence rules, the publish gate, attribution lines
 *   placeholder.ts schematic stand-ins so the pipeline runs with zero photos
 *   paths.ts       path resolution that cannot escape the library root
 */

export {
  AssetLibrary,
  MANIFEST_VERSION,
  COVERAGE_MIN_QUALITY,
  COVERAGE_REQUIRED_KINDS,
} from './library.js';
export type { AddAssetInput, AddAssetOptions, LibraryStats, CoverageReport } from './library.js';

export {
  MANIFEST_FILENAME,
  SUPPORTED_EXTENSIONS,
  RESERVED_FILENAMES,
  normaliseRoot,
  isInside,
  resolveInRoot,
  toRelative,
  manifestPath,
  extensionOf,
  isSupportedImage,
  isReservedFile,
  slugify,
  libraryRelativePath,
} from './paths.js';

export {
  scoreAsset,
  rankAssets,
  computeQuality,
  explainScore,
  qualityTerms,
  facingOf,
  facingMatches,
  recencyBonus,
  isFaceless,
  sharpnessTerm,
  resolutionTerm,
  faceAreaTerm,
  frontalityTerm,
  occlusionTerm,
  contrastTerm,
  KIND_WEIGHTS,
  FACE_KINDS,
  YAW_FRONT_THRESHOLD,
  FACING_MISMATCH_PENALTY,
  RECENCY_MAX_BONUS,
  RECENCY_HORIZON_DAYS,
} from './scoring.js';
export type { Facing, QualityTerms, QualityWeights, ScoreBreakdown } from './scoring.js';

export {
  LICENCE_RULES,
  licenceRule,
  licenceRequiresCredit,
  isPublishable,
  creditLine,
  publishBlockers,
  licenceObligations,
  assertPublishable,
} from './provenance.js';
export type { LicenceRule } from './provenance.js';

export {
  generatePlaceholder,
  buildPlaceholderSvg,
  ensurePlaceholderAsset,
  PLACEHOLDER_TAG,
} from './placeholder.js';
export type { PlaceholderOptions, PlaceholderAssetOptions } from './placeholder.js';

export {
  ingestDirectory,
  computeBasicMetrics,
  computeDHash,
  hammingDistance,
  findDuplicate,
  contentHash,
  listImageFiles,
  inferKind,
  inferPlayerId,
  ANALYSIS_MAX_DIM,
  DEFAULT_DUPLICATE_DISTANCE,
} from './ingest.js';
export type { IngestDefaults, IngestResult } from './ingest.js';
