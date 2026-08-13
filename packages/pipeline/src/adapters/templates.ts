/**
 * @hexa/templates adapter — the template library.
 *
 * Note the rename: @hexa/templates exports `resolveLayout(template, ctx)`
 * (template → LayoutSpec) and @hexa/layout exports `resolveLayout(layout, w, h)`
 * (LayoutSpec → pixels). Two different jobs, one name. They are imported here as
 * `resolveTemplateLayout` and in the layout adapter as `resolveLayoutPixels` so
 * a call site can never mean the wrong one.
 */

import type { AspectPreset, LayoutSpec, StyleSpec, TemplateContext, ThumbnailTemplate } from '@hexa/core';
import { HexaError, didYouMean } from '@hexa/core';
import { loadModule } from './load.js';
import { TEMPLATES_EXPORTS, type CanvasSize, type TemplateValidation, type TemplatesModule } from './contracts.js';

const SPEC = '@hexa/templates';
const HINT = 'The template library package is not built. Run: pnpm --filter @hexa/templates build';

async function mod(): Promise<TemplatesModule> {
  return loadModule<TemplatesModule>(SPEC, { needs: TEMPLATES_EXPORTS, hint: HINT });
}

/**
 * Canvas dimensions per aspect.
 *
 * These are fixed by the platforms, and they are documented on `AspectPreset` in
 * @hexa/core, so the table is duplicated here as a *fallback only*: the sibling's
 * ASPECT_SIZES always wins when present. Without the fallback a template package
 * that is merely late to build would take down `hexa preview` and the CLI's
 * dimension reporting, which is a worse outcome than using the number that is
 * written down in the type definition.
 */
export const FALLBACK_ASPECT_SIZES: Readonly<Record<AspectPreset, CanvasSize>> = {
  youtube: { width: 1280, height: 720 },
  'youtube-hd': { width: 1920, height: 1080 },
  shorts: { width: 1080, height: 1920 },
  twitch: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
  twitter: { width: 1600, height: 900 },
  banner: { width: 2560, height: 1440 },
};

/** @throws HexaError `TEMPLATE_NOT_FOUND` with near-miss suggestions. */
export async function requireTemplate(id: string): Promise<ThumbnailTemplate> {
  const m = await mod();
  const found = m.getTemplate(id);
  if (found) return found;

  const ids = m.TEMPLATES.map((t) => t.id);
  const suggestions = didYouMean(id, ids);
  throw new HexaError('TEMPLATE_NOT_FOUND', `No template with id "${id}"`, {
    hint: suggestions.length
      ? `Did you mean: ${suggestions.join(', ')}? Run \`hexa templates\` for the full list.`
      : 'Run `hexa templates` to list the library.',
    details: { id, suggestions },
  });
}

export async function getTemplate(id: string): Promise<ThumbnailTemplate | undefined> {
  return (await mod()).getTemplate(id);
}

export async function listTemplates(filter?: { category?: string; aspect?: AspectPreset; tag?: string }): Promise<ThumbnailTemplate[]> {
  const m = await mod();
  return m.listTemplates(filter) ?? [...m.TEMPLATES];
}

export async function templatesForSubjectCount(count: number): Promise<ThumbnailTemplate[]> {
  return (await mod()).templatesForSubjectCount(count);
}

export async function suggestTemplates(input: { subjects?: number; category?: string; text?: string; aspect?: AspectPreset }): Promise<ThumbnailTemplate[]> {
  try {
    return (await mod()).suggestTemplates(input) ?? [];
  } catch {
    return [];
  }
}

/**
 * Template → LayoutSpec for this context.
 *
 * Falls back to evaluating `template.layout` directly, which the core type
 * already defines as `LayoutSpec | ((ctx) => LayoutSpec)`. That is not a stub of
 * the sibling: it is the contract in @hexa/core, and honouring it here means an
 * adaptive template still resolves if the library's helper changes shape.
 */
export async function resolveTemplateLayout(template: ThumbnailTemplate, ctx: TemplateContext): Promise<LayoutSpec> {
  const m = await mod();
  const layout = m.resolveLayout(template, ctx) ?? evaluate(template.layout, ctx);
  if (!layout?.slots) {
    throw new HexaError('TEMPLATE_NOT_FOUND', `Template "${template.id}" resolved to an empty layout`, {
      hint: 'Run `hexa templates --json` and check the template definition, or pick another template.',
      details: { template: template.id },
    });
  }
  return layout;
}

export async function resolveTemplateStyle(template: ThumbnailTemplate, ctx: TemplateContext): Promise<StyleSpec> {
  const m = await mod();
  return m.resolveStyle(template, ctx) ?? evaluate(template.style, ctx);
}

function evaluate<T>(v: T | ((ctx: TemplateContext) => T), ctx: TemplateContext): T {
  return typeof v === 'function' ? (v as (c: TemplateContext) => T)(ctx) : v;
}

/** Canvas size for an aspect, preferring the library's table over the fallback. */
export async function canvasFor(aspect: AspectPreset): Promise<CanvasSize> {
  try {
    const m = await mod();
    const size = m.ASPECT_SIZES?.[aspect];
    if (size && size.width > 0 && size.height > 0) return size;
  } catch {
    // fall through — the fallback table is correct by construction
  }
  return FALLBACK_ASPECT_SIZES[aspect] ?? FALLBACK_ASPECT_SIZES.youtube;
}

export async function validateTemplate(template: ThumbnailTemplate): Promise<TemplateValidation> {
  try {
    return (await mod()).validateTemplate(template);
  } catch (e) {
    return { valid: false, errors: [e instanceof Error ? e.message : String(e)], warnings: [] };
  }
}

export type { CanvasSize, TemplateValidation };
