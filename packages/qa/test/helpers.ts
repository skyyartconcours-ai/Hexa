/**
 * Test fixtures: real images, synthesised with sharp, so the gates are measured
 * against pixels rather than against mocks.
 */

import sharp from 'sharp';
import { createRng } from '@hexa/core';
import type { RenderPlan } from '@hexa/core';
import type { GateContext } from '../src/types.js';

export const W = 1280;
export const H = 720;

export function plan(overrides: Partial<RenderPlan> = {}): RenderPlan {
  return {
    canvas: { width: W, height: H, background: '#0B0B0F' },
    layers: [],
    grade: { grain: 0.02 },
    seed: 7,
    meta: { templateId: 'test-versus', subjects: ['peyz'], createdAt: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

export function ctx(image: Buffer, overrides: Partial<GateContext> = {}): GateContext {
  return {
    image,
    plan: plan(),
    width: W,
    height: H,
    subjects: [],
    ...overrides,
  };
}

/** Flat, dark canvas — the ideal plate for type. */
export async function flatBackground(color = '#0B0B0F', w = W, h = H): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

/**
 * A cluttered mid-tone plate: coarse blocks whose luminance all sits around
 * `luma`, so anything drawn on it in a similar tone disappears. Blocks are
 * deliberately large enough to survive the downscale to sidebar size — that is
 * what makes it a legibility problem rather than grain.
 */
export async function busyBackground(luma = 138, w = W, h = H, seed = 11, block = 16): Promise<Buffer> {
  const rng = createRng(seed);
  const data = Buffer.alloc(w * h * 3);
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const base = luma + rng.float(-14, 14);
      const r = clampByte(base + rng.float(-26, 26));
      const g = clampByte(base + rng.float(-26, 26));
      const b = clampByte(base + rng.float(-26, 26));
      for (let y = by; y < Math.min(h, by + block); y++) {
        for (let x = bx; x < Math.min(w, bx + block); x++) {
          const i = (y * w + x) * 3;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** Pixel-scale noise across the full tonal range — uniformly busy, no subject. */
export async function noiseImage(w = W, h = H, seed = 3, block = 4): Promise<Buffer> {
  const rng = createRng(seed);
  const data = Buffer.alloc(w * h * 3);
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const r = rng.int(0, 255), g = rng.int(0, 255), b = rng.int(0, 255);
      for (let y = by; y < Math.min(h, by + block); y++) {
        for (let x = bx; x < Math.min(w, bx + block); x++) {
          const i = (y * w + x) * 3;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** A calm composition: dark plate, one bright subject block, nothing else. */
export async function cleanComposition(w = W, h = H): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#141826"/><stop offset="1" stop-color="#05060B"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect x="${w * 0.26}" y="${h * 0.18}" width="${w * 0.2}" height="${h * 0.6}" rx="18" fill="#C8D2FF"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export interface TextSpec {
  text: string;
  color: string;
  /** Line box in device pixels. */
  rect: { x: number; y: number; w: number; h: number };
  stroke?: { color: string; width: number };
}

/** Composite a headline onto a plate. Uses the system sans face through sharp's
 *  SVG rasteriser — the same path the real text renderer uses. */
export async function withText(base: Buffer, spec: TextSpec, w = W, h = H): Promise<Buffer> {
  const fontSize = Math.round(spec.rect.h * 0.92);
  const baseline = spec.rect.y + Math.round(spec.rect.h * 0.8);
  const strokeAttr = spec.stroke
    ? ` stroke="${spec.stroke.color}" stroke-width="${spec.stroke.width}" paint-order="stroke"`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text x="${spec.rect.x}" y="${baseline}" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="${spec.color}"${strokeAttr}>${spec.text}</text>
  </svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
}

/** A smooth 8-bit ramp with no dither — the banding fixture. */
export async function gradientImage(w = W, h = H): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const v = Math.round((y / (h - 1)) * 120) + 20;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      data[i] = v; data[i + 1] = v; data[i + 2] = v + 6;
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// ── adversarial fixtures ─────────────────────────────────────────────────────
//
// Everything below builds a *defect* on purpose, together with the good-looking
// control it must be told apart from. A gate that fires on the defect but also
// on the control has not detected anything.

export interface BoxTextSpec {
  text: string;
  /** Line box in device pixels — also the SVG viewport, so anything wider than
   *  the box is sliced exactly the way a real over-long headline is. */
  rect: { x: number; y: number; w: number; h: number };
  color?: string;
  fontSize?: number;
  /** Left inset of the text origin inside the box. */
  inset?: number;
  anchor?: 'start' | 'end';
}

/**
 * Composite text through an SVG viewport the size of its own rect.
 *
 * This is the mechanism behind the real bug: the compositor rasterises each
 * text layer at the size of its slot, so when auto-fit measures with one font
 * and the rasteriser substitutes another, the last glyph is cut off by the
 * viewport and the render says "VIPEI".
 */
export async function textInBox(base: Buffer, spec: BoxTextSpec, w = W, h = H): Promise<Buffer> {
  const { rect } = spec;
  const fontSize = spec.fontSize ?? Math.round(rect.h * 0.82);
  const x = spec.anchor === 'end' ? rect.w - (spec.inset ?? 0) : (spec.inset ?? 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${rect.w} ${rect.h}">
    <text x="${x}" y="${Math.round(rect.h * 0.82)}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="${spec.anchor ?? 'start'}" fill="${spec.color ?? '#FFFFFF'}">${spec.text}</text>
  </svg>`;
  const layer = await sharp(Buffer.from(svg)).png().toBuffer();
  return sharp(base)
    .composite([{ input: layer, left: Math.max(0, rect.x), top: Math.max(0, rect.y) }])
    .resize(w, h, { fit: 'fill' })
    .png()
    .toBuffer();
}

/** Plan carrying the text-rect records the compiler really writes, so the gates
 *  see the same authoritative colours they would in production. */
export function planWithText(
  rects: { role: string; rect: { x: number; y: number; w: number; h: number }; color?: string; text?: string }[],
  overrides: Partial<RenderPlan> = {},
): RenderPlan {
  return plan({
    meta: {
      templateId: 'test', subjects: [], createdAt: '',
      textRects: rects.map((r) => ({ role: r.role, rect: r.rect, color: r.color ?? '#FFFFFF', text: r.text ?? r.role })),
      ...(overrides.meta ?? {}),
    },
    ...overrides,
  });
}

/**
 * A subject block against a background of a chosen luminance.
 *
 * `subjectLuma` below `bgLuma` gives the "face is the darkest thing in its half"
 * defect: the eye lands on the backdrop and the person becomes a hole in it.
 */
export async function subjectOnField(opts: {
  faceRect: { x: number; y: number; w: number; h: number };
  subjectLuma: number;
  bgLuma: number;
  /** Second subject, drawn the same way. */
  faceRect2?: { x: number; y: number; w: number; h: number };
  subjectLuma2?: number;
  /** Internal detail inside the face box, so it is not a flat slab. */
  detail?: boolean;
  /** Saturated accent block, so the frame is not a greyscale study. */
  accent?: string;
  w?: number;
  h?: number;
}): Promise<Buffer> {
  const w = opts.w ?? W;
  const h = opts.h ?? H;
  const grey = (v: number) => `rgb(${clampByte(v)},${clampByte(v * 0.96)},${clampByte(v * 0.92)})`;
  const face = (r: { x: number; y: number; w: number; h: number }, l: number) => {
    const px = { x: r.x * w, y: r.y * h, w: r.w * w, h: r.h * h };
    const features = opts.detail === false ? '' : `
      <ellipse cx="${px.x + px.w * 0.32}" cy="${px.y + px.h * 0.38}" rx="${px.w * 0.09}" ry="${px.h * 0.05}" fill="${grey(l * 0.55)}"/>
      <ellipse cx="${px.x + px.w * 0.68}" cy="${px.y + px.h * 0.38}" rx="${px.w * 0.09}" ry="${px.h * 0.05}" fill="${grey(l * 0.55)}"/>
      <rect x="${px.x + px.w * 0.3}" y="${px.y + px.h * 0.68}" width="${px.w * 0.4}" height="${px.h * 0.08}" fill="${grey(l * 0.5)}"/>`;
    return `<g><ellipse cx="${px.x + px.w / 2}" cy="${px.y + px.h / 2}" rx="${px.w / 2}" ry="${px.h / 2}" fill="${grey(l)}"/>${features}
      <rect x="${px.x - px.w * 0.35}" y="${px.y + px.h}" width="${px.w * 1.7}" height="${h - (px.y + px.h)}" rx="${px.w * 0.3}" fill="${grey(l * 0.9)}"/></g>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${grey(opts.bgLuma)}"/>
    <rect x="0" y="0" width="${w}" height="${h * 0.55}" fill="${grey(opts.bgLuma * 1.08)}"/>
    ${opts.accent ? `<rect x="${w * 0.52}" y="0" width="${w * 0.48}" height="${h}" fill="${opts.accent}" opacity="0.85"/>` : ''}
    ${face(opts.faceRect, opts.subjectLuma)}
    ${opts.faceRect2 ? face(opts.faceRect2, opts.subjectLuma2 ?? opts.subjectLuma) : ''}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** The headline slot used by {@link goodRender}. */
export const GOOD_HEADLINE = { x: 640, y: 470, w: 560, h: 120 };
/** The face rect used by {@link goodRender}. */
export const GOOD_FACE = { x: 0.16, y: 0.18, w: 0.2, h: 0.3 };

/**
 * A render with nothing wrong with it: lit subject against a dark plate, a
 * saturated accent, and a short headline sitting comfortably inside its box.
 *
 * Exists so "one defect tanks the score" can be measured as a *difference*. It
 * scores in the nineties and passes every gate, which is the only baseline
 * against which a veto's effect on the total means anything.
 */
export async function goodRender(): Promise<Buffer> {
  const base = await subjectOnField({
    faceRect: GOOD_FACE,
    subjectLuma: 195,
    bgLuma: 38,
    accent: '#E4002B',
  });
  return textInBox(base, { text: 'FINAL', rect: GOOD_HEADLINE, inset: 14, color: '#FFFFFF' });
}

/** GateContext for {@link goodRender}, with the plan records the compiler writes. */
export function goodContext(image: Buffer, overrides: Partial<GateContext> = {}): GateContext {
  return ctx(image, {
    plan: planWithText([{ role: 'headline', rect: GOOD_HEADLINE, color: '#FFFFFF', text: 'FINAL' }]),
    textRects: [{ role: 'headline', rect: GOOD_HEADLINE }],
    subjects: [{ playerId: 'peyz', handle: 'Peyz', faceRect: GOOD_FACE }],
    ...overrides,
  });
}

/** Deterministic unit-length embedding. */
export function embedding(seed: number, dim = 512): number[] {
  const rng = createRng(seed);
  const v = Array.from({ length: dim }, () => rng.gaussian(0, 1));
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
