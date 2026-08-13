/**
 * The arithmetic of the verdict.
 *
 * Two questions decide whether the gates mean anything:
 *   • can a catastrophic failure be averaged away by everything else passing?
 *   • can `passed` be true while a gate said fail?
 * Both were live risks — a weighted mean over fourteen gates moves by four
 * points when one of them goes to zero — and both are asserted here against the
 * registry as it is actually configured, not against a toy.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { QaFinding } from '@hexa/core';
import { FAIL_CEILING, GATES, UNCHECKED_CEILING, aggregate, registerGate, runGates } from '../src/registry.js';
import { FAILED_CAP, scoreAppeal } from '../src/appeal.js';
import type { Gate } from '../src/types.js';
import { cleanComposition, ctx, flatBackground, withText } from './helpers.js';

const HEADLINE = { x: 200, y: 300, w: 560, h: 110 };

async function scene() {
  const image = await withText(await cleanComposition(), { text: 'GRAND FINAL', color: '#FFFFFF', rect: HEADLINE });
  return ctx(image, {
    textRects: [{ role: 'headline', rect: HEADLINE }],
    subjects: [{ playerId: 'peyz', handle: 'Peyz', faceRect: { x: 0.28, y: 0.2, w: 0.16, h: 0.24 } }],
  });
}

function stub(id: string, findings: QaFinding[], weight = 1): Gate {
  return { id, weight, description: `stub ${id}`, run: async () => findings };
}

function drop(id: string): void {
  const i = GATES.findIndex((g) => g.id === id);
  if (i >= 0) GATES.splice(i, 1);
}

describe('aggregate', () => {
  it('never lets a veto average out into a passing-looking score', () => {
    // Thirteen gates perfect, one heavy gate failing: the mean barely moves…
    const mean = 0.96;
    expect(Math.round(mean * 100)).toBe(96);
    // …and the reported score is capped well below anything that reads as good.
    expect(Math.round(aggregate(mean, 2.2 / 19) * 100)).toBeLessThan(50);
  });

  it('drops the ceiling as more, and heavier, gates veto', () => {
    const one = aggregate(1, 0.1);
    const two = aggregate(1, 0.25);
    const most = aggregate(1, 0.8);
    expect(one).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(most);
    expect(most).toBeLessThan(0.15);
    expect(one).toBeLessThanOrEqual(FAIL_CEILING);
  });

  it('keeps the mean when it is already worse than the cap', () => {
    expect(aggregate(0.2, 0.1)).toBeCloseTo(0.2, 5);
  });

  it('caps a report that could not check everything', () => {
    expect(aggregate(1, 0, 1)).toBeCloseTo(UNCHECKED_CEILING, 5);
    expect(aggregate(1, 0, 0)).toBe(1);
  });
});

describe('runGates aggregation', () => {
  afterEach(() => {
    drop('one-veto');
    drop('quiet-fail');
    drop('boom-hard');
  });

  it('tanks the total when a single gate vetoes, rather than shaving a few points', async () => {
    const context = await scene();
    const clean = await runGates(context, { skip: ['identity', 'likeness'] });

    registerGate(stub('one-veto', [
      { gate: 'one-veto', severity: 'fail', message: 'the headline is clipped', score: 0.1 },
    ], 2.2));
    const vetoed = await runGates(context, { skip: ['identity', 'likeness'] });
    drop('one-veto');

    expect(clean.score - vetoed.score).toBeGreaterThan(20);
    expect(vetoed.score).toBeLessThan(50);
    expect(vetoed.passed).toBe(false);
  });

  it('is false for `passed` whenever any gate emits a fail, however high the scores', async () => {
    registerGate(stub('quiet-fail', [
      { gate: 'quiet-fail', severity: 'pass', message: 'mostly fine', score: 1 },
      // A "fail" carrying a high score: severity must win, both for `passed`
      // and for the ceiling.
      { gate: 'quiet-fail', severity: 'fail', message: 'but not really', score: 0.98 },
    ]));
    const report = await runGates(await scene());
    expect(report.passed).toBe(false);
    expect(report.score).toBeLessThan(FAIL_CEILING * 100);
  });

  it('cannot report 100 when a gate crashed', async () => {
    registerGate({
      id: 'boom-hard',
      weight: 1,
      description: 'explodes',
      run: async () => { throw new Error('kaboom'); },
    });
    const report = await runGates(await scene(), { only: ['boom-hard', 'license'] });
    expect(report.gateScores).not.toHaveProperty('boom-hard');
    expect(report.score).toBeLessThanOrEqual(UNCHECKED_CEILING * 100);
    expect(report.findings.some((f) => /NOT checked/.test(f.suggestion ?? ''))).toBe(true);
  });

  it('every registered gate reports a score in 0–1 and an id that matches its findings', async () => {
    const report = await runGates(await scene());
    for (const gate of GATES) {
      expect(report.gateScores, gate.id).toHaveProperty(gate.id);
      const score = report.gateScores[gate.id]!;
      expect(Number.isFinite(score), gate.id).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    for (const f of report.findings) expect(typeof f.gate).toBe('string');
  });
});

describe('appeal beside a failing report', () => {
  it('refuses to look like a second opinion when QA vetoed the render', async () => {
    const image = await withText(await cleanComposition(), { text: 'GRAND FINAL', color: '#FFFFFF', rect: HEADLINE });
    const bare = await scoreAppeal({ image, width: 1280, height: 720, faceRects: [{ x: 0.25, y: 0.15, w: 0.3, h: 0.45 }] });

    const capped = await scoreAppeal({
      image,
      width: 1280,
      height: 720,
      faceRects: [{ x: 0.25, y: 0.15, w: 0.3, h: 0.45 }],
      qa: {
        passed: false,
        score: 41,
        gateScores: {},
        findings: [{ gate: 'clipping', severity: 'fail', message: 'headline clipped' }],
      },
    });

    expect(bare.score).toBeGreaterThan(FAILED_CAP);
    expect(capped.score).toBeLessThanOrEqual(FAILED_CAP);
    expect(capped.uncapped).toBe(bare.score);
    expect(capped.notes.join(' ')).toMatch(/QA vetoed this render \(clipping\)/);
    expect(capped.notes.join(' ')).toMatch(/cannot see a clipped headline/);
  });

  it('leaves the appeal of a passing render alone, and says the two numbers are separate', async () => {
    const image = await flatBackground('#123045');
    const result = await scoreAppeal({
      image,
      width: 1280,
      height: 720,
      qa: { passed: true, score: 78, gateScores: {}, findings: [] },
    });
    expect(result.uncapped).toBeUndefined();
    expect(result.notes.join(' ')).toMatch(/QA scored this render 78\/100 and passed it/);
  });

  it('is unchanged when no report is supplied', async () => {
    const image = await flatBackground('#123045');
    const a = await scoreAppeal({ image, width: 1280, height: 720 });
    const b = await scoreAppeal({ image, width: 1280, height: 720, qa: undefined });
    expect(a.score).toBe(b.score);
    expect(a.notes[0]).toMatch(/heuristic, not a click-through prediction/);
  });
});
