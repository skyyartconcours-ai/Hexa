/**
 * OpenAI image generation.
 *
 * VERIFIED 2026-08-13 against OpenAI's published OpenAPI specification
 * (`openai/openai-openapi`, `openapi.yaml`), which is the source their own docs
 * and SDKs are generated from:
 *
 *   POST https://api.openai.com/v1/images/generations   (`createImage`)
 *   POST https://api.openai.com/v1/images/edits         (`createImageEdit`)
 *   auth: `Authorization: Bearer <key>`
 *
 * Generation body: `model`, `prompt`, `n`, `size`, `quality`
 * (`low|medium|high|auto` for GPT image models), `output_format`
 * (`png|jpeg|webp`), `output_compression`, `moderation` (`low|auto`).
 * Response: `{ created, data: [{ b64_json }], usage }` — the spec states GPT
 * image models *always* return base64 and do not accept `response_format`.
 *
 * Size: the spec's `size` documentation states that for `gpt-image-2` and
 * `gpt-image-2-2026-04-21`, arbitrary `WIDTHxHEIGHT` resolutions are supported
 * provided both dimensions are divisible by 16, the aspect ratio is between 1:3
 * and 3:1, and the resolution does not exceed 3840x2160. That is implemented in
 * `snapSize` below; anything outside those bounds falls back to a standard rung
 * and is cropped to frame afterwards.
 *
 * Edits: the spec's `input_fidelity` parameter — "Control how much effort the
 * model will exert to match the style and features, **especially facial
 * features**, of input images" — is precisely the identity-preserving knob this
 * package needs, so identity-guided edits always send `input_fidelity: high`.
 * Its documentation names `gpt-image-1` and `gpt-image-1.5` "and later models"
 * as supported (and `gpt-image-1-mini` as unsupported), and the `/images/edits`
 * summary enumerates `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`,
 * `chatgpt-image-latest` and `dall-e-2`. `gpt-image-2` is documented for
 * generation but is not named in that edits list, so the edit path defaults to
 * the explicitly-listed `gpt-image-1.5` and both models stay env-overridable.
 */

import { HexaError } from '@hexa/core';
import type {
  BackplateRequest,
  GeneratedImage,
  IdentityEditRequest,
  ImageProvider,
  InpaintRequest,
  ProviderCapabilities,
} from '../types.js';
import { assertNoPersonGeneration, guardIdentityEdit } from '../guard.js';
import { PROVIDER_ENV, readApiKey } from '../config.js';
import { httpRequest, postJson } from '../http.js';
import { clampToCapabilities, decodeBase64Image, multipart, notConfigured, toGeneratedImage } from './shared.js';

const GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';
const EDITS_URL = 'https://api.openai.com/v1/images/edits';

const DEFAULT_GENERATE_MODEL = 'gpt-image-2';
const DEFAULT_EDIT_MODEL = 'gpt-image-1.5';

/** Standard rungs every GPT image model accepts, per the spec's `size` enum. */
const STANDARD_SIZES: ReadonlyArray<[number, number]> = [
  [1024, 1024],
  [1536, 1024],
  [1024, 1536],
];

const MAX_PIXELS = { width: 3840, height: 2160 };

/**
 * Snap a requested frame to something the API will accept: both edges divisible
 * by 16, aspect ratio inside 1:3–3:1, and within the documented maximum. If the
 * request cannot be satisfied, fall back to the closest standard rung and let
 * `fitExact` crop.
 */
export function snapSize(width: number, height: number): string {
  const ar = width / Math.max(1, height);
  const withinAspect = ar >= 1 / 3 && ar <= 3;
  const scale = Math.min(1, MAX_PIXELS.width / width, MAX_PIXELS.height / height);
  const w = Math.round((width * scale) / 16) * 16;
  const h = Math.round((height * scale) / 16) * 16;

  if (withinAspect && w >= 256 && h >= 256 && w <= MAX_PIXELS.width && h <= MAX_PIXELS.height) {
    return `${w}x${h}`;
  }

  let best = STANDARD_SIZES[0]!;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const [sw, sh] of STANDARD_SIZES) {
    const err = Math.abs(Math.log(sw / sh / Math.max(0.0001, ar)));
    if (err < bestErr) {
      bestErr = err;
      best = [sw, sh];
    }
  }
  return `${best[0]}x${best[1]}`;
}

interface ImagesResponse {
  created?: number;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number };
}

function firstImage(res: ImagesResponse, provider = 'openai'): { buffer: Buffer; revised?: string } {
  const entry = res.data?.[0];
  if (!entry?.b64_json) {
    throw new HexaError('PROVIDER_ERROR', `[${provider}] returned no image data.`, {
      hint: 'Retry, or render with --provider local.',
      details: { provider },
    });
  }
  return { buffer: decodeBase64Image(entry.b64_json), revised: entry.revised_prompt };
}

export class OpenAiProvider implements ImageProvider {
  readonly id = 'openai';

  readonly capabilities: ProviderCapabilities = {
    backplate: true,
    // /images/edits with input_fidelity: 'high' is documented as matching the
    // facial features of the input image — the identity-preserving path.
    identityGuidedEdit: true,
    inpaint: true,
    upscale: false,
    maxSize: MAX_PIXELS,
  };

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private generateModel(): string {
    return this.env.HEXA_OPENAI_IMAGE_MODEL?.trim() || DEFAULT_GENERATE_MODEL;
  }

  private editModel(): string {
    return this.env.HEXA_OPENAI_EDIT_MODEL?.trim() || DEFAULT_EDIT_MODEL;
  }

  isConfigured(): boolean {
    return readApiKey('openai', this.env) !== undefined;
  }

  async generateBackplate(req: BackplateRequest): Promise<GeneratedImage> {
    assertNoPersonGeneration(req.prompt ?? '');
    const key = readApiKey('openai', this.env) ?? notConfigured('openai', PROVIDER_ENV.openai!);
    const { width, height } = clampToCapabilities(req.width, req.height, this.capabilities, 'openai');
    const model = this.generateModel();

    // There is no negative-prompt parameter; exclusions become an instruction.
    const prompt = req.negativePrompt
      ? `${req.prompt}\n\nAvoid entirely: ${req.negativePrompt}.`
      : (req.prompt ?? '');

    const res = await postJson<ImagesResponse>(
      GENERATIONS_URL,
      {
        model,
        prompt,
        n: 1,
        size: snapSize(width, height),
        quality: 'high',
        output_format: 'png',
      },
      { provider: 'openai', secret: key, headers: { authorization: `Bearer ${key}` } },
    );

    const { buffer, revised } = firstImage(res);
    return toGeneratedImage(buffer, {
      width,
      height,
      provider: 'openai',
      model,
      seed: req.seed,
      promptUsed: prompt,
      revisedPrompt: revised,
    });
  }

  async identityGuidedEdit(req: IdentityEditRequest): Promise<GeneratedImage> {
    guardIdentityEdit(req);
    const key = readApiKey('openai', this.env) ?? notConfigured('openai', PROVIDER_ENV.openai!);
    const size = await imageSize(req.image);

    const instruction =
      `${req.prompt}\n\n` +
      'This is an identity-preserving edit of a real photograph. Keep the face, head and hair ' +
      'structurally identical — do not restyle, redraw or beautify them. Change only lighting, ' +
      'colour grade, background and atmosphere.';

    const form = multipart(
      {
        model: this.editModel(),
        prompt: instruction,
        n: 1,
        size: snapSize(size.width, size.height),
        // The documented control for matching input facial features.
        input_fidelity: 'high',
        quality: 'high',
        output_format: 'png',
      },
      {
        image: { buffer: req.image, filename: 'source.png', type: 'image/png' },
        mask: req.mask ? { buffer: req.mask, filename: 'mask.png', type: 'image/png' } : undefined,
      },
    );

    const res = await this.postForm(EDITS_URL, form, key);
    const { buffer, revised } = firstImage(res);
    return toGeneratedImage(buffer, {
      width: size.width,
      height: size.height,
      provider: 'openai',
      model: this.editModel(),
      seed: req.seed,
      promptUsed: instruction,
      revisedPrompt: revised,
    });
  }

  async inpaint(req: InpaintRequest): Promise<GeneratedImage> {
    assertNoPersonGeneration(req.prompt ?? '');
    if (!Buffer.isBuffer(req.mask) || req.mask.length === 0) {
      throw new HexaError('INVALID_REQUEST', 'Inpainting requires a mask buffer.');
    }
    const key = readApiKey('openai', this.env) ?? notConfigured('openai', PROVIDER_ENV.openai!);
    const size = await imageSize(req.image);

    const form = multipart(
      {
        model: this.editModel(),
        prompt: req.prompt,
        n: 1,
        size: snapSize(size.width, size.height),
        quality: 'high',
        output_format: 'png',
      },
      {
        image: { buffer: req.image, filename: 'source.png', type: 'image/png' },
        mask: { buffer: req.mask, filename: 'mask.png', type: 'image/png' },
      },
    );

    const res = await this.postForm(EDITS_URL, form, key);
    const { buffer, revised } = firstImage(res);
    return toGeneratedImage(buffer, {
      width: size.width,
      height: size.height,
      provider: 'openai',
      model: this.editModel(),
      seed: req.seed,
      promptUsed: req.prompt,
      revisedPrompt: revised,
    });
  }

  /** multipart/form-data — the browser FormData/Blob globals, no dependency. */
  private async postForm(url: string, form: FormData, key: string): Promise<ImagesResponse> {
    const res = await httpRequest(url, {
      provider: 'openai',
      secret: key,
      method: 'POST',
      // Deliberately no content-type: fetch sets the multipart boundary itself.
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as ImagesResponse;
    } catch (err) {
      throw new HexaError('PROVIDER_ERROR', `[openai] malformed JSON response: ${text.slice(0, 200)}`, {
        details: { provider: 'openai' },
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

export const openaiProvider = new OpenAiProvider();
