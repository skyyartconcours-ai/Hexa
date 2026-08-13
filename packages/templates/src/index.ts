/**
 * @hexa/templates — the design library.
 *
 * Templates are pure declarative data: a LayoutSpec (geometry), a StyleSpec
 * (light, colour, atmosphere) and a text schema. Nothing in this package
 * renders, reads a file or imports anything beyond @hexa/core; a template is a
 * value you can diff, snapshot and remix. The pipeline package is what turns
 * one of these plus a cast of subjects into a RenderPlan.
 *
 *   import { requireTemplate, resolveLayout, sampleContextFor } from '@hexa/templates';
 *
 *   const t = requireTemplate('versus-classic');
 *   const layout = resolveLayout(t, ctx);
 */

export {
  TEMPLATES,
  getTemplate,
  requireTemplate,
  listTemplates,
  templatesForSubjectCount,
  suggestTemplates,
  resolveLayout,
  resolveStyle,
  validateTemplate,
  validateLibrary,
  sampleContext,
} from './registry.js';
export type { TemplateFilter, SuggestInput } from './registry.js';

export {
  ASPECT_SIZES,
  BUILTIN_LUTS,
  Z,
  KIND_BANDS,
  WIDE_ASPECTS,
  WIDE_AND_SQUARE,
  VERTICAL_ASPECTS,
  RATIO_16_9,
  RATIO_9_16,
  aspectRatio,
  bustSlot,
  textSlot,
  fxSlot,
  gridSlots,
  facePoint,
  ytSafeZones,
  shortsSafeZones,
} from './helpers.js';
export type { BuiltinLut } from './helpers.js';
