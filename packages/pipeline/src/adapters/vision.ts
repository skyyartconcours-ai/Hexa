/**
 * @hexa/vision adapter — cutouts, face geometry and identity embeddings.
 *
 * Availability is a first-class concern. The vision sidecar is an *optional*
 * Python service; when it is down the pipeline must still produce a thumbnail,
 * just without alpha-matted hair edges and without a verifiable identity claim.
 * So every call here has a defined "unavailable" answer, and the caller decides
 * how to degrade. What the pipeline must never do is quietly pass the identity
 * gate when it could not actually check (docs/IDENTITY.md).
 */

import type { FaceBox, FaceLandmarks } from '@hexa/core';
import { loadModule } from './load.js';
import { toArray, toBuffer, toEmbedding, toFaceBox, toLandmarks, toNumber } from './normalise.js';
import {
  VISION_EXPORTS,
  type IdentityVerdict,
  type ImageInput,
  type SegmentOptions,
  type VisionClient,
  type VisionModule,
} from './contracts.js';

const SPEC = '@hexa/vision';
const HINT = 'The vision package is not built. Run: pnpm --filter @hexa/vision build';

async function mod(): Promise<VisionModule> {
  return loadModule<VisionModule>(SPEC, { needs: VISION_EXPORTS, hint: HINT });
}

export async function createVisionClient(opts: { endpoint?: string; timeoutMs?: number } = {}): Promise<VisionClient> {
  const m = await mod();
  const Ctor = m.VisionClient;
  if (typeof Ctor?.create === 'function') return await Ctor.create(opts);
  return new Ctor(opts);
}

/** Never throws — an unreachable sidecar is a state, not an error. */
export async function isAvailable(client: VisionClient | undefined): Promise<boolean> {
  if (!client) return false;
  try {
    return await client.available();
  } catch {
    return false;
  }
}

export interface SegmentResult {
  /** RGBA cutout bytes. */
  buffer: Buffer;
  /** True when the sidecar produced this, false when we fell back. */
  matted: boolean;
}

/**
 * Alpha cutout of the subject.
 *
 * @returns `undefined` when the sidecar is unavailable or returned nothing
 * usable, so the caller can fall back to `asset.cutoutPath` and then the raw
 * image.
 */
export async function segment(
  client: VisionClient,
  image: ImageInput,
  opts: SegmentOptions = {},
): Promise<Buffer | undefined> {
  try {
    return toBuffer(await client.segment(image, opts));
  } catch {
    return undefined;
  }
}

export interface FaceGeometry {
  box?: FaceBox;
  landmarks?: FaceLandmarks;
  yaw?: number;
  pitch?: number;
  roll?: number;
}

/**
 * Primary (largest, most confident) face. Empty object when no face is found —
 * a legitimate outcome for a logo, a back-turned action shot or a placeholder.
 */
export async function detectPrimaryFace(client: VisionClient, image: ImageInput): Promise<FaceGeometry> {
  try {
    const raw = await client.detectFaces(image, { maxFaces: 1 });
    const first = toArray(raw)[0] ?? raw;
    if (first === undefined || first === null) return {};
    return {
      box: toFaceBox(first),
      landmarks: toLandmarks(first),
      yaw: toNumber((first as Record<string, unknown>)['yaw']),
      pitch: toNumber((first as Record<string, unknown>)['pitch']),
      roll: toNumber((first as Record<string, unknown>)['roll']),
    };
  } catch {
    return {};
  }
}

/** Face embedding for identity verification, or `undefined` when unavailable. */
export async function embed(client: VisionClient, image: ImageInput): Promise<number[] | undefined> {
  try {
    return toEmbedding(await client.embed(image));
  } catch {
    return undefined;
  }
}

export async function embedBatch(client: VisionClient, images: readonly ImageInput[]): Promise<(number[] | undefined)[]> {
  try {
    const raw = toArray(await client.embedBatch(images));
    if (raw.length === images.length) return raw.map((r) => toEmbedding(r));
  } catch {
    // fall through to serial embedding
  }
  const out: (number[] | undefined)[] = [];
  for (const img of images) out.push(await embed(client, img));
  return out;
}

export async function defaultIdentityThreshold(): Promise<number> {
  try {
    const m = await mod();
    return toNumber(m.DEFAULT_IDENTITY_THRESHOLD) ?? 0.35;
  } catch {
    return 0.35;
  }
}

/**
 * Compare a rendered face against a player's reference gallery.
 *
 * When verification cannot run the verdict carries `reason` and `passed: true`
 * with a `similarity` of NaN-free 0 — the *gate* upstream turns that into a
 * warning. Silently claiming a pass with no evidence is the one behaviour the
 * identity guarantee forbids, so the reason always travels with the verdict.
 */
export async function identityVerdict(
  probe: readonly number[] | undefined,
  gallery: readonly (readonly number[])[],
  threshold?: number,
): Promise<IdentityVerdict> {
  const fallbackThreshold = threshold ?? (await defaultIdentityThreshold());
  if (!probe || probe.length === 0) {
    return { similarity: 0, threshold: fallbackThreshold, passed: true, reason: 'no face embedding from the rendered image' };
  }
  if (gallery.length === 0) {
    return { similarity: 0, threshold: fallbackThreshold, passed: true, reason: 'no reference embeddings for this player' };
  }
  const m = await mod();
  const verdict = (m.identityVerdict(probe, gallery, fallbackThreshold) ?? {}) as Record<string, unknown>;
  return {
    ...verdict,
    similarity: toNumber(verdict['similarity']) ?? 0,
    threshold: toNumber(verdict['threshold']) ?? fallbackThreshold,
    passed: verdict['passed'] !== false,
  };
}

export async function cosineSimilarity(a: readonly number[], b: readonly number[]): Promise<number> {
  return (await mod()).cosineSimilarity(a, b);
}

export async function meanEmbedding(embeddings: readonly (readonly number[])[]): Promise<number[]> {
  return (await mod()).meanEmbedding(embeddings);
}

export async function bestSimilarity(probe: readonly number[], gallery: readonly (readonly number[])[]): Promise<number> {
  return (await mod()).bestSimilarity(probe, gallery);
}

export type { IdentityVerdict, SegmentOptions, VisionClient };
