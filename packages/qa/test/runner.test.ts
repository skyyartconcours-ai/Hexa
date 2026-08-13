import { afterEach, describe, expect, it } from 'vitest';
import { GATES, registerGate, runGates } from '../src/registry.js';
import { formatFindings, summarise } from '../src/format.js';
import type { Gate } from '../src/types.js';
import { cleanComposition, ctx, embedding, flatBackground, withText } from './helpers.js';

const HEADLINE = { x: 640, y: 300, w: 560, h: 110 };

async function sceneCtx() {
  const image = await withText(await cleanComposition(), { text: 'GRAND FINAL', color: '#FFFFFF', rect: HEADLINE });
  return ctx(image, {
    textRects: [{ role: 'headline', rect: HEADLINE }],
    subjects: [{ playerId: 'peyz', handle: 'Peyz', faceRect: { x: 0.28, y: 0.2, w: 0.16, h: 0.24 }, referenceEmbeddings: [embedding(4)] }],
  });
}

function removeGate(id: string): void {
  const i = GATES.findIndex((g) => g.id === id);
  if (i >= 0) GATES.splice(i, 1);
}

describe('runGates', () => {
  afterEach(() => {
    removeGate('boom');
    removeGate('always-fails');
  });

  it('runs every registered gate and aggregates a 0–100 score', async () => {
    const report = await runGates(await sceneCtx());

    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    for (const gate of GATES) expect(report.gateScores).toHaveProperty(gate.id);
    for (const score of Object.values(report.gateScores)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.passed).toBe(!report.findings.some((f) => f.severity === 'fail'));
  });

  it('warns rather than passes silently when identity cannot be verified', async () => {
    const report = await runGates(await sceneCtx(), { only: ['identity'] });
    expect(report.findings.some((f) => f.severity === 'warn' && /UNVERIFIED/.test(f.message))).toBe(true);
    expect(report.passed).toBe(true); // unverified is not a veto, but it is loud
    expect(report.score).toBeLessThan(50);
  });

  it('honours only and skip', async () => {
    const c = await sceneCtx();
    const only = await runGates(c, { only: ['clutter', 'banding'] });
    expect(Object.keys(only.gateScores).sort()).toEqual(['banding', 'clutter']);

    const skipped = await runGates(c, { skip: ['identity', 'legibility', 'contrast'] });
    expect(Object.keys(skipped.gateScores)).not.toContain('identity');
    expect(Object.keys(skipped.gateScores)).toContain('clutter');
  });

  it('survives a gate that throws, and says the render was not checked', async () => {
    const boom: Gate = {
      id: 'boom',
      weight: 5,
      description: 'a gate that explodes',
      run: async () => { throw new Error('kaboom'); },
    };
    registerGate(boom);

    const report = await runGates(await sceneCtx(), { only: ['boom', 'license'] });

    const warn = report.findings.find((f) => f.gate === 'boom')!;
    expect(warn.severity).toBe('warn');
    expect(warn.message).toMatch(/threw and was skipped: kaboom/);
    expect(warn.suggestion).toMatch(/NOT checked/);
    // The crashed gate contributes no invented score, and does not veto.
    expect(report.gateScores).not.toHaveProperty('boom');
    expect(report.gateScores).toHaveProperty('license');
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThan(0);
    expect(summarise(report)).toMatch(/Not checked \(gate crashed\): boom/);
  });

  it('replaces a gate registered under an existing id', async () => {
    const before = GATES.length;
    registerGate({ id: 'banding', weight: 0.4, description: 'replacement', run: async () => [] });
    expect(GATES.length).toBe(before);
    expect(GATES.find((g) => g.id === 'banding')!.description).toBe('replacement');
    // Put the real one back.
    const { bandingGate } = await import('../src/gates/banding.js');
    registerGate(bandingGate);
    expect(GATES.find((g) => g.id === 'banding')!.description).toMatch(/stair-stepping/);
  });

  it('reports zero and complains when no gate ran at all', async () => {
    const report = await runGates(await sceneCtx(), { only: ['does-not-exist'] });
    expect(report.score).toBe(0);
    expect(report.findings.some((f) => /entirely unchecked/.test(f.message))).toBe(true);
  });

  it('takes the worst finding as the gate score', async () => {
    registerGate({
      id: 'always-fails',
      weight: 1,
      description: 'fails on purpose',
      run: async () => [
        { gate: 'always-fails', severity: 'pass', message: 'fine', score: 1 },
        { gate: 'always-fails', severity: 'fail', message: 'broken', score: 0.1 },
      ],
    });
    const report = await runGates(await sceneCtx(), { only: ['always-fails'] });
    expect(report.gateScores['always-fails']).toBeCloseTo(0.1, 5);
    expect(report.passed).toBe(false);
  });
});

describe('summarise / formatFindings', () => {
  it('renders a readable summary with per-gate bars and remedies', async () => {
    const report = await runGates(await sceneCtx(), { only: ['clutter', 'identity'] });
    const text = summarise(report);

    expect(text).toMatch(/^QA \d+\/100 — (PASS|FAIL)/);
    expect(text).toMatch(/fail, \d+ warn, \d+ pass/);
    expect(text).toMatch(/identity/);
    expect(text).toMatch(/[█·]{20}/);
    expect(text).toMatch(/→ /); // at least one suggestion rendered
  });

  it('sorts failures first and can colourise', () => {
    const text = formatFindings([
      { gate: 'clutter', severity: 'pass', message: 'ok' },
      { gate: 'identity', severity: 'fail', message: 'mismatch', suggestion: 'do this', where: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      { gate: 'contrast', severity: 'warn', message: 'marginal' },
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^FAIL identity/);
    expect(lines[1]).toMatch(/at x0\.10 y0\.20 w0\.30 h0\.40/);
    expect(lines[2]).toMatch(/→ do this/);
    expect(lines[3]).toMatch(/^WARN contrast/);
    expect(lines[4]).toMatch(/^PASS clutter/);

    const coloured = formatFindings([{ gate: 'identity', severity: 'fail', message: 'x' }], { color: true });
    expect(coloured).toContain('[31m');
    expect(formatFindings([])).toBe('No findings.');
  });

  it('summarises an empty report without throwing', async () => {
    const report = await runGates(ctx(await flatBackground('#101014')), { only: [] as string[] });
    expect(summarise(report)).toContain('QA 0/100');
  });
});
