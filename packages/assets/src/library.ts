/**
 * The reference library.
 *
 * A directory of licensed photographs plus `manifest.json`, an index of what is
 * in it and where each file came from. This class is the only sanctioned way to
 * read or mutate that pair, which is what lets three guarantees hold:
 *
 *   1. Nothing enters the library without provenance. `add` requires it.
 *   2. Nothing leaves the library that escapes its root. Every path goes
 *      through {@link resolvePath} / `resolveInRoot`.
 *   3. The manifest is never half-written. Saves are write-temp-then-rename, so
 *      a crash (or a full disk, or a killed CI job) leaves the previous good
 *      manifest intact rather than a truncated JSON file that loses the record
 *      of a hundred licensed photos.
 *
 * Enrichment is explicitly a second pass: ingest writes what pixels can tell
 * you, a vision package later calls {@link update} with faceBox/landmarks/yaw/
 * embedding, and quality is recomputed from the merged metrics.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AssetKind,
  AssetManifest,
  AssetMetrics,
  AssetProvenance,
  AssetQuery,
  Logger,
  PlayerId,
  ReferenceAsset,
} from '@hexa/core';
import { HexaError, didYouMean, log as defaultLog } from '@hexa/core';
import { computeBasicMetrics, computeDHash, contentHash } from './ingest.js';
import {
  MANIFEST_FILENAME,
  extensionOf,
  isInside,
  libraryRelativePath,
  manifestPath,
  normaliseRoot,
  resolveInRoot,
  slugify,
  toRelative,
} from './paths.js';
import { isPublishable } from './provenance.js';
import { computeQuality, rankAssets } from './scoring.js';

export { MANIFEST_FILENAME };

/** Schema version written into the manifest. Bump on breaking layout changes. */
export const MANIFEST_VERSION = 1;

/** Coverage: a player below this best-quality is flagged as thin. */
export const COVERAGE_MIN_QUALITY = 55;

/** Coverage: the kinds a player needs before every template can render them. */
export const COVERAGE_REQUIRED_KINDS: readonly AssetKind[] = ['portrait', 'action'] as const;

export interface AddAssetInput {
  /** Source file. Absolute, or relative to the current working directory. */
  path: string;
  playerId?: PlayerId;
  teamId?: string;
  kind: AssetKind;
  provenance: AssetProvenance;
  tags?: string[];
  /**
   * Copy the file into the library. Defaults to true when the source lies
   * outside the root (a manifest may only reference paths it contains) and
   * false when it is already inside.
   */
  copy?: boolean;
}

/** Fast path for callers that already decoded the file (see `ingestDirectory`). */
export interface AddAssetOptions {
  metrics?: Omit<AssetMetrics, 'quality'>;
  phash?: string;
}

export interface LibraryStats {
  total: number;
  byPlayer: Record<string, number>;
  byKind: Record<string, number>;
  /** Publish-grade: cleared by a human *and* carrying a known licence. */
  cleared: number;
  uncleared: number;
}

export interface CoverageReport {
  playerId: string;
  count: number;
  cleared: number;
  bestQuality: number;
  /** Machine-readable gap slugs — see `COVERAGE_*` constants. */
  gaps: string[];
}

export class AssetLibrary {
  readonly #root: string;
  readonly #log: Logger;
  #assets = new Map<string, ReferenceAsset>();
  #loaded = false;
  #dirty = false;
  #batchDepth = 0;
  #tmpCounter = 0;
  /** Did the last {@link load} find a usable manifest on disk? */
  #manifestExisted = false;

  constructor(root: string, opts: { logger?: Logger } = {}) {
    this.#root = normaliseRoot(root);
    this.#log = opts.logger ?? defaultLog.child('assets');
  }

  /**
   * Open a library at `root`, loading `manifest.json` and creating it (along
   * with the directory) when absent — so a first run works without a setup step.
   */
  static async open(root: string, opts: { logger?: Logger } = {}): Promise<AssetLibrary> {
    const lib = new AssetLibrary(root, opts);
    await lib.load();
    if (!lib.#manifestExisted) await lib.save();
    return lib;
  }

  /** Absolute library root. */
  get root(): string {
    return this.#root;
  }

  /** True once {@link load} has run. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /**
   * Read the manifest into memory.
   *
   * Failure is never fatal: a missing manifest means a new library, and a
   * corrupt one is moved aside (never deleted) with a warning so the operator
   * can recover it by hand. Individual malformed entries are dropped rather
   * than poisoning the whole load.
   */
  async load(): Promise<void> {
    this.#assets = new Map();
    this.#loaded = true;
    this.#dirty = false;
    this.#manifestExisted = false;

    const file = manifestPath(this.#root);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        this.#log.debug(`No manifest at ${file} — starting a new library`);
        return;
      }
      throw new HexaError('IO_ERROR', `Cannot read asset manifest: ${file}`, {
        hint: 'Check the path and permissions of the asset library root.',
        details: { root: this.#root },
        cause: err,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      await this.#quarantineManifest(file, `unparseable JSON (${(err as Error).message})`);
      return;
    }

    const manifest = parsed as Partial<AssetManifest> | null;
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.assets)) {
      await this.#quarantineManifest(file, 'missing an `assets` array');
      return;
    }
    if (typeof manifest.version === 'number' && manifest.version > MANIFEST_VERSION) {
      this.#log.warn(
        `Manifest version ${manifest.version} is newer than this build understands (${MANIFEST_VERSION}); unknown fields are preserved verbatim.`,
      );
    }

    let dropped = 0;
    for (const entry of manifest.assets) {
      const asset = this.#sanitise(entry);
      if (!asset) {
        dropped++;
        continue;
      }
      this.#assets.set(asset.id, asset);
    }
    if (dropped > 0) this.#log.warn(`Dropped ${dropped} malformed manifest entr${dropped === 1 ? 'y' : 'ies'}`);
    this.#log.debug(`Loaded ${this.#assets.size} assets from ${file}`);
    this.#manifestExisted = true;
  }

  /**
   * Persist the manifest atomically: write a sibling temp file, flush it to
   * disk, then `rename()` over the target. rename(2) is atomic within a
   * filesystem, so a reader either sees the whole old manifest or the whole new
   * one — never a half-written file.
   */
  async save(): Promise<void> {
    const target = manifestPath(this.#root);
    const tmp = path.join(this.#root, `.${MANIFEST_FILENAME}.${process.pid}.${++this.#tmpCounter}.tmp`);

    const manifest: AssetManifest = {
      version: MANIFEST_VERSION,
      updatedAt: new Date().toISOString(),
      root: this.#root,
      // Sorted so a manifest diff shows real changes, not map ordering.
      assets: [...this.#assets.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    };

    try {
      await fs.mkdir(this.#root, { recursive: true });
      const handle = await fs.open(tmp, 'w');
      try {
        await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await handle.sync(); // durable before the rename, else a crash can swap in an empty file
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, target);
      this.#dirty = false;
      this.#log.debug(`Wrote manifest (${manifest.assets.length} assets) → ${target}`);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw new HexaError('IO_ERROR', `Failed to write asset manifest: ${target}`, {
        hint: 'Check free space and write permissions on the asset library root.',
        details: { root: this.#root },
        cause: err,
      });
    }
  }

  /**
   * Run `fn` with manifest writes deferred, then save once at the end. Bulk
   * ingestion of 500 photos should cost one manifest write, not 500.
   */
  async batch<T>(fn: () => Promise<T>): Promise<T> {
    this.#batchDepth++;
    let out: T;
    try {
      out = await fn();
    } finally {
      this.#batchDepth--;
    }
    if (this.#batchDepth === 0 && this.#dirty) await this.save();
    return out;
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Every asset, in stable id order. The returned array is a copy; the assets
   * themselves are the live records — treat them as read-only and go through
   * {@link update} to change one.
   */
  all(): ReferenceAsset[] {
    return [...this.#assets.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  }

  get(id: string): ReferenceAsset | undefined {
    return this.#assets.get(id);
  }

  /**
   * Filter, then rank best-first.
   *
   * Hard filters: playerId, teamId, kind, minQuality, requireCleared. `facing`
   * is deliberately *not* one of them — a subject looking the wrong way can be
   * mirrored by the compositor, so it stays in the running and simply loses
   * points. Hard-filtering it would let a layout fail with "no asset" while a
   * perfectly usable photograph sat in the library.
   */
  find(query: AssetQuery = {}): ReferenceAsset[] {
    const kinds = query.kind === undefined ? undefined : new Set(Array.isArray(query.kind) ? query.kind : [query.kind]);
    const now = Date.now();

    const matches = [...this.#assets.values()].filter((a) => {
      if (query.playerId !== undefined && a.playerId !== query.playerId) return false;
      if (query.teamId !== undefined && a.teamId !== query.teamId) return false;
      if (kinds && !kinds.has(a.kind)) return false;
      if (query.requireCleared === true && !isPublishable(a)) return false;
      if (query.minQuality !== undefined && this.#baseQuality(a) < query.minQuality) return false;
      return true;
    });

    return rankAssets(matches, query, now);
  }

  /** Highest-scoring asset for a query, or undefined when nothing qualifies. */
  best(query: AssetQuery = {}): ReferenceAsset | undefined {
    return this.find(query)[0];
  }

  /**
   * Absolute path to an asset's file. Rejects anything that escapes the root —
   * a hand-edited manifest must not be able to point the renderer at
   * `../../../etc/passwd`.
   *
   * A bare library-relative string is accepted too, for callers holding a path
   * (`asset.cutoutPath`) rather than the whole record; containment is enforced
   * identically either way.
   *
   * @throws HexaError `IO_ERROR` on traversal, `ASSET_NOT_FOUND` when a cutout
   * was requested but none has been generated.
   */
  resolvePath(asset: ReferenceAsset | string, which: 'source' | 'cutout' = 'source'): string {
    if (!asset) {
      throw new HexaError('ASSET_NOT_FOUND', 'resolvePath called without an asset');
    }
    if (typeof asset === 'string') return resolveInRoot(this.#root, asset, 'path');
    if (which === 'cutout') {
      if (!asset.cutoutPath) {
        throw new HexaError('ASSET_NOT_FOUND', `Asset ${asset.id} has no cutout yet`, {
          hint: 'Run the cutout pass (hexa assets cutout) or composite the source with its own alpha.',
          details: { id: asset.id },
        });
      }
      return resolveInRoot(this.#root, asset.cutoutPath, 'cutoutPath');
    }
    return resolveInRoot(this.#root, asset.path, 'path');
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Register a photograph.
   *
   * The id is derived from subject + kind + a content hash, so re-adding the
   * same file is idempotent instead of silently duplicating it, and two
   * machines ingesting the same press kit produce the same ids.
   *
   * ML-dependent metrics are left undefined here; see {@link update}.
   */
  async add(input: AddAssetInput, opts: AddAssetOptions = {}): Promise<ReferenceAsset> {
    if (!input?.path) {
      throw new HexaError('INVALID_REQUEST', 'add() needs a source `path`');
    }
    if (!input.kind) {
      throw new HexaError('INVALID_REQUEST', 'add() needs an asset `kind`', {
        hint: "One of: portrait, action, celebration, jersey, fullbody, logo, backplate.",
      });
    }
    if (!input.provenance?.source || !input.provenance?.license) {
      throw new HexaError('INVALID_REQUEST', 'add() needs provenance with a `source` and `license`', {
        hint: 'Where did this photograph come from? Unsourced images cannot reach publish-grade output.',
        details: { path: input.path },
      });
    }

    const src = path.resolve(input.path);
    const stat = await fs.stat(src).catch((err) => {
      throw new HexaError('IO_ERROR', `Source file not found: ${src}`, { details: { path: input.path }, cause: err });
    });
    if (!stat.isFile()) {
      throw new HexaError('IO_ERROR', `Not a file: ${src}`, { details: { path: input.path } });
    }

    const inside = isInside(this.#root, src);
    const shouldCopy = input.copy ?? !inside;
    if (!shouldCopy && !inside) {
      throw new HexaError('IO_ERROR', `Source lies outside the library root: ${src}`, {
        hint: 'Pass `copy: true` to bring the file into the library, or move it inside the root first.',
        details: { root: this.#root, path: src },
      });
    }

    const digest = await contentHash(src, 10);
    const id = this.#mintId(input, digest);

    // Same file, same subject, same kind ⇒ same id. Refresh the record instead
    // of creating a near-identical twin.
    const existing = this.#assets.get(id);

    const relPath = shouldCopy
      ? await this.#copyIn(src, { id, kind: input.kind, playerId: input.playerId, teamId: input.teamId })
      : toRelative(this.#root, src);

    const abs = resolveInRoot(this.#root, relPath, 'path');
    const metrics = opts.metrics ?? (await computeBasicMetrics(abs));
    const phash = opts.phash ?? (await computeDHash(abs));

    const asset: ReferenceAsset = {
      id,
      ...(input.playerId ? { playerId: input.playerId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      kind: input.kind,
      path: relPath,
      ...(existing?.cutoutPath ? { cutoutPath: existing.cutoutPath } : {}),
      phash,
      // Preserve any enrichment already attached to this id — re-adding a file
      // must not throw away an embedding that cost a GPU pass to compute.
      ...(existing?.embedding ? { embedding: existing.embedding, embeddingModel: existing.embeddingModel } : {}),
      metrics: this.#withQuality({ ...(existing?.metrics ?? {}), ...metrics }, input.kind),
      provenance: {
        ...input.provenance,
        addedAt: input.provenance.addedAt ?? existing?.provenance?.addedAt ?? new Date().toISOString(),
      },
      tags: dedupeTags(input.tags ?? existing?.tags ?? []),
    };

    this.#assets.set(id, asset);
    await this.#touch();
    this.#log.debug(`${existing ? 'Updated' : 'Added'} asset ${id} (${asset.kind}, quality ${asset.metrics.quality})`);
    return asset;
  }

  /**
   * Drop an asset from the index.
   *
   * The photograph on disk is left alone on purpose: this package indexes
   * licensed material it does not own, and an accidental `remove` must never be
   * the reason a file the operator paid for is gone.
   */
  async remove(id: string): Promise<boolean> {
    if (!this.#assets.delete(id)) return false;
    await this.#touch();
    this.#log.debug(`Removed asset ${id} from the manifest (file left on disk)`);
    return true;
  }

  /**
   * Patch an asset. Built for the enrichment pass: `metrics` and `provenance`
   * are deep-merged rather than replaced, so a vision package can write
   * `{ metrics: { faceBox, yaw, pitch } }` without knowing (or clobbering) the
   * sharpness numbers ingest measured.
   *
   * Quality is recomputed from the merged metrics unless the caller pins it
   * explicitly.
   *
   * @throws HexaError `ASSET_NOT_FOUND` | `INVALID_REQUEST` | `IO_ERROR`
   */
  async update(id: string, patch: Partial<ReferenceAsset>): Promise<ReferenceAsset> {
    const current = this.#assets.get(id);
    if (!current) {
      const near = didYouMean(id, [...this.#assets.keys()]);
      throw new HexaError('ASSET_NOT_FOUND', `No asset with id "${id}"`, {
        ...(near.length > 0 ? { hint: `Did you mean: ${near.join(', ')}?` } : {}),
        details: { id },
      });
    }
    if (patch?.id !== undefined && patch.id !== id) {
      throw new HexaError('INVALID_REQUEST', 'An asset id is immutable — remove and re-add instead', {
        details: { id, requested: patch.id },
      });
    }

    const kind = patch?.kind ?? current.kind;
    const mergedMetrics = { ...current.metrics, ...(patch?.metrics ?? {}) } as AssetMetrics;
    const pinnedQuality = typeof patch?.metrics?.quality === 'number' && Number.isFinite(patch.metrics.quality);

    const next: ReferenceAsset = {
      ...current,
      ...patch,
      id,
      kind,
      metrics: pinnedQuality ? mergedMetrics : this.#withQuality(mergedMetrics, kind),
      provenance: { ...current.provenance, ...(patch?.provenance ?? {}) } as AssetProvenance,
      tags: dedupeTags(patch?.tags ?? current.tags),
    };

    // Any path the patch touched must still live inside the root.
    if (next.path !== current.path) resolveInRoot(this.#root, next.path, 'path');
    if (next.cutoutPath && next.cutoutPath !== current.cutoutPath) {
      resolveInRoot(this.#root, next.cutoutPath, 'cutoutPath');
    }

    this.#assets.set(id, next);
    await this.#touch();
    return next;
  }

  // ── reporting ──────────────────────────────────────────────────────────────

  /**
   * Library totals. `byPlayer` counts only player-attached assets (logos and
   * backplates have no subject); `cleared` counts publish-grade assets — human
   * clearance *and* a known licence — which is the number that actually gates a
   * publish-grade render.
   */
  stats(): LibraryStats {
    const byPlayer: Record<string, number> = {};
    const byKind: Record<string, number> = {
      portrait: 0, action: 0, celebration: 0, jersey: 0, fullbody: 0, logo: 0, backplate: 0,
    };
    let cleared = 0;

    for (const a of this.#assets.values()) {
      if (a.playerId) byPlayer[a.playerId] = (byPlayer[a.playerId] ?? 0) + 1;
      byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
      if (isPublishable(a)) cleared++;
    }

    const total = this.#assets.size;
    return { total, byPlayer, byKind, cleared, uncleared: total - cleared };
  }

  /**
   * Per-player readiness. `gaps` is a list of machine-readable slugs the CLI
   * turns into "what to shoot/licence next":
   *
   *   `no-assets`               nothing at all for this player
   *   `no-cleared-licence`      assets exist but none are publish-grade
   *   `missing-kind:<kind>`     a template-critical kind is absent
   *   `low-quality`             best asset is below COVERAGE_MIN_QUALITY
   *   `no-cutout`               no pre-computed alpha cutout yet
   *
   * Called with no argument it reports on every player the library already has
   * assets for — which is what `hexa doctor` wants.
   */
  coverage(playerIds?: string[]): CoverageReport[] {
    const ids = playerIds ?? this.#knownPlayerIds();
    return ids.map((playerId) => {
      const owned = [...this.#assets.values()].filter((a) => a.playerId === playerId);
      const cleared = owned.filter((a) => isPublishable(a));
      const bestQuality = owned.reduce((max, a) => Math.max(max, this.#baseQuality(a)), 0);
      const gaps: string[] = [];

      if (owned.length === 0) {
        gaps.push('no-assets');
      } else {
        if (cleared.length === 0) gaps.push('no-cleared-licence');
        for (const kind of COVERAGE_REQUIRED_KINDS) {
          if (!owned.some((a) => a.kind === kind)) gaps.push(`missing-kind:${kind}`);
        }
        if (bestQuality < COVERAGE_MIN_QUALITY) gaps.push('low-quality');
        if (!owned.some((a) => a.cutoutPath)) gaps.push('no-cutout');
      }

      return { playerId, count: owned.length, cleared: cleared.length, bestQuality: round2(bestQuality), gaps };
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Every playerId that owns at least one asset, in stable order. */
  #knownPlayerIds(): string[] {
    const ids = new Set<string>();
    for (const a of this.#assets.values()) if (a.playerId) ids.add(a.playerId);
    return [...ids].sort((a, b) => a.localeCompare(b, 'en'));
  }

  /** Recomputed rather than trusted: a stale manifest must not skew ranking. */
  #baseQuality(a: ReferenceAsset): number {
    return computeQuality(a.metrics ?? ({} as AssetMetrics), a.kind);
  }

  #withQuality(m: Partial<AssetMetrics>, kind: AssetKind): AssetMetrics {
    const base = m as Omit<AssetMetrics, 'quality'>;
    return { ...(m as AssetMetrics), quality: computeQuality(base, kind) };
  }

  /** Save now, unless we are inside a {@link batch}. */
  async #touch(): Promise<void> {
    this.#dirty = true;
    if (this.#batchDepth === 0) await this.save();
  }

  /** `<subject>-<kind>-<contenthash>` — stable across machines and re-runs. */
  #mintId(input: AddAssetInput, digest: string): string {
    const subject = slugify(input.playerId ?? input.teamId ?? 'asset', 'asset');
    return `${subject}-${slugify(input.kind, 'asset')}-${digest}`;
  }

  /** Copy a source file into the canonical in-library location. */
  async #copyIn(src: string, meta: { id: string; kind: AssetKind; playerId?: string; teamId?: string }): Promise<string> {
    const rel = libraryRelativePath({ ...meta, ext: extensionOf(src) || '.png' });
    const dest = resolveInRoot(this.#root, rel, 'path');
    if (path.resolve(dest) === path.resolve(src)) return rel; // already in place
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    } catch (err) {
      throw new HexaError('IO_ERROR', `Failed to copy asset into the library: ${src}`, {
        hint: 'Check permissions and free space on the library root.',
        details: { src, dest },
        cause: err,
      });
    }
    return rel;
  }

  /** Move a broken manifest aside so a bad file never costs the operator data. */
  async #quarantineManifest(file: string, why: string): Promise<void> {
    const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      await fs.rename(file, backup);
      this.#log.warn(`Asset manifest is corrupt (${why}). Moved to ${path.basename(backup)}; starting a fresh library.`);
    } catch (err) {
      this.#log.warn(`Asset manifest is corrupt (${why}) and could not be moved aside; starting a fresh library.`, err);
    }
  }

  /** Validate one manifest entry; returns undefined when it is unusable. */
  #sanitise(entry: unknown): ReferenceAsset | undefined {
    if (!entry || typeof entry !== 'object') return undefined;
    const a = entry as Partial<ReferenceAsset>;
    if (typeof a.id !== 'string' || a.id === '') return undefined;
    if (typeof a.path !== 'string' || a.path === '') return undefined;
    if (typeof a.kind !== 'string') return undefined;

    const metrics = (a.metrics ?? {}) as Partial<AssetMetrics>;
    const provenance = (a.provenance ?? {}) as Partial<AssetProvenance>;

    return {
      ...a,
      id: a.id,
      path: a.path,
      kind: a.kind as AssetKind,
      metrics: {
        ...metrics,
        width: numberOr(metrics.width, 0),
        height: numberOr(metrics.height, 0),
        sharpness: numberOr(metrics.sharpness, 0),
        brightness: numberOr(metrics.brightness, 0),
        contrast: numberOr(metrics.contrast, 0),
        quality: numberOr(metrics.quality, 0),
      },
      provenance: {
        ...provenance,
        source: typeof provenance.source === 'string' ? provenance.source : 'unknown',
        license: provenance.license ?? 'unverified',
        addedAt: typeof provenance.addedAt === 'string' ? provenance.addedAt : new Date(0).toISOString(),
        // Anything not explicitly true is not cleared. A malformed flag must
        // fail closed, never open.
        cleared: provenance.cleared === true,
      },
      tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string') : [],
    } as ReferenceAsset;
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function dedupeTags(tags: string[]): string[] {
  return [...new Set((tags ?? []).filter((t) => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()))].sort(
    (a, b) => a.localeCompare(b, 'en'),
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
