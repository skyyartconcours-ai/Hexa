/**
 * Stage 1 — resolve.
 *
 * Turns a validated request into the concrete things a render needs: a template
 * object, an aspect the template actually supports, and a canvas size. Nothing
 * here touches pixels; it is the last chance to fail fast with an error that
 * names a fix.
 */

import { HexaError } from '@hexa/core';
import type { AspectPreset, ThumbnailTemplate } from '@hexa/core';
import { canvasFor, requireTemplate, templatesForSubjectCount } from '../adapters/templates.js';
import type { CanvasSize } from '../adapters/contracts.js';
import type { NormalisedRequest } from '../validate.js';

export interface ResolvedRequest {
  request: NormalisedRequest;
  template: ThumbnailTemplate;
  aspect: AspectPreset;
  canvas: CanvasSize;
  warnings: string[];
}

export async function resolveRequest(request: NormalisedRequest): Promise<ResolvedRequest> {
  const warnings: string[] = [];
  const template = await requireTemplate(request.templateId);

  assertSubjectCount(template, request.subjects.length);

  const aspect = await chooseAspect(template, request.aspect, warnings);
  const canvas = await canvasFor(aspect);

  return { request, template, aspect, canvas, warnings };
}

/**
 * A versus template given three players cannot lay them out, and guessing would
 * produce a composition its author never designed. Fail, and say which templates
 * *do* take this many subjects.
 */
function assertSubjectCount(template: ThumbnailTemplate, count: number): void {
  const { min, max } = template.subjects;
  if (count >= min && count <= max) return;

  const expected = min === max ? `exactly ${min}` : `${min}–${max}`;
  throw new HexaError('INVALID_REQUEST', `Template "${template.id}" takes ${expected} subject(s), got ${count}`, {
    hint: `Run \`hexa templates\` and pick one sized for ${count} subject(s), or adjust the players you passed.`,
    details: { template: template.id, expected, got: count },
  });
}

/**
 * Templates declare the aspects they were designed for. Rendering a 16:9 layout
 * into a 9:16 canvas is technically possible — @hexa/layout will adapt it — but
 * the result is a design nobody approved, so it warns loudly rather than
 * silently shipping a stretched composition.
 */
async function chooseAspect(template: ThumbnailTemplate, requested: AspectPreset, warnings: string[]): Promise<AspectPreset> {
  const supported = template.aspects ?? [];
  if (supported.length === 0 || supported.includes(requested)) return requested;

  const requestedSize = await canvasFor(requested);
  const requestedRatio = requestedSize.width / requestedSize.height;

  let best = supported[0]!;
  let bestDelta = Infinity;
  for (const candidate of supported) {
    const size = await canvasFor(candidate);
    const delta = Math.abs(size.width / size.height - requestedRatio);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }

  warnings.push(
    `Template "${template.id}" does not support the ${requested} aspect; rendered as ${best} instead. ` +
      `Supported: ${supported.join(', ')}.`,
  );
  return best;
}

/** Templates that fit a subject count — used to build the "try these" hint. */
export async function suggestionsFor(count: number): Promise<string[]> {
  try {
    return (await templatesForSubjectCount(count)).map((t) => t.id);
  } catch {
    return [];
  }
}
