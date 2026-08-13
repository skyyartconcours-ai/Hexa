/**
 * The one HTTP path every hosted provider goes through.
 *
 * Image endpoints are slow, expensive and rate-limited, which makes three
 * behaviours non-negotiable:
 *
 *   - **Timeouts.** A generation request that hangs blocks the whole render.
 *     Every call carries an abort deadline.
 *   - **Backoff with jitter.** 429 and 5xx are routine, not exceptional. Retry
 *     with exponential backoff and *full jitter*, because a batch render fires
 *     several requests at once and lock-step retries just recreate the burst
 *     that caused the 429. `Retry-After` wins when the server sends it.
 *   - **Redaction.** Provider error bodies quote the request back, and Google
 *     accepts the key as a URL parameter, so nothing reaches a `HexaError`
 *     without passing through `redactSecrets` first.
 *
 * Uses global `fetch` (Node 20+). No HTTP client dependency by design: this
 * package ships into a CLI where install weight is a feature.
 */

import { HexaError } from '@hexa/core';
import { redactSecrets, runtimeDefaults } from './config.js';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
  retries?: number;
  /** Caller-supplied cancellation, merged with the timeout. */
  signal?: AbortSignal;
  /** Provider id, used for error attribution. */
  provider: string;
  /** Key value to scrub from any error text, in case its shape is unknown. */
  secret?: string;
  /** Base delay for backoff; doubles each attempt. */
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Statuses worth trying again: throttling, transient server failure. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 60_000);
  return undefined;
}

/** Full-jitter exponential backoff: random in [0, base * 2^attempt]. */
function backoffDelay(attempt: number, base: number, max: number): number {
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function providerError(
  provider: string,
  message: string,
  opts: { status?: number; secret?: string; cause?: unknown; retryable?: boolean } = {},
): HexaError {
  return new HexaError('PROVIDER_ERROR', redactSecrets(`[${provider}] ${message}`, [opts.secret]), {
    hint:
      opts.status === 401 || opts.status === 403
        ? `Check the API key for the "${provider}" provider, or run without it — Hexa falls back to the offline provider for backplates.`
        : opts.status === 429
          ? `The "${provider}" provider is rate limiting. Hexa already retried with backoff; try again shortly or switch providers.`
          : `The "${provider}" provider failed. Re-run with --provider local to render offline.`,
    details: { provider, status: opts.status, retryable: opts.retryable ?? false },
    cause: opts.cause,
  });
}

/**
 * Perform an HTTP request with timeout + retry, returning the raw Response on
 * success. Non-2xx responses that are not retryable throw immediately.
 */
export async function httpRequest(url: string, opts: HttpRequestOptions): Promise<Response> {
  const defaults = runtimeDefaults();
  const timeoutMs = opts.timeoutMs ?? defaults.timeoutMs;
  const retries = opts.retries ?? defaults.retries;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 20_000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    const onAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: opts.method ?? 'POST',
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      });

      if (res.ok) return res;

      const status = res.status;
      const bodyText = await safeText(res);
      if (isRetryableStatus(status) && attempt < retries) {
        const wait = parseRetryAfter(res.headers.get('retry-after')) ?? backoffDelay(attempt, base, max);
        lastError = providerError(opts.provider, `HTTP ${status}: ${bodyText}`, {
          status,
          secret: opts.secret,
          retryable: true,
        });
        await sleep(wait);
        continue;
      }
      throw providerError(opts.provider, `HTTP ${status}: ${bodyText}`, {
        status,
        secret: opts.secret,
        retryable: isRetryableStatus(status),
      });
    } catch (err) {
      // Already classified above — retryable responses `continue` rather than
      // throw, so anything typed reaching here is final.
      if (err instanceof HexaError) throw err;
      // Network-level failure or abort.
      if (opts.signal?.aborted) {
        throw providerError(opts.provider, 'request cancelled', { secret: opts.secret, cause: err });
      }
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffDelay(attempt, base, max));
        continue;
      }
      throw providerError(opts.provider, describeNetworkError(err), {
        secret: opts.secret,
        cause: err,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError instanceof HexaError
    ? lastError
    : providerError(opts.provider, describeNetworkError(lastError), { secret: opts.secret, cause: lastError });
}

/** POST JSON, parse JSON. */
export async function postJson<T>(url: string, body: unknown, opts: HttpRequestOptions): Promise<T> {
  const res = await httpRequest(url, {
    ...opts,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(body),
  });
  return parseJson<T>(res, opts);
}

/** GET, parse JSON. */
export async function getJson<T>(url: string, opts: HttpRequestOptions): Promise<T> {
  const res = await httpRequest(url, { ...opts, method: 'GET', body: undefined });
  return parseJson<T>(res, opts);
}

async function parseJson<T>(res: Response, opts: HttpRequestOptions): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw providerError(opts.provider, `malformed JSON response: ${text.slice(0, 200)}`, {
      status: res.status,
      secret: opts.secret,
      cause: err,
    });
  }
}

/** Fetch a URL and return the bytes — used for providers that return image URLs. */
export async function fetchBinary(url: string, opts: HttpRequestOptions): Promise<Buffer> {
  const res = await httpRequest(url, { ...opts, method: 'GET', body: undefined });
  return Buffer.from(await res.arrayBuffer());
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.length > 600 ? `${t.slice(0, 600)}…` : t;
  } catch {
    return '<unreadable body>';
  }
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string } }).cause;
    const code = cause?.code ? ` (${cause.code})` : '';
    return `network error: ${err.message}${code}`;
  }
  return `network error: ${String(err)}`;
}

export { providerError };
