/**
 * Face-placement gate — the composition rules that decide whether a face reads
 * as a person or as a smudge.
 *
 * These are craft rules, taken from how sports/esports thumbnails are actually
 * cut, not from any standard:
 *   • ≥9% of canvas height. Below that the face is ~8px tall in the sidebar and
 *     the viewer cannot tell who it is, which defeats the entire product.
 *   • Not clipped by the frame edge. A half-face at the border reads as a
 *     mistake, not as a crop — except at the bottom, where chest-cropping is
 *     the normal bust treatment.
 *   • Two subjects must not stack in the middle. Versus compositions work
 *     because the eye gets two poles and a conflict; two faces at centre read
 *     as one muddle.
 *   • Eyes near the upper third. The single oldest portrait rule there is, and
 *     the one that most reliably makes a composite look shot rather than pasted.
 */

import { distanceToNearest, THIRDS } from '@hexa/core';
import type { QaFinding } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, ramp, toNormRect, toPixelRect } from '../geom.js';

/** Face height as a fraction of canvas height. */
export const MIN_FACE_HEIGHT = 0.09;
const COMFORTABLE_FACE_HEIGHT = 0.16;
/** Eye line sits about 40% down a detected face box. */
const EYE_LINE_IN_FACE = 0.4;
/** Where the eye line should land on the canvas. */
const EYE_BAND = { min: 0.16, max: 0.45 };
/** Two faces closer than this (normalised x) are stacked, not opposed. */
const MIN_PAIR_SEPARATION = 0.22;

export const facePlacementGate: Gate = {
  id: 'face-placement',
  weight: 1.2,
  description: 'Faces are large enough, un-clipped, opposed rather than stacked, and sit with the eye line in the upper third',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const faces = ctx.subjects
      .filter((s) => s.faceRect)
      .map((s) => ({ subject: s, rect: toNormRect(s.faceRect!, ctx.width, ctx.height) }));

    if (faces.length === 0) {
      return [{
        gate: 'face-placement',
        severity: ctx.subjects.length > 0 ? 'warn' : 'pass',
        message: ctx.subjects.length > 0
          ? 'No face rects were recorded for any subject, so face placement could not be checked'
          : 'No subjects in this render — no face placement to check',
        score: ctx.subjects.length > 0 ? 0.5 : 1,
        suggestion: ctx.subjects.length > 0
          ? 'Have the compositor emit the resolved face rect per subject; without it neither placement nor identity can be verified.'
          : undefined,
      }];
    }

    const findings: QaFinding[] = [];

    for (const { subject, rect } of faces) {
      const px = toPixelRect(subject.faceRect!, ctx.width, ctx.height);
      let clean = true;

      if (rect.h < MIN_FACE_HEIGHT) {
        clean = false;
        findings.push({
          gate: 'face-placement',
          severity: 'fail',
          message: `${subject.handle}'s face is ${(rect.h * 100).toFixed(1)}% of canvas height (${px.h}px) — below the ${(MIN_FACE_HEIGHT * 100).toFixed(0)}% floor, so it is roughly ${Math.round(rect.h * 94)}px in the sidebar and unrecognisable`,
          score: clamp01(ramp(rect.h, 0, MIN_FACE_HEIGHT) * 0.5),
          subjectId: subject.playerId,
          where: rect,
          suggestion: `Scale ${subject.handle} up to at least ${Math.round(MIN_FACE_HEIGHT * ctx.height)}px of face height, or move to a bust/hero layout that gives the face the frame.`,
        });
      }

      const edges: string[] = [];
      if (rect.x < -0.005) edges.push('left');
      if (rect.y < -0.005) edges.push('top');
      if (rect.x + rect.w > 1.005) edges.push('right');
      // Chins clipped by the bottom edge are a normal bust crop; only flag it
      // when a real slice of the face is gone.
      if (rect.y + rect.h > 1.06) edges.push('bottom');
      if (edges.length) {
        clean = false;
        findings.push({
          gate: 'face-placement',
          severity: 'fail',
          message: `${subject.handle}'s face is clipped by the ${edges.join(' and ')} edge${edges.length > 1 ? 's' : ''} of the frame`,
          score: 0.2,
          subjectId: subject.playerId,
          where: rect,
          suggestion: `Pull ${subject.handle} inward or reduce the slot scale; a face touching the frame edge reads as a layout bug.`,
        });
      }

      const eyeY = rect.y + rect.h * EYE_LINE_IN_FACE;
      if (eyeY < EYE_BAND.min || eyeY > EYE_BAND.max) {
        clean = false;
        findings.push({
          gate: 'face-placement',
          severity: 'warn',
          message: `${subject.handle}'s eye line sits at ${(eyeY * 100).toFixed(0)}% of canvas height — outside the ${(EYE_BAND.min * 100).toFixed(0)}–${(EYE_BAND.max * 100).toFixed(0)}% band where portraits read naturally`,
          score: clamp01(1 - Math.min(1, Math.abs(eyeY - 0.3) * 2.5)),
          subjectId: subject.playerId,
          where: rect,
          suggestion: eyeY > EYE_BAND.max
            ? `Raise ${subject.handle} in the frame — too much headroom makes the subject look like it is sinking out of the shot.`
            : `Lower ${subject.handle} slightly; the eye line is nearly at the top edge and the composition loses its headroom.`,
        });
      }

      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      const thirdsDistance = distanceToNearest(centre, THIRDS);
      if (clean) {
        findings.push({
          gate: 'face-placement',
          severity: 'pass',
          message: `${subject.handle}: face ${(rect.h * 100).toFixed(1)}% of height, eye line at ${(eyeY * 100).toFixed(0)}%, ${thirdsDistance.toFixed(2)} from the nearest rule-of-thirds point`,
          score: clamp01(0.6 + 0.4 * ramp(rect.h, MIN_FACE_HEIGHT, COMFORTABLE_FACE_HEIGHT)),
          subjectId: subject.playerId,
          where: rect,
        });
      }
    }

    if (faces.length === 2) {
      const [a, b] = faces as [(typeof faces)[number], (typeof faces)[number]];
      const ax = a.rect.x + a.rect.w / 2;
      const bx = b.rect.x + b.rect.w / 2;
      const separation = Math.abs(ax - bx);
      const bothCentral = Math.abs(ax - 0.5) < 0.16 && Math.abs(bx - 0.5) < 0.16;

      if (separation < MIN_PAIR_SEPARATION || bothCentral) {
        findings.push({
          gate: 'face-placement',
          severity: 'fail',
          message: `${a.subject.handle} and ${b.subject.handle} are stacked in the middle of the frame (centres ${separation.toFixed(2)} apart, both within ${bothCentral ? '16%' : `${(separation * 100).toFixed(0)}%`} of centre) — a versus composition needs two poles`,
          score: clamp01(ramp(separation, 0, MIN_PAIR_SEPARATION) * 0.5),
          where: { x: Math.min(a.rect.x, b.rect.x), y: Math.min(a.rect.y, b.rect.y), w: Math.abs(ax - bx) + a.rect.w, h: Math.max(a.rect.h, b.rect.h) },
          suggestion: 'Push the subjects to roughly x=0.25 and x=0.75 and let the conflict happen in the gap between them.',
        });
      } else {
        findings.push({
          gate: 'face-placement',
          severity: 'pass',
          message: `Subjects are opposed across the frame (centres ${separation.toFixed(2)} apart)`,
          score: clamp01(0.6 + 0.4 * ramp(separation, MIN_PAIR_SEPARATION, 0.5)),
        });
      }
    }

    return findings;
  },
};
