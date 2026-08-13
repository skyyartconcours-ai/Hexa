/**
 * Contract verification against the real sibling packages.
 *
 * The adapters load siblings through a runtime specifier, which keeps this
 * package compiling while nine others are built in parallel — but it also means
 * the compiler never checks our assumptions against their actual types. This
 * file closes that gap: it imports every sibling *statically* and asserts each
 * one satisfies the contract declared in `src/adapters/contracts.ts`.
 *
 * It is deliberately outside `src/`, so it is not part of the build or the
 * shipped types. Run it on its own once the siblings are built:
 *
 *     pnpm --filter @hexa/pipeline typecheck:integration
 *
 * A failure here is not a bug in this package: it means a sibling's API drifted
 * from the declared contract. Fix the one adapter for that package (and this
 * file's expectation) rather than patching call sites.
 */

import type {
  AiModule,
  AssetsModule,
  DataModule,
  LayoutModule,
  QaModule,
  RenderModule,
  TemplatesModule,
  TypeModule,
  VisionModule,
} from '../src/adapters/contracts.js';

import * as dataModule from '@hexa/data';
import * as assetsModule from '@hexa/assets';
import * as visionModule from '@hexa/vision';
import * as layoutModule from '@hexa/layout';
import * as renderModule from '@hexa/render';
import * as typeModule from '@hexa/type';
import * as templatesModule from '@hexa/templates';
import * as aiModule from '@hexa/ai';
import * as qaModule from '@hexa/qa';

/**
 * Each assignment is the assertion. A missing export, a renamed function or an
 * incompatible signature fails to compile and names the member.
 */
const _data: DataModule = dataModule;
const _assets: AssetsModule = assetsModule;
const _vision: VisionModule = visionModule;
const _layout: LayoutModule = layoutModule;
const _render: RenderModule = renderModule;
const _type: TypeModule = typeModule;
const _templates: TemplatesModule = templatesModule;
const _ai: AiModule = aiModule;
const _qa: QaModule = qaModule;

export const CHECKED = [_data, _assets, _vision, _layout, _render, _type, _templates, _ai, _qa].length;
