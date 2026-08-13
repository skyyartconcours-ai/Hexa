/**
 * Deterministic randomness.
 *
 * Every stochastic decision in the pipeline — particle placement, variant
 * jitter, crop nudges — draws from a seeded stream. Same seed ⇒ same
 * thumbnail, which makes renders reproducible, diffable and safe to cache.
 */

/** mulberry32: small, fast, good enough distribution for visual work. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    bool: (p = 0.5) => next() < p,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() from empty array');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle: <T,>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    /** Box–Muller normal deviate; natural-looking jitter. */
    gaussian: (mean = 0, stdev = 1) => {
      const u = 1 - next();
      const v = next();
      return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    fork: (salt: number) => createRng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0),
  };
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  bool(p?: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  gaussian(mean?: number, stdev?: number): number;
  /** Derive an independent stream — keeps subsystems from perturbing each other. */
  fork(salt: number): Rng;
}

/** Stable 32-bit hash of a string, for turning names into seeds. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
