/**
 * Adversarial suite: bad thumbnails the gates used to pass.
 *
 * Every case here is paired with the good render it must be distinguished from.
 * The pairing is the whole point — a detector that fires on the defect *and* on
 * its healthy twin has detected nothing, and the second half of each test is the
 * one that keeps the gate honest.
 */

import { describe, expect, it } from 'vitest';
import type { ReferenceAsset, RenderPlan } from '@hexa/core';
import { facePlacementGate } from '../src/gates/facePlacement.js';
import { fxDominanceGate } from '../src/gates/fxDominance.js';
import { likenessGate } from '../src/gates/likeness.js';
import { subjectClarityGate } from '../src/gates/subjectClarity.js';
import { ctx, flatBackground, plan, subjectOnField, H, W } from './helpers.js';

const fails = (f: { severity: string }[]) => f.filter((x) => x.severity === 'fail');
const warns = (f: { severity: string }[]) => f.filter((x) => x.severity === 'warn');

// ── 2. a face darker than everything around it ──────────────────────────────

describe('subject-clarity: inverted value structure', () => {
  const FACE = { x: 0.14, y: 0.2, w: 0.18, h: 0.26 };

  it('fails a face that is the darkest thing in its half of the frame', async () => {
    const image = await subjectOnField({ faceRect: FACE, subjectLuma: 26, bgLuma: 150 });
    const findings = await subjectClarityGate.run(
      ctx(image, { subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: FACE }] }),
    );

    const fail = fails(findings)[0];
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/darkest thing in the left half/);
    expect(fail!.message).toMatch(/reads as a hole/);
    expect(fail!.suggestion).toMatch(/rim light|scrim|darken the plate/);
  });

  it('does NOT fire on the same face lit against a dark plate', async () => {
    const image = await subjectOnField({ faceRect: FACE, subjectLuma: 175, bgLuma: 34 });
    const findings = await subjectClarityGate.run(
      ctx(image, { subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: FACE }] }),
    );
    expect(fails(findings)).toEqual([]);
  });

  it('does NOT fire on a legitimately dark, low-key grade where the face still reads', async () => {
    // Everything is dark; the face is merely the least dark thing in its half.
    const image = await subjectOnField({ faceRect: FACE, subjectLuma: 78, bgLuma: 40 });
    const findings = await subjectClarityGate.run(
      ctx(image, { subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: FACE }] }),
    );
    expect(fails(findings)).toEqual([]);
  });
});

// ── 5. two faces that become mush at feed size ──────────────────────────────

describe('subject-clarity: collapse at 168×94', () => {
  const LEFT = { x: 0.16, y: 0.2, w: 0.16, h: 0.24 };
  const RIGHT = { x: 0.68, y: 0.2, w: 0.16, h: 0.24 };

  it('fails two faces that are the same pixels once downscaled to the sidebar', async () => {
    // Identical subjects, mirrored: fine at 1280×720, one repeated smudge at 168×94.
    const image = await subjectOnField({
      faceRect: LEFT, faceRect2: RIGHT, subjectLuma: 120, subjectLuma2: 120, bgLuma: 60, detail: false,
    });
    const findings = await subjectClarityGate.run(
      ctx(image, {
        subjects: [
          { playerId: 'a', handle: 'Peyz', faceRect: LEFT },
          { playerId: 'b', handle: 'Viper', faceRect: RIGHT },
        ],
      }),
    );

    const fail = fails(findings);
    expect(fail.length).toBeGreaterThan(0);
    expect(fail.map((f) => f.message).join(' ')).toMatch(/same pixels at feed size|collapsed to a smudge/);
  });

  it('does NOT fire on two subjects that stay distinct at feed size', async () => {
    const image = await subjectOnField({
      faceRect: LEFT, faceRect2: RIGHT, subjectLuma: 200, subjectLuma2: 96, bgLuma: 40,
    });
    const findings = await subjectClarityGate.run(
      ctx(image, {
        subjects: [
          { playerId: 'a', handle: 'Peyz', faceRect: LEFT },
          { playerId: 'b', handle: 'Viper', faceRect: RIGHT },
        ],
      }),
    );
    expect(fails(findings)).toEqual([]);
  });
});

// ── 3. dead mirror symmetry ─────────────────────────────────────────────────

describe('face-placement: dead mirror', () => {
  const image = () => flatBackground('#161622');

  it('warns when two subjects are identical in scale and height', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), {
        subjects: [
          { playerId: 'a', handle: 'Peyz', faceRect: { x: 0.16, y: 0.14, w: 0.18, h: 0.28 } },
          { playerId: 'b', handle: 'Viper', faceRect: { x: 0.66, y: 0.14, w: 0.18, h: 0.28 } },
        ],
      }),
    );

    const warn = warns(findings).find((f) => /dead mirror/.test(f.message));
    expect(warn).toBeDefined();
    expect(warn!.suggestion).toMatch(/Break the symmetry/);
    // A mirror is inert, not broken: it must never veto a render.
    expect(fails(findings)).toEqual([]);
  });

  it('does NOT warn once one subject is the hero', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), {
        subjects: [
          { playerId: 'a', handle: 'Peyz', faceRect: { x: 0.15, y: 0.13, w: 0.2, h: 0.31 } },
          { playerId: 'b', handle: 'Viper', faceRect: { x: 0.67, y: 0.17, w: 0.17, h: 0.26 } },
        ],
      }),
    );
    expect(findings.every((f) => f.severity === 'pass')).toBe(true);
  });
});

// ── 6. text over the eyes ───────────────────────────────────────────────────

describe('face-placement: type across the features', () => {
  const FACE = { x: 0.3, y: 0.15, w: 0.2, h: 0.3 };
  const image = () => flatBackground('#161622');

  it('fails a headline printed across the eye band', async () => {
    // Eye band of that face: y 0.225–0.315.
    const findings = await facePlacementGate.run(
      ctx(await image(), {
        subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: FACE }],
        textRects: [{ role: 'headline', rect: { x: 0.2, y: 0.24, w: 0.5, h: 0.07 } }],
      }),
    );

    const fail = fails(findings)[0];
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/printed across Peyz's eyes/);
    expect(fail!.suggestion).toMatch(/eyes are the one part of a face/);
  });

  it('warns rather than fails for type across the mouth', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), {
        subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: FACE }],
        textRects: [{ role: 'kicker', rect: { x: 0.2, y: 0.36, w: 0.5, h: 0.05 } }],
      }),
    );
    expect(fails(findings)).toEqual([]);
    expect(warns(findings).some((f) => /across Peyz's mouth/.test(f.message))).toBe(true);
  });

  it('does NOT fire on a lower-third headline below the same face', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), {
        subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: FACE }],
        textRects: [{ role: 'headline', rect: { x: 0.1, y: 0.72, w: 0.6, h: 0.12 } }],
      }),
    );
    expect(findings.every((f) => f.severity === 'pass')).toBe(true);
  });
});

// ── 4. an effects layer that has become the picture ─────────────────────────

function fxPlan(over: { opacity: number; z: number; coverage?: number }): RenderPlan {
  const cov = over.coverage ?? 1;
  return plan({
    layers: [
      {
        id: 'subject-0-left', source: { type: 'solid', color: '#888' },
        rect: { x: 100, y: 100, w: 400, h: 500 }, z: 2010, opacity: 1, blend: 'over',
      },
      {
        id: 'subject-1-right', source: { type: 'solid', color: '#888' },
        rect: { x: 800, y: 100, w: 400, h: 500 }, z: 2020, opacity: 1, blend: 'over',
      },
      {
        id: 'fx-particles-front', source: { type: 'generated', generatorId: 'particles', params: {} },
        rect: { x: 0, y: 0, w: Math.round(W * cov), h: H }, z: over.z, opacity: over.opacity, blend: 'screen',
      },
    ],
  });
}

describe('fx-dominance', () => {
  const FACES = [
    { playerId: 'a', handle: 'Peyz', faceRect: { x: 0.14, y: 0.16, w: 0.16, h: 0.24 } },
    { playerId: 'b', handle: 'Viper', faceRect: { x: 0.68, y: 0.16, w: 0.16, h: 0.24 } },
  ];

  /** A white polygon web over the whole frame, faces included. */
  async function webbed(): Promise<Buffer> {
    const lines: string[] = [];
    for (let i = -20; i < 40; i++) {
      lines.push(`<line x1="${i * 48}" y1="0" x2="${i * 48 + 700}" y2="${H}" stroke="#FFFFFF" stroke-width="3"/>`);
      lines.push(`<line x1="0" y1="${i * 34}" x2="${W}" y2="${i * 34 + 260}" stroke="#FFFFFF" stroke-width="2"/>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#101018"/>
      <ellipse cx="${W * 0.22}" cy="${H * 0.28}" rx="${W * 0.08}" ry="${H * 0.12}" fill="#C8B49A"/>
      <ellipse cx="${W * 0.76}" cy="${H * 0.28}" rx="${W * 0.08}" ry="${H * 0.12}" fill="#9A8C7A"/>
      ${lines.join('')}</svg>`;
    return (await import('sharp')).default(Buffer.from(svg)).png().toBuffer();
  }

  it('fails a near-opaque full-frame effect layer drawn over the subjects', async () => {
    const findings = await fxDominanceGate.run(
      ctx(await webbed(), { plan: fxPlan({ opacity: 0.95, z: 3000 }), subjects: FACES }),
    );

    const fail = fails(findings)[0];
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/effects pass has taken over the frame/);
    expect(fail!.message).toMatch(/fx-particles-front/);
    expect(fail!.suggestion).toMatch(/below the subject layers|opacity/);
  });

  it('does NOT fail the same layer at a normal atmosphere opacity', async () => {
    const findings = await fxDominanceGate.run(
      ctx(await webbed(), { plan: fxPlan({ opacity: 0.3, z: 3000 }), subjects: FACES }),
    );
    expect(fails(findings)).toEqual([]);
  });

  it('does NOT fail an opaque effect layer that sits behind the subjects', async () => {
    const findings = await fxDominanceGate.run(
      ctx(await webbed(), { plan: fxPlan({ opacity: 0.95, z: 5 }), subjects: FACES }),
    );
    expect(fails(findings)).toEqual([]);
    expect(findings[0]!.message).toMatch(/behind the subjects/);
  });
});

// ── 7. a placeholder shipped under a player's name ──────────────────────────

function placeholderAsset(): ReferenceAsset {
  return {
    id: 'placeholder:peyz',
    playerId: 'peyz',
    kind: 'portrait',
    path: 'generated/placeholders/peyz.png',
    metrics: { width: 900, height: 1200, sharpness: 0, brightness: 0, contrast: 0, quality: 0 },
    provenance: {
      source: 'Hexa synthetic placeholder',
      license: 'owned',
      cleared: true,
      addedAt: new Date(0).toISOString(),
      notes: 'Generated schematic stand-in. Contains no photographic likeness.',
    },
    tags: ['placeholder', 'synthetic', 'no-identity'],
  } as ReferenceAsset;
}

describe('likeness', () => {
  it('fails, loudly, a render that names a player and shows a placeholder', async () => {
    const findings = await likenessGate.run(
      ctx(await flatBackground('#101018'), {
        subjects: [{ playerId: 'peyz', handle: 'Peyz', faceRect: { x: 0.2, y: 0.2, w: 0.2, h: 0.3 }, assets: [placeholderAsset()] }],
      }),
    );

    const fail = fails(findings)[0];
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/does not depict Peyz/);
    expect(fail!.message).toMatch(/no photographic likeness/);
    expect(fail!.score).toBe(0);
    expect(fail!.suggestion).toMatch(/assets ingest|mark that subject anonymous/);
  });

  it('catches it from the plan alone when the caller passes no assets', async () => {
    // What the pipeline actually records; a caller that forgets `assets` must
    // not be able to launder a placeholder render into a pass.
    const findings = await likenessGate.run(
      ctx(await flatBackground('#101018'), {
        plan: plan({ meta: { templateId: 't', subjects: ['peyz'], createdAt: '', placeholders: ['peyz'] } }),
        subjects: [{ playerId: 'peyz', handle: 'Peyz' }],
      }),
    );
    expect(fails(findings).length).toBeGreaterThan(0);
  });

  it('accepts a declared anonymous treatment without pretending it is verified', async () => {
    const findings = await likenessGate.run(
      ctx(await flatBackground('#101018'), {
        subjects: [{ playerId: 'x', handle: 'Silhouette', anonymous: true, assets: [placeholderAsset()] }],
      }),
    );
    expect(fails(findings)).toEqual([]);
    expect(findings[0]!.message).toMatch(/no likeness claimed/);
  });

  it('does NOT fire on a real photographic asset', async () => {
    const real = { ...placeholderAsset(), id: 'peyz-01', path: 'peyz/01.jpg', tags: ['press-kit'],
      provenance: { source: 'Riot press kit', license: 'press-kit', cleared: true, addedAt: new Date(0).toISOString() } } as ReferenceAsset;
    const findings = await likenessGate.run(
      ctx(await flatBackground('#101018'), {
        subjects: [{ playerId: 'peyz', handle: 'Peyz', assets: [real] }],
      }),
    );
    expect(fails(findings)).toEqual([]);
    expect(findings[0]!.message).toMatch(/rendered from real reference photography/);
  });
});
