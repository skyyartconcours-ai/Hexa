/**
 * The Anthropic provider is a prompt architect, not an image generator.
 * These tests pin that down, and pin down the two guard checks around it: the
 * brief is checked before it leaves the process, and the crafted prompt is
 * checked again on the way back, because a language model's output is not
 * trusted input.
 *
 * No network: `fetch` is stubbed throughout.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicPromptArchitect, AnthropicProvider } from '../src/providers/anthropic.js';
import { NEGATIVE_BASE } from '../src/prompt.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const KEY = 'sk-ant-api03-TESTKEYVALUE0123456789';
const env = { ANTHROPIC_API_KEY: KEY } as NodeJS.ProcessEnv;

function messagesResponse(payload: Record<string, unknown>, over: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      ...over,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const GOOD_PAYLOAD = {
  style: 'arena',
  lightDirection: 'right',
  mood: 'tense and electric',
  subjectCount: 2,
  sceneDescription: 'An empty competition stage with a glossy deck and an LED ribbon along the lip.',
  cameraAndLight: 'Shot on a 35mm lens at f/2.0 from chest height, 5600K key through heavy haze.',
  atmosphereAndDepth: 'Foreground: dark stage lip. Mid-ground: the lit deck. Background: seating in shadow.',
  rationale: 'A grand-final stage matches the stakes in the brief.',
};

describe('AnthropicProvider — capability honesty', () => {
  it('reports no image capabilities at all', () => {
    const p = new AnthropicProvider(env);
    expect(p.capabilities.backplate).toBe(false);
    expect(p.capabilities.identityGuidedEdit).toBe(false);
    expect(p.capabilities.inpaint).toBe(false);
    expect(p.capabilities.upscale).toBe(false);
    expect(p.capabilities.maxSize).toEqual({ width: 0, height: 0 });
  });

  it('refuses to generate images and explains why', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const p = new AnthropicProvider(env);
    await expect(
      p.generateBackplate({ prompt: 'empty arena, no people', width: 64, height: 64 }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(
      p.generateBackplate({ prompt: 'empty arena, no people', width: 64, height: 64 }),
    ).rejects.toThrow(/does not generate images/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('still runs the person guard on the refusal path', async () => {
    const p = new AnthropicProvider(env);
    await expect(
      p.generateBackplate({ prompt: 'a portrait of a mid laner', width: 64, height: 64 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('tracks configuration from the environment', () => {
    expect(new AnthropicProvider({} as NodeJS.ProcessEnv).isConfigured()).toBe(false);
    expect(new AnthropicProvider(env).isConfigured()).toBe(true);
  });
});

describe('AnthropicPromptArchitect.craft', () => {
  it('guards the brief before any request leaves the process', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const architect = new AnthropicPromptArchitect(env);
    await expect(architect.craft({ brief: 'make a portrait of the winning player' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('falls back to the deterministic builder with no key configured', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const architect = new AnthropicPromptArchitect({} as NodeJS.ProcessEnv);
    const out = await architect.craft({ brief: 'tense grand final in a dark arena', palette: ['#E2012D'] });
    expect(spy).not.toHaveBeenCalled();
    expect(out.fallback).toBe(true);
    expect(out.model).toBe('local/deterministic');
    expect(out.prompt.toLowerCase()).toContain('no people');
    expect(out.negativePrompt).toBe(NEGATIVE_BASE);
    expect(out.rationale).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('sends a well-formed Messages API request', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return messagesResponse(GOOD_PAYLOAD);
    }) as unknown as typeof fetch;

    const architect = new AnthropicPromptArchitect(env);
    await architect.craft({ brief: 'grand final, dark arena', palette: ['#E2012D', '#1B3FA0'], subjectCount: 2 });

    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(String(captured!.init.body));
    expect(body.model).toBe('claude-opus-5');
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toContain('sceneDescription');
    expect(body.max_tokens).toBeGreaterThan(1000);
    expect(body.system).toMatch(/never describe a person/i);
    expect(body.messages[0].content).toContain('#E2012D');
  });

  it('assembles a usable prompt from a structured response', async () => {
    globalThis.fetch = vi.fn(async () => messagesResponse(GOOD_PAYLOAD)) as unknown as typeof fetch;
    const architect = new AnthropicPromptArchitect(env);
    const out = await architect.craft({ brief: 'grand final, dark arena' });

    expect(out.fallback).toBe(false);
    expect(out.style).toBe('arena');
    expect(out.lightDirection).toBe('right');
    expect(out.subjectCount).toBe(2);
    expect(out.rationale).toContain('grand-final stage');
    expect(out.prompt).toContain('glossy deck');
    expect(out.prompt).toContain('35mm');
    expect(out.prompt.toLowerCase()).toContain('no people');
    expect(out.negativePrompt).toBe(NEGATIVE_BASE);
  });

  it('discards a crafted prompt that drifts into describing a person', async () => {
    globalThis.fetch = vi.fn(async () =>
      messagesResponse({
        ...GOOD_PAYLOAD,
        sceneDescription: 'A determined player stands centre stage, face lit from the left.',
      }),
    ) as unknown as typeof fetch;

    const architect = new AnthropicPromptArchitect(env);
    const out = await architect.craft({ brief: 'grand final, dark arena' });
    expect(out.fallback).toBe(true);
    expect(out.rationale).toMatch(/failed the person guard/i);
    expect(out.prompt).not.toContain('determined player');
    expect(out.prompt.toLowerCase()).toContain('no people');
  });

  it('falls back when Claude declines the brief', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const architect = new AnthropicPromptArchitect(env);
    const out = await architect.craft({ brief: 'moody server hall backplate' });
    expect(out.fallback).toBe(true);
    expect(out.rationale).toMatch(/declined/i);
    expect(out.prompt.length).toBeGreaterThan(100);
  });

  it('falls back when the API errors, without leaking the key', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: `bad key ${KEY}` }), { status: 401 }),
    ) as unknown as typeof fetch;

    const architect = new AnthropicPromptArchitect(env);
    const out = await architect.craft({ brief: 'neon street backplate' });
    expect(out.fallback).toBe(true);
    expect(out.rationale).not.toContain(KEY);
    expect(out.rationale).not.toContain('TESTKEYVALUE');
    expect(out.style).toBe('neon-city');
  });

  it('falls back when the response is empty or unparseable', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ content: [], stop_reason: 'end_turn' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const architect = new AnthropicPromptArchitect(env);
    expect((await architect.craft({ brief: 'smoke plate' })).fallback).toBe(true);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'not json' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    expect((await architect.craft({ brief: 'smoke plate' })).fallback).toBe(true);
  });

  it('sanitises an out-of-range style or light direction from the model', async () => {
    globalThis.fetch = vi.fn(async () =>
      messagesResponse({ ...GOOD_PAYLOAD, style: 'made-up', lightDirection: 'sideways', subjectCount: 99 }),
    ) as unknown as typeof fetch;

    const architect = new AnthropicPromptArchitect(env);
    const out = await architect.craft({ brief: 'grand final', style: 'smoke', lightDirection: 'top' });
    expect(out.style).toBe('smoke');
    expect(out.lightDirection).toBe('top');
    expect(out.subjectCount).toBeLessThanOrEqual(8);
  });
});
