import { describe, it, expect, beforeEach } from 'vitest';
import { versusMark, nameplate, statBadge, clearFonts } from '../src/index.js';
import type { VersusMarkOptions, NameplateOptions } from '../src/index.js';
import { assertWellFormed, idsIn, refsIn } from './helpers.js';

const VS_STYLES: NonNullable<VersusMarkOptions['style']>[] = [
  'slash', 'shield', 'bolt', 'blade', 'circle', 'plain', 'hex',
];
const NP_STYLES: NonNullable<NameplateOptions['style']>[] = [
  'bar', 'angled', 'stacked', 'minimal', 'ticket',
];

beforeEach(() => clearFonts());

/** Every mark must be a self-contained, internally consistent SVG document. */
function assertSelfContained(markup: string, label: string): void {
  assertWellFormed(markup, label);
  expect(markup.startsWith('<svg'), label).toBe(true);
  expect(markup.endsWith('</svg>'), label).toBe(true);
  expect(markup, label).toContain('xmlns="http://www.w3.org/2000/svg"');
  // No external references of any kind.
  expect(markup, label).not.toMatch(/(?:href|src)\s*=\s*["']https?:/);
  const ids = idsIn(markup);
  expect(new Set(ids).size, `${label}: duplicate ids`).toBe(ids.length);
  const defined = new Set(ids);
  for (const ref of refsIn(markup)) expect(defined.has(ref), `${label}: dangling url(#${ref})`).toBe(true);
}

describe('versusMark', () => {
  const base: VersusMarkOptions = { size: 200, leftColor: '#E01E37', rightColor: '#1E6FE0' };

  it('produces a well-formed, self-contained SVG in every style', () => {
    for (const style of VS_STYLES) {
      const m = versusMark({ ...base, style });
      assertSelfContained(m.markup, `versus:${style}`);
      expect(m.height, style).toBe(200);
      expect(m.width, style).toBeGreaterThan(0);
      expect(m.markup, style).toContain(`height="${m.height}"`);
      expect(m.markup, style).toContain(`width="${m.width}"`);
    }
  });

  it('makes the styles genuinely distinct, not the same shape recoloured', () => {
    const geometry = VS_STYLES.map((style) => {
      const markup = versusMark({ ...base, style }).markup;
      // Strip ids and colours; what is left is the shape language.
      return markup.replace(/hx[a-z]+-[a-z0-9-]+/g, '').replace(/#[0-9A-Fa-f]{3,8}/g, '');
    });
    expect(new Set(geometry).size).toBe(VS_STYLES.length);

    // Each style should reach for different primitives.
    const primitives = (s: string) => new Set([...s.matchAll(/<(path|polygon|circle|rect|line|ellipse)\b/g)].map((m) => m[1]));
    expect([...primitives(versusMark({ ...base, style: 'circle' }).markup)]).toContain('circle');
    expect([...primitives(versusMark({ ...base, style: 'hex' }).markup)]).toContain('polygon');
    expect([...primitives(versusMark({ ...base, style: 'bolt' }).markup)]).toContain('path');
  });

  it('carries both team colours into every plated style', () => {
    for (const style of VS_STYLES) {
      const markup = versusMark({ ...base, style }).markup;
      expect(markup, style).toContain('#E01E37');
      expect(markup, style).toContain('#1E6FE0');
    }
  });

  it('adds a glow filter only when asked', () => {
    const off = versusMark({ ...base, style: 'slash', glow: false });
    const on = versusMark({ ...base, style: 'slash', glow: true });
    expect(off.markup).not.toContain('<filter');
    expect(on.markup).toContain('<filter');
    expect(on.markup).toContain('feGaussianBlur');
    assertSelfContained(on.markup, 'versus:glow');
  });

  it('honours custom text and escapes it', () => {
    const m = versusMark({ ...base, text: '<VS>&"' });
    assertSelfContained(m.markup, 'versus:hostile');
    expect(m.markup).toContain('&lt;VS&gt;');
    expect(m.markup).not.toContain('<VS>');
  });

  it('scales geometry with size', () => {
    const small = versusMark({ ...base, size: 100 });
    const large = versusMark({ ...base, size: 400 });
    expect(large.width).toBeCloseTo(small.width * 4, 3);
    expect(large.height).toBe(400);
  });

  it('is deterministic', () => {
    expect(versusMark({ ...base, style: 'blade', glow: true }).markup)
      .toBe(versusMark({ ...base, style: 'blade', glow: true }).markup);
  });

  it('survives identical team colours and a degenerate size', () => {
    for (const style of VS_STYLES) {
      const m = versusMark({ size: 1, style, leftColor: '#FF0000', rightColor: '#FF0000', text: '' });
      assertSelfContained(m.markup, `versus:degenerate:${style}`);
    }
  });

  it('does not throw on an unparseable colour', () => {
    const m = versusMark({ ...base, leftColor: 'rebeccapurple', rightColor: 'not-a-colour' });
    assertSelfContained(m.markup, 'versus:badcolour');
  });
});

describe('nameplate', () => {
  const base: NameplateOptions = {
    name: 'Kestrel', team: 'NRG', role: 'DUELIST', accent: '#FFD447',
    width: 420, height: 110, align: 'left',
  };

  it('produces a well-formed, self-contained SVG in every style and alignment', () => {
    for (const style of NP_STYLES) {
      for (const align of ['left', 'right'] as const) {
        const m = nameplate({ ...base, style, align });
        assertSelfContained(m.markup, `nameplate:${style}:${align}`);
        expect(m.width).toBe(420);
        expect(m.height).toBe(110);
        expect(m.markup).toContain('KESTREL');
      }
    }
  });

  it('mirrors the lockup for right alignment', () => {
    for (const style of NP_STYLES) {
      const l = nameplate({ ...base, style, align: 'left' });
      const r = nameplate({ ...base, style, align: 'right' });
      expect(l.markup, style).not.toBe(r.markup);
    }
  });

  it('works with only a name', () => {
    for (const style of NP_STYLES) {
      const m = nameplate({ name: 'Solo', accent: '#40E0FF', width: 300, height: 90, align: 'left', style });
      assertSelfContained(m.markup, `nameplate:nameonly:${style}`);
      expect(m.markup).toContain('SOLO');
    }
  });

  it('shrinks a long name to fit rather than truncating it', () => {
    const short = nameplate({ ...base, name: 'Kes' });
    const long = nameplate({ ...base, name: 'Kestrelmagnificent' });
    const sizeOf = (m: string) => Number(/font-size="([\d.]+)"/.exec(m)?.[1]);
    expect(sizeOf(long.markup)).toBeLessThan(sizeOf(short.markup));
    expect(long.markup).toContain('KESTRELMAGNIFICENT');
    expect(long.markup).not.toContain('…');
  });

  it('escapes hostile names, teams and roles', () => {
    const m = nameplate({ ...base, name: '<script>x</script>', team: 'A&B', role: `"quoted"` });
    assertSelfContained(m.markup, 'nameplate:hostile');
    expect(m.markup).not.toContain('<script');
    expect(m.markup).toContain('&amp;');
  });

  it('handles emoji in a handle', () => {
    const m = nameplate({ ...base, name: 'k3str3l 🦅' });
    assertSelfContained(m.markup, 'nameplate:emoji');
    expect(m.markup).toContain('🦅');
  });

  it('uses the accent colour', () => {
    for (const style of NP_STYLES) {
      expect(nameplate({ ...base, style }).markup, style).toContain('#FFD447');
    }
  });

  it('is deterministic and survives degenerate sizes', () => {
    expect(nameplate(base).markup).toBe(nameplate(base).markup);
    for (const style of NP_STYLES) {
      assertSelfContained(
        nameplate({ ...base, style, width: 1, height: 1 }).markup,
        `nameplate:tiny:${style}`,
      );
    }
  });
});

describe('statBadge', () => {
  const base = { label: 'KILLS', value: '27', accent: '#40E0FF', width: 160, height: 100 };

  it('produces a well-formed, self-contained SVG in every style', () => {
    for (const style of ['pill', 'square', 'shield'] as const) {
      const m = statBadge({ ...base, style });
      assertSelfContained(m.markup, `badge:${style}`);
      expect(m.width).toBe(160);
      expect(m.height).toBe(100);
      expect(m.markup).toContain('KILLS');
      expect(m.markup).toContain('27');
    }
  });

  it('gives each style a different plate shape', () => {
    const shapes = (['pill', 'square', 'shield'] as const).map((style) =>
      statBadge({ ...base, style }).markup.replace(/hx[a-z]+-[a-z0-9-]+/g, ''),
    );
    expect(new Set(shapes).size).toBe(3);
  });

  it('shrinks an over-long value to fit the plate', () => {
    const m = statBadge({ ...base, value: '999999999999' });
    assertSelfContained(m.markup, 'badge:long');
    const sizes = [...m.markup.matchAll(/font-size="([\d.]+)"/g)].map((x) => Number(x[1]));
    expect(Math.max(...sizes)).toBeLessThan(100 * 0.52);
  });

  it('escapes hostile labels and values', () => {
    const m = statBadge({ ...base, label: '<b>&</b>', value: `"7"` });
    assertSelfContained(m.markup, 'badge:hostile');
    expect(m.markup).not.toContain('<b>');
    expect(m.markup).toContain('&amp;');
  });

  it('handles empty label or value', () => {
    assertSelfContained(statBadge({ ...base, label: '', value: '' }).markup, 'badge:empty');
  });

  it('is deterministic', () => {
    expect(statBadge(base).markup).toBe(statBadge(base).markup);
  });
});

describe('marks composed into one document', () => {
  it('never collide on ids', () => {
    const parts = [
      versusMark({ size: 180, leftColor: '#E01E37', rightColor: '#1E6FE0', style: 'slash', glow: true }),
      versusMark({ size: 180, leftColor: '#E01E37', rightColor: '#1E6FE0', style: 'hex', glow: true }),
      nameplate({ name: 'Kestrel', team: 'NRG', accent: '#FFD447', width: 400, height: 100, align: 'left' }),
      nameplate({ name: 'Vex', team: 'C9', accent: '#40E0FF', width: 400, height: 100, align: 'right' }),
      statBadge({ label: 'KILLS', value: '27', accent: '#40E0FF', width: 160, height: 100 }),
      statBadge({ label: 'KILLS', value: '27', accent: '#40E0FF', width: 160, height: 100, style: 'shield' }),
    ];
    const all = parts.flatMap((p) => idsIn(p.markup));
    expect(all.length).toBeGreaterThan(6);
    expect(new Set(all).size).toBe(all.length);
  });
});
