import { describe, expect, it } from 'vitest';
import { contrastGate } from '../src/gates/contrast.js';
import { legibilityGate } from '../src/gates/legibility.js';
import { busyBackground, ctx, flatBackground, gradientImage, H, plan, W, withText } from './helpers.js';

const HEADLINE_RECT = { x: 72, y: 470, w: 900, h: 96 };

async function goodImage(): Promise<Buffer> {
  return withText(await flatBackground('#0B0B0F'), {
    text: 'PEYZ VS RULER',
    color: '#FFFFFF',
    rect: HEADLINE_RECT,
  });
}

async function badImage(): Promise<Buffer> {
  return withText(await busyBackground(138), {
    text: 'PEYZ VS RULER',
    color: '#8A8A8A',
    rect: HEADLINE_RECT,
  });
}

function context(image: Buffer, textColor: string) {
  return ctx(image, {
    plan: plan({ meta: { templateId: 't', subjects: [], createdAt: '', textColors: { headline: textColor } } }),
    textRects: [{ role: 'headline', rect: HEADLINE_RECT }],
  });
}

describe('legibilityGate', () => {
  it('passes bold white type on a flat dark plate', async () => {
    const findings = await legibilityGate.run(context(await goodImage(), '#FFFFFF'));
    expect(findings.filter((f) => f.severity === 'fail')).toEqual([]);
    expect(findings.some((f) => f.severity === 'pass')).toBe(true);
  });

  it('fails low-contrast type camouflaged on a busy plate', async () => {
    const findings = await legibilityGate.run(context(await badImage(), '#8A8A8A'));
    const fails = findings.filter((f) => f.severity === 'fail');
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.every((f) => f.suggestion && f.suggestion.length > 0)).toBe(true);
    expect(fails.some((f) => /camouflaged|stroke separation/.test(f.message))).toBe(true);
  });

  it('fails a message-bearing headline that is too small to resolve in the sidebar box', async () => {
    // 40/720 * 94 * 0.7 = 3.7px cap, in a rect wide and tall enough (3.9% of the
    // canvas) that it is clearly meant to be read rather than to be a detail.
    const small = { x: 72, y: 590, w: 1000, h: 40 };
    const image = await withText(await flatBackground('#0B0B0F'), { text: 'GRAND FINAL TONIGHT', color: '#FFFFFF', rect: small });
    const findings = await legibilityGate.run(
      ctx(image, { textRects: [{ role: 'headline', rect: small }] }),
    );
    expect(findings.some((f) => f.severity === 'fail' && /cap height/.test(f.message))).toBe(true);
  });

  it('only warns about micro-type that is a detail rather than the message', async () => {
    // Same cap height, a fifth of the area: the editorial-caption case. It must
    // still be reported — and must not veto the render.
    const tiny = { x: 72, y: 600, w: 400, h: 40 };
    const image = await withText(await flatBackground('#0B0B0F'), { text: 'SMALL PRINT', color: '#FFFFFF', rect: tiny });
    const findings = await legibilityGate.run(
      ctx(image, { textRects: [{ role: 'caption', rect: tiny }] }),
    );
    expect(findings.some((f) => f.severity === 'fail')).toBe(false);
    expect(findings.some((f) => f.severity === 'warn' && /cap height/.test(f.message))).toBe(true);
    expect(findings.some((f) => /flagged, not vetoed/.test(f.message))).toBe(true);
    expect(findings.some((f) => /No text in this render resolves/.test(f.message))).toBe(true);
  });

  it('reports rather than vetoes when request.legibility is false', async () => {
    const c = context(await badImage(), '#8A8A8A');
    const findings = await legibilityGate.run({ ...c, request: { legibility: false } });
    expect(findings.some((f) => f.severity === 'warn')).toBe(true);
    expect(findings.some((f) => f.severity === 'fail')).toBe(false);
  });

  it('passes cleanly when the render carries no text at all', async () => {
    const findings = await legibilityGate.run(ctx(await flatBackground('#101018')));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('pass');
  });
});

describe('contrastGate', () => {
  it('passes white on near-black', async () => {
    const findings = await contrastGate.run(context(await goodImage(), '#FFFFFF'));
    expect(findings.filter((f) => f.severity === 'fail')).toEqual([]);
    const pass = findings.find((f) => f.severity === 'pass');
    expect(pass).toBeDefined();
    expect(pass!.message).toMatch(/contrast \d+\.\d+:1/);
  });

  it('fails mid-grey on a mid-tone busy plate', async () => {
    const findings = await contrastGate.run(context(await badImage(), '#8A8A8A'));
    const fail = findings.find((f) => f.severity === 'fail');
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/needs 4.5:1/);
    expect(fail!.suggestion).toBeTruthy();
    expect(fail!.where).toEqual({ x: HEADLINE_RECT.x / W, y: HEADLINE_RECT.y / H, w: HEADLINE_RECT.w / W, h: HEADLINE_RECT.h / H });
  });

  it('does not invent a failure for a text rect sitting on a smooth empty plate', async () => {
    // No type was drawn here at all. A naive figure/ground split would report
    // ~1:1 and veto a perfectly good render; the gate must say it could not
    // measure instead.
    const image = await gradientImage();
    const findings = await contrastGate.run(
      ctx(image, { textRects: [{ role: 'headline', rect: HEADLINE_RECT }] }),
    );
    expect(findings.some((f) => f.severity === 'fail')).toBe(false);
    expect(findings[0]!.message).toMatch(/no measurable figure\/ground split/);
  });

  it('warns when the declared text colour is nowhere in the rendered rect', async () => {
    const image = await flatBackground('#0B0B0F'); // headline never rendered
    const findings = await contrastGate.run(context(image, '#FF00AA'));
    expect(findings[0]!.severity).toBe('warn');
    expect(findings[0]!.message).toMatch(/declares text colour #FF00AA but no pixels of it were found/);
  });

  it('relaxes to 3:1 when the plan records a stroke behind the type', async () => {
    const image = await withText(await busyBackground(138), {
      text: 'PEYZ VS RULER',
      color: '#FFFFFF',
      rect: HEADLINE_RECT,
      stroke: { color: '#000000', width: 6 },
    });
    const withStroke = ctx(image, {
      plan: plan({
        meta: {
          templateId: 't', subjects: [], createdAt: '',
          textStyles: { headline: { color: '#FFFFFF', stroke: true } },
        },
      }),
      textRects: [{ role: 'headline', rect: HEADLINE_RECT }],
    });
    const findings = await contrastGate.run(withStroke);
    expect(findings.some((f) => f.message.includes('needs 3:1'))).toBe(true);
  });
});
