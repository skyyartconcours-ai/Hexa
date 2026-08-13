/**
 * Resource bounds and hostile-input guards.
 *
 * Hexa composites images from files it did not create and text it did not
 * write. Every one of those inputs arrives with a number attached — a pixel
 * count, a variant count, a layer count, a string length — and every one of
 * those numbers is an opportunity for a caller to ask for something the process
 * cannot survive. `variants: 100000` and a `100000 × 100000` canvas are not
 * clever attacks; they are what a typo produces, and the difference between a
 * clear `INVALID_REQUEST` and an OOM kill is entirely whether somebody wrote
 * the bound down.
 *
 * This module is where they are written down. The constants live in `@hexa/core`
 * rather than in whichever package happens to consume them so that the CLI, the
 * studio server, the ingester and the render planner cannot drift into three
 * different opinions about what "too big" means — a bound that only one of four
 * entry points enforces is not a bound.
 *
 * Nothing here does I/O and nothing here logs; these are pure predicates meant
 * to be called at the edge, before an allocation is attempted.
 */

import { HexaError } from './errors.js';

// ── canvas & raster ──────────────────────────────────────────────────────────

/**
 * Largest canvas edge, in device pixels. 16 384 is the point at which every
 * rasteriser in the stack (libvips, librsvg, Cairo) starts refusing or
 * silently truncating, so allowing more only converts a clear error into an
 * obscure one.
 */
export const MAX_CANVAS_EDGE = 16_384;

/**
 * Largest canvas area, in device pixels, *before* supersampling.
 *
 * 40 megapixels is a little over 8K DCI and roughly 160 MB of RGBA — the point
 * where a single accumulator still fits comfortably in a default Node heap
 * alongside one layer being composited into it. The area cap is the load-bearing
 * one: a 16 000 × 16 000 canvas passes both edge checks and still asks for a
 * gigabyte.
 */
export const MAX_CANVAS_PIXELS = 40_000_000;

/** Supersampling beyond this multiplies the accumulator past any useful gain. */
export const MAX_SUPERSAMPLE = 4;

/**
 * Largest input image Hexa will decode, in pixels. Matches sharp's own default
 * `limitInputPixels` (0x3FFF²) so a decompression bomb is refused identically
 * whether it arrives through sharp's guard or ours.
 */
export const MAX_INPUT_PIXELS = 268_402_689;

/** Largest single file the ingester will read into memory, in bytes. */
export const MAX_INPUT_FILE_BYTES = 256 * 1024 * 1024;

// ── plan complexity ──────────────────────────────────────────────────────────

/** A composition with more layers than this is a bug, not a design. */
export const MAX_LAYERS = 512;

/** Mask chains deeper than this are a cycle in all but name. */
export const MAX_MASK_DEPTH = 16;

// ── text ─────────────────────────────────────────────────────────────────────

/**
 * Longest headline, in UTF-16 code units.
 *
 * A thumbnail headline is at most a few words; 4 096 is already absurd. The cap
 * exists because layout cost is superlinear in glyph count — per-character
 * jitter emits one `<text>` node per glyph, so a 100 000-character string is a
 * 100 000-element SVG document that librsvg must parse and Cairo must draw.
 */
export const MAX_TEXT_LENGTH = 4_096;

/** C0 controls other than tab/LF/CR, plus the two BMP noncharacters XML forbids. */
const ILLEGAL_XML_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** A surrogate with no partner: legal inside a JS string, unencodable as UTF-8. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Strip characters that XML 1.0 forbids and repair unpaired surrogates.
 *
 * Escaping alone is not enough: `&#x0;` is *escaped* to a harmless literal, but
 * a raw U+0000 in the source string produces a document no parser will accept,
 * and a lone surrogate cannot even be encoded to UTF-8. Both turn a cosmetic
 * input problem into a hard rasteriser failure several packages away from the
 * caller who typed it, so they are removed at the boundary instead.
 *
 * This deliberately does *not* escape `&<>"'` — that is the serialiser's job,
 * and doing it in two places would double-escape.
 */
export function sanitiseXmlText(input: unknown): string {
  const s = input === null || input === undefined ? '' : String(input);
  return s.replace(LONE_SURROGATE, '\uFFFD').replace(ILLEGAL_XML_CHAR, '');
}

// ── numeric guards ───────────────────────────────────────────────────────────

/**
 * Coerce to an integer inside `[min, max]`, or throw `INVALID_REQUEST`.
 *
 * Rejects rather than clamps: silently turning `variants: 100000` into 24 makes
 * the caller believe they got what they asked for, and the first they hear of
 * it is a bug report about missing files. `NaN`, `Infinity` and `"4"` are all
 * refused — a string that looks like a number is a caller who skipped their own
 * validation.
 */
export function requireInt(value: unknown, field: string, min: number, max: number, hint?: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new HexaError('INVALID_REQUEST', `${field} must be an integer (got ${describe(value)})`, {
      ...(hint ? { hint } : {}),
      details: { field, value: describe(value) },
    });
  }
  if (value < min || value > max) {
    throw new HexaError('INVALID_REQUEST', `${field} must be between ${min} and ${max} (got ${value})`, {
      ...(hint ? { hint } : {}),
      details: { field, value, min, max },
    });
  }
  return value;
}

/**
 * Best-effort integer coercion with a fallback — for flag soup and HTTP bodies,
 * where `undefined`, `"4"` and `4` all legitimately mean four.
 *
 * Out-of-range and unparseable values collapse to `fallback` rather than
 * throwing, so this is only appropriate where a wrong-but-safe default is
 * better than a failed request. Use {@link requireInt} when the caller should
 * be told they were wrong.
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Refuse a canvas that cannot be allocated.
 *
 * Checks the area *including* supersampling, because that is the buffer that
 * actually gets allocated: a 4 096 × 4 096 canvas at 4× is a 268-megapixel
 * accumulator, roughly a gigabyte of RGBA, from a request that looks modest.
 *
 * @throws HexaError `INVALID_REQUEST`
 */
export function assertCanvasWithinBudget(
  width: number,
  height: number,
  supersample = 1,
  field = 'canvas',
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new HexaError('INVALID_REQUEST', `${field} must have positive dimensions (got ${describe(width)}×${describe(height)})`, {
      hint: 'Pick an aspect preset, or pass whole positive pixel dimensions.',
      details: { field, width: describe(width), height: describe(height) },
    });
  }
  if (width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE) {
    throw new HexaError('INVALID_REQUEST', `${field} edge exceeds ${MAX_CANVAS_EDGE}px (got ${Math.round(width)}×${Math.round(height)})`, {
      hint: `Rasterisers refuse edges beyond ${MAX_CANVAS_EDGE}px; render smaller and upscale if you truly need more.`,
      details: { field, width, height, max: MAX_CANVAS_EDGE },
    });
  }
  const ss = Math.max(1, Math.min(MAX_SUPERSAMPLE, Math.round(Number.isFinite(supersample) ? supersample : 1)));
  const pixels = width * height * ss * ss;
  if (pixels > MAX_CANVAS_PIXELS) {
    throw new HexaError(
      'INVALID_REQUEST',
      `${field} is too large: ${Math.round(width)}×${Math.round(height)} at ${ss}× is ${Math.round(pixels / 1e6)} megapixels (limit ${Math.round(MAX_CANVAS_PIXELS / 1e6)})`,
      {
        hint: 'Reduce the canvas size or the supersample factor.',
        details: { field, width, height, supersample: ss, pixels, max: MAX_CANVAS_PIXELS },
      },
    );
  }
}

/** Human-safe rendering of an arbitrary value for an error message. */
function describe(v: unknown): string {
  if (typeof v === 'string') return v.length > 64 ? `${v.slice(0, 64)}… (${v.length} chars)` : v;
  return String(v);
}
