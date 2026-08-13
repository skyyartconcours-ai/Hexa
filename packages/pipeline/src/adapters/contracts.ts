/**
 * Declared shapes of the nine sibling packages.
 *
 * This file is the contract of record: every assumption the pipeline makes about
 * a sibling lives here and nowhere else, so when a signature drifts there is one
 * file to read and one adapter function to repair.
 *
 * These interfaces are checked against the real packages by
 * `integration/check.ts` (`pnpm --filter @hexa/pipeline typecheck:integration`),
 * which statically imports each sibling and asserts it satisfies the contract
 * below. That check is what caught the differences these types now encode —
 * `@hexa/render`'s `exportImage` encodes rather than writes, `@hexa/vision`'s
 * `identityVerdict` takes a similarity rather than two vectors, `@hexa/type`'s
 * `autoFit` is synchronous and nests its input under `block`/`box`.
 *
 * Two rules keep the contracts honest:
 *
 * 1. **Declare only what is used.** These are structural types; every extra
 *    member is another way to be wrong about a package we do not own.
 * 2. **No index signatures.** A type *without* `[key: string]: unknown` is not
 *    assignable to one *with* it, so an open-ended contract is harder for a real
 *    package to satisfy, not easier.
 */

/**
 * An export the pipeline requires to *exist* — `hexa doctor` checks for it, and
 * its absence means the sibling is half-built — but never calls. Declaring the
 * signature we do not depend on would be inventing a contract we cannot honour;
 * this accepts any function shape without asserting one.
 */
type UncalledExport = (...args: never[]) => unknown;

import type {
  AspectPreset,
  Logger,
  AssetKind,
  AssetMetrics,
  AssetQuery,
  Canvas,
  FaceBox,
  FaceLandmarks,
  FitMode,
  GradeSpec,
  LayoutSpec,
  PixelRect,
  Player,
  PlayerId,
  QaReport,
  QaRequest,
  Rect,
  ReferenceAsset,
  Region,
  RenderPlan,
  RenderResult,
  Role,
  SafeZone,
  Slot,
  StyleSpec,
  Team,
  TeamId,
  TemplateContext,
  ThumbnailTemplate,
  ThumbnailVariant,
  Vec2,
} from '@hexa/core';

// ── @hexa/data ───────────────────────────────────────────────────────────────

export interface PlayerFilter {
  teamId?: string;
  role?: Role;
  region?: Region;
  active?: boolean;
}

export interface DataModule {
  TEAMS: readonly Team[];
  PLAYERS: readonly Player[];
  findPlayer(query: string): Player | undefined;
  findTeam(query: string): Team | undefined;
  requirePlayer(query: string): Player;
  requireTeam(query: string): Team;
  listPlayers(filter?: PlayerFilter): Player[];
  playersByTeam(teamId: string): Player[];
  /** Throws when the roster references an unknown team. */
  teamOf(player: Player): Team;
  rosterOf(teamId: string): Player[];
  searchPlayers(query: string, limit?: number): Player[];
}

export const DATA_EXPORTS = [
  'TEAMS', 'PLAYERS', 'findPlayer', 'findTeam', 'requirePlayer', 'requireTeam',
  'listPlayers', 'playersByTeam', 'teamOf', 'rosterOf', 'searchPlayers',
] as const;

// ── @hexa/assets ─────────────────────────────────────────────────────────────

export interface LibraryStats {
  total: number;
  byPlayer: Record<string, number>;
  byKind: Record<string, number>;
  /** Publish-grade: cleared by a human *and* carrying a known licence. */
  cleared: number;
  uncleared: number;
}

export interface CoverageReport {
  playerId: string;
  count: number;
  cleared: number;
  bestQuality: number;
  /** Machine-readable gap slugs — see @hexa/assets' `COVERAGE_*` constants. */
  gaps: string[];
}

export interface AssetLibrary {
  readonly root: string;
  load(): Promise<void>;
  save(): Promise<void>;
  all(): ReferenceAsset[];
  get(id: string): ReferenceAsset | undefined;
  find(query?: AssetQuery): ReferenceAsset[];
  /** Highest-scoring asset for the query, or undefined when the shelf is bare. */
  best(query?: AssetQuery): ReferenceAsset | undefined;
  /** Library-relative path → absolute, with containment enforced. */
  resolvePath(asset: ReferenceAsset | string, which?: 'source' | 'cutout'): string;
  remove(id: string): Promise<boolean>;
  update(id: string, patch: Partial<ReferenceAsset>): Promise<ReferenceAsset>;
  stats(): LibraryStats;
  coverage(playerIds?: string[]): CoverageReport[];
}

export interface PlaceholderOptions {
  width: number;
  height: number;
  /** Shown on the plate — usually a player handle or team tag. */
  label: string;
  accent: string;
  seed?: number;
  kind?: AssetKind;
}

/**
 * What every ingested asset inherits.
 *
 * `source` and `license` are required together: @hexa/assets refuses to record a
 * photograph whose provenance nobody stated, which is what keeps the licence
 * gate meaningful rather than a field everyone leaves blank.
 */
export interface IngestDefaults {
  playerId?: string;
  teamId?: string;
  kind?: AssetKind;
  source: string;
  license: ReferenceAsset['provenance']['license'];
  credit?: string;
  photographer?: string;
  cleared?: boolean;
  copy?: boolean;
  recursive?: boolean;
  tags?: string[];
  onProgress?: (p: { file: string; index: number; total: number }) => void;
}

export interface IngestResult {
  added: ReferenceAsset[];
  /** Everything not added, with a reason: duplicate, unsupported, unreadable. */
  skipped: { path: string; reason: string }[];
  /** The duplicate subset of `skipped`, pre-split for reporting. */
  duplicates: { path: string; existingId: string; distance: number }[];
  /** The failure subset of `skipped`, pre-split for reporting. */
  errors: { path: string; message: string }[];
}

export interface AssetsModule {
  AssetLibrary: {
    open(root: string, opts?: { logger?: Logger }): Promise<AssetLibrary>;
    new (root: string, opts?: { logger?: Logger }): AssetLibrary;
  };
  scoreAsset(asset: ReferenceAsset, query?: AssetQuery): number;
  rankAssets(assets: ReferenceAsset[], query?: AssetQuery): ReferenceAsset[];
  isPublishable(asset: ReferenceAsset): boolean;
  creditLine(assets: ReferenceAsset[], opts?: { prefix?: string }): string;
  generatePlaceholder(opts: PlaceholderOptions): Promise<Buffer>;
  computeBasicMetrics(image: Buffer | string): Promise<Partial<AssetMetrics>>;
  ingestDirectory(lib: AssetLibrary | string, dir: string, defaults: IngestDefaults): Promise<IngestResult>;
  MANIFEST_FILENAME: string;
  PLACEHOLDER_TAG: string;
  publishBlockers(asset: ReferenceAsset): string[];
  licenceObligations(assets: ReferenceAsset[]): string[];
}

export const ASSETS_EXPORTS = [
  'AssetLibrary', 'scoreAsset', 'rankAssets', 'isPublishable', 'creditLine',
  'generatePlaceholder', 'computeBasicMetrics', 'ingestDirectory', 'MANIFEST_FILENAME',
] as const;

// ── @hexa/vision ─────────────────────────────────────────────────────────────

export type ImageInput = Buffer | string;

export interface DetectedFace {
  box: FaceBox;
  landmarks?: FaceLandmarks;
  /** Degrees. yaw>0 = head turned toward image-right. */
  yaw?: number;
  pitch?: number;
  roll?: number;
}

export interface FaceEmbedding {
  /** L2-normalised, 512-d for buffalo_l. */
  vector: number[];
  /** Producing model. Vectors from different models are not comparable. */
  model: string;
  box?: FaceBox;
}

export interface SegmentOptions {
  bust?: boolean;
  feather?: number;
}

/** The sibling's verdict shape: `pass`, not `passed`. */
export interface IdentityVerdict {
  pass: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** similarity − threshold. Negative when the gate fails. */
  margin: number;
}

export interface VisionClient {
  available(): Promise<boolean>;
  detectFaces(input: ImageInput): Promise<DetectedFace[]>;
  embed(input: ImageInput): Promise<FaceEmbedding | null>;
  embedBatch(inputs: ImageInput[]): Promise<(FaceEmbedding | null)[]>;
  segment(input: ImageInput, opts?: SegmentOptions): Promise<Buffer>;
}

export interface VisionModule {
  VisionClient: { new (opts?: { endpoint?: string; timeoutMs?: number }): VisionClient };
  cosineSimilarity(a: number[], b: number[]): number;
  meanEmbedding(vectors: number[][]): number[];
  bestSimilarity(probe: number[], gallery: number[][]): number;
  /** Takes an already-computed similarity, not the vectors. */
  identityVerdict(sim: number, threshold: number): IdentityVerdict;
  DEFAULT_IDENTITY_THRESHOLD: number;
}

export const VISION_EXPORTS = [
  'VisionClient', 'cosineSimilarity', 'meanEmbedding', 'bestSimilarity',
  'identityVerdict', 'DEFAULT_IDENTITY_THRESHOLD',
] as const;

// ── @hexa/layout ─────────────────────────────────────────────────────────────

export interface ResolvedSlot {
  slot: Slot;
  rect: PixelRect;
  z: number;
}

export interface ResolvedSafeZone {
  zone: SafeZone;
  rect: PixelRect;
}

export interface ResolvedLayout {
  canvas: { width: number; height: number };
  /** Paint order, ascending z. */
  slots: ResolvedSlot[];
  safeZones: ResolvedSafeZone[];
  byId(id: string): ResolvedSlot | undefined;
  spec: LayoutSpec;
  focalPoints: Vec2[];
}

export interface SubjectFit {
  /** Crop in source pixels; hand straight to `sharp.extract()`. */
  srcCrop: PixelRect;
  destRect: PixelRect;
  scale: number;
  flipX: boolean;
  /** Where the face centre landed, in canvas pixels. */
  faceCenterInDest: Vec2;
}

export interface FitSubjectInput {
  image: { width: number; height: number };
  faceBox?: FaceBox;
  landmarks?: FaceLandmarks;
  slot: Slot;
  slotRect: PixelRect;
  mode: FitMode;
  focal?: Vec2;
  contentBox?: PixelRect;
}

export interface LayoutModule {
  resolveLayout(layout: LayoutSpec, width: number, height: number): ResolvedLayout;
  adaptLayout(layout: LayoutSpec, targetAspect: number): LayoutSpec;
  fitSubject(input: FitSubjectInput): SubjectFit;
  /** Takes a raw alpha plane, not an encoded image. */
  alphaContentBox(alpha: Uint8Array, width: number, height: number, threshold?: number): PixelRect | null;
  bustCrop(image: { width: number; height: number }, faceBox: FaceBox, landmarks?: FaceLandmarks, opts?: { headroom?: number; shoulderRatio?: number }): PixelRect;
  facingFromLandmarks(landmarks?: FaceLandmarks): 'left' | 'right' | 'front' | undefined;
  safeZonesFor(aspect: AspectPreset | number): SafeZone[];
  YOUTUBE_SAFE_ZONES: readonly SafeZone[];
  SHORTS_SAFE_ZONES: readonly SafeZone[];

  // Present and checked at load time, but never called from the pipeline — the
  // template package composes with these, not the compiler. `(...args: never[])`
  // is the honest declaration for "some function whose shape we do not rely on":
  // it accepts any arity without asserting one we might get wrong.
  scoreComposition: UncalledExport;
  checkSafeZones: UncalledExport;
  resolveOverlaps: UncalledExport;
  makeGrid: UncalledExport;
  diagonalSplit: UncalledExport;
}

export const LAYOUT_EXPORTS = [
  'resolveLayout', 'adaptLayout', 'fitSubject', 'alphaContentBox', 'bustCrop',
  'scoreComposition', 'checkSafeZones', 'resolveOverlaps', 'safeZonesFor',
  'YOUTUBE_SAFE_ZONES', 'SHORTS_SAFE_ZONES', 'makeGrid', 'diagonalSplit',
] as const;

// ── @hexa/render ─────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Buffers referenced by `{type:'buffer', key}` layers. */
  buffers?: Record<string, Buffer>;
  format?: 'png' | 'jpeg' | 'webp' | 'avif';
  quality?: number;
  signal?: AbortSignal;
}

export interface RenderModule {
  renderPlan(plan: RenderPlan, opts?: RenderOptions): Promise<RenderResult>;
  applyGrade(image: Buffer, grade: GradeSpec, canvas: Canvas, seed: number): Promise<Buffer>;
  /** Encodes to `format` and returns the bytes — it does not write to disk. */
  exportImage(buffer: Buffer, format: string, quality?: number): Promise<Buffer>;
  contactSheet(
    images: { buffer: Buffer; label: string }[],
    opts?: { cols?: number; width?: number; background?: string },
  ): Promise<Buffer>;
  generators: Record<string, unknown>;
  registerGenerator: UncalledExport;
  BUILTIN_LUTS: Record<string, unknown>;
  /** Takes interleaved RGBA, not an encoded image. */
  alphaBounds(rgba: Buffer, width: number, height: number, threshold?: number): PixelRect | null;
}

export const RENDER_EXPORTS = [
  'renderPlan', 'applyGrade', 'exportImage', 'contactSheet', 'generators',
  'registerGenerator', 'BUILTIN_LUTS', 'alphaBounds',
] as const;

/** Generator ids the compiler emits. One list, so drift shows up in one place. */
export const GENERATOR_IDS = {
  particles: 'particles',
  rays: 'rays',
  fog: 'fog',
  speedLines: 'speed-lines',
  haze: 'haze',
  contactShadow: 'contact-shadow',
  backdrop: 'backdrop',
  lightWrap: 'light-wrap',
} as const;

// ── @hexa/type ───────────────────────────────────────────────────────────────

export interface TextStyle {
  family: string;
  weight?: number;
  size: number;
  tracking?: number;
  lineHeight?: number;
  case?: 'upper' | 'lower' | 'title' | 'none';
  fill?: unknown;
  stroke?: { width: number; color: string; join?: 'round' | 'miter' | 'bevel' };
  shadow?: { dx: number; dy: number; blur: number; color: string; opacity: number };
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
  anchor?: import('@hexa/core').Anchor;
  wrap?: boolean;
  maxLines?: number;
}

export interface LaidOutText {
  /** A complete `<svg>` document of exactly `box.w × box.h`. */
  markup: string;
  width: number;
  height: number;
  lines: string[];
  /** The size actually used — differs from `style.size` after autoFit. */
  fontSize: number;
  box: PixelRect;
}

export interface Mark {
  markup: string;
  width: number;
  height: number;
}

/** The VS-mark treatments @hexa/type actually ships. */
export type VersusStyle = 'slash' | 'shield' | 'bolt' | 'blade' | 'circle' | 'plain' | 'hex';

export interface VersusMarkOptions {
  size: number;
  style?: VersusStyle;
  leftColor: string;
  rightColor: string;
  text?: string;
  strokeColor?: string;
  glow?: boolean;
}

/** Preset names @hexa/type ships. Mapped from TextRole by the type adapter. */
export type PresetName =
  | 'headline-heavy' | 'headline-condensed' | 'drama-scream' | 'player-name'
  | 'team-tag' | 'vs-mark' | 'stat-value' | 'stat-label' | 'rank-number' | 'date-badge';

export interface TypeModule {
  renderText: UncalledExport;
  autoFit(input: LayoutTextInput, opts?: { min?: number; max?: number; steps?: number }): LaidOutText;
  measureText: UncalledExport;
  wrapText: UncalledExport;
  versusMark(opts: VersusMarkOptions): Mark;
  nameplate: UncalledExport;
  statBadge: UncalledExport;
  PRESETS: Record<string, TextStyle>;
  preset(name: PresetName, overrides?: Partial<TextStyle>): TextStyle;
  legibilityScore: UncalledExport;
  registerFont: UncalledExport;
  ensureFonts(): Promise<unknown>;
  fontStack(family?: string): string;
  exactMeasurementAvailable?(): boolean;
  /** Diagnostics — present in @hexa/type, used only by `hexa doctor`. */
  registeredFonts?(): { family: string; path: string; weight?: number }[];
  defaultFontDir?(): string;
  WANTED_FAMILIES?: readonly string[];
}

export const TYPE_EXPORTS = [
  'renderText', 'autoFit', 'measureText', 'wrapText', 'versusMark', 'nameplate',
  'statBadge', 'PRESETS', 'preset', 'legibilityScore', 'registerFont', 'ensureFonts', 'fontStack',
] as const;

// ── @hexa/templates ──────────────────────────────────────────────────────────

export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * @hexa/templates returns a bare list of problems — `[]` means the template is
 * sound. The adapter widens that into a verdict object for the CLI, which wants
 * to print "valid" as well as "here is what is wrong".
 */
export interface TemplateValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface TemplatesModule {
  TEMPLATES: readonly ThumbnailTemplate[];
  getTemplate(id: string): ThumbnailTemplate | undefined;
  requireTemplate(id: string): ThumbnailTemplate;
  listTemplates(filter?: { category?: string; aspect?: AspectPreset; tags?: string[] }): ThumbnailTemplate[];
  templatesForSubjectCount(count: number): ThumbnailTemplate[];
  suggestTemplates(input: { subjects: number; mood?: string; category?: string; aspect?: AspectPreset }, limit?: number): ThumbnailTemplate[];
  /** Template → LayoutSpec. Renamed on import to avoid @hexa/layout's clash. */
  resolveLayout(template: ThumbnailTemplate, ctx: TemplateContext): LayoutSpec;
  resolveStyle(template: ThumbnailTemplate, ctx: TemplateContext): StyleSpec;
  /** Returns the problems found; an empty array means the template is sound. */
  validateTemplate(template: ThumbnailTemplate): string[];
  ASPECT_SIZES: Record<AspectPreset, CanvasSize>;
  // Slot builders are for template authors; the compiler consumes finished
  // layouts. Checked for presence, never called from here.
  bustSlot: UncalledExport;
  textSlot: UncalledExport;
  fxSlot: UncalledExport;
  gridSlots: UncalledExport;
}

export const TEMPLATES_EXPORTS = [
  'TEMPLATES', 'getTemplate', 'requireTemplate', 'listTemplates',
  'templatesForSubjectCount', 'suggestTemplates', 'resolveLayout', 'resolveStyle',
  'validateTemplate', 'ASPECT_SIZES',
] as const;

// ── @hexa/ai ─────────────────────────────────────────────────────────────────

export type BackplateStyle =
  | 'arena' | 'abstract' | 'cyber' | 'ruins' | 'void' | 'nature' | 'studio'
  | 'stadium-crowd' | 'energy' | 'shattered-glass' | 'smoke' | 'neon-city';

export interface BackplatePromptInput {
  style: BackplateStyle;
  mood?: string;
  palette?: string[];
  lightDirection?: string;
  subjectCount?: number;
  extra?: string;
}

export interface BackplateRouteRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  style?: BackplateStyle;
  palette?: string[];
  strength?: number;
  provider?: string;
}

export interface GeneratedImage {
  buffer: Buffer;
  width: number;
  height: number;
  provider: string;
  model: string;
  seed?: number;
  cost?: number;
  promptUsed: string;
  revisedPrompt?: string;
}

export interface ProviderCapabilities {
  backplate: boolean;
  identityGuidedEdit: boolean;
  inpaint: boolean;
  upscale: boolean;
  maxSize: { width: number; height: number };
}

export interface ProviderStatus {
  id: string;
  configured: boolean;
  capabilities: ProviderCapabilities;
  envVar?: string;
  note?: string;
}

export interface AiModule {
  generateBackplate(req: BackplateRouteRequest): Promise<GeneratedImage>;
  identityGuidedEdit: UncalledExport;
  buildBackplatePrompt(input: BackplatePromptInput): { prompt: string; negativePrompt: string };
  resolveProvider: UncalledExport;
  listProviders(): { id: string }[];
  providerStatus(): ProviderStatus[];
  registerProvider: UncalledExport;
  /** Throws when a prompt asks for a person. Runs before every backplate. */
  assertNoPersonGeneration(prompt: string): void;
  isBackplateStyle(v: string): boolean;
  BACKPLATE_STYLES: readonly BackplateStyle[];
}

export const AI_EXPORTS = [
  'generateBackplate', 'identityGuidedEdit', 'buildBackplatePrompt', 'resolveProvider',
  'listProviders', 'providerStatus', 'registerProvider', 'assertNoPersonGeneration',
] as const;

// ── @hexa/qa ─────────────────────────────────────────────────────────────────

export interface QaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A subject as the gates see it. */
export interface GateSubject {
  playerId: PlayerId;
  handle: string;
  /** Where the face landed in the *render*, not in the source photo. */
  faceRect?: QaRect;
  referenceEmbeddings?: number[][];
  anonymous?: boolean;
  assets?: ReferenceAsset[];
}

export interface GateTextRect {
  role: string;
  rect: QaRect;
}

/** Structural face embedder — @hexa/vision satisfies it without a dependency. */
export interface VisionPort {
  embed(input: Buffer | string): Promise<{ vector: number[] } | null>;
  available(): Promise<boolean>;
}

export interface GateContext {
  image: Buffer;
  plan: RenderPlan;
  width: number;
  height: number;
  subjects: GateSubject[];
  textRects?: GateTextRect[];
  request?: QaRequest;
  vision?: VisionPort;
}

export interface AppealContext {
  image: Buffer;
  width: number;
  height: number;
  textRects?: GateTextRect[];
  faceRects?: QaRect[];
}

export interface AppealResult {
  /** 0–100 weighted heuristic. Not a CTR estimate. */
  score: number;
  parts: Record<string, number>;
  notes: string[];
}

export interface DisplaySize {
  w: number;
  h: number;
  label: string;
}

export interface QaModule {
  runGates(ctx: GateContext, opts?: { only?: string[]; skip?: string[] }): Promise<QaReport>;
  GATES: readonly { id: string; weight: number; description: string }[];
  scoreAppeal(ctx: AppealContext): Promise<AppealResult>;
  rankVariants: UncalledExport;
  /** Index into `variants` of the best one. -1 when empty. */
  pickBest(variants: ThumbnailVariant[]): number;
  simulateSizes: UncalledExport;
  proofSheet(image: Buffer, opts?: { background?: string }): Promise<Buffer>;
  summarise(report: QaReport): string;
  dHash(image: Buffer): Promise<string>;
  hamming(a: string, b: string): number;
  YOUTUBE_DISPLAY_SIZES: readonly DisplaySize[];
  DUPLICATE_DISTANCE: number;
}

export const QA_EXPORTS = [
  'runGates', 'GATES', 'scoreAppeal', 'rankVariants', 'pickBest', 'simulateSizes',
  'proofSheet', 'summarise', 'dHash', 'hamming', 'YOUTUBE_DISPLAY_SIZES',
] as const;

// ── Registry ─────────────────────────────────────────────────────────────────

/** Every integration point in one table — `hexa doctor` walks this. */
export const INTEGRATIONS: readonly { module: string; exports: readonly string[]; required: boolean; purpose: string }[] = [
  { module: '@hexa/data', exports: DATA_EXPORTS, required: true, purpose: 'roster database' },
  { module: '@hexa/assets', exports: ASSETS_EXPORTS, required: true, purpose: 'reference photo library' },
  { module: '@hexa/vision', exports: VISION_EXPORTS, required: true, purpose: 'cutouts, face detection, identity embeddings' },
  { module: '@hexa/layout', exports: LAYOUT_EXPORTS, required: true, purpose: 'geometry resolution and subject fitting' },
  { module: '@hexa/render', exports: RENDER_EXPORTS, required: true, purpose: 'compositor' },
  { module: '@hexa/type', exports: TYPE_EXPORTS, required: true, purpose: 'typography' },
  { module: '@hexa/templates', exports: TEMPLATES_EXPORTS, required: true, purpose: 'template library' },
  { module: '@hexa/qa', exports: QA_EXPORTS, required: true, purpose: 'quality gates and appeal scoring' },
  { module: '@hexa/ai', exports: AI_EXPORTS, required: false, purpose: 'optional AI backplates' },
];

export type { AssetQuery, ReferenceAsset, ThumbnailTemplate };
