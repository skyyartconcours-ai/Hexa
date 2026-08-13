/**
 * Stage 5 — backplate.
 *
 * The background is the one part of a Hexa render a generative model is allowed
 * to paint, because it contains no identity. Arenas, light, smoke and abstract
 * energy are fair game; a person is not, and `@hexa/ai` refuses prompts that ask
 * for one before any provider sees them.
 *
 * An AI backplate is a *nice-to-have*. A missing API key, a rate limit or a
 * refused prompt drops to the procedural backdrop with a warning — losing a
 * background is not a reason to lose a thumbnail.
 */

import { HexaError, isHexaError } from '@hexa/core';
import type { BackgroundRequest, Logger, StyleSpec, ThumbnailTemplate } from '@hexa/core';
import * as ai from '../adapters/ai.js';
import { readFileSafe } from '../image.js';
import type { ResolvedPalette } from '../types.js';

export type BackplateSource = 'ai' | 'file' | 'procedural' | 'none';

export interface BackplateResult {
  /** Bytes for the plate, or undefined when the compiler should draw it. */
  buffer?: Buffer;
  source: BackplateSource;
  prompt?: string;
  warnings: string[];
}

export interface BackplateOptions {
  template: ThumbnailTemplate;
  style: StyleSpec;
  palette: ResolvedPalette;
  canvas: { width: number; height: number };
  seed: number;
  background?: BackgroundRequest;
  provider?: string;
  logger: Logger;
  signal?: AbortSignal;
}

export async function prepareBackplate(opts: BackplateOptions): Promise<BackplateResult> {
  const warnings: string[] = [];
  const mode = opts.background?.mode ?? 'auto';

  if (mode === 'none') return { source: 'none', warnings };

  if (mode === 'file') {
    const path = opts.background?.path;
    if (!path) {
      throw new HexaError('INVALID_REQUEST', 'background.mode is "file" but no path was given', {
        hint: 'Pass --bg-file <path>, or use --bg auto for a procedural backdrop.',
      });
    }
    const bytes = await readFileSafe(path);
    if (!bytes) {
      throw new HexaError('IO_ERROR', `Cannot read background image: ${path}`, {
        hint: 'Check the path and that the file is a readable image.',
        details: { path },
      });
    }
    return { buffer: bytes, source: 'file', warnings };
  }

  // Colour and gradient modes are drawn by the compiler from the palette — the
  // compositor makes a better gradient than a pre-rasterised plate would.
  if (mode === 'color' || mode === 'gradient') return { source: 'procedural', warnings };

  const wantsAi = mode === 'ai' || (mode === 'auto' && opts.style.backdrop === 'ai');
  if (!wantsAi) return { source: 'procedural', warnings };

  if (!(await ai.isAvailable())) {
    warnings.push('@hexa/ai is not available — using a procedural backdrop instead of a generated plate.');
    return { source: 'procedural', warnings };
  }

  try {
    const buffer = await ai.generateBackplate({
      template: opts.template,
      style: opts.style,
      palette: opts.palette,
      width: opts.canvas.width,
      height: opts.canvas.height,
      seed: opts.seed,
      provider: opts.provider,
      prompt: opts.background?.prompt,
      context: { league: String(opts.template.tags?.find((t) => /^(lck|lec|lcs|lpl|worlds|msi)$/i.test(t)) ?? ''), mood: opts.style.lightRig },
      signal: opts.signal,
    });
    opts.logger.debug('generated backplate', { bytes: buffer.length, provider: opts.provider });
    return { buffer, source: 'ai', prompt: opts.background?.prompt, warnings };
  } catch (e) {
    // A prompt that asks for a person is a *deliberate* refusal, not a
    // provider hiccup: surface it rather than silently swapping in a gradient,
    // or the operator never learns why their prompt was rejected.
    if (isHexaError(e) && e.code === 'INVALID_REQUEST') throw e;

    const reason = e instanceof Error ? e.message : String(e);
    warnings.push(`AI backplate unavailable (${reason}) — fell back to a procedural backdrop. Run \`hexa providers\` to check configuration.`);
    opts.logger.warn('backplate generation failed, falling back to procedural', { reason });
    return { source: 'procedural', warnings };
  }
}
