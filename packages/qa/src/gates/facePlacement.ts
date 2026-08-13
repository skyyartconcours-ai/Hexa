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
 *   • Nothing printed across the eyes or the mouth. Type over a face is a normal
 *     device; type over the features the viewer reads the face *by* is not.
 *   • Two subjects at identical scale and identical height are a mirror, and a
 *     mirror is inert: nothing is happening between them. This one warns rather
 *     than vetoes, because a symmetric layout is a legitimate house style — but
 *     it is the difference between a fight card and a diagram.
 */

import { distanceToNearest, overlapRatio, THIRDS } from '@hexa/core';
import type { QaFinding, Rect } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, collectTextRects, ramp, toNormRect, toPixelRect } from '../geom.js';

/** Face height as a fraction of canvas height. */
export const MIN_FACE_HEIGHT = 0.09;
const COMFORTABLE_FACE_HEIGHT = 0.16;
/** Eye line sits about 40% down a detected face box. */
const EYE_LINE_IN_FACE = 0.4;
/** Where the eye line should land on the canvas. */
const EYE_BAND = { min: 0.16, max: 0.45 };
/** Two faces closer than this (normalised x) are stacked, not opposed. */
const MIN_PAIR_SEPARATION = 0.22;
/** Bands within a face box, as fractions of its height. The eye band is where
 *  recognition happens; the mouth band is where expression does. */
const EYE_ZONE = { top: 0.25, bottom: 0.55 };
const MOUTH_ZONE = { top: 0.6, bottom: 0.85 };
/** Share of the band a text rect must cover before it is "over the eyes". */
const FEATURE_OVERLAP = 0.12;
/** Relative differences below which two subjects are a dead mirror. */
const MIRROR_SCALE = 0.04;
const MIRROR_HEIGHT = 0.02;
const MIRROR_AXIS = 0.03;

export const facePlacementGate: Gate = {
  id: 'face-placement',
  weight: 1.2,
  description: 'Faces are large enough, un-clipped, unobscured by type, opposed rather than stacked (and not dead-mirrored), with the eye line in the upper third',

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
    const texts = collectTextRects(ctx).map((t) => ({ role: t.role, rect: toNormRect(t.rect, ctx.width, ctx.height) }));

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

      // Type across the features. "Text over a face" is a device; text over the
      // eyes is a defacement — the viewer identifies a person from the eye band
      // above all else, and a headline through it makes the subject anonymous
      // while still claiming to be them.
      for (const band of [
        { name: 'eyes', span: EYE_ZONE, severity: 'fail' as const },
        { name: 'mouth', span: MOUTH_ZONE, severity: 'warn' as const },
      ]) {
        const feature: Rect = {
          x: rect.x,
          y: rect.y + rect.h * band.span.top,
          w: rect.w,
          h: rect.h * (band.span.bottom - band.span.top),
        };
        for (const text of texts) {
          const cover = overlapRatio(feature, text.rect);
          if (cover < FEATURE_OVERLAP) continue;
          clean = false;
          findings.push({
            gate: 'face-placement',
            severity: band.severity,
            message: `Text "${text.role}" is printed across ${subject.handle}'s ${band.name} (covering ${(cover * 100).toFixed(0)}% of the ${band.name} band of the face)`,
            score: band.severity === 'fail' ? clamp01(0.25 * (1 - cover)) : clamp01(0.6 - 0.3 * cover),
            subjectId: subject.playerId,
            where: feature,
            suggestion: band.name === 'eyes'
              ? `Move "${text.role}" below the chin or outside the subject's column. The eyes are the one part of a face a thumbnail cannot spare — cover them and the identity the whole render is built on stops being visible.`
              : `Nudge "${text.role}" clear of the mouth; expression is most of what a face contributes to a thumbnail.`,
          });
        }
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

      // Dead mirror: same size, same height, equidistant from the axis. Nothing
      // in the picture is happening — no hero, no depth, no reason for the eye to
      // travel. Warn, never fail: symmetry is a house style, not a defect, and a
      // gate that vetoed it would veto half the versus templates in the library.
      const scaleDelta = Math.abs(a.rect.h - b.rect.h) / Math.max(a.rect.h, b.rect.h, 1e-6);
      const heightDelta = Math.abs(a.rect.y - b.rect.y);
      const axisDelta = Math.abs(Math.abs(ax - 0.5) - Math.abs(bx - 0.5));
      if (scaleDelta < MIRROR_SCALE && heightDelta < MIRROR_HEIGHT && axisDelta < MIRROR_AXIS) {
        findings.push({
          gate: 'face-placement',
          severity: 'warn',
          message: `${a.subject.handle} and ${b.subject.handle} are a dead mirror: same face height (${(a.rect.h * 100).toFixed(1)}% vs ${(b.rect.h * 100).toFixed(1)}%), same eye height (${(scaleDelta * 100).toFixed(1)}% and ${(heightDelta * 100).toFixed(1)}% apart) and equidistant from the centre — the composition has no hero and nothing for the eye to do`,
          score: 0.5,
          where: { x: Math.min(a.rect.x, b.rect.x), y: Math.min(a.rect.y, b.rect.y), w: Math.abs(ax - bx) + a.rect.w, h: Math.max(a.rect.h, b.rect.h) },
          suggestion: 'Break the symmetry: bring one subject 8–12% larger and forward, drop the other 2–3% of canvas height, or angle the light across them. Even fight posters that look symmetric put one fighter nearer the camera.',
        });
      }
    }

    return findings;
  },
};
