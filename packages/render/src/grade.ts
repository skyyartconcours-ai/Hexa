/**
 * The colour grade — one pass over the flattened composite that decides whether
 * the frame reads as "cinema" or as "PowerPoint".
 *
 * ORDER MATTERS, and this is the order, with the reason for each position:
 *
 *  1. **exposure**      — scene-referred. Everything downstream assumes a
 *                         correctly exposed image; doing it later would move
 *                         the pivot every subsequent stage keys off. Applied in
 *                         linear light because a stop is a doubling of photons,
 *                         not of code values.
 *  2. **contrast**      — establishes the tonal range the colour work happens
 *                         over. Before white balance so its 0.5 pivot is still
 *                         a neutral grey.
 *  3. **temperature /   — a *correction*, not a look. The creative stack should
 *      tint**             start from a neutral image, so balance comes before
 *                         any creative colour. Also in linear light.
 *  4. **lift/gamma/gain** — the primary creative colour (ASC-CDL shaped:
 *                         `(x·gain + lift)^(1/gamma)`), per channel.
 *  5. **saturation**    — after all per-channel work, because per-channel gains
 *                         change what "saturated" even means; a saturation pass
 *                         before them gets partly undone.
 *  6. **split-tone**    — needs the *final* luminance to build its shadow and
 *                         highlight masks, so it must follow everything that
 *                         alters luminance. Injects chroma without moving
 *                         luminance, which is what keeps teal shadows from
 *                         turning into grey mud.
 *  7. **LUT**           — the "film stock". Look LUTs are authored against a
 *                         graded-neutral input, so they belong after primaries
 *                         and before anything optical.
 *  8. **bloom**         — optical, not colorimetric: it happens to the light
 *                         leaving the graded scene. Blooming first would have
 *                         its halos re-coloured by the grade.
 *  9. **halation**      — photochemical, one step further down the physical
 *                         chain than the lens flare bloom models.
 * 10. **chromatic       — lens geometry. Deliberately *before* the vignette:
 *      aberration**       fringing is worst at the frame edge, which is exactly
 *                         where the vignette darkens, so the vignette hides the
 *                         fringe instead of the fringe advertising itself.
 * 11. **vignette**      — lens shading over the finished image.
 * 12. **grain**         — dead last of the image operations, because grain is
 *                         the highest-frequency signal in the frame and *any*
 *                         blur-based stage after it (bloom, halation, even a
 *                         resize) averages it straight back out.
 * 13. **letterbox**     — not part of the photograph at all. Framing furniture,
 *                         drawn over everything, ungraded and ungrained.
 */

import { type GradeSpec, type Canvas, parseHex, clamp } from '@hexa/core';
import {
  type RawImage,
  toRaw,
  encodePng,
  luma8,
  srgbToLinear,
  linearToSrgb,
  LUMA_R,
  LUMA_G,
  LUMA_B,
} from './raw.js';
import { bloomRaw, halationRaw, chromaticAberrationRaw, vignetteRaw, filmGrainRaw } from './effects/optical.js';
import { applyLutRaw, BUILTIN_LUTS } from './lut.js';

/** How hard a split-tone hex pushes at weight 1. Tuned by eye on skin tones. */
const SPLIT_TONE_STRENGTH = 0.55;

interface ToneCurves {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
}

/**
 * Stages 1–4 are all per-channel scalar functions, so they collapse into three
 * 256-entry lookup tables — one table build instead of eight million pow()s.
 * Returns null when every parameter is neutral, which makes an identity grade
 * byte-exact rather than merely close.
 */
function buildToneCurves(grade: GradeSpec): ToneCurves | null {
  const ev = grade.exposure ?? 0;
  const contrast = grade.contrast ?? 1;
  const temp = grade.temperature ?? 0;
  const tint = grade.tint ?? 0;
  const lift = grade.lift ?? [0, 0, 0];
  const gamma = grade.gamma ?? [1, 1, 1];
  const gain = grade.gain ?? [1, 1, 1];

  const neutral =
    ev === 0 &&
    contrast === 1 &&
    temp === 0 &&
    tint === 0 &&
    lift.every((v) => v === 0) &&
    gamma.every((v) => v === 1) &&
    gain.every((v) => v === 1);
  if (neutral) return null;

  // Mireds → per-channel gains. Warmer (positive) lifts red and drops blue;
  // tint runs the green/magenta axis. Both are applied in linear light.
  const m = clamp(temp / 100, -3, 3);
  const t = clamp(tint / 100, -3, 3);
  const balance: [number, number, number] = [
    (1 + 0.28 * m) * (1 - 0.08 * t),
    1 + 0.02 * m + 0.2 * t,
    (1 - 0.28 * m) * (1 - 0.08 * t),
  ];

  const expGain = 2 ** ev;
  const build = (channel: 0 | 1 | 2): Uint8Array => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let s = i / 255;
      if (ev !== 0 || balance[channel] !== 1) {
        const lin = srgbToLinear(s) * expGain * balance[channel]!;
        s = linearToSrgb(clamp(lin, 0, 1));
      }
      if (contrast !== 1) s = 0.5 + (s - 0.5) * contrast;
      const gn = gain[channel] ?? 1;
      const lf = lift[channel] ?? 0;
      const gm = gamma[channel] ?? 1;
      if (gn !== 1 || lf !== 0) s = s * gn + lf;
      if (gm !== 1 && gm > 0) s = clamp(s, 0, 1) ** (1 / gm);
      table[i] = Math.round(clamp(s, 0, 1) * 255);
    }
    return table;
  };

  return { r: build(0), g: build(1), b: build(2) };
}

/** Chroma offset of a tint colour with its own luminance removed. */
function chromaOffset(hex: string): [number, number, number] {
  const { r, g, b } = parseHex(hex);
  const l = LUMA_R * r + LUMA_G * g + LUMA_B * b;
  return [r - l, g - l, b - l];
}

export async function applyGradeRaw(
  img: RawImage,
  grade: GradeSpec,
  canvas: Canvas,
  seed: number,
): Promise<RawImage> {
  const { width: w, height: h } = img;
  // Pixel-referred parameters (CA displacement, bloom radius) are authored
  // against the canvas, so scale them if we are grading at another resolution.
  const scale = canvas.width > 0 ? w / canvas.width : 1;

  // ── 1–6: the tone pass, one loop over the frame ────────────────────────────
  const curves = buildToneCurves(grade);
  const sat = grade.saturation ?? 1;
  const shadowTint = grade.shadowTint ? chromaOffset(grade.shadowTint) : null;
  const highlightTint = grade.highlightTint ? chromaOffset(grade.highlightTint) : null;
  const bal = clamp(grade.splitToneBalance ?? 0, -1, 1);
  // balance > 0 confines the shadow tint to deeper shadows and lets the
  // highlight tint reach further down the curve, and vice versa.
  const shadowExp = 2 + bal * 1.5;
  const highlightExp = 2 - bal * 1.5;

  let work = img;
  if (curves || sat !== 1 || shadowTint || highlightTint) {
    const out = Buffer.from(img.data);
    for (let p = 0; p < out.length; p += 4) {
      if (out[p + 3] === 0) continue;
      let r = out[p]!;
      let g = out[p + 1]!;
      let b = out[p + 2]!;
      if (curves) {
        r = curves.r[r]!;
        g = curves.g[g]!;
        b = curves.b[b]!;
      }
      if (sat !== 1) {
        const l = luma8(r, g, b);
        r = l + (r - l) * sat;
        g = l + (g - l) * sat;
        b = l + (b - l) * sat;
      }
      if (shadowTint || highlightTint) {
        const l = clamp(luma8(r, g, b) / 255, 0, 1);
        if (shadowTint) {
          const wgt = (1 - l) ** shadowExp * SPLIT_TONE_STRENGTH;
          r += shadowTint[0] * wgt;
          g += shadowTint[1] * wgt;
          b += shadowTint[2] * wgt;
        }
        if (highlightTint) {
          const wgt = l ** highlightExp * SPLIT_TONE_STRENGTH;
          r += highlightTint[0] * wgt;
          g += highlightTint[1] * wgt;
          b += highlightTint[2] * wgt;
        }
      }
      out[p] = Math.round(clamp(r, 0, 255));
      out[p + 1] = Math.round(clamp(g, 0, 255));
      out[p + 2] = Math.round(clamp(b, 0, 255));
    }
    work = { data: out, width: w, height: h, channels: 4 };
  }

  // ── 7: LUT ────────────────────────────────────────────────────────────────
  if (grade.lut) {
    const lut = BUILTIN_LUTS[grade.lut];
    if (lut) work = applyLutRaw(work, lut, grade.lutStrength ?? 1);
  }

  // ── 8–9: bloom, then halation ─────────────────────────────────────────────
  if ((grade.bloomIntensity ?? 0) > 0) {
    work = await bloomRaw(
      work,
      grade.bloomThreshold ?? 0.72,
      grade.bloomIntensity ?? 0,
      Math.max(1, Math.max(w, h) * 0.012),
    );
  }
  if ((grade.halation ?? 0) > 0) work = await halationRaw(work, grade.halation ?? 0);

  // ── 10–11: lens — aberration first so the vignette hides the fringe ───────
  if ((grade.chromaticAberration ?? 0) > 0) {
    work = chromaticAberrationRaw(work, (grade.chromaticAberration ?? 0) * scale);
  }
  if ((grade.vignette ?? 0) > 0) work = vignetteRaw(work, grade.vignette ?? 0);

  // ── 12: grain, after every blur-based stage ───────────────────────────────
  if ((grade.grain ?? 0) > 0) work = await filmGrainRaw(work, grade.grain ?? 0, seed);

  // ── 13: letterbox furniture ───────────────────────────────────────────────
  const bars = grade.letterbox ?? 0;
  if (bars > 0) {
    const barH = Math.min(Math.floor(h / 2), Math.round(bars * h));
    const out = work === img ? Buffer.from(work.data) : work.data;
    for (let y = 0; y < barH; y++) {
      for (let x = 0; x < w; x++) {
        const top = (y * w + x) * 4;
        const bot = ((h - 1 - y) * w + x) * 4;
        out[top] = 0;
        out[top + 1] = 0;
        out[top + 2] = 0;
        out[top + 3] = 255;
        out[bot] = 0;
        out[bot + 1] = 0;
        out[bot + 2] = 0;
        out[bot + 3] = 255;
      }
    }
    work = { data: out, width: w, height: h, channels: 4 };
  }

  return work;
}

/**
 * Grade a flattened frame. `canvas` supplies the reference resolution for
 * pixel-referred parameters; `seed` drives the grain so a re-render of the same
 * plan produces the same noise.
 */
export async function applyGrade(
  image: Buffer,
  grade: GradeSpec,
  canvas: Canvas,
  seed: number,
): Promise<Buffer> {
  return encodePng(await applyGradeRaw(await toRaw(image), grade, canvas, seed));
}
