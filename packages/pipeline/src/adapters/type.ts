/**
 * @hexa/type adapter — typography.
 *
 * Text comes back as SVG markup that becomes a `{type:'svg'}` layer. The other
 * half of the return matters just as much: the *resolved* rect, colour and font
 * size are recorded into `plan.meta.textRects` so the QA contrast and legibility
 * gates can measure the type that was actually drawn rather than the slot it was
 * asked to fill.
 */

import type { PixelRect, TextRole } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule } from './load.js';
import { toMarkup, toNumber, toRect } from './normalise.js';
import { TYPE_EXPORTS, type AutoFitInput, type TypeModule, type TypePreset, type VersusMarkInput } from './contracts.js';

const SPEC = '@hexa/type';
const HINT = 'The typography package is not built. Run: pnpm --filter @hexa/type build';

async function mod(): Promise<TypeModule> {
  return loadModule<TypeModule>(SPEC, { needs: TYPE_EXPORTS, hint: HINT });
}

/** What the compiler needs back from a text fit. */
export interface TextFit {
  markup: string;
  /** The rect the glyphs actually occupy, which may be smaller than the slot. */
  rect: PixelRect;
  fontSize: number;
  color: string;
  lines: string[];
}

function normaliseFit(raw: unknown, input: { rect: PixelRect; color?: string }, what: string): TextFit {
  const markup = toMarkup(raw);
  if (!markup) {
    throw new HexaError('FONT_MISSING', `${what} produced no SVG markup`, {
      hint: 'Fonts may be missing — run `hexa doctor`. If fonts are fine, @hexa/type\'s return shape has drifted; fix packages/pipeline/src/adapters/type.ts.',
    });
  }
  const bag = (raw ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(bag['lines']) ? (bag['lines'] as unknown[]).map(String) : [];
  return {
    markup,
    rect: toRect(bag['rect'] ?? bag['bounds']) ?? input.rect,
    fontSize: toNumber(bag['fontSize'] ?? bag['size']) ?? 0,
    color: typeof bag['color'] === 'string' ? bag['color'] : typeof bag['fill'] === 'string' ? bag['fill'] : (input.color ?? '#FFFFFF'),
    lines,
  };
}

/**
 * Fit copy inside a rect, shrinking and wrapping until it fits.
 *
 * Autofit rather than a fixed size because thumbnail copy is user-supplied:
 * "RIVALS" and "THE GREATEST UPSET IN LCK HISTORY" go into the same slot and
 * both have to look deliberate.
 */
export async function autoFit(input: AutoFitInput): Promise<TextFit> {
  const m = await mod();
  return normaliseFit(await m.autoFit(input), input, `autoFit("${input.text.slice(0, 24)}")`);
}

/** The versus mark — the graphic device that makes a 1v1 read as a clash. */
export async function versusMark(input: VersusMarkInput): Promise<TextFit> {
  const m = await mod();
  return normaliseFit(await m.versusMark(input), { rect: input.rect, color: input.accent }, 'versusMark');
}

/** Typographic preset for a role, or `undefined` to let @hexa/type default it. */
export async function presetFor(role: TextRole): Promise<TypePreset | string | undefined> {
  try {
    const m = await mod();
    const p = m.preset(role);
    if (p) return p;
    return m.PRESETS?.[role];
  } catch {
    return undefined;
  }
}

/**
 * Load/verify the font stack.
 *
 * @returns the list of problems; empty means the stack is healthy. Never
 * throws — `hexa doctor` wants the diagnosis, not an exception.
 */
export async function ensureFonts(): Promise<{ ok: boolean; error?: string }> {
  try {
    const m = await mod();
    await m.ensureFonts();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fontStack(family?: string): Promise<string[]> {
  try {
    const m = await mod();
    const s = m.fontStack(family);
    return Array.isArray(s) ? s : typeof s === 'string' ? [s] : [];
  } catch {
    return [];
  }
}

/** 0–1 legibility estimate for fitted text over its backdrop. */
export async function legibilityScore(input: unknown): Promise<number | undefined> {
  try {
    const m = await mod();
    return toNumber(m.legibilityScore(input));
  } catch {
    return undefined;
  }
}

export type { AutoFitInput, TypePreset, VersusMarkInput };
