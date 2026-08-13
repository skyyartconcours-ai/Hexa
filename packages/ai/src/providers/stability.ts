/**
 * Stability AI (Stable Image v2beta).
 *
 * VERIFICATION NOTE, 2026-08-13. The primary documentation host
 * (`platform.stability.ai`) is unreachable from this environment — the egress
 * proxy blocks it — so the endpoint paths, form fields and response shape below
 * were verified against a *secondary* source: the typed Stability client in
 * LiteLLM (`litellm/types/llms/stability.py` and
 * `litellm/llms/stability/image_generation/transformation.py`), corroborated by
 * independent search results describing the same endpoints, the
 * `Authorization: Bearer` + `Accept` header pair, and the multipart body. Treat
 * this integration as **verified-by-proxy rather than first-party**: the shapes
 * are consistent across two independent sources but were not read from
 * Stability's own reference page.
 *
 *   POST https://api.stability.ai/v2beta/stable-image/generate/{ultra|core|sd3}
 *   POST https://api.stability.ai/v2beta/stable-image/edit/inpaint
 *   POST https://api.stability.ai/v2beta/stable-image/upscale/{fast|conservative|creative}
 *   auth   : `Authorization: Bearer <key>`
 *   accept : `application/json` → `{ image: <base64>, finish_reason, seed }`
 *            (`image/*` would return raw bytes; JSON is used so `finish_reason`
 *            is readable — a CONTENT_FILTERED result returns HTTP 200 with a
 *            blank image, which must not be mistaken for success)
 *   body   : multipart/form-data — prompt, negative_prompt, aspect_ratio, seed,
 *            output_format, style_preset, mode, image, strength
 */

import { HexaError } from '@hexa/core';
import type {
  BackplateRequest,
  GeneratedImage,
  IdentityEditRequest,
  ImageProvider,
  InpaintRequest,
  ProviderCapabilities,
  UpscaleRequest,
} from '../types.js';
import { assertNoPersonGeneration, guardIdentityEdit } from '../guard.js';
import { PROVIDER_ENV, readApiKey } from '../config.js';
import { httpRequest } from '../http.js';
import {
  clampToCapabilities,
  decodeBase64Image,
  multipart,
  nearestAspect,
  notConfigured,
  toGeneratedImage,
} from './shared.js';

const BASE = 'https://api.stability.ai/v2beta/stable-image';

/** Aspect ratios the v2beta generate endpoints accept. */
const STABILITY_ASPECTS: ReadonlyArray<[string, number]> = [
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['3:2', 1.5],
  ['5:4', 1.25],
  ['4:3', 4 / 3],
  ['1:1', 1],
  ['3:4', 0.75],
  ['4:5', 0.8],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
  ['9:21', 9 / 21],
];

/** Endpoint per tier. `ultra` is the highest quality; `core` the cheapest. */
const TIERS: Record<string, string> = {
  ultra: `${BASE}/generate/ultra`,
  core: `${BASE}/generate/core`,
  sd3: `${BASE}/generate/sd3`,
};

interface StabilityResult {
  image?: string;
  finish_reason?: string;
  seed?: number;
  errors?: string[];
  name?: string;
  message?: string;
}

function unwrap(res: StabilityResult, context: string): { buffer: Buffer; seed?: number } {
  if (res.finish_reason && res.finish_reason !== 'SUCCESS') {
    throw new HexaError('PROVIDER_ERROR', `[stability] ${context} finished as ${res.finish_reason}.`, {
      hint:
        res.finish_reason === 'CONTENT_FILTERED'
          ? 'The safety filter blanked the image. Adjust the prompt or render with --provider local.'
          : 'Retry, or render with --provider local.',
      details: { provider: 'stability', finishReason: res.finish_reason },
    });
  }
  if (!res.image) {
    const detail = res.errors?.join('; ') ?? res.message ?? 'no image field in response';
    throw new HexaError('PROVIDER_ERROR', `[stability] ${context} returned no image: ${detail}`, {
      details: { provider: 'stability' },
    });
  }
  return { buffer: decodeBase64Image(res.image), seed: res.seed };
}

export class StabilityProvider implements ImageProvider {
  readonly id = 'stability';

  readonly capabilities: ProviderCapabilities = {
    backplate: true,
    // sd3 image-to-image with a low `strength` keeps the source composition —
    // the strength ceiling itself is enforced by `guardIdentityEdit`.
    identityGuidedEdit: true,
    inpaint: true,
    upscale: true,
    maxSize: { width: 4096, height: 4096 },
  };

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private tier(): string {
    const t = this.env.HEXA_STABILITY_TIER?.trim().toLowerCase();
    return t && TIERS[t] ? t : 'ultra';
  }

  isConfigured(): boolean {
    return readApiKey('stability', this.env) !== undefined;
  }

  async generateBackplate(req: BackplateRequest): Promise<GeneratedImage> {
    assertNoPersonGeneration(req.prompt ?? '');
    const key = readApiKey('stability', this.env) ?? notConfigured('stability', PROVIDER_ENV.stability!);
    const { width, height } = clampToCapabilities(req.width, req.height, this.capabilities, 'stability');
    const tier = this.tier();

    const form = multipart({
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      aspect_ratio: nearestAspect(width, height, STABILITY_ASPECTS),
      seed: Number.isFinite(req.seed) ? (req.seed as number) >>> 0 : undefined,
      output_format: 'png',
      mode: 'text-to-image',
    });

    const res = await this.post(TIERS[tier]!, form, key);
    const { buffer, seed } = unwrap(res, 'generation');
    return toGeneratedImage(buffer, {
      width,
      height,
      provider: 'stability',
      model: `stable-image-${tier}`,
      seed: seed ?? req.seed,
      promptUsed: req.prompt ?? '',
    });
  }

  async identityGuidedEdit(req: IdentityEditRequest): Promise<GeneratedImage> {
    guardIdentityEdit(req);
    const key = readApiKey('stability', this.env) ?? notConfigured('stability', PROVIDER_ENV.stability!);
    const size = await imageSize(req.image);

    // Image-to-image on sd3: `strength` is how far from the source the result
    // may travel, so the guard's 0.65 ceiling maps directly onto it.
    const form = multipart(
      {
        prompt:
          `${req.prompt}. Identity-preserving edit: keep the face and head structurally identical, ` +
          'change only lighting, colour and background.',
        negative_prompt: 'different face, altered facial features, distorted face, replaced person',
        mode: 'image-to-image',
        strength: req.strength,
        seed: Number.isFinite(req.seed) ? (req.seed as number) >>> 0 : undefined,
        output_format: 'png',
      },
      { image: { buffer: req.image, filename: 'source.png', type: 'image/png' } },
    );

    const res = await this.post(TIERS.sd3!, form, key);
    const { buffer, seed } = unwrap(res, 'identity edit');
    return toGeneratedImage(buffer, {
      width: size.width,
      height: size.height,
      provider: 'stability',
      model: 'sd3-image-to-image',
      seed: seed ?? req.seed,
      promptUsed: req.prompt,
    });
  }

  async inpaint(req: InpaintRequest): Promise<GeneratedImage> {
    assertNoPersonGeneration(req.prompt ?? '');
    const key = readApiKey('stability', this.env) ?? notConfigured('stability', PROVIDER_ENV.stability!);
    const size = await imageSize(req.image);

    const form = multipart(
      {
        prompt: req.prompt,
        seed: Number.isFinite(req.seed) ? (req.seed as number) >>> 0 : undefined,
        output_format: 'png',
        // A few pixels of mask growth hides the seam where the fill meets the plate.
        grow_mask: 5,
      },
      {
        image: { buffer: req.image, filename: 'source.png', type: 'image/png' },
        mask: { buffer: req.mask, filename: 'mask.png', type: 'image/png' },
      },
    );

    const res = await this.post(`${BASE}/edit/inpaint`, form, key);
    const { buffer, seed } = unwrap(res, 'inpaint');
    return toGeneratedImage(buffer, {
      width: size.width,
      height: size.height,
      provider: 'stability',
      model: 'stable-image-inpaint',
      seed: seed ?? req.seed,
      promptUsed: req.prompt,
    });
  }

  async upscale(req: UpscaleRequest): Promise<GeneratedImage> {
    const key = readApiKey('stability', this.env) ?? notConfigured('stability', PROVIDER_ENV.stability!);
    const size = await imageSize(req.image);
    const factor = req.factor === 4 ? 4 : 2;

    const form = multipart(
      { output_format: 'png' },
      { image: { buffer: req.image, filename: 'source.png', type: 'image/png' } },
    );

    // `upscale/fast` is the synchronous 4x path; a 2x request is served from it
    // and resized down, which still beats a plain interpolation.
    const res = await this.post(`${BASE}/upscale/fast`, form, key);
    const { buffer } = unwrap(res, 'upscale');
    return toGeneratedImage(buffer, {
      width: size.width * factor,
      height: size.height * factor,
      provider: 'stability',
      model: 'stable-image-upscale-fast',
      promptUsed: '',
    });
  }

  private async post(url: string, form: FormData, key: string): Promise<StabilityResult> {
    const res = await httpRequest(url, {
      provider: 'stability',
      secret: key,
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        // JSON so `finish_reason` is visible; `image/*` would return raw bytes
        // and silently hide a CONTENT_FILTERED result.
        accept: 'application/json',
      },
      body: form,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as StabilityResult;
    } catch (err) {
      throw new HexaError('PROVIDER_ERROR', `[stability] malformed JSON response: ${text.slice(0, 200)}`, {
        details: { provider: 'stability' },
        cause: err,
      });
    }
  }
}

async function imageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buffer).metadata();
  return { width: meta.width ?? 1024, height: meta.height ?? 1024 };
}

export const stabilityProvider = new StabilityProvider();
