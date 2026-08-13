/**
 * Anthropic — prompt architect, not an image generator.
 *
 * VERIFIED CAPABILITY NOTE (checked against the bundled `claude-api` skill,
 * 2026-08-13): Claude has **no image-generation capability**. The Messages API
 * accepts images as *input* (vision) and returns text, tool calls and thinking;
 * there is no image output modality, no `/v1/images` endpoint, and no
 * image-producing server tool. Anything that claims otherwise is inventing it.
 *
 * So this provider does not pretend. `capabilities` reports every image
 * capability as false and `generateBackplate` refuses with an explanation
 * rather than quietly returning a placeholder. What Claude is genuinely good at
 * here is the job immediately upstream of generation: turning a rough human
 * brief ("hype thumbnail for the HLE vs T1 final, make it feel tense") into the
 * structured, photographic, negative-space-aware prompt that Gemini, GPT Image,
 * Stability or a Flux checkpoint on Replicate actually needs. That is
 * `AnthropicPromptArchitect.craft()`.
 *
 * Two safety properties matter here:
 *
 *   1. The brief is guarded *before* it is sent, so a person-requesting brief
 *      never reaches the API at all.
 *   2. The crafted prompt is guarded again *after* it comes back. A language
 *      model's output is not trusted input — if it writes "a determined player
 *      in the foreground", the guard rejects it and the deterministic local
 *      builder is used instead.
 *
 * API details verified against the `claude-api` skill:
 *   POST https://api.anthropic.com/v1/messages
 *   headers: x-api-key, anthropic-version: 2023-06-01, content-type
 *   model: claude-opus-5 · thinking: {type:'adaptive'} (on by default on Opus 5)
 *   structured output: output_config.format = {type:'json_schema', schema}
 *   refusals arrive as HTTP 200 with stop_reason: 'refusal'
 */

import { HexaError } from '@hexa/core';
import type {
  BackplateRequest,
  BackplateStyle,
  GeneratedImage,
  ImageProvider,
  ProviderCapabilities,
} from '../types.js';
import { BACKPLATE_STYLES, isBackplateStyle } from '../types.js';
import { assertNoPersonGeneration, checkPersonGeneration } from '../guard.js';
import { buildBackplatePrompt, COMPOSITION_RULES, NEGATIVE_BASE, type LightDirection } from '../prompt.js';
import { readApiKey, redactSecrets } from '../config.js';
import { postJson } from '../http.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-5';

/** A rough human brief — the thing an editor actually types. */
export interface PromptBrief {
  /** Free text: "tense grand final, dark arena, red and blue". */
  brief: string;
  /** Force a style; otherwise Claude picks one from the enum. */
  style?: BackplateStyle;
  /** Team/brand hex colours the plate must be built from. */
  palette?: string[];
  /** How many cut-out subjects the plate must accommodate. */
  subjectCount?: number;
  lightDirection?: LightDirection;
  /** Aspect hint, e.g. "16:9" — affects how the negative space is described. */
  aspect?: string;
  /** Extra requirements appended verbatim. */
  extra?: string;
}

export interface CraftedPrompt {
  prompt: string;
  negativePrompt: string;
  style: BackplateStyle;
  lightDirection: LightDirection;
  palette: string[];
  subjectCount: number;
  /** Why this scene serves this brief — surfaced in the render plan. */
  rationale: string;
  /** Which model produced it, or 'local/deterministic' on fallback. */
  model: string;
  /** True when Claude was unavailable, refused, or produced an unusable prompt. */
  fallback: boolean;
}

/** Structured-output schema. Deliberately flat and constraint-free, per the API's schema subset. */
const CRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    style: { type: 'string', enum: [...BACKPLATE_STYLES] },
    lightDirection: { type: 'string', enum: ['left', 'right', 'back', 'top'] },
    mood: { type: 'string' },
    subjectCount: { type: 'integer' },
    sceneDescription: {
      type: 'string',
      description:
        'The environment itself: place, structures, materials, weather. Two to four sentences. ' +
        'Never mentions a person, a face, a character or a likeness.',
    },
    cameraAndLight: {
      type: 'string',
      description:
        'Focal length, aperture, camera height, key/fill/rim setup, and Kelvin colour temperatures.',
    },
    atmosphereAndDepth: {
      type: 'string',
      description: 'Volumetrics, particulate, and explicit foreground / mid-ground / background separation.',
    },
    rationale: { type: 'string', description: 'One sentence on why this scene serves the brief.' },
  },
  required: [
    'style',
    'lightDirection',
    'mood',
    'subjectCount',
    'sceneDescription',
    'cameraAndLight',
    'atmosphereAndDepth',
    'rationale',
  ],
} as const;

const SYSTEM_PROMPT = `You are the art director for Hexa, a cinematic esports thumbnail engine.

Your job is to turn a rough brief into a precise prompt for a text-to-image model that will paint a BACKPLATE: the background environment only. The people in the final thumbnail are real, licensed photographs of real players, cut out and composited on top of your backplate afterwards. You never describe them.

Hard rules, in order of priority:
1. Never describe a person, a face, a character, a silhouette of an individual, a likeness, or anyone recognisable. Not in the foreground, not in the background, not "in the distance". A generative model cannot reproduce a specific real person, and a generated face next to a photographed one destroys the shot. Abstract, unresolvable crowds (bokeh light points in a stadium bowl) are fine; anything a viewer could read as an individual is not.
2. Leave the subject room. The composited player occupies the centre of the frame, so your scene must have its detail at the edges and top, and its cleanest, most contrasty area exactly where a cut-out will sit.
3. Write photographically. Focal length, aperture, camera height, named light positions, Kelvin temperatures, real materials. "Cinematic" and "epic" are not instructions; "35mm at f/2.0, 5600K key from frame left through heavy haze" is.
4. Build on the supplied brand colours. Keep the two dominant hues on separate sides of the frame rather than blending them into mud, and reserve the accent for small high-chroma hits.
5. Make it specific enough to be one place rather than a genre. A named material, a piece of real staging, one unusual light source.

Answer only in the required JSON structure.`;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  stop_details?: { type?: string; category?: string | null; explanation?: string };
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Turns a rough brief into a structured backplate prompt using the Messages
 * API. Falls back to the deterministic local builder whenever Claude is
 * unavailable, refuses, or returns something that fails the guard — the tool
 * must keep working with no key configured.
 */
export class AnthropicPromptArchitect {
  readonly id = 'anthropic';

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  isConfigured(): boolean {
    return readApiKey('anthropic', this.env) !== undefined;
  }

  async craft(brief: PromptBrief): Promise<CraftedPrompt> {
    // Guard the *input* first: a person-requesting brief never leaves the process.
    assertNoPersonGeneration(brief.brief ?? '');

    const key = readApiKey('anthropic', this.env);
    if (!key) return this.localFallback(brief, 'no ANTHROPIC_API_KEY configured');

    try {
      const body = {
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        // Adaptive thinking is on by default on Claude Opus 5; stating it is
        // explicit rather than load-bearing, and keeps the intent visible.
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: CRAFT_SCHEMA } },
        messages: [{ role: 'user', content: this.userMessage(brief) }],
      };

      const res = await postJson<AnthropicResponse>(API_URL, body, {
        provider: 'anthropic',
        secret: key,
        headers: {
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      });

      // Claude Opus 5 can decline: HTTP 200 with stop_reason 'refusal'. Check
      // this before touching `content`, which is empty on a pre-output refusal.
      if (res.stop_reason === 'refusal') {
        return this.localFallback(
          brief,
          `Claude declined the brief (${res.stop_details?.category ?? 'unspecified'})`,
        );
      }

      const text = (res.content ?? []).find((b) => b.type === 'text')?.text;
      if (!text) return this.localFallback(brief, 'empty response');

      const parsed = JSON.parse(text) as Record<string, unknown>;
      return this.assemble(brief, parsed, res.model ?? MODEL);
    } catch (err) {
      // A prompt is never worth failing a render over.
      return this.localFallback(brief, redactSecrets(err instanceof Error ? err.message : String(err)));
    }
  }

  private userMessage(brief: PromptBrief): string {
    const lines = [`Brief: ${brief.brief}`];
    if (brief.style) lines.push(`Required style: ${brief.style}`);
    if (brief.palette?.length) lines.push(`Brand colours (hex): ${brief.palette.join(', ')}`);
    if (brief.subjectCount) lines.push(`Cut-out subjects to leave room for: ${brief.subjectCount}`);
    if (brief.lightDirection) lines.push(`Required key light direction: ${brief.lightDirection}`);
    if (brief.aspect) lines.push(`Aspect ratio: ${brief.aspect}`);
    if (brief.extra) lines.push(`Additional requirements: ${brief.extra}`);
    lines.push(
      'Remember: environment only. The composited subjects arrive later as photographs, ' +
        'so the scene must have clean, high-contrast negative space where they will stand.',
    );
    return lines.join('\n');
  }

  private assemble(brief: PromptBrief, parsed: Record<string, unknown>, model: string): CraftedPrompt {
    const style = isBackplateStyle(String(parsed.style)) ? (parsed.style as BackplateStyle) : (brief.style ?? 'abstract');
    const lightDirection = (['left', 'right', 'back', 'top'] as const).includes(parsed.lightDirection as LightDirection)
      ? (parsed.lightDirection as LightDirection)
      : (brief.lightDirection ?? 'left');
    const subjectCount = Number.isFinite(parsed.subjectCount)
      ? Math.max(1, Math.min(8, Number(parsed.subjectCount)))
      : (brief.subjectCount ?? 1);

    const composed = [
      'Cinematic esports thumbnail backplate.',
      String(parsed.sceneDescription ?? '').trim(),
      String(parsed.cameraAndLight ?? '').trim(),
      String(parsed.atmosphereAndDepth ?? '').trim(),
      `overall mood: ${String(parsed.mood ?? 'high-stakes and cinematic').trim()}.`,
      COMPOSITION_RULES + '.',
      'photographic realism, physically plausible light transport, shot for compositing.',
      brief.extra?.trim() ?? '',
    ]
      .filter((s) => s !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Defence in depth: the model's output is untrusted. If it drifted into
    // describing a person, discard it and use the deterministic builder.
    const verdict = checkPersonGeneration(composed);
    if (!verdict.ok) {
      return this.localFallback(brief, `crafted prompt failed the person guard: ${verdict.reason}`);
    }

    return {
      prompt: composed,
      negativePrompt: NEGATIVE_BASE,
      style,
      lightDirection,
      palette: brief.palette ?? [],
      subjectCount,
      rationale: String(parsed.rationale ?? '').trim(),
      model,
      fallback: false,
    };
  }

  private localFallback(brief: PromptBrief, reason: string): CraftedPrompt {
    const style = brief.style ?? inferStyleFromBrief(brief.brief ?? '');
    const built = buildBackplatePrompt({
      style,
      mood: brief.brief,
      palette: brief.palette,
      lightDirection: brief.lightDirection,
      subjectCount: brief.subjectCount,
      extra: brief.extra,
    });
    return {
      prompt: built.prompt,
      negativePrompt: built.negativePrompt,
      style,
      lightDirection: brief.lightDirection ?? 'left',
      palette: brief.palette ?? [],
      subjectCount: brief.subjectCount ?? 1,
      rationale: `Deterministic prompt used: ${reason}.`,
      model: 'local/deterministic',
      fallback: true,
    };
  }
}

function inferStyleFromBrief(brief: string): BackplateStyle {
  const hints: ReadonlyArray<[RegExp, BackplateStyle]> = [
    [/\b(arena|stage|lan|tournament)\b/i, 'arena'],
    [/\b(stadium|crowd|fans|stands)\b/i, 'stadium-crowd'],
    [/\b(neon|city|street|skyline)\b/i, 'neon-city'],
    [/\b(cyber|server|tech|digital)\b/i, 'cyber'],
    [/\b(ruin|ancient|collapsed)\b/i, 'ruins'],
    [/\b(void|space|cosmic)\b/i, 'void'],
    [/\b(forest|mountain|nature|sunset)\b/i, 'nature'],
    [/\b(studio|clean|seamless)\b/i, 'studio'],
    [/\b(energy|lightning|plasma|power)\b/i, 'energy'],
    [/\b(glass|shatter|shard)\b/i, 'shattered-glass'],
    [/\b(smoke|fog|mist)\b/i, 'smoke'],
  ];
  for (const [re, style] of hints) if (re.test(brief)) return style;
  return 'abstract';
}

/**
 * Registry-facing shim. Claude generates no images, and this object says so
 * loudly rather than quietly returning something plausible.
 */
export class AnthropicProvider implements ImageProvider {
  readonly id = 'anthropic';

  readonly architect: AnthropicPromptArchitect;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.architect = new AnthropicPromptArchitect(env);
  }

  readonly capabilities: ProviderCapabilities = {
    // All false, honestly. Claude is a language and vision model; it does not
    // emit images. Its role in this package is prompt architecture.
    backplate: false,
    identityGuidedEdit: false,
    inpaint: false,
    upscale: false,
    maxSize: { width: 0, height: 0 },
  };

  isConfigured(): boolean {
    return this.architect.isConfigured();
  }

  async generateBackplate(req: BackplateRequest): Promise<GeneratedImage> {
    // Guard first even on the refusal path: the contract is that no prompt
    // reaches any provider's generateBackplate without being checked.
    assertNoPersonGeneration(req.prompt ?? '');
    throw new HexaError(
      'PROVIDER_ERROR',
      'Claude does not generate images. The Anthropic provider is a prompt architect: it turns a ' +
        'brief into a structured backplate prompt for an image provider.',
      {
        hint:
          'Use AnthropicPromptArchitect.craft() to build the prompt, then pass it to an image ' +
          'provider (google, openai, stability, replicate) or to the offline local provider.',
        details: { provider: 'anthropic', capability: 'backplate' },
      },
    );
  }
}

export const anthropicProvider = new AnthropicProvider();
export const anthropicPromptArchitect = anthropicProvider.architect;
