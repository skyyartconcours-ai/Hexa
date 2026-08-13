/**
 * Path resolution and containment.
 *
 * Every `ReferenceAsset.path` is stored *relative to the library root* so a
 * library can be zipped, moved between machines or checked into a share drive
 * without rewriting the manifest. That portability is only safe if resolution
 * is hostile-input proof: a manifest is a plain JSON file that a user (or a
 * badly-behaved ingest script, or a downloaded library) can hand-edit, and a
 * path like `../../../.ssh/id_rsa` must never resolve to something the render
 * pipeline will happily read and composite into an image.
 *
 * So: all resolution goes through {@link resolveInRoot}, which normalises and
 * then proves containment. There is deliberately no "unsafe" escape hatch.
 */

import path from 'node:path';
import { HexaError } from '@hexa/core';

/** Manifest file name inside the library root. */
export const MANIFEST_FILENAME = 'manifest.json';

/** Image extensions the ingest pipeline understands (lowercase, with dot). */
export const SUPPORTED_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.avif'] as const;

/** Files the library writes for itself and must never treat as an asset. */
export const RESERVED_FILENAMES: readonly string[] = [MANIFEST_FILENAME] as const;

/** Absolute, symlink-free-ish, trailing-slash-free form of a library root. */
export function normaliseRoot(root: string): string {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new HexaError('IO_ERROR', 'Asset library root must be a non-empty path', {
      hint: 'Pass the directory that holds manifest.json, e.g. `./assets`.',
    });
  }
  return path.resolve(root);
}

/**
 * True when `candidate` (already absolute) is the root itself or lives under
 * it. Comparison is lexical on normalised paths — we never touch the disk here,
 * so it works for paths that do not exist yet (e.g. a cutout about to be
 * written).
 */
export function isInside(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  if (c === r) return true;
  const rel = path.relative(r, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolve a library-relative path to an absolute one, refusing anything that
 * escapes the root.
 *
 * Accepts an already-absolute path only when it is inside the root (handy for
 * callers that round-trip through {@link resolveInRoot} twice).
 *
 * @throws HexaError `IO_ERROR` on traversal, absolute escapes, empty paths or
 * embedded NUL bytes.
 */
export function resolveInRoot(root: string, relPath: string, what = 'path'): string {
  const r = normaliseRoot(root);

  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new HexaError('IO_ERROR', `Empty ${what} in asset library`, {
      hint: 'Every asset needs a path relative to the library root.',
      details: { root: r },
    });
  }
  // NUL bytes terminate C strings: a path like "ok.png\0../../etc/passwd" can
  // pass a naive JS check and mean something else to the syscall layer.
  if (relPath.includes('\0')) {
    throw new HexaError('IO_ERROR', `Illegal NUL byte in asset ${what}`, {
      details: { root: r, path: relPath },
    });
  }

  const abs = path.isAbsolute(relPath) ? path.resolve(relPath) : path.resolve(r, relPath);

  if (!isInside(r, abs)) {
    throw new HexaError('IO_ERROR', `Asset ${what} escapes the library root: ${relPath}`, {
      hint: 'Asset paths must stay inside the library root. Re-add the file with `copy: true` to bring it in.',
      details: { root: r, path: relPath, resolved: abs },
    });
  }
  return abs;
}

/**
 * Inverse of {@link resolveInRoot}: absolute path → the POSIX-style relative
 * path stored in the manifest. Forward slashes always, so a library written on
 * Windows still resolves on Linux.
 */
export function toRelative(root: string, absPath: string): string {
  const r = normaliseRoot(root);
  const abs = path.resolve(absPath);
  if (!isInside(r, abs)) {
    throw new HexaError('IO_ERROR', `Path lies outside the library root: ${absPath}`, {
      hint: 'Copy the file into the library (`copy: true`) instead of referencing it in place.',
      details: { root: r, path: absPath },
    });
  }
  return path.relative(r, abs).split(path.sep).join('/');
}

/** Absolute path of the manifest for a given root. */
export function manifestPath(root: string): string {
  return path.join(normaliseRoot(root), MANIFEST_FILENAME);
}

/** Lowercase extension including the dot, or '' when there is none. */
export function extensionOf(file: string): string {
  return path.extname(file).toLowerCase();
}

/** True for the raster formats ingest accepts. */
export function isSupportedImage(file: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(file));
}

/** True for files the library owns and must not ingest as artwork. */
export function isReservedFile(file: string): boolean {
  return RESERVED_FILENAMES.includes(path.basename(file));
}

/**
 * Turn arbitrary text into a filesystem-safe slug. Used for generated asset
 * ids and the directory layout inside a library.
 */
export function slugify(input: string, fallback = 'asset'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug === '' ? fallback : slug;
}

/**
 * Canonical in-library location for a newly copied file:
 * `players/<playerId>/<kind>/<id><ext>`, or `teams/<teamId>/…`, falling back to
 * `unsorted/<kind>/…`. Grouping by subject keeps a hand-browsed library
 * navigable and makes per-player coverage obvious in a file manager.
 */
export function libraryRelativePath(opts: {
  id: string;
  kind: string;
  ext: string;
  playerId?: string;
  teamId?: string;
}): string {
  const ext = opts.ext.startsWith('.') ? opts.ext.toLowerCase() : `.${opts.ext.toLowerCase()}`;
  const scope = opts.playerId
    ? `players/${slugify(opts.playerId, 'unknown')}`
    : opts.teamId
      ? `teams/${slugify(opts.teamId, 'unknown')}`
      : 'unsorted';
  return `${scope}/${slugify(opts.kind, 'asset')}/${slugify(opts.id, 'asset')}${ext}`;
}
