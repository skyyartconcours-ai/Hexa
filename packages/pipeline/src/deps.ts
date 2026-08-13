/**
 * Dependency construction.
 *
 * `generateThumbnail` takes its collaborators as an argument so tests can drive
 * it with fakes and a long-lived server can share one asset library across
 * requests. `createDeps` is the convenience path that builds the real ones.
 */

import os from 'node:os';
import path from 'node:path';
import { createLogger } from '@hexa/core';
import type { LogLevel, Logger } from '@hexa/core';
import { openLibrary } from './adapters/assets.js';
import { createVisionClient } from './adapters/vision.js';
import type { CreateDepsOptions, PipelineDeps } from './types.js';

/** Asset library root, in precedence order. */
export function resolveAssetRoot(explicit?: string): string {
  return path.resolve(explicit ?? process.env['HEXA_ASSETS'] ?? './assets');
}

/** Vision sidecar endpoint. Local by default — it is a personal helper service. */
export function resolveVisionEndpoint(explicit?: string): string {
  return (
    explicit ??
    // Both spellings are in the wild: the sidecar README and @hexa/vision
    // document HEXA_VISION_ENDPOINT, .env.example and the CLI document
    // HEXA_VISION_URL. Accept either rather than making the user guess.
    process.env['HEXA_VISION_URL'] ??
    process.env['HEXA_VISION_ENDPOINT'] ??
    // 8765 is what services/vision/run.sh actually serves on.
    'http://127.0.0.1:8765'
  );
}

/**
 * Cache location for derived artefacts (cutouts, mostly).
 *
 * Deliberately *not* inside the asset library: the library is a scanned
 * directory of photographs with a manifest, and dropping generated PNGs into it
 * would put derived files in front of `ingestDirectory` and muddle the very
 * provenance records the library exists to keep.
 */
export function resolveCacheDir(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  if (process.env['HEXA_CACHE']) return path.resolve(process.env['HEXA_CACHE']);
  const xdg = process.env['XDG_CACHE_HOME'];
  const base = xdg ? path.resolve(xdg) : path.join(os.homedir() || os.tmpdir(), '.cache');
  return path.join(base, 'hexa');
}

export function resolveLogLevel(explicit?: LogLevel): LogLevel {
  return explicit ?? (process.env['HEXA_LOG'] as LogLevel | undefined) ?? 'info';
}

/**
 * Build the real dependency set.
 *
 * Opening the library reads the manifest from disk; constructing the vision
 * client does **not** contact the sidecar, so an offline machine still gets a
 * usable `PipelineDeps` and finds out about the sidecar when it first needs it.
 */
export async function createDeps(opts: CreateDepsOptions = {}): Promise<PipelineDeps> {
  const logger: Logger = createLogger(resolveLogLevel(opts.logLevel), 'hexa');
  const assetRoot = resolveAssetRoot(opts.assetRoot);
  const endpoint = resolveVisionEndpoint(opts.visionEndpoint);

  logger.debug('opening asset library', { root: assetRoot });
  const library = await openLibrary(assetRoot);
  const vision = await createVisionClient({ endpoint });

  // Teach the generative guard who it is protecting.
  //
  // @hexa/ai ships the machinery for refusing named individuals but cannot own
  // the list — it must not depend on the roster. Nothing called it, so the
  // protected set was empty at runtime and a backplate prompt naming a real
  // player reached the model unchallenged. The roster is the natural source,
  // and this is the one place every entry point already passes through.
  await registerRosterAsProtected(logger);

  return {
    library,
    vision,
    logger,
    aiProvider: opts.aiProvider ?? process.env['HEXA_AI_PROVIDER'],
    cacheDir: resolveCacheDir(opts.cacheDir),
  };
}

/**
 * Fill in whatever a caller left out of a partial dependency set.
 *
 * `generateThumbnail(req, deps?)` accepts a partial so a caller can override one
 * collaborator — a fake vision client in a test, say — without rebuilding the
 * rest.
 */
export async function completeDeps(partial?: Partial<PipelineDeps>, opts: CreateDepsOptions = {}): Promise<PipelineDeps> {
  if (partial?.library && partial?.vision && partial?.logger) return partial as PipelineDeps;

  const built = await createDeps(opts);
  return {
    library: partial?.library ?? built.library,
    vision: partial?.vision ?? built.vision,
    logger: partial?.logger ?? built.logger,
    aiProvider: partial?.aiProvider ?? built.aiProvider,
    cacheDir: partial?.cacheDir ?? built.cacheDir,
  };
}

/**
 * Register every roster handle and legal name with the generative guard.
 *
 * Deliberately best-effort: a failure here must not stop a render, but it must
 * be visible, because the failure mode is silent — the guard keeps working for
 * generic nouns while quietly permitting the specific names it exists to
 * refuse.
 */
async function registerRosterAsProtected(logger: Logger): Promise<void> {
  try {
    const [{ PLAYERS }, ai] = await Promise.all([import('@hexa/data'), import('@hexa/ai')]);
    const names = new Set<string>();
    for (const p of PLAYERS) {
      names.add(p.handle);
      // Legal names are protected as whole strings only. Registering the parts
      // would blocklist common Korean family names — "Lee", "Kim", "Park" —
      // and refuse a great many innocent prompts.
      if (p.fullName && p.fullName.includes(' ')) names.add(p.fullName);
      for (const alias of p.aliases ?? []) if (alias.length >= 3) names.add(alias);
    }
    ai.registerProtectedNames(names);
    logger.debug('registered protected names with the generative guard', { count: names.size });
  } catch (err) {
    logger.warn(
      'Could not register roster names with the generative guard — prompts naming a specific player will not be refused.',
      { error: err instanceof Error ? err.message : String(err) },
    );
  }
}
