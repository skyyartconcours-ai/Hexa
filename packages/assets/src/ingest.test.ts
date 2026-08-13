import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isHexaError } from '@hexa/core';
import {
  DEFAULT_DUPLICATE_DISTANCE,
  computeBasicMetrics,
  computeDHash,
  findDuplicate,
  hammingDistance,
  inferKind,
  inferPlayerId,
  ingestDirectory,
  listImageFiles,
} from './ingest.js';
import { AssetLibrary } from './library.js';
import { recordingLogger, tempDir, testProvenance, writeTestImage } from './testing.js';

const dirs: string[] = [];
async function scratch(): Promise<string> {
  const d = await tempDir('hexa-ingest-');
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('computeBasicMetrics', () => {
  it('reads true dimensions', async () => {
    const d = await scratch();
    const file = await writeTestImage(path.join(d, 'a.png'), { width: 640, height: 360 });
    const m = await computeBasicMetrics(file);
    expect(m.width).toBe(640);
    expect(m.height).toBe(360);
  });

  it('measures sharpness with variance-of-Laplacian: blur lowers it', async () => {
    const d = await scratch();
    const sharpFile = await writeTestImage(path.join(d, 'sharp.png'), { pattern: 'checker' });
    const softFile = await writeTestImage(path.join(d, 'soft.png'), { pattern: 'checker', blur: 6 });

    const crisp = await computeBasicMetrics(sharpFile);
    const soft = await computeBasicMetrics(softFile);
    expect(crisp.sharpness).toBeGreaterThan(soft.sharpness);
    expect(soft.sharpness).toBeGreaterThanOrEqual(0);
  });

  it('measures brightness as mean luminance', async () => {
    const d = await scratch();
    const dark = await computeBasicMetrics(await writeTestImage(path.join(d, 'dark.png'), { pattern: 'flat', level: 30 }));
    const bright = await computeBasicMetrics(await writeTestImage(path.join(d, 'bright.png'), { pattern: 'flat', level: 220 }));
    expect(dark.brightness).toBeLessThan(60);
    expect(bright.brightness).toBeGreaterThan(190);
    expect(bright.brightness).toBeGreaterThan(dark.brightness);
  });

  it('measures RMS contrast: a flat plate has none, a checker has plenty', async () => {
    const d = await scratch();
    const flat = await computeBasicMetrics(await writeTestImage(path.join(d, 'flat.png'), { pattern: 'flat', level: 128 }));
    const checker = await computeBasicMetrics(await writeTestImage(path.join(d, 'checker.png'), { pattern: 'checker' }));
    expect(flat.contrast).toBeLessThan(0.02);
    expect(checker.contrast).toBeGreaterThan(0.3);
    expect(checker.contrast).toBeLessThanOrEqual(1);
  });

  it('leaves every ML-dependent field undefined for the enrichment pass', async () => {
    const d = await scratch();
    const m = await computeBasicMetrics(await writeTestImage(path.join(d, 'a.png')));
    expect(m.faceBox).toBeUndefined();
    expect(m.landmarks).toBeUndefined();
    expect(m.faceArea).toBeUndefined();
    expect(m.yaw).toBeUndefined();
    expect(m.occlusion).toBeUndefined();
    expect(Array.isArray(m.palette)).toBe(true);
  });

  it('raises IO_ERROR for files that are not decodable images', async () => {
    const d = await scratch();
    const bogus = path.join(d, 'not-an-image.png');
    await fs.writeFile(bogus, 'hello');
    await expect(computeBasicMetrics(bogus)).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'IO_ERROR');
    await expect(computeBasicMetrics(path.join(d, 'missing.png'))).rejects.toSatisfy(
      (e: unknown) => isHexaError(e) && e.code === 'IO_ERROR',
    );
  });
});

describe('dHash', () => {
  it('is a 64-bit hash rendered as 16 hex characters', async () => {
    const d = await scratch();
    const h = await computeDHash(await writeTestImage(path.join(d, 'a.png')));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable for the same pixels', async () => {
    const d = await scratch();
    const a = await writeTestImage(path.join(d, 'a.png'));
    const b = await writeTestImage(path.join(d, 'b.png'));
    expect(await computeDHash(a)).toBe(await computeDHash(b));
  });

  it('survives rescaling and lossy re-encoding (the same press photo, twice)', async () => {
    const d = await scratch();
    const original = await writeTestImage(path.join(d, 'orig.png'), { width: 640, height: 480, pattern: 'waves' });
    const reposted = await writeTestImage(path.join(d, 'repost.jpg'), {
      width: 640,
      height: 480,
      pattern: 'waves',
      scale: 0.55,
      format: 'jpeg',
      quality: 62,
    });
    const distance = hammingDistance(await computeDHash(original), await computeDHash(reposted));
    expect(distance).toBeLessThanOrEqual(DEFAULT_DUPLICATE_DISTANCE);
  });

  it('separates genuinely different photographs', async () => {
    const d = await scratch();
    const a = await computeDHash(await writeTestImage(path.join(d, 'a.png'), { pattern: 'waves' }));
    const b = await computeDHash(await writeTestImage(path.join(d, 'b.png'), { pattern: 'waves-alt' }));
    expect(hammingDistance(a, b)).toBeGreaterThan(DEFAULT_DUPLICATE_DISTANCE);
  });

  it('treats missing or malformed hashes as maximally distant', () => {
    expect(hammingDistance(undefined, 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('abc', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('zzzz', 'ffff')).toBe(64);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('0f00000000000000', '0000000000000000')).toBe(4);
  });

  it('findDuplicate returns the closest match inside the threshold', () => {
    const candidates = [
      { id: 'far', phash: 'ffffffffffffffff' },
      { id: 'near', phash: '0000000000000001' },
      { id: 'nohash' },
    ];
    expect(findDuplicate('0000000000000000', candidates, 6)?.id).toBe('near');
    expect(findDuplicate('0000000000000000', candidates, 0)).toBeUndefined();
  });
});

describe('path inference', () => {
  it('reads the asset kind from folder or file names', () => {
    expect(inferKind('/refs/peyz/portrait/01.png', '/refs')).toBe('portrait');
    expect(inferKind('/refs/peyz/peyz_headshot_2.jpg', '/refs')).toBe('portrait');
    expect(inferKind('/refs/hle/logo.png', '/refs')).toBe('logo');
    expect(inferKind('/refs/misc/photo.png', '/refs')).toBeUndefined();
  });

  it('reads the player from the folder above the photos', () => {
    expect(inferPlayerId('/refs/peyz/portrait/01.png', '/refs')).toBe('peyz');
    expect(inferPlayerId('/refs/portrait/01.png', '/refs')).toBeUndefined();
    expect(inferPlayerId('/refs/01.png', '/refs')).toBeUndefined();
  });
});

describe('listImageFiles', () => {
  it('walks recursively, sorts, and skips dotfiles and unsupported formats', async () => {
    const d = await scratch();
    await writeTestImage(path.join(d, 'b.png'));
    await writeTestImage(path.join(d, 'a.jpg'), { format: 'jpeg' });
    await writeTestImage(path.join(d, 'nested', 'c.webp'), { format: 'webp' });
    await fs.writeFile(path.join(d, 'notes.txt'), 'hi');
    await fs.writeFile(path.join(d, '.hidden.png'), 'hi');

    const skips: { file: string; reason: string }[] = [];
    const files = await listImageFiles(d, { onSkip: (file, reason) => skips.push({ file, reason }) });

    expect(files.map((f) => path.basename(f))).toEqual(['a.jpg', 'b.png', 'c.webp']);
    expect(skips.some((s) => s.reason === 'unsupported-extension' && s.file.endsWith('notes.txt'))).toBe(true);
    expect(skips.some((s) => s.file.includes('.hidden.png'))).toBe(false);
  });

  it('can be told not to recurse', async () => {
    const d = await scratch();
    await writeTestImage(path.join(d, 'a.png'));
    await writeTestImage(path.join(d, 'nested', 'b.png'));
    const files = await listImageFiles(d, { recursive: false });
    expect(files).toHaveLength(1);
  });
});

describe('ingestDirectory', () => {
  it('ingests a folder, infers subject and kind, and stamps provenance', async () => {
    const root = await scratch();
    const drop = await scratch();
    await writeTestImage(path.join(drop, 'peyz', 'portrait', '01.png'), { pattern: 'waves' });
    await writeTestImage(path.join(drop, 'peyz', 'action', '02.png'), { pattern: 'waves-alt' });

    const lib = await AssetLibrary.open(root, { logger: recordingLogger().logger });
    const result = await ingestDirectory(lib, drop, { provenance: testProvenance() });

    expect(result.added).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(new Set(result.added.map((a) => a.kind))).toEqual(new Set(['portrait', 'action']));
    expect(result.added.every((a) => a.playerId === 'peyz')).toBe(true);
    expect(result.added.every((a) => a.provenance.source.includes('LCK'))).toBe(true);
    expect(result.added.every((a) => a.metrics.width > 0 && a.metrics.quality > 0)).toBe(true);
    expect(result.added.every((a) => /^[0-9a-f]{16}$/.test(a.phash ?? ''))).toBe(true);

    // The whole walk is a single atomic manifest write, and it round-trips.
    const reopened = await AssetLibrary.open(root);
    expect(reopened.all()).toHaveLength(2);
  });

  it('skips near-duplicates against the library and within the same run', async () => {
    const root = await scratch();
    const drop = await scratch();
    await writeTestImage(path.join(drop, 'a.png'), { width: 640, height: 480, pattern: 'waves' });
    // Same photograph, re-exported smaller and lossy — a classic press-kit dupe.
    await writeTestImage(path.join(drop, 'b.jpg'), {
      width: 640,
      height: 480,
      pattern: 'waves',
      scale: 0.55,
      format: 'jpeg',
      quality: 62,
    });
    await writeTestImage(path.join(drop, 'c.png'), { width: 640, height: 480, pattern: 'waves-alt' });

    const lib = await AssetLibrary.open(root, { logger: recordingLogger().logger });
    const first = await ingestDirectory(lib, drop, { provenance: testProvenance(), playerId: 'peyz' });

    expect(first.added).toHaveLength(2);
    expect(first.skipped).toHaveLength(1);
    expect(first.skipped[0]!.reason).toMatch(/^duplicate-of:/);
    expect(first.skipped[0]!.path).toContain('b.jpg');

    // Re-running over the same folder adds nothing at all.
    const second = await ingestDirectory(lib, drop, { provenance: testProvenance(), playerId: 'peyz' });
    expect(second.added).toHaveLength(0);
    expect(second.skipped.every((s) => s.reason.startsWith('duplicate-of:'))).toBe(true);
    expect(lib.all()).toHaveLength(2);
  });

  it('reports unreadable files instead of aborting the run', async () => {
    const root = await scratch();
    const drop = await scratch();
    await writeTestImage(path.join(drop, 'good.png'));
    await fs.writeFile(path.join(drop, 'broken.png'), 'definitely not a png');

    const lib = await AssetLibrary.open(root, { logger: recordingLogger().logger });
    const result = await ingestDirectory(lib, drop, { provenance: testProvenance() });

    expect(result.added).toHaveLength(1);
    expect(result.skipped.some((s) => s.path.endsWith('broken.png') && s.reason.startsWith('error:'))).toBe(true);
  });

  it('refuses to run without provenance, and reports a missing directory', async () => {
    const root = await scratch();
    const lib = await AssetLibrary.open(root, { logger: recordingLogger().logger });
    await expect(
      ingestDirectory(lib, path.join(root, 'nope'), { provenance: testProvenance() }),
    ).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'IO_ERROR');
    await expect(
      ingestDirectory(lib, root, { provenance: undefined as unknown as ReturnType<typeof testProvenance> }),
    ).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'INVALID_REQUEST');
  });

  it('never ingests its own manifest', async () => {
    const root = await scratch();
    const lib = await AssetLibrary.open(root, { logger: recordingLogger().logger });
    await writeTestImage(path.join(root, 'stray.png'));
    const result = await ingestDirectory(lib, root, { provenance: testProvenance(), copy: false });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.path).toBe('stray.png');
    expect(result.skipped.some((s) => s.path.endsWith('manifest.json'))).toBe(false);
  });
});
