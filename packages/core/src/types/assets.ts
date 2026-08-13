/**
 * Reference asset domain.
 *
 * Every pixel of a human face that ends up in a Hexa render traces back to a
 * ReferenceAsset with recorded provenance. Generative models are allowed to
 * paint environments, light and atmosphere — never identity. That single rule
 * is what separates this from the "AI slop" the tool exists to avoid.
 */

import type { PlayerId, TeamId } from './identity.js';

export type AssetKind =
  | 'portrait'      // head-and-shoulders, ideal for versus busts
  | 'action'        // mid-game/stage shot, dynamic pose
  | 'celebration'   // arms up, trophy, emotional peak
  | 'jersey'        // clean upper-body with readable kit
  | 'fullbody'      // standing, usable for full-height compositions
  | 'logo'          // team mark (no face)
  | 'backplate';    // background/environment plate (no face)

export type LicenseKind =
  | 'press-kit'     // official team/league media kit, credit required
  | 'cc-by'
  | 'cc-by-sa'
  | 'cc0'
  | 'owned'         // user shot or owns the photograph outright
  | 'rights-managed'// licensed from an agency
  | 'unverified';   // ingested but not cleared — blocked from publish-grade output

export interface AssetProvenance {
  /** Human-readable origin, e.g. "LCK Official Media Kit 2025 Spring". */
  source: string;
  url?: string;
  license: LicenseKind;
  /** Attribution string that must accompany published output. */
  credit?: string;
  photographer?: string;
  capturedAt?: string;
  addedAt: string;
  /** Set true once a human has confirmed the licence permits derivative use. */
  cleared: boolean;
  notes?: string;
}

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Detector confidence 0–1. */
  confidence: number;
}

export interface FaceLandmarks {
  leftEye: [number, number];
  rightEye: [number, number];
  nose: [number, number];
  mouthLeft: [number, number];
  mouthRight: [number, number];
}

export interface AssetMetrics {
  width: number;
  height: number;
  /** Variance-of-Laplacian sharpness. Higher is crisper; <40 is soft. */
  sharpness: number;
  /** Mean luminance 0–255. */
  brightness: number;
  /** RMS contrast 0–1. */
  contrast: number;
  faceBox?: FaceBox;
  landmarks?: FaceLandmarks;
  /** Face area as a fraction of total image area. */
  faceArea?: number;
  /** Head pose in degrees; 0,0,0 is straight at camera. */
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** 0–1 estimate of how much of the face is blocked (hand, mic, hair). */
  occlusion?: number;
  /** Dominant colours as hex, most frequent first. */
  palette?: string[];
  /**
   * Composite 0–100 usability score. The asset picker sorts on this, weighted
   * by what the target slot needs (a bust slot weights face area far higher
   * than a full-body slot does).
   */
  quality: number;
}

export interface ReferenceAsset {
  id: string;
  /** Owning player, or undefined for logos/backplates. */
  playerId?: PlayerId;
  teamId?: TeamId;
  kind: AssetKind;
  /** Path relative to the asset library root. */
  path: string;
  /** Pre-computed alpha cutout, relative to the library root. */
  cutoutPath?: string;
  /** Perceptual hash for duplicate detection. */
  phash?: string;
  /** L2-normalised face embedding (512-d for buffalo_l). */
  embedding?: number[];
  /** Name of the model that produced `embedding`, for cross-model safety. */
  embeddingModel?: string;
  metrics: AssetMetrics;
  provenance: AssetProvenance;
  tags: string[];
}

/** On-disk index of the whole reference library. */
export interface AssetManifest {
  version: number;
  updatedAt: string;
  /** Absolute or repo-relative root all `path` fields resolve against. */
  root: string;
  assets: ReferenceAsset[];
}

/** What a layout slot needs, used to weight asset selection. */
export interface AssetQuery {
  playerId?: PlayerId;
  teamId?: TeamId;
  kind?: AssetKind | AssetKind[];
  /** Prefer subjects facing this way; cutouts may be mirrored to comply. */
  facing?: 'left' | 'right' | 'any';
  minQuality?: number;
  /** Require a cleared licence. Publish-grade renders set this true. */
  requireCleared?: boolean;
  /** Weights applied on top of the base quality score. */
  weights?: Partial<Record<'faceArea' | 'sharpness' | 'frontality' | 'recency', number>>;
}
