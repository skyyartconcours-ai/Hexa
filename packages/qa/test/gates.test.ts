import { describe, expect, it } from 'vitest';
import type { ReferenceAsset, SafeZone } from '@hexa/core';
import { bandingGate } from '../src/gates/banding.js';
import { clutterGate } from '../src/gates/clutter.js';
import { colorHarmonyGate } from '../src/gates/colorHarmony.js';
import { duplicateGate } from '../src/gates/duplicate.js';
import { facePlacementGate } from '../src/gates/facePlacement.js';
import { licenseGate } from '../src/gates/license.js';
import { safeZoneGate } from '../src/gates/safeZone.js';
import { dHash } from '../src/hash.js';
import {
  busyBackground, cleanComposition, ctx, flatBackground, gradientImage, noiseImage, plan,
} from './helpers.js';

describe('clutterGate', () => {
  it('flags a uniformly noisy frame', async () => {
    const findings = await clutterGate.run(ctx(await noiseImage()));
    const warns = findings.filter((f) => f.severity === 'warn');
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.map((w) => w.message).join(' ')).toMatch(/busy|resting area/);
    expect(warns.every((w) => w.suggestion)).toBe(true);
  });

  it('does not flag a calm composition with one subject', async () => {
    const findings = await clutterGate.run(ctx(await cleanComposition()));
    expect(findings.filter((f) => f.severity !== 'pass')).toEqual([]);
    expect(findings[0]!.message).toMatch(/Focal hierarchy holds|Calm frame/);
  });

  it('never vetoes — clutter is a warning, not a fail', async () => {
    const findings = await clutterGate.run(ctx(await noiseImage()));
    expect(findings.some((f) => f.severity === 'fail')).toBe(false);
  });
});

describe('facePlacementGate', () => {
  const image = () => flatBackground('#161622');

  it('fails a face too small to recognise', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), { subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: { x: 0.4, y: 0.4, w: 0.04, h: 0.05 } }] }),
    );
    expect(findings.some((f) => f.severity === 'fail' && /canvas height/.test(f.message))).toBe(true);
  });

  it('fails a face clipped by the frame edge', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), { subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: { x: -0.05, y: 0.12, w: 0.2, h: 0.28 } }] }),
    );
    expect(findings.some((f) => f.severity === 'fail' && /clipped by the left edge/.test(f.message))).toBe(true);
  });

  it('fails two faces stacked in the centre', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), {
        subjects: [
          { playerId: 'a', handle: 'Peyz', faceRect: { x: 0.42, y: 0.14, w: 0.14, h: 0.24 } },
          { playerId: 'b', handle: 'Ruler', faceRect: { x: 0.47, y: 0.16, w: 0.14, h: 0.24 } },
        ],
      }),
    );
    expect(findings.some((f) => f.severity === 'fail' && /stacked in the middle/.test(f.message))).toBe(true);
  });

  it('passes a well-cut versus composition', async () => {
    // One subject slightly larger and lower than the other: opposed poles with a
    // hero, which is what a cut versus looks like. (Making the two *identical*
    // is the dead-mirror case below.)
    const findings = await facePlacementGate.run(
      ctx(await image(), {
        subjects: [
          { playerId: 'a', handle: 'Peyz', faceRect: { x: 0.15, y: 0.13, w: 0.2, h: 0.31 } },
          { playerId: 'b', handle: 'Ruler', faceRect: { x: 0.67, y: 0.17, w: 0.17, h: 0.26 } },
        ],
      }),
    );
    expect(findings.every((f) => f.severity === 'pass')).toBe(true);
    expect(findings.some((f) => /opposed across the frame/.test(f.message))).toBe(true);
  });

  it('warns when the eye line sits outside the upper third', async () => {
    const findings = await facePlacementGate.run(
      ctx(await image(), { subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: { x: 0.4, y: 0.62, w: 0.18, h: 0.28 } }] }),
    );
    expect(findings.some((f) => f.severity === 'warn' && /eye line/.test(f.message))).toBe(true);
  });
});

describe('safeZoneGate', () => {
  const zones: SafeZone[] = [
    { id: 'duration-badge', rect: { x: 0.78, y: 0.82, w: 0.22, h: 0.18 }, severity: 'hard', reason: 'duration badge sits here' },
    { id: 'lower-third', rect: { x: 0, y: 0.9, w: 0.5, h: 0.1 }, severity: 'soft', reason: 'often cropped in embeds' },
  ];

  const withZones = (textRect: { x: number; y: number; w: number; h: number }) =>
    ctx(Buffer.alloc(0), {
      plan: plan({ meta: { templateId: 't', subjects: [], createdAt: '', safeZones: zones } }),
      textRects: [{ role: 'badge', rect: textRect }],
    });

  it('fails a hard-zone violation', async () => {
    const findings = await safeZoneGate.run(withZones({ x: 0.82, y: 0.86, w: 0.15, h: 0.1 }));
    const fail = findings.find((f) => f.severity === 'fail');
    expect(fail).toBeDefined();
    expect(fail!.message).toMatch(/duration-badge/);
  });

  it('only warns on a soft-zone violation', async () => {
    const findings = await safeZoneGate.run(withZones({ x: 0.05, y: 0.92, w: 0.2, h: 0.06 }));
    expect(findings.some((f) => f.severity === 'fail')).toBe(false);
    expect(findings.some((f) => f.severity === 'warn' && /lower-third/.test(f.message))).toBe(true);
  });

  it('passes an element clear of every zone', async () => {
    const findings = await safeZoneGate.run(withZones({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }));
    expect(findings.every((f) => f.severity === 'pass')).toBe(true);
  });

  it('falls back to YouTube defaults, warning only, when the plan declares none', async () => {
    const findings = await safeZoneGate.run(
      ctx(Buffer.alloc(0), { textRects: [{ role: 'stat', rect: { x: 0.85, y: 0.88, w: 0.12, h: 0.08 } }] }),
    );
    expect(findings.some((f) => f.severity === 'fail')).toBe(false);
    expect(findings.some((f) => /yt-duration-pill/.test(f.message))).toBe(true);
    expect(findings.some((f) => /declares no safe zones/.test(f.message))).toBe(true);
  });
});

describe('licenseGate', () => {
  const asset = (over: Partial<ReferenceAsset['provenance']> = {}): ReferenceAsset => ({
    id: 'asset-1',
    playerId: 'peyz',
    kind: 'portrait',
    path: 'kr/peyz/portrait-01.jpg',
    metrics: { width: 1000, height: 1400, sharpness: 90, brightness: 120, contrast: 0.4, quality: 82 },
    provenance: { source: 'Some Blog', license: 'unverified', addedAt: '2026-01-01', cleared: false, ...over },
    tags: [],
  });

  const subjects = (a: ReferenceAsset) => [{ playerId: 'peyz', handle: 'Peyz', assets: [a] }];

  it('fails an uncleared asset when the request requires cleared licences', async () => {
    const findings = await licenseGate.run(
      ctx(Buffer.alloc(0), { subjects: subjects(asset()), request: { requireClearedLicense: true } }),
    );
    const fail = findings.find((f) => f.severity === 'fail')!;
    expect(fail.message).toMatch(/asset-1/);
    expect(fail.message).toMatch(/kr\/peyz\/portrait-01\.jpg/);
    expect(fail.suggestion).toMatch(/hexa assets clear asset-1/);
  });

  it('only warns when the request does not require cleared licences', async () => {
    const findings = await licenseGate.run(ctx(Buffer.alloc(0), { subjects: subjects(asset()) }));
    expect(findings.some((f) => f.severity === 'fail')).toBe(false);
    expect(findings.some((f) => f.severity === 'warn')).toBe(true);
  });

  it('passes a cleared press-kit asset', async () => {
    const findings = await licenseGate.run(
      ctx(Buffer.alloc(0), {
        subjects: subjects(asset({ license: 'press-kit', cleared: true, source: 'LCK Media Kit 2026' })),
        request: { requireClearedLicense: true },
      }),
    );
    expect(findings.every((f) => f.severity === 'pass')).toBe(true);
  });
});

describe('bandingGate', () => {
  it('warns on an undithered 8-bit ramp and suggests grain', async () => {
    const findings = await bandingGate.run(ctx(await gradientImage(), { plan: plan({ grade: { grain: 0 } }) }));
    expect(findings[0]!.severity).toBe('warn');
    expect(findings[0]!.message).toMatch(/banding/);
    expect(findings[0]!.suggestion).toMatch(/grain/);
  });

  it('does not fire on noise or on flat colour', async () => {
    expect((await bandingGate.run(ctx(await noiseImage())))[0]!.severity).toBe('pass');
    expect((await bandingGate.run(ctx(await flatBackground('#123456'))))[0]!.severity).toBe('pass');
  });
});

describe('duplicateGate', () => {
  it('warns when a sibling variant is the same picture', async () => {
    const image = await cleanComposition();
    const hash = await dHash(image);
    const findings = await duplicateGate.run(
      ctx(image, {
        plan: plan({ meta: { templateId: 't', subjects: [], createdAt: '', variantId: 'v2', siblingHashes: [hash] } }),
      }),
    );
    expect(findings[0]!.severity).toBe('warn');
    expect(findings[0]!.message).toMatch(/near-identical/);
    expect(findings[0]!.suggestion).toMatch(/structural/);
  });

  it('passes when the siblings are genuinely different', async () => {
    const other = await dHash(await busyBackground(120));
    const findings = await duplicateGate.run(
      ctx(await cleanComposition(), {
        plan: plan({ meta: { templateId: 't', subjects: [], createdAt: '', siblingHashes: [other] } }),
      }),
    );
    expect(findings[0]!.severity).toBe('pass');
    expect(findings[0]!.message).toMatch(/genuinely distinct/);
  });

  it('reports the hash when there is nothing to compare against', async () => {
    const findings = await duplicateGate.run(ctx(await cleanComposition()));
    expect(findings[0]!.severity).toBe('pass');
    expect(findings[0]!.message).toMatch(/^dHash [0-9a-f]{16}/);
  });
});

describe('colorHarmonyGate', () => {
  it('warns that a desaturated frame is muddy', async () => {
    const findings = await colorHarmonyGate.run(ctx(await flatBackground('#6E6E72')));
    expect(findings.some((f) => f.severity === 'warn' && /muddy/.test(f.message))).toBe(true);
  });

  it('warns when the two declared accents are indistinguishable', async () => {
    const findings = await colorHarmonyGate.run(
      ctx(await cleanComposition(), {
        plan: plan({
          meta: { templateId: 't', subjects: [], createdAt: '', palette: { left: '#D02020', right: '#D42626' } },
        }),
      }),
    );
    expect(findings.some((f) => /hard to tell apart/.test(f.message))).toBe(true);
  });

  it('accepts a two-colour composition with real chroma', async () => {
    const findings = await colorHarmonyGate.run(
      ctx(await busyBackground(150), {
        plan: plan({
          meta: { templateId: 't', subjects: [], createdAt: '', palette: { left: '#E03A2F', right: '#2F6BE0' } },
        }),
      }),
    );
    expect(findings.some((f) => /hard to tell apart/.test(f.message))).toBe(false);
  });
});
