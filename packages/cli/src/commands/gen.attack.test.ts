/**
 * Flag parsing under hostile input.
 *
 * A CLI flag is untrusted in the same way an HTTP body is — it arrives from a
 * script, a CI job, a copy-pasted command — and the two failure modes that
 * matter are different from a web body's. `Number.parseInt` never throws: it
 * returns `NaN` for garbage and stops at the first non-digit for `"4e9"`, so
 * the naive parse *silently does something other than what was typed*. Both
 * outcomes travel several packages before anything allocates against them, by
 * which point the error can no longer name the flag that caused it.
 */

import { describe, expect, it } from 'vitest';
import { isHexaError } from '@hexa/core';
import { parseCount, parseFloatArg, parseGrade, parseKeyValues } from './gen.js';

function expectInvalid(fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    expect(isHexaError(err) && err.code).toBe('INVALID_REQUEST');
    return;
  }
  throw new Error('expected a HexaError(INVALID_REQUEST)');
}

describe('parseCount', () => {
  it('accepts the counts a person actually types', () => {
    expect(parseCount('4')).toBe(4);
    expect(parseCount('1')).toBe(1);
    expect(parseCount('0')).toBe(0);
    expect(parseCount(' 12 ')).toBe(12);
  });

  it('rejects a negative count instead of passing it downstream', () => {
    expectInvalid(() => parseCount('-5'));
  });

  it('rejects an absurd count at the flag, where the error can name it', () => {
    expectInvalid(() => parseCount('100000'));
    expectInvalid(() => parseCount('999999999'));
  });

  it('rejects garbage rather than returning NaN', () => {
    for (const bad of ['', 'abc', 'NaN', 'Infinity', '  ', '0x10']) {
      expectInvalid(() => parseCount(bad));
    }
  });

  it('rejects a value it would otherwise silently truncate', () => {
    // `Number.parseInt` reads all three of these as 4 — which is not what the
    // caller wrote, and is worse than an error because nobody finds out.
    for (const sneaky of ['4abc', '4e9', '4.9', '4 5']) {
      expectInvalid(() => parseCount(sneaky));
    }
  });
});

describe('parseFloatArg', () => {
  it('accepts a threshold', () => {
    expect(parseFloatArg('0.45')).toBeCloseTo(0.45);
  });

  it('rejects non-finite input', () => {
    for (const bad of ['', 'abc', 'Infinity', 'NaN']) {
      expectInvalid(() => parseFloatArg(bad));
    }
  });
});

describe('parseKeyValues — text roles from the command line', () => {
  it('splits on the first `=` so a value may contain more of them', () => {
    expect(parseKeyValues(['stat=18/2/9', 'caption=a=b=c'])).toEqual({ stat: '18/2/9', caption: 'a=b=c' });
  });

  it('rejects a pair with no key rather than creating an empty role', () => {
    expectInvalid(() => parseKeyValues(['=value']));
    expectInvalid(() => parseKeyValues(['novalue']));
  });

  it('keeps markup in a value verbatim — escaping is the serialiser’s job', () => {
    // The CLI must not half-escape: doing it here as well as in @hexa/type
    // would double-escape and put `&amp;lt;` on the thumbnail.
    const out = parseKeyValues(['headline=</text><script>alert(1)</script>']);
    expect(out['headline']).toBe('</text><script>alert(1)</script>');
  });

  it('does not let a crafted key reach Object.prototype', () => {
    const out = parseKeyValues(['__proto__=polluted', 'constructor=polluted']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(out).toBeTruthy();
  });
});

describe('parseGrade', () => {
  it('reads numbers as numbers and names as strings', () => {
    expect(parseGrade(['saturation=1.2', 'lut=teal-orange'])).toEqual({ saturation: 1.2, lut: 'teal-orange' });
  });

  it('keeps a hex colour a string rather than parsing it as a number', () => {
    expect(parseGrade(['shadowTint=#0a1030'])).toEqual({ shadowTint: '#0a1030' });
  });

  it('does not pollute the prototype through a crafted grade key', () => {
    parseGrade(['__proto__=polluted']);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
