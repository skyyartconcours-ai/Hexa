/**
 * @hexa/render adapter — the compositor.
 *
 * A RenderPlan is data with no closures, so the boundary here is narrow: hand
 * over the plan plus the buffers its `{type:'buffer'}` layers reference, get
 * pixels back.
 */

import type { GradeSpec, RenderPlan, RenderResult } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule } from './load.js';
import { toBuffer, toNumber } from './normalise.js';
import { RENDER_EXPORTS, type RenderModule, type RenderOptions } from './contracts.js';

const SPEC = '@hexa/render';
const HINT = 'The compositor package is not built. Run: pnpm --filter @hexa/render build';

async function mod(): Promise<RenderModule> {
  return loadModule<RenderModule>(SPEC, { needs: RENDER_EXPORTS, hint: HINT });
}

/**
 * Composite a plan.
 *
 * @throws HexaError `RENDER_FAILED` — wrapping whatever the compositor threw, so
 * the CLI can map it to a stable exit code and print a hint.
 */
export async function renderPlan(plan: RenderPlan, opts: RenderOptions = {}): Promise<RenderResult> {
  const m = await mod();
  let raw: unknown;
  try {
    raw = await m.renderPlan(plan, opts);
  } catch (cause) {
    throw new HexaError('RENDER_FAILED', `Compositing failed for ${plan.meta.templateId}: ${message(cause)}`, {
      hint: 'Run with --log debug to see the layer list, and `hexa doctor` to check sharp and the font stack.',
      details: { templateId: plan.meta.templateId, variantId: plan.meta.variantId, layers: plan.layers.length },
      cause,
    });
  }

  const buffer = toBuffer(raw);
  if (!buffer) {
    throw new HexaError('RENDER_FAILED', 'The compositor returned no image data', {
      hint: 'renderPlan() in @hexa/render returned an unexpected shape — fix packages/pipeline/src/adapters/render.ts.',
      details: { got: raw === undefined ? 'undefined' : typeof raw },
    });
  }

  const bag = (raw ?? {}) as Record<string, unknown>;
  return {
    buffer,
    width: toNumber(bag['width']) ?? plan.canvas.width,
    height: toNumber(bag['height']) ?? plan.canvas.height,
    format: (bag['format'] as RenderResult['format']) ?? opts.format ?? 'png',
    timings: (bag['timings'] as Record<string, number>) ?? {},
    plan,
  };
}

/** Encode and write to disk. Returns the path actually written. */
export async function exportImage(
  image: Buffer,
  dest: string,
  opts?: { format?: string; quality?: number },
): Promise<string> {
  const m = await mod();
  try {
    const out = await m.exportImage(image, dest, opts);
    return typeof out === 'string' ? out : dest;
  } catch (cause) {
    throw new HexaError('IO_ERROR', `Could not write ${dest}: ${message(cause)}`, {
      hint: 'Check the output directory exists and is writable, then retry.',
      details: { dest },
      cause,
    });
  }
}

export async function applyGrade(image: Buffer, grade: GradeSpec): Promise<Buffer> {
  const m = await mod();
  return toBuffer(await m.applyGrade(image, grade)) ?? image;
}

/** Side-by-side sheet of every variant, for eyeballing a batch at a glance. */
export async function contactSheet(
  images: readonly (Buffer | string)[],
  opts?: { columns?: number; labels?: string[]; width?: number; background?: string },
): Promise<Buffer | undefined> {
  try {
    const m = await mod();
    return toBuffer(await m.contactSheet(images, opts));
  } catch {
    return undefined;
  }
}

/** Names of the LUTs the compositor ships — the grade axis picks from these. */
export async function builtinLutNames(): Promise<string[]> {
  try {
    const m = await mod();
    const luts = m.BUILTIN_LUTS;
    if (Array.isArray(luts)) return luts.filter((l): l is string => typeof l === 'string');
    if (luts && typeof luts === 'object') return Object.keys(luts);
    return [];
  } catch {
    return [];
  }
}

/** Generator ids the compositor can paint — used to validate fx before emitting. */
export async function generatorIds(): Promise<string[]> {
  try {
    const m = await mod();
    const g = m.generators;
    if (Array.isArray(g)) return g.filter((x): x is string => typeof x === 'string');
    if (g && typeof g === 'object') return Object.keys(g);
    return [];
  } catch {
    return [];
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type { RenderOptions };
