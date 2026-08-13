/**
 * Replicate — generic hosted-model runner.
 *
 * VERIFIED 2026-08-13 against Replicate's own official JavaScript SDK source
 * (`replicate/replicate-javascript`: `index.js`, `index.d.ts`,
 * `lib/predictions.js`), which is generated against and exercised by the live
 * API:
 *
 *   base   : https://api.replicate.com/v1
 *   auth   : `Authorization: Bearer <REPLICATE_API_TOKEN>`
 *   create : POST /models/{owner}/{name}/predictions   body `{ input }`
 *            POST /predictions                          body `{ version, input }`
 *   sync   : `Prefer: wait` (or `wait=<seconds>`) holds the connection open
 *            until the prediction finishes; an expired wait returns the
 *            in-progress prediction, so the poll loop below is still required
 *   poll   : GET /predictions/{id}
 *   status : starting | processing | succeeded | failed | canceled | aborted
 *   result : `output` — a URL string, an array of URL strings, or a stream
 *            reference; `error`; `urls.get`
 *
 * UNVERIFIED, and deliberately so: the *model slugs and their input schemas*.
 * Replicate is a marketplace — every checkpoint declares its own inputs, and
 * those change without notice. The transport above is stable API surface; the
 * model names below are defaults, not verified contracts, so everything is
 * env-overridable (`HEXA_REPLICATE_MODEL`, `HEXA_REPLICATE_EDIT_MODEL`) and the
 * input mapping is written defensively: unknown fields are simply not sent, and
 * a schema mismatch surfaces as a normal provider error naming the model.
 *
 * This provider exists mainly for the identity-preserving pipelines that live
 * on Replicate — IP-Adapter, InstantID, Flux redux and friends — where the
 * reference photograph drives the result. Those are exactly the shape Hexa
 * wants: a photograph supplying identity, a model supplying everything else.
 */

import { HexaError, log } from '@hexa/core';
import type {
  BackplateRequest,
  GeneratedImage,
  IdentityEditRequest,
  ImageProvider,
  ProviderCapabilities,
} from '../types.js';
import { assertIdentityEditSafe, assertNegativePromptSafe, assertNoPersonGeneration } from '../guard.js';
import { PROVIDER_ENV, readApiKey } from '../config.js';
import { fetchBinary, getJson, postJson } from '../http.js';
import { clampToCapabilities, nearestAspect, notConfigured, toGeneratedImage } from './shared.js';

const BASE = 'https://api.replicate.com/v1';

/** Defaults only — see the UNVERIFIED note in the file header. */
const DEFAULT_MODEL = 'black-forest-labs/flux-1.1-pro';
const DEFAULT_EDIT_MODEL = 'black-forest-labs/flux-kontext-pro';

/** How long to let the server hold the connection before falling back to polling. */
const SYNC_WAIT_SECONDS = 60;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 240_000;

interface Prediction {
  id?: string;
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'aborted';
  output?: unknown;
  error?: unknown;
  urls?: { get?: string; cancel?: string };
  metrics?: { predict_time?: number };
}

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'aborted']);

/** Pull the first image URL out of whatever shape the model returned. */
function outputUrl(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = outputUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (output && typeof output === 'object') {
    const rec = output as Record<string, unknown>;
    for (const key of ['url', 'image', 'output', 'images']) {
      if (key in rec) {
        const found = outputUrl(rec[key]);
        if (found) return found;
      }
    }
  }
  return undefined;
}

export class ReplicateProvider implements ImageProvider {
  readonly id = 'replicate';

  readonly capabilities: ProviderCapabilities = {
    backplate: true,
    // The reason this provider is here: reference-image pipelines that keep a
    // photographed face and repaint everything around it.
    identityGuidedEdit: true,
    inpaint: false,
    upscale: false,
    maxSize: { width: 4096, height: 4096 },
  };

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private model(): string {
    return this.env.HEXA_REPLICATE_MODEL?.trim() || DEFAULT_MODEL;
  }

  private editModel(): string {
    return this.env.HEXA_REPLICATE_EDIT_MODEL?.trim() || DEFAULT_EDIT_MODEL;
  }

  isConfigured(): boolean {
    return readApiKey('replicate', this.env) !== undefined;
  }

  async generateBackplate(req: BackplateRequest): Promise<GeneratedImage> {
    assertNoPersonGeneration(req.prompt ?? '');
    assertNegativePromptSafe(req.negativePrompt);
    const key = readApiKey('replicate', this.env) ?? notConfigured('replicate', PROVIDER_ENV.replicate!);
    const { width, height } = clampToCapabilities(req.width, req.height, this.capabilities, 'replicate');
    const model = this.model();

    // Superset of the inputs the common text-to-image checkpoints accept.
    // Extra keys are ignored by Replicate's schema validation on most models;
    // when they are not, the error names the offending field and the model.
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: nearestAspect(width, height),
      width,
      height,
      output_format: 'png',
      num_outputs: 1,
      ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
      ...(Number.isFinite(req.seed) ? { seed: (req.seed as number) >>> 0 } : {}),
    };

    const prediction = await this.run(model, input, key);
    const buffer = await this.download(prediction, key, model);
    return toGeneratedImage(buffer, {
      width,
      height,
      provider: 'replicate',
      model,
      seed: req.seed,
      promptUsed: req.prompt ?? '',
    });
  }

  async identityGuidedEdit(req: IdentityEditRequest): Promise<GeneratedImage> {
    await assertIdentityEditSafe(req);
    const key = readApiKey('replicate', this.env) ?? notConfigured('replicate', PROVIDER_ENV.replicate!);
    const model = this.editModel();
    const size = await imageSize(req.image);

    // The source photograph is sent inline as a data URI — Replicate accepts
    // data URIs for file inputs, which avoids needing an upload round-trip or a
    // publicly reachable URL for what is licensed material.
    const dataUri = `data:image/png;base64,${req.image.toString('base64')}`;
    const input: Record<string, unknown> = {
      prompt:
        `${req.prompt}. Identity-preserving edit: keep the face and head exactly as photographed; ` +
        'change only lighting, colour and background.',
      image: dataUri,
      input_image: dataUri,
      // Low strength keeps the photograph in charge of the likeness. The
      // ceiling itself is enforced by `guardIdentityEdit` before we get here.
      prompt_strength: req.strength,
      strength: req.strength,
      output_format: 'png',
      ...(req.mask ? { mask: `data:image/png;base64,${req.mask.toString('base64')}` } : {}),
      ...(Number.isFinite(req.seed) ? { seed: (req.seed as number) >>> 0 } : {}),
    };

    const prediction = await this.run(model, input, key);
    const buffer = await this.download(prediction, key, model);
    return toGeneratedImage(buffer, {
      width: size.width,
      height: size.height,
      provider: 'replicate',
      model,
      seed: req.seed,
      promptUsed: req.prompt,
    });
  }

  /** Create a prediction and wait for a terminal status. */
  private async run(model: string, input: Record<string, unknown>, key: string): Promise<Prediction> {
    const isVersionHash = /^[0-9a-f]{40,}$/i.test(model);
    const url = isVersionHash ? `${BASE}/predictions` : `${BASE}/models/${model}/predictions`;
    const body = isVersionHash ? { version: model, input } : { input };

    let prediction = await postJson<Prediction>(url, body, {
      provider: 'replicate',
      secret: key,
      headers: {
        authorization: `Bearer ${key}`,
        // Synchronous mode: the server holds the connection rather than making
        // us poll from the first millisecond.
        prefer: `wait=${SYNC_WAIT_SECONDS}`,
      },
    });

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (!TERMINAL.has(prediction.status ?? '')) {
      if (Date.now() > deadline) {
        throw new HexaError('PROVIDER_ERROR', `[replicate] prediction did not finish within ${POLL_TIMEOUT_MS / 1000}s.`, {
          hint: 'Try a faster model, or render with --provider local.',
          details: { provider: 'replicate', model, predictionId: prediction.id },
        });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      // The poll URL comes out of the response body, and the body is shaped by
      // whatever model the user pointed us at. Following it blindly would send
      // the account token wherever a marketplace model asked.
      const offered = prediction.urls?.get;
      const canonical = `${BASE}/predictions/${prediction.id}`;
      let pollUrl = canonical;
      if (offered) {
        if (isReplicateHost(offered)) {
          pollUrl = offered;
        } else {
          log.warn('Ignoring a non-Replicate polling URL from a prediction response.', {
            offered: hostOf(offered),
            using: 'api.replicate.com',
          });
        }
      }
      prediction = await getJson<Prediction>(pollUrl, {
        provider: 'replicate',
        secret: key,
        headers: { authorization: `Bearer ${key}` },
      });
    }

    if (prediction.status !== 'succeeded') {
      const detail = typeof prediction.error === 'string' ? prediction.error : JSON.stringify(prediction.error ?? {});
      throw new HexaError('PROVIDER_ERROR', `[replicate] prediction ${prediction.status}: ${detail}`, {
        hint: `Check that "${model}" exists and accepts the inputs Hexa sends, or set HEXA_REPLICATE_MODEL.`,
        details: { provider: 'replicate', model, status: prediction.status },
      });
    }
    return prediction;
  }

  private async download(prediction: Prediction, key: string, model: string): Promise<Buffer> {
    const url = outputUrl(prediction.output);
    if (!url) {
      throw new HexaError('PROVIDER_ERROR', `[replicate] model "${model}" returned no image URL.`, {
        hint: 'The model may not be an image model, or its output schema differs. Set HEXA_REPLICATE_MODEL.',
        details: { provider: 'replicate', model },
      });
    }
    if (url.startsWith('data:')) {
      return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    }
    if (!/^https?:$/.test(schemeOf(url))) {
      throw new HexaError('PROVIDER_ERROR', `[replicate] model "${model}" returned a non-HTTP output URL.`, {
        hint: 'Hexa only downloads model output over http(s) or as a data: URI.',
        details: { provider: 'replicate', model, scheme: schemeOf(url) },
      });
    }
    // Replicate is a marketplace: the *model* decides this URL. Attaching the
    // account token to it means any published model can harvest the token by
    // returning `https://attacker.example/x.png`. Output on Replicate's own
    // hosts gets the token; anywhere else is fetched anonymously.
    const trusted = isReplicateHost(url);
    if (!trusted) {
      log.warn('Downloading Replicate model output from a third-party host without the API token.', {
        host: hostOf(url),
      });
    }
    return fetchBinary(url, {
      provider: 'replicate',
      secret: key,
      ...(trusted ? { headers: { authorization: `Bearer ${key}` } } : {}),
    });
  }
}

/** Replicate's own hosts: the API and the CDN model outputs are served from. */
const REPLICATE_HOSTS = /(?:^|\.)replicate\.(?:com|delivery)$/i;

function isReplicateHost(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && REPLICATE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '<unparseable>';
  }
}

function schemeOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

async function imageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buffer).metadata();
  return { width: meta.width ?? 1024, height: meta.height ?? 1024 };
}

export const replicateProvider = new ReplicateProvider();
