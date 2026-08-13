/**
 * Legibility gate — does the text survive the size it is actually seen at?
 *
 * A headline that is gorgeous at 1280×720 and gone at 168×94 has failed at the
 * only moment that matters. So the gate does not reason about font sizes in the
 * plan; it downsamples the real render to each YouTube display box and measures
 * the pixels that come out:
 *
 *  1. Cap height. Below ~7px of cap height, uppercase strokes thin to less than
 *     a pixel and antialiasing eats them. (Craft rule of thumb, not a standard —
 *     it is where display faces stop resolving in practice.)
 *  2. Stroke separation. An Otsu split inside the text rect measures how far
 *     apart the glyph and background populations sit *after* downsampling, which
 *     is where thin type on a mid-tone plate collapses.
 *  3. Camouflage. Text edges are compared against the edge density of the ring
 *     of background around them. Type that is no busier than the noise it sits
 *     on does not read as type — this is the "beautiful shot, unreadable title"
 *     failure, and no amount of contrast between two adjacent pixels fixes it.
 *
 * ── What a veto is reserved for ──────────────────────────────────────────────
 * The floors above are absolute, but their *consequence* is not, because the
 * same measurement means different things for different type. A 7px cap-height
 * floor at sidebar size demands a line box ~11% of canvas height; applied to
 * every role that outlaws secondary type outright, and it vetoed `versus-minimal`
 * — an editorial layout whose whole idea is small letter-spaced micro-type in a
 * lot of negative space — five times over in a single render. A gate that fails
 * a good design because it is quiet is not measuring quality, it is enforcing a
 * house style.
 *
 * So a veto needs both halves of a contradiction: the type is laid out as
 * *message-bearing* (a rect that takes real estate — see PROMINENT_AREA) and it
 * does not survive the feed. Micro-type that fails the same test is reported as
 * a warning that says what it will look like, because "this will read as texture
 * at sidebar size" is a choice a designer is allowed to make, and "the headline
 * is gone" is not. When nothing in the render clears the floor, one extra
 * finding says so plainly — the picture is carrying the whole message.
 */

import type { QaFinding, QaSeverity } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, collectTextRects, ramp, scaleRect, surroundRects, toNormRect } from '../geom.js';
import { edgeDensity, loadGray, otsu, sobel } from '../image.js';
import { YOUTUBE_DISPLAY_SIZES } from '../sizes.js';

/** Cap height as a fraction of a laid-out line box, for a typical esports
 *  display face (heavy, mostly-uppercase). */
export const CAP_RATIO = 0.7;
/** Minimum cap height in the smallest display box. */
export const MIN_CAP_PX = 7;
/** Otsu separation, in 8-bit levels, below which type stops reading. */
const MIN_STROKE_SEPARATION = 42;
const WARN_STROKE_SEPARATION = 62;
/** Ring edge density above which the local background counts as "busy". */
const BUSY_RING = 0.2;
/** How much busier than its background the text must be to stand out. */
const MIN_EDGE_RATIO = 1.3;
/**
 * Share of the canvas a text rect must occupy before failing it can veto the
 * render. Calibrated against the two real layouts in this repo: the versus
 * headline slots land at 2.8–3.6% of canvas area (message), the editorial
 * micro-type of `versus-minimal` at 0.4–1.4% (texture).
 */
export const PROMINENT_AREA = 0.025;

interface SizeVerdict {
  label: string;
  w: number;
  h: number;
  separation: number;
  textEdges: number;
  ringEdges: number;
  ratio: number;
}

export const legibilityGate: Gate = {
  id: 'legibility',
  weight: 2,
  description: 'Text still reads after downsampling to YouTube\'s real display boxes (cap height, stroke separation, edge camouflage)',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const rects = collectTextRects(ctx);
    if (rects.length === 0) {
      return [{
        gate: 'legibility',
        severity: 'pass',
        message: 'No text layers in this render — nothing to check for small-size legibility',
        score: 1,
      }];
    }

    // request.legibility === false means "report, do not veto".
    const enforce = ctx.request?.legibility !== false;
    const sev = (s: QaSeverity): QaSeverity => (s === 'fail' && !enforce ? 'warn' : s);

    const verdicts: SizeVerdict[][] = rects.map(() => []);
    const sizes = [...YOUTUBE_DISPLAY_SIZES].sort((a, b) => a.w * a.h - b.w * b.h);

    for (const size of sizes) {
      const gray = await loadGray(ctx.image, { width: size.w, height: size.h });
      const mag = sobel(gray);
      for (let i = 0; i < rects.length; i++) {
        const small = scaleRect(rects[i]!.rect, { w: ctx.width, h: ctx.height }, { w: size.w, h: size.h });
        if (small.w < 2 || small.h < 2) {
          verdicts[i]!.push({ label: size.label, w: small.w, h: small.h, separation: 0, textEdges: 0, ringEdges: 0, ratio: 0 });
          continue;
        }

        const values: number[] = [];
        for (let y = small.y; y < Math.min(size.h, small.y + small.h); y++) {
          for (let x = small.x; x < Math.min(size.w, small.x + small.w); x++) values.push(gray.data[y * size.w + x]!);
        }
        const split = otsu(values);
        const separation = Math.max(0, split.highMean - split.lowMean);

        const textEdges = edgeDensity(mag, size.w, size.h, small);
        const pad = Math.max(3, Math.round(small.h * 0.5));
        const ring = surroundRects(small, pad, size.w, size.h);
        const ringArea = ring.reduce((a, r) => a + r.w * r.h, 0);
        const ringEdges = ringArea === 0
          ? 0
          : ring.reduce((a, r) => a + edgeDensity(mag, size.w, size.h, r) * r.w * r.h, 0) / ringArea;

        verdicts[i]!.push({
          label: size.label,
          w: small.w,
          h: small.h,
          separation,
          textEdges,
          ringEdges,
          ratio: textEdges / Math.max(0.02, ringEdges),
        });
      }
    }

    const smallest = sizes[0]!;
    const findings: QaFinding[] = [];
    let anyReadable = false;

    for (let i = 0; i < rects.length; i++) {
      const { role, rect } = rects[i]!;
      const where = toNormRect(rect, ctx.width, ctx.height);
      const capPx = (rect.h / ctx.height) * smallest.h * CAP_RATIO;
      // Is this type laid out as the message, or as a detail? Only the former
      // can veto — see the note at the top of the file.
      const prominent = (rect.w / ctx.width) * (rect.h / ctx.height) >= PROMINENT_AREA;
      const vet = (s: QaSeverity): QaSeverity => (s === 'fail' && !prominent ? 'warn' : s);
      const aside = prominent
        ? ''
        : ` — flagged, not vetoed: at ${(((rect.w / ctx.width) * (rect.h / ctx.height)) * 100).toFixed(1)}% of the canvas this is a detail rather than the headline, and reading as texture at feed size may be the intent`;
      if (capPx >= MIN_CAP_PX) anyReadable = true;
      const worstSep = verdicts[i]!.reduce((w, v) => (v.separation < w.separation ? v : w), verdicts[i]![0]!);
      const worstRatio = verdicts[i]!
        .filter((v) => v.ringEdges >= BUSY_RING)
        .reduce<SizeVerdict | null>((w, v) => (!w || v.ratio < w.ratio ? v : w), null);

      let emitted = false;

      if (capPx < MIN_CAP_PX) {
        findings.push({
          gate: 'legibility',
          severity: sev(vet('fail')),
          message: `"${role}" is ${capPx.toFixed(1)}px of cap height in the ${smallest.label} box (${smallest.w}×${smallest.h}) — below the ~${MIN_CAP_PX}px where strokes stop resolving${aside}`,
          score: clamp01(ramp(capPx, 0, MIN_CAP_PX) * 0.5),
          where,
          suggestion: `Set "${role}" to at least ${Math.ceil((MIN_CAP_PX / CAP_RATIO / smallest.h) * ctx.height)}px of line height at ${ctx.width}×${ctx.height}, or cut the copy so the remaining words can be set larger.`,
        });
        emitted = true;
      }

      if (worstSep.separation < MIN_STROKE_SEPARATION) {
        findings.push({
          gate: 'legibility',
          severity: sev(vet('fail')),
          message: `"${role}" loses its stroke separation at ${worstSep.label} (${worstSep.w}×${worstSep.h}px): glyph and background populations sit only ${worstSep.separation.toFixed(0)}/255 levels apart after downsampling${aside}`,
          score: clamp01(ramp(worstSep.separation, 0, MIN_STROKE_SEPARATION) * 0.5),
          where,
          suggestion: 'Add a plate or a heavier stroke behind the type, or move it onto a darker/quieter part of the plate. Thin weights are the usual culprit — go heavier before going bigger.',
        });
        emitted = true;
      } else if (worstSep.separation < WARN_STROKE_SEPARATION) {
        findings.push({
          gate: 'legibility',
          severity: 'warn',
          message: `"${role}" is marginal at ${worstSep.label}: only ${worstSep.separation.toFixed(0)}/255 levels between glyph and background`,
          score: 0.55,
          where,
          suggestion: 'A 2–3px dark stroke or a 60% plate would make this safe at sidebar size.',
        });
        emitted = true;
      }

      if (worstRatio && worstRatio.ratio < MIN_EDGE_RATIO) {
        findings.push({
          gate: 'legibility',
          severity: sev(vet('fail')),
          message: `"${role}" is camouflaged at ${worstRatio.label}: the background around it is ${(worstRatio.ringEdges * 100).toFixed(0)}% edge pixels and the type is only ${worstRatio.ratio.toFixed(2)}× busier, so it reads as more texture${aside}`,
          score: clamp01(ramp(worstRatio.ratio, 0, MIN_EDGE_RATIO) * 0.5),
          where,
          suggestion: 'Quiet the plate behind the text — blur or darken that region, or drop a gradient scrim under the type. Busy-behind-text is the single most common thumbnail mistake.',
        });
        emitted = true;
      }

      if (!emitted) {
        const s = verdicts[i]![0]!;
        findings.push({
          gate: 'legibility',
          severity: 'pass',
          message: `"${role}" survives the ${smallest.label} box: ${capPx.toFixed(1)}px cap height, ${s.separation.toFixed(0)}/255 stroke separation`,
          score: clamp01(0.6 + 0.4 * ramp(s.separation, MIN_STROKE_SEPARATION, 160)),
          where,
        });
      }
    }

    // Nothing in the frame clears the floor. Said once, plainly, rather than
    // repeated per role: the render is asking the picture to carry the message.
    if (!anyReadable) {
      findings.push({
        gate: 'legibility',
        severity: 'warn',
        message: `No text in this render resolves in the ${smallest.label} box (${smallest.w}×${smallest.h}) — the largest is ${Math.max(...rects.map((r) => (r.rect.h / ctx.height) * smallest.h * CAP_RATIO)).toFixed(1)}px of cap height against a ~${MIN_CAP_PX}px floor. Whatever this thumbnail says at feed size, it says with the picture`,
        score: 0.5,
        suggestion: 'Fine for a deliberately editorial layout where the type is texture. Not fine if any of these words is the hook — in that case set one line at ≥11% of canvas height and cut the rest.',
      });
    }

    return findings;
  },
};
