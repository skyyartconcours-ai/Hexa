/**
 * Resilient cross-package module loading.
 *
 * The pipeline sits downstream of nine sibling packages. Two things follow from
 * that: their signatures will drift, and at any given moment one of them may not
 * be built yet. Both problems are handled here rather than smeared across the
 * stage code.
 *
 * WHY DYNAMIC IMPORT AND NOT A STATIC ONE
 * A static `import { renderPlan } from '@hexa/render'` couples this package to a
 * sibling at *compile* time: if the sibling is mid-build the whole pipeline
 * stops typechecking, and if it renames an export the error lands in whichever
 * stage file happened to call it. Loading through a runtime specifier instead
 * means:
 *   - this package compiles and its pure logic stays testable on its own;
 *   - the expected shape of every sibling is declared in one file
 *     (`contracts.ts`) rather than inferred from scattered call sites;
 *   - a missing package produces a *diagnosable* error with a fix instruction
 *     (`hexa doctor` leans on this) instead of a bare MODULE_NOT_FOUND;
 *   - drift is fixed in exactly one adapter function.
 *
 * The trade is that the sibling's real types are not checked against ours at
 * build time. `tsconfig.integration.json` closes that gap: it compiles
 * `integration-check.ts`, which statically imports every sibling and asserts it
 * satisfies the declared contract. Run it once the siblings land.
 */

import { HexaError } from '@hexa/core';

/** Injected modules win over real resolution — the test seam. */
const overrides = new Map<string, unknown>();
/** Successful loads are cached; a module is only imported once per process. */
const cache = new Map<string, unknown>();
/** Failures are cached too, so a missing sibling costs one failed import. */
const failures = new Map<string, Error>();

export interface LoadOptions<T> {
  /** Exports that must exist for the adapter to work at all. */
  needs: readonly (keyof T & string)[];
  /** What the operator should do when the module cannot be loaded. */
  hint: string;
}

/**
 * Swap in a module implementation. Used by tests to drive the pipeline without
 * the real siblings, and available as an embedding escape hatch.
 */
export function registerModule(spec: string, mod: unknown): void {
  overrides.set(spec, mod);
  cache.delete(spec);
  failures.delete(spec);
}

export function clearModuleRegistry(): void {
  overrides.clear();
  cache.clear();
  failures.clear();
}

/**
 * `import()` behind a non-literal specifier.
 *
 * The indirection is load-bearing: with a string literal TypeScript resolves the
 * specifier at compile time and errors when the sibling has no build output yet,
 * which is the exact failure mode this module exists to absorb.
 */
async function importSpec(spec: string): Promise<unknown> {
  const specifier: string = spec;
  return (await import(specifier)) as unknown;
}

/**
 * Some packages export their surface as a default object (a bundler artefact, or
 * an author's preference). Treat `{ default: {...} }` as the namespace when the
 * named export is absent.
 */
function unwrap(mod: unknown, needs: readonly string[]): Record<string, unknown> {
  const ns = (mod ?? {}) as Record<string, unknown>;
  if (needs.length === 0) return ns;
  const missingFromNs = needs.filter((n) => ns[n] === undefined);
  if (missingFromNs.length === 0) return ns;
  const dflt = ns['default'];
  if (dflt && typeof dflt === 'object') {
    const d = dflt as Record<string, unknown>;
    const missingFromDefault = needs.filter((n) => d[n] === undefined);
    if (missingFromDefault.length < missingFromNs.length) return { ...d, ...stripUndefined(ns) };
  }
  return ns;
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Load a sibling package, proving it carries the exports we depend on.
 *
 * @throws HexaError `IO_ERROR` when the package is absent or incomplete. The
 * message names the package and the missing exports, and `hint` says how to fix
 * it — a missing sibling is nearly always "it has not been built yet".
 */
export async function loadModule<T extends object>(spec: string, opts: LoadOptions<T>): Promise<T> {
  const override = overrides.get(spec);
  if (override !== undefined) return override as T;

  const cached = cache.get(spec);
  if (cached !== undefined) return cached as T;

  const priorFailure = failures.get(spec);
  if (priorFailure) throw priorFailure;

  let ns: Record<string, unknown>;
  try {
    ns = unwrap(await importSpec(spec), opts.needs);
  } catch (cause) {
    const err = new HexaError('IO_ERROR', `Cannot load ${spec}`, {
      hint: `${opts.hint} (then re-run). If the package exists but has no dist/, run: pnpm --filter ${spec} build`,
      details: { module: spec, reason: cause instanceof Error ? cause.message : String(cause) },
      cause,
    });
    failures.set(spec, err);
    throw err;
  }

  const missing = opts.needs.filter((n) => ns[n] === undefined);
  if (missing.length > 0) {
    const err = new HexaError('IO_ERROR', `${spec} is missing required export(s): ${missing.join(', ')}`, {
      hint:
        `The declared API of ${spec} has drifted from what @hexa/pipeline integrates against. ` +
        `Fix the single adapter for this package in packages/pipeline/src/adapters/, or restore the export.`,
      details: { module: spec, missing: [...missing], found: Object.keys(ns).sort() },
    });
    failures.set(spec, err);
    throw err;
  }

  cache.set(spec, ns);
  return ns as T;
}

/** Load, or `null` when unavailable. For genuinely optional integrations (AI). */
export async function tryLoadModule<T extends object>(spec: string, opts: LoadOptions<T>): Promise<T | null> {
  try {
    return await loadModule<T>(spec, opts);
  } catch {
    return null;
  }
}

export interface ModuleHealth {
  module: string;
  ok: boolean;
  /** Exports declared in the contract but absent from the built package. */
  missing: string[];
  error?: string;
}

/**
 * Non-throwing probe used by `hexa doctor` to report integration state across
 * every sibling at once.
 */
export async function moduleHealth(spec: string, needs: readonly string[]): Promise<ModuleHealth> {
  const override = overrides.get(spec);
  try {
    const ns = override !== undefined
      ? unwrap(override, needs)
      : unwrap(await importSpec(spec), needs);
    const missing = needs.filter((n) => ns[n] === undefined);
    return { module: spec, ok: missing.length === 0, missing };
  } catch (cause) {
    return {
      module: spec,
      ok: false,
      missing: [...needs],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Call an optional export, returning `undefined` when the sibling does not
 * provide it. Used for genuinely nice-to-have calls (extra metrics, proof
 * sheets) that must never take a render down.
 */
export function optionalCall<R>(fn: unknown, args: unknown[]): R | undefined {
  if (typeof fn !== 'function') return undefined;
  return (fn as (...a: unknown[]) => R)(...args);
}
