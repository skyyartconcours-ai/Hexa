/**
 * The integration surface, published as `@hexa/pipeline/integration`.
 *
 * One namespace per sibling package. The CLI imports from here rather than from
 * the siblings directly, so the whole product has exactly one adapter per
 * dependency — when a signature drifts there is one file to fix, not two.
 */

export * as data from './data.js';
export * as assets from './assets.js';
export * as vision from './vision.js';
export * as layout from './layout.js';
export * as render from './render.js';
export * as type from './type.js';
export * as templates from './templates.js';
export * as ai from './ai.js';
export * as qa from './qa.js';

export * from './contracts.js';
export { loadModule, tryLoadModule, moduleHealth, registerModule, clearModuleRegistry } from './load.js';
export type { ModuleHealth, LoadOptions } from './load.js';
export * as normalise from './normalise.js';
