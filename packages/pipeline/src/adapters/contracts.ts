/**
 * Declared shapes of the nine sibling packages.
 *
 * This file is the contract of record. Every assumption the pipeline makes about
 * a sibling lives here and nowhere else, so when a signature drifts there is one
 * file to read and one adapter function to repair.
 *
 * Two rules keep the contracts robust:
 *
 * 1. **Declare only what is used.** These are structural types, so a real
 *    implementation satisfies them as long as the members we actually call line
 *    up. Every extra member we declare is another way to be wrong about a
 *    package we do not own.
 *
 * 2. **Widen returns, narrow arguments.** Return types are declared loosely
 *    (`unknown`, union shapes) and normalised by the adapter, because a sibling
 *    returning `{buffer}` where we expected `Buffer` should be a shrug, not an
 *    outage. Arguments are declared precisely, because those we control.
 */

import type {
  AssetMetrics,
  AssetQuery,
  AspectPreset,
  FaceBox,
  FaceLandmarks,
  GradeSpec,
  LayoutSpec,
  Layer,
  PixelRect,
  Player,
  PlayerId,
  QaReport,
  Rect,
  ReferenceAsset,
  Region,
  RenderPlan,
  Role,
  SafeZone,
  Slot,
  StyleSpec,
  Team,
  TeamId,
  TemplateContext,
  TextRole,
  ThumbnailTemplate,
  Vec2,
} from '@hexa/core';

// ── @hexa/data ───────────────────────────────────────────────────────────────

export interface DataModule {
  TEAMS: readonly Team[];
  PLAYERS: readonly Player[];
  findPlayer(query: string): Player | undefined;
  findTeam(query: string): Team | undefined;
  requirePlayer(query: string): Player;
  requireTeam(query: string): Team;
  listPlayers(filter?: { team?: string; role?: Role; region?: Region; active?: boolean }): Player[];
  playersByTeam(teamId: TeamId): Player[];
  teamOf(player: Player | PlayerId): Team | undefined;
  rosterOf(teamId: TeamId | Team): Player[];
  searchPlayers(query: string, limit?: number): Player[];
}

export const DATA_EXPORTS = [
  'TEAMS', 'PLAYERS', 'findPlayer', 'findTeam', 'requirePlayer', 'requireTeam',
  'listPlayers', 'playersByTeam', 'teamOf', 'rosterOf', 'searchPlayers',
] as const;

// ── @hexa/assets ─────────────────────────────────────────────────────────────

/** Per-team/per-player reference coverage, used by `hexa doctor` and `assets coverage`. */
export interface CoverageRow {
  teamId?: TeamId;
  playerId?: PlayerId;
  name?: string;
  assets: number;
  cleared?: number;
  bestQuality?: number;
  [key: string]: unknown;
}

export interface LibraryStats {
  total: number;
  cleared?: number;
  byKind?: Record<string, number>;
  byLicense?: Record<string, number>;
  players?: number;
  teams?: number;
  bytes?: number;
  [key: string]: unknown;
}

/**
 * The library instance. Declared as an interface rather than a class type so a
 * test double is a plain object literal.
 */
export interface AssetLibrary {
  root: string;
  load?(): Promise<unknown>;
  save?(): Promise<unknown>;
  all(): ReferenceAsset[];
  get(id: string): ReferenceAsset | undefined;
  find(query: AssetQuery): ReferenceAsset[];
  /** Highest-scoring asset for the query, or undefined when the shelf is bare. */
  best(query: AssetQuery): ReferenceAsset | undefined;
  /** Library-relative path → absolute path, with containment enforced. */
  resolvePath(pathOrAsset: string | ReferenceAsset): string;
  add?(asset: ReferenceAsset): Promise<unknown> | unknown;
  remove?(id: string): Promise<unknown> | unknown;
  update?(id: string, patch: Partial<ReferenceAsset>): Promise<unknown> | unknown;
  stats(): LibraryStats;
  coverage(): CoverageRow[];
}

export interface PlaceholderOptions {
  width: number;
  height: number;
  /** Drives the schematic silhouette's proportions and the label. */
  kind?: 'portrait' | 'bust' | 'fullbody' | 'logo';
  label?: string;
  accent?: string;
  seed?: number;
}

export interface IngestOptions {
  playerId?: string;
  teamId?: string;
  kind?: string;
  license?: string;
  source?: string;
  credit?: string;
  photographer?: string;
  cleared?: boolean;
  copy?: boolean;
  recursive?: boolean;
  tags?: string[];
}

export interface IngestReport {
  added: ReferenceAsset[];
  skipped?: { path: string; reason: string }[];
  duplicates?: { path: string; existingId: string }[];
  errors?: { path: string; message: string }[];
  [key: string]: unknown;
}

export interface AssetsModule {
  AssetLibrary: {
    open(root: string): Promise<AssetLibrary> | AssetLibrary;
    new (root: string): AssetLibrary;
  };
  scoreAsset(asset: ReferenceAsset, query?: AssetQuery): number;
  rankAssets(assets: readonly ReferenceAsset[], query?: AssetQuery): ReferenceAsset[];
  isPublishable(asset: ReferenceAsset): boolean;
  creditLine(assets: readonly ReferenceAsset[], opts?: { prefix?: string }): string;
  generatePlaceholder(opts: PlaceholderOptions): Promise<Buffer> | Buffer;
  computeBasicMetrics(image: Buffer | string): Promise<AssetMetrics>;
  ingestDirectory(root: string, dir: string, opts?: IngestOptions): Promise<IngestReport>;
  MANIFEST_FILENAME: string;
}

export const ASSETS_EXPORTS = [
  'AssetLibrary', 'scoreAsset', 'rankAssets', 'isPublishable', 'creditLine',
  'generatePlaceholder', 'computeBasicMetrics', 'ingestDirectory', 'MANIFEST_FILENAME',
] as const;

// ── @hexa/vision ─────────────────────────────────────────────────────────────

/** Anything the sidecar accepts as an image: bytes or a path on disk. */
export type ImageInput = Buffer | string;

export interface SegmentOptions {
  /** Crop to head-and-shoulders using landmarks — the versus bust. */
  bust?: boolean;
  /** Alpha matting / edge refinement; slower, much better hair. */
  refine?: boolean;
  model?: string;
  /** Padding around the bust crop as a fraction of face height. */
  padding?: number;
}

export interface DetectedFace {
  box: FaceBox;
  landmarks?: FaceLandmarks;
  yaw?: number;
  pitch?: number;
  roll?: number;
  confidence?: number;
}

export interface IdentityVerdict {
  similarity: number;
  threshold: number;
  passed: boolean;
  /** Present when verification could not run (no sidecar, no reference embeddings). */
  reason?: string;
  [key: string]: unknown;
}

export interface VisionClient {
  available(): Promise<boolean>;
  detectFaces(image: ImageInput, opts?: { maxFaces?: number; minConfidence?: number }): Promise<unknown>;
  embed(image: ImageInput): Promise<unknown>;
  embedBatch(images: readonly ImageInput[]): Promise<unknown>;
  /** Returns cut-out RGBA PNG bytes, possibly wrapped in a result envelope. */
  segment(image: ImageInput, opts?: SegmentOptions): Promise<unknown>;
  metrics(image: ImageInput): Promise<unknown>;
  similarity(a: ImageInput, b: ImageInput): Promise<unknown>;
  endpoint?: string;
}

export interface VisionModule {
  VisionClient: {
    new (opts?: { endpoint?: string; timeoutMs?: number }): VisionClient;
    create?(opts?: { endpoint?: string; timeoutMs?: number }): VisionClient | Promise<VisionClient>;
  };
  cosineSimilarity(a: readonly number[], b: readonly number[]): number;
  meanEmbedding(embeddings: readonly (readonly number[])[]): number[];
  bestSimilarity(probe: readonly number[], gallery: readonly (readonly number[])[]): number;
  identityVerdict(probe: readonly number[], gallery: readonly (readonly number[])[], threshold?: number): IdentityVerdict;
  DEFAULT_IDENTITY_THRESHOLD: number;
}

export const VISION_EXPORTS = [
  'VisionClient', 'cosineSimilarity', 'meanEmbedding', 'bestSimilarity',
  'identityVerdict', 'DEFAULT_IDENTITY_THRESHOLD',
] as const;

// ── @hexa/layout ─────────────────────────────────────────────────────────────

/** A slot with its rect resolved to device pixels. */
export interface ResolvedSlot {
  slot: Slot;
  rect: PixelRect;
  /** Focal point in absolute pixels, derived from `slot.focal`. */
  focal?: { x: number; y: number };
}

export interface ResolvedLayout {
  slots: ResolvedSlot[];
  safeZones: SafeZone[];
  width: number;
  height: number;
  focalPoints?: Vec2[];
}

/** What `fitSubject` works out: how to place a cutout so the face lands right. */
export interface SubjectFit {
  /** Destination rect in device pixels — may exceed the slot when cropping. */
  rect: PixelRect;
  scale: number;
  flipX?: boolean;
  /** Source-space crop applied before placement. */
  crop?: PixelRect;
  /** Where the face ended up, in canvas pixels. */
  faceRect?: PixelRect;
}

export interface FitSubjectInput {
  slot: Slot;
  slotRect: PixelRect;
  /** Intrinsic size of the cutout. */
  image: { width: number; height: number };
  faceBox?: FaceBox;
  landmarks?: FaceLandmarks;
  /** Alpha content bounds inside the image, when known. */
  contentBox?: PixelRect;
  fit?: Slot['fit'];
  /** Multiplier applied on top of the computed scale — the variant tightness axis. */
  scaleBias?: number;
  canvas?: { width: number; height: number };
}

export interface CompositionScore {
  score: number;
  findings?: { message: string; severity?: string }[];
  [key: string]: unknown;
}

export interface LayoutModule {
  resolveLayout(layout: LayoutSpec, width: number, height: number): ResolvedLayout;
  adaptLayout(layout: LayoutSpec, targetAspect: number): LayoutSpec;
  fitSubject(input: FitSubjectInput): SubjectFit;
  alphaContentBox(image: Buffer): Promise<PixelRect> | PixelRect;
  bustCrop(input: { image: { width: number; height: number }; faceBox: FaceBox; landmarks?: FaceLandmarks; padding?: number }): PixelRect;
  scoreComposition(input: { layout: LayoutSpec; width: number; height: number }): CompositionScore;
  checkSafeZones(input: { rects: { id: string; rect: Rect }[]; safeZones: readonly SafeZone[] }): unknown;
  resolveOverlaps(slots: readonly Slot[]): Slot[];
  safeZonesFor(aspect: AspectPreset): SafeZone[];
  YOUTUBE_SAFE_ZONES: readonly SafeZone[];
  SHORTS_SAFE_ZONES: readonly SafeZone[];
  makeGrid(input: { rows: number; cols: number; gap?: number; bounds?: Rect }): Rect[];
  diagonalSplit(input: { angle: number; offset?: number }): { left: Rect; right: Rect; seam: Vec2[] };
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
  supersample?: number;
  signal?: AbortSignal;
}

export interface RenderModule {
  renderPlan(plan: RenderPlan, opts?: RenderOptions): Promise<unknown>;
  applyGrade(image: Buffer, grade: GradeSpec): Promise<Buffer>;
  exportImage(image: Buffer, dest: string, opts?: { format?: string; quality?: number }): Promise<unknown>;
  contactSheet(images: readonly (Buffer | string)[], opts?: { columns?: number; labels?: string[]; width?: number; background?: string }): Promise<unknown>;
  generators: Record<string, unknown>;
  registerGenerator(id: string, fn: unknown): void;
  BUILTIN_LUTS: Record<string, unknown> | readonly string[];
  alphaBounds(image: Buffer): Promise<PixelRect> | PixelRect;
}

export const RENDER_EXPORTS = [
  'renderPlan', 'applyGrade', 'exportImage', 'contactSheet', 'generators',
  'registerGenerator', 'BUILTIN_LUTS', 'alphaBounds',
] as const;

/** Generator ids the compiler emits. Declared so a drift shows up in one list. */
export const GENERATOR_IDS = {
  atmosphere: 'atmosphere',
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

export interface TypePreset {
  family?: string;
  weight?: number | string;
  /** Upper bound before autofit shrinks; in px at the design size. */
  size?: number;
  tracking?: number;
  leading?: number;
  case?: 'upper' | 'lower' | 'title' | 'none';
  fill?: string;
  stroke?: { width: number; color: string };
  shadow?: unknown;
  [key: string]: unknown;
}

export interface AutoFitInput {
  text: string;
  rect: PixelRect;
  preset?: TypePreset | string;
  role?: TextRole;
  color?: string;
  accent?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  maxLines?: number;
  /** Upper/lower bounds for the fitted size, in px. */
  minSize?: number;
  maxSize?: number;
  seed?: number;
}

/** Loosely declared: adapters normalise whichever of these fields come back. */
export interface FittedText {
  markup?: string;
  svg?: string;
  rect?: PixelRect;
  bounds?: PixelRect;
  fontSize?: number;
  size?: number;
  lines?: string[];
  color?: string;
  fill?: string;
  [key: string]: unknown;
}

export interface VersusMarkInput {
  rect: PixelRect;
  text?: string;
  style?: string;
  left: string;
  right: string;
  accent: string;
  seed?: number;
}

export interface TypeModule {
  renderText(input: AutoFitInput & { size?: number }): FittedText | Promise<FittedText>;
  autoFit(input: AutoFitInput): FittedText | Promise<FittedText>;
  measureText(input: { text: string; size: number; preset?: TypePreset | string }): { width: number; height: number };
  wrapText(input: { text: string; width: number; size: number; preset?: TypePreset | string }): string[];
  versusMark(input: VersusMarkInput): FittedText | Promise<FittedText>;
  nameplate(input: unknown): FittedText | Promise<FittedText>;
  statBadge(input: unknown): FittedText | Promise<FittedText>;
  PRESETS: Record<string, TypePreset>;
  preset(role: TextRole | string): TypePreset | undefined;
  legibilityScore(input: unknown): number;
  registerFont(input: unknown): unknown;
  ensureFonts(): Promise<unknown>;
  fontStack(family?: string): string[] | string;
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

export interface TemplateValidation {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface TemplatesModule {
  TEMPLATES: readonly ThumbnailTemplate[];
  getTemplate(id: string): ThumbnailTemplate | undefined;
  requireTemplate(id: string): ThumbnailTemplate;
  listTemplates(filter?: { category?: string; aspect?: AspectPreset; tag?: string }): ThumbnailTemplate[];
  templatesForSubjectCount(count: number): ThumbnailTemplate[];
  suggestTemplates(input: { subjects?: number; category?: string; text?: string; aspect?: AspectPreset }): ThumbnailTemplate[];
  /** Exported as `resolveLayout` by the package; renamed on import to avoid the clash with @hexa/layout's. */
  resolveLayout(template: ThumbnailTemplate, ctx: TemplateContext): LayoutSpec;
  resolveStyle(template: ThumbnailTemplate, ctx: TemplateContext): StyleSpec;
  validateTemplate(template: ThumbnailTemplate): TemplateValidation;
  ASPECT_SIZES: Record<string, CanvasSize>;
  bustSlot(input: unknown): Slot;
  textSlot(input: unknown): Slot;
  fxSlot(input: unknown): Slot;
  gridSlots(input: unknown): Slot[];
}

export const TEMPLATES_EXPORTS = [
  'TEMPLATES', 'getTemplate', 'requireTemplate', 'listTemplates',
  'templatesForSubjectCount', 'suggestTemplates', 'resolveLayout', 'resolveStyle',
  'validateTemplate', 'ASPECT_SIZES', 'bustSlot', 'textSlot', 'fxSlot', 'gridSlots',
] as const;

// ── @hexa/ai ─────────────────────────────────────────────────────────────────

export interface BackplateInput {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  provider?: string;
  negativePrompt?: string;
  signal?: AbortSignal;
}

export interface BackplatePromptInput {
  template: ThumbnailTemplate;
  palette: { left: string; right: string; accent: string; dark: string; light: string };
  /** Team/league context — never player names, which would invite a face. */
  context?: { league?: string; venue?: string; mood?: string; tags?: string[] };
  style?: StyleSpec;
  seed?: number;
}

export interface ProviderStatus {
  id: string;
  name?: string;
  configured: boolean;
  /** The env var the operator must set, when unconfigured. */
  envVar?: string;
  reason?: string;
  models?: string[];
  [key: string]: unknown;
}

export interface AiModule {
  generateBackplate(input: BackplateInput): Promise<unknown>;
  identityGuidedEdit(input: unknown): Promise<unknown>;
  buildBackplatePrompt(input: BackplatePromptInput): string | { prompt: string; negativePrompt?: string };
  resolveProvider(id?: string): unknown;
  listProviders(): ProviderStatus[] | string[];
  providerStatus(id?: string): ProviderStatus | ProviderStatus[];
  registerProvider(id: string, provider: unknown): void;
  /** Throws when a prompt asks for a person. Called before every backplate. */
  assertNoPersonGeneration(prompt: string): void;
}

export const AI_EXPORTS = [
  'generateBackplate', 'identityGuidedEdit', 'buildBackplatePrompt', 'resolveProvider',
  'listProviders', 'providerStatus', 'registerProvider', 'assertNoPersonGeneration',
] as const;

// ── @hexa/qa ─────────────────────────────────────────────────────────────────

export interface RunGatesInput {
  image: Buffer;
  plan: RenderPlan;
  /** Reference embeddings per player id, for the identity gate. */
  references?: Record<PlayerId, number[][]>;
  vision?: VisionClient;
  thresholds?: { identity?: number };
  options?: {
    legibility?: boolean;
    safeZones?: boolean;
    requireClearedLicense?: boolean;
    strict?: boolean;
  };
  assets?: readonly ReferenceAsset[];
}

export interface AppealInput {
  image: Buffer;
  plan: RenderPlan;
  qa?: QaReport;
}

export interface QaModule {
  runGates(input: RunGatesInput): Promise<QaReport>;
  GATES: readonly unknown[] | Record<string, unknown>;
  scoreAppeal(input: AppealInput): Promise<number> | number;
  rankVariants(variants: readonly { qa?: QaReport; appeal?: number }[]): number[] | readonly unknown[];
  pickBest(variants: readonly { qa?: QaReport; appeal?: number }[]): number | unknown;
  simulateSizes(image: Buffer, sizes?: readonly { width: number; height: number }[]): Promise<unknown>;
  proofSheet(input: { image: Buffer; report?: QaReport; sizes?: readonly unknown[] }): Promise<unknown>;
  summarise(report: QaReport): string;
  dHash(image: Buffer): Promise<string> | string;
  hamming(a: string, b: string): number;
  YOUTUBE_DISPLAY_SIZES: readonly { width: number; height: number; label?: string }[];
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
