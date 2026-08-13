/**
 * Helpers every hosted provider needs.
 *
 * Image APIs do not return the size you asked for. Gemini emits fixed aspect
 * ratios at fixed rungs (1K/2K/4K), Stability takes an aspect ratio and picks
 * the pixels, OpenAI wants dimensions divisible by 16, and Replicate returns
 * whatever the checkpoint was trained on. The compositor, meanwhile, needs
 * exactly the canvas it asked for. So every provider's result goes through
 * `fitExact`, which covers-and-crops to the requested frame — cropping a
 * backplate is safe in a way cropping a subject never is, because the guard
 * has already guaranteed there is nobody in it.
 */

import sharp from 'sharp';
import { HexaError } from '@hexa/core';
import type { GeneratedImage, ProviderCapabilities } from '../types.js';

/** Aspect ratios most hosted providers accept, as `w:h` with their decimal value. */
export const COMMON_ASPECTS: ReadonlyArray<[string, number]> = [
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['3:2', 3 / 2],
  ['5:4', 5 / 4],
  ['4:3', 4 / 3],
  ['1:1', 1],
  ['3:4', 3 / 4],
  ['4:5', 4 / 5],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
  ['9:21', 9 / 21],
];

/** Closest supported aspect-ratio label for a pixel size. */
export function nearestAspect(
  width: number,
  height: number,
  allowed: ReadonlyArray<[string, number]> = COMMON_ASPECTS,
): string {
  const target = width / Math.max(1, height);
  let best = allowed[0]!;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const entry of allowed) {
    const err = Math.abs(Math.log(entry[1] / target));
    if (err < bestErr) {
      bestErr = err;
      best = entry;
    }
  }
  return best[0];
}

/** Resize/crop an arbitrary provider result to the exact requested frame. */
export async function fitExact(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buffer)
    .resize(width, height, { fit: 'cover', position: 'centre', withoutEnlargement: false })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Validate and clamp a requested size against a provider's ceiling. */
export function clampToCapabilities(
  width: number,
  height: number,
  caps: ProviderCapabilities,
  provider: string,
): { width: number; height: number } {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) {
    throw new HexaError('INVALID_REQUEST', `Backplate size ${width}x${height} is not renderable.`, {
      hint: 'Width and height must both be at least 16 pixels.',
      details: { provider },
    });
  }
  return { width: Math.min(w, caps.maxSize.width), height: Math.min(h, caps.maxSize.height) };
}

/** Assemble the return value once the bytes are in hand. */
export async function toGeneratedImage(
  raw: Buffer,
  opts: {
    width: number;
    height: number;
    provider: string;
    model: string;
    seed?: number;
    cost?: number;
    promptUsed: string;
    revisedPrompt?: string;
  },
): Promise<GeneratedImage> {
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    throw new HexaError('PROVIDER_ERROR', `[${opts.provider}] returned an empty image.`, {
      details: { provider: opts.provider, model: opts.model },
    });
  }
  const buffer = await fitExact(raw, opts.width, opts.height);
  return {
    buffer,
    width: opts.width,
    height: opts.height,
    provider: opts.provider,
    model: opts.model,
    seed: opts.seed,
    cost: opts.cost,
    promptUsed: opts.promptUsed,
    revisedPrompt: opts.revisedPrompt,
  };
}

/** Throw the standard "no key" error. */
export function notConfigured(provider: string, envVars: readonly string[]): never {
  throw new HexaError('PROVIDER_NOT_CONFIGURED', `The "${provider}" provider has no API key configured.`, {
    hint: `Set ${envVars.join(' or ')}, or omit --provider to use the offline provider.`,
    details: { provider, envVars: [...envVars] },
  });
}

/** Decode base64 image payloads, tolerating data-URI wrappers. */
export function decodeBase64Image(data: string): Buffer {
  const cleaned = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  return Buffer.from(cleaned, 'base64');
}

/** Build a multipart body from plain fields plus optional file parts. */
export function multipart(
  fields: Record<string, string | number | undefined>,
  files: Record<string, { buffer: Buffer; filename: string; type: string } | undefined> = {},
): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    form.append(k, String(v));
  }
  for (const [k, f] of Object.entries(files)) {
    if (!f) continue;
    form.append(k, new Blob([new Uint8Array(f.buffer)], { type: f.type }), f.filename);
  }
  return form;
}
