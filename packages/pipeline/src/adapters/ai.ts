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
 * provider. If @hexa/ai cannot be loaded we do not generate at all — there is no
 * code path here that sends an unchecked prompt to an image model.
 */

import type { StyleSpec, ThumbnailTemplate } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule, tryLoadModule } from './load.js';
import { toArray, toBuffer } from './normalise.js';
import { AI_EXPORTS, type AiModule, type BackplatePromptInput, type ProviderStatus } from './contracts.js';

const SPEC = '@hexa/ai';
const HINT = 'The AI package is not built. Run: pnpm --filter @hexa/ai build (or use a procedural backdrop)';

async function mod(): Promise<AiModule> {
  return loadModule<AiModule>(SPEC, { needs: AI_EXPORTS, hint: HINT });
}

export async function isAvailable(): Promise<boolean> {
  return (await tryLoadModule<AiModule>(SPEC, { needs: AI_EXPORTS, hint: HINT })) !== null;
}

/**
 * Compose the backplate prompt from the template's style and the resolved
 * palette. Never includes player names: naming a person in a prompt is how you
 * end up with a generated face, which is the thing this project exists to avoid.
 */
export async function buildBackplatePrompt(input: BackplatePromptInput): Promise<{ prompt: string; negativePrompt?: string }> {
  const m = await mod();
  const built = m.buildBackplatePrompt(input);
  if (typeof built === 'string') return { prompt: built };
  if (built && typeof built === 'object' && typeof built.prompt === 'string') return built;
  throw new HexaError('PROVIDER_ERROR', 'buildBackplatePrompt returned an unusable prompt', {
    hint: 'The return shape of @hexa/ai buildBackplatePrompt has drifted — fix packages/pipeline/src/adapters/ai.ts.',
  });
}

export interface BackplateRequest {
  template: ThumbnailTemplate;
  style: StyleSpec;
  palette: { left: string; right: string; accent: string; dark: string; light: string };
  width: number;
  height: number;
  seed: number;
  provider?: string;
  /** Operator-supplied prompt, used instead of the derived one. */
  prompt?: string;
  context?: { league?: string; venue?: string; mood?: string; tags?: string[] };
  signal?: AbortSignal;
}

/**
 * Generate a background plate.
 *
 * @throws HexaError `PROVIDER_ERROR` / `PROVIDER_NOT_CONFIGURED`. The backplate
 * *stage* catches these and falls back to procedural; they are thrown rather
 * than swallowed here so the reason reaches the job's warnings.
 */
export async function generateBackplate(req: BackplateRequest): Promise<Buffer> {
  const m = await mod();

  const { prompt, negativePrompt } = req.prompt
    ? { prompt: req.prompt, negativePrompt: undefined as string | undefined }
    : await buildBackplatePrompt({
        template: req.template,
        palette: req.palette,
        style: req.style,
        seed: req.seed,
        context: req.context,
      });

  // The guarantee: every prompt is checked before it reaches a provider,
  // including one the operator typed themselves.
  m.assertNoPersonGeneration(prompt);

  let raw: unknown;
  try {
    raw = await m.generateBackplate({
      prompt,
      negativePrompt,
      width: req.width,
      height: req.height,
      seed: req.seed,
      provider: req.provider,
      signal: req.signal,
    });
  } catch (cause) {
    if (cause instanceof HexaError) throw cause;
    throw new HexaError('PROVIDER_ERROR', `Backplate generation failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      hint: 'Run `hexa providers` to check configuration, or set background.mode to "auto" for a procedural backdrop.',
      details: { provider: req.provider },
      cause,
    });
  }

  const buf = toBuffer(raw);
  if (!buf) {
    throw new HexaError('PROVIDER_ERROR', 'The AI provider returned no image data', {
      hint: 'Check `hexa providers`; the provider may have refused the prompt or hit a quota.',
    });
  }
  return buf;
}

/** Prompt safety check on its own, for `hexa make --bg-prompt` validation. */
export async function assertNoPersonGeneration(prompt: string): Promise<void> {
  const m = await mod();
  m.assertNoPersonGeneration(prompt);
}

/** Provider configuration status. Never throws — `hexa providers` needs a table. */
export async function providerStatuses(): Promise<ProviderStatus[]> {
  const m = await tryLoadModule<AiModule>(SPEC, { needs: AI_EXPORTS, hint: HINT });
  if (!m) return [];
  try {
    const raw = m.providerStatus();
    const list = toArray<unknown>(Array.isArray(raw) ? raw : [raw]);
    if (list.length > 0) return list.map(asStatus).filter((s): s is ProviderStatus => s !== undefined);
  } catch {
    // fall through to listProviders
  }
  try {
    return toArray<unknown>(m.listProviders()).map(asStatus).filter((s): s is ProviderStatus => s !== undefined);
  } catch {
    return [];
  }
}

function asStatus(v: unknown): ProviderStatus | undefined {
  if (typeof v === 'string') return { id: v, configured: false, reason: 'status not reported' };
  if (v && typeof v === 'object') {
    const bag = v as Record<string, unknown>;
    const id = typeof bag['id'] === 'string' ? bag['id'] : typeof bag['name'] === 'string' ? bag['name'] : undefined;
    if (!id) return undefined;
    return { ...bag, id, configured: bag['configured'] === true };
  }
  return undefined;
}
