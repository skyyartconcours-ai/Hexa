/**
 * Return-value normalisation.
 *
 * Siblings are written by different hands, and the difference between returning
 * `Buffer` and returning `{ buffer, width, height }` is a coin flip that should
 * never reach the stage code. These readers accept the plausible spellings of a
 * value and produce the one shape the pipeline uses.
 *
 * Everything here is pure and total: a reader returns `undefined` rather than
 * throwing, so the caller decides whether a missing value is fatal.
 */

import type { FaceBox, FaceLandmarks, PixelRect } from '@hexa/core';

type Bag = Record<string, unknown>;

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null;
}

/** First defined value among `keys`. */
function pick(v: unknown, keys: readonly string[]): unknown {
  if (!isBag(v)) return undefined;
  for (const k of keys) if (v[k] !== undefined && v[k] !== null) return v[k];
  return undefined;
}

const BUFFER_KEYS = ['buffer', 'png', 'image', 'data', 'bytes', 'output', 'cutout', 'result'] as const;

/** Bytes out of a raw Buffer, a typed array, a base64 string or an envelope. */
export function toBuffer(v: unknown): Buffer | undefined {
  if (v === undefined || v === null) return undefined;
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (typeof v === 'string') {
    // A data URL or a bare base64 payload; a filesystem path is the caller's job.
    const m = /^data:[^;]+;base64,(.*)$/s.exec(v);
    if (m?.[1]) return Buffer.from(m[1], 'base64');
    return undefined;
  }
  const inner = pick(v, BUFFER_KEYS);
  return inner === undefined ? undefined : toBuffer(inner);
}

/** SVG source out of a string or a `{markup}`/`{svg}` envelope. */
export function toMarkup(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  const inner = pick(v, ['markup', 'svg', 'source', 'xml', 'content']);
  return typeof inner === 'string' ? inner : undefined;
}

export function toNumber(v: unknown, fallback?: number): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function toBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** A rect from `{x,y,w,h}` or `{x,y,width,height}` or `[x,y,w,h]`. */
export function toRect(v: unknown): PixelRect | undefined {
  if (Array.isArray(v) && v.length >= 4) {
    const [x, y, w, h] = v.map((n) => toNumber(n));
    if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) return { x, y, w, h };
    return undefined;
  }
  if (!isBag(v)) return undefined;
  const x = toNumber(v['x'] ?? v['left']);
  const y = toNumber(v['y'] ?? v['top']);
  const w = toNumber(v['w'] ?? v['width']);
  const h = toNumber(v['h'] ?? v['height']);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

export function toFaceBox(v: unknown): FaceBox | undefined {
  const r = toRect(isBag(v) && v['box'] !== undefined ? v['box'] : isBag(v) && v['bbox'] !== undefined ? v['bbox'] : v);
  if (!r) return undefined;
  const confidence = toNumber(pick(v, ['confidence', 'score', 'det_score', 'prob'])) ?? 1;
  return { ...r, confidence };
}

function toPoint(v: unknown): [number, number] | undefined {
  if (Array.isArray(v) && v.length >= 2) {
    const x = toNumber(v[0]);
    const y = toNumber(v[1]);
    return x === undefined || y === undefined ? undefined : [x, y];
  }
  if (isBag(v)) {
    const x = toNumber(v['x']);
    const y = toNumber(v['y']);
    return x === undefined || y === undefined ? undefined : [x, y];
  }
  return undefined;
}

const LANDMARK_ALIASES: Record<keyof FaceLandmarks, readonly string[]> = {
  leftEye: ['leftEye', 'left_eye', 'eyeLeft'],
  rightEye: ['rightEye', 'right_eye', 'eyeRight'],
  nose: ['nose', 'noseTip', 'nose_tip'],
  mouthLeft: ['mouthLeft', 'mouth_left', 'leftMouth'],
  mouthRight: ['mouthRight', 'mouth_right', 'rightMouth'],
};

/** Landmarks from a named map or the insightface 5-point array. */
export function toLandmarks(v: unknown): FaceLandmarks | undefined {
  const src = isBag(v) && (v['landmarks'] !== undefined || v['kps'] !== undefined)
    ? (v['landmarks'] ?? v['kps'])
    : v;

  if (Array.isArray(src) && src.length >= 5) {
    const pts = src.slice(0, 5).map(toPoint);
    if (pts.every((p): p is [number, number] => p !== undefined)) {
      return { leftEye: pts[0]!, rightEye: pts[1]!, nose: pts[2]!, mouthLeft: pts[3]!, mouthRight: pts[4]! };
    }
    return undefined;
  }

  if (!isBag(src)) return undefined;
  const out: Partial<FaceLandmarks> = {};
  for (const [key, aliases] of Object.entries(LANDMARK_ALIASES) as [keyof FaceLandmarks, readonly string[]][]) {
    const p = toPoint(pick(src, aliases));
    if (!p) return undefined;
    out[key] = p;
  }
  return out as FaceLandmarks;
}

/** A 1-D numeric embedding from an array or an envelope. */
export function toEmbedding(v: unknown): number[] | undefined {
  const src = isBag(v) ? (pick(v, ['embedding', 'vector', 'features', 'embeddings']) ?? v) : v;
  if (!Array.isArray(src)) return undefined;
  if (src.length > 0 && Array.isArray(src[0])) return toEmbedding(src[0]);
  const nums = src.map((n) => toNumber(n));
  return nums.every((n): n is number => n !== undefined) ? nums : undefined;
}

/** Unwrap `{items}`/`{results}`/`{faces}` list envelopes. */
export function toArray<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  const inner = pick(v, ['items', 'results', 'faces', 'list', 'data', 'variants', 'rows', 'assets']);
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/** A `{width,height}` pair from any of the usual spellings. */
export function toSize(v: unknown): { width: number; height: number } | undefined {
  if (!isBag(v)) return undefined;
  const width = toNumber(v['width'] ?? v['w']);
  const height = toNumber(v['height'] ?? v['h']);
  return width === undefined || height === undefined ? undefined : { width, height };
}

/** A 0–1 score from a bare number or a `{score}` envelope, clamped. */
export function toScore(v: unknown, fallback = 0): number {
  const n = toNumber(isBag(v) ? pick(v, ['score', 'value', 'appeal', 'similarity']) : v);
  if (n === undefined) return fallback;
  return n;
}
