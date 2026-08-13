/**
 * VisionClient — the single entry point the rest of Hexa talks to.
 *
 * Design rule: a missing sidecar degrades the *quality* of a render, never its
 * ability to complete — with exactly one deliberate exception. `similarity()`
 * throws, because a fake identity check is worse than no identity check: it
 * would let a render claiming to be "Peyz vs Viper" ship with the wrong faces
 * and a green tick next to it.
 */

import type { AssetMetrics, FaceBox, FaceLandmarks, Logger } from '@hexa/core';
import { HexaError, createLogger } from '@hexa/core';
import { DiskCache, defaultCacheDir } from './cache.js';
import { fallbackMatte, fallbackMetrics, heuristicFaceLocate } from './fallback.js';
import { resolveImage, type ResolvedImage } from './image.js';
import { Sidecar, describeError, isProtocolError, isTransportError } from './sidecar.js';
import type { DetectedFace, FaceEmbedding, ImageInput, SegmentOptions, VisionOptions } from './types.js';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Health memo TTLs. A working sidecar is re-probed rarely; a missing one is
 * re-probed often enough that starting it mid-session is picked up quickly,
 * but not so often that every call pays a connect attempt.
 */
const HEALTH_TTL_OK_MS = 60_000;
const HEALTH_TTL_FAIL_MS = 10_000;
/** Hard ceiling on the probe. A render must never stall on a dead endpoint. */
const HEALTH_TIMEOUT_MS = 1_500;
/**
 * How long to stop asking a running sidecar for a model it has already said it
 * does not have. Without this, a sidecar whose weight download failed costs a
 * round trip and a 503 on every single asset of every render.
 */
const CAPABILITY_DOWN_TTL_MS = 60_000;

type Capability = 'face' | 'segment';

const RUN_HINT = 'Start the optional sidecar: bash services/vision/run.sh (serves http://127.0.0.1:8765)';

interface SidecarFace {
  box: FaceBox;
  landmarks?: FaceLandmarks | null;
  yaw?: number;
  pitch?: number;
  roll?: number;
}

interface DetectResponse {
  faces: SidecarFace[];
  width: number;
  height: number;
  model?: string;
}

interface EmbedResponse {
  embedding: number[];
  model: string;
  faceBox?: FaceBox;
}

interface EmbedBatchResponse {
  embeddings: (EmbedResponse | null)[];
  errors?: ({ code: string; message: string } | null)[];
  model: string;
}

interface SegmentResponse {
  png_base64: string;
  warnings?: string[];
  bust_applied?: boolean;
}

interface MetricsResponse extends Partial<AssetMetrics> {
  warnings?: string[];
}

export class VisionClient {
  private readonly sidecar: Sidecar;
  private readonly timeoutMs: number;
  private readonly log: Logger;
  private readonly cache: DiskCache;

  /** Memoised /health result. */
  private health?: { ok: boolean; at: number };
  private healthInflight?: Promise<boolean>;
  /** Model name reported by the sidecar, used to check cached vectors so a
   * model swap cannot silently mix incomparable embeddings. */
  private remoteModel = 'unknown';
  /** Capability -> timestamp after which it is worth retrying. */
  private readonly capabilityDown = new Map<Capability, number>();

  constructor(opts: VisionOptions = {}) {
    const endpoint = opts.endpoint ?? process.env.HEXA_VISION_ENDPOINT ?? DEFAULT_ENDPOINT;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log = (opts.logger ?? createLogger('info')).child('vision');
    this.sidecar = new Sidecar(endpoint, this.timeoutMs, this.log);
    this.cache = new DiskCache(opts.cacheDir ?? defaultCacheDir(), this.log);
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  /**
   * Is the sidecar up? Memoised with a TTL, never throws, and bounded by
   * min(timeoutMs, 1500ms) so an absent sidecar costs a connection refusal
   * rather than a stall. Concurrent callers share one in-flight probe.
   */
  async available(): Promise<boolean> {
    const now = Date.now();
    if (this.health) {
      const ttl = this.health.ok ? HEALTH_TTL_OK_MS : HEALTH_TTL_FAIL_MS;
      if (now - this.health.at < ttl) return this.health.ok;
    }
    if (this.healthInflight) return this.healthInflight;

    const probe = (async () => {
      const budget = Math.max(1, Math.min(this.timeoutMs, HEALTH_TIMEOUT_MS));
      try {
        const res = await this.sidecar.health(budget);
        const ok = res?.status === 'ok';
        const model = (res?.models as Record<string, unknown> | undefined)?.['faceModel'];
        if (typeof model === 'string' && model) this.remoteModel = model;
        this.health = { ok, at: Date.now() };
        this.log.debug(ok ? `sidecar available (v${res.version ?? '?'}, ${this.remoteModel})` : 'sidecar reported not-ok');
        return ok;
      } catch (err) {
        this.health = { ok: false, at: Date.now() };
        this.log.debug(`sidecar unavailable — degrading to pure-TS fallbacks: ${describeError(err)}`);
        return false;
      }
    })();

    this.healthInflight = probe.finally(() => {
      this.healthInflight = undefined;
    });
    return this.healthInflight;
  }

  /**
   * Record what a failure tells us. A transport failure means the process went
   * away between probes; a MODEL_UNAVAILABLE answer means the process is fine
   * but that capability is not, so stop asking for a while.
   */
  private noteFailure(err: unknown, capability?: Capability): void {
    if (isTransportError(err)) {
      this.health = { ok: false, at: Date.now() };
      return;
    }
    if (capability && isProtocolError(err) && err.isModelMissing) {
      this.capabilityDown.set(capability, Date.now() + CAPABILITY_DOWN_TTL_MS);
      this.log.warn(`sidecar has no ${capability} model — using fallbacks for the next 60s: ${err.message}`);
    }
  }

  /** False when the sidecar recently told us this model is missing. */
  private capable(capability: Capability): boolean {
    const until = this.capabilityDown.get(capability);
    if (until === undefined) return true;
    if (Date.now() < until) return false;
    this.capabilityDown.delete(capability);
    return true;
  }

  /** Path when the sidecar shares our filesystem, base64 otherwise. */
  private imageBody(img: ResolvedImage): Record<string, string> {
    if (img.path && this.sidecar.isLocal) return { image_path: img.path };
    return { image_base64: img.bytes.toString('base64') };
  }

  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  /**
   * Faces in the image, largest/most-confident first.
   *
   * With the sidecar: SCRFD boxes, 5-point landmarks and 3D head pose.
   * Without it: a skin-tone blob guess with confidence ≤ 0.4, no landmarks and
   * no pose. Fallback results are never cached, so the first call after the
   * sidecar comes up returns real detections.
   */
  async detectFaces(input: ImageInput): Promise<DetectedFace[]> {
    const img = await resolveImage(input);
    const cached = await this.cache.get<{ model: string; faces: DetectedFace[] }>('detect', img.hash);
    if (cached && this.modelCompatible(cached.model)) return cached.faces;

    if (this.capable('face') && (await this.available())) {
      try {
        const res = await this.sidecar.postJson<DetectResponse>('/detect', this.imageBody(img));
        const faces = (res.faces ?? []).map(toDetectedFace);
        await this.cache.set('detect', img.hash, { model: res.model ?? this.remoteModel, faces });
        return faces;
      } catch (err) {
        this.noteFailure(err, 'face');
        this.log.warn(`detect failed, falling back to heuristic locator: ${describeError(err)}`);
      }
    }
    return heuristicFaceLocate(img.bytes, this.log);
  }

  // -------------------------------------------------------------------------
  // Embeddings
  // -------------------------------------------------------------------------

  /**
   * 512-d L2-normalised ArcFace embedding of the primary face.
   *
   * Returns null when the sidecar is absent, when no face is found, or when the
   * image cannot be embedded. There is no fallback: identity is either measured
   * or it is not claimed.
   */
  async embed(input: ImageInput): Promise<FaceEmbedding | null> {
    const img = await resolveImage(input);
    const cached = await this.readEmbedCache(img.hash);
    if (cached !== undefined) return cached;

    if (!this.capable('face') || !(await this.available())) {
      this.log.debug('embed skipped — no face model available (identity verification is disabled)');
      return null;
    }
    try {
      const res = await this.sidecar.postJson<EmbedResponse>('/embed', this.imageBody(img));
      const embedding = toEmbedding(res);
      await this.cache.set('embed', img.hash, embedding);
      return embedding;
    } catch (err) {
      this.noteFailure(err, 'face');
      // A "no face here" answer is a real, cacheable result; a transport blip is not.
      if (isProtocolError(err) && err.code === 'NO_FACE') {
        await this.cache.set('embed', img.hash, null);
        this.log.debug('embed found no face');
        return null;
      }
      this.log.warn(`embed failed: ${describeError(err)}`);
      return null;
    }
  }

  /**
   * Cached embeddings outlive the sidecar process, which is the point: once a
   * reference photo has been embedded, comparing it offline with
   * `cosineSimilarity` keeps working. `undefined` means "not cached".
   */
  private async readEmbedCache(hash: string): Promise<FaceEmbedding | null | undefined> {
    const hit = await this.cache.get<FaceEmbedding | null>('embed', hash);
    if (hit === undefined) return undefined;
    if (hit && !this.modelCompatible(hit.model)) return undefined;
    return hit;
  }

  /**
   * Cross-model safety. When the sidecar has told us which model it runs, a
   * cache entry from a different one is a miss — vectors from different models
   * are not comparable, and silently mixing them would corrupt the gate. When
   * we have not spoken to a sidecar yet we accept the entry: it carries its own
   * `model` field, so a mismatch stays detectable downstream.
   */
  private modelCompatible(model: string | undefined): boolean {
    if (this.remoteModel === 'unknown' || !model) return true;
    return model === this.remoteModel;
  }

  /**
   * Embed many images in one round trip. Order and length always match the
   * input; entries are null where a face could not be embedded.
   */
  async embedBatch(inputs: ImageInput[]): Promise<(FaceEmbedding | null)[]> {
    if (inputs.length === 0) return [];
    const resolved = await Promise.all(inputs.map((i) => resolveImage(i)));
    const out: (FaceEmbedding | null)[] = new Array(inputs.length).fill(null);

    const missing: number[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const hit = await this.readEmbedCache(resolved[i]!.hash);
      if (hit !== undefined) out[i] = hit;
      else missing.push(i);
    }
    if (missing.length === 0) return out;

    if (!this.capable('face') || !(await this.available())) {
      this.log.debug(`embedBatch: no face model, ${missing.length} of ${inputs.length} left unembedded`);
      return out;
    }

    try {
      const res = await this.sidecar.postJson<EmbedBatchResponse>('/embed_batch', {
        images: missing.map((i) => this.imageBody(resolved[i]!)),
      });
      const rows = res.embeddings ?? [];
      for (let k = 0; k < missing.length; k++) {
        const idx = missing[k]!;
        const row = rows[k] ?? null;
        const embedding = row ? toEmbedding(row) : null;
        out[idx] = embedding;
        const code = res.errors?.[k]?.code;
        // Same rule as embed(): only cache a definite "no face", not a failure.
        if (embedding || code === 'NO_FACE') {
          await this.cache.set('embed', resolved[idx]!.hash, embedding);
        }
      }
    } catch (err) {
      this.noteFailure(err, 'face');
      this.log.warn(`embedBatch failed: ${describeError(err)}`);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Segmentation
  // -------------------------------------------------------------------------

  /**
   * RGBA PNG cutout of the subject.
   *
   * With the sidecar: rembg (isnet/u2net) with closed-form alpha matting, a
   * guided-filter edge refine and background colour decontamination — hair
   * survives compositing. `bust: true` reframes head-and-shoulders from
   * landmarks.
   * Without it: a border-seeded chroma/luma key with a feathered edge, and
   * `bust` framed from the heuristic box. Usable on clean backdrops, rough on
   * stage photography.
   */
  async segment(input: ImageInput, opts: SegmentOptions = {}): Promise<Buffer> {
    const img = await resolveImage(input);
    if (this.capable('segment') && (await this.available())) {
      try {
        const body: Record<string, unknown> = { ...this.imageBody(img) };
        if (opts.bust !== undefined) body['bust'] = opts.bust;
        if (opts.feather !== undefined) body['feather'] = opts.feather;
        if (opts.alphaMatting !== undefined) body['alpha_matting'] = opts.alphaMatting;
        if (opts.erode !== undefined) body['erode'] = opts.erode;
        const res = await this.sidecar.postJson<SegmentResponse>('/segment', body);
        for (const w of res.warnings ?? []) this.log.warn(`segment: ${w}`);
        if (opts.bust && res.bust_applied === false) {
          this.log.warn('segment: bust framing was requested but could not be applied');
        }
        const png = Buffer.from(res.png_base64, 'base64');
        if (png.length === 0) throw new HexaError('PROVIDER_ERROR', 'sidecar returned an empty cutout');
        return png;
      } catch (err) {
        this.noteFailure(err, 'segment');
        this.log.warn(`segment failed, falling back to chroma key: ${describeError(err)}`);
      }
    }
    return fallbackMatte(img.bytes, opts, this.log);
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /**
   * Image quality metrics. Always returns the pure-CV fields
   * (width/height/sharpness/brightness/contrast/palette) — those are computed
   * identically on both paths. Face-derived fields (faceBox, landmarks,
   * faceArea, yaw/pitch/roll, occlusion) are only fully populated by the
   * sidecar; the fallback supplies a heuristic faceBox/faceArea and omits pose
   * and occlusion entirely rather than inventing them.
   *
   * `quality` is never set here — composite scoring belongs to @hexa/assets,
   * which weights these metrics against what a given layout slot needs.
   */
  async metrics(input: ImageInput): Promise<Partial<AssetMetrics>> {
    const img = await resolveImage(input);
    if (await this.available()) {
      try {
        const res = await this.sidecar.postJson<MetricsResponse>('/metrics', this.imageBody(img));
        for (const w of res.warnings ?? []) this.log.debug(`metrics: ${w}`);
        const { warnings: _ignored, ...metrics } = res;
        // JSON nulls are not the same as absent optional fields — a consumer
        // doing `if (m.landmarks)` copes, but `m.landmarks!.leftEye` would not.
        for (const key of Object.keys(metrics) as (keyof typeof metrics)[]) {
          if (metrics[key] === null) delete metrics[key];
        }
        return metrics;
      } catch (err) {
        this.noteFailure(err);
        this.log.warn(`metrics failed, falling back to pure-TS: ${describeError(err)}`);
      }
    }
    return fallbackMetrics(img.bytes, this.log);
  }

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * Cosine similarity between the primary faces of two images.
   *
   * THROWS HexaError('VISION_UNAVAILABLE') when the sidecar is not running.
   * This is the one call with no fallback, by design: it is the mechanism that
   * enforces the product's identity guarantee, and a heuristic stand-in would
   * turn that guarantee into a lie. Callers gating a render should treat the
   * throw as "cannot verify" and decide policy (block, or ship marked
   * unverified) explicitly.
   */
  async similarity(a: ImageInput, b: ImageInput): Promise<number> {
    if (!(await this.available())) {
      throw new HexaError('VISION_UNAVAILABLE', 'face similarity requires the Python vision sidecar', {
        hint: RUN_HINT,
        details: { endpoint: this.sidecar.endpoint },
      });
    }
    if (!this.capable('face')) {
      throw new HexaError('VISION_UNAVAILABLE', 'the vision sidecar is running but has no face recognition model', {
        hint: `Reinstall its dependencies: bash services/vision/run.sh --reinstall`,
        details: { endpoint: this.sidecar.endpoint },
      });
    }
    const [ia, ib] = await Promise.all([resolveImage(a), resolveImage(b)]);
    try {
      const res = await this.sidecar.postJson<{ similarity: number }>('/similarity', {
        a: this.imageBody(ia),
        b: this.imageBody(ib),
      });
      if (typeof res.similarity !== 'number' || Number.isNaN(res.similarity)) {
        throw new HexaError('PROVIDER_ERROR', 'sidecar returned a non-numeric similarity');
      }
      return res.similarity;
    } catch (err) {
      this.noteFailure(err, 'face');
      if (isTransportError(err)) {
        throw new HexaError('VISION_UNAVAILABLE', `vision sidecar went away: ${err.message}`, {
          hint: RUN_HINT,
          details: { endpoint: this.sidecar.endpoint },
          cause: err,
        });
      }
      if (isProtocolError(err)) throw err.toHexaError();
      throw err;
    }
  }
}

function toDetectedFace(face: SidecarFace): DetectedFace {
  const out: DetectedFace = { box: face.box };
  if (face.landmarks) out.landmarks = face.landmarks;
  if (typeof face.yaw === 'number') out.yaw = face.yaw;
  if (typeof face.pitch === 'number') out.pitch = face.pitch;
  if (typeof face.roll === 'number') out.roll = face.roll;
  return out;
}

/**
 * Is this actually an embedding?
 *
 * A vector reaches three places that outlive the call: the identity gate, the
 * disk cache, and — through ingestion — `ReferenceAsset.embedding` in the
 * library manifest. So a sidecar that answers with zeros because its weights
 * never downloaded, or with nulls because the model emitted NaN and JSON
 * flattened it, does not merely give one wrong answer; it persists one that
 * every later comparison inherits.
 *
 * Cosine similarity is undefined for a zero-magnitude vector and meaningless
 * with a non-finite component, so neither is an embedding. "No usable face" is
 * the honest answer.
 */
function usableVector(v: unknown): v is number[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  let norm = 0;
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return false;
    norm += x * x;
  }
  return norm > 0;
}

function toEmbedding(res: EmbedResponse | null | undefined): FaceEmbedding | null {
  if (!res || !usableVector(res.embedding) || typeof res.model !== 'string' || res.model === '') return null;
  const out: FaceEmbedding = { vector: res.embedding, model: res.model };
  if (res.faceBox) out.box = res.faceBox;
  return out;
}
