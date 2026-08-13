import { describe, expect, it } from 'vitest';
import { isHexaError } from '@hexa/core';
import type { ThumbnailRequest } from '@hexa/core';
import { MAX_SUBJECTS, MAX_VARIANTS, derivedSeed, validateRequest } from './validate.js';

function baseRequest(over: Partial<ThumbnailRequest> = {}): ThumbnailRequest {
  return {
    templateId: 'versus-classic',
    subjects: [{ player: 'Peyz' }, { player: 'Viper' }],
    text: { headline: 'RIVALS' },
    output: { dir: './out' },
    ...over,
  };
}

/** Assert a HexaError with the given code, and hand it back for more checks. */
function expectInvalid(fn: () => unknown, field?: string) {
  try {
    fn();
  } catch (e) {
    if (!isHexaError(e)) throw new Error(`expected HexaError, got ${String(e)}`);
    expect(e.code).toBe('INVALID_REQUEST');
    expect(e.hint, 'every validation error must tell the user what to do').toBeTruthy();
    if (field) expect(e.details?.['field']).toBe(field);
    return e;
  }
  throw new Error('expected validateRequest to throw');
}

describe('validateRequest', () => {
  it('applies defaults without touching what the caller specified', () => {
    const out = validateRequest(baseRequest());
    expect(out.aspect).toBe('youtube');
    expect(out.variants).toBe(1);
    expect(out.output.format).toBe('png');
    expect(out.output.quality).toBe(100);
    expect(out.output.name).toBe('thumbnail');
    expect(out.qa.legibility).toBe(true);
    expect(out.qa.strict).toBe(false);
    expect(out.text).toEqual({ headline: 'RIVALS' });
  });

  it('defaults two subjects to left and right', () => {
    const out = validateRequest(baseRequest());
    expect(out.subjects.map((s) => s.side)).toEqual(['left', 'right']);
  });

  it('defaults a single subject to centre', () => {
    const out = validateRequest(baseRequest({ subjects: [{ player: 'Faker' }] }));
    expect(out.subjects[0]?.side).toBe('center');
  });

  it('splits a lineup down the middle', () => {
    const out = validateRequest(
      baseRequest({ subjects: ['a', 'b', 'c', 'd'].map((player) => ({ player })) }),
    );
    expect(out.subjects.map((s) => s.side)).toEqual(['left', 'left', 'right', 'right']);
  });

  it('keeps an explicit side', () => {
    const out = validateRequest(baseRequest({ subjects: [{ player: 'Peyz', side: 'right' }, { player: 'Viper', side: 'left' }] }));
    expect(out.subjects.map((s) => s.side)).toEqual(['right', 'left']);
  });

  it('defaults jpeg quality below lossless', () => {
    const out = validateRequest(baseRequest({ output: { dir: './out', format: 'jpeg' } }));
    expect(out.output.quality).toBe(92);
  });

  it('trims text and drops empty roles', () => {
    const out = validateRequest(baseRequest({ text: { headline: '  RIVALS  ', subhead: '   ' } }));
    expect(out.text).toEqual({ headline: 'RIVALS' });
  });

  describe('rejects', () => {
    it('a missing template', () => {
      expectInvalid(() => validateRequest(baseRequest({ templateId: '' })), 'templateId');
    });

    it('no subjects', () => {
      expectInvalid(() => validateRequest(baseRequest({ subjects: [] })), 'subjects');
    });

    it('too many subjects', () => {
      const subjects = Array.from({ length: MAX_SUBJECTS + 1 }, (_, i) => ({ player: `p${i}` }));
      expectInvalid(() => validateRequest(baseRequest({ subjects })), 'subjects');
    });

    it('a subject with no player', () => {
      expectInvalid(() => validateRequest(baseRequest({ subjects: [{ player: '' }] })), 'subjects[0].player');
    });

    it('an unknown side', () => {
      expectInvalid(
        () => validateRequest(baseRequest({ subjects: [{ player: 'Peyz', side: 'middle' as never }] })),
        'subjects[0].side',
      );
    });

    it('a non-hex accent', () => {
      expectInvalid(() => validateRequest(baseRequest({ subjects: [{ player: 'Peyz', accent: 'red' }] })), 'subjects[0].accent');
    });

    it('an unknown aspect', () => {
      expectInvalid(() => validateRequest(baseRequest({ aspect: 'imax' as never })), 'aspect');
    });

    it('an unknown text role', () => {
      expectInvalid(() => validateRequest(baseRequest({ text: { tagline: 'x' } as never })), 'text.tagline');
    });

    it('a missing output directory', () => {
      expectInvalid(() => validateRequest(baseRequest({ output: { dir: '' } })), 'output.dir');
    });

    it('an output name containing a path separator', () => {
      expectInvalid(() => validateRequest(baseRequest({ output: { dir: './out', name: 'sub/dir' } })), 'output.name');
    });

    it('an out-of-range quality', () => {
      expectInvalid(() => validateRequest(baseRequest({ output: { dir: './out', quality: 0 } })), 'output.quality');
    });

    it('zero or fractional variants', () => {
      expectInvalid(() => validateRequest(baseRequest({ variants: 0 })), 'variants');
      expectInvalid(() => validateRequest(baseRequest({ variants: 2.5 })), 'variants');
    });

    it('more variants than the cap', () => {
      expectInvalid(() => validateRequest(baseRequest({ variants: MAX_VARIANTS + 1 })), 'variants');
    });

    it('an identity threshold outside 0–1', () => {
      expectInvalid(() => validateRequest(baseRequest({ qa: { identityThreshold: 1.5 } })), 'qa.identityThreshold');
    });

    it('background mode "file" with no path', () => {
      expectInvalid(() => validateRequest(baseRequest({ background: { mode: 'file' } })), 'background.path');
    });

    it('background mode "color" with no colour', () => {
      expectInvalid(() => validateRequest(baseRequest({ background: { mode: 'color' } })), 'background.color');
    });

    it('a non-hex palette override', () => {
      expectInvalid(() => validateRequest(baseRequest({ palette: { accent: 'gold' } })), 'palette.accent');
    });
  });

  it('accepts background mode "ai" with no prompt — @hexa/ai derives one', () => {
    const out = validateRequest(baseRequest({ background: { mode: 'ai' } }));
    expect(out.background?.mode).toBe('ai');
  });
});

describe('derivedSeed', () => {
  it('makes an unseeded request reproducible', () => {
    const a = validateRequest(baseRequest());
    const b = validateRequest(baseRequest());
    expect(a.seed).toBe(b.seed);
    expect(Number.isInteger(a.seed)).toBe(true);
  });

  it('changes when the matchup changes', () => {
    const a = validateRequest(baseRequest());
    const b = validateRequest(baseRequest({ subjects: [{ player: 'Faker' }, { player: 'Chovy' }] }));
    expect(a.seed).not.toBe(b.seed);
  });

  it('changes when the sides swap', () => {
    const a = derivedSeed('t', [{ player: 'Peyz', side: 'left' }, { player: 'Viper', side: 'right' }], {});
    const b = derivedSeed('t', [{ player: 'Peyz', side: 'right' }, { player: 'Viper', side: 'left' }], {});
    expect(a).not.toBe(b);
  });

  it('changes when the copy changes', () => {
    const a = derivedSeed('t', [{ player: 'Peyz' }], { headline: 'RIVALS' });
    const b = derivedSeed('t', [{ player: 'Peyz' }], { headline: 'REMATCH' });
    expect(a).not.toBe(b);
  });

  it('ignores where the output is written', () => {
    const a = validateRequest(baseRequest({ output: { dir: './out' } }));
    const b = validateRequest(baseRequest({ output: { dir: '/tmp/elsewhere', quality: 80, format: 'webp' } }));
    expect(a.seed).toBe(b.seed);
  });

  it('is overridden by an explicit seed', () => {
    expect(validateRequest(baseRequest({ seed: 4242 })).seed).toBe(4242);
  });
});
