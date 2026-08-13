import { describe, expect, it } from 'vitest';
import {
  buildBackplatePrompt,
  describeColour,
  describeStyle,
  COMPOSITION_RULES,
  NEGATIVE_BASE,
} from '../src/prompt.js';
import { BACKPLATE_STYLES } from '../src/types.js';

const NO_PEOPLE_TERMS = ['people', 'faces', 'characters', 'empty scene'];
const NEGATIVE_MUST_INCLUDE = [
  'people',
  'person',
  'human',
  'face',
  'faces',
  'portrait',
  'headshot',
  'character',
  'text',
  'watermark',
  'logo',
  'signature',
];

describe('NEGATIVE_BASE', () => {
  for (const term of NEGATIVE_MUST_INCLUDE) {
    it(`always suppresses "${term}"`, () => {
      expect(NEGATIVE_BASE.toLowerCase()).toContain(term);
    });
  }
});

describe('COMPOSITION_RULES', () => {
  it('states the no-people rule and the negative-space contract', () => {
    const rules = COMPOSITION_RULES.toLowerCase();
    expect(rules).toContain('no people');
    expect(rules).toContain('no faces');
    expect(rules).toContain('no characters');
    expect(rules).toContain('empty scene');
    expect(rules).toContain('negative space in the centre-left and centre-right');
    expect(rules).toContain('subject placement');
  });
});

describe('buildBackplatePrompt', () => {
  it('always includes the no-people negatives in the positive prompt', () => {
    for (const style of BACKPLATE_STYLES) {
      const { prompt } = buildBackplatePrompt({ style });
      const lower = prompt.toLowerCase();
      for (const term of NO_PEOPLE_TERMS) {
        expect(lower, `${style} is missing "${term}"`).toContain(term);
      }
      expect(lower).toContain('negative space in the centre-left and centre-right');
    }
  });

  it('always returns the shared negative prompt', () => {
    for (const style of BACKPLATE_STYLES) {
      expect(buildBackplatePrompt({ style }).negativePrompt).toBe(NEGATIVE_BASE);
    }
  });

  it('specifies lens, aperture, lighting, atmosphere, depth and colour temperature', () => {
    for (const style of BACKPLATE_STYLES) {
      const { prompt } = buildBackplatePrompt({ style });
      const lower = prompt.toLowerCase();
      expect(lower, `${style} has no focal length`).toMatch(/\d+mm|macro|telephoto/);
      expect(lower, `${style} has no aperture`).toMatch(/f\/\d/);
      expect(lower, `${style} has no colour temperature`).toMatch(/\d{4,5}k/);
      expect(lower, `${style} has no key light`).toMatch(/key light|backlight|top light|key\b/);
      expect(lower, `${style} has no depth cues`).toContain('foreground');
      expect(lower, `${style} has no depth cues`).toContain('background');
    }
  });

  it('varies the light direction phrasing', () => {
    const left = buildBackplatePrompt({ style: 'arena', lightDirection: 'left' }).prompt;
    const right = buildBackplatePrompt({ style: 'arena', lightDirection: 'right' }).prompt;
    const back = buildBackplatePrompt({ style: 'arena', lightDirection: 'back' }).prompt;
    const top = buildBackplatePrompt({ style: 'arena', lightDirection: 'top' }).prompt;
    expect(left).toContain('frame left');
    expect(right).toContain('frame right');
    expect(back).toContain('backlight');
    expect(top).toContain('overhead rig');
    expect(new Set([left, right, back, top]).size).toBe(4);
  });

  it('adapts the negative-space instruction to the subject count', () => {
    expect(buildBackplatePrompt({ style: 'arena', subjectCount: 1 }).prompt).toContain('centre-right third');
    const two = buildBackplatePrompt({ style: 'arena', subjectCount: 2 }).prompt;
    expect(two).toContain('centre-left third');
    expect(two).toContain('two cut-out subjects');
    expect(buildBackplatePrompt({ style: 'arena', subjectCount: 5 }).prompt).toContain('5 cut-out subjects');
  });

  it('names the palette colours instead of pasting hex codes', () => {
    const { prompt } = buildBackplatePrompt({ style: 'arena', palette: ['#E2012D', '#1B3FA0'] });
    expect(prompt).toMatch(/red|crimson|vermilion/);
    expect(prompt).toMatch(/blue|azure|indigo/);
    expect(prompt).not.toContain('#E2012D');
  });

  it('falls back to a described palette when none is supplied', () => {
    expect(buildBackplatePrompt({ style: 'void' }).prompt).toContain('two-colour palette');
  });

  it('appends the caller extra and the mood', () => {
    const { prompt } = buildBackplatePrompt({
      style: 'cyber',
      mood: 'ominous and quiet',
      extra: 'include a single red emergency beacon',
    });
    expect(prompt).toContain('ominous and quiet');
    expect(prompt).toContain('single red emergency beacon');
  });

  it('produces a distinct prompt per style', () => {
    const prompts = BACKPLATE_STYLES.map((style) => buildBackplatePrompt({ style }).prompt);
    expect(new Set(prompts).size).toBe(BACKPLATE_STYLES.length);
  });

  it('is deterministic', () => {
    const input = { style: 'neon-city' as const, palette: ['#00E5FF'], mood: 'electric' };
    expect(buildBackplatePrompt(input).prompt).toBe(buildBackplatePrompt(input).prompt);
  });

  it('falls back to a known style when handed an unknown one', () => {
    const { prompt } = buildBackplatePrompt({ style: 'not-a-style' as never });
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt.toLowerCase()).toContain('no people');
  });
});

describe('describeColour', () => {
  it('names hues in plain language', () => {
    expect(describeColour('#E2012D')).toMatch(/red|crimson|vermilion/);
    expect(describeColour('#1B3FA0')).toMatch(/blue|azure|indigo/);
    expect(describeColour('#00C853')).toContain('green');
    expect(describeColour('#FFC629')).toMatch(/amber|yellow|orange/);
  });

  it('handles greys and extremes', () => {
    expect(describeColour('#000000')).toBe('near-black');
    expect(describeColour('#FFFFFF')).toBe('paper white');
    expect(describeColour('#808080')).toBe('neutral grey');
  });

  it('degrades gracefully on an invalid hex', () => {
    expect(describeColour('not-a-colour')).toBe('neutral grey');
  });
});

describe('describeStyle', () => {
  it('returns a copy of the recipe for every style', () => {
    for (const style of BACKPLATE_STYLES) {
      const recipe = describeStyle(style);
      expect(recipe.scene.length).toBeGreaterThan(40);
      expect(recipe.optics).toMatch(/\d+mm|macro|telephoto/);
      expect(recipe.colourTemp).toMatch(/\d{4,5}K/);
    }
  });

  it('does not leak the internal recipe object', () => {
    const a = describeStyle('arena');
    a.scene = 'mutated';
    expect(describeStyle('arena').scene).not.toBe('mutated');
  });
});
