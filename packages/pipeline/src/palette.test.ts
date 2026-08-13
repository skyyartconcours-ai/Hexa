import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex } from '@hexa/core';
import { NEUTRAL_PALETTE, resolvePalette, rimColorFor, separation } from './palette.js';
import { makeSubject, makeTeam } from './test-fixtures.js';

const RED = '#C8102E';
const BLUE = '#1B3FC8';
/** Close enough to RED that a naive palette would render them as one colour. */
const NEARLY_RED = '#CC1430';

function versus(leftColor: string, rightColor: string) {
  return [
    makeSubject({ index: 0, side: 'left', team: makeTeam({ id: 'L', colors: { primary: leftColor } }), accent: leftColor }),
    makeSubject({ index: 1, side: 'right', team: makeTeam({ id: 'R', colors: { primary: rightColor } }), accent: rightColor }),
  ];
}

describe('resolvePalette', () => {
  it('takes each side from its own team', () => {
    const p = resolvePalette(versus(RED, BLUE));
    expect(p.left).toBe(RED);
    expect(p.right).toBe(BLUE);
  });

  it('is deterministic', () => {
    const subjects = versus(RED, BLUE);
    expect(resolvePalette(subjects)).toEqual(resolvePalette(subjects));
  });

  it('separates two brands that are almost the same colour', () => {
    const p = resolvePalette(versus(RED, NEARLY_RED));
    expect(separation(RED, NEARLY_RED)).toBeLessThan(0.14);
    expect(separation(p.left, p.right)).toBeGreaterThanOrEqual(0.14);
  });

  it('leaves distinct brands untouched', () => {
    const p = resolvePalette(versus(RED, BLUE));
    expect(p.right).toBe(BLUE);
  });

  it('derives an accent that stands apart from both sides', () => {
    const p = resolvePalette(versus(RED, BLUE));
    expect(separation(p.accent, p.left)).toBeGreaterThanOrEqual(0.1);
    expect(separation(p.accent, p.right)).toBeGreaterThanOrEqual(0.1);
  });

  it('keeps the accent bright enough to read as a glow', () => {
    for (const [l, r] of [[RED, BLUE], ['#101010', '#151515'], ['#222244', '#242426']]) {
      const p = resolvePalette(versus(l!, r!));
      const { r: rr, g, b } = parseHex(p.accent);
      expect(Math.max(rr, g, b), `accent for ${l}/${r} must not be near-black`).toBeGreaterThan(60);
    }
  });

  it('produces a dark that text can sit on and a light that reads against it', () => {
    const p = resolvePalette(versus(RED, BLUE));
    expect(contrastRatio(p.light, p.dark)).toBeGreaterThan(4.5);
  });

  it('honours explicit overrides exactly, without forcing separation', () => {
    const p = resolvePalette(versus(RED, BLUE), { left: '#010203', right: '#010204', accent: '#FFFFFF' });
    expect(p.left).toBe('#010203');
    expect(p.right).toBe('#010204');
    expect(p.accent).toBe('#FFFFFF');
  });

  it('normalises shorthand hex overrides', () => {
    expect(resolvePalette(versus(RED, BLUE), { accent: '#fc0' }).accent).toBe('#ffcc00');
  });

  it('ignores an unparseable override rather than throwing', () => {
    const p = resolvePalette(versus(RED, BLUE), { accent: 'not-a-colour' });
    expect(p.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('uses the team secondary for the other side when both subjects share a team', () => {
    const team = makeTeam({ id: 'SAME', colors: { primary: RED, secondary: '#00A3E0' } });
    const p = resolvePalette([
      makeSubject({ index: 0, side: 'left', team, accent: RED }),
      makeSubject({ index: 1, side: 'right', team, accent: RED }),
    ]);
    expect(p.left).toBe(RED);
    expect(p.right).toBe('#00A3E0');
  });

  it('falls back to the neutral palette with no subjects', () => {
    expect(resolvePalette([])).toEqual(NEUTRAL_PALETTE);
  });

  it('still applies overrides with no subjects', () => {
    expect(resolvePalette([], { accent: '#123456' }).accent).toBe('#123456');
  });

  it('handles a lone centre subject', () => {
    const p = resolvePalette([makeSubject({ index: 0, side: 'center', team: makeTeam({ id: 'C', colors: { primary: BLUE } }), accent: BLUE })]);
    expect(p.left).toBe(BLUE);
    expect(p.right).toBeTruthy();
  });

  it('prefers a per-player accent over the team primary', () => {
    const subjects = versus(RED, BLUE);
    subjects[0]!.accent = '#00FF88';
    expect(resolvePalette(subjects).left).toBe('#00ff88');
  });
});

describe('rimColorFor', () => {
  const palette = resolvePalette(versus(RED, BLUE));

  it('rims the left subject in the right team colour, and vice versa', () => {
    // This is the whole versus device: each player edged in their opponent's
    // colour, so the light reads as two sources fighting across the frame.
    expect(rimColorFor('left', palette)).toBe(palette.right);
    expect(rimColorFor('right', palette)).toBe(palette.left);
  });

  it('uses one accent for both sides when unified', () => {
    expect(rimColorFor('left', palette, 'unified')).toBe(palette.accent);
    expect(rimColorFor('right', palette, 'unified')).toBe(palette.accent);
  });

  it('rims each subject in their own colour when inverted', () => {
    expect(rimColorFor('left', palette, 'inverted')).toBe(palette.left);
    expect(rimColorFor('right', palette, 'inverted')).toBe(palette.right);
  });
});
