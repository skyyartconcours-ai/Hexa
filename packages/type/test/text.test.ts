import { describe, it, expect, beforeEach } from 'vitest';
import { renderText, autoFit, preset, PRESETS, measureLine, clearFonts } from '../src/index.js';
import type { LayoutTextInput, TextStyle, PixelRect } from '../src/index.js';
import type { Anchor } from '@hexa/core';
import { assertWellFormed, idsIn, refsIn } from './helpers.js';

const BOX: PixelRect = { x: 0, y: 0, w: 800, h: 220 };

const STYLE: TextStyle = {
  family: 'Anton',
  weight: 400,
  size: 90,
  tracking: -0.01,
  lineHeight: 0.95,
  case: 'upper',
  fill: { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#8892A6' }] },
  stroke: { width: 6, color: '#0A0A0F', join: 'round' },
};

beforeEach(() => clearFonts());

describe('renderText', () => {
  it('emits a standalone SVG sized exactly to the box', () => {
    const r = renderText({ block: { text: 'GRAND FINAL', style: STYLE }, box: BOX });
    assertWellFormed(r.markup);
    expect(r.markup.startsWith('<svg')).toBe(true);
    expect(r.markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(r.markup).toContain('width="800"');
    expect(r.markup).toContain('height="220"');
    expect(r.markup).toContain('viewBox="0 0 800 220"');
    expect(r.markup.endsWith('</svg>')).toBe(true);
    expect(r.box).toEqual(BOX);
    expect(r.fontSize).toBe(90);
  });

  it('reports content bounds that include stroke and extrusion overhang', () => {
    const bare = renderText({ block: { text: 'HEXA', style: { ...STYLE, stroke: undefined } }, box: BOX });
    const stroked = renderText({ block: { text: 'HEXA', style: STYLE }, box: BOX });
    expect(stroked.width).toBeGreaterThan(bare.width);
    expect(stroked.height).toBeGreaterThan(bare.height);

    const extruded = renderText({
      block: { text: 'HEXA', style: { ...STYLE, extrude: { depth: 20, angle: 60, color: '#111' } } },
      box: BOX,
    });
    expect(extruded.width).toBeGreaterThan(stroked.width);
    expect(extruded.height).toBeGreaterThan(stroked.height);
  });

  it('paints in the order plate → extrude → stroke → fill → glow', () => {
    const style: TextStyle = {
      ...STYLE,
      plate: { color: '#FFD447', padX: 12, padY: 6 },
      extrude: { depth: 8, angle: 60, color: '#111827' },
      glow: { radius: 20, color: '#40E0FF', intensity: 0.8 },
    };
    const { markup } = renderText({ block: { text: 'ORDER', style }, box: BOX });
    assertWellFormed(markup);

    const plateAt = markup.indexOf('<rect');
    const extrudeAt = markup.indexOf('#111827');
    const strokeAt = markup.indexOf('fill="none"');
    const fillAt = markup.lastIndexOf('<text');
    const glowAt = markup.indexOf('filter="url(#hxgl');

    expect(plateAt).toBeGreaterThanOrEqual(0);
    expect(plateAt).toBeLessThan(extrudeAt);
    expect(extrudeAt).toBeLessThan(strokeAt);
    expect(strokeAt).toBeLessThan(fillAt);
    expect(glowAt).toBeGreaterThan(0);
    // The glow group is the last thing in the document.
    expect(glowAt).toBeGreaterThan(markup.indexOf('<g filter="url(#hxsh'));
  });

  it('emits one extrusion copy per unit of depth, capped', () => {
    const count = (m: string) => (m.match(/<text/g) ?? []).length;
    const d5 = renderText({
      block: { text: 'X', style: { ...STYLE, stroke: undefined, extrude: { depth: 5, angle: 60, color: '#111' } } },
      box: BOX,
    });
    const d20 = renderText({
      block: { text: 'X', style: { ...STYLE, stroke: undefined, extrude: { depth: 20, angle: 60, color: '#111' } } },
      box: BOX,
    });
    expect(count(d5.markup)).toBe(6); // 5 copies + face
    expect(count(d20.markup)).toBe(21);

    // A runaway depth must not emit thousands of nodes.
    const huge = renderText({
      block: { text: 'X', style: { ...STYLE, stroke: undefined, extrude: { depth: 5000, angle: 60, color: '#111' } } },
      box: BOX,
    });
    expect(count(huge.markup)).toBeLessThanOrEqual(97);
  });

  it('honours every anchor', () => {
    const anchors: Anchor[] = [
      'top-left', 'top-center', 'top-right', 'center-left', 'center',
      'center-right', 'bottom-left', 'bottom-center', 'bottom-right',
    ];
    const xs = new Set<string>();
    const ys = new Set<string>();
    for (const anchor of anchors) {
      const r = renderText({ block: { text: 'HEXA', style: STYLE }, box: BOX, anchor });
      assertWellFormed(r.markup, anchor);
      const m = /<text[^>]*\sx="([-\d.]+)"[^>]*\sy="([-\d.]+)"/.exec(r.markup);
      expect(m, `no <text> for ${anchor}`).toBeTruthy();
      xs.add(m![1]!);
      ys.add(m![2]!);
    }
    expect(xs.size).toBe(3);
    expect(ys.size).toBe(3);
  });

  it('aligns lines within the block', () => {
    const input = (align: 'left' | 'center' | 'right'): LayoutTextInput => ({
      block: { text: 'LONGEST LINE HERE\nSHORT', style: { ...STYLE, size: 40 }, align },
      box: BOX,
    });
    const xOf = (m: string, i: number) => [...m.matchAll(/<text[^>]*\sx="([-\d.]+)"/g)].map((x) => Number(x[1]))[i]!;
    const left = renderText(input('left')).markup;
    const center = renderText(input('center')).markup;
    const right = renderText(input('right')).markup;
    // First line is the longest, so it sits at the same x in all three; the
    // second line is what moves.
    expect(xOf(left, 1)).toBeLessThan(xOf(center, 1));
    expect(xOf(center, 1)).toBeLessThan(xOf(right, 1));
  });

  it('applies skew about the block centre, not the origin', () => {
    const r = renderText({ block: { text: 'LEAN', style: { ...STYLE, skewX: 10 } }, box: BOX });
    assertWellFormed(r.markup);
    expect(r.markup).toMatch(/transform="translate\([-\d.,]+\) skewX\(-10\) translate\([-\d.,]+\)"/);
  });

  it('emits per-character nodes when jitter is set, deterministically', () => {
    const style: TextStyle = { ...STYLE, jitter: { rotate: 3, offset: 2, seed: 42 } };
    const a = renderText({ block: { text: 'CLUTCH', style }, box: BOX });
    const b = renderText({ block: { text: 'CLUTCH', style }, box: BOX });
    assertWellFormed(a.markup);
    expect(a.markup).toBe(b.markup);
    expect(a.markup).toMatch(/rotate\(/);
    // 6 chars × (stroke pass + fill pass)
    expect((a.markup.match(/<text/g) ?? []).length).toBe(12);

    const other = renderText({ block: { text: 'CLUTCH', style: { ...style, jitter: { rotate: 3, offset: 2, seed: 7 } } }, box: BOX });
    expect(other.markup).not.toBe(a.markup);
  });

  it('is deterministic for identical input', () => {
    const input: LayoutTextInput = { block: { text: 'REPEAT ME', style: STYLE }, box: BOX, anchor: 'center' };
    expect(renderText(input).markup).toBe(renderText(input).markup);
  });

  it('renders empty text without throwing or emitting stray nodes', () => {
    const r = renderText({ block: { text: '', style: STYLE }, box: BOX });
    assertWellFormed(r.markup);
    expect(r.markup).not.toContain('<text');
  });

  it('rejects a degenerate box', () => {
    for (const box of [{ x: 0, y: 0, w: 0, h: 100 }, { x: 0, y: 0, w: 100, h: -1 }]) {
      expect(() => renderText({ block: { text: 'X', style: STYLE }, box })).toThrow(/positive width and height/);
    }
  });
});

describe('XML escaping', () => {
  const HOSTILE = `<script>alert("x")</script> & 'quotes' "double" <>&amp;`;

  it('escapes every metacharacter in element content', () => {
    const r = renderText({ block: { text: HOSTILE, style: { ...STYLE, size: 24, case: 'none' } }, box: BOX, wrap: false });
    assertWellFormed(r.markup);
    expect(r.markup).not.toContain('<script>');
    expect(r.markup).toContain('&lt;script&gt;');
    expect(r.markup).toContain('&amp;');
    expect(r.markup).toContain('&quot;');
    expect(r.markup).toContain('&apos;');
    // The literal ampersand must not survive unescaped anywhere.
    expect(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(r.markup)).toBe(false);
  });

  it('escapes hostile colours and family names in attributes', () => {
    const style: TextStyle = {
      ...STYLE,
      family: `Ant"on><script>`,
      fill: { kind: 'solid', color: `red" onload="alert(1)` },
      stroke: { width: 4, color: `#000" x="0`, join: 'round' },
    };
    const r = renderText({ block: { text: 'SAFE', style }, box: BOX });
    assertWellFormed(r.markup);
    // The payload may appear as inert *text* inside an escaped value, but it
    // must never become a real attribute or a real element.
    expect(r.markup).not.toMatch(/\sonload\s*=\s*["']/);
    expect(r.markup).not.toContain('<script');
    expect(r.markup).toContain('&quot;');
  });

  it('passes emoji through as valid XML', () => {
    const r = renderText({ block: { text: '🔥 GG 🏆 决勝', style: { ...STYLE, size: 40, case: 'none' } }, box: BOX });
    assertWellFormed(r.markup);
    expect(r.markup).toContain('🔥');
    expect(r.markup).toContain('🏆');
    expect(r.markup).toContain('决勝');
  });

  it('replaces lone surrogates rather than emitting unparseable XML', () => {
    const lone = 'A\uD83DB\uDE00C'; // high surrogate then low surrogate, both orphaned
    const r = renderText({ block: { text: lone, style: { ...STYLE, size: 40, case: 'none' } }, box: BOX });
    assertWellFormed(r.markup);
    expect(r.markup).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(r.markup).toContain('�');
  });

  it('strips control characters XML forbids', () => {
    const r = renderText({ block: { text: 'A BC', style: { ...STYLE, size: 40, case: 'none' } }, box: BOX });
    assertWellFormed(r.markup);
    expect(r.markup).not.toMatch(/[ -]/);
  });
});

describe('def id uniqueness', () => {
  const gradient: TextStyle = {
    ...STYLE,
    glow: { radius: 16, color: '#40E0FF', intensity: 0.7 },
    shadow: { dx: 0, dy: 6, blur: 14, color: '#000000', opacity: 0.5 },
  };

  it('never collides across two renders concatenated into one document', () => {
    const a = renderText({ block: { text: 'TEAM ALPHA', style: gradient }, box: BOX });
    const b = renderText({ block: { text: 'TEAM BRAVO', style: gradient }, box: BOX });
    const idsA = idsIn(a.markup);
    const idsB = idsIn(b.markup);
    expect(idsA.length).toBeGreaterThan(2);
    expect(idsA.length).toBe(idsB.length);
    for (const id of idsA) expect(idsB).not.toContain(id);

    const doc = `<svg xmlns="http://www.w3.org/2000/svg">${a.markup}${b.markup}</svg>`;
    const all = idsIn(doc);
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives identical styles distinct ids when the box or anchor differs', () => {
    const a = renderText({ block: { text: 'SAME', style: gradient }, box: BOX });
    const b = renderText({ block: { text: 'SAME', style: gradient }, box: { ...BOX, w: 801 } });
    const c = renderText({ block: { text: 'SAME', style: gradient }, box: BOX, anchor: 'center' });
    const [ia, ib, ic] = [idsIn(a.markup), idsIn(b.markup), idsIn(c.markup)];
    expect(new Set([...ia, ...ib, ...ic]).size).toBe(ia.length + ib.length + ic.length);
  });

  it('keeps ids stable across identical renders', () => {
    const input: LayoutTextInput = { block: { text: 'STABLE', style: gradient }, box: BOX };
    expect(idsIn(renderText(input).markup)).toEqual(idsIn(renderText(input).markup));
  });

  it('resolves every url(#…) reference to an id defined in the same document', () => {
    for (const name of Object.keys(PRESETS)) {
      const { markup } = renderText({
        block: { text: 'REFS 99', style: preset(name) },
        box: { x: 0, y: 0, w: 1200, h: 400 },
      });
      const defined = new Set(idsIn(markup));
      for (const ref of refsIn(markup)) {
        expect(defined.has(ref), `preset ${name} references #${ref} with no matching def`).toBe(true);
      }
    }
  });

  it('deduplicates identical defs inside a single render', () => {
    // Two lines share one gradient — the def must appear exactly once.
    const { markup } = renderText({ block: { text: 'LINE ONE\nLINE TWO', style: gradient }, box: BOX });
    expect((markup.match(/<linearGradient/g) ?? []).length).toBe(1);
  });

  it('namespaces ids so they cannot clash with a host document', () => {
    const { markup } = renderText({ block: { text: 'NS', style: gradient }, box: BOX });
    for (const id of idsIn(markup)) expect(id.startsWith('hx')).toBe(true);
  });
});

describe('autoFit', () => {
  const fitStyle: TextStyle = { ...STYLE, size: 500 };

  it('never overflows its box across many string lengths', () => {
    const box: PixelRect = { x: 0, y: 0, w: 640, h: 200 };
    const words = ['CLUTCH', 'GRAND', 'FINAL', 'MAJOR', 'SPLIT', 'CHAMPIONSHIP', 'QUALIFIER'];
    for (let len = 1; len <= 40; len++) {
      const text = Array.from({ length: len }, (_, i) => words[i % words.length]).join(' ').slice(0, len * 4 + 1);
      const r = autoFit({ block: { text, style: fitStyle, align: 'center' }, box, anchor: 'center' });
      expect(r.width, `overflow width for len=${len}: ${r.width}`).toBeLessThanOrEqual(box.w + 0.01);
      expect(r.height, `overflow height for len=${len}: ${r.height}`).toBeLessThanOrEqual(box.h + 0.01);
      expect(r.fontSize).toBeGreaterThan(0);
    }
  });

  it('never overflows across many box shapes', () => {
    const text = 'THE GRAND FINAL OF THE WINTER CHAMPIONSHIP SERIES';
    for (const box of [
      { x: 0, y: 0, w: 1200, h: 300 }, { x: 0, y: 0, w: 210, h: 118 },
      { x: 0, y: 0, w: 90, h: 600 }, { x: 0, y: 0, w: 600, h: 40 },
      { x: 0, y: 0, w: 30, h: 30 }, { x: 0, y: 0, w: 5, h: 5 },
    ] as PixelRect[]) {
      const r = autoFit({ block: { text, style: fitStyle }, box });
      expect(r.width, `w overflow in ${box.w}×${box.h}`).toBeLessThanOrEqual(box.w + 0.01);
      expect(r.height, `h overflow in ${box.w}×${box.h}`).toBeLessThanOrEqual(box.h + 0.01);
    }
  });

  it('never overflows with maxLines and heavy decoration', () => {
    const heavy: TextStyle = {
      ...STYLE,
      size: 400,
      extrude: { depth: 18, angle: 62, color: '#111', fade: 0.4 },
      plate: { color: '#000', padX: 20, padY: 12 },
      skewX: 12,
    };
    const box: PixelRect = { x: 0, y: 0, w: 700, h: 260 };
    for (const maxLines of [1, 2, 3]) {
      const r = autoFit({ block: { text: 'ABSOLUTELY MASSIVE GRAND FINAL SHOWDOWN', style: heavy }, box, maxLines });
      expect(r.lines.length).toBeLessThanOrEqual(maxLines);
      expect(r.width).toBeLessThanOrEqual(box.w + 0.01);
      expect(r.height).toBeLessThanOrEqual(box.h + 0.01);
    }
  });

  it('never overflows with wrap disabled', () => {
    const box: PixelRect = { x: 0, y: 0, w: 500, h: 150 };
    const r = autoFit({ block: { text: 'AN EXTREMELY LONG UNWRAPPED HEADLINE', style: fitStyle }, box, wrap: false });
    expect(r.lines.length).toBe(1);
    expect(r.width).toBeLessThanOrEqual(box.w + 0.01);
    expect(r.height).toBeLessThanOrEqual(box.h + 0.01);
  });

  it('grows the size to fill the box', () => {
    const box: PixelRect = { x: 0, y: 0, w: 900, h: 240 };
    const small = autoFit({ block: { text: 'GG', style: fitStyle }, box });
    const large = autoFit({ block: { text: 'GRAND FINAL SHOWDOWN NIGHT', style: fitStyle }, box });
    expect(small.fontSize).toBeGreaterThan(large.fontSize);
    // Short text should be pushed close to the ceiling of what the box allows.
    expect(small.height).toBeGreaterThan(box.h * 0.7);
  });

  it('honours min and max when both are satisfiable', () => {
    const box: PixelRect = { x: 0, y: 0, w: 2000, h: 800 };
    const r = autoFit({ block: { text: 'GG', style: fitStyle }, box }, { min: 20, max: 64 });
    expect(r.fontSize).toBeLessThanOrEqual(64);
    expect(r.fontSize).toBeGreaterThanOrEqual(20);
  });

  it('undercuts min rather than returning an overflowing layout', () => {
    const box: PixelRect = { x: 0, y: 0, w: 40, h: 20 };
    const r = autoFit({ block: { text: 'AN IMPOSSIBLY LONG HEADLINE', style: fitStyle }, box }, { min: 200, max: 400 });
    expect(r.width).toBeLessThanOrEqual(box.w + 0.01);
    expect(r.height).toBeLessThanOrEqual(box.h + 0.01);
    expect(r.fontSize).toBeLessThan(200);
  });

  it('terminates promptly even with a huge search range', () => {
    const start = Date.now();
    const r = autoFit(
      { block: { text: 'TERMINATION', style: fitStyle }, box: { x: 0, y: 0, w: 900, h: 300 } },
      { min: 1, max: 100_000, steps: 64 },
    );
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.width).toBeLessThanOrEqual(900.01);
  });

  it('produces markup consistent with the reported font size', () => {
    const r = autoFit({ block: { text: 'CONSISTENT', style: fitStyle }, box: { x: 0, y: 0, w: 800, h: 200 } });
    assertWellFormed(r.markup);
    const emitted = [...r.markup.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(emitted.length).toBeGreaterThan(0);
    for (const size of emitted) expect(size).toBeCloseTo(r.fontSize, 2);
    const measured = measureLine(r.lines[0]!, { ...fitStyle, size: r.fontSize, case: 'none' });
    expect(measured).toBeLessThanOrEqual(800.01);
  });

  it('scales decoration with the fitted size to keep the design proportions', () => {
    const styled: TextStyle = {
      ...STYLE, size: 400,
      stroke: { width: 24, color: '#0A0A0F', join: 'round' },
      extrude: { depth: 40, angle: 60, color: '#111' },
    };
    const r = autoFit({ block: { text: 'PROPORTION', style: styled }, box: { x: 0, y: 0, w: 600, h: 160 } });
    const strokeW = Number(/stroke-width="([\d.]+)"/.exec(r.markup)?.[1]);
    // stroke stays at 24/400 = 6% of the font size, whatever size was chosen.
    expect(strokeW / r.fontSize).toBeCloseTo(24 / 400, 3);
  });
});
