/**
 * Google Gemini image generation.
 *
 * VERIFIED 2026-08-13 against the live Gemini API discovery document
 * (`GET https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`),
 * which is the machine-readable source the API itself publishes:
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   auth   : `x-goog-api-key: <key>` header (the discovery doc also documents a
 *            `?key=` query parameter — the header form is used here so the key
 *            never lands in a URL, a log line or a proxy access log)
 *   request: { contents: [{ role, parts: [{ text } | { inlineData: { mimeType, data } }] }],
 *              generationConfig: { responseModalities: ['TEXT','IMAGE'],
 *                                  imageConfig: { aspectRatio, imageSize }, seed } }
 *   response: { candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] },
 *                              finishReason }] }
 *
 * `GenerationConfig.imageConfig.aspectRatio` and `.imageSize` are documented in
 * the discovery doc with the exact value sets used below, and `finishReason`
 * carries the image-specific failure states (`IMAGE_SAFETY`, `NO_IMAGE`,
 * `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION`) that are handled here.
 *
 * Model ids come from Google's model documentation rather than the discovery
 * doc, so they are overridable: `gemini-3.1-flash-image` ("Nano Banana 2") is
 * the default, `gemini-2.5-flash-image` the documented predecessor.
 */

import { HexaError } from '@hexa/core';
import type {
  BackplateRequest,
  GeneratedImage,
  IdentityEditRequest,
  ImageProvider,
  ProviderCapabilities,
} from '../types.js';
import { assertIdentityEditSafe, assertNegativePromptSafe, assertNoPersonGeneration } from '../guard.js';
import { PROVIDER_ENV, readApiKey } from '../config.js';
import { postJson } from '../http.js';
import {
  clampToCapabilities,
  decodeBase64Image,
  nearestAspect,
  notConfigured,
  toGeneratedImage,
} from './shared.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';

/** Aspect ratios the discovery document lists for `imageConfig.aspectRatio`. */
const GEMINI_ASPECTS: ReadonlyArray<[string, number]> = [
  ['8:1', 8],
  ['4:1', 4],
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
  ['1:4', 0.25],
  ['1:8', 0.125],
];

/** `imageSize` rungs from the discovery document: 512, 1K, 2K, 4K. */
function imageSizeFor(width: number, height: number): string {
  const longEdge = Math.max(width, height);
  if (longEdge <= 640) return '512';
  if (longEdge <= 1280) return '1K';
  if (longEdge <= 2560) return '2K';
  return '4K';
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
    finishMessage?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

function extractImage(res: GeminiResponse, model: string): { buffer: Buffer; text?: string } {
  const candidate = res.candidates?.[0];
  const finish = candidate?.finishReason;

  if (res.promptFeedback?.blockReason) {
    throw new HexaError('PROVIDER_ERROR', `[google] prompt blocked: ${res.promptFeedback.blockReason}`, {
      hint: 'Rephrase the backplate prompt, or render with --provider local.',
      details: { provider: 'google', model, blockReason: res.promptFeedback.blockReason },
    });
  }

  const parts = candidate?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image?.inlineData?.data) {
    throw new HexaError(
      'PROVIDER_ERROR',
      `[google] returned no image (finishReason: ${finish ?? 'unknown'}${candidate?.finishMessage ? ` — ${candidate.finishMessage}` : ''}).`,
      {
        hint:
          finish === 'IMAGE_SAFETY' || finish === 'IMAGE_PROHIBITED_CONTENT'
            ? 'The safety filter rejected the scene. Adjust the prompt or use --provider local.'
            : 'Retry, or render with --provider local.',
        details: { provider: 'google', model, finishReason: finish },
      },
    );
  }
  return { buffer: decodeBase64Image(image.inlineData.data), text: parts.find((p) => p.text)?.text };
}

export class GoogleProvider implements ImageProvider {
  readonly id = 'google';

  readonly capabilities: ProviderCapabilities = {
    backplate: true,
    // Gemini's editing path takes the source image as an inlineData part plus a
    // text instruction, which is exactly the identity-preserving edit shape.
    identityGuidedEdit: true,
    // Masked inpainting is not a first-class parameter on generateContent —
    // editing is instruction-driven — so this stays false rather than pretending.
    inpaint: false,
    upscale: false,
    maxSize: { width: 4096, height: 4096 },
  };

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private model(): string {
    return this.env.HEXA_GOOGLE_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    return readApiKey('google', this.env) !== undefined;
  }

  async generateBackplate(req: BackplateRequest): Promise<GeneratedImage> {
    assertNoPersonGeneration(req.prompt ?? '');
    assertNegativePromptSafe(req.negativePrompt);
    const key = readApiKey('google', this.env) ?? notConfigured('google', PROVIDER_ENV.google!);
    const { width, height } = clampToCapabilities(req.width, req.height, this.capabilities, 'google');
    const model = this.model();

    // Gemini takes no negative-prompt field, so the exclusions are folded into
    // the instruction — phrased as a constraint the model reads, not a list.
    const promptText = req.negativePrompt
      ? `${req.prompt}\n\nDo not include any of the following: ${req.negativePrompt}.`
      : req.prompt;

    const body = {
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: nearestAspect(width, height, GEMINI_ASPECTS),
          imageSize: imageSizeFor(width, height),
        },
        ...(Number.isFinite(req.seed) ? { seed: (req.seed as number) >>> 0 } : {}),
      },
    };

    const res = await postJson<GeminiResponse>(`${BASE}/${encodeURIComponent(model)}:generateContent`, body, {
      provider: 'google',
      secret: key,
      headers: { 'x-goog-api-key': key },
    });

    const { buffer, text } = extractImage(res, model);
    return toGeneratedImage(buffer, {
      width,
      height,
      provider: 'google',
      model: res.modelVersion ?? model,
      seed: req.seed,
      promptUsed: promptText,
      revisedPrompt: text,
    });
  }

  async identityGuidedEdit(req: IdentityEditRequest): Promise<GeneratedImage> {
    await assertIdentityEditSafe(req);
    const key = readApiKey('google', this.env) ?? notConfigured('google', PROVIDER_ENV.google!);
    const model = this.model();

    // The preserve boxes are stated to the model in normalised terms as well as
    // being enforced downstream: belt (instruction) and braces (identity gate).
    const preserveNote = describePreserve(req.preserve ?? []);
    const instruction =
      `${req.prompt}\n\n` +
      'Critical constraints: this is an identity-preserving edit of a real photograph. ' +
      `Do not alter, redraw, restyle or replace the person's face or head — ${preserveNote} ` +
      'Change only lighting, colour, background and atmosphere. The face must come through the edit ' +
      'pixel-identical in structure.';

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: req.image.toString('base64') } },
            ...(req.mask ? [{ inlineData: { mimeType: 'image/png', data: req.mask.toString('base64') } }] : []),
            { text: instruction },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(Number.isFinite(req.seed) ? { seed: (req.seed as number) >>> 0 } : {}),
      },
    };

    const res = await postJson<GeminiResponse>(`${BASE}/${encodeURIComponent(model)}:generateContent`, body, {
      provider: 'google',
      secret: key,
      headers: { 'x-goog-api-key': key },
    });

    const { buffer, text } = extractImage(res, model);
    const meta = await imageSize(req.image);
    return toGeneratedImage(buffer, {
      width: meta.width,
      height: meta.height,
      provider: 'google',
      model: res.modelVersion ?? model,
      seed: req.seed,
      promptUsed: instruction,
      revisedPrompt: text,
    });
  }
}

function describePreserve(regions: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): string {
  if (regions.length === 0) return 'the face region must be preserved exactly.';
  const parts = regions.map(
    (r) => `the region at (${Math.round(r.x)}, ${Math.round(r.y)}) sized ${Math.round(r.w)}x${Math.round(r.h)} pixels`,
  );
  return `${parts.join(' and ')} must be preserved exactly.`;
}

async function imageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(buffer).metadata();
  return { width: meta.width ?? 1024, height: meta.height ?? 1024 };
}

export const googleProvider = new GoogleProvider();
