/**
 * Adversarial suite for credential leakage and the response cache.
 *
 * Two attacker positions are assumed, both realistic:
 *
 *   1. **A hostile response body.** Reverse proxies and gateways routinely echo
 *      request headers into their error pages; a provider outage can serve HTML
 *      containing the Authorization header. Any path that puts a raw response
 *      body into an error message leaks the key.
 *   2. **A hostile model output.** Replicate is a marketplace: the *model*
 *      chooses the output URL, and Hexa follows it with the account token
 *      attached. A model that returns `https://evil.example/x.png` collects the
 *      token — no compromise of Hexa required.
 *
 * Plus the cache, whose key is a caller-supplied string used to build a path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { OpenAiProvider } from '../src/providers/openai.js';
import { StabilityProvider } from '../src/providers/stability.js';
import { ReplicateProvider } from '../src/providers/replicate.js';
import { cacheKey, readCache, writeCache } from '../src/cache.js';

const realFetch = globalThis.fetch;

const OPENAI_KEY = 'sk-proj-LEAKCANARY0123456789abcdef';
const STABILITY_KEY = 'sk-STABILITYLEAKCANARY0123456789';
const REPLICATE_KEY = 'r8_LEAKCANARY0123456789abcdefgh';

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

// ── 1. Response bodies that quote the request back ──────────────────────────

describe('attack: a proxy error page that echoes the Authorization header', () => {
  it('does not leak the OpenAI key through a malformed-JSON error on the edits endpoint', async () => {
    // 200 OK, but HTML — exactly what a captive proxy returns. The multipart
    // edit path parses the body itself rather than going through the redacting
    // JSON helper, which is what made this reachable.
    globalThis.fetch = vi.fn(async () =>
      new Response(`<html><body>Bad gateway. Request headers: authorization: Bearer ${OPENAI_KEY}</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ) as unknown as typeof fetch;

    const provider = new OpenAiProvider({ OPENAI_API_KEY: OPENAI_KEY } as NodeJS.ProcessEnv);
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#303040' } })
      .png()
      .toBuffer();
    const mask = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000000' } })
      .png()
      .toBuffer();

    let thrown: unknown;
    try {
      await provider.inpaint({ image, mask, prompt: 'An empty arena stage, haze, no people.' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const text = `${(thrown as Error).message} ${JSON.stringify((thrown as { details?: unknown }).details ?? {})}`;
    expect(text, 'the OpenAI key survived into the error message').not.toContain(OPENAI_KEY);
  });

  it('does not leak the Stability key through a malformed-JSON error', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(`upstream rejected: authorization: Bearer ${STABILITY_KEY}`, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    ) as unknown as typeof fetch;

    const provider = new StabilityProvider({ STABILITY_API_KEY: STABILITY_KEY } as NodeJS.ProcessEnv);
    let thrown: unknown;
    try {
      await provider.generateBackplate({ prompt: 'An empty arena stage, haze, no people.', width: 512, height: 512 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect((thrown as Error).message, 'the Stability key survived into the error message').not.toContain(STABILITY_KEY);
  });
});

// ── 2. A model that chooses where Hexa sends its token ──────────────────────

describe('attack: a Replicate model whose output URL points at the attacker', () => {
  it('does not send the API token to a host outside Replicate', async () => {
    const seen: Array<{ url: string; auth?: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers ?? {});
      seen.push({ url, auth: headers.get('authorization') ?? undefined });
      if (url.includes('api.replicate.com')) {
        return new Response(
          JSON.stringify({ id: 'p1', status: 'succeeded', output: ['https://evil.example/collect/x.png'] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // The attacker's endpoint returns a valid tiny PNG so the call "succeeds".
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new ReplicateProvider({ REPLICATE_API_TOKEN: REPLICATE_KEY } as NodeJS.ProcessEnv);
    await provider
      .generateBackplate({ prompt: 'An empty arena stage, haze, no people.', width: 512, height: 512 })
      .catch(() => undefined);

    const offsite = seen.filter((r) => !r.url.includes('replicate.com') && !r.url.includes('replicate.delivery'));
    expect(offsite.length, 'expected the attacker URL to have been fetched at all').toBeGreaterThan(0);
    for (const call of offsite) {
      expect(call.auth ?? '', `token sent to ${call.url}`).not.toContain(REPLICATE_KEY);
    }
  });

  it('does not send the API token to an attacker-chosen polling URL', async () => {
    const seen: Array<{ url: string; auth?: string }> = [];
    let creates = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers ?? {});
      seen.push({ url, auth: headers.get('authorization') ?? undefined });
      if (url.includes('api.replicate.com')) {
        // The create call hands back a poll URL on a host we do not control;
        // the canonical poll URL then finishes the job.
        if (creates++ === 0) {
          return new Response(
            JSON.stringify({ id: 'p1', status: 'processing', urls: { get: 'https://evil.example/poll/p1' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ id: 'p1', status: 'succeeded', output: 'data:image/png;base64,iVBORw0KGgo=' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ id: 'p1', status: 'succeeded', output: 'data:image/png;base64,iVBORw0KGgo=' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const provider = new ReplicateProvider({ REPLICATE_API_TOKEN: REPLICATE_KEY } as NodeJS.ProcessEnv);
    await provider
      .generateBackplate({ prompt: 'An empty arena stage, haze, no people.', width: 64, height: 64 })
      .catch(() => undefined);

    for (const call of seen.filter((r) => r.url.includes('evil.example'))) {
      expect(call.auth ?? '', `token sent to ${call.url}`).not.toContain(REPLICATE_KEY);
    }
  }, 20_000);
});

// ── 3. The cache as a filesystem primitive ──────────────────────────────────

describe('attack: cache keys that escape the cache directory', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hexa-cache-attack-'));
  });

  /**
   * `paths()` shards on `key.slice(0, 2)` and then joins the whole key, so the
   * escape has to walk back out of both the shard and the cache directory:
   *   <cache>/xx + "xx/../../../outside/pwned.json" → <dir>/outside/pwned.json
   */
  const ESCAPE_KEY = 'xx/../../../outside/pwned';

  it('refuses to write outside the cache directory', async () => {
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside, { recursive: true });
    const cacheDir = path.join(dir, 'cache');

    await writeCache(
      ESCAPE_KEY,
      {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]),
        width: 1,
        height: 1,
        provider: 'stub',
        model: 'stub/gradient',
        promptUsed: 'x',
      },
      { dir: cacheDir, enabled: true },
    );

    const leaked = await fs.readdir(outside);
    expect(leaked, 'the cache wrote outside its own directory').toEqual([]);
  });

  it('refuses to read outside the cache directory', async () => {
    const cacheDir = path.join(dir, 'cache');
    const outside = path.join(dir, 'outside');
    await fs.mkdir(path.join(cacheDir, 'xx'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    // A file the cache must never serve, planted where traversal would find it.
    await fs.writeFile(
      path.join(outside, 'pwned.json'),
      JSON.stringify({ storedAt: Date.now(), ext: 'png', width: 1, height: 1, provider: 'x', model: 'x', promptUsed: 'x' }),
    );
    await fs.writeFile(path.join(outside, 'pwned.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));

    const hit = await readCache(ESCAPE_KEY, { dir: cacheDir, enabled: true });
    expect(hit, 'the cache served a file from outside its directory').toBeUndefined();
  });

  it('gives structurally different requests different keys', async () => {
    // A key collision would serve one request's pixels for another's prompt.
    // The parts are hashed as a structure, not concatenated, so a value cannot
    // impersonate a field boundary.
    const base = { kind: 'backplate', provider: 'stub', width: 1280, height: 720 };
    const keys = new Set(
      [
        { ...base, prompt: 'a,b', negativePrompt: 'c' },
        { ...base, prompt: 'a', negativePrompt: 'b,c' },
        { ...base, prompt: 'a', negativePrompt: 'b', seed: 1 },
        { ...base, prompt: 'a', negativePrompt: 'b', seed: 2 },
        { ...base, prompt: 'ab', negativePrompt: '' },
        { ...base, prompt: 'a', style: 'arena' },
        { ...base, prompt: 'a', style: 'cyber' },
      ].map(cacheKey),
    );
    expect(keys.size).toBe(7);
  });

  it('produces keys that stay inside the cache directory', () => {
    for (const parts of [{ prompt: '../../etc/passwd' }, { prompt: '\\..\\..\\x' }, { prompt: 'a/b/c' }]) {
      expect(cacheKey(parts)).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('keeps working for well-formed keys', async () => {
    const cacheDir = path.join(dir, 'cache');
    const key = 'a'.repeat(40);
    const image = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]),
      width: 2,
      height: 2,
      provider: 'stub',
      model: 'stub/gradient',
      promptUsed: 'An empty arena stage.',
    };
    await writeCache(key, image, { dir: cacheDir, enabled: true });
    const hit = await readCache(key, { dir: cacheDir, enabled: true });
    expect(hit?.width).toBe(2);
    expect(hit?.provider).toBe('stub');
  });
});
