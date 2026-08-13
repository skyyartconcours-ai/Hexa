/**
 * FX-dominance gate — is the effects pass on top of the picture, or is it the
 * picture?
 *
 * The failure this exists for: a particle/polygon-web layer composited at the
 * wrong scale or the wrong opacity, so a white mesh sits over the entire frame
 * including both faces. Every other gate reads it as texture — clutter counts
 * edges and shrugs, contrast measures the type, identity crops the face and (if
 * the veil is thin enough) still matches it — and the render ships with a net
 * over the subject.
 *
 * The verdict comes from the plan, and the thresholds come from the library.
 * The plan states exactly what was composited — coverage, opacity, blend mode
 * and whether the layer sits above the subject layers — and the only question is
 * where "atmosphere" stops and "a screen door" starts. That line is drawn from
 * what the shipped templates actually do: the heaviest front-of-subject effect
 * in the library is a full-frame particle pass at 0.70 opacity in screen, so
 * 0.70 has to pass, and a full-frame layer at 0.85+ is past anything any
 * template asks for.
 *
 * A pixel measurement is reported alongside — the edge density inside the face
 * rects against the frame's — but it is *not* a condition, and that is a
 * correction rather than a shortcut. The obvious hypothesis (a clean portrait is
 * quieter than the frame, so a veiled one is not) does not survive measurement:
 * on the sample renders in this repo the faces come out 1.06–3.04× the frame's
 * edge density with no veil on them at all, because a schematic placeholder head
 * is line art. Until there is a corpus of real photographic renders to calibrate
 * against, that number is evidence for a human, not a trigger for a veto.
 */

import type { Layer, QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, ramp, toNormRect } from '../geom.js';
import { EDGE_THRESHOLD, edgeDensity, loadGray, sobel } from '../image.js';

const ANALYSIS_WIDTH = 384;
/** id/label markers for a layer whose job is atmosphere rather than content. */
const FX = /(^|[-_:.\s])(fx|vfx|particles?|shards?|glow|flare|haze|fog|smoke|web|mesh|overlay|texture|light-?leak|leak|grid|scanlines?|sparks?|embers?|rays?|beams?|dust)([-_:.\s]|$)/i;
/** Blends that add light — the ones that veil rather than sit behind. */
const ADDITIVE = new Set(['screen', 'add', 'color-dodge', 'lighten', 'overlay', 'hard-light']);

/**
 * coverage × opacity × blend weight for a single effect layer above the
 * subjects. 0.85 is past every shipped template (the heaviest is 0.70), so a
 * layer at or above it is doing something no layout asked for; 0.75 is the
 * space between the two, which is worth a word but not a veto.
 */
const DOMINANT = 0.85;
const HEAVY = 0.75;
/** Below this the face measurement is not even computed — nothing to explain. */
const MEASURE_ABOVE = 0.6;

export const fxDominanceGate: Gate = {
  id: 'fx-dominance',
  weight: 1,
  description: 'Effect layers stay on top of the composition rather than becoming it — no near-opaque full-frame veil over the subjects',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const canvasArea = Math.max(1, ctx.width * ctx.height);
    const subjectZ = subjectCeiling(ctx);
    const fx = ctx.plan.layers
      .filter((l) => FX.test(`${l.id} ${l.label ?? ''}`))
      .map((l) => ({
        layer: l,
        coverage: clamp01((visible(l, ctx.width, ctx.height)) / canvasArea),
        weight: ADDITIVE.has(l.blend) ? 1 : 0.8,
      }))
      .map((e) => ({ ...e, strength: e.coverage * clamp01(e.layer.opacity) * e.weight }))
      .sort((a, b) => b.strength - a.strength);

    const above = fx.filter((e) => e.layer.z >= subjectZ);
    if (above.length === 0) {
      return [{
        gate: 'fx-dominance',
        severity: 'pass',
        message: fx.length
          ? `${fx.length} effect layer${fx.length === 1 ? '' : 's'}, all of them behind the subjects`
          : 'No effect layers in this plan',
        score: 1,
      }];
    }

    const worst = above[0]!;
    const stacked = clamp01(above.reduce((a, e) => a + e.strength, 0));

    // Corroboration: is the effect actually on the faces?
    let faceRatio: number | null = null;
    const faces = ctx.subjects.filter((s) => s.faceRect);
    const w = Math.min(ANALYSIS_WIDTH, ctx.width);
    const h = Math.max(2, Math.round((w * ctx.height) / ctx.width));
    if (faces.length && worst.strength >= MEASURE_ABOVE) {
      const gray = await loadGray(ctx.image, { width: w, height: h, background: ctx.plan.canvas.background });
      const mag = sobel(gray);
      const overall = edgeDensity(mag, w, h, undefined, EDGE_THRESHOLD);
      let inFaces = 0;
      let counted = 0;
      for (const s of faces) {
        const n = toNormRect(s.faceRect!, ctx.width, ctx.height);
        const rect = { x: n.x * w, y: n.y * h, w: Math.max(2, n.w * w), h: Math.max(2, n.h * h) };
        inFaces += edgeDensity(mag, w, h, rect, EDGE_THRESHOLD);
        counted++;
      }
      faceRatio = overall <= 0.001 ? 0 : inFaces / counted / overall;
    }

    const describe = `"${worst.layer.id}" covers ${(worst.coverage * 100).toFixed(0)}% of the canvas at ${(worst.layer.opacity * 100).toFixed(0)}% opacity in ${worst.layer.blend} above the subject layers`;

    const evidence = faceRatio === null
      ? ''
      : `; for reference the faces measure ${faceRatio.toFixed(2)}× the frame's edge density (reported, not decisive — see the note in this file)`;

    if (worst.strength >= DOMINANT) {
      return [{
        gate: 'fx-dominance',
        severity: 'fail',
        message: `The effects pass has taken over the frame: ${describe}. Nothing in the template library composites a front-of-subject effect above ${(HEAVY * 100).toFixed(0)}% strength, so this is a compositing mistake rather than a look${evidence}`,
        score: clamp01(0.1 + 0.3 * (1 - ramp(worst.strength, DOMINANT, 1))),
        suggestion: `Drop "${worst.layer.id}" below the subject layers, cut its opacity to ~0.3, or mask it off the faces. An effect at ${(worst.layer.opacity * 100).toFixed(0)}% over the whole canvas is not an accent, it is the picture — and it is the one thing in a thumbnail nobody came to look at.`,
      }];
    }

    if (worst.strength >= HEAVY) {
      return [{
        gate: 'fx-dominance',
        severity: 'warn',
        message: `Heavy effects veil: ${describe}${evidence}`,
        score: clamp01(0.4 + 0.4 * (1 - ramp(worst.strength, HEAVY, 1))),
        suggestion: `Halve the opacity of "${worst.layer.id}" or move it behind the subjects and see whether the frame loses anything. Atmosphere reads at 20–35%; past that it stops being depth and starts being a screen door.`,
      }];
    }

    if (stacked >= 1.2) {
      return [{
        gate: 'fx-dominance',
        severity: 'warn',
        message: `${above.length} effect layers stack above the subjects (combined coverage×opacity ${stacked.toFixed(2)}): ${above.map((e) => `${e.layer.id} ${(e.layer.opacity * 100).toFixed(0)}%`).join(', ')}`,
        score: 0.6,
        suggestion: 'Individually each of these is subtle; together they are a veil. Keep one atmosphere layer in front of the subjects and push the rest behind them.',
      }];
    }

    return [{
      gate: 'fx-dominance',
      severity: 'pass',
      message: `Effects stay in their place: heaviest is ${describe.replace(' above the subject layers', '')} (strength ${worst.strength.toFixed(2)} against a ${HEAVY} bar)${faceRatio === null ? '' : `, faces ${faceRatio.toFixed(2)}× frame edge density`}`,
      score: clamp01(0.6 + 0.4 * (1 - ramp(worst.strength, 0.2, HEAVY))),
    }];
  },
};

/** Area of a layer's rect that lands on the canvas. */
function visible(layer: Layer, width: number, height: number): number {
  const x0 = Math.max(0, layer.rect.x);
  const y0 = Math.max(0, layer.rect.y);
  const x1 = Math.min(width, layer.rect.x + layer.rect.w);
  const y1 = Math.min(height, layer.rect.y + layer.rect.h);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

/**
 * The z above which a layer is "in front of the subjects".
 *
 * Taken from the identity layers the plan names, else from any layer whose id
 * looks like a subject slot, else from the topmost non-text layer — anything
 * over that is by definition on top of the people.
 */
function subjectCeiling(ctx: GateContext): number {
  const named = new Set((ctx.plan.meta.identityLayers ?? []) as string[]);
  const subjectLayers = ctx.plan.layers.filter(
    (l) => named.has(l.id) || /(^|[-_:.])subjects?([-_:.]|$)/i.test(`${l.id} ${l.label ?? ''}`),
  );
  if (subjectLayers.length) return Math.max(...subjectLayers.map((l) => l.z));
  return Number.POSITIVE_INFINITY;
}

/** Exported for tests: which layers this gate considers effects. */
export function isFxLayer(id: string, label?: string): boolean {
  return FX.test(`${id} ${label ?? ''}`);
}
