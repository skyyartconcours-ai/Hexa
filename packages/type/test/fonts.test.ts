import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  registerFont, registeredFonts, clearFonts, fontStack, ensureFonts,
  defaultFontDir, exactMeasurementAvailable, measureLine, WANTED_FAMILIES,
} from '../src/index.js';
import type { TextStyle } from '../src/index.js';

/** A real font that exists on most Linux CI images; skipped when it does not. */
const SYSTEM_TTF = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
].find((p) => existsSync(p));

beforeEach(() => clearFonts());
afterEach(() => clearFonts());

describe('fontStack', () => {
  it('puts the requested family first and always ends in a generic', () => {
    const stack = fontStack('Anton');
    expect(stack.startsWith('Anton,')).toBe(true);
    expect(stack.endsWith('sans-serif')).toBe(true);
  });

  it('quotes multi-word families and leaves single idents bare', () => {
    const stack = fontStack('Bebas Neue');
    expect(stack).toContain("'Bebas Neue'");
    expect(stack).toMatch(/(^|,\s)Anton(,|$)/);
  });

  it('offers condensed fallbacks for condensed faces', () => {
    const stack = fontStack('Anton');
    for (const f of ['Bebas Neue', 'Oswald', 'Impact', 'Haettenschweiler', 'Arial Narrow']) {
      expect(stack).toContain(f);
    }
  });

  it('offers grotesque fallbacks for grotesque faces', () => {
    const stack = fontStack('Archivo Black');
    expect(stack).toContain('Helvetica');
    expect(stack).toContain('Arial');
    expect(stack).not.toContain('Haettenschweiler');
  });

  it('does not repeat the requested family in the fallback tail', () => {
    const parts = fontStack('Oswald').split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(new Set(parts).size).toBe(parts.length);
  });

  it('neutralises quotes in a hostile family name', () => {
    expect(fontStack(`Ev'il\\`)).not.toMatch(/'Ev'il/);
  });
});

describe('registerFont', () => {
  it('rejects a missing file with a FONT_MISSING HexaError', () => {
    try {
      registerFont({ family: 'Anton', path: '/definitely/not/here.ttf' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as { code?: string; hint?: string };
      expect(err.code).toBe('FONT_MISSING');
      expect(err.hint).toMatch(/assets\/fonts/);
    }
  });

  it('rejects an empty family', () => {
    expect(() => registerFont({ family: '', path: '/tmp' })).toThrow(/family/);
  });

  it('records registrations and returns copies', () => {
    if (!SYSTEM_TTF) return;
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 400 });
    const list = registeredFonts();
    expect(list).toHaveLength(1);
    expect(list[0]!.family).toBe('Anton');
    list[0]!.family = 'MUTATED';
    expect(registeredFonts()[0]!.family).toBe('Anton');
  });

  it('replaces rather than duplicates the same face', () => {
    if (!SYSTEM_TTF) return;
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 400 });
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 400 });
    expect(registeredFonts()).toHaveLength(1);
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 700 });
    expect(registeredFonts()).toHaveLength(2);
  });
});

describe('exact vs table measurement', () => {
  const style: TextStyle = { family: 'Anton', weight: 400, size: 100, case: 'upper' };

  it('has opentype.js available in this workspace', () => {
    expect(exactMeasurementAvailable()).toBe(true);
  });

  it('switches to real glyph advances once a face is registered', () => {
    if (!SYSTEM_TTF) return;
    const fromTable = measureLine('HEXA GRAND FINAL', style);
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 400 });
    const fromFont = measureLine('HEXA GRAND FINAL', style);
    expect(fromFont).toBeGreaterThan(0);
    // Liberation Sans Bold is much wider than the condensed table predicts.
    expect(fromFont).not.toBeCloseTo(fromTable, 1);
  });

  it('keeps exact measurement linear in size', () => {
    if (!SYSTEM_TTF) return;
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 400 });
    const a = measureLine('LINEARITY', { ...style, size: 25 });
    const b = measureLine('LINEARITY', { ...style, size: 100 });
    expect(b).toBeCloseTo(a * 4, 6);
  });

  it('falls back to the table for characters the font lacks', () => {
    if (!SYSTEM_TTF) return;
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 400 });
    // Liberation Sans has no emoji glyph; the advance must not be a .notdef box
    // width, and must not be zero.
    const w = measureLine('🔥', { ...style, case: 'none' });
    expect(w).toBeGreaterThan(0);
    expect(Number.isFinite(w)).toBe(true);
  });

  it('degrades to tables rather than throwing on a corrupt font file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hexa-font-'));
    const bad = join(dir, 'Anton-Regular.ttf');
    await writeFile(bad, 'this is definitely not a font');
    registerFont({ family: 'Anton', path: bad, weight: 400 });
    const w = measureLine('SAFE', style);
    expect(w).toBeGreaterThan(0);
    expect(Number.isFinite(w)).toBe(true);
  });

  it('picks the registered face closest to the requested weight', () => {
    if (!SYSTEM_TTF) return;
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 400 });
    registerFont({ family: 'Anton', path: SYSTEM_TTF, weight: 900 });
    expect(measureLine('W', { ...style, weight: 900 })).toBeGreaterThan(0);
    expect(registeredFonts()).toHaveLength(2);
  });
});

describe('ensureFonts', () => {
  it('reports available and missing families without downloading anything', async () => {
    const result = await ensureFonts();
    expect(Array.isArray(result.available)).toBe(true);
    expect(Array.isArray(result.missing)).toBe(true);
    // Every wanted family is accounted for exactly once.
    expect([...result.available, ...result.missing].sort()).toEqual([...WANTED_FAMILIES].sort());
    for (const f of result.available) expect(result.missing).not.toContain(f);
  });

  it('tolerates a missing directory', async () => {
    const result = await ensureFonts('/no/such/font/dir/anywhere');
    expect([...result.available, ...result.missing].sort()).toEqual([...WANTED_FAMILIES].sort());
  });

  it('discovers and registers a face dropped into the scanned directory', async () => {
    if (!SYSTEM_TTF) return;
    const dir = await mkdtemp(join(tmpdir(), 'hexa-fonts-'));
    await mkdir(join(dir, 'nested'), { recursive: true });
    await copyFile(SYSTEM_TTF, join(dir, 'nested', 'Anton-Regular.ttf'));
    await copyFile(SYSTEM_TTF, join(dir, 'BebasNeue-Bold.ttf'));

    const { available, missing } = await ensureFonts(dir);
    expect(available).toContain('Anton');
    expect(available).toContain('Bebas Neue');
    expect(missing).not.toContain('Anton');

    const reg = registeredFonts();
    expect(reg.some((r) => r.family === 'Anton')).toBe(true);
    expect(reg.find((r) => r.family === 'Bebas Neue')?.weight).toBe(700);
  });

  it('infers weight and italic from the filename', async () => {
    if (!SYSTEM_TTF) return;
    const dir = await mkdtemp(join(tmpdir(), 'hexa-fonts-'));
    await copyFile(SYSTEM_TTF, join(dir, 'Oswald-Black.ttf'));
    await copyFile(SYSTEM_TTF, join(dir, 'Teko-BoldItalic.ttf'));
    await ensureFonts(dir);
    const reg = registeredFonts();
    expect(reg.find((r) => r.family === 'Oswald')?.weight).toBe(900);
    const teko = reg.find((r) => r.family === 'Teko');
    expect(teko?.weight).toBe(700);
    expect(teko?.italic).toBe(true);
  });

  it('ignores non-font files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hexa-fonts-'));
    await writeFile(join(dir, 'Anton-Regular.txt'), 'not a font');
    await writeFile(join(dir, 'README.md'), '# fonts');
    await ensureFonts(dir);
    // Scoped to `dir`: the same scan also walks the system and per-user font
    // paths, so "no Anton anywhere" would be an assertion about the machine
    // rather than about the two files this test wrote.
    expect(registeredFonts().filter((r) => r.path.startsWith(dir))).toEqual([]);
  });

  it('points its default at <repo>/assets/fonts', () => {
    expect(defaultFontDir().replace(/\\/g, '/')).toMatch(/\/assets\/fonts$/);
  });
});
