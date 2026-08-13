import { describe, it, expect, beforeEach } from 'vitest';
import {
  PRESETS, preset, renderText, autoFit, legibilityScore, legibilityScoreForText,
  backgroundLuminanceOf, clearFonts, MIN_CAP_RATIO, MIN_CONTRAST, MAX_HEADLINE_CHARS,
} from '../src/index.js';
import type { TextStyle, PixelRect } from '../src/index.js';
import { assertWellFormed, idsIn, refsIn } from './helpers.js';

const REQUIRED = [
  'headline-heavy', 'headline-condensed', 'kicker', 'player-name', 'team-tag',
  'vs-mark', 'stat-value', 'stat-label', 'rank-number', 'caption', 'date-badge',
  'drama-scream',
];

const BOX: PixelRect = { x: 0, y: 0, w: 1100, h: 400 };

beforeEach(() => clearFonts());

describe('PRESETS', () => {
  it('includes every required style', () => {
    for (const name of REQUIRED) expect(Object.keys(PRESETS)).toContain(name);
  });

  it('gives every preset a complete, sane TextStyle', () => {
    for (const [name, style] of Object.entries(PRESETS)) {
      expect(typeof style.family, name).toBe('string');
      expect(style.family.length, name).toBeGreaterThan(0);
      expect(style.size, name).toBeGreaterThan(0);
      expect(style.lineHeight ?? 1, name).toBeGreaterThan(0.5);
      if (style.stroke) expect(style.stroke.width, name).toBeGreaterThan(0);
      if (style.extrude) expect(style.extrude.depth, name).toBeGreaterThan(0);
      if (style.glow) expect(style.glow.radius, name).toBeGreaterThan(0);
      if (style.opacity !== undefined) expect(style.opacity, name).toBeGreaterThan(0);
    }
  });

  it('renders every preset without throwing, into well-formed SVG', () => {
    for (const name of Object.keys(PRESETS)) {
      const r = renderText({
        block: { text: 'Grand Final 2026 — Game 5', style: preset(name), align: 'center' },
        box: BOX,
        anchor: 'center',
      });
      assertWellFormed(r.markup, name);
      expect(r.markup.length, name).toBeGreaterThan(80);
      expect(r.lines.length, name).toBeGreaterThan(0);
      const defined = new Set(idsIn(r.markup));
      for (const ref of refsIn(r.markup)) expect(defined.has(ref), `${name} → #${ref}`).toBe(true);
    }
  });

  it('autoFits every preset without overflowing', () => {
    for (const name of Object.keys(PRESETS)) {
      const r = autoFit({ block: { text: 'CLUTCH CITY', style: preset(name) }, box: BOX, maxLines: 2 });
      expect(r.width, name).toBeLessThanOrEqual(BOX.w + 0.01);
      expect(r.height, name).toBeLessThanOrEqual(BOX.h + 0.01);
    }
  });

  it('handles hostile text in every preset', () => {
    for (const name of Object.keys(PRESETS)) {
      const r = renderText({
        block: { text: `<b>&"' 🔥</b>`, style: preset(name) },
        box: BOX,
      });
      assertWellFormed(r.markup, name);
      expect(r.markup, name).not.toContain('<b>');
    }
  });
});

describe('preset()', () => {
  it('applies overrides', () => {
    const s = preset('headline-heavy', { size: 42, case: 'lower' });
    expect(s.size).toBe(42);
    expect(s.case).toBe('lower');
    expect(s.family).toBe(PRESETS['headline-heavy']!.family);
  });

  it('returns a deep copy so callers cannot poison the shared table', () => {
    const original = PRESETS['headline-condensed']!.stroke!.width;
    const a = preset('headline-condensed');
    a.stroke!.width = 999;
    a.size = 1;
    expect(PRESETS['headline-condensed']!.stroke!.width).toBe(original);
    expect(preset('headline-condensed').stroke!.width).toBe(original);
  });

  it('does not alias nested objects between two calls', () => {
    const a = preset('drama-scream');
    const b = preset('drama-scream');
    expect(a.extrude).not.toBe(b.extrude);
    a.extrude!.depth = 1;
    expect(b.extrude!.depth).not.toBe(1);
  });

  it('throws a helpful HexaError for an unknown name', () => {
    expect(() => preset('headline-heavey')).toThrow(/Unknown text preset/);
    try {
      preset('headline-heavey');
    } catch (e) {
      const err = e as { code?: string; hint?: string };
      expect(err.code).toBe('INVALID_REQUEST');
      expect(err.hint).toMatch(/headline-heavy/);
    }
  });
});

describe('legibilityScore', () => {
  const big: TextStyle = {
    family: 'Anton', weight: 400, size: 120, case: 'upper',
    fill: { kind: 'solid', color: '#FFFFFF' },
    stroke: { width: 8, color: '#0A0A0F', join: 'round' },
  };
  const slot: PixelRect = { x: 0, y: 0, w: 900, h: 160 };

  it('passes a well-designed headline on a dark background', () => {
    const { score, issues } = legibilityScore(big, slot, 720, backgroundLuminanceOf('#101018'));
    expect(score).toBeGreaterThanOrEqual(80);
    expect(issues).toEqual([]);
  });

  it('flags text too small to survive a 210×118 render', () => {
    const tiny = { ...big, size: 18 }; // cap ≈ 13px = 1.8% of 720
    const { score, issues } = legibilityScore(tiny, slot, 720, backgroundLuminanceOf('#101018'));
    expect(score).toBeLessThan(70);
    expect(issues.join('\n')).toMatch(/[Cc]ap height/);
    expect(issues.join('\n')).toMatch(/210×118/);
  });

  it('scales the cap-height rule with canvas height, not absolute px', () => {
    const style = { ...big, size: 40 };
    const at720 = legibilityScore(style, slot, 720, 0.02);
    const at2160 = legibilityScore(style, slot, 2160, 0.02);
    // Same 40px on a 4K canvas is proportionally three times smaller.
    expect(at2160.score).toBeLessThan(at720.score);
    expect(at2160.issues.join()).toMatch(/[Cc]ap height/);
    expect(MIN_CAP_RATIO).toBeCloseTo(0.035, 5);
  });

  it('flags low contrast with no stroke or plate', () => {
    const grey: TextStyle = {
      ...big, stroke: undefined, fill: { kind: 'solid', color: '#8A8A8A' },
    };
    const { score, issues } = legibilityScore(grey, slot, 720, backgroundLuminanceOf('#7A7A7A'));
    expect(score).toBeLessThan(75);
    const joined = issues.join('\n');
    expect(joined).toMatch(/[Cc]ontrast/);
    expect(joined).toMatch(new RegExp(String(MIN_CONTRAST)));
    expect(joined).toMatch(/stroke|plate/);
  });

  it('forgives low contrast when a stroke is carrying it', () => {
    const grey: TextStyle = { ...big, fill: { kind: 'solid', color: '#8A8A8A' } };
    const withStroke = legibilityScore(grey, slot, 720, backgroundLuminanceOf('#7A7A7A'));
    const without = legibilityScore({ ...grey, stroke: undefined }, slot, 720, backgroundLuminanceOf('#7A7A7A'));
    expect(withStroke.score).toBeGreaterThan(without.score);
  });

  it('checks a plated style against its own plate, not the background', () => {
    const plated: TextStyle = {
      ...big, stroke: undefined,
      fill: { kind: 'solid', color: '#FFFFFF' },
      plate: { color: '#FEFEFE', padX: 10, padY: 6 },
    };
    const { issues } = legibilityScore(plated, slot, 720, backgroundLuminanceOf('#000000'));
    expect(issues.join('\n')).toMatch(/plate/);
  });

  it('penalises thin weights at small sizes', () => {
    const base: TextStyle = { ...big, size: 40, weight: 900 };
    const thin: TextStyle = { ...base, weight: 300 };
    const heavy = legibilityScore(base, slot, 720, 0.02);
    const light = legibilityScore(thin, slot, 720, 0.02);
    expect(light.score).toBeLessThan(heavy.score);
    expect(light.issues.join('\n')).toMatch(/too thin|Weight/);
  });

  it('penalises a hairline stroke against a big cap height', () => {
    const hairline: TextStyle = { ...big, stroke: { width: 1, color: '#000' } };
    const { issues } = legibilityScore(hairline, slot, 720, 0.02);
    expect(issues.join('\n')).toMatch(/[Ss]troke is 1px/);
  });

  it('penalises a headline slot that invites too many characters', () => {
    const wide: PixelRect = { x: 0, y: 0, w: 3000, h: 200 };
    const { issues } = legibilityScore({ ...big, size: 80 }, wide, 720, 0.02);
    expect(issues.join('\n')).toMatch(new RegExp(String(MAX_HEADLINE_CHARS)));
  });

  it('penalises an over-long headline when the text is known', () => {
    const short = legibilityScoreForText('GRAND FINAL', big, slot, 720, 0.02);
    const long = legibilityScoreForText(
      'THE ABSOLUTELY ENORMOUS GRAND FINAL SHOWDOWN OF THE CENTURY', big, slot, 720, 0.02,
    );
    expect(long.score).toBeLessThan(short.score);
    expect(long.issues.join('\n')).toMatch(/\d+ characters/);
  });

  it('flags tight tracking that will merge glyphs at thumbnail scale', () => {
    const tight: TextStyle = { ...big, size: 40, tracking: -0.08 };
    expect(legibilityScore(tight, slot, 720, 0.02).issues.join('\n')).toMatch(/[Tt]racking/);
  });

  it('flags a size wildly larger than its slot', () => {
    const { issues } = legibilityScore({ ...big, size: 600 }, slot, 720, 0.02);
    expect(issues.join('\n')).toMatch(/autoFit/);
  });

  it('always returns a score in 0–100 and never throws on odd input', () => {
    const cases: TextStyle[] = [
      { family: 'X', size: 1 },
      { family: 'X', size: 5000, weight: 100, tracking: -0.5, opacity: 0.1 },
      { family: 'X', size: 40, fill: { kind: 'solid', color: 'not-a-colour' } },
      { family: 'X', size: 40, fill: { kind: 'linear', angle: 0, stops: [] } },
      { family: 'X', size: 40, fill: { kind: 'stripe', colors: ['#f00', '#00f'], width: 4, angle: 45 } },
    ];
    for (const style of cases) {
      for (const L of [0, 0.5, 1]) {
        const r = legibilityScore(style, slot, 720, L);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(Array.isArray(r.issues)).toBe(true);
      }
    }
  });

  it('rates every preset it is fair to rate at its designed size', () => {
    for (const name of ['headline-heavy', 'headline-condensed', 'player-name', 'drama-scream']) {
      const r = legibilityScore(preset(name), { x: 0, y: 0, w: 900, h: 200 }, 720, backgroundLuminanceOf('#12141C'));
      expect(r.score, `${name}: ${r.issues.join(' | ')}`).toBeGreaterThanOrEqual(70);
    }
  });
});
