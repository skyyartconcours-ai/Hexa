/**
 * Credentials and redaction.
 *
 * Two rules, both load-bearing:
 *
 *   1. A missing key is a *configuration* state, not an error. `isConfigured()`
 *      returns false and the registry routes around the provider, because the
 *      tool has to work out of the box with no keys at all.
 *   2. A key must never reach a log line, an error message, a cache file or a
 *      render plan. Hosted providers habitually echo the failing request back
 *      in their error bodies — including the URL, and Google puts the API key
 *      in the URL — so every string that leaves this package goes through
 *      `redactSecrets` first. Redaction is belt-and-braces: exact-value
 *      matching for keys we know about, pattern matching for the ones we do not.
 */

/** Env var consulted for each provider, in order of preference. */
export const PROVIDER_ENV: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  stability: ['STABILITY_API_KEY'],
  replicate: ['REPLICATE_API_TOKEN'],
};

/** First non-empty value among the provider's env vars, or undefined. */
export function readApiKey(providerId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of PROVIDER_ENV[providerId] ?? []) {
    const v = env[name];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

/** Which env var actually supplied the key — for `hexa providers` output. */
export function resolvedEnvVar(providerId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of PROVIDER_ENV[providerId] ?? []) {
    const v = env[name];
    if (typeof v === 'string' && v.trim() !== '') return name;
  }
  return PROVIDER_ENV[providerId]?.[0];
}

/**
 * Shapes that are almost certainly credentials regardless of provider.
 * Ordered longest-prefix-first so `sk-ant-…` is not half-masked by the `sk-…`
 * rule.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_\-]{8,}/g,          // Anthropic
  /\bsk-proj-[A-Za-z0-9_\-]{8,}/g,         // OpenAI project keys
  /\bsk-[A-Za-z0-9_\-]{16,}/g,             // OpenAI / Stability
  /\bAIza[0-9A-Za-z_\-]{16,}/g,            // Google
  /\br8_[A-Za-z0-9]{16,}/g,                // Replicate
  /\bghp_[A-Za-z0-9]{16,}/g,               // stray GitHub tokens
  /(?<=[?&]key=)[^&\s"']{8,}/g,            // Google puts the key in the URL
  /(?<=[Bb]earer\s)[A-Za-z0-9._\-]{12,}/g, // Authorization: Bearer …
  /(?<=x-api-key["':\s]{1,4})[A-Za-z0-9._\-]{12,}/g,
];

const MASK = '[redacted]';

/**
 * Strip anything that looks like a credential out of `text`.
 *
 * `extra` lets a caller pass the specific key value it was using, which covers
 * providers whose key format we do not recognise.
 */
export function redactSecrets(text: unknown, extra: readonly (string | undefined)[] = []): string {
  let out = typeof text === 'string' ? text : safeString(text);

  // Exact values first — the strongest signal we have.
  const exact = new Set<string>();
  for (const names of Object.values(PROVIDER_ENV)) {
    for (const name of names) {
      const v = process.env[name];
      if (typeof v === 'string' && v.trim().length >= 8) exact.add(v.trim());
    }
  }
  for (const v of extra) if (typeof v === 'string' && v.trim().length >= 8) exact.add(v.trim());

  for (const secret of [...exact].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(MASK);
  }

  for (const re of SECRET_PATTERNS) out = out.replace(re, MASK);
  return out;
}

function safeString(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Global knobs, read once per call so tests can flip env vars freely. */
export interface AiRuntimeOptions {
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Retry attempts after the first try. */
  retries?: number;
}

export function runtimeDefaults(env: NodeJS.ProcessEnv = process.env): Required<AiRuntimeOptions> {
  const timeout = Number.parseInt(env.HEXA_AI_TIMEOUT_MS ?? '', 10);
  const retries = Number.parseInt(env.HEXA_AI_RETRIES ?? '', 10);
  return {
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
    retries: Number.isFinite(retries) && retries >= 0 ? retries : 3,
  };
}
