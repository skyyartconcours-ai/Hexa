import { describe, expect, it } from 'vitest';
import type { QaReport, ThumbnailVariant } from '@hexa/core';
import { APPEAL_WEIGHTS, pickBest, rankVariants, scoreAppeal } from '../src/appeal.js';
import { cleanComposition, flatBackground, H, plan, W, withText } from './helpers.js';

const HEADLINE = { x: 640, y: 300, w: 560, h: 110 };

async function scene(): Promise<Buffer> {
  return withText(await cleanComposition(), { text: 'GRAND FINAL', color: '#FFFFFF', rect: HEADLINE });
}

function report(score: number, passed: boolean): QaReport {
  return { passed, score, findings: [], gateScores: {} };
}

function variant(id: string, qaScore: number, appeal: number, passed = true): ThumbnailVariant {
  return { id, path: `/tmp/${id}.png`, plan: plan(), qa: report(qaScore, passed), appeal, seed: 1 };
}

describe('scoreAppeal', () => {
  it('returns a 0–100 score, every documented part, and an honesty note', async () => {
    const result = await scoreAppeal({
      image: await scene(),
      width: W,
      height: H,
      textRects: [{ role: 'headline', rect: HEADLINE }],
      faceRects: [{ x: 0.3, y: 0.2, w: 0.16, h: 0.24 }],
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Object.keys(result.parts).sort()).toEqual(Object.keys(APPEAL_WEIGHTS).sort());
    for (const v of Object.values(result.parts)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(result.notes[0]).toMatch(/heuristic, not a click-through prediction/);
  });

  it('rewards a prominent face over a tiny one', async () => {
    const image = await scene();
    const big = await scoreAppeal({ image, width: W, height: H, faceRects: [{ x: 0.25, y: 0.15, w: 0.3, h: 0.45 }] });
    const small = await scoreAppeal({ image, width: W, height: H, faceRects: [{ x: 0.45, y: 0.45, w: 0.04, h: 0.05 }] });
    expect(big.parts['faceProminence']!).toBeGreaterThan(small.parts['faceProminence']!);
    expect(big.score).toBeGreaterThan(small.score);
  });

  it('marks a washed-out flat frame down on colour and contrast', async () => {
    const flat = await scoreAppeal({ image: await flatBackground('#6E6E72'), width: W, height: H });
    const punchy = await scoreAppeal({ image: await scene(), width: W, height: H });
    expect(flat.parts['colorPunch']!).toBeLessThan(punchy.parts['colorPunch']!);
    expect(flat.parts['contrastRange']!).toBeLessThan(punchy.parts['contrastRange']!);
    expect(flat.notes.join(' ')).toMatch(/washed out|Tonal range is narrow/);
  });

  it('says so when it was given no face or text rects to measure', async () => {
    const result = await scoreAppeal({ image: await scene(), width: W, height: H });
    expect(result.notes.join(' ')).toMatch(/No face rects supplied/);
    expect(result.notes.join(' ')).toMatch(/No text rects supplied/);
  });
});

describe('rankVariants / pickBest', () => {
  it('ranks on the documented 60/40 blend of QA score and appeal', () => {
    // a = 0.6·60 + 0.4·90 = 72, b = 0.6·90 + 0.4·40 = 70, c = 0.6·90 + 0.4·70 = 82
    const variants = [variant('a', 60, 90), variant('b', 90, 40), variant('c', 90, 70)];
    expect(rankVariants(variants).map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(pickBest(variants)).toBe(2);
  });

  it('sinks a variant that failed QA below every passing one', () => {
    const variants = [variant('failed', 99, 99, false), variant('ok', 50, 50)];
    expect(rankVariants(variants).map((v) => v.id)).toEqual(['ok', 'failed']);
    expect(pickBest(variants)).toBe(1);
  });

  it('is stable and does not mutate its input', () => {
    const variants = [variant('a', 70, 70), variant('b', 70, 70)];
    const order = variants.map((v) => v.id);
    expect(rankVariants(variants).map((v) => v.id)).toEqual(['a', 'b']);
    expect(variants.map((v) => v.id)).toEqual(order);
  });

  it('handles an empty batch', () => {
    expect(rankVariants([])).toEqual([]);
    expect(pickBest([])).toBe(-1);
  });
});
