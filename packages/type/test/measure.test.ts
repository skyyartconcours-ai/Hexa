import { describe, it, expect, beforeEach } from 'vitest';
import {
  measureText, measureLine, wrapText, applyCase, clearFonts, classifyFamily, FAMILY_METRICS,
} from '../src/index.js';
import type { TextStyle } from '../src/index.js';

const CONDENSED: TextStyle = { family: 'Anton', weight: 400, size: 100, case: 'upper' };
const GROTESQUE: TextStyle = { family: 'Archivo Black', weight: 900, size: 100, case: 'upper' };

beforeEach(() => {
  // Measurement must be judged on the tables, not on whatever the CI box has
  // installed — otherwise these assertions drift between machines.
  clearFonts();
});

describe('family classification', () => {
  it('routes display faces to the right metric table', () => {
    expect(classifyFamily('Anton')).toBe('condensed');
    expect(classifyFamily('Bebas Neue')).toBe('condensed');
    expect(classifyFamily('Arial Narrow')).toBe('condensed');
    expect(classifyFamily('Impact')).toBe('condensed');
    expect(classifyFamily('Archivo Black')).toBe('grotesque');
    expect(classifyFamily('Inter')).toBe('grotesque');
    expect(classifyFamily('Wingdings Deluxe')).toBe('fallback');
  });

  it('condensed faces really are narrower than grotesques', () => {
    const a = measureLine('GRAND FINAL', { ...CONDENSED });
    const b = measureLine('GRAND FINAL', { ...GROTESQUE });
    expect(a).toBeLessThan(b * 0.85);
  });

  it('holds the ~1.0 width-to-cap-height aspect the tables claim', () => {
    const m = FAMILY_METRICS.condensed;
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const avg = [...upper].reduce((s, c) => s + (m.advance[c] ?? 0), 0) / upper.length;
    expect(avg / m.capHeight).toBeGreaterThan(0.68);
    expect(avg / m.capHeight).toBeLessThan(0.82);
  });
});

describe('measureText', () => {
  it('scales linearly with size', () => {
    const text = 'HEXA GRAND FINAL 2026';
    const base = measureText(text, { ...CONDENSED, size: 10 });
    for (const size of [1, 7, 20, 50, 100, 333.5]) {
      const m = measureText(text, { ...CONDENSED, size });
      expect(m.width).toBeCloseTo((base.width * size) / 10, 6);
      expect(m.height).toBeCloseTo((base.height * size) / 10, 6);
    }
  });

  it('scales linearly with tracking held in em', () => {
    const a = measureLine('ABCDEF', { ...CONDENSED, size: 50, tracking: 0.1 });
    const b = measureLine('ABCDEF', { ...CONDENSED, size: 100, tracking: 0.1 });
    expect(b).toBeCloseTo(a * 2, 6);
  });

  it('applies tracking to interior gaps only', () => {
    const plain = measureLine('AAAA', { ...CONDENSED, tracking: 0 });
    const tracked = measureLine('AAAA', { ...CONDENSED, tracking: 0.1 });
    // 4 glyphs → 3 gaps → 3 * 0.1em * 100px
    expect(tracked - plain).toBeCloseTo(30, 6);
  });

  it('measures multi-line text as a block', () => {
    const one = measureText('ALPHA', CONDENSED);
    const two = measureText('ALPHA\nBRAVO CHARLIE', CONDENSED);
    expect(two.height).toBeGreaterThan(one.height);
    expect(two.width).toBeGreaterThan(one.width);
  });

  it('returns zero width for empty and whitespace-only text', () => {
    expect(measureLine('', CONDENSED)).toBe(0);
    expect(measureLine('    ', CONDENSED)).toBe(0);
  });

  it('handles emoji, CJK and combining marks without NaN', () => {
    for (const s of ['🔥🔥 GG', '决赛 FINAL', 'équipe', 'ÉQUIPE', '😀']) {
      const m = measureText(s, { ...CONDENSED, case: 'none' });
      expect(Number.isFinite(m.width)).toBe(true);
      expect(Number.isFinite(m.height)).toBe(true);
      expect(m.width).toBeGreaterThan(0);
    }
  });

  it('measures accented Latin close to its unaccented base', () => {
    const plain = measureLine('EQUIPE', { ...CONDENSED, case: 'none' });
    const accented = measureLine('ÉQUIPE', { ...CONDENSED, case: 'none' });
    expect(accented).toBeCloseTo(plain, 3);
  });

  it('makes heavier weights wider', () => {
    const light = measureLine('HEAVY', { ...GROTESQUE, weight: 400 });
    const black = measureLine('HEAVY', { ...GROTESQUE, weight: 900 });
    expect(black).toBeGreaterThan(light);
  });

  it('rejects a non-positive size', () => {
    expect(() => measureLine('X', { ...CONDENSED, size: 0 })).toThrow(/positive/);
    expect(() => measureLine('X', { ...CONDENSED, size: -5 })).toThrow(/positive/);
  });
});

describe('applyCase', () => {
  it('handles every mode', () => {
    expect(applyCase('grand final', 'upper')).toBe('GRAND FINAL');
    expect(applyCase('GRAND FINAL', 'lower')).toBe('grand final');
    expect(applyCase('grand FINAL', 'title')).toBe('Grand Final');
    expect(applyCase('gRaNd', 'none')).toBe('gRaNd');
    expect(applyCase('gRaNd', undefined)).toBe('gRaNd');
  });

  it('title-cases across punctuation without eating it', () => {
    expect(applyCase("o'brien vs. m-dot", 'title')).toBe("O'brien Vs. M-Dot");
  });
});

describe('wrapText', () => {
  const style: TextStyle = { family: 'Anton', size: 40, case: 'upper' };

  it('breaks on words to respect maxWidth', () => {
    const lines = wrapText('THE GRAND FINAL OF THE WINTER SPLIT', style, 300);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureLine(l, { ...style, case: 'none' })).toBeLessThanOrEqual(300.001);
  });

  it('honours explicit newlines', () => {
    const lines = wrapText('ALPHA\nBRAVO', style, 10_000);
    expect(lines).toEqual(['ALPHA', 'BRAVO']);
  });

  it('respects maxLines and adds an ellipsis when truncating', () => {
    const lines = wrapText('THE GRAND FINAL OF THE WINTER SPLIT CHAMPIONSHIP SERIES', style, 300, 2);
    expect(lines.length).toBe(2);
    expect(lines[lines.length - 1]).toMatch(/…$/);
    for (const l of lines) expect(measureLine(l, { ...style, case: 'none' })).toBeLessThanOrEqual(300.001);
  });

  it('does not add an ellipsis when nothing was dropped', () => {
    const lines = wrapText('ALPHA BRAVO', style, 10_000, 3);
    expect(lines).toEqual(['ALPHA BRAVO']);
    expect(lines.join('')).not.toContain('…');
  });

  it('hard-breaks a single word that cannot fit', () => {
    const lines = wrapText('SUPERCALIFRAGILISTICEXPIALIDOCIOUS', style, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureLine(l, { ...style, case: 'none' })).toBeLessThanOrEqual(200.001);
  });

  it('still returns exactly maxLines when a single word overflows everything', () => {
    const lines = wrapText('SUPERCALIFRAGILISTICEXPIALIDOCIOUS', style, 120, 1);
    expect(lines.length).toBe(1);
    expect(measureLine(lines[0]!, { ...style, case: 'none' })).toBeLessThanOrEqual(120.001);
  });

  it('never returns an empty array', () => {
    expect(wrapText('', style, 100).length).toBe(1);
    expect(wrapText('   ', style, 100).length).toBe(1);
  });

  it('applies case exactly once (title case is not idempotent)', () => {
    const lines = wrapText('grand final', { ...style, case: 'title' }, 10_000);
    expect(lines).toEqual(['Grand Final']);
  });

  it('terminates on a pathological maxWidth', () => {
    const lines = wrapText('ABCDEFGHIJ', style, 0.0001);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(100);
  });
});
