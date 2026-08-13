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
};

/** Register (or override) a generator id. */
export function registerGenerator(id: string, gen: Generator): void {
  generators[id] = gen;
}

export { noiseFieldRaw } from './raster.js';
