/**
 * Font registry and discovery.
 *
 * Two measurement paths live behind one API:
 *
 *  - **Exact.** If a real `.ttf`/`.otf` is registered for the requested family,
 *    it is parsed once with opentype.js and measured via true glyph advances,
 *    real cap height and real ascent/descent from the OS/2 table.
 *  - **Approximate.** Otherwise the class tables in `metrics.ts` take over.
 *
 * opentype.js is loaded lazily through `createRequire` so measurement stays
 * synchronous, and every failure mode — module absent, file unreadable, font
 * corrupt — degrades to the tables rather than throwing. A thumbnail that is
 * 3 % off is infinitely better than a thumbnail that does not render.
 *
 * Hexa never downloads fonts. `ensureFonts` only looks at what is already on
 * disk; see `fonts/README.md` for what to drop in and why.
 */

import { createRequire } from 'node:module';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, dirname, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HexaError } from '@hexa/core';
import type { FontRegistration } from './types.js';
import { classifyFamily, FAMILY_METRICS, type ClassMetrics } from './metrics.js';
import type { OTFont } from 'opentype.js';

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.woff']);

/** The free faces Hexa is designed around; all SIL OFL. */
export const WANTED_FAMILIES = [
  'Anton', 'Bebas Neue', 'Archivo Black', 'Teko', 'Chakra Petch', 'Oswald',
] as const;

/** Common system grotesques worth registering when found — they give exact
 *  measurement on a bare box even though they are not the design intent. */
const OPPORTUNISTIC_FAMILIES = [
  'Inter', 'Roboto', 'Noto Sans', 'Liberation Sans', 'DejaVu Sans', 'FreeSans',
  'Arial', 'Helvetica', 'Barlow Condensed', 'Archivo Narrow', 'Montserrat',
];

const SYSTEM_FONT_DIRS = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  '/System/Library/Fonts',
  '/Library/Fonts',
  'C:\\Windows\\Fonts',
];

// ── registry ─────────────────────────────────────────────────────────────────

const registry: FontRegistration[] = [];
/** path → parsed font, or `null` once parsing has been tried and failed. */
const parsed = new Map<string, OTFont | null>();

function normFamily(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function registerFont(f: FontRegistration): void {
  if (!f || typeof f.family !== 'string' || !f.family.trim()) {
    throw new HexaError('INVALID_REQUEST', 'registerFont requires a non-empty family name', {
      hint: 'Pass { family: "Anton", path: "/abs/path/Anton-Regular.ttf" }.',
    });
  }
  if (typeof f.path !== 'string' || !f.path) {
    throw new HexaError('INVALID_REQUEST', `registerFont("${f.family}") requires a path`);
  }
  const path = resolve(f.path);
  if (!existsSync(path)) {
    throw new HexaError('FONT_MISSING', `Font file not found: ${f.path}`, {
      hint: 'Drop the .ttf/.otf into assets/fonts and re-run, or call ensureFonts() to discover installed faces.',
      details: { family: f.family, path: f.path },
    });
  }
  const entry: FontRegistration = {
    family: f.family.trim(),
    path,
    weight: f.weight ?? 400,
    italic: f.italic ?? false,
  };
  // Re-registering the same face replaces rather than duplicates.
  const i = registry.findIndex(
    (r) => normFamily(r.family) === normFamily(entry.family) && r.weight === entry.weight && r.italic === entry.italic,
  );
  if (i >= 0) registry[i] = entry;
  else registry.push(entry);
  parsed.delete(path);
}

export function registeredFonts(): FontRegistration[] {
  return registry.map((r) => ({ ...r }));
}

/** Test seam — drops every registration and the parse cache. */
export function clearFonts(): void {
  registry.length = 0;
  parsed.clear();
}

// ── opentype.js, loaded lazily and optionally ────────────────────────────────

let otModule: typeof import('opentype.js') | null | undefined;

function opentype(): typeof import('opentype.js') | null {
  if (otModule !== undefined) return otModule;
  try {
    const require = createRequire(import.meta.url);
    const mod = require('opentype.js') as Record<string, unknown>;
    const candidate = (typeof mod.parse === 'function' ? mod : mod.default) as typeof import('opentype.js');
    otModule = candidate && typeof candidate.parse === 'function' ? candidate : null;
  } catch {
    otModule = null; // Not installed — tables it is.
  }
  return otModule;
}

/** Is exact, glyph-level measurement available in this process? */
export function exactMeasurementAvailable(): boolean {
  return opentype() !== null;
}

function loadFont(path: string): OTFont | null {
  if (parsed.has(path)) return parsed.get(path) ?? null;
  const ot = opentype();
  if (!ot) {
    parsed.set(path, null);
    return null;
  }
  try {
    const buf = readFileSync(path);
    // Slice to the exact view: Node pools small Buffers into a shared
    // ArrayBuffer, and handing opentype.js the whole pool parses garbage.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const font = ot.parse(ab);
    parsed.set(path, font ?? null);
    return font ?? null;
  } catch {
    parsed.set(path, null);
    return null;
  }
}

/** Pick the registered face closest to the requested weight/italic. */
function bestRegistration(family: string, weight: number, italic: boolean): FontRegistration | null {
  const want = normFamily(family);
  const matches = registry.filter((r) => normFamily(r.family) === want);
  if (!matches.length) return null;
  let best = matches[0]!;
  let bestScore = Infinity;
  for (const m of matches) {
    const score = Math.abs((m.weight ?? 400) - weight) + ((m.italic ?? false) === italic ? 0 : 400);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

export interface ResolvedFace {
  /** Present only when a real font file backs this face. */
  font: OTFont | null;
  /** Always present — the class table, used directly or as a per-glyph backstop. */
  table: ClassMetrics;
  capHeight: number;
  xHeight: number;
  ascent: number;
  descent: number;
  unitsPerEm: number;
  exact: boolean;
}

const faceCache = new Map<string, ResolvedFace>();

export function resolveFace(family: string, weight = 400, italic = false): ResolvedFace {
  const key = `${normFamily(family)}|${weight}|${italic}|${registry.length}`;
  const hit = faceCache.get(key);
  if (hit) return hit;

  const table = FAMILY_METRICS[classifyFamily(family)];
  const reg = bestRegistration(family, weight, italic);
  const font = reg ? loadFont(reg.path) : null;

  let face: ResolvedFace;
  if (font && font.unitsPerEm > 0) {
    const upm = font.unitsPerEm;
    const os2 = font.tables?.os2;
    const cap = os2?.sCapHeight ? os2.sCapHeight / upm : table.capHeight;
    const xh = os2?.sxHeight ? os2.sxHeight / upm : table.xHeight;
    face = {
      font,
      table,
      capHeight: cap,
      xHeight: xh,
      ascent: Math.abs(font.ascender) / upm || table.ascent,
      descent: Math.abs(font.descender) / upm || table.descent,
      unitsPerEm: upm,
      exact: true,
    };
  } else {
    face = {
      font: null,
      table,
      capHeight: table.capHeight,
      xHeight: table.xHeight,
      ascent: table.ascent,
      descent: table.descent,
      unitsPerEm: 1000,
      exact: false,
    };
  }
  faceCache.set(key, face);
  return face;
}

/** Exact advance in em for one code point, or `null` if the face lacks it. */
export function exactAdvance(face: ResolvedFace, ch: string): number | null {
  const font = face.font;
  if (!font) return null;
  try {
    const glyph = font.charToGlyph(ch);
    // index 0 is .notdef — the font does not have this character, so its
    // advance is a tofu box, not the width the renderer will actually use.
    if (!glyph || glyph.index === 0 || glyph.advanceWidth === undefined) return null;
    return glyph.advanceWidth / face.unitsPerEm;
  } catch {
    return null;
  }
}

// ── font stacks ──────────────────────────────────────────────────────────────

const CONDENSED_STACK = [
  'Anton', 'Bebas Neue', 'Oswald', 'Teko', 'Archivo Narrow', 'Impact',
  'Haettenschweiler', 'Arial Narrow', 'Liberation Sans Narrow', 'DejaVu Sans Condensed',
];
const GROTESQUE_STACK = [
  'Archivo Black', 'Inter', 'Helvetica Neue', 'Helvetica', 'Arial',
  'Liberation Sans', 'DejaVu Sans', 'FreeSans',
];
const FALLBACK_STACK = ['Helvetica', 'Arial', 'Liberation Sans', 'DejaVu Sans', 'FreeSans'];

function quote(family: string): string {
  // Bare CSS idents are only safe for single unquoted words; quote everything
  // else. The family itself is XML-escaped later, at attribute build time.
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(family) ? family : `'${family.replace(/['\\]/g, '')}'`;
}

/**
 * A CSS `font-family` list: the requested family first, then class-appropriate
 * open fallbacks, then `sans-serif`. This is what keeps output looking
 * deliberate on a machine with no display fonts installed at all.
 */
export function fontStack(family: string): string {
  const cls = classifyFamily(family);
  const tail = cls === 'condensed' ? CONDENSED_STACK : cls === 'grotesque' ? GROTESQUE_STACK : FALLBACK_STACK;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [family, ...tail]) {
    const k = normFamily(f);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(quote(f));
  }
  out.push('sans-serif');
  return out.join(', ');
}

// ── discovery ────────────────────────────────────────────────────────────────

const WEIGHT_TOKENS: [RegExp, number][] = [
  [/extrablack|ultrablack/, 950], [/black|heavy/, 900],
  [/extrabold|ultrabold|extbd/, 800], [/semibold|demibold|demi/, 600],
  [/bold/, 700], [/medium/, 500], [/(^|[^a-z])light/, 300],
  [/extralight|ultralight/, 200], [/thin|hairline/, 100],
  [/regular|normal|book/, 400],
];

function inferWeight(name: string): number {
  const n = name.toLowerCase();
  for (const [re, w] of WEIGHT_TOKENS) if (re.test(n)) return w;
  return 400;
}

function inferItalic(name: string): boolean {
  return /italic|oblique/i.test(name);
}

/** Which of `families` this filename looks like a face of. */
function matchFamily(fileBase: string, families: readonly string[]): string | null {
  const n = normFamily(fileBase);
  let best: string | null = null;
  for (const fam of families) {
    const f = normFamily(fam);
    if (n.startsWith(f) && (!best || f.length > normFamily(best).length)) best = fam;
  }
  return best;
}

async function scanDir(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Missing or unreadable — nothing to report, nothing to fail.
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await scanDir(full, depth - 1, out);
    } else if (e.isFile() && FONT_EXT.has(extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
}

/** Walk up from this module looking for the workspace root. */
function repoRoot(): string {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** Default location for project-supplied fonts: `<repo>/assets/fonts`. */
export function defaultFontDir(): string {
  return join(repoRoot(), 'assets', 'fonts');
}

/**
 * Scan `dir` (default `<repo>/assets/fonts`) plus the usual system font paths
 * and register every face that matches a family Hexa knows how to use.
 *
 * Never downloads anything. `missing` lists the design-intent families that
 * were not found; text still renders without them, via `fontStack` fallbacks
 * and the class tables, just less exactly.
 */
export async function ensureFonts(dir?: string): Promise<{ available: string[]; missing: string[] }> {
  const roots = [dir ?? defaultFontDir(), ...SYSTEM_FONT_DIRS];
  const files: string[] = [];
  for (const root of roots) {
    // Project fonts get a deeper walk than the (potentially enormous) system trees.
    await scanDir(root, root === roots[0] ? 4 : 3, files);
  }

  const known = [...WANTED_FAMILIES, ...OPPORTUNISTIC_FAMILIES];
  const found = new Set<string>();

  for (const file of files) {
    const base = basename(file, extname(file));
    const fam = matchFamily(base, known);
    if (!fam) continue;
    try {
      if (!statSync(file).isFile()) continue;
      registerFont({ family: fam, path: file, weight: inferWeight(base), italic: inferItalic(base) });
      found.add(fam);
    } catch {
      // A face we cannot register is simply a face we do not have.
    }
  }

  faceCache.clear();
  const available = [...WANTED_FAMILIES].filter((f) => found.has(f));
  const missing = [...WANTED_FAMILIES].filter((f) => !found.has(f));
  return { available, missing };
}
