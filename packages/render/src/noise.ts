/**
 * Value noise and fBm, built entirely from the seeded RNG in @hexa/core.
 *
 * Fog, smoke, dust and the `noise` layer source all need coherent randomness —
 * neighbouring pixels must be related or the result is television static rather
 * than atmosphere. Value noise (random values on a lattice, smoothly
 * interpolated) is cheap, tiles cleanly, and — crucially — is reproducible from
 * `plan.seed`, which white noise from `Math.random()` would not be.
 */

import { createRng, type Rng } from '@hexa/core';

export interface NoiseField {
  /** Single-octave value noise at lattice coordinates; returns 0–1. */
  noise2(x: number, y: number): number;
  /** Fractal Brownian motion: `octaves` summed at doubling frequency. */
  fbm(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
  /** fBm whose input coordinates are themselves displaced by fBm — the curling,
   *  wispy look real smoke has and plain fBm does not. */
  warped(x: number, y: number, octaves?: number, warp?: number): number;
}

/** Quintic smoothstep — C² continuous, so no lattice creases show up. */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function createNoise(seed: number, gridSize = 256): NoiseField {
  const rng: Rng = createRng(seed >>> 0);
  const g = gridSize;
  const lattice = new Float32Array(g * g);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();

  const wrap = (v: number): number => ((v % g) + g) % g;

  const noise2 = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smootherstep(x - xi);
    const ty = smootherstep(y - yi);
    const x0 = wrap(xi);
    const y0 = wrap(yi);
    const x1 = wrap(xi + 1);
    const y1 = wrap(yi + 1);
    const a = lattice[y0 * g + x0]!;
    const b = lattice[y0 * g + x1]!;
    const c = lattice[y1 * g + x0]!;
    const d = lattice[y1 * g + x1]!;
    const top = a + (b - a) * tx;
    const bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  };

  const fbm = (x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      // The per-octave offset keeps octaves from lining up their lattices,
      // which would otherwise produce visible grid-aligned ridges.
      sum += amp * noise2(x * freq + o * 37.13, y * freq + o * 71.77);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm === 0 ? 0 : sum / norm;
  };

  const warped = (x: number, y: number, octaves = 4, warp = 1.6): number => {
    const wx = fbm(x + 5.2, y + 1.3, 3);
    const wy = fbm(x - 3.7, y + 9.1, 3);
    return fbm(x + (wx - 0.5) * 2 * warp, y + (wy - 0.5) * 2 * warp, octaves);
  };

  return { noise2, fbm, warped };
}
