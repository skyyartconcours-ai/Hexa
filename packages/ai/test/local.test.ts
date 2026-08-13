/**
 * The offline provider is the default, so these assertions are about it being
 * *good*, not merely present: correct dimensions, real tonal range (a blank or
 * flat plate would pass a "returns a PNG" test and fail a designer), distinct
 * output per style and per palette, and byte-identical repeats for a seed.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { LocalProvider, inferStyle } from '../src/providers/local.js';
import { BACKPLATE_STYLES } from '../src/types.js';
import { buildBackplatePrompt } from '../src/prompt.js';

const provider = new LocalProvider();
const PALETTE = ['#E2012D', '#1B3FA0', '#FFC629'];

const SIZES: Array<[number, number]> = [
  [640, 360],
  [512, 512],
  [1280, 720],
  [720, 1280],
];

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

describe('LocalProvider — availability', () => {
  it('is always configured: no key, no network', () => {
    expect(provider.isConfigured()).toBe(true);
    expect(provider.capabilities.backplate).toBe(true);
  });

  it('reports its capabilities honestly', () => {
    // Procedural painting cannot follow an edit instruction, and must never be
    // routed one.
    expect(provider.capabilities.identityGuidedEdit).toBe(false);
    expect(provider.capabilities.inpaint).toBe(false);
    expect(provider.capabilities.upscale).toBe(true);
    expect(provider.identityGuidedEdit).toBeUndefined();
    expect(typeof provider.upscale).toBe('function');
  });
});

describe('LocalProvider — produces a real image at several sizes', () => {
  for (const [width, height] of SIZES) {
    it(`renders ${width}x${height} as a valid, non-blank PNG`, async () => {
      const { prompt } = buildBackplatePrompt({ style: 'arena', palette: PALETTE });
      const out = await provider.generateBackplate({ prompt, width, height, seed: 42, palette: PALETTE });

      expect(isPng(out.buffer)).toBe(true);
      expect(out.width).toBe(width);
      expect(out.height).toBe(height);
      expect(out.provider).toBe('local');
      expect(out.cost).toBe(0);

      const meta = await sharp(out.buffer).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(width);
      expect(meta.height).toBe(height);

      const stats = await sharp(out.buffer).stats();
      // A blank or flat plate would have near-zero deviation on every channel.
      for (const channel of stats.channels.slice(0, 3)) {
        expect(channel.stdev).toBeGreaterThan(0);
      }
      const maxStdev = Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev));
      expect(maxStdev, 'plate is too flat to read as an image').toBeGreaterThan(8);
    }, 30_000);
  }
});

describe('LocalProvider — every style paints something distinct', () => {
  it('renders all twelve styles with real tonal range and distinct output', async () => {
    const digests = new Set<string>();
    for (const style of BACKPLATE_STYLES) {
      const { prompt } = buildBackplatePrompt({ style, palette: PALETTE });
      const out = await provider.generateBackplate({
        prompt,
        style,
        width: 480,
        height: 270,
        seed: 7,
        palette: PALETTE,
      });
      expect(isPng(out.buffer), `${style} did not produce a PNG`).toBe(true);
      expect(out.model).toBe(`procedural/${style}`);

      const stats = await sharp(out.buffer).stats();
      const maxStdev = Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev));
      expect(maxStdev, `${style} is flat`).toBeGreaterThan(6);

      // Not a black frame and not a white one: real plates use the middle.
      const mean = stats.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
      expect(mean, `${style} is crushed to black`).toBeGreaterThan(4);
      expect(mean, `${style} is blown out`).toBeLessThan(230);

      digests.add(out.buffer.toString('base64').slice(0, 512));
    }
    expect(digests.size, 'styles are painting the same picture').toBe(BACKPLATE_STYLES.length);
  }, 120_000);
});

describe('LocalProvider — determinism', () => {
  it('paints byte-identical output for the same seed', async () => {
    const req = { prompt: 'empty arena, no people', width: 480, height: 270, seed: 1234, palette: PALETTE };
    const a = await provider.generateBackplate({ ...req });
    const b = await provider.generateBackplate({ ...req });
    expect(a.buffer.equals(b.buffer)).toBe(true);
    expect(a.seed).toBe(1234);
    expect(b.seed).toBe(1234);
  }, 30_000);

  it('paints different output for a different seed', async () => {
    const req = { prompt: 'empty arena, no people', width: 480, height: 270, palette: PALETTE };
    const a = await provider.generateBackplate({ ...req, seed: 1 });
    const b = await provider.generateBackplate({ ...req, seed: 2 });
    expect(a.buffer.equals(b.buffer)).toBe(false);
  }, 30_000);

  it('derives a stable seed from the prompt when none is given', async () => {
    const req = { prompt: 'a smoke plate for the final, no people', width: 320, height: 180 };
    const a = await provider.generateBackplate({ ...req });
    const b = await provider.generateBackplate({ ...req });
    expect(a.seed).toBe(b.seed);
    expect(a.buffer.equals(b.buffer)).toBe(true);
  }, 30_000);

  it('paints different output for a different palette', async () => {
    const req = { prompt: 'empty arena, no people', width: 480, height: 270, seed: 9 };
    const a = await provider.generateBackplate({ ...req, palette: ['#E2012D', '#1B3FA0'] });
    const b = await provider.generateBackplate({ ...req, palette: ['#00C853', '#7B1FA2'] });
    expect(a.buffer.equals(b.buffer)).toBe(false);
  }, 30_000);
});

describe('LocalProvider — the guard applies offline too', () => {
  it('refuses a person-requesting prompt even with no network involved', async () => {
    // The provider itself does not guard — routing does — but the registry
    // entry point must, and the offline path is the one users hit by default.
    const { generateBackplate } = await import('../src/registry.js');
    await expect(
      generateBackplate({
        prompt: 'a portrait of a player on the arena stage',
        width: 320,
        height: 180,
        provider: 'local',
        cache: { enabled: false },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('LocalProvider — input validation', () => {
  it('rejects unrenderable sizes', async () => {
    await expect(
      provider.generateBackplate({ prompt: 'void plate', width: 4, height: 300 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      provider.generateBackplate({ prompt: 'void plate', width: Number.NaN, height: 300 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('clamps enormous requests rather than exploding', async () => {
    const out = await provider.generateBackplate({ prompt: 'void plate', width: 99_999, height: 32, seed: 3 });
    expect(out.width).toBe(8192);
    expect(out.height).toBe(32);
  }, 60_000);
});

describe('LocalProvider — upscale', () => {
  it('enlarges by the requested factor', async () => {
    const src = await provider.generateBackplate({ prompt: 'void plate', width: 160, height: 90, seed: 5 });
    const up = await provider.upscale({ image: src.buffer, factor: 2 });
    expect(up.width).toBe(320);
    expect(up.height).toBe(180);
    const meta = await sharp(up.buffer).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(180);
    expect(up.model).toBe('lanczos3-x2');
  }, 30_000);

  it('rejects an empty buffer', async () => {
    await expect(provider.upscale({ image: Buffer.alloc(0), factor: 2 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe('inferStyle', () => {
  it('honours an explicit style', () => {
    expect(inferStyle('anything at all', 'smoke')).toBe('smoke');
  });

  it('routes on prompt keywords', () => {
    expect(inferStyle('empty esports arena stage under the truss')).toBe('arena');
    expect(inferStyle('packed stadium bowl, bokeh crowd')).toBe('stadium-crowd');
    expect(inferStyle('rain-soaked neon city street')).toBe('neon-city');
    expect(inferStyle('collapsed ancient temple, rubble')).toBe('ruins');
    expect(inferStyle('deep cosmic void with a nebula')).toBe('void');
    expect(inferStyle('mountain valley at sunset')).toBe('nature');
    expect(inferStyle('clean seamless studio backdrop')).toBe('studio');
    expect(inferStyle('plasma lightning burst')).toBe('energy');
    expect(inferStyle('shattered tempered glass shards')).toBe('shattered-glass');
  });

  it('falls back to abstract', () => {
    expect(inferStyle('something entirely unclassifiable')).toBe('abstract');
  });

  it('ignores an invalid explicit style', () => {
    expect(inferStyle('rain-soaked neon city street', 'nonsense')).toBe('neon-city');
  });
});
