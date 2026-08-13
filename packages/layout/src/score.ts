/**
 * Composition scoring.
 *
 * Bad face placement is the number one reason an esports thumbnail reads as
 * amateur. This module encodes the rules a good designer applies without
 * thinking, as eight weighted parts that each return 0–1 and each emit an
 * ACTIONABLE finding when they are unhappy. The weights below sum to 100 and
 * are the package's design opinion — they are exported so a caller can audit or
 * re-tune them.
 *
 * Weight rationale
 * ----------------
 *  faceSize      18  A thumbnail is judged at 210×118 in a search grid. A face
 *                    under ~9% of canvas height is a smudge there — no amount
 *                    of grading rescues it. Highest weight because it is both
 *                    the most common failure and the most fatal.
 *  facePlacement 16  Thirds/golden anchoring is the difference between a
 *                    designed frame and a screenshot. Also carries the
 *                    "two faces stacked on the centre line" veto, which is the
 *                    classic broken versus.
 *  facing        14  A subject looking OUT of frame throws the viewer's eye off
 *                    the canvas and kills the confrontation a versus is selling.
 *                    Weighted like a first-class rule because it is one, and
 *                    because the fix is free (mirror the cutout). Aggregated
 *                    worst-first, so one offender is not averaged away.
 *  balance       12  Lopsided visual mass reads as a mistake rather than a
 *                    choice — unless the layout declares the asymmetry, in
 *                    which case the check relaxes instead of fighting the design.
 *  separation    12  Overlapping faces merge two people into one blob; text
 *                    across a face destroys both. Legibility over everything.
 *  headroom      10  Cropped skulls and floating heads. Lower than faceSize
 *                    because `fitSubject` already defends the crown; this is
 *                    the backstop for hand-authored plans.
 *  textFit       10  Text off-canvas or across a face. Slightly lower than
 *                    separation because typography can be re-flowed cheaply.
 *  hierarchy      8  Does the frame have a lead element and does content
 *                    actually sit on the declared focal points? Real, but
 *                    softer and more subjective than the rest.
 *
 * `parts` values are 0–1 sub-scores (1 = ideal), matching QaFinding.score.
 * `total` is Σ weightᵢ · partᵢ, rounded, so it lands in 0–100.
 */

import type { PixelRect, QaFinding, SlotKind } from '@hexa/core';
import {
  GOLDEN,
  THIRDS,
  clamp,
  distanceToNearest,
  intersect,
  normaliseRect,
  overlapRatio,
  rectArea,
  rectCenter,
  smoothstep,
} from '@hexa/core';
import type { ResolvedLayout } from './resolve.js';

export const COMPOSITION_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  faceSize: 18,
  facePlacement: 16,
  facing: 14,
  balance: 12,
  separation: 12,
  headroom: 10,
  textFit: 10,
  hierarchy: 8,
});

/* --- tuning constants, all in normalised canvas units ------------------- */

/** Below this fraction of canvas height a face is unreadable at 210×118. */
export const FACE_MIN_HEIGHT = 0.09;
/** Comfortable lower bound — below this it works but is not doing any selling. */
const FACE_GOOD_LO = 0.16;
/** Above this a face starts crowding the frame. */
const FACE_GOOD_HI = 0.42;
/** Above this the face is oppressive and leaves nowhere for text. */
export const FACE_MAX_HEIGHT = 0.55;
/** Faces this close to a canvas edge look accidental. */
const EDGE_MARGIN = 0.04;
/** Two faces closer than this to the centre line on the stacking axis. */
const CENTRE_CLUSTER = 0.12;

/** Attention multiplier for a face: eyes pull far harder than raw area. */
const FACE_MASS_GAIN = 2.5;

const KIND_MASS: Readonly<Record<SlotKind, number>> = Object.freeze({
  subject: 1.0,
  text: 0.75,
  logo: 0.5,
  badge: 0.5,
  shape: 0.3,
  fx: 0.15,
  backplate: 0.0,
});

export interface ScoredFace {
  slotId: string;
  rect: PixelRect;
  facing?: 'left' | 'right' | 'front';
}

export interface ScoreCompositionInput {
  layout: ResolvedLayout;
  faces: ScoredFace[];
  textRects?: { slotId: string; rect: PixelRect }[];
}

export interface CompositionScore {
  /** 0–100. */
  total: number;
  /** Per-part 0–1 sub-scores, keyed like COMPOSITION_WEIGHTS. */
  parts: Record<string, number>;
  findings: QaFinding[];
}

interface PartResult {
  score: number;
  findings: QaFinding[];
}

export function scoreComposition(input: ScoreCompositionInput): CompositionScore {
  const { layout } = input;
  const { width, height } = layout.canvas;
  const faces = input.faces ?? [];
  const textRects = input.textRects ?? [];
  const n = (r: PixelRect) => normaliseRect(r, width, height);

  const results: Record<string, number> = {};
  const findings: QaFinding[] = [];

  const register = (name: string, part: PartResult) => {
    results[name] = round3(clamp(part.score, 0, 1));
    findings.push(...part.findings);
  };

  register('faceSize', scoreFaceSize(faces, height, n));
  register('facePlacement', scoreFacePlacement(faces, layout, n));
  register('facing', scoreFacing(faces, width, n));
  register('balance', scoreBalance(faces, layout));
  register('separation', scoreSeparation(faces, textRects, n));
  register('headroom', scoreHeadroom(faces, height, n));
  register('textFit', scoreTextFit(textRects, faces, layout, n));
  register('hierarchy', scoreHierarchy(faces, layout));

  let total = 0;
  for (const [name, weight] of Object.entries(COMPOSITION_WEIGHTS)) {
    total += weight * (results[name] ?? 0);
  }
  return { total: Math.round(clamp(total, 0, 100)), parts: results, findings };
}

/* ------------------------------------------------------------------------ */
/* parts                                                                     */
/* ------------------------------------------------------------------------ */

/** faceSize — is the face readable in a search grid, without swallowing it? */
function scoreFaceSize(faces: ScoredFace[], canvasH: number, n: (r: PixelRect) => PixelRect): PartResult {
  if (faces.length === 0) return neutral();
  const findings: QaFinding[] = [];
  let sum = 0;
  for (const f of faces) {
    const frac = f.rect.h / canvasH;
    let s: number;
    if (frac < FACE_MIN_HEIGHT) {
      s = 0.25 * smoothstep(0, FACE_MIN_HEIGHT, frac);
    } else if (frac < FACE_GOOD_LO) {
      s = 0.25 + 0.75 * smoothstep(FACE_MIN_HEIGHT, FACE_GOOD_LO, frac);
    } else if (frac <= FACE_GOOD_HI) {
      s = 1;
    } else if (frac <= FACE_MAX_HEIGHT) {
      s = 1 - 0.3 * smoothstep(FACE_GOOD_HI, FACE_MAX_HEIGHT, frac);
    } else {
      s = 0.7 - 0.7 * smoothstep(FACE_MAX_HEIGHT, 0.85, frac);
    }
    sum += s;

    if (frac < FACE_MIN_HEIGHT) {
      findings.push({
        gate: 'composition.faceSize',
        severity: 'fail',
        message: `Face in "${f.slotId}" is ${(frac * 100).toFixed(1)}% of canvas height — unreadable at YouTube's 210×118 grid size.`,
        score: round3(s),
        where: n(f.rect),
        suggestion: `Scale the subject up so the face is at least ${(FACE_GOOD_LO * 100).toFixed(0)}% of canvas height, or switch the slot to fit 'bust'.`,
      });
    } else if (frac < 0.13) {
      findings.push({
        gate: 'composition.faceSize',
        severity: 'warn',
        message: `Face in "${f.slotId}" is small (${(frac * 100).toFixed(1)}% of canvas height); it will read as a smudge on mobile.`,
        score: round3(s),
        where: n(f.rect),
        suggestion: 'Raise the slot\'s meta.faceHeightRatio or crop tighter with fit "bust".',
      });
    } else if (frac > FACE_MAX_HEIGHT) {
      findings.push({
        gate: 'composition.faceSize',
        severity: 'warn',
        message: `Face in "${f.slotId}" fills ${(frac * 100).toFixed(0)}% of canvas height — it crowds out the headline.`,
        score: round3(s),
        where: n(f.rect),
        suggestion: 'Pull the subject back: lower meta.faceHeightRatio toward 0.3.',
      });
    }
  }
  return { score: sum / faces.length, findings };
}

/** facePlacement — thirds/golden anchoring, edge proximity, centre stacking. */
function scoreFacePlacement(
  faces: ScoredFace[],
  layout: ResolvedLayout,
  n: (r: PixelRect) => PixelRect,
): PartResult {
  if (faces.length === 0) return neutral();
  const findings: QaFinding[] = [];
  const { width, height } = layout.canvas;
  let sum = 0;

  for (const f of faces) {
    const c = rectCenter(n(f.rect));
    const d = Math.min(distanceToNearest(c, THIRDS), distanceToNearest(c, GOLDEN));
    let s = 1 - smoothstep(0.05, 0.3, d);

    const nr = n(f.rect);
    const edge = Math.min(nr.x, nr.y, 1 - (nr.x + nr.w), 1 - (nr.y + nr.h));
    if (edge < EDGE_MARGIN) {
      s *= 0.5;
      findings.push({
        gate: 'composition.facePlacement',
        severity: 'warn',
        message: `Face in "${f.slotId}" sits ${(edge * 100).toFixed(1)}% from a canvas edge — it looks cropped by accident.`,
        score: round3(s),
        where: nr,
        suggestion: `Inset the subject so the face keeps at least ${(EDGE_MARGIN * 100).toFixed(0)}% clearance from every edge.`,
      });
    } else if (d > 0.22) {
      findings.push({
        gate: 'composition.facePlacement',
        severity: 'warn',
        message: `Face in "${f.slotId}" is ${(d * 100).toFixed(0)}% away from the nearest thirds/golden intersection.`,
        score: round3(s),
        where: nr,
        suggestion: 'Move the slot focal point toward (0.33, 0.38) or (0.67, 0.38).',
      });
    }
    sum += s;
  }

  let score = sum / faces.length;

  // Dead-centre stacking. On a wide canvas two faces sharing the centre line
  // read as one merged blob; on a vertical canvas the equivalent mistake is two
  // faces sharing the same horizontal band.
  if (faces.length >= 2) {
    const axis: 'x' | 'y' = width >= height ? 'x' : 'y';
    const centres = faces.map((f) => (axis === 'x' ? rectCenter(n(f.rect)).x : rectCenter(n(f.rect)).y));
    const clustered = centres.every((v) => Math.abs(v - 0.5) < CENTRE_CLUSTER);
    if (clustered) {
      score *= 0.45;
      findings.push({
        gate: 'composition.facePlacement',
        severity: 'fail',
        message: `All ${faces.length} faces sit on the ${axis === 'x' ? 'vertical' : 'horizontal'} centre line — the subjects merge instead of facing off.`,
        score: round3(score),
        where: n(faces[0]!.rect),
        suggestion:
          axis === 'x'
            ? 'Push the subjects out to x ≈ 0.28 and x ≈ 0.72 so each face owns a third.'
            : 'Separate the subjects vertically so each face owns its own band.',
      });
    }
  }
  return { score, findings };
}

/**
 * facing — is the subject looking INTO the frame?
 *
 * "Inward" is measured against the OTHER subjects first (a versus is about
 * facing your opponent, and two subjects can both sit near the centre line),
 * and falls back to the canvas centre for a lone subject.
 */
function scoreFacing(faces: ScoredFace[], canvasW: number, n: (r: PixelRect) => PixelRect): PartResult {
  const known = faces.filter((f) => f.facing);
  if (known.length === 0) return neutral();
  const findings: QaFinding[] = [];
  const cxOf = (f: ScoredFace) => (f.rect.x + f.rect.w / 2) / canvasW;
  const perFace: number[] = [];
  let sum = 0;
  let outward = 0;

  for (const f of known) {
    const cx = cxOf(f);
    const others = faces.filter((o) => o !== f);
    let inward: 'left' | 'right' | null = null;
    let side = 'centre';
    if (others.length > 0) {
      const ref = others.reduce((a, o) => a + cxOf(o), 0) / others.length;
      if (Math.abs(cx - ref) > 0.03) {
        inward = cx < ref ? 'right' : 'left';
        side = cx < ref ? 'left' : 'right';
      }
    }
    if (inward === null) {
      side = cx < 0.5 - 0.06 ? 'left' : cx > 0.5 + 0.06 ? 'right' : 'centre';
      inward = side === 'left' ? 'right' : side === 'right' ? 'left' : null;
    }
    let s: number;
    if (f.facing === 'front') {
      // Straight to camera is safe but flat — it never creates the diagonal
      // tension a turned head does.
      s = 0.82;
    } else if (inward === null) {
      s = 0.9;
    } else if (f.facing === inward) {
      s = 1;
    } else {
      s = 0.1;
      outward++;
      findings.push({
        gate: 'composition.facing',
        severity: known.length > 1 ? 'fail' : 'warn',
        message: `Subject "${f.slotId}" sits on the ${side} and looks ${f.facing} — out of frame. The viewer's eye follows them off the canvas.`,
        score: 0.1,
        where: n(f.rect),
        suggestion: `Set flipX on "${f.slotId}" (or pick a mirrored asset) so the subject looks ${inward}, into the composition.`,
      });
    }
    sum += s;
    perFace.push(s);
  }

  // The worst subject dominates: one player staring off-canvas breaks the frame
  // no matter how well the other is posed, so a plain mean would under-report it.
  const worst = Math.min(...perFace);
  let score = 0.4 * (sum / known.length) + 0.6 * worst;
  if (outward >= 2) {
    // Both halves of a versus looking away is not two small errors, it is one
    // broken composition.
    score *= 0.5;
    findings.push({
      gate: 'composition.facing',
      severity: 'fail',
      message: 'Every subject faces out of frame — the matchup has no confrontation.',
      score: round3(score),
      where: { x: 0, y: 0, w: 1, h: 1 },
      suggestion: 'Mirror both cutouts so they face the centre line.',
    });
  }
  return { score, findings };
}

/** balance — visual mass left vs right of the centre line. */
function scoreBalance(faces: ScoredFace[], layout: ResolvedLayout): PartResult {
  const { width, height } = layout.canvas;
  const mid = width / 2;
  let left = 0;
  let right = 0;

  const add = (r: PixelRect, weight: number) => {
    if (weight <= 0) return;
    const area = rectArea(r);
    if (area <= 0) return;
    const leftPart = intersect(r, { x: 0, y: 0, w: mid, h: height });
    const rightPart = intersect(r, { x: mid, y: 0, w: width - mid, h: height });
    left += (leftPart ? rectArea(leftPart) : 0) * weight;
    right += (rightPart ? rectArea(rightPart) : 0) * weight;
  };

  for (const s of layout.slots) add(s.rect, KIND_MASS[s.slot.kind] ?? 0.3);
  for (const f of faces) add(f.rect, FACE_MASS_GAIN);

  const totalMass = left + right;
  if (totalMass <= 0) return neutral();
  const asym = Math.abs(left - right) / totalMass;
  let score = 1 - smoothstep(0.14, 0.62, asym);

  const declared = (layout.spec?.slots ?? []).some((s) => s.meta?.['intentionalAsymmetry'] === true);
  if (declared) {
    // The design says the imbalance is the point (single hero pushed right,
    // headline stacked left). Relax rather than argue.
    return { score: Math.max(score, 0.85), findings: [] };
  }

  const findings: QaFinding[] = [];
  if (score < 0.6) {
    const heavy = left > right ? 'left' : 'right';
    findings.push({
      gate: 'composition.balance',
      severity: score < 0.35 ? 'fail' : 'warn',
      message: `Visual mass is ${(asym * 100).toFixed(0)}% lopsided toward the ${heavy}.`,
      score: round3(score),
      where: { x: 0, y: 0, w: 1, h: 1 },
      suggestion: `Add counterweight on the ${heavy === 'left' ? 'right' : 'left'} (badge, logo, secondary text) or shift the subject toward the centre. If the imbalance is intentional, set meta.intentionalAsymmetry on the hero slot.`,
    });
  }
  return { score, findings };
}

/** separation — faces must not merge with each other or hide under text. */
function scoreSeparation(
  faces: ScoredFace[],
  textRects: { slotId: string; rect: PixelRect }[],
  n: (r: PixelRect) => PixelRect,
): PartResult {
  const findings: QaFinding[] = [];
  const scores: number[] = [];

  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i]!;
      const b = faces[j]!;
      const ratio = overlapRatio(a.rect, b.rect);
      if (ratio <= 0) continue;
      scores.push(clamp(1 - ratio * 1.5, 0, 1));
      findings.push({
        gate: 'composition.separation',
        severity: ratio > 0.2 ? 'fail' : 'warn',
        message: `Faces in "${a.slotId}" and "${b.slotId}" overlap by ${(ratio * 100).toFixed(0)}% — they read as one head.`,
        score: round3(clamp(1 - ratio * 1.5, 0, 1)),
        where: n(a.rect),
        suggestion: 'Separate the subject slots, or push one subject behind the other with a clear rim light and z gap.',
      });
    }
  }

  for (const f of faces) {
    for (const t of textRects) {
      const hit = intersect(f.rect, t.rect);
      if (!hit) continue;
      const covered = rectArea(hit) / Math.max(1, rectArea(f.rect));
      if (covered <= 0.1) continue; // a corner kiss is fine, and common
      const s = clamp(1 - (covered - 0.1) / 0.5, 0, 1);
      scores.push(s);
      findings.push({
        gate: 'composition.separation',
        severity: covered > 0.35 ? 'fail' : 'warn',
        message: `Text "${t.slotId}" covers ${(covered * 100).toFixed(0)}% of the face in "${f.slotId}".`,
        score: round3(s),
        where: n(hit),
        suggestion: `Move "${t.slotId}" off the face — chest height or the opposite third — or shrink it.`,
      });
    }
  }

  if (scores.length === 0) return neutral();
  // Worst pair dominates: one merged pair of heads ruins the frame regardless
  // of how clean everything else is.
  return { score: Math.min(...scores), findings };
}

/** headroom — skull cropped, or the subject drowning in empty space. */
function scoreHeadroom(faces: ScoredFace[], canvasH: number, n: (r: PixelRect) => PixelRect): PartResult {
  if (faces.length === 0) return neutral();
  const findings: QaFinding[] = [];
  let sum = 0;
  for (const f of faces) {
    const above = f.rect.y;
    if (above <= 0.005 * canvasH) {
      sum += 0;
      findings.push({
        gate: 'composition.headroom',
        severity: 'fail',
        message: `Face in "${f.slotId}" is flush with the top of the canvas — the crown is cropped.`,
        score: 0,
        where: n(f.rect),
        suggestion: 'Lower the slot focal y (0.38 is the default) or zoom out; fitSubject caps zoom to protect the crown when it is given a faceBox.',
      });
      continue;
    }
    const ratio = above / Math.max(1, f.rect.h); // headroom measured in face heights
    let s: number;
    if (ratio < 0.15) {
      s = 0.2 + 0.8 * smoothstep(0, 0.15, ratio);
      findings.push({
        gate: 'composition.headroom',
        severity: 'warn',
        message: `Face in "${f.slotId}" has only ${(ratio * 100).toFixed(0)}% of a face height above it — tight to the top edge.`,
        score: round3(s),
        where: n(f.rect),
        suggestion: 'Add headroom: nudge the slot focal y up toward 0.42.',
      });
    } else if (ratio <= 1.0) {
      s = 1;
    } else {
      s = 1 - 0.8 * smoothstep(1.0, 2.4, ratio);
      if (ratio > 1.6) {
        findings.push({
          gate: 'composition.headroom',
          severity: 'warn',
          message: `Face in "${f.slotId}" floats: ${ratio.toFixed(1)} face heights of empty space above it.`,
          score: round3(s),
          where: n(f.rect),
          suggestion: 'Crop in or move the subject up — dead air above a head wastes the frame.',
        });
      }
    }
    sum += s;
  }
  return { score: sum / faces.length, findings };
}

/** textFit — text stays on canvas and off the faces. */
function scoreTextFit(
  textRects: { slotId: string; rect: PixelRect }[],
  faces: ScoredFace[],
  layout: ResolvedLayout,
  n: (r: PixelRect) => PixelRect,
): PartResult {
  if (textRects.length === 0) return neutral();
  const { width, height } = layout.canvas;
  const canvas: PixelRect = { x: 0, y: 0, w: width, h: height };
  const findings: QaFinding[] = [];
  let sum = 0;

  for (const t of textRects) {
    let s = 1;
    const inside = intersect(t.rect, canvas);
    const insideArea = inside ? rectArea(inside) : 0;
    const outside = 1 - insideArea / Math.max(1, rectArea(t.rect));
    if (outside > 0.005) {
      s -= clamp(outside * 2.5, 0, 0.9);
      findings.push({
        gate: 'composition.textFit',
        severity: outside > 0.05 ? 'fail' : 'warn',
        message: `Text "${t.slotId}" runs ${(outside * 100).toFixed(0)}% off the canvas.`,
        score: round3(clamp(s, 0, 1)),
        where: n(t.rect),
        suggestion: 'Shrink the type or pull the slot inside the frame; set constraints.clampToCanvas on the slot.',
      });
    }
    for (const f of faces) {
      const hit = intersect(t.rect, f.rect);
      if (!hit) continue;
      const covered = rectArea(hit) / Math.max(1, rectArea(f.rect));
      if (covered <= 0.1) continue;
      s -= clamp(covered, 0, 0.6);
      findings.push({
        gate: 'composition.textFit',
        severity: covered > 0.35 ? 'fail' : 'warn',
        message: `Text "${t.slotId}" collides with the face in "${f.slotId}".`,
        score: round3(clamp(s, 0, 1)),
        where: n(hit),
        suggestion: `Reflow "${t.slotId}" into empty space — the gap between subjects or the lower third.`,
      });
    }
    sum += clamp(s, 0, 1);
  }
  return { score: sum / textRects.length, findings };
}

/** hierarchy — declared focal points carry content, and one element leads. */
function scoreHierarchy(faces: ScoredFace[], layout: ResolvedLayout): PartResult {
  const findings: QaFinding[] = [];
  const { width, height } = layout.canvas;
  const focals = layout.focalPoints ?? [];

  let coverage: number;
  if (focals.length === 0) {
    coverage = 0.6;
    findings.push({
      gate: 'composition.hierarchy',
      severity: 'warn',
      message: 'Layout declares no focalPoints, so there is nothing asserting where the eye should land.',
      score: 0.6,
      where: { x: 0, y: 0, w: 1, h: 1 },
      suggestion: 'Add focalPoints (strongest first) to the LayoutSpec — usually the hero face, then the headline.',
    });
  } else {
    let covered = 0;
    for (const p of focals) {
      const hitFace = faces.some((f) => {
        const c = rectCenter(normaliseRect(f.rect, width, height));
        return Math.hypot(c.x - p.x, c.y - p.y) < 0.16;
      });
      const hitSlot = layout.slots.some((s) => {
        if ((KIND_MASS[s.slot.kind] ?? 0) <= 0.15) return false;
        const r = normaliseRect(s.rect, width, height);
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      });
      if (hitFace || hitSlot) covered++;
      else {
        findings.push({
          gate: 'composition.hierarchy',
          severity: 'warn',
          message: `Focal point (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) has no content near it.`,
          score: 0.4,
          where: { x: clamp(p.x - 0.05, 0, 1), y: clamp(p.y - 0.05, 0, 1), w: 0.1, h: 0.1 },
          suggestion: 'Either move a subject/headline onto the focal point or drop the focal point from the layout.',
        });
      }
    }
    coverage = covered / focals.length;
  }

  // Dominance is judged per KIND group, so a symmetric versus (two co-equal
  // subjects) counts as one dominant unit rather than being punished for having
  // no single winner.
  const massByKind = new Map<string, number>();
  for (const s of layout.slots) {
    const w = KIND_MASS[s.slot.kind] ?? 0.3;
    if (w <= 0) continue;
    massByKind.set(s.slot.kind, (massByKind.get(s.slot.kind) ?? 0) + rectArea(s.rect) * w);
  }
  for (const f of faces) {
    massByKind.set('subject', (massByKind.get('subject') ?? 0) + rectArea(f.rect) * FACE_MASS_GAIN);
  }
  const masses = [...massByKind.values()].sort((a, b) => b - a);
  let dominance = 1;
  if (masses.length >= 2) {
    const ratio = masses[0]! / Math.max(1, masses[1]!);
    dominance = smoothstep(1.05, 1.5, ratio);
    if (ratio < 1.15) {
      findings.push({
        gate: 'composition.hierarchy',
        severity: 'warn',
        message: `No dominant element: the two heaviest layer groups are within ${((ratio - 1) * 100).toFixed(0)}% of each other.`,
        score: round3(dominance),
        where: { x: 0, y: 0, w: 1, h: 1 },
        suggestion: 'Commit: make the subject bigger or the headline bigger. Equal weight reads as indecision.',
      });
    }
  }

  return { score: 0.6 * coverage + 0.4 * dominance, findings };
}

/* ------------------------------------------------------------------------ */

/** Nothing to judge — score neutral rather than punishing missing data. */
function neutral(): PartResult {
  return { score: 1, findings: [] };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
