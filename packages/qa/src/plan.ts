/**
 * Reading intent out of a RenderPlan.
 *
 * `RenderPlan.meta` is an open bag by design, so this module is the one place
 * that knows the conventions the renderer writes into it. Everything here
 * degrades gracefully: a plan that declares nothing still gets checked, the
 * gates just say their measurements were estimated from pixels rather than read
 * from intent, and the report says so too.
 *
 * Conventions honoured:
 *   meta.textStyles  : Record<role, { color?, stroke?, plate? }>
 *   meta.textColors  : Record<role, string>            (shorthand for the above)
 *   meta.textRects   : { role, rect, color?, text? }[] (what the compiler laid
 *                                                       out — authoritative)
 *   meta.safeZones   : SafeZone[]                      (see geom.ts)
 *   meta.palette     : { left?, right?, accent? }
 *   meta.placeholders: string[]                        (subjects rendered from a
 *                                                       synthetic stand-in)
 *   meta.siblingHashes : string[]                      (dHashes of the other
 *                                                       variants in the batch)
 */

import type { Layer, PixelRect, RenderPlan } from '@hexa/core';
import { overlapRatio } from '@hexa/core';
import { textRoleOfLayer } from './geom.js';

function metaRecord(plan: RenderPlan, key: string): Record<string, unknown> | null {
  const v = (plan.meta as Record<string, unknown>)[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export interface TextStyleHint {
  /** Declared text colour, if the plan recorded one. */
  color?: string;
  hasStroke: boolean;
  hasPlate: boolean;
  /** Where the colour came from — reported so nobody mistakes an estimate for
   *  a declaration. */
  source: 'meta' | 'layer' | 'none';
}

const HEX = /#[0-9a-f]{3,8}\b/i;

export function resolveTextStyle(plan: RenderPlan, role: string, rect: PixelRect): TextStyleHint {
  const hint: TextStyleHint = { hasStroke: false, hasPlate: false, source: 'none' };

  const styles = metaRecord(plan, 'textStyles');
  const entry = styles?.[role];
  if (entry && typeof entry === 'object') {
    const e = entry as { color?: unknown; stroke?: unknown; plate?: unknown };
    if (typeof e.color === 'string') { hint.color = e.color; hint.source = 'meta'; }
    if (e.stroke) hint.hasStroke = true;
    if (e.plate) hint.hasPlate = true;
  }

  if (!hint.color) {
    const colors = metaRecord(plan, 'textColors');
    const c = colors?.[role];
    if (typeof c === 'string') { hint.color = c; hint.source = 'meta'; }
  }

  // The compiler's own record of what it laid out. Consulted *before* sniffing
  // the layer markup: a text layer's SVG also contains its plate, its badge and
  // its shadow, and the first hex in it is very often one of those rather than
  // the type — which is how "left-team" used to report the yellow badge as its
  // text colour and measure the contrast of the plate against itself.
  if (!hint.color) {
    for (const rec of textRectRecords(plan)) {
      if (rec.role === role && typeof rec.color === 'string') { hint.color = rec.color; hint.source = 'meta'; break; }
    }
  }

  const layer = plan.layers.find((l) => textRoleOfLayer(l.id, l.label) === role);
  if (layer) {
    if (layer.effects?.stroke && layer.effects.stroke.width > 0) hint.hasStroke = true;
    if (!hint.color && layer.source.type === 'svg') {
      const m = HEX.exec(layer.source.markup.replace(/fill\s*=\s*"none"/gi, ''));
      if (m) { hint.color = m[0]; hint.source = 'layer'; }
    }
    if (!hint.hasPlate && hasPlateBehind(plan, layer, rect)) hint.hasPlate = true;
  }

  return hint;
}

/** A plate is any opaque-ish flat layer painted below the text that covers most
 *  of it — the scrim/lozenge that makes type safe over busy art. */
function hasPlateBehind(plan: RenderPlan, textLayer: Layer, rect: PixelRect): boolean {
  const norm = (r: PixelRect) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
  return plan.layers.some((l) => {
    if (l.id === textLayer.id || l.z >= textLayer.z) return false;
    const flat = l.source.type === 'solid' || l.source.type === 'gradient' || l.source.type === 'radial';
    if (!flat || l.opacity < 0.45) return false;
    return overlapRatio(norm(rect), norm(l.rect)) >= 0.7;
  });
}

interface TextRectRecord {
  role: string;
  color?: string;
  text?: string;
}

/** `meta.textRects` as the compiler writes it, defensively narrowed. */
export function textRectRecords(plan: RenderPlan): TextRectRecord[] {
  const raw = (plan.meta as Record<string, unknown>)['textRects'];
  if (!Array.isArray(raw)) return [];
  const out: TextRectRecord[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { role?: unknown; color?: unknown; text?: unknown };
    if (typeof e.role !== 'string') continue;
    out.push({
      role: e.role,
      ...(typeof e.color === 'string' ? { color: e.color } : {}),
      ...(typeof e.text === 'string' ? { text: e.text } : {}),
    });
  }
  return out;
}

/** The copy the compiler says it set for a role, when it recorded any. */
export function declaredText(plan: RenderPlan, role: string): string | undefined {
  return textRectRecords(plan).find((r) => r.role === role)?.text;
}

/**
 * Subjects the renderer filled with a synthetic stand-in rather than a
 * photograph. Both spellings the pipeline uses are accepted: `meta.placeholders`
 * (player ids) and the `placeholder:<id>` entries in `meta.assets`.
 */
export function placeholderSubjects(plan: RenderPlan): Set<string> {
  const out = new Set<string>();
  const meta = plan.meta as Record<string, unknown>;
  const ids = meta['placeholders'];
  if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') out.add(id);
  const assets = meta['assets'];
  if (Array.isArray(assets)) {
    for (const a of assets) {
      if (typeof a === 'string' && a.startsWith('placeholder:')) out.add(a.slice('placeholder:'.length));
    }
  }
  return out;
}

export interface PlanPalette {
  left?: string;
  right?: string;
  accent?: string;
}

export function resolvePalette(plan: RenderPlan): PlanPalette {
  const p = metaRecord(plan, 'palette');
  if (!p) return {};
  const pick = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
  return { left: pick('left'), right: pick('right'), accent: pick('accent') };
}

/** dHashes of the other variants rendered in the same batch. */
export function siblingHashes(plan: RenderPlan): string[] {
  const v = (plan.meta as Record<string, unknown>)['siblingHashes'];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
