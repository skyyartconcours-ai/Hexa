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
