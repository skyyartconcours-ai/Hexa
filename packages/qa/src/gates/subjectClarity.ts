/**
 * Subject-clarity gate — does the person read as the subject, or as a hole?
 *
 * Face placement checks where a face *is*. Nothing checked what it looks like
 * against what surrounds it, and that is where two very common failures live:
 *
 *  1. **Inverted value structure.** The face ends up the darkest thing in its
 *     half of the frame. Every eye-tracking rule of thumb in poster design says
 *     the eye goes to the brightest, highest-contrast region first, so a dark
 *     face on a lit backdrop reads as a silhouette-shaped hole and the viewer
 *     looks at the backdrop instead. The fix is a rim light or a darker plate,
 *     and it is invisible to contrast/legibility, which only ever look at type.
 *
 *  2. **Collapse at feed size.** A face that carries detail at 1280×720 can be a
 *     featureless smudge at 168×94, which is where the thumbnail is actually
 *     judged. Worse, two faces can collapse into the *same* smudge, at which
 *     point a versus thumbnail has stopped saying anything — and when the
 *     smudges are literally identical, the compositor has used one asset twice.
 *
 * Everything here is measured on the pixels: the plan cannot know whether the
 * grade left the subject lighter or darker than the plate behind it.
 */

import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, ramp, toNormRect, toPixelRect } from '../geom.js';
import { clampToImage, loadGray, meanEdgeEnergy, percentile, rmsContrast, sobel } from '../image.js';
import type { GrayImage } from '../image.js';
import { YOUTUBE_DISPLAY_SIZES } from '../sizes.js';

/** Percentile rank in its own half below which the face is "the dark thing". */
const DARK_RANK = 0.15;
/** Luma delta (0–1) between subject and surround that reads as separation. */
const MIN_SEPARATION = 0.06;
/** RMS contrast inside a face at sidebar size, below which it is a smudge. */
const MIN_SMALL_STRUCTURE = 0.055;
/** Mean absolute difference between two faces at feed size, 0–255. */
const SAME_FACE = 3;
const TWIN_FACE = 8;

interface FaceStat {
  handle: string;
  playerId: string;
  norm: { x: number; y: number; w: number; h: number };
  mean: number;
  p90: number;
  ring: number;
}

export const subjectClarityGate: Gate = {
  id: 'subject-clarity',
  weight: 1.4,
  description: 'Subjects carry the value structure of a subject (lighter/higher-contrast than their surroundings) and still read as distinct faces at feed size',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const faces = ctx.subjects.filter((s) => s.faceRect);
    if (faces.length === 0) {
      return [{
        gate: 'subject-clarity',
        severity: ctx.subjects.length > 0 ? 'warn' : 'pass',
        message: ctx.subjects.length > 0
          ? 'No face rects were recorded, so subject/background separation could not be measured'
          : 'No subjects in this render — nothing to separate from the background',
        score: ctx.subjects.length > 0 ? 0.5 : 1,
        ...(ctx.subjects.length > 0
          ? { suggestion: 'Have the compositor emit the resolved face rect per subject; the whole subject half of QA depends on it.' }
          : {}),
      }];
    }

    const gray = await loadGray(ctx.image, { background: ctx.plan.canvas.background });
    const findings: QaFinding[] = [];
    const stats: FaceStat[] = [];

    // Cell lumas of the frame, minus everything a face sits on, so a face is
    // compared against its *background* rather than against other subjects.
    const faceBoxes = faces.map((s) => toPixelRect(s.faceRect!, ctx.width, ctx.height));
    const field = backgroundCells(gray, faceBoxes);

    for (const subject of faces) {
      const px = clampToImage(toPixelRect(subject.faceRect!, ctx.width, ctx.height), gray.width, gray.height);
      const norm = toNormRect(subject.faceRect!, ctx.width, ctx.height);
      if (px.w < 2 || px.h < 2) continue;

      const values = region(gray, px);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const p90 = percentile(values, 0.9);
      const ringValues = ringOf(gray, px);
      const ring = ringValues.length ? ringValues.reduce((a, b) => a + b, 0) / ringValues.length : mean;
      stats.push({ handle: subject.handle, playerId: subject.playerId, norm, mean, p90, ring });

      // Which half is this face in, and how does it rank against that half?
      const centreX = norm.x + norm.w / 2;
      const half = centreX < 0.5 ? 'left' : 'right';
      const halfCells = field.filter((c) => (half === 'left' ? c.x < 0.5 : c.x >= 0.5)).map((c) => c.luma);
      const rank = halfCells.length ? halfCells.filter((v) => v < mean).length / halfCells.length : 1;
      const separation = Math.abs(mean - ring) / 255;
      const halfMedian = halfCells.length ? percentile(halfCells, 0.5) : mean;

      if (rank <= DARK_RANK && p90 <= halfMedian) {
        findings.push({
          gate: 'subject-clarity',
          severity: 'fail',
          message: `${subject.handle}'s face is the darkest thing in the ${half} half of the frame — mean luma ${mean.toFixed(0)}/255, darker than ${((1 - rank) * 100).toFixed(0)}% of the background around it, and its brightest 10% (${p90.toFixed(0)}) still does not reach the half's median (${halfMedian.toFixed(0)}). The eye goes to the backdrop and the subject reads as a hole in it`,
          score: clamp01(0.15 + 0.35 * ramp(rank, 0, DARK_RANK)),
          subjectId: subject.playerId,
          where: norm,
          suggestion: `Light the subject or darken the plate: a rim light along the key side, or a vignette/scrim behind ${subject.handle}, inverts the relationship. Whatever is brightest is what gets looked at, and right now that is the background.`,
        });
      } else if (separation < MIN_SEPARATION && rmsContrast(gray, px) < 0.1) {
        findings.push({
          gate: 'subject-clarity',
          severity: 'warn',
          message: `${subject.handle}'s face barely separates from what is behind it — ${(separation * 255).toFixed(0)}/255 luma between the face and the ring around it, and little internal contrast`,
          score: clamp01(0.3 + 0.4 * ramp(separation, 0, MIN_SEPARATION)),
          subjectId: subject.playerId,
          where: norm,
          suggestion: 'Add separation the eye can use: rim light, a drop shadow under the cutout, or push the backplate two stops away from the subject\'s value.',
        });
      }
    }

    // ── the size it is actually seen at ────────────────────────────────────────
    const box = [...YOUTUBE_DISPLAY_SIZES].sort((a, b) => a.w * a.h - b.w * b.h)[0]!;
    const small = await loadGray(ctx.image, { width: box.w, height: box.h, background: ctx.plan.canvas.background });
    const smallMag = sobel(small);
    const crops: { subject: (typeof faces)[number]; rect: { x: number; y: number; w: number; h: number }; structure: number }[] = [];

    for (const subject of faces) {
      const n = toNormRect(subject.faceRect!, ctx.width, ctx.height);
      const rect = clampToImage(
        { x: n.x * box.w, y: n.y * box.h, w: Math.max(1, n.w * box.w), h: Math.max(1, n.h * box.h) },
        box.w,
        box.h,
      );
      if (rect.w < 2 || rect.h < 2) continue;
      const structure = rmsContrast(small, rect);
      crops.push({ subject, rect, structure });

      if (structure < MIN_SMALL_STRUCTURE) {
        findings.push({
          gate: 'subject-clarity',
          severity: 'fail',
          message: `${subject.handle}'s face is ${rect.w}×${rect.h}px in the ${box.label} box (${box.w}×${box.h}) and has collapsed to a smudge there: ${(structure * 100).toFixed(1)}% RMS contrast inside the face, ${(meanEdgeEnergy(smallMag, box.w, box.h, rect) * 100).toFixed(1)}% edge energy. It may look fine at ${ctx.width}×${ctx.height} — nobody sees it at ${ctx.width}×${ctx.height}`,
          score: clamp01(0.2 + 0.3 * ramp(structure, 0, MIN_SMALL_STRUCTURE)),
          subjectId: subject.playerId,
          where: toNormRect(subject.faceRect!, ctx.width, ctx.height),
          suggestion: `Crop tighter on ${subject.handle} so the face is a bigger share of the frame, raise local contrast on the face, or drop to a single subject. Detail that only exists above ${box.w}px wide is not in the product.`,
        });
      }
    }

    if (crops.length === 2) {
      const diff = meanAbsDiff(small, crops[0]!.rect, crops[1]!.rect);
      if (diff <= SAME_FACE) {
        findings.push({
          gate: 'subject-clarity',
          severity: 'fail',
          message: `${crops[0]!.subject.handle} and ${crops[1]!.subject.handle} are the same pixels at feed size (mean difference ${diff.toFixed(1)}/255 between the two face crops at ${box.w}×${box.h}) — the render shows one subject twice, or two placeholders`,
          score: 0.15,
          suggestion: 'Check the compositor filled both subject slots from different assets. A versus thumbnail with one face in it is not a versus thumbnail.',
        });
      } else if (diff <= TWIN_FACE) {
        findings.push({
          gate: 'subject-clarity',
          severity: 'warn',
          message: `${crops[0]!.subject.handle} and ${crops[1]!.subject.handle} are hard to tell apart at ${box.w}×${box.h} (mean difference only ${diff.toFixed(1)}/255) — at feed size the viewer sees two similar smudges rather than two people`,
          score: clamp01(0.4 + 0.4 * ramp(diff, SAME_FACE, TWIN_FACE)),
          suggestion: 'Differentiate the sides: opposing key colours, a size difference between the two subjects, or a crop that gives one of them more of the frame.',
        });
      }
    }

    if (findings.length === 0) {
      const best = stats.reduce((a, b) => (Math.abs(b.mean - b.ring) > Math.abs(a.mean - a.ring) ? b : a), stats[0]!);
      findings.push({
        gate: 'subject-clarity',
        severity: 'pass',
        message: stats.length
          ? `Subjects sit clear of their background (${best.handle}: face ${best.mean.toFixed(0)}/255 against ${best.ring.toFixed(0)}/255 around it) and hold their structure at ${box.w}×${box.h}`
          : `Subject clarity holds at ${box.w}×${box.h}`,
        score: clamp01(0.6 + 0.4 * ramp(Math.abs(best.mean - best.ring) / 255, MIN_SEPARATION, 0.25)),
      });
    }

    return findings;
  },
};

function region(gray: GrayImage, r: { x: number; y: number; w: number; h: number }): number[] {
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) out.push(gray.data[y * gray.width + x]!);
  }
  return out;
}

/** The band around a rect, half the face's own size out, clipped to the frame. */
function ringOf(gray: GrayImage, r: { x: number; y: number; w: number; h: number }): number[] {
  const pad = Math.max(4, Math.round(Math.min(r.w, r.h) * 0.5));
  const outer = clampToImage(
    { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 },
    gray.width,
    gray.height,
  );
  const out: number[] = [];
  for (let y = outer.y; y < outer.y + outer.h; y++) {
    for (let x = outer.x; x < outer.x + outer.w; x++) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
      out.push(gray.data[y * gray.width + x]!);
    }
  }
  return out;
}

/** Mean luma per cell of a 12×8 grid, dropping any cell a face overlaps. */
function backgroundCells(
  gray: GrayImage,
  faces: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number; luma: number }[] {
  const cols = 12;
  const rows = 8;
  const cw = gray.width / cols;
  const ch = gray.height / rows;
  const out: { x: number; y: number; luma: number }[] = [];

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const cell = clampToImage(
        { x: rx * cw, y: ry * ch, w: Math.max(1, cw), h: Math.max(1, ch) },
        gray.width,
        gray.height,
      );
      if (cell.w <= 0 || cell.h <= 0) continue;
      const overlapsFace = faces.some((f) =>
        cell.x < f.x + f.w && cell.x + cell.w > f.x && cell.y < f.y + f.h && cell.y + cell.h > f.y,
      );
      if (overlapsFace) continue;
      const values = region(gray, cell);
      out.push({
        x: (rx + 0.5) / cols,
        y: (ry + 0.5) / rows,
        luma: values.reduce((a, b) => a + b, 0) / values.length,
      });
    }
  }
  return out;
}

/** Mean |Δ| between two rects, resampled onto a common 12×12 lattice. */
function meanAbsDiff(
  gray: GrayImage,
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const n = 12;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ax = Math.min(gray.width - 1, a.x + Math.floor(((i + 0.5) / n) * a.w));
      const ay = Math.min(gray.height - 1, a.y + Math.floor(((j + 0.5) / n) * a.h));
      const bx = Math.min(gray.width - 1, b.x + Math.floor(((i + 0.5) / n) * b.w));
      const by = Math.min(gray.height - 1, b.y + Math.floor(((j + 0.5) / n) * b.h));
      sum += Math.abs(gray.data[ay * gray.width + ax]! - gray.data[by * gray.width + bx]!);
    }
  }
  return sum / (n * n);
}
