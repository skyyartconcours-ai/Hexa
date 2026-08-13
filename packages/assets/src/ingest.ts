/**
 * Ingestion.
 *
 * Turning a folder of downloaded press photos into a library the renderer can
 * trust. Everything here is deliberately ML-free: dimensions, sharpness,
 * brightness, contrast and a perceptual hash are all computable from pixels
 * alone, so ingest runs anywhere — CI, a laptop with no GPU, an air-gapped box —
 * and never blocks on a model download.
 *
 * The fields that *do* need vision (faceBox, landmarks, yaw/pitch/roll,
 * occlusion, embedding) are left `undefined` on purpose. A later enrichment
 * pass fills them in through {@link AssetLibrary.update}, which deep-merges
 * metrics and recomputes quality — so enrichment is a clean second pass that
 * can be re-run, interrupted, or skipped entirely without corrupting anything.
 * Until it runs, {@link computeQuality} scores the missing terms with documented
 * neutral priors rather than zeros.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AssetKind, AssetMetrics, AssetProvenance, LicenseKind, PlayerId, ReferenceAsset, TeamId } from '@hexa/core';
import { HexaError } from '@hexa/core';
import type { AssetLibrary } from './library.js';
import { isReservedFile, isSupportedImage, slugify } from './paths.js';

/**
 * All pixel statistics are computed at this analysis resolution. Normalising
 * first is what makes sharpness comparable: the same photo at 4K and at 720p
 * would otherwise produce wildly different variance-of-Laplacian numbers, and
 * the ranker would quietly prefer whichever export was larger.
 */
export const ANALYSIS_MAX_DIM = 1024;

/** dHash rows/cols. 9 columns compared pairwise ⇒ 8 bits per row ⇒ 64 bits. */
const DHASH_W = 9;
const DHASH_H = 8;

/** Hamming distance at or below this counts as the same photograph. */
export const DEFAULT_DUPLICATE_DISTANCE = 6;

// ── pixel statistics ─────────────────────────────────────────────────────────

/** Anything decodable: a path on disk or the bytes themselves. */
export type ImageSource = string | Buffer | Uint8Array;

/**
 * Real, ML-free metrics for an image.
 *
 *  - `width`/`height` — true pixel dimensions, EXIF orientation applied (a
 *    portrait phone shot reports portrait, not the landscape sensor frame).
 *  - `sharpness`      — variance of the Laplacian over greyscale. The classic
 *                       blur detector: a flat/blurred image has almost no
 *                       second-derivative energy. <40 is soft.
 *  - `brightness`     — mean luminance, 0–255.
 *  - `contrast`       — RMS contrast (standard deviation of normalised
 *                       luminance), 0–1.
 *  - `palette`        — dominant colours, most frequent first, from a coarse
 *                       quantisation. Feeds accent derivation, costs nothing.
 *
 * @throws HexaError `IO_ERROR` when the file is missing or not a decodable image.
 */
export async function computeBasicMetrics(file: ImageSource): Promise<Omit<AssetMetrics, 'quality'>> {
  const meta = await readMetadata(file);

  // EXIF orientations 5–8 swap the axes; `.rotate()` in the pipelines below
  // applies the transform, so the reported dimensions must match.
  const swapped = typeof meta.orientation === 'number' && meta.orientation >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;
  if (width <= 0 || height <= 0) {
    throw new HexaError('IO_ERROR', `Could not read image dimensions: ${describe(file)}`, {
      hint: 'The file may be truncated or not an image.',
      details: { file: describe(file) },
    });
  }

  const { data, info } = await run(file, (p) =>
    p
      .rotate()
      .greyscale()
      .resize({ width: ANALYSIS_MAX_DIM, height: ANALYSIS_MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true }),
  );

  const stats = greyStats(data, info.width, info.height);
  const palette = await dominantColours(file);

  return {
    width,
    height,
    sharpness: stats.sharpness,
    brightness: stats.brightness,
    contrast: stats.contrast,
    ...(palette.length > 0 ? { palette } : {}),
  };
}

/** Variance-of-Laplacian, mean and RMS contrast in a single pass over greyscale. */
function greyStats(data: Buffer | Uint8Array, w: number, h: number): { sharpness: number; brightness: number; contrast: number } {
  const n = w * h;
  if (n === 0) return { sharpness: 0, brightness: 0, contrast: 0 };

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i]!;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  // RMS contrast is the standard deviation of luminance normalised to 0–1.
  const contrast = Math.sqrt(variance) / 255;

  // 4-neighbour Laplacian kernel:  0  1  0
  //                                1 -4  1
  //                                0  1  0
  let lSum = 0;
  let lSumSq = 0;
  let lN = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const lap = -4 * data[i]! + data[i - 1]! + data[i + 1]! + data[i - w]! + data[i + w]!;
      lSum += lap;
      lSumSq += lap * lap;
      lN++;
    }
  }
  const lMean = lN > 0 ? lSum / lN : 0;
  const sharpness = lN > 0 ? Math.max(0, lSumSq / lN - lMean * lMean) : 0;

  return {
    sharpness: round(sharpness, 2),
    brightness: round(mean, 2),
    contrast: round(contrast, 4),
  };
}

/** Coarse dominant-colour extraction: 24×24 thumbnail, 32-level buckets. */
async function dominantColours(file: ImageSource, max = 5): Promise<string[]> {
  try {
    const { data, info } = await run(file, (p) =>
      p.rotate().resize(24, 24, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }),
    );
    const ch = info.channels ?? 3;
    if (ch < 3) return [];
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i + ch - 1 < data.length; i += ch) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      cur.n++;
      cur.r += r;
      cur.g += g;
      cur.b += b;
      buckets.set(key, cur);
    }
    return [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, max)
      .map(({ n, r, g, b }) => hex(r / n, g / n, b / n));
  } catch {
    return []; // a palette is a nicety; never fail ingestion over it
  }
}

// ── perceptual hashing ───────────────────────────────────────────────────────

/**
 * 64-bit difference hash as 16 hex characters.
 *
 * Greyscale → 9×8 → compare each pixel with its right-hand neighbour. Encodes
 * the *gradient structure* of the image, so it survives re-encoding, rescaling
 * and mild colour grading — exactly the differences between the same press
 * photo pulled from two sites — while different photographs of the same player
 * in the same pose still land far apart.
 */
export async function computeDHash(file: ImageSource): Promise<string> {
  const { data } = await run(file, (p) =>
    p.rotate().greyscale().resize(DHASH_W, DHASH_H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
  );

  let hexOut = '';
  let nibble = 0;
  let bitsInNibble = 0;
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W - 1; x++) {
      const i = y * DHASH_W + x;
      const bit = data[i]! > data[i + 1]! ? 1 : 0;
      nibble = (nibble << 1) | bit;
      if (++bitsInNibble === 4) {
        hexOut += nibble.toString(16);
        nibble = 0;
        bitsInNibble = 0;
      }
    }
  }
  return hexOut; // 64 bits ⇒ 16 hex chars
}

/** Bit distance between two dHashes. Mismatched/invalid input ⇒ 64 (max). */
export function hammingDistance(a: string | undefined, b: string | undefined): number {
  if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Nearest existing asset within `maxDistance`, or undefined. */
export function findDuplicate(
  phash: string,
  candidates: { id: string; phash?: string }[],
  maxDistance = DEFAULT_DUPLICATE_DISTANCE,
): { id: string; distance: number } | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const c of candidates) {
    if (!c.phash) continue;
    const d = hammingDistance(phash, c.phash);
    if (d <= maxDistance && (best === undefined || d < best.distance)) best = { id: c.id, distance: d };
    if (best?.distance === 0) break;
  }
  return best;
}

/** SHA-256 of the file contents, truncated — the identity half of an asset id. */
export async function contentHash(file: ImageSource, length = 10): Promise<string> {
  try {
    const buf = typeof file === 'string' ? await fs.readFile(file) : file;
    return createHash('sha256').update(buf).digest('hex').slice(0, length);
  } catch (err) {
    throw new HexaError('IO_ERROR', `Cannot read file: ${describe(file)}`, { details: { file: describe(file) }, cause: err });
  }
}

// ── directory ingestion ──────────────────────────────────────────────────────

export interface IngestDefaults {
  /** Applied when the kind cannot be inferred from the path. Default 'portrait'. */
  kind?: AssetKind;
  playerId?: PlayerId;
  teamId?: TeamId;
  /**
   * Provenance stamped on everything ingested in this run. `addedAt` defaults
   * to now. Either this or the flat `source`/`license` pair below is required —
   * a run with neither is refused, because an unsourced photo is not an asset.
   */
  provenance?: Omit<AssetProvenance, 'addedAt'> & { addedAt?: string };
  /** Flat alternative to `provenance`, matching how a CLI passes flags through. */
  source?: string;
  license?: LicenseKind;
  credit?: string;
  photographer?: string;
  capturedAt?: string;
  cleared?: boolean;
  tags?: string[];
  /** Copy files into the library (default: copy when the source is outside the root). */
  copy?: boolean;
  /** Descend into subdirectories. Default true. */
  recursive?: boolean;
  /** Directory depth guard for pathological trees. Default 8. */
  maxDepth?: number;
  /** Hamming threshold for near-duplicate rejection. Default 6. */
  duplicateDistance?: number;
  /**
   * Read playerId/kind from the file and folder names when not given
   * explicitly (`refs/peyz/portrait/01.jpg` ⇒ player "peyz", kind portrait).
   * Default true.
   */
  inferFromPath?: boolean;
  onProgress?: (p: { file: string; index: number; total: number }) => void;
}

export interface IngestResult {
  added: ReferenceAsset[];
  /** Everything not added, with a reason: duplicate, unsupported, unreadable. */
  skipped: { path: string; reason: string }[];
  /** The duplicate subset of `skipped`, pre-split for reporting. */
  duplicates: { path: string; existingId: string; distance: number }[];
  /** The failure subset of `skipped`, pre-split for reporting. */
  errors: { path: string; message: string }[];
}

/**
 * Normalise the two accepted provenance shapes into one record.
 *
 * @throws HexaError `INVALID_REQUEST` when neither shape carries a source and a
 * licence — the one thing ingestion refuses to guess.
 */
function resolveProvenance(defaults: IngestDefaults): AssetProvenance {
  const now = new Date().toISOString();
  type Loose = Partial<AssetProvenance>;
  const flat: Loose | undefined = defaults?.provenance
    ? undefined
    : defaults?.source || defaults?.license
      ? {
          source: defaults.source ?? 'unknown',
          license: defaults.license ?? 'unverified',
          ...(defaults.credit ? { credit: defaults.credit } : {}),
          ...(defaults.photographer ? { photographer: defaults.photographer } : {}),
          ...(defaults.capturedAt ? { capturedAt: defaults.capturedAt } : {}),
          cleared: defaults.cleared === true,
        }
      : undefined;

  const p: Loose | undefined = defaults?.provenance ?? flat;
  if (!p?.source || !p?.license) {
    throw new HexaError('INVALID_REQUEST', 'Ingestion requires provenance (source + licence)', {
      hint: 'Every photo must record where it came from — that is the whole point of the library.',
    });
  }
  return { ...p, source: p.source, license: p.license, addedAt: p.addedAt ?? now, cleared: p.cleared === true };
}

/**
 * Walk `dir`, add every usable image to `lib`, and report exactly what was
 * skipped and why.
 *
 * Near-duplicates are rejected against both the existing library and the files
 * added earlier in this same run — press kits routinely ship the same frame at
 * three sizes, and a library full of the same photo silently narrows the
 * variety the ranker has to work with.
 *
 * The whole walk runs inside one library batch: a single atomic manifest write
 * at the end rather than one per file.
 */
export async function ingestDirectory(
  lib: AssetLibrary | string,
  dir: string,
  defaults: IngestDefaults,
): Promise<IngestResult> {
  // A library root is accepted in place of an instance so a CLI can ingest in
  // one call. Imported lazily to keep the static module graph acyclic.
  const library =
    typeof lib === 'string' ? await (await import('./library.js')).AssetLibrary.open(lib) : lib;

  const root = path.resolve(dir);
  const stat = await fs.stat(root).catch((err) => {
    throw new HexaError('IO_ERROR', `Ingest directory not found: ${root}`, {
      hint: 'Point --from at a folder of licensed reference photographs.',
      cause: err,
    });
  });
  if (!stat.isDirectory()) {
    throw new HexaError('IO_ERROR', `Not a directory: ${root}`, { details: { dir: root } });
  }
  const provenance = resolveProvenance(defaults);

  const maxDistance = defaults.duplicateDistance ?? DEFAULT_DUPLICATE_DISTANCE;
  const infer = defaults.inferFromPath !== false;
  const added: ReferenceAsset[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const duplicates: IngestResult['duplicates'] = [];
  const errors: IngestResult['errors'] = [];

  const files = await listImageFiles(root, {
    recursive: defaults.recursive !== false,
    maxDepth: defaults.maxDepth ?? 8,
    onSkip: (p, reason) => skipped.push({ path: p, reason }),
  });

  // Hashes to test against: everything already in the library, plus everything
  // this run adds as it goes.
  const seen: { id: string; phash?: string }[] = library.all().map((a) => ({ id: a.id, phash: a.phash }));

  await library.batch(async () => {
    let index = 0;
    for (const file of files) {
      index++;
      defaults.onProgress?.({ file, index, total: files.length });
      try {
        const phash = await computeDHash(file);
        const dup = findDuplicate(phash, seen, maxDistance);
        if (dup) {
          skipped.push({ path: file, reason: `duplicate-of:${dup.id} (distance ${dup.distance})` });
          duplicates.push({ path: file, existingId: dup.id, distance: dup.distance });
          continue;
        }

        const metrics = await computeBasicMetrics(file);
        const kind = defaults.kind ?? (infer ? inferKind(file, root) : undefined) ?? 'portrait';
        const playerId = defaults.playerId ?? (infer ? inferPlayerId(file, root) : undefined);

        const asset = await library.add(
          {
            path: file,
            kind,
            ...(playerId ? { playerId } : {}),
            ...(defaults.teamId ? { teamId: defaults.teamId } : {}),
            provenance,
            tags: defaults.tags ?? [],
            ...(defaults.copy === undefined ? {} : { copy: defaults.copy }),
          },
          { metrics, phash },
        );

        added.push(asset);
        seen.push({ id: asset.id, phash });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        skipped.push({ path: file, reason: `error: ${message}` });
        errors.push({ path: file, message });
      }
    }
  });

  return { added, skipped, duplicates, errors };
}

/** Sorted list of ingestable image files. Deterministic order ⇒ reproducible ids. */
export async function listImageFiles(
  dir: string,
  opts: { recursive?: boolean; maxDepth?: number; onSkip?: (file: string, reason: string) => void } = {},
): Promise<string[]> {
  const out: string[] = [];
  const maxDepth = opts.maxDepth ?? 8;

  const walk = async (current: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(current, entry.name);
      if (entry.name.startsWith('.')) continue; // dotfiles, .git, .DS_Store
      if (entry.isDirectory()) {
        if (opts.recursive === false) continue;
        if (entry.name === 'node_modules') continue;
        if (depth >= maxDepth) {
          opts.onSkip?.(full, 'max-depth-exceeded');
          continue;
        }
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isReservedFile(full)) continue; // never ingest our own manifest
      if (!isSupportedImage(full)) {
        opts.onSkip?.(full, 'unsupported-extension');
        continue;
      }
      const st = await fs.stat(full).catch(() => undefined);
      if (!st || st.size === 0) {
        opts.onSkip?.(full, 'empty-file');
        continue;
      }
      out.push(full);
    }
  };

  await walk(path.resolve(dir), 0);
  return out;
}

/** Filename/folder tokens that map onto an AssetKind. */
const KIND_TOKENS: [RegExp, AssetKind][] = [
  [/\b(portrait|headshot|head|bust|mugshot)\b/, 'portrait'],
  [/\b(jersey|kit|uniform|media[-_ ]?day)\b/, 'jersey'],
  [/\b(action|ingame|in[-_ ]?game|stage|play)\b/, 'action'],
  [/\b(celebration|celebrate|celeb|trophy|win|victory)\b/, 'celebration'],
  [/\b(fullbody|full[-_ ]?body|standing|body)\b/, 'fullbody'],
  [/\b(logo|crest|mark|badge)\b/, 'logo'],
  [/\b(backplate|background|plate|bg|env|arena)\b/, 'backplate'],
];

/** Infer an asset kind from the file name or any folder between it and the root. */
export function inferKind(file: string, root: string): AssetKind | undefined {
  const rel = path.relative(root, file).toLowerCase().replace(/[\\/]/g, ' ');
  const hay = ` ${rel.replace(/[._-]/g, ' ')} `;
  for (const [re, kind] of KIND_TOKENS) if (re.test(hay)) return kind;
  return undefined;
}

/**
 * Infer a player id from the folder layout: the first directory under the
 * ingest root that is not itself a kind token. `refs/peyz/portrait/a.jpg`
 * ⇒ `peyz`.
 */
export function inferPlayerId(file: string, root: string): PlayerId | undefined {
  const rel = path.relative(root, file);
  const parts = rel.split(path.sep).slice(0, -1);
  for (const part of parts) {
    if (!part || part.startsWith('.')) continue;
    if (inferKind(part, '')) continue; // it names a kind, not a person
    const slug = slugify(part, '');
    if (slug) return slug;
  }
  return undefined;
}

// ── sharp plumbing ───────────────────────────────────────────────────────────

type SharpPipeline = ReturnType<typeof sharp>;

async function run<T>(file: ImageSource, fn: (p: SharpPipeline) => Promise<T>): Promise<T> {
  try {
    // failOn: 'none' keeps slightly-truncated downloads usable — a press photo
    // with a broken last scanline is still a perfectly good reference.
    return await fn(sharp(file as string | Buffer, { failOn: 'none' }));
  } catch (err) {
    throw new HexaError('IO_ERROR', `Cannot decode image: ${describe(file)}`, {
      hint: 'Supported formats are PNG, JPEG, WebP and AVIF.',
      details: { file: describe(file) },
      cause: err,
    });
  }
}

async function readMetadata(file: ImageSource): Promise<sharp.Metadata> {
  return run(file, (p) => p.metadata());
}

/** Human-readable label for an image source, for error messages. */
function describe(file: ImageSource): string {
  return typeof file === 'string' ? file : `<${file.byteLength} byte buffer>`;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function hex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
