/**
 * Provider registry and routing.
 *
 * The routing rule that matters: **a backplate request must never fail because
 * of a provider.** Hexa is a CLI someone installs and runs; if no key is
 * configured, if a key is wrong, if a hosted API is down or rate-limited, the
 * render still has to produce a plate. So `resolveProvider` degrades to the
 * offline painter rather than throwing, and `generateBackplate` falls back to
 * it a second time if the chosen provider errors mid-call.
 *
 * Identity edits route by the opposite rule. There is no safe fallback for
 * "preserve this person's face" — the offline painter cannot follow an edit
 * instruction, so returning *something* would be worse than failing. That path
 * throws when no capable provider is configured.
 *
 * Both entry points run the guards before anything else, so the safety rule
 * holds no matter which provider is selected or whether the cache is hit.
 */

import { HexaError, log } from '@hexa/core';
import type {
  BackplateRequest,
  GeneratedImage,
  IdentityEditRequest,
  ImageProvider,
  ProviderCapabilities,
  ProviderStatus,
} from './types.js';
import { assertIdentityEditSafe, assertNegativePromptSafe, assertNoPersonGeneration } from './guard.js';
import { cacheKey, readCache, writeCache, type AiCacheOptions } from './cache.js';
import { PROVIDER_ENV, resolvedEnvVar } from './config.js';
import { localProvider } from './providers/local.js';
import { stubProvider } from './providers/stub.js';
import { anthropicProvider } from './providers/anthropic.js';
import { googleProvider } from './providers/google.js';
import { openaiProvider } from './providers/openai.js';
import { stabilityProvider } from './providers/stability.js';
import { replicateProvider } from './providers/replicate.js';

const registry = new Map<string, ImageProvider>();

/** Order hosted providers are auto-selected in when a capability is required. */
const AUTO_PRIORITY: readonly string[] = ['google', 'openai', 'stability', 'replicate'];

export function registerProvider(p: ImageProvider): void {
  if (!p || typeof p.id !== 'string' || p.id.trim() === '') {
    throw new HexaError('INVALID_REQUEST', 'Provider must have a non-empty string id.');
  }
  if (typeof p.generateBackplate !== 'function' || typeof p.isConfigured !== 'function') {
    throw new HexaError('INVALID_REQUEST', `Provider "${p.id}" does not implement the ImageProvider interface.`);
  }
  registry.set(p.id, p);
}

export function getProvider(id: string): ImageProvider | undefined {
  return registry.get(id);
}

export function listProviders(): ImageProvider[] {
  return [...registry.values()];
}

/** Remove a provider. Registering over an id also replaces it. */
export function unregisterProvider(id: string): boolean {
  return registry.delete(id);
}

/** Restore the built-in set — used by tests and by long-lived processes. */
export function resetProviders(): void {
  registry.clear();
  for (const p of [
    localProvider,
    stubProvider,
    anthropicProvider,
    googleProvider,
    openaiProvider,
    stabilityProvider,
    replicateProvider,
  ]) {
    registerProvider(p);
  }
}

resetProviders();

type Capability = keyof ProviderCapabilities;

function usable(p: ImageProvider | undefined, need?: Capability): boolean {
  if (!p) return false;
  if (!p.isConfigured()) return false;
  if (!need || need === 'maxSize') return true;
  if (p.capabilities[need] !== true) return false;
  // A declared capability with no method behind it is a lie; treat it as absent.
  if (need === 'identityGuidedEdit' && typeof p.identityGuidedEdit !== 'function') return false;
  if (need === 'inpaint' && typeof p.inpaint !== 'function') return false;
  if (need === 'upscale' && typeof p.upscale !== 'function') return false;
  return true;
}

/**
 * Pick a provider. Never throws: the offline painter is always the last resort,
 * which is what makes "works with zero configuration" true rather than aspirational.
 */
export function resolveProvider(opts?: { prefer?: string; need?: Capability }): ImageProvider {
  const need = opts?.need;

  const prefer = opts?.prefer?.trim();
  if (prefer) {
    const p = registry.get(prefer);
    if (p && usable(p, need)) return p;
    if (!p) {
      log.warn(`Unknown AI provider "${prefer}"; falling back.`, { known: [...registry.keys()] });
    } else if (!p.isConfigured()) {
      log.warn(`AI provider "${prefer}" is not configured; falling back.`, {
        envVar: resolvedEnvVar(prefer),
      });
    } else {
      log.warn(`AI provider "${prefer}" cannot ${need ?? 'serve this request'}; falling back.`);
    }
  }

  const envPref = process.env.HEXA_AI_PROVIDER?.trim();
  if (envPref) {
    const p = registry.get(envPref);
    if (p && usable(p, need)) return p;
  }

  // Only reach for a hosted provider when the offline one genuinely cannot do
  // the job — otherwise a configured key would silently start billing for work
  // the local painter does for free.
  const local = registry.get('local') ?? localProvider;
  if (!need || need === 'maxSize' || usable(local, need)) return local;

  for (const id of AUTO_PRIORITY) {
    const p = registry.get(id);
    if (p && usable(p, need)) return p;
  }
  return local;
}

export interface BackplateRouteRequest extends BackplateRequest {
  provider?: string;
  cache?: AiCacheOptions;
}

/**
 * Generate a backplate through the registry: guard, cache, provider, cache.
 *
 * Falls back to the offline painter if the selected provider fails, because a
 * missing background is a failed render and a procedurally painted one is not.
 */
export async function generateBackplate(req: BackplateRouteRequest): Promise<GeneratedImage> {
  // First line of defence. Each provider re-checks; this catch is here so the
  // refusal happens before a cache lookup or a network connection.
  assertNoPersonGeneration(req.prompt ?? '');
  // The negative prompt is a second channel into the model — Gemini and OpenAI
  // have no negative-prompt parameter, so Hexa folds it into the instruction.
  // An instruction hidden there would reach the model unguarded.
  assertNegativePromptSafe(req.negativePrompt);

  const provider = resolveProvider({ prefer: req.provider, need: 'backplate' });
  const key = cacheKey({
    kind: 'backplate',
    provider: provider.id,
    prompt: req.prompt,
    negativePrompt: req.negativePrompt,
    width: req.width,
    height: req.height,
    seed: req.seed,
    style: req.style,
    palette: req.palette,
    strength: req.strength,
  });

  // Local painters are cheap and deterministic; caching them only risks
  // serving pixels from a superseded version of the code.
  const cacheable = !provider.local;

  const hit = cacheable ? await readCache(key, req.cache) : undefined;
  if (hit) {
    log.debug(`backplate cache hit (${provider.id})`, { key });
    return hit;
  }

  try {
    const image = await provider.generateBackplate(stripRouting(req));
    if (cacheable) await writeCache(key, image, req.cache);
    return image;
  } catch (err) {
    // A refused prompt is a caller error and must surface. Anything else — a
    // dead API, a bad key, a rate limit — degrades to the offline painter.
    if (err instanceof HexaError && err.code === 'INVALID_REQUEST') throw err;
    if (provider.id === 'local') throw err;

    log.warn(`AI provider "${provider.id}" failed; painting the backplate offline instead.`, {
      error: err instanceof Error ? err.message : String(err),
    });
    // Not cached: the fallback painter is local, and a cached fallback would
    // outlive the outage that caused it — the next run would silently keep the
    // offline plate instead of retrying the provider the user paid for.
    return await localProvider.generateBackplate(stripRouting(req));
  }
}

export interface IdentityEditRouteRequest extends IdentityEditRequest {
  provider?: string;
  cache?: AiCacheOptions;
}

/**
 * Run an identity-preserving edit.
 *
 * The result is **not** verified here — that is the caller's job. Hexa's
 * contract is that any generative touch of a subject plate goes back through
 * the identity gate in `@hexa/vision` before it can be composited, and this
 * function deliberately does not pretend to have done it.
 */
export async function identityGuidedEdit(req: IdentityEditRouteRequest): Promise<GeneratedImage> {
  // The async form also measures the preserve boxes against the real frame and
  // checks that the mask is not handing the face to the model.
  await assertIdentityEditSafe(req);

  const provider = resolveProvider({ prefer: req.provider, need: 'identityGuidedEdit' });
  if (typeof provider.identityGuidedEdit !== 'function' || !provider.capabilities.identityGuidedEdit) {
    const capable = listProviders()
      .filter((p) => p.capabilities.identityGuidedEdit && typeof p.identityGuidedEdit === 'function')
      .map((p) => p.id);
    throw new HexaError(
      'PROVIDER_NOT_CONFIGURED',
      'No configured provider can perform an identity-preserving edit.',
      {
        hint:
          capable.length > 0
            ? `Configure one of: ${capable.map((id) => `${id} (${(PROVIDER_ENV[id] ?? []).join(' or ')})`).join(', ')}.`
            : 'No provider in the registry supports identity-guided edits.',
        details: { requested: req.provider, capable },
      },
    );
  }

  const key = cacheKey({
    kind: 'identity-edit',
    provider: provider.id,
    prompt: req.prompt,
    image: req.image,
    mask: req.mask,
    strength: req.strength,
    seed: req.seed,
    preserve: req.preserve,
  });

  const hit = await readCache(key, req.cache);
  if (hit) {
    log.debug(`identity edit cache hit (${provider.id})`, { key });
    return hit;
  }

  const image = await provider.identityGuidedEdit(stripRouting(req));
  await writeCache(key, image, req.cache);
  return image;
}

function stripRouting<T extends { provider?: string; cache?: AiCacheOptions }>(req: T): Omit<T, 'provider' | 'cache'> {
  const { provider: _provider, cache: _cache, ...rest } = req;
  return rest;
}

/** Backing data for a `hexa providers` command. */
export function providerStatus(): ProviderStatus[] {
  return listProviders().map((p) => {
    const envVars = PROVIDER_ENV[p.id] ?? [];
    const configured = p.isConfigured();
    return {
      id: p.id,
      configured,
      capabilities: { ...p.capabilities, maxSize: { ...p.capabilities.maxSize } },
      envVar: envVars.length > 0 ? (resolvedEnvVar(p.id) ?? envVars[0]) : undefined,
      note: describeProvider(p, configured),
    };
  });
}

function describeProvider(p: ImageProvider, configured: boolean): string {
  if (p.id === 'local') return 'Offline procedural painter. Always available, no key, no network.';
  if (p.id === 'stub') return 'Deterministic gradient for tests.';
  if (p.id === 'anthropic') {
    return configured
      ? 'Prompt architect. Claude generates no images; it writes the backplate prompt.'
      : 'Prompt architect (needs a key). Claude generates no images; it writes the backplate prompt.';
  }
  const caps = [
    p.capabilities.backplate ? 'backplate' : null,
    p.capabilities.identityGuidedEdit ? 'identity-edit' : null,
    p.capabilities.inpaint ? 'inpaint' : null,
    p.capabilities.upscale ? 'upscale' : null,
  ].filter(Boolean);
  return configured
    ? `Ready — ${caps.join(', ')}.`
    : `Not configured. Set ${(PROVIDER_ENV[p.id] ?? []).join(' or ')} to enable ${caps.join(', ')}.`;
}
