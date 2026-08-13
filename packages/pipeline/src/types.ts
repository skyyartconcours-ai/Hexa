/**
 * Pipeline types.
 *
 * The public shapes named in the package contract live here, plus the internal
 * state the stages hand to each other. Where a declared interface needed extra
 * information to do its job (variant axes, retry candidates, provenance for the
 * credit line) the extra fields are **optional additions** — code written
 * against the declared shape keeps compiling.
 */

import type {
  AspectPreset,
  BackgroundRequest,
  FaceBox,
  FaceLandmarks,
  GradeSpec,
  LightRig,
  Logger,
  PixelRect,
  Player,
  QaRequest,
  ReferenceAsset,
  StyleSpec,
  SubjectRequest,
  Team,
  TextRole,
  ThumbnailTemplate,
} from '@hexa/core';
import type { AssetLibrary, VisionClient } from './adapters/contracts.js';

/** Everything the pipeline needs from the outside world, injected once. */
export interface PipelineDeps {
  library: AssetLibrary;
  vision: VisionClient;
  logger: Logger;
  /** AI provider id for backplates; undefined uses the configured default. */
  aiProvider?: string;
  /** Where cutouts and other derived artefacts are memoised. */
  cacheDir?: string;
}

/** The five colours every layer, glow and grade is derived from. */
export interface ResolvedPalette {
  left: string;
  right: string;
  accent: string;
  dark: string;
  light: string;
}

/**
 * A subject that is ready to composite: a real player, a real photograph, and
 * the geometry needed to place their face precisely.
 */
export interface PreparedSubject {
  player: Player;
  team: Team;
  asset: ReferenceAsset;
  /** RGBA cutout bytes. Always present — a placeholder silhouette if need be. */
  cutout: Buffer;
  faceBox?: FaceBox;
  landmarks?: FaceLandmarks;
  side: 'left' | 'right' | 'center';
  accent: string;
  index: number;

  // ── optional additions ────────────────────────────────────────────────────
  /** Intrinsic size of `cutout`. */
  size?: { width: number; height: number };
  /** Alpha bounds inside `cutout`, for grounding and contact shadows. */
  contentBox?: PixelRect;
  /** True when `asset` is a synthesised stand-in, not a photograph. */
  placeholder?: boolean;
  /** Which way the subject looks, from head yaw. Drives mirroring decisions. */
  facing?: 'left' | 'right' | 'front';
  /** Head yaw in degrees; negative looks screen-left. */
  yaw?: number;
  /** Ranked runners-up, used when the identity gate rejects the first pick. */
  alternates?: ReferenceAsset[];
  /** Skip identity verification for this subject (silhouette treatments). */
  anonymous?: boolean;
  /** Non-fatal problems encountered while preparing this subject. */
  warnings?: string[];
}

/**
 * Everything `compilePlan` needs. Deliberately closed over no I/O beyond `deps`:
 * given the same input the same plan comes out, which is what makes variants
 * diffable and renders cacheable.
 */
export interface CompileInput {
  template: ThumbnailTemplate;
  subjects: PreparedSubject[];
  text: Partial<Record<TextRole, string>>;
  aspect: AspectPreset;
  seed: number;
  palette: ResolvedPalette;
  /** Pre-rendered background plate (AI or file); else a procedural backdrop. */
  backplate?: Buffer;
  deps: PipelineDeps;

  // ── optional additions ────────────────────────────────────────────────────
  /** Grade overrides from the request, layered over the template's style. */
  grade?: Partial<GradeSpec>;
  /** Which point in the variant space this plan sits at. */
  variant?: VariantAxes;
  /** Stable id recorded into `plan.meta.variantId`. */
  variantId?: string;
  /** Background request, so the compiler knows how the backplate was sourced. */
  background?: BackgroundRequest;
  /**
   * Timestamp for `plan.meta.createdAt`. Injectable so a test — or a byte-for-byte
   * plan diff between two variants — is not defeated by the clock. Everything
   * that touches pixels is a function of `seed` alone.
   */
  now?: string;
}

/**
 * The axes a variant moves along.
 *
 * The point of variants is to give an editor *choices worth choosing between*.
 * Reseeding particle positions produces eight near-identical images; changing
 * the light rig, the grade and the crop produces eight different thumbnails.
 * Every field here changes something an art director would name out loud.
 */
export interface VariantAxes {
  /** 0 is always the template's own intent, unmodified. */
  index: number;
  /** Seed for this variant's stochastic decisions. */
  seed: number;

  /** Light rig override; undefined keeps the template's. */
  lightRig?: LightRig;
  /**
   * Rim polarity.
   * - `opposing`  each subject is rimmed in the *other* team's colour (the versus default)
   * - `unified`   one key side for both, as if lit by a single stage source
   * - `inverted`  each subject rimmed in their own colour — calmer, more portrait-like
   */
  rim: 'opposing' | 'unified' | 'inverted';
  /** Rotation added to the computed rim angle, in degrees. */
  rimAngleOffset: number;

  /** Explicit LUT name; overrides `lutIndex`. */
  lut?: string;
  /**
   * Which of the compositor's built-in LUTs to reach for, as an index resolved
   * at compile time against `BUILTIN_LUTS`. An index rather than a name because
   * `planVariants` is pure and synchronous, and the LUT catalogue lives behind
   * an async module load. `-1` means "keep the template's grade".
   */
  lutIndex: number;
  lutStrength: number;
  /** Named grade personality layered over the template's grade. */
  gradeBias: 'template' | 'teal-orange' | 'crushed' | 'bleach' | 'noir' | 'ember' | 'cold-steel';

  /** Particle system kind; 'none' drops particles entirely. */
  atmosphereKind: 'template' | 'none' | 'dust' | 'ember' | 'spark' | 'shard' | 'snow' | 'confetti' | 'smoke';
  /** Multiplier on particle density. */
  atmosphereDensity: number;
  /** Multiplier on volumetric haze. */
  haze: number;

  /** Backdrop treatment override; undefined keeps the template's. */
  backdrop?: StyleSpec['backdrop'];

  /** Versus-mark treatment. */
  versusStyle: 'template' | 'slash' | 'bolt' | 'hex' | 'clash' | 'stencil' | 'minimal';

  /** Multiplier on subject scale — how much of the frame the subjects own. */
  subjectScale: number;
  /** Crop tightness: a tight bust reads at 210px, a wide shot shows the jersey. */
  cropTightness: 'template' | 'bust' | 'chest' | 'wide';

  /** How the text block is arranged within its slots. */
  textArrangement: 'template' | 'stacked' | 'offset' | 'banner' | 'split';
}

/** Per-stage timings recorded on a job, in milliseconds. */
export type StageTimings = Record<string, number>;

/** Options for {@link batchGenerate}. */
export interface BatchOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number, current: string) => void;
}

/** Options for {@link createDeps}. */
export interface CreateDepsOptions {
  assetRoot?: string;
  visionEndpoint?: string;
  logLevel?: import('@hexa/core').LogLevel;
  /** Override the derived cache location. */
  cacheDir?: string;
  aiProvider?: string;
}

export type { AssetLibrary, VisionClient };
export type { SubjectRequest, QaRequest };
