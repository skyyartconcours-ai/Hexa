/**
 * @hexa/ai adapter — optional generative backplates.
 *
 * This is the only integration the pipeline treats as genuinely optional: a
 * template asking for an AI backdrop falls back to the procedural one rather
 * than failing the render, because a missing API key should cost you a nicer
 * background, not your thumbnail.
 *
 * The hard rule from docs/IDENTITY.md is enforced on the way in, not on the way
 * out: `assertNoPersonGeneration` runs against every prompt before it reaches a
 * provider, including one the operator typed themselves. If @hexa/ai cannot be
 * loaded there is no generation at all — no code path here sends an unchecked
 * prompt to an image model.
 *
 * The translation is style vocabulary. Templates describe their backdrop in
 * `StyleSpec['backdrop']` terms ('arena', 'shatter', 'grid'); @hexa/ai has its
 * own twelve-strong `BackplateStyle` vocabulary. The mapping lives here.
 */

import type { LightRig, StyleSpec } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule, tryLoadModule } from './load.js';
import {
  AI_EXPORTS,
  type AiModule,
  type BackplateStyle,
  type ProviderStatus,
} from './contracts.js';

const SPEC = '@hexa/ai';
const HINT = 'The AI package is not built. Run: pnpm --filter @hexa/ai build (or use a procedural backdrop)';

async function mod(): Promise<AiModule> {
  return loadModule<AiModule>(SPEC, { needs: AI_EXPORTS, hint: HINT });
}

export async function isAvailable(): Promise<boolean> {
  return (await tryLoadModule<AiModule>(SPEC, { needs: AI_EXPORTS, hint: HINT })) !== null;
}

/** Template backdrop vocabulary → @hexa/ai's backplate styles. */
const BACKDROP_STYLES: Readonly<Record<string, BackplateStyle>> = {
  arena: 'arena',
  abstract: 'abstract',
  shatter: 'shattered-glass',
  grid: 'cyber',
  gradient: 'energy',
  radial: 'energy',
  solid: 'studio',
  ai: 'arena',
};

/** Light rig → the emotional register the prompt asks for. */
const RIG_MOODS: Readonly<Record<LightRig, string>> = {
  'split-rim': 'tense, confrontational',
  'top-key': 'ominous, high-stakes',
  'under-glow': 'menacing',
  backlit: 'epic, silhouetting',
  stage: 'triumphant, arena spotlights',
  'neon-wash': 'electric, cyberpunk',
  'god-rays': 'monumental, volumetric',
  ember: 'smouldering, aftermath',
  clean: 'neutral, product-clean',
};

export function backplateStyleFor(backdrop: StyleSpec['backdrop']): BackplateStyle {
  return BACKDROP_STYLES[backdrop ?? 'arena'] ?? 'arena';
}

export interface BackplateRequest {
  style: StyleSpec;
  palette: { left: string; right: string; accent: string; dark: string; light: string };
  width: number;
  height: number;
  seed: number;
  subjectCount: number;
  provider?: string;
  /** Operator-supplied prompt, used verbatim instead of the derived one. */
  prompt?: string;
  extra?: string;
}

export interface BackplateOutcome {
  buffer: Buffer;
  provider: string;
  model: string;
  promptUsed: string;
}

/**
 * Generate a background plate.
 *
 * @throws HexaError `PROVIDER_ERROR` for provider trouble, or `INVALID_REQUEST`
 * when the prompt asks for a person. The backplate *stage* catches the former
 * and falls back to procedural; the latter is deliberately allowed through, so
 * an operator learns why their prompt was refused instead of silently getting a
 * gradient.
 */
export async function generateBackplate(req: BackplateRequest): Promise<BackplateOutcome> {
  const m = await mod();
  const style = backplateStyleFor(req.style.backdrop);
  const palette = [req.palette.left, req.palette.right, req.palette.accent];

  const { prompt, negativePrompt } = req.prompt
    ? { prompt: req.prompt, negativePrompt: undefined as string | undefined }
    : m.buildBackplatePrompt({
        style,
        mood: RIG_MOODS[req.style.lightRig] ?? 'tense',
        palette,
        subjectCount: req.subjectCount,
        extra: req.extra,
      });

  // The guarantee: every prompt is checked before it reaches a provider.
  m.assertNoPersonGeneration(prompt);

  try {
    const image = await m.generateBackplate({
      prompt,
      negativePrompt,
      width: req.width,
      height: req.height,
      seed: req.seed,
      style,
      palette,
      provider: req.provider,
    });

    if (!image?.buffer?.length) {
      throw new HexaError('PROVIDER_ERROR', 'The AI provider returned no image data', {
        hint: 'Check `hexa providers`; the provider may have refused the prompt or hit a quota.',
      });
    }

    return {
      buffer: image.buffer,
      provider: image.provider,
      model: image.model,
      promptUsed: image.revisedPrompt ?? image.promptUsed ?? prompt,
    };
  } catch (cause) {
    if (cause instanceof HexaError) throw cause;
    throw new HexaError('PROVIDER_ERROR', `Backplate generation failed: ${message(cause)}`, {
      hint: 'Run `hexa providers` to check configuration, or set --bg auto for a procedural backdrop.',
      details: { provider: req.provider, style },
      cause,
    });
  }
}

/** Prompt safety check on its own, so the CLI can validate `--bg-prompt` early. */
export async function assertNoPersonGeneration(prompt: string): Promise<void> {
  (await mod()).assertNoPersonGeneration(prompt);
}

/** Build the prompt without generating — for `--dry-run` and the studio UI. */
export async function buildPrompt(req: Omit<BackplateRequest, 'width' | 'height' | 'seed' | 'provider'>): Promise<{ prompt: string; negativePrompt: string }> {
  const m = await mod();
  return m.buildBackplatePrompt({
    style: backplateStyleFor(req.style.backdrop),
    mood: RIG_MOODS[req.style.lightRig] ?? 'tense',
    palette: [req.palette.left, req.palette.right, req.palette.accent],
    subjectCount: req.subjectCount,
    extra: req.extra,
  });
}

/** Provider configuration status. Never throws — `hexa providers` needs a table. */
export async function providerStatuses(): Promise<ProviderStatus[]> {
  const m = await tryLoadModule<AiModule>(SPEC, { needs: AI_EXPORTS, hint: HINT });
  if (!m) return [];
  try {
    return m.providerStatus() ?? [];
  } catch {
    return [];
  }
}

/** The backplate styles the AI package understands, for CLI help output. */
export async function backplateStyles(): Promise<string[]> {
  const m = await tryLoadModule<AiModule>(SPEC, { needs: AI_EXPORTS, hint: HINT });
  return m?.BACKPLATE_STYLES ? [...m.BACKPLATE_STYLES] : [];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type { ProviderStatus };
