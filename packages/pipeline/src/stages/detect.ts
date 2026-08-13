/**
 * Stage 4 — detect.
 *
 * Locate the face in the cutout. Everything that makes a composite look
 * deliberate is measured from here: where the face lands relative to the slot's
 * focal point, which way the subject looks, how tightly to crop, and which
 * region QA will later crop out and verify.
 *
 * The subtle correctness issue this stage exists to handle: `asset.metrics`
 * records a face box **in the original photograph's coordinates**. A bust crop
 * re-frames the image, so those coordinates no longer describe the buffer we are
 * about to composite. Using them anyway would put the face marker somewhere near
 * the subject's shoulder and quietly ruin every downstream placement — so cached
 * metrics are only trusted when the framing provably still matches.
 */

import type { FaceBox, FaceLandmarks, Logger, ReferenceAsset } from '@hexa/core';
import type { VisionClient } from '../adapters/contracts.js';
import { detectPrimaryFace } from '../adapters/vision.js';

export type DetectSource = 'vision' | 'asset-metrics' | 'none';

export interface DetectOptions {
  vision: VisionClient;
  asset: ReferenceAsset;
  cutout: Buffer;
  /** Size of `cutout`, when already known. */
  size?: { width: number; height: number };
  /** From the cutout stage: do `asset.metrics` coordinates still apply? */
  sameFramingAsOriginal: boolean;
  logger: Logger;
}

export interface DetectResult {
  faceBox?: FaceBox;
  landmarks?: FaceLandmarks;
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Which way the subject looks — decides whether to mirror the cutout. */
  facing: 'left' | 'right' | 'front';
  source: DetectSource;
  warnings: string[];
}

/** Beyond this yaw the head reads as turned rather than facing the camera. */
const FACING_YAW_THRESHOLD = 12;

export async function detectFace(opts: DetectOptions): Promise<DetectResult> {
  const warnings: string[] = [];

  // Live detection first: its coordinates are guaranteed to describe the exact
  // buffer being composited, whatever cropping happened upstream.
  const detected = await detectPrimaryFace(opts.vision, opts.cutout);
  if (detected.box) {
    return {
      faceBox: detected.box,
      landmarks: detected.landmarks,
      yaw: detected.yaw,
      pitch: detected.pitch,
      roll: detected.roll,
      facing: facingFrom(detected.yaw, detected.landmarks, opts.size),
      source: 'vision',
      warnings,
    };
  }

  // Enriched metrics from ingestion — only valid against the original framing.
  const metrics = opts.asset.metrics;
  if (opts.sameFramingAsOriginal && metrics?.faceBox) {
    const scaled = rescale(metrics.faceBox, metrics, opts.size);
    const landmarks = metrics.landmarks ? rescaleLandmarks(metrics.landmarks, metrics, opts.size) : undefined;
    return {
      faceBox: scaled,
      landmarks,
      yaw: metrics.yaw,
      pitch: metrics.pitch,
      roll: metrics.roll,
      facing: facingFrom(metrics.yaw, landmarks, opts.size),
      source: 'asset-metrics',
      warnings,
    };
  }

  if (metrics?.faceBox && !opts.sameFramingAsOriginal) {
    warnings.push(
      `Ignored stored face geometry for ${opts.asset.id}: the cutout was re-framed, so those coordinates no longer apply. ` +
        `Start the vision sidecar for accurate face placement.`,
    );
  } else if (opts.asset.tags?.includes('placeholder') !== true) {
    warnings.push(
      `No face detected in ${opts.asset.id} — the subject will be centred on the slot rather than face-anchored, and identity cannot be verified.`,
    );
  }

  return { facing: 'front', source: 'none', warnings };
}

/**
 * Which way is the subject looking?
 *
 * Head yaw when we have it. Otherwise infer from the eyes: in a head turned to
 * the subject's left, the visible eye pair sits off-centre in the face. That is
 * cruder than pose estimation but far better than assuming everyone faces front,
 * because facing decides mirroring, and a mirrored subject looking out of frame
 * is the mistake that makes a composite look amateur.
 */
export function facingFrom(
  yaw: number | undefined,
  landmarks: FaceLandmarks | undefined,
  size: { width: number; height: number } | undefined,
): 'left' | 'right' | 'front' {
  if (yaw !== undefined && Number.isFinite(yaw)) {
    if (yaw <= -FACING_YAW_THRESHOLD) return 'left';
    if (yaw >= FACING_YAW_THRESHOLD) return 'right';
    return 'front';
  }

  if (landmarks && size && size.width > 0) {
    const eyeMid = (landmarks.leftEye[0] + landmarks.rightEye[0]) / 2;
    const noseOffset = landmarks.nose[0] - eyeMid;
    const eyeSpan = Math.abs(landmarks.rightEye[0] - landmarks.leftEye[0]) || 1;
    // The nose drifts toward the side the head is turned to.
    const ratio = noseOffset / eyeSpan;
    if (ratio < -0.18) return 'left';
    if (ratio > 0.18) return 'right';
  }

  return 'front';
}

/**
 * Metrics were measured on the original file; the cutout may have been resized
 * (a downscaled matte, say). Same framing, different resolution — so scale.
 */
function rescale(
  box: FaceBox,
  metrics: { width: number; height: number },
  size: { width: number; height: number } | undefined,
): FaceBox {
  const factor = scaleFactor(metrics, size);
  if (factor === 1) return box;
  return { x: box.x * factor, y: box.y * factor, w: box.w * factor, h: box.h * factor, confidence: box.confidence };
}

function rescaleLandmarks(
  landmarks: FaceLandmarks,
  metrics: { width: number; height: number },
  size: { width: number; height: number } | undefined,
): FaceLandmarks {
  const factor = scaleFactor(metrics, size);
  if (factor === 1) return landmarks;
  const s = (p: [number, number]): [number, number] => [p[0] * factor, p[1] * factor];
  return {
    leftEye: s(landmarks.leftEye),
    rightEye: s(landmarks.rightEye),
    nose: s(landmarks.nose),
    mouthLeft: s(landmarks.mouthLeft),
    mouthRight: s(landmarks.mouthRight),
  };
}

function scaleFactor(
  metrics: { width: number; height: number },
  size: { width: number; height: number } | undefined,
): number {
  if (!size || !metrics.width || !metrics.height) return 1;
  const fx = size.width / metrics.width;
  const fy = size.height / metrics.height;
  // Only a uniform rescale is a safe assumption; anything else means the framing
  // changed after all, and scaling would invent a face position.
  return Math.abs(fx - fy) < 0.02 ? fx : 1;
}
