/**
 * Bounds are only bounds if they hold for the inputs an attacker would pick,
 * so every case here is a real payload from the threat model rather than a
 * round number: the canvas that OOMs, the variant count that never terminates,
 * the string that XML cannot represent.
 */

import { describe, expect, it } from 'vitest';
import { isHexaError } from './errors.js';
import {
  MAX_CANVAS_EDGE,
  MAX_CANVAS_PIXELS,
  assertCanvasWithinBudget,
  clampInt,
  requireInt,
  sanitiseXmlText,
} from './limits.js';

/** Assert `fn` throws a HexaError with `code`, and hand back the error. */
function expectHexa(fn: () => unknown, code: string): Error & { code: string } {
  try {
    fn();
  } catch (err) {
    expect(isHexaError(err)).toBe(true);
    expect(isHexaError(err) && err.code).toBe(code);
    return err as Error & { code: string };
  }
  throw new Error(`expected a HexaError(${code})`);
}

describe('assertCanvasWithinBudget — resource exhaustion', () => {
  it('accepts the canvases the product actually renders', () => {
    expect(() => assertCanvasWithinBudget(1280, 720)).not.toThrow();
    expect(() => assertCanvasWithinBudget(1920, 1080, 2)).not.toThrow();
    expect(() => assertCanvasWithinBudget(3840, 2160)).not.toThrow();
  });

  it('refuses a 100000×100000 canvas instead of attempting a 40 TB allocation', () => {
    const err = expectHexa(() => assertCanvasWithinBudget(100_000, 100_000), 'INVALID_REQUEST');
    expect(err.message).toMatch(/exceeds|too large/i);
  });

  it('refuses an edge past the rasteriser ceiling even when the area is modest', () => {
    expectHexa(() => assertCanvasWithinBudget(MAX_CANVAS_EDGE + 1, 8), 'INVALID_REQUEST');
  });

  it('counts supersampling toward the budget — 4096² at 4× is a gigabyte', () => {
    expect(() => assertCanvasWithinBudget(4096, 4096, 1)).not.toThrow();
    expectHexa(() => assertCanvasWithinBudget(4096, 4096, 4), 'INVALID_REQUEST');
  });

  it('clamps an absurd supersample rather than letting it multiply the area', () => {
    // supersample: 64 must not be taken at face value; the effective factor is
    // capped, so a small canvas still passes and a large one still fails.
    expect(() => assertCanvasWithinBudget(640, 360, 64)).not.toThrow();
  });

  it('rejects zero, negative, NaN and Infinity dimensions', () => {
    for (const [w, h] of [[0, 100], [-1, 100], [Number.NaN, 100], [100, Number.POSITIVE_INFINITY]] as const) {
      expectHexa(() => assertCanvasWithinBudget(w, h), 'INVALID_REQUEST');
    }
  });

  it('names the field so the caller knows which canvas was refused', () => {
    const err = expectHexa(() => assertCanvasWithinBudget(1e6, 1e6, 1, 'plan.canvas'), 'INVALID_REQUEST');
    expect(err.message).toContain('plan.canvas');
  });

  it('the documented pixel ceiling is the one enforced', () => {
    const edge = Math.floor(Math.sqrt(MAX_CANVAS_PIXELS));
    expect(() => assertCanvasWithinBudget(edge, edge)).not.toThrow();
    expectHexa(() => assertCanvasWithinBudget(edge + 64, edge + 64), 'INVALID_REQUEST');
  });
});

describe('requireInt', () => {
  it('accepts an in-range integer', () => {
    expect(requireInt(4, 'variants', 1, 24)).toBe(4);
  });

  it('rejects variants: 100000', () => {
    const err = expectHexa(() => requireInt(100_000, 'variants', 1, 24), 'INVALID_REQUEST');
    expect(err.message).toContain('variants');
  });

  it('rejects NaN, Infinity, fractions and numeric strings', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, '4', null, undefined, {}]) {
      expectHexa(() => requireInt(bad, 'variants', 1, 24), 'INVALID_REQUEST');
    }
  });

  it('truncates an over-long string in the error rather than echoing it whole', () => {
    const err = expectHexa(() => requireInt('x'.repeat(100_000), 'variants', 1, 24), 'INVALID_REQUEST');
    expect(err.message.length).toBeLessThan(200);
  });
});

describe('clampInt', () => {
  it('clamps out-of-range values into the window', () => {
    expect(clampInt(100_000, 1, 8, 1)).toBe(8);
    expect(clampInt(-5, 1, 8, 1)).toBe(1);
  });

  it('falls back for anything unparseable — NaN must never survive as a count', () => {
    for (const bad of [Number.NaN, 'abc', null, undefined, {}, [], Number.POSITIVE_INFINITY]) {
      expect(clampInt(bad, 1, 8, 3)).toBe(3);
    }
  });

  it('accepts numeric strings, because HTTP bodies and CLI flags carry them', () => {
    expect(clampInt('4', 1, 8, 1)).toBe(4);
  });
});

describe('sanitiseXmlText — characters that break the rasteriser, not the escaper', () => {
  it('removes C0 controls XML 1.0 forbids but keeps tab, LF and CR', () => {
    expect(sanitiseXmlText('a\0bcd')).toBe('abcd');
    expect(sanitiseXmlText('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('removes the BMP noncharacters U+FFFE and U+FFFF', () => {
    expect(sanitiseXmlText('a￾b￿c')).toBe('abc');
  });

  it('replaces a lone surrogate with U+FFFD instead of emitting unencodable bytes', () => {
    expect(sanitiseXmlText('a\uD800b')).toBe('a�b');
    expect(sanitiseXmlText('a\uDC00b')).toBe('a�b');
  });

  it('leaves well-formed astral characters alone — emoji and ZWJ sequences are legal XML', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(sanitiseXmlText(family)).toBe(family);
    expect(sanitiseXmlText('한국어 テスト')).toBe('한국어 テスト');
  });

  it('leaves combining marks and RTL overrides alone — they are legal, if hostile to layout', () => {
    const rtl = 'A‮bcd‭';
    expect(sanitiseXmlText(rtl)).toBe(rtl);
    const bomb = `e${'́'.repeat(500)}`;
    expect(sanitiseXmlText(bomb)).toBe(bomb);
  });

  it('does not escape markup — that is the serialiser’s job, and doing both double-escapes', () => {
    expect(sanitiseXmlText('</text><script>alert(1)</script>')).toBe('</text><script>alert(1)</script>');
    expect(sanitiseXmlText('&amp; ]]>')).toBe('&amp; ]]>');
  });

  it('coerces non-strings without throwing', () => {
    expect(sanitiseXmlText(null)).toBe('');
    expect(sanitiseXmlText(undefined)).toBe('');
    expect(sanitiseXmlText(42)).toBe('42');
  });
});
