/**
 * The generator registry.
 *
 * Templates address FX by id (`{ type: 'generated', generatorId: 'rays' }`), so
 * new looks can be added by a template pack without touching the compositor.
 */

import type { Generator } from '../types.js';
import {
  particles,
  rays,
  speedlines,
  grid,
  shatter,
  arena,
  abstract,
  bokeh,
  energyBurst,
  hexgrid,
} from './vector.js';
import { fog, smoke, noise, scanlines } from './raster.js';
import { haze, contactShadow, lightWrap } from './atmosphere.js';

export const generators: Record<string, Generator> = {
  particles,
  rays,
  fog,
  smoke,
  speedlines,
  grid,
  shatter,
  arena,
  abstract,
  noise,
  bokeh,
  'energy-burst': energyBurst,
  hexgrid,
  scanlines,
  haze,
  'contact-shadow': contactShadow,
  'light-wrap': lightWrap,
};

/** Register (or override) a generator id. */
export function registerGenerator(id: string, gen: Generator): void {
  generators[id] = gen;
}

/**
 * Canonical ids for spellings that arise naturally upstream.
 *
 * Callers compose ids from user-facing vocabulary — a template's `backdrop:
 * 'shatter'` becomes `backdrop-shatter`, and camelCase `speedLines` becomes
 * `speed-lines`. Rather than force every caller to know the registry's exact
 * spelling, resolve the obvious equivalences here.
 */
const ALIASES: Record<string, string> = {
  'speed-lines': 'speedlines',
  'speedline': 'speedlines',
  'light-rays': 'rays',
  'god-rays': 'rays',
  'godrays': 'rays',
  'embers': 'particles',
  'dust': 'particles',
  'sparks': 'particles',
  'hex-grid': 'hexgrid',
  'energy': 'energy-burst',
  'burst': 'energy-burst',
  'glass': 'shatter',
  'stage': 'arena',
  'mist': 'haze',
  'shadow': 'contact-shadow',
  'lightwrap': 'light-wrap',
};

/** Backdrop styles that have no dedicated generator but a sensible stand-in. */
const BACKDROP_FALLBACKS: Record<string, string> = {
  gradient: 'abstract',
  radial: 'abstract',
  solid: 'abstract',
  ai: 'abstract',
};

/**
 * Look a generator up, tolerating the spellings callers actually produce.
 *
 * Resolution order: exact id → alias → `backdrop-*` prefix stripped (then
 * aliased and fallback-mapped) → hyphens removed. Returns undefined rather
 * than throwing so the caller can report the layer that wanted it.
 */
export function resolveGenerator(id: string): Generator | undefined {
  const direct = generators[id];
  if (direct) return direct;

  const aliased = ALIASES[id];
  if (aliased && generators[aliased]) return generators[aliased];

  if (id.startsWith('backdrop-')) {
    const style = id.slice('backdrop-'.length);
    const viaStyle = generators[style] ?? generators[ALIASES[style] ?? ''] ?? generators[BACKDROP_FALLBACKS[style] ?? ''];
    if (viaStyle) return viaStyle;
  }

  const squashed = id.replace(/-/g, '');
  return generators[squashed];
}

/** Every id the registry answers to, for error messages and `hexa doctor`. */
export function generatorIds(): string[] {
  return [...new Set([...Object.keys(generators), ...Object.keys(ALIASES)])].sort();
}

export { noiseFieldRaw } from './raster.js';
