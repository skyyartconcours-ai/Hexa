/**
 * Public shapes for @hexa/vision.
 *
 * Coordinate convention: every FaceBox and FaceLandmarks value is in **source
 * image pixels**, at the image's own resolution — never normalised, never
 * relative to a resized analysis copy. The Python sidecar uses the same
 * convention so the two paths are interchangeable.
 */

import type { FaceBox, FaceLandmarks, Logger } from '@hexa/core';

/** A filesystem path (absolute preferred) or the raw encoded image bytes. */
export type ImageInput = string | Buffer;

export interface VisionOptions {
  /** Sidecar base URL. Default `$HEXA_VISION_ENDPOINT` or http://127.0.0.1:8765 */
  endpoint?: string;
  /** Per-request budget. The health probe uses a much shorter one. Default 20000. */
  timeoutMs?: number;
  logger?: Logger;
  /** Disk cache root for detections and embeddings. Default `$HEXA_CACHE_DIR`/vision or ~/.cache/hexa/vision. */
  cacheDir?: string;
}

export interface DetectedFace {
  box: FaceBox;
  landmarks?: FaceLandmarks;
  /** Degrees. yaw>0 = head turned toward image-right, pitch>0 = chin up, roll>0 = tilt. */
  yaw?: number;
  pitch?: number;
  roll?: number;
}

export interface FaceEmbedding {
  /** L2-normalised, 512-d for buffalo_l. */
  vector: number[];
  /**
   * Producing model. Embeddings from different models are NOT comparable —
   * always check this matches before running a cosine against a stored vector.
   */
  model: string;
  box?: FaceBox;
}

export interface SegmentOptions {
  /** Reframe to head-and-shoulders using detected landmarks before matting. */
  bust?: boolean;
  /** Gaussian sigma applied to the alpha channel after edge refinement. */
  feather?: number;
  /** Sidecar alpha matting (slower, far better hair). Default true. */
  alphaMatting?: boolean;
  /** Trimap erode size for alpha matting — larger = wider "unknown" band. */
  erode?: number;
}

/** Verdict from comparing a render's face against a player's references. */
export interface IdentityVerdict {
  pass: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** sim - threshold. Negative when the gate fails. */
  margin: number;
}
