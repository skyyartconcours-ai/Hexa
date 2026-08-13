import { describe, expect, it, afterEach } from 'vitest';
import { isHexaError } from '@hexa/core';
import {
  assertNoPersonGeneration,
  checkPersonGeneration,
  clearProtectedNames,
  guardIdentityEdit,
  MAX_IDENTITY_EDIT_STRENGTH,
  registerProtectedNames,
} from '../src/guard.js';
import { BACKPLATE_STYLES } from '../src/types.js';
import { buildBackplatePrompt } from '../src/prompt.js';

function expectRefusal(prompt: string): void {
  let thrown: unknown;
  try {
    assertNoPersonGeneration(prompt);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `expected a refusal for: ${prompt}`).toBeDefined();
  expect(isHexaError(thrown)).toBe(true);
  expect((thrown as { code: string }).code).toBe('INVALID_REQUEST');
}

afterEach(() => clearProtectedNames());

describe('assertNoPersonGeneration — accepts legitimate backplate prompts', () => {
  const good = [
    'An empty esports arena stage, heavy haze, moving heads on the truss, no people, no faces.',
    'Wet neon street canyon at dusk, 35mm at f/1.8, magenta and cyan signage, empty scene.',
    'Abstract energy field, plasma arcs radiating from an off-centre core, deep black background.',
    'Stadium bowl at night shot on a 135mm telephoto, the crowd rendered entirely as circular bokeh.',
    'Ruined stone hall, dust in the light shafts, collapsed columns, no characters.',
    'Seamless studio cyclorama, one soft key from the left, two gelled accents, clean air.',
    'Deep void with a luminous core and a faint starfield, no ground plane.',
    'Mountain valley at golden hour, layered mist, silhouetted conifers at the edges.',
    'Tempered glass mid-shatter, prismatic dispersion on the shard edges, dark gradient behind.',
    'Dense volumetric smoke rolling through a dark space, ember light from below.',
    // "looks like" without a name is ordinary scene description, not a likeness request.
    'A sky that looks like a thunderstorm rolling in over the ridgeline.',
    'Server hall interior, cold fog, cyan emissive seams, one amber warning strip.',
  ];

  for (const prompt of good) {
    it(`accepts: ${prompt.slice(0, 56)}…`, () => {
      expect(() => assertNoPersonGeneration(prompt)).not.toThrow();
      expect(checkPersonGeneration(prompt).ok).toBe(true);
    });
  }

  it('accepts every prompt this package generates, for every style and light direction', () => {
    for (const style of BACKPLATE_STYLES) {
      for (const light of ['left', 'right', 'back', 'top'] as const) {
        for (const subjectCount of [1, 2, 5]) {
          const { prompt } = buildBackplatePrompt({
            style,
            lightDirection: light,
            subjectCount,
            palette: ['#E2012D', '#1B3FA0', '#FFC629'],
            mood: 'tense and high-stakes',
          });
          expect(
            () => assertNoPersonGeneration(prompt),
            `${style}/${light}/${subjectCount} tripped its own guard`,
          ).not.toThrow();
        }
      }
    }
  });
});

describe('assertNoPersonGeneration — refuses person requests', () => {
  const refusals: Array<[string, string]> = [
    ['plain noun', 'A person standing on the arena stage'],
    ['plural', 'Two people facing each other in a neon street'],
    ['man', 'A man in a jersey on a dark stage'],
    ['woman', 'A woman lit from the left against a smoke wall'],
    ['portrait of', 'Portrait of a mid laner, dramatic lighting'],
    ['headshot', 'Studio headshot with a coloured rim light'],
    ['face', 'A giant face emerging from the smoke'],
    ['facial features', 'Close crop on the facial features, dramatic key'],
    ['esports player', 'An esports player mid-celebration on stage'],
    ['gamer', 'A gamer at a desk surrounded by RGB'],
    ['character', 'A character in armour standing in the ruins'],
    ['avatar', 'An avatar of a jungler rendered in 3D'],
    ['celebrity', 'A celebrity walking through a stadium tunnel'],
    ['someone', 'Someone silhouetted against the LED wall'],
    ['cosplay', 'Cosplay of a champion in the arena'],
    ['selfie', 'A selfie in front of the trophy'],
    ['human', 'A human figure walking into the light'],
    ['warrior', 'A warrior standing amid the rubble'],
  ];

  for (const [label, prompt] of refusals) {
    it(`refuses (${label}): ${prompt.slice(0, 44)}…`, () => expectRefusal(prompt));
  }
});

describe('assertNoPersonGeneration — refuses evasions', () => {
  const evasions: Array<[string, string]> = [
    ['letter spacing', 'a p o r t r a i t of the mid laner'],
    ['punctuation splitting', 'a p.o.r.t.r.a.i.t against a dark stage'],
    ['hyphen splitting', 'p-e-r-s-o-n standing in the arena haze'],
    ['leetspeak face', 'a glowing f4ce in the smoke'],
    ['leetspeak man', 'a m4n lit from behind on the stage'],
    ['leetspeak person', 'a p3rs0n against the LED wall'],
    ['oblique likeness', 'a man who looks like Peyz, arena background'],
    ['style-of likeness', "arena backplate in the style of Peyz's face"],
    ['someone who looks like', 'someone who looks like Faker on the stage'],
    ['resembling a name', 'a figure resembling Zeus under the truss'],
    ['negation cancelled by except', 'no people except one man on the stage'],
    ['negation cancelled by but', 'no faces, but a portrait in the corner'],
    ['modelled after', 'a mascot modelled after Chovy in the arena'],
    ['deepfake', 'deepfake of the winning captain, stadium background'],
    ['possessive likeness', "the arena, and Deft's likeness on the big screen"],
    ['accented spelling', 'a pérson standing in the light shafts'],
  ];

  for (const [label, prompt] of evasions) {
    it(`refuses (${label}): ${prompt.slice(0, 44)}…`, () => expectRefusal(prompt));
  }

  it('refuses a registered roster name even in an otherwise clean prompt', () => {
    expect(() => assertNoPersonGeneration('An empty arena themed around Peyz, no people')).not.toThrow();
    registerProtectedNames(['Peyz', 'Faker']);
    expectRefusal('An empty arena themed around Peyz, no people');
    expectRefusal('stadium plate for faker night');
  });

  it('refuses an empty prompt', () => expectRefusal(''));
});

describe('guardIdentityEdit', () => {
  const image = Buffer.from('not-really-a-png-but-non-empty');
  const face = [{ x: 100, y: 80, w: 220, h: 260 }];

  it('accepts a well-formed edit', () => {
    expect(() =>
      guardIdentityEdit({ image, prompt: 'relight from the left, cooler background', strength: 0.4, preserve: face }),
    ).not.toThrow();
  });

  it('accepts exactly the maximum strength', () => {
    expect(() =>
      guardIdentityEdit({ image, prompt: 'warm the rim light', strength: MAX_IDENTITY_EDIT_STRENGTH, preserve: face }),
    ).not.toThrow();
  });

  it('accepts a prompt that talks about preserving the face', () => {
    expect(() =>
      guardIdentityEdit({
        image,
        prompt: 'keep the face unchanged, restyle the background into a smoke plate',
        strength: 0.3,
        preserve: face,
      }),
    ).not.toThrow();
  });

  it('requires an image', () => {
    expect(() => guardIdentityEdit({ image: Buffer.alloc(0), prompt: 'x', strength: 0.3, preserve: face })).toThrow(
      /source image/i,
    );
  });

  it('requires preserve regions to be present', () => {
    expect(() => guardIdentityEdit({ image, prompt: 'relight', strength: 0.3 })).toThrow(/preserve/i);
  });

  it('requires preserve regions to be non-empty', () => {
    expect(() => guardIdentityEdit({ image, prompt: 'relight', strength: 0.3, preserve: [] })).toThrow(/preserve/i);
  });

  it('rejects degenerate preserve regions', () => {
    expect(() =>
      guardIdentityEdit({ image, prompt: 'relight', strength: 0.3, preserve: [{ x: 10, y: 10, w: 0, h: 50 }] }),
    ).toThrow(/zero or negative area/i);
    expect(() =>
      guardIdentityEdit({ image, prompt: 'relight', strength: 0.3, preserve: [{ x: -5, y: 10, w: 40, h: 50 }] }),
    ).toThrow(/negative origin/i);
    expect(() =>
      guardIdentityEdit({
        image,
        prompt: 'relight',
        strength: 0.3,
        preserve: [{ x: 1, y: 2, w: Number.NaN, h: 4 }],
      }),
    ).toThrow(/numeric/i);
  });

  it('rejects strength above the ceiling', () => {
    expect(() => guardIdentityEdit({ image, prompt: 'relight', strength: 0.66, preserve: face })).toThrow(
      /exceeds the maximum/i,
    );
    expect(() => guardIdentityEdit({ image, prompt: 'relight', strength: 1, preserve: face })).toThrow(
      /exceeds the maximum/i,
    );
  });

  it('rejects a zero, negative or non-numeric strength', () => {
    expect(() => guardIdentityEdit({ image, prompt: 'relight', strength: 0, preserve: face })).toThrow(
      /greater than 0/i,
    );
    expect(() => guardIdentityEdit({ image, prompt: 'relight', strength: -0.2, preserve: face })).toThrow(
      /greater than 0/i,
    );
    expect(() =>
      guardIdentityEdit({ image, prompt: 'relight', strength: Number.NaN, preserve: face }),
    ).toThrow(/numeric/i);
  });

  it('still refuses an edit prompt that asks for a different person', () => {
    expect(() =>
      guardIdentityEdit({ image, prompt: 'replace with a portrait of another player', strength: 0.3, preserve: face }),
    ).toThrow(/INVALID_REQUEST|person|face/i);
  });

  it('carries the HexaError code so the CLI can map it to an exit status', () => {
    try {
      guardIdentityEdit({ image, prompt: 'relight', strength: 0.9, preserve: face });
      throw new Error('should have thrown');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      expect((err as { code: string }).code).toBe('INVALID_REQUEST');
    }
  });
});
