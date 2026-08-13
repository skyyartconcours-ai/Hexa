/**
 * Job + QA domain.
 *
 * A ThumbnailRequest is the public API surface: everything the CLI, the HTTP
 * service and the studio UI submit reduces to this shape. QA gates run against
 * the rendered result and can veto it, which is how the identity guarantee is
 * enforced mechanically rather than by good intentions.
 */

import type { PlayerId } from './identity.js';
import type { AspectPreset, TextRole } from './template.js';
import type { GradeSpec } from './render.js';
import type { RenderPlan } from './render.js';

export interface SubjectRequest {
  /** Player handle, id or alias — resolved against the roster database. */
  player: string;
  side?: 'left' | 'right' | 'center';
  assetId?: string;
  accent?: string;
  /** Skip the identity gate for this subject (e.g. a silhouette treatment). */
  anonymous?: boolean;
}

export interface BackgroundRequest {
  /** 'auto' lets the template's backdrop decide. */
  mode: 'auto' | 'ai' | 'file' | 'color' | 'gradient' | 'none';
  /** Prompt for AI backplates. Faces are never generated here. */
  prompt?: string;
  path?: string;
  color?: string;
  /** Provider override, else the configured default. */
  provider?: string;
}

export interface OutputRequest {
  dir: string;
  /** Basename without extension; a variant suffix is appended. */
  name?: string;
  format?: 'png' | 'jpeg' | 'webp' | 'avif';
  quality?: number;
  /** Also emit the RenderPlan as JSON next to the image. */
  emitPlan?: boolean;
  /** Also emit a contact sheet when rendering multiple variants. */
  contactSheet?: boolean;
}

export interface QaRequest {
  /** Minimum cosine similarity against the player's reference embeddings. */
  identityThreshold?: number;
  /** Fail if the thumbnail is illegible at YouTube's smallest render. */
  legibility?: boolean;
  /** Fail on hard safe-zone violations. */
  safeZones?: boolean;
  /** Require every asset used to carry a cleared licence. */
  requireClearedLicense?: boolean;
  /** Abort on failure vs. emit with warnings. */
  strict?: boolean;
}

export interface ThumbnailRequest {
  templateId: string;
  subjects: SubjectRequest[];
  text: Partial<Record<TextRole, string>>;
  aspect?: AspectPreset;
  background?: BackgroundRequest;
  /** Grade overrides layered on top of the template's style. */
  grade?: Partial<GradeSpec>;
  /** Number of distinct variants to explore. */
  variants?: number;
  seed?: number;
  output: OutputRequest;
  qa?: QaRequest;
  /** Palette override; else derived from the subjects' teams. */
  palette?: { left?: string; right?: string; accent?: string };
}

export type QaSeverity = 'pass' | 'warn' | 'fail';

export interface QaFinding {
  gate: string;
  severity: QaSeverity;
  message: string;
  /** 0–1 where 1 is ideal. */
  score?: number;
  /** Where on the canvas the problem is, in normalised units. */
  where?: { x: number; y: number; w: number; h: number };
  subjectId?: PlayerId;
  /** Concrete, actionable remedy. */
  suggestion?: string;
}

export interface QaReport {
  passed: boolean;
  /** Weighted 0–100 aggregate across all gates. */
  score: number;
  findings: QaFinding[];
  gateScores: Record<string, number>;
}

export interface ThumbnailVariant {
  id: string;
  path: string;
  plan: RenderPlan;
  qa: QaReport;
  /** Predicted click-through appeal 0–100 from the heuristic ranker. */
  appeal: number;
  seed: number;
}

export interface ThumbnailJobResult {
  request: ThumbnailRequest;
  variants: ThumbnailVariant[];
  /** Index into `variants` of the highest combined QA + appeal score. */
  bestIndex: number;
  contactSheetPath?: string;
  totalMs: number;
  warnings: string[];
}
