/**
 * Routing tests. No network: every provider exercised here is either the
 * offline painter, the stub, or a fake registered for the test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHexaError } from '@hexa/core';
import {
  generateBackplate,
  getProvider,
  identityGuidedEdit,
  listProviders,
  providerStatus,
  registerProvider,
  resetProviders,
  resolveProvider,
  unregisterProvider,
} from '../src/registry.js';
import type { BackplateRequest, GeneratedImage, ImageProvider } from '../src/types.js';
import { stubProvider } from '../src/providers/stub.js';

const KEY_VARS = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'STABILITY_API_KEY',
  'REPLICATE_API_TOKEN',
  'HEXA_AI_PROVIDER',
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  // Hosted providers must look unconfigured so nothing can reach the network.
  for (const v of KEY_VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
  resetProviders();
});

afterEach(() => {
  for (const v of KEY_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  resetProviders();
  vi.restoreAllMocks();
});

function fakeProvider(id: string, over: Partial<ImageProvider> = {}): ImageProvider {
  return {
    id,
    capabilities: {
      backplate: true,
      identityGuidedEdit: false,
      inpaint: false,
      upscale: false,
      maxSize: { width: 4096, height: 4096 },
    },
    isConfigured: () => true,
    generateBackplate: async (req: BackplateRequest): Promise<GeneratedImage> => ({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
      width: req.width,
      height: req.height,
      provider: id,
      model: `${id}/fake`,
      promptUsed: req.prompt,
    }),
    ...over,
  } as ImageProvider;
}

describe('registry', () => {
  it('registers the built-in providers', () => {
    const ids = listProviders().map((p) => p.id).sort();
    expect(ids).toEqual(['anthropic', 'google', 'local', 'openai', 'replicate', 'stability', 'stub']);
  });

  it('looks providers up by id', () => {
    expect(getProvider('local')?.id).toBe('local');
    expect(getProvider('stub')?.id).toBe('stub');
    expect(getProvider('nope')).toBeUndefined();
  });

  it('registers and replaces custom providers', () => {
    registerProvider(fakeProvider('custom'));
    expect(getProvider('custom')?.capabilities.backplate).toBe(true);

    registerProvider(
      fakeProvider('custom', {
        capabilities: {
          backplate: false,
          identityGuidedEdit: false,
          inpaint: false,
          upscale: false,
          maxSize: { width: 1, height: 1 },
        },
      }),
    );
    expect(getProvider('custom')?.capabilities.backplate).toBe(false);
    expect(unregisterProvider('custom')).toBe(true);
    expect(getProvider('custom')).toBeUndefined();
  });

  it('rejects objects that are not providers', () => {
    expect(() => registerProvider({} as ImageProvider)).toThrow(/non-empty string id/i);
    expect(() => registerProvider({ id: 'x' } as ImageProvider)).toThrow(/ImageProvider interface/i);
  });
});

describe('resolveProvider', () => {
  it('defaults to the offline provider with nothing configured', () => {
    expect(resolveProvider().id).toBe('local');
    expect(resolveProvider({ need: 'backplate' }).id).toBe('local');
  });

  it('falls back to local for an unknown preference, without throwing', () => {
    expect(resolveProvider({ prefer: 'does-not-exist' }).id).toBe('local');
  });

  it('falls back to local when the preferred provider has no key', () => {
    expect(resolveProvider({ prefer: 'google' }).id).toBe('local');
    expect(resolveProvider({ prefer: 'openai', need: 'backplate' }).id).toBe('local');
    expect(resolveProvider({ prefer: 'stability' }).id).toBe('local');
    expect(resolveProvider({ prefer: 'replicate' }).id).toBe('local');
  });

  it('falls back to local when the preferred provider cannot do the job', () => {
    // Anthropic is configured-shaped but generates no images.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-value-1234567890';
    expect(resolveProvider({ prefer: 'anthropic', need: 'backplate' }).id).toBe('local');
  });

  it('honours an explicit, usable preference', () => {
    expect(resolveProvider({ prefer: 'stub' }).id).toBe('stub');
    registerProvider(fakeProvider('custom'));
    expect(resolveProvider({ prefer: 'custom' }).id).toBe('custom');
  });

  it('honours HEXA_AI_PROVIDER when no explicit preference is given', () => {
    process.env.HEXA_AI_PROVIDER = 'stub';
    expect(resolveProvider().id).toBe('stub');
  });

  it('never throws, whatever it is asked for', () => {
    for (const need of ['backplate', 'identityGuidedEdit', 'inpaint', 'upscale', 'maxSize'] as const) {
      expect(() => resolveProvider({ need })).not.toThrow();
      expect(() => resolveProvider({ prefer: 'ghost', need })).not.toThrow();
    }
  });

  it('prefers local over a configured hosted provider for work local can do', () => {
    registerProvider(fakeProvider('paid'));
    // No explicit preference: do not silently start billing for a backplate.
    expect(resolveProvider({ need: 'backplate' }).id).toBe('local');
  });

  it('reaches for a capable provider only when local cannot do the job', () => {
    registerProvider(
      fakeProvider('google', {
        capabilities: {
          backplate: true,
          identityGuidedEdit: true,
          inpaint: false,
          upscale: false,
          maxSize: { width: 4096, height: 4096 },
        },
        identityGuidedEdit: async () => ({
          buffer: Buffer.from([1]),
          width: 1,
          height: 1,
          provider: 'google',
          model: 'fake',
          promptUsed: '',
        }),
      }),
    );
    expect(resolveProvider({ need: 'identityGuidedEdit' }).id).toBe('google');
    expect(resolveProvider({ need: 'backplate' }).id).toBe('local');
  });

  it('ignores a capability declared without a method behind it', () => {
    registerProvider(
      fakeProvider('liar', {
        capabilities: {
          backplate: true,
          identityGuidedEdit: true, // claimed…
          inpaint: false,
          upscale: false,
          maxSize: { width: 1024, height: 1024 },
        },
        // …but no identityGuidedEdit implementation.
      }),
    );
    expect(resolveProvider({ need: 'identityGuidedEdit', prefer: 'liar' }).id).toBe('local');
  });
});

describe('generateBackplate routing', () => {
  const base = { width: 64, height: 64, cache: { enabled: false } };

  it('refuses a person-requesting prompt before touching a provider', async () => {
    const spy = vi.spyOn(stubProvider, 'generateBackplate');
    await expect(
      generateBackplate({ ...base, prompt: 'a portrait of a player', provider: 'stub' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('routes to the requested provider', async () => {
    const out = await generateBackplate({ ...base, prompt: 'empty arena, no people', provider: 'stub' });
    expect(out.provider).toBe('stub');
    expect(out.width).toBe(64);
  });

  it('falls back to the offline painter when the provider throws', async () => {
    registerProvider(
      fakeProvider('flaky', {
        generateBackplate: async () => {
          throw new Error('upstream is on fire');
        },
      }),
    );
    const out = await generateBackplate({ ...base, prompt: 'empty arena, no people', provider: 'flaky' });
    expect(out.provider).toBe('local');
  }, 30_000);

  it('does not swallow a guard refusal raised inside a provider', async () => {
    const { HexaError } = await import('@hexa/core');
    registerProvider(
      fakeProvider('picky', {
        generateBackplate: async () => {
          throw new HexaError('INVALID_REQUEST', 'nope');
        },
      }),
    );
    await expect(
      generateBackplate({ ...base, prompt: 'empty arena, no people', provider: 'picky' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('caches by request so a re-render does not re-bill', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hexa-ai-cache-test-'));

    let calls = 0;
    registerProvider(
      fakeProvider('counting', {
        generateBackplate: async (req: BackplateRequest) => {
          calls++;
          return {
            buffer: await stubProvider
              .generateBackplate(req)
              .then((r) => r.buffer),
            width: req.width,
            height: req.height,
            provider: 'counting',
            model: 'counting/fake',
            promptUsed: req.prompt,
          };
        },
      }),
    );

    const req = {
      prompt: 'empty arena, no people',
      width: 64,
      height: 64,
      seed: 1,
      provider: 'counting',
      cache: { dir, enabled: true },
    };
    const first = await generateBackplate({ ...req });
    const second = await generateBackplate({ ...req });
    expect(calls).toBe(1);
    expect(second.buffer.equals(first.buffer)).toBe(true);
    expect(second.provider).toBe('counting');

    // A changed seed is a different image, so it must miss.
    await generateBackplate({ ...req, seed: 2 });
    expect(calls).toBe(2);
  });
});

describe('identityGuidedEdit routing', () => {
  const face = [{ x: 10, y: 10, w: 40, h: 50 }];
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);

  it('applies the identity guard before routing', async () => {
    await expect(
      identityGuidedEdit({ image, prompt: 'relight', strength: 0.9, preserve: face, cache: { enabled: false } }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      identityGuidedEdit({ image, prompt: 'relight', strength: 0.3, cache: { enabled: false } }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('throws rather than silently substituting when no provider can edit', async () => {
    let thrown: unknown;
    try {
      await identityGuidedEdit({
        image,
        prompt: 'cooler background',
        strength: 0.3,
        preserve: face,
        cache: { enabled: false },
      });
    } catch (err) {
      thrown = err;
    }
    expect(isHexaError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe('PROVIDER_NOT_CONFIGURED');
    expect((thrown as { hint?: string }).hint).toMatch(/google|openai|stability|replicate/);
  });

  it('routes to a capable provider when one is configured', async () => {
    let seen: unknown;
    registerProvider(
      fakeProvider('editor', {
        capabilities: {
          backplate: false,
          identityGuidedEdit: true,
          inpaint: false,
          upscale: false,
          maxSize: { width: 4096, height: 4096 },
        },
        identityGuidedEdit: async (req) => {
          seen = req;
          return {
            buffer: Buffer.from([1, 2, 3]),
            width: 100,
            height: 100,
            provider: 'editor',
            model: 'editor/fake',
            promptUsed: req.prompt,
          };
        },
      }),
    );
    const out = await identityGuidedEdit({
      image,
      prompt: 'cooler background',
      strength: 0.5,
      preserve: face,
      provider: 'editor',
      cache: { enabled: false },
    });
    expect(out.provider).toBe('editor');
    // Routing fields must not leak into the provider request.
    expect(seen).not.toHaveProperty('provider');
    expect(seen).not.toHaveProperty('cache');
  });
});

describe('providerStatus', () => {
  it('reports every provider with its configuration state', () => {
    const status = providerStatus();
    expect(status.map((s) => s.id).sort()).toEqual([
      'anthropic',
      'google',
      'local',
      'openai',
      'replicate',
      'stability',
      'stub',
    ]);

    const local = status.find((s) => s.id === 'local')!;
    expect(local.configured).toBe(true);
    expect(local.envVar).toBeUndefined();
    expect(local.note).toMatch(/offline/i);

    const google = status.find((s) => s.id === 'google')!;
    expect(google.configured).toBe(false);
    expect(google.envVar).toBe('GOOGLE_API_KEY');
    expect(google.note).toMatch(/not configured/i);
  });

  it('states plainly that Claude generates no images', () => {
    const anthropic = providerStatus().find((s) => s.id === 'anthropic')!;
    expect(anthropic.capabilities.backplate).toBe(false);
    expect(anthropic.capabilities.identityGuidedEdit).toBe(false);
    expect(anthropic.capabilities.inpaint).toBe(false);
    expect(anthropic.capabilities.upscale).toBe(false);
    expect(anthropic.note).toMatch(/generates no images/i);
  });

  it('flips to configured when the key is present', () => {
    expect(providerStatus().find((s) => s.id === 'openai')!.configured).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test-0123456789abcdefghij';
    expect(providerStatus().find((s) => s.id === 'openai')!.configured).toBe(true);
  });

  it('accepts either Google env var', () => {
    process.env.GEMINI_API_KEY = 'AIzaTestKeyValue0123456789';
    const google = providerStatus().find((s) => s.id === 'google')!;
    expect(google.configured).toBe(true);
    expect(google.envVar).toBe('GEMINI_API_KEY');
  });

  it('does not leak key material', () => {
    process.env.OPENAI_API_KEY = 'sk-test-super-secret-key-value-abcdef';
    const serialised = JSON.stringify(providerStatus());
    expect(serialised).not.toContain('super-secret');
  });

  it('returns a copy of the capabilities, not the live object', () => {
    const status = providerStatus();
    status[0]!.capabilities.backplate = !status[0]!.capabilities.backplate;
    const fresh = providerStatus();
    expect(fresh[0]!.capabilities.backplate).not.toBe(status[0]!.capabilities.backplate);
  });
});
