/**
 * Stage 9 — emit.
 *
 * Write the artefacts and describe what was written. Three things ship with a
 * render and all of them matter:
 *   - the image(s), named so variants sort in order;
 *   - the RenderPlan as JSON when asked, which is the audit trail — every layer,
 *     every asset id, every effect that produced those pixels;
 *   - the photo credit line, built from the assets *actually composited*.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { HexaError } from '@hexa/core';
import type { Logger, OutputRequest, ReferenceAsset, RenderPlan } from '@hexa/core';
import { creditLine } from '../adapters/assets.js';
import { contactSheet, writeImage } from '../adapters/render.js';

export interface EmitOptions {
  output: OutputRequest & { format: NonNullable<OutputRequest['format']>; quality: number; name: string };
  logger: Logger;
}

export interface EmittedVariant {
  variantId: string;
  imagePath: string;
  planPath?: string;
}

/** Ensure the output directory exists, with an error that says what to do. */
export async function ensureOutputDir(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  try {
    await fs.mkdir(resolved, { recursive: true });
    return resolved;
  } catch (cause) {
    throw new HexaError('IO_ERROR', `Cannot create output directory ${resolved}`, {
      hint: 'Check the path is writable, or pass a different --out directory.',
      details: { dir: resolved },
      cause,
    });
  }
}

/**
 * File name for a variant.
 *
 * Single-variant jobs get a clean `name.png`; multi-variant jobs get
 * `name-v01.png`, which sorts correctly in a file manager and in a shell glob.
 */
export function variantFilename(name: string, variantId: string, format: string, total: number): string {
  const base = total <= 1 ? name : `${name}-${variantId}`;
  return `${base}.${format === 'jpeg' ? 'jpg' : format}`;
}

export async function emitVariant(args: {
  image: Buffer;
  plan: RenderPlan;
  variantId: string;
  total: number;
  dir: string;
  options: EmitOptions;
}): Promise<EmittedVariant> {
  const { options, dir, variantId, total } = args;
  const filename = variantFilename(options.output.name, variantId, options.output.format, total);
  const imagePath = path.join(dir, filename);

  await writeImage(args.image, imagePath, { format: options.output.format, quality: options.output.quality });
  options.logger.debug('wrote image', { path: imagePath, bytes: args.image.length });

  let planPath: string | undefined;
  if (options.output.emitPlan) {
    planPath = imagePath.replace(/\.[^.]+$/, '.plan.json');
    try {
      await fs.writeFile(planPath, `${JSON.stringify(args.plan, null, 2)}\n`, 'utf8');
    } catch (cause) {
      // The plan is a debugging aid; failing to write it must not lose the image
      // that was already produced successfully.
      options.logger.warn('could not write plan JSON', { path: planPath, error: String(cause) });
      planPath = undefined;
    }
  }

  return { variantId, imagePath, planPath };
}

/** Contact sheet of every variant. Returns undefined when it could not be made. */
export async function emitContactSheet(args: {
  images: Buffer[];
  labels: string[];
  dir: string;
  name: string;
  logger: Logger;
}): Promise<string | undefined> {
  if (args.images.length < 2) return undefined;
  const sheet = await contactSheet(
    args.images.map((buffer, i) => ({ buffer, label: args.labels[i] ?? `v${String(i + 1).padStart(2, '0')}` })),
    { cols: args.images.length <= 4 ? 2 : 3 },
  );
  if (!sheet) {
    args.logger.warn('contact sheet could not be generated');
    return undefined;
  }
  const dest = path.join(args.dir, `${args.name}-contact-sheet.png`);
  try {
    await fs.writeFile(dest, sheet);
    return dest;
  } catch (cause) {
    args.logger.warn('could not write contact sheet', { path: dest, error: String(cause) });
    return undefined;
  }
}

/**
 * The attribution line for a finished job.
 *
 * Built from the assets that were actually composited, deduplicated across
 * variants — publishing the output without this line breaks the licence that
 * made the photographs usable in the first place.
 */
export async function creditFor(assets: readonly ReferenceAsset[]): Promise<string> {
  const unique = new Map<string, ReferenceAsset>();
  for (const a of assets) {
    // Placeholders are ours and depict nobody; they contribute no credit.
    if (a.tags?.includes('placeholder')) continue;
    unique.set(a.id, a);
  }
  if (unique.size === 0) return '';
  return creditLine([...unique.values()]);
}
