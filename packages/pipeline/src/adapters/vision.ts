/**
 * @hexa/vision adapter — cutouts, face geometry and identity embeddings.
 *
 * Availability is a first-class concern. The vision sidecar is an *optional*
 * Python service; when it is down the pipeline must still produce a thumbnail,
 * just without alpha-matted hair edges and without a verifiable identity claim.
 * So every call here has a defined "unavailable" answer and the caller decides
 * how to degrade. What the pipeline must never do is quietly pass the identity
 * gate when it could not actually check (docs/IDENTITY.md) — so the "could not
 * verify" verdict always carries a `reason`, and callers surface it.
 *
 * Two translations happen here:
 *  - `embed` returns `{vector, model}`; the pipeline works in bare `number[]`.
 *  - `identityVerdict(sim, threshold)` takes an already-computed similarity, so
 *    this adapter runs `bestSimilarity` against the gallery first.
 */

import type { FaceBox, FaceLandmarks } from '@hexa/core';
import { loadModule } from './load.js';
import { toBuffer, toNumber } from './normalise.js';
import {
  VISION_EXPORTS,
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
  return new m.VisionClient(opts);
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
 * Primary (largest, most confident) face. An empty object is a legitimate
 * outcome — a logo, a back-turned action shot or a placeholder has no face.
 */
export async function detectPrimaryFace(client: VisionClient, image: ImageInput): Promise<FaceGeometry> {
  try {
    const faces = await client.detectFaces(image);
    // The sibling returns faces largest-and-most-confident first.
    const first = faces?.[0];
    if (!first?.box) return {};
    return { box: first.box, landmarks: first.landmarks, yaw: first.yaw, pitch: first.pitch, roll: first.roll };
  } catch {
    return {};
  }
}

/** Face embedding vector, or `undefined` when it could not be produced. */
export async function embed(client: VisionClient, image: ImageInput): Promise<number[] | undefined> {
  try {
    const out = await client.embed(image);
    return out?.vector && out.vector.length > 0 ? out.vector : undefined;
  } catch {
    return undefined;
  }
}

/** Embedding plus the model that produced it — vectors from different models
 *  are not comparable, so the model travels with the vector. */
export async function embedWithModel(
  client: VisionClient,
  image: ImageInput,
): Promise<{ vector: number[]; model: string } | undefined> {
  try {
    const out = await client.embed(image);
    return out?.vector && out.vector.length > 0 ? { vector: out.vector, model: out.model } : undefined;
  } catch {
    return undefined;
  }
}

export async function embedBatch(client: VisionClient, images: readonly ImageInput[]): Promise<(number[] | undefined)[]> {
  try {
    const out = await client.embedBatch([...images]);
    if (out?.length === images.length) return out.map((e) => (e?.vector?.length ? e.vector : undefined));
  } catch {
    // fall through to serial embedding
  }
  const results: (number[] | undefined)[] = [];
  for (const img of images) results.push(await embed(client, img));
  return results;
}

export async function defaultIdentityThreshold(): Promise<number> {
  try {
    return toNumber((await mod()).DEFAULT_IDENTITY_THRESHOLD) ?? 0.45;
  } catch {
    return 0.45;
  }
}

/** The pipeline's verdict shape — `passed`, plus why when it could not check. */
export interface IdentityCheck {
  similarity: number;
  threshold: number;
  passed: boolean;
  confidence?: 'high' | 'medium' | 'low';
  margin?: number;
  /** Set when verification could not run. Never treat this as a pass. */
  reason?: string;
}

/**
 * Compare a rendered face against a player's reference gallery.
 *
 * When there is nothing to compare — no probe, or an empty gallery — the result
 * is `passed: true` **with a `reason`**. Blocking a render because the sidecar is
 * down would make the tool unusable offline; claiming a verified likeness on no
 * evidence would make the guarantee a lie. So it passes, and says it did not
 * check, and the caller turns that into a warning the operator can see.
 */
export async function identityCheck(
  probe: readonly number[] | undefined,
  gallery: readonly (readonly number[])[],
  threshold?: number,
): Promise<IdentityCheck> {
  const t = threshold ?? (await defaultIdentityThreshold());
  if (!probe || probe.length === 0) {
    return { similarity: 0, threshold: t, passed: true, reason: 'no face embedding from the rendered image' };
  }
  if (gallery.length === 0) {
    return { similarity: 0, threshold: t, passed: true, reason: 'no reference embeddings for this player' };
  }

  const m = await mod();
  const similarity = m.bestSimilarity([...probe], gallery.map((g) => [...g]));
  const verdict = m.identityVerdict(similarity, t);
  return {
    similarity,
    threshold: t,
    passed: verdict.pass,
    confidence: verdict.confidence,
    margin: verdict.margin,
  };
}

export async function cosineSimilarity(a: readonly number[], b: readonly number[]): Promise<number> {
  return (await mod()).cosineSimilarity([...a], [...b]);
}

export async function meanEmbedding(embeddings: readonly (readonly number[])[]): Promise<number[]> {
  return (await mod()).meanEmbedding(embeddings.map((e) => [...e]));
}

export async function bestSimilarity(probe: readonly number[], gallery: readonly (readonly number[])[]): Promise<number> {
  return (await mod()).bestSimilarity([...probe], gallery.map((g) => [...g]));
}

export type { SegmentOptions, VisionClient };
