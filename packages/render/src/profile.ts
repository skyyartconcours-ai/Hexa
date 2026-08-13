/**
 * Opt-in render profiler.
 *
 * `RenderResult.timings` answers "which stage was slow"; this answers "which
 * *primitive* was slow, and how many times did we call it". Those are different
 * questions — a compositor can spend 80% of its wall clock inside a call that
 * appears nowhere in the stage list because it is buried three levels down in a
 * generator.
 *
 * Design constraints:
 *   * **Zero cost when off.** Every hook is a single null check against a
 *     module-level slot. Nothing is allocated, nothing is timed.
 *   * **No behaviour change when on.** The profiler only observes: it never
 *     re-orders work and never touches a pixel, so a profiled render is
 *     byte-identical to an unprofiled one.
 *   * **Wall-clock, not CPU.** With concurrent layer preparation the summed
 *     durations can exceed the elapsed time; that overlap is the point, so the
 *     report prints both.
 *
 * Enable with `startProfile()` (or `HEXA_PROFILE=1` for a process-wide run) and
 * collect with `endProfile()`.
 */

export interface ProfileEntry {
  /** How many times the primitive was invoked. */
  calls: number;
  /** Summed wall-clock milliseconds inside it. */
  ms: number;
  /** Megapixels processed, where the call site knows them. */
  mpx: number;
}

export type Profile = Record<string, ProfileEntry>;

let active: Map<string, ProfileEntry> | null = null;

/** Begin (or restart) accumulating. Safe to call repeatedly. */
export function startProfile(): void {
  active = new Map();
}

/** Stop accumulating and return what was seen. */
export function endProfile(): Profile {
  const out: Profile = {};
  if (active) for (const [k, v] of active) out[k] = v;
  active = null;
  return out;
}

/** Snapshot without stopping — used to report per-variant deltas. */
export function snapshotProfile(): Profile {
  const out: Profile = {};
  if (active) for (const [k, v] of active) out[k] = { ...v };
  return out;
}

export function profiling(): boolean {
  return active !== null;
}

function entry(name: string): ProfileEntry {
  let e = active!.get(name);
  if (!e) {
    e = { calls: 0, ms: 0, mpx: 0 };
    active!.set(name, e);
  }
  return e;
}

/** Record a completed operation by hand. */
export function record(name: string, ms: number, pixels = 0): void {
  if (!active) return;
  const e = entry(name);
  e.calls++;
  e.ms += ms;
  e.mpx += pixels / 1e6;
}

/** Time an async primitive. Returns the callee's value untouched. */
export async function timed<T>(name: string, pixels: number, fn: () => Promise<T>): Promise<T> {
  if (!active) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    record(name, performance.now() - t0, pixels);
  }
}

/** Time a synchronous primitive. */
export function timedSync<T>(name: string, pixels: number, fn: () => T): T {
  if (!active) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    record(name, performance.now() - t0, pixels);
  }
}

if (process.env['HEXA_PROFILE'] === '1') startProfile();
