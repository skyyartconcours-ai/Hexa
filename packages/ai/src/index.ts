/**
 * `@hexa/ai` — the generative boundary.
 *
 * Everything Hexa asks a model to draw passes through this package, and the
 * package exists to enforce one rule: **models supply environment, atmosphere
 * and light; photographs supply identity.**
 *
 *   - `generateBackplate` paints backgrounds, and refuses any prompt that asks
 *     for a person, a face or a likeness (`assertNoPersonGeneration`).
 *   - `identityGuidedEdit` edits a plate that already contains a photographed
 *     face, and refuses unless the caller declares the face regions and keeps
 *     the edit weak enough for the face to survive (`guardIdentityEdit`). Its
 *     output is expected to be re-verified by the identity gate.
 *   - The `local` provider needs no key and no network, so the rule holds even
 *     with nothing configured.
 */

export * from './types.js';
export * from './guard.js';
export * from './prompt.js';
export * from './cache.js';
export * from './config.js';
export * from './registry.js';

export { httpRequest, postJson, getJson, fetchBinary, providerError } from './http.js';
export type { HttpRequestOptions } from './http.js';

export { LocalProvider, localProvider, inferStyle } from './providers/local.js';
export { StubProvider, stubProvider } from './providers/stub.js';
export { GoogleProvider, googleProvider } from './providers/google.js';
export { OpenAiProvider, openaiProvider, snapSize } from './providers/openai.js';
export { StabilityProvider, stabilityProvider } from './providers/stability.js';
export { ReplicateProvider, replicateProvider } from './providers/replicate.js';
export {
  AnthropicProvider,
  AnthropicPromptArchitect,
  anthropicProvider,
  anthropicPromptArchitect,
} from './providers/anthropic.js';
export type { PromptBrief, CraftedPrompt } from './providers/anthropic.js';

export { nearestAspect, fitExact, COMMON_ASPECTS } from './providers/shared.js';
