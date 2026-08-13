/**
 * The other half of the guard's job.
 *
 * A person guard that refuses everything is trivially safe and completely
 * useless: the operator's next move is `--provider local` or a fork with the
 * check removed, and then there is no guard at all. So the tightening in
 * `guard.ts` — body parts, worn clothing, camera address, Latin-script-only,
 * narrowed negation — is pinned here against the prompts a working designer
 * actually writes, including every prompt this package generates for itself.
 */

import { describe, expect, it } from 'vitest';
import { assertNegativePromptSafe, assertNoPersonGeneration } from '../src/guard.js';
import { buildBackplatePrompt, COMPOSITION_RULES, NEGATIVE_BASE, describeStyle } from '../src/prompt.js';
import { BACKPLATE_STYLES } from '../src/types.js';

describe('legitimate backplate briefs are not refused', () => {
  const good = [
    // Photographic craft vocabulary that collides with body words.
    'Empty arena stage shot from chest height, 35mm at f/2.0, haze in every beam.',
    'Studio cyclorama on an 85mm lens from eye level, one soft key, two gelled accents.',
    'Cool fill on the right-hand side, warm key raking from frame left.',
    'A whisper of haze to give the accent lights body.',
    'Long lens compression at the foot of the ridge, layered valley mist.',
    'Uniform soft light across the sweep, no hot spots.',
    'Lens cap vignetting avoided; clean corners.',
    'A bird\'s eye view of the empty stage deck.',
    // Scene vocabulary that sounds human-adjacent but is not.
    'Stadium bowl at night, the crowd rendered entirely as circular bokeh, empty turf.',
    'Silhouetted conifers at the frame edges, mist gathered in the folds of the land.',
    'Dark rubble silhouettes in the foreground, a swept clear floor in the light.',
    'A shadow thrown long across the deck by the truss.',
    'Hairline fractures spreading through the tempered glass plane.',
    // Ordinary negation, the way people write it.
    'An empty esports arena, no people, no faces, no characters.',
    'Deep void with a luminous core, no ground plane and no horizon.',
    'Neon street canyon, empty of people, wet asphalt, magenta and cyan signage.',
    'Server hall interior, without any people or faces, cold volumetric fog.',
    // The CLI\'s own example.
    'an empty arena',
  ];

  for (const prompt of good) {
    it(`accepts: ${prompt.slice(0, 52)}…`, () => {
      expect(() => assertNoPersonGeneration(prompt)).not.toThrow();
    });
  }
});

describe('everything this package generates passes its own guard', () => {
  it('accepts every style/light/subject-count combination, with and without extras', () => {
    for (const style of BACKPLATE_STYLES) {
      for (const light of ['left', 'right', 'back', 'top'] as const) {
        for (const subjectCount of [0, 1, 2, 5]) {
          const { prompt, negativePrompt } = buildBackplatePrompt({
            style,
            lightDirection: light,
            subjectCount,
            palette: ['#E2012D', '#1B3FA0', '#FFC629'],
            mood: 'tense, confrontational',
            extra: 'push the haze density up and keep the deck reflective',
          });
          expect(() => assertNoPersonGeneration(prompt), `${style}/${light}/${subjectCount}`).not.toThrow();
          expect(() => assertNegativePromptSafe(negativePrompt), `${style} negative`).not.toThrow();
        }
      }
    }
  });

  it('accepts every recipe fragment on its own', () => {
    for (const style of BACKPLATE_STYLES) {
      const recipe = describeStyle(style);
      for (const [part, text] of Object.entries(recipe)) {
        expect(() => assertNoPersonGeneration(text), `${style}.${part}`).not.toThrow();
      }
    }
  });

  it('accepts the shared composition rules and the shipped exclusion list', () => {
    expect(() => assertNoPersonGeneration(COMPOSITION_RULES)).not.toThrow();
    expect(() => assertNegativePromptSafe(NEGATIVE_BASE)).not.toThrow();
  });

  it('accepts every light-rig mood the pipeline passes through', () => {
    // Copied from packages/pipeline/src/adapters/ai.ts RIG_MOODS — these reach
    // buildBackplatePrompt as `mood`, which is now vetted.
    const moods = [
      'tense, confrontational',
      'ominous, high-stakes',
      'menacing',
      'epic, silhouetting',
      'triumphant, arena spotlights',
      'electric, cyberpunk',
      'monumental, volumetric',
      'smouldering, aftermath',
      'neutral, product-clean',
    ];
    for (const mood of moods) {
      expect(() => buildBackplatePrompt({ style: 'arena', mood }), mood).not.toThrow();
    }
  });
});
