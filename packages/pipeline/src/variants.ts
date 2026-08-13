/**
 * Variant planning.
 *
 * The purpose of variants is to hand an editor a *choice*, and a choice needs
 * options that differ in ways a person would name out loud. Reseeding the
 * particle RNG produces eight images that are the same thumbnail; changing the
 * light rig, the grade, the crop and the backdrop produces eight thumbnails.
 *
 * So variants walk a deliberate axis space rather than jittering noise:
 *
 * | Axis              | What it changes                                              | Why it matters |
 * |-------------------|--------------------------------------------------------------|----------------|
 * | `lightRig`        | The named light setup (split rim, top key, uplight, backlit…) | The single biggest driver of mood |
 * | `rim` + angle     | Which side each subject is rimmed from, and in whose colour   | Sells or kills the versus energy |
 * | `lutIndex`/grade  | Colour grade personality (teal-orange, bleach, noir, ember…)  | Reads before any shape does |
 * | `atmosphere`      | Particle kind and density, haze                               | Depth; separates subject from plate |
 * | `backdrop`        | Procedural backdrop treatment                                 | Changes the whole scene, not a filter |
 * | `versusStyle`     | The VS mark's treatment                                       | The graphic signature of the format |
 * | `subjectScale` + `cropTightness` | How much frame the subjects own       | Tight busts survive a 210px render; wide shots show the jersey |
 * | `textArrangement` | How the copy block is stacked                                 | Rebalances the whole composition |
 *
 * **Variant 0 is always the template's own intent, unmodified.** A template
 * author's default has to be reachable, and it is the baseline the others are
 * judged against.
 *
 * Variants 1..n each move along *every* axis at once, indexing each axis list by
 * a different stride that is coprime with that list's length. That is a cheap
 * Latin-square: successive variants land on different combinations rather than
 * cycling one axis while the rest sit still, and no combination repeats until
 * the axis periods coincide (well past `MAX_VARIANTS`).
 *
 * Everything is a pure function of the base seed and the index, so variant 3 of
 * a given request is always the same variant 3.
 */

import { createRng, hashString } from '@hexa/core';
import type { CompileInput, VariantAxes } from './types.js';

/** One axis of the variant space, with its discrete values and its stride. */
export interface VariantAxisSpec {
  name: keyof VariantAxes;
  description: string;
  values: readonly unknown[];
  /** Coprime with `values.length` — see the Latin-square note above. */
  stride: number;
}

/** `'template'`/`undefined` first in every list: that is what variant 0 uses. */
export const VARIANT_AXES: readonly VariantAxisSpec[] = [
  {
    name: 'lightRig',
    description: 'Named light rig — the strongest single lever on mood',
    values: [undefined, 'split-rim', 'top-key', 'under-glow', 'backlit', 'stage', 'neon-wash', 'god-rays', 'ember', 'clean'],
    stride: 3,
  },
  {
    name: 'rim',
    description: 'Rim polarity: opposing team colours, one unified key, or own-colour',
    values: ['opposing', 'unified', 'inverted'],
    stride: 1,
  },
  {
    name: 'gradeBias',
    description: 'Colour grade personality layered over the template grade',
    values: ['template', 'teal-orange', 'crushed', 'bleach', 'noir', 'ember', 'cold-steel'],
    stride: 3,
  },
  {
    name: 'atmosphereKind',
    description: 'Particle system: what is floating in the air',
    values: ['template', 'dust', 'ember', 'spark', 'shard', 'smoke', 'none'],
    stride: 2,
  },
  {
    name: 'backdrop',
    description: 'Procedural backdrop treatment behind the subjects',
    values: [undefined, 'gradient', 'radial', 'arena', 'abstract', 'shatter', 'grid'],
    stride: 5,
  },
  {
    name: 'versusStyle',
    description: 'Treatment of the versus mark',
    values: ['template', 'slash', 'bolt', 'hex', 'clash', 'stencil', 'minimal'],
    stride: 4,
  },
  {
    name: 'cropTightness',
    description: 'How tightly the subject is cropped',
    values: ['template', 'bust', 'chest', 'wide'],
    stride: 1,
  },
  {
    name: 'textArrangement',
    description: 'Arrangement of the copy block within its slots',
    values: ['template', 'stacked', 'offset', 'banner', 'split'],
    stride: 2,
  },
];

/** Number of built-in LUTs a variant will cycle through before repeating. */
const LUT_CYCLE = 6;

/** Axes for variant 0: the template exactly as its author wrote it. */
export function baseAxes(seed: number): VariantAxes {
  return {
    index: 0,
    seed: seed >>> 0,
    rim: 'opposing',
    rimAngleOffset: 0,
    lutIndex: -1,
    lutStrength: 1,
    gradeBias: 'template',
    atmosphereKind: 'template',
    atmosphereDensity: 1,
    haze: 1,
    versusStyle: 'template',
    subjectScale: 1,
    cropTightness: 'template',
    textArrangement: 'template',
  };
}

/**
 * Axes for variant `index` of a run seeded with `baseSeed`.
 *
 * @param index 0 is the template's intent; 1+ walk the axis space
 */
export function variantAxesFor(baseSeed: number, index: number): VariantAxes {
  const seed = variantSeed(baseSeed, index);
  if (index <= 0) return baseAxes(baseSeed);

  const axes = baseAxes(seed);
  axes.index = index;

  for (const spec of VARIANT_AXES) {
    const value = spec.values[(index * spec.stride) % spec.values.length];
    if (value === undefined) continue;
    assign(axes, spec.name, value);
  }

  // Continuous axes. A forked stream per axis keeps them independent: adding an
  // axis later must not shift the values of the ones already there, or every
  // previously rendered variant silently changes.
  const rng = createRng(seed);
  axes.rimAngleOffset = Math.round(rng.fork(1).float(-22, 22));
  axes.lutIndex = index % LUT_CYCLE;
  axes.lutStrength = round2(rng.fork(2).float(0.45, 1));
  axes.atmosphereDensity = round2(rng.fork(3).float(0.55, 1.6));
  axes.haze = round2(rng.fork(4).float(0.6, 1.45));
  axes.subjectScale = round2(rng.fork(5).float(0.93, 1.11));

  return axes;
}

/** Deterministic per-variant seed. Distinct streams, stable across runs. */
export function variantSeed(baseSeed: number, index: number): number {
  return index <= 0 ? baseSeed >>> 0 : ((baseSeed ^ hashString(`hexa:variant:${index}`)) >>> 0);
}

/**
 * Expand a compile input into `count` distinct variants.
 *
 * The returned inputs share subjects and backplate by reference — they are
 * immutable inputs to the compiler, and copying a decoded photograph `count`
 * times would be a real memory cost for no benefit.
 */
export function planVariants(base: CompileInput, count: number): CompileInput[] {
  const total = Math.max(1, Math.trunc(count) || 1);
  const out: CompileInput[] = [];
  for (let i = 0; i < total; i++) {
    const axes = variantAxesFor(base.seed, i);
    out.push({
      ...base,
      seed: axes.seed,
      variant: axes,
      variantId: variantId(i),
    });
  }
  return out;
}

/** `v01`, `v02`… — sorts lexicographically, which keeps output listings tidy. */
export function variantId(index: number): string {
  return `v${String(index + 1).padStart(2, '0')}`;
}

/**
 * One-line description of where a variant sits in the space. Printed by the CLI
 * next to each output so "the third one" can be discussed by name.
 */
export function describeVariant(axes: VariantAxes): string {
  if (axes.index === 0) return 'template default';
  const parts: string[] = [];
  if (axes.lightRig) parts.push(axes.lightRig);
  if (axes.rim !== 'opposing') parts.push(`${axes.rim} rim`);
  if (axes.gradeBias !== 'template') parts.push(axes.gradeBias);
  if (axes.backdrop) parts.push(`${axes.backdrop} bg`);
  if (axes.atmosphereKind !== 'template') {
    parts.push(axes.atmosphereKind === 'none' ? 'no particles' : `${axes.atmosphereKind} ×${axes.atmosphereDensity}`);
  }
  if (axes.cropTightness !== 'template') parts.push(`${axes.cropTightness} crop`);
  if (axes.versusStyle !== 'template') parts.push(`${axes.versusStyle} vs`);
  if (axes.textArrangement !== 'template') parts.push(`${axes.textArrangement} text`);
  return parts.length > 0 ? parts.join(' · ') : `variant ${axes.index}`;
}

function assign(axes: VariantAxes, key: keyof VariantAxes, value: unknown): void {
  (axes as unknown as Record<string, unknown>)[key] = value;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
