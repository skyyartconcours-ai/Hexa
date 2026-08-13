/**
 * Credentials must never survive a round trip into an error message, a log
 * line, a cache sidecar or a render plan. Hosted image APIs quote the failing
 * request back in their error bodies, and Google accepts the key as a URL
 * parameter, so this is not a theoretical concern.
 *
 * No network: `fetch` is stubbed for every test that exercises the HTTP layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHexaError } from '@hexa/core';
import { redactSecrets } from '../src/config.js';
import { httpRequest } from '../src/http.js';
import { GoogleProvider } from '../src/providers/google.js';
import { OpenAiProvider } from '../src/providers/openai.js';
import { StabilityProvider } from '../src/providers/stability.js';
import { ReplicateProvider } from '../src/providers/replicate.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('redactSecrets — pattern matching', () => {
  it('masks Anthropic keys', () => {
    const out = redactSecrets('failed with sk-ant-api03-AAAABBBBCCCCDDDDEEEE in the header');
    expect(out).not.toContain('sk-ant-api03');
    expect(out).toContain('[redacted]');
  });

  it('masks OpenAI keys', () => {
    expect(redactSecrets('Bad key sk-proj-AAAABBBBCCCCDDDDEEEEFFFF')).not.toContain('AAAABBBB');
    expect(redactSecrets('Bad key sk-abcdefghijklmnopqrstuvwx')).not.toContain('abcdefghijklmnop');
  });

  it('masks Google keys', () => {
    expect(redactSecrets('key AIzaSyA1234567890abcdefghijkl rejected')).not.toContain('AIzaSyA1234567890');
  });

  it('masks Replicate tokens', () => {
    expect(redactSecrets('token r8_abcdefghij0123456789ABCDEF failed')).not.toContain('r8_abcdefghij');
  });

  it('masks a key passed in a URL query parameter', () => {
    const out = redactSecrets(
      'GET https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=SUPERSECRETVALUE123 failed',
    );
    expect(out).not.toContain('SUPERSECRETVALUE123');
    expect(out).toContain('[redacted]');
  });

  it('masks bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).not.toContain('abcdefghijkl');
  });

  it('masks the exact value of a configured env key even when it looks like nothing', () => {
    const prev = process.env.STABILITY_API_KEY;
    process.env.STABILITY_API_KEY = 'totally-unrecognisable-shape-9999';
    try {
      const out = redactSecrets('request failed for totally-unrecognisable-shape-9999');
      expect(out).not.toContain('totally-unrecognisable-shape-9999');
      expect(out).toContain('[redacted]');
    } finally {
      if (prev === undefined) delete process.env.STABILITY_API_KEY;
      else process.env.STABILITY_API_KEY = prev;
    }
  });

  it('masks a caller-supplied secret of unknown shape', () => {
    expect(redactSecrets('boom: zzz-my-weird-key-9', ['zzz-my-weird-key-9'])).not.toContain('my-weird-key');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Backplate generation failed: the arena style needs a palette.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('handles non-strings without throwing', () => {
    expect(redactSecrets(undefined)).toBe('');
    expect(redactSecrets(null)).toBe('');
    expect(redactSecrets(new Error('plain failure'))).toContain('plain failure');
    expect(redactSecrets({ status: 500 })).toContain('500');
  });
});

describe('httpRequest — errors never carry the key', () => {
  const KEY = 'sk-ant-api03-SECRETSECRETSECRET1234';

  it('redacts a key echoed back in a provider error body', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(401, {
        error: { message: `Invalid API key: ${KEY} for request https://api.example.com/v1?key=${KEY}` },
      }),
    ) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await httpRequest('https://api.example.com/v1', {
        provider: 'anthropic',
        secret: KEY,
        retries: 0,
        headers: { 'x-api-key': KEY },
        body: '{}',
      });
    } catch (err) {
      thrown = err;
    }

    expect(isHexaError(thrown)).toBe(true);
    const message = (thrown as Error).message;
    expect(message).not.toContain(KEY);
    expect(message).not.toContain('SECRETSECRET');
    expect(message).toContain('[redacted]');
    expect(message).toContain('401');
    expect(JSON.stringify(thrown)).not.toContain('SECRETSECRET');
  });

  it('redacts a key surfaced through a network-level failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED while sending ${KEY}`);
    }) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await httpRequest('https://api.example.com/v1', {
        provider: 'openai',
        secret: KEY,
        retries: 0,
        body: '{}',
      });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).not.toContain('SECRETSECRET');
  });

  it('gives an actionable hint on an auth failure', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(403, { error: 'forbidden' })) as unknown as typeof fetch;
    try {
      await httpRequest('https://api.example.com/v1', { provider: 'stability', retries: 0, body: '{}' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { hint?: string }).hint).toMatch(/API key/i);
    }
  });

  it('retries a 429 and then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
        : jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;

    const res = await httpRequest('https://api.example.com/v1', {
      provider: 'google',
      retries: 2,
      baseDelayMs: 1,
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('gives up after the retry budget and reports the status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    let thrown: unknown;
    try {
      await httpRequest('https://api.example.com/v1', {
        provider: 'replicate',
        retries: 1,
        baseDelayMs: 1,
        body: '{}',
      });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).toContain('503');
    expect((thrown as { details?: { provider?: string } }).details?.provider).toBe('replicate');
  });

  it('does not retry a non-retryable status', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return jsonResponse(400, { error: 'bad prompt' });
    }) as unknown as typeof fetch;

    await expect(
      httpRequest('https://api.example.com/v1', { provider: 'openai', retries: 3, baseDelayMs: 1, body: '{}' }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('provider errors never carry the key', () => {
  const cases: Array<[string, string, () => Promise<unknown>]> = [
    [
      'google',
      'AIzaSyGOOGLESECRET0123456789',
      async () => {
        const p = new GoogleProvider({ GOOGLE_API_KEY: 'AIzaSyGOOGLESECRET0123456789' } as NodeJS.ProcessEnv);
        return p.generateBackplate({ prompt: 'empty arena, no people', width: 64, height: 64 });
      },
    ],
    [
      'openai',
      'sk-OPENAISECRET0123456789abcd',
      async () => {
        const p = new OpenAiProvider({ OPENAI_API_KEY: 'sk-OPENAISECRET0123456789abcd' } as NodeJS.ProcessEnv);
        return p.generateBackplate({ prompt: 'empty arena, no people', width: 64, height: 64 });
      },
    ],
    [
      'stability',
      'sk-STABILITYSECRET0123456789',
      async () => {
        const p = new StabilityProvider({ STABILITY_API_KEY: 'sk-STABILITYSECRET0123456789' } as NodeJS.ProcessEnv);
        return p.generateBackplate({ prompt: 'empty arena, no people', width: 64, height: 64 });
      },
    ],
    [
      'replicate',
      'r8_REPLICATESECRET0123456789',
      async () => {
        const p = new ReplicateProvider({ REPLICATE_API_TOKEN: 'r8_REPLICATESECRET0123456789' } as NodeJS.ProcessEnv);
        return p.generateBackplate({ prompt: 'empty arena, no people', width: 64, height: 64 });
      },
    ],
  ];

  for (const [name, key, run] of cases) {
    it(`redacts the ${name} key when the API rejects the request`, async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
        jsonResponse(401, { error: `Unauthorized: ${key} used against ${String(input)}` }),
      ) as unknown as typeof fetch;

      let thrown: unknown;
      try {
        await run();
      } catch (err) {
        thrown = err;
      }
      expect(isHexaError(thrown), `${name} did not raise a HexaError`).toBe(true);
      const dump = `${(thrown as Error).message} ${JSON.stringify((thrown as { details?: unknown }).details ?? {})}`;
      expect(dump).not.toContain(key);
      expect(dump).not.toContain('SECRET');
    });
  }
});

describe('providers refuse person prompts before any request is made', () => {
  it('never calls fetch for a guarded prompt', async () => {
    const spy = vi.fn(async () => jsonResponse(200, {}));
    globalThis.fetch = spy as unknown as typeof fetch;

    const providers = [
      new GoogleProvider({ GOOGLE_API_KEY: 'AIzaSyTEST0123456789abcdef' } as NodeJS.ProcessEnv),
      new OpenAiProvider({ OPENAI_API_KEY: 'sk-TEST0123456789abcdefghij' } as NodeJS.ProcessEnv),
      new StabilityProvider({ STABILITY_API_KEY: 'sk-TEST0123456789abcdefghij' } as NodeJS.ProcessEnv),
      new ReplicateProvider({ REPLICATE_API_TOKEN: 'r8_TEST0123456789abcdefghij' } as NodeJS.ProcessEnv),
    ];

    for (const p of providers) {
      await expect(
        p.generateBackplate({ prompt: 'a portrait of a pro player mid-celebration', width: 64, height: 64 }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports PROVIDER_NOT_CONFIGURED rather than calling out with no key', async () => {
    const spy = vi.fn(async () => jsonResponse(200, {}));
    globalThis.fetch = spy as unknown as typeof fetch;

    const p = new GoogleProvider({} as NodeJS.ProcessEnv);
    await expect(
      p.generateBackplate({ prompt: 'empty arena, no people', width: 64, height: 64 }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(spy).not.toHaveBeenCalled();
  });
});
