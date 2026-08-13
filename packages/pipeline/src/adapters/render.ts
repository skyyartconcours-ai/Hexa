/**
 * @hexa/render adapter — the compositor.
 *
 * A RenderPlan is data with no closures, so the boundary is narrow: hand over
 * the plan plus the buffers its `{type:'buffer'}` layers reference, get pixels.
 *
 * One translation worth naming: `exportImage` in @hexa/render **encodes**, it
 * does not write. Writing is done here, so the stage code can say "put this
 * variant at this path" and get a real error with a real hint when the directory
 * is not writable.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Canvas, GradeSpec, RenderPlan, RenderResult } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule } from './load.js';
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
  try {
    const result = await m.renderPlan(plan, opts);
    if (!result?.buffer?.length) {
      throw new HexaError('RENDER_FAILED', 'The compositor returned no image data', {
        hint: 'renderPlan() in @hexa/render returned an unexpected shape — fix packages/pipeline/src/adapters/render.ts.',
      });
    }
    return result;
  } catch (cause) {
    if (cause instanceof HexaError) throw cause;
    throw new HexaError('RENDER_FAILED', `Compositing failed for ${plan.meta.templateId}: ${message(cause)}`, {
      hint: 'Run with --log debug to see the layer list, and `hexa doctor` to check sharp and the font stack.',
      details: { templateId: plan.meta.templateId, variantId: plan.meta.variantId, layers: plan.layers.length },
      cause,
    });
  }
}

/**
 * Encode and write to disk.
 *
 * @returns the path written
 * @throws HexaError `IO_ERROR`
 */
export async function writeImage(
  image: Buffer,
  dest: string,
  opts: { format?: string; quality?: number } = {},
): Promise<string> {
  const m = await mod();
  const format = opts.format ?? extensionFormat(dest) ?? 'png';

  let encoded: Buffer;
  try {
    encoded = await m.exportImage(image, format, opts.quality);
  } catch (cause) {
    throw new HexaError('RENDER_FAILED', `Could not encode ${format}: ${message(cause)}`, {
      hint: `Try --format png. If this persists, sharp may lack ${format} support — run \`hexa doctor\`.`,
      details: { format, dest },
      cause,
    });
  }

  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, encoded);
    return dest;
  } catch (cause) {
    throw new HexaError('IO_ERROR', `Could not write ${dest}: ${message(cause)}`, {
      hint: 'Check the output directory exists and is writable, then retry.',
      details: { dest },
      cause,
    });
  }
}

/** Encode without writing — for callers that stream the bytes elsewhere. */
export async function encodeImage(image: Buffer, format: string, quality?: number): Promise<Buffer> {
  return (await mod()).exportImage(image, format, quality);
}

export async function applyGrade(image: Buffer, grade: GradeSpec, canvas: Canvas, seed: number): Promise<Buffer> {
  return (await mod()).applyGrade(image, grade, canvas, seed);
}

/**
 * Side-by-side sheet of every variant, for eyeballing a batch at a glance.
 * Returns `undefined` rather than throwing: losing the contact sheet must not
 * lose the renders it was made from.
 */
export async function contactSheet(
  images: readonly { buffer: Buffer; label: string }[],
  opts?: { cols?: number; width?: number; background?: string },
): Promise<Buffer | undefined> {
  try {
    return await (await mod()).contactSheet([...images], opts);
  } catch {
    return undefined;
  }
}

/** Names of the built-in LUTs — the grade variant axis picks from these. */
export async function builtinLutNames(): Promise<string[]> {
  try {
    const luts = (await mod()).BUILTIN_LUTS;
    return luts && typeof luts === 'object' ? Object.keys(luts).sort() : [];
  } catch {
    return [];
  }
}

/** Generator ids the compositor can paint — lets the compiler check fx first. */
export async function generatorIds(): Promise<string[]> {
  try {
    const g = (await mod()).generators;
    return g && typeof g === 'object' ? Object.keys(g).sort() : [];
  } catch {
    return [];
  }
}

function extensionFormat(dest: string): string | undefined {
  const ext = path.extname(dest).slice(1).toLowerCase();
  if (ext === 'jpg') return 'jpeg';
  return ext === '' ? undefined : ext;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type { RenderOptions };
