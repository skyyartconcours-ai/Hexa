import { describe, expect, it } from 'vitest';
import {
  VARIANT_AXES,
  baseAxes,
  describeVariant,
  planVariants,
  variantAxesFor,
  variantId,
  variantSeed,
} from './variants.js';
import type { CompileInput, VariantAxes } from './types.js';

const SEED = 123456;

/** The axes that carry a named, discrete choice — what an editor would name. */
function fingerprint(a: VariantAxes): string {
  return [a.lightRig ?? '-', a.rim, a.gradeBias, a.atmosphereKind, a.backdrop ?? '-', a.versusStyle, a.cropTightness, a.textArrangement].join('|');
}

describe('variantAxesFor', () => {
  it('leaves variant 0 as the template wrote it', () => {
    const axes = variantAxesFor(SEED, 0);
    expect(axes).toEqual(baseAxes(SEED));
    expect(axes.lightRig).toBeUndefined();
    expect(axes.backdrop).toBeUndefined();
    expect(axes.gradeBias).toBe('template');
    expect(axes.subjectScale).toBe(1);
    expect(axes.rimAngleOffset).toBe(0);
  });

  it('is deterministic for a given seed and index', () => {
    expect(variantAxesFor(SEED, 5)).toEqual(variantAxesFor(SEED, 5));
  });

  it('gives different seeds a different look at the same index', () => {
    expect(variantAxesFor(SEED, 3).seed).not.toBe(variantAxesFor(SEED + 1, 3).seed);
  });

  it('moves along several axes at once, not one at a time', () => {
    // The point of the coprime strides: variant 1 must not be variant 0 with a
    // single knob turned, or the editor is choosing between near-identicals.
    const base = variantAxesFor(SEED, 0);
    const first = variantAxesFor(SEED, 1);
    const changed = [
      first.lightRig !== base.lightRig,
      first.rim !== base.rim,
      first.gradeBias !== base.gradeBias,
      first.atmosphereKind !== base.atmosphereKind,
      first.backdrop !== base.backdrop,
      first.versusStyle !== base.versusStyle,
      first.cropTightness !== base.cropTightness,
      first.textArrangement !== base.textArrangement,
    ].filter(Boolean).length;
    expect(changed).toBeGreaterThanOrEqual(5);
  });

  it('produces a distinct combination for every variant up to the cap', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) seen.add(fingerprint(variantAxesFor(SEED, i)));
    expect(seen.size).toBe(24);
  });

  it('keeps continuous axes inside sane bounds', () => {
    for (let i = 1; i < 24; i++) {
      const a = variantAxesFor(SEED, i);
      expect(a.subjectScale).toBeGreaterThanOrEqual(0.93);
      expect(a.subjectScale).toBeLessThanOrEqual(1.11);
      expect(a.atmosphereDensity).toBeGreaterThan(0.5);
      expect(a.atmosphereDensity).toBeLessThanOrEqual(1.6);
      expect(a.haze).toBeGreaterThan(0.5);
      expect(a.lutStrength).toBeGreaterThan(0);
      expect(a.lutStrength).toBeLessThanOrEqual(1);
      expect(Math.abs(a.rimAngleOffset)).toBeLessThanOrEqual(22);
    }
  });

  it('only picks values the axis table declares', () => {
    const declared = new Map(VARIANT_AXES.map((a) => [a.name, a.values]));
    for (let i = 0; i < 24; i++) {
      const axes = variantAxesFor(SEED, i) as unknown as Record<string, unknown>;
      for (const [name, values] of declared) {
        const value = axes[name];
        if (value === undefined) continue;
        expect(values, `${name} produced an undeclared value: ${String(value)}`).toContain(value);
      }
    }
  });

  it('treats a negative index as variant 0', () => {
    expect(variantAxesFor(SEED, -1)).toEqual(baseAxes(SEED));
  });
});

describe('variantSeed', () => {
  it('keeps variant 0 on the base seed', () => {
    expect(variantSeed(SEED, 0)).toBe(SEED);
  });

  it('gives every variant its own stream', () => {
    const seeds = new Set(Array.from({ length: 24 }, (_, i) => variantSeed(SEED, i)));
    expect(seeds.size).toBe(24);
  });

  it('stays a uint32', () => {
    for (let i = 0; i < 24; i++) {
      const s = variantSeed(SEED, i);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('planVariants', () => {
  const base = { seed: SEED, template: { id: 't' }, subjects: [] } as unknown as CompileInput;

  it('produces the requested count with stable ids', () => {
    const plans = planVariants(base, 4);
    expect(plans).toHaveLength(4);
    expect(plans.map((p) => p.variantId)).toEqual(['v01', 'v02', 'v03', 'v04']);
  });

  it('starts from the template default', () => {
    expect(planVariants(base, 3)[0]?.variant?.index).toBe(0);
    expect(planVariants(base, 3)[0]?.seed).toBe(SEED);
  });

  it('carries a distinct seed per variant', () => {
    const seeds = planVariants(base, 8).map((p) => p.seed);
    expect(new Set(seeds).size).toBe(8);
  });

  it('does not mutate the input', () => {
    const snapshot = JSON.stringify(base);
    planVariants(base, 5);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('coerces a nonsense count to a single variant', () => {
    expect(planVariants(base, 0)).toHaveLength(1);
    expect(planVariants(base, Number.NaN)).toHaveLength(1);
    expect(planVariants(base, -3)).toHaveLength(1);
  });

  it('shares subjects by reference rather than copying decoded photographs', () => {
    const subjects = [{ index: 0 }] as unknown as CompileInput['subjects'];
    const plans = planVariants({ ...base, subjects }, 3);
    for (const plan of plans) expect(plan.subjects).toBe(subjects);
  });
});

describe('variantId', () => {
  it('zero-pads so outputs sort correctly', () => {
    expect(variantId(0)).toBe('v01');
    expect(variantId(9)).toBe('v10');
    expect([variantId(9), variantId(0)].sort()).toEqual(['v01', 'v10']);
  });
});

describe('describeVariant', () => {
  it('names the baseline plainly', () => {
    expect(describeVariant(baseAxes(SEED))).toBe('template default');
  });

  it('names the axes that actually moved', () => {
    const description = describeVariant(variantAxesFor(SEED, 1));
    expect(description).not.toBe('template default');
    expect(description.length).toBeGreaterThan(0);
    expect(description).not.toContain('undefined');
  });
});
