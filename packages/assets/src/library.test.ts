import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssetManifest, ReferenceAsset } from '@hexa/core';
import { isHexaError } from '@hexa/core';
import { AssetLibrary, MANIFEST_VERSION } from './library.js';
import { MANIFEST_FILENAME } from './paths.js';
import { ensurePlaceholderAsset } from './placeholder.js';
import { recordingLogger, tempDir, testProvenance, writeTestImage } from './testing.js';

const dirs: string[] = [];
async function scratch(): Promise<string> {
  const d = await tempDir('hexa-lib-');
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function open(root: string): Promise<AssetLibrary> {
  return AssetLibrary.open(root, { logger: recordingLogger().logger });
}

async function seed(lib: AssetLibrary, over: Partial<Parameters<AssetLibrary['add']>[0]> = {}, image = {}): Promise<ReferenceAsset> {
  const src = await writeTestImage(path.join(await scratch(), `${Math.random().toString(36).slice(2)}.png`), image);
  return lib.add({ path: src, kind: 'portrait', provenance: testProvenance(), ...over });
}

describe('open / load / save', () => {
  it('creates the manifest on first open', async () => {
    const root = await scratch();
    const lib = await open(root);
    const raw = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILENAME), 'utf8')) as AssetManifest;
    expect(raw.version).toBe(MANIFEST_VERSION);
    expect(raw.root).toBe(root);
    expect(raw.assets).toEqual([]);
    expect(lib.root).toBe(root);
    expect(lib.all()).toEqual([]);
  });

  it('round-trips assets through the manifest', async () => {
    const root = await scratch();
    const lib = await open(root);
    const added = await seed(lib, { playerId: 'peyz', kind: 'portrait', tags: ['worlds'] });

    const reopened = await open(root);
    const loaded = reopened.get(added.id);
    expect(loaded).toBeDefined();
    expect(loaded!.playerId).toBe('peyz');
    expect(loaded!.tags).toEqual(['worlds']);
    expect(loaded!.metrics.width).toBe(added.metrics.width);
    expect(loaded!.metrics.quality).toBe(added.metrics.quality);
    expect(loaded!.provenance.license).toBe('press-kit');
    expect(await fs.readFile(reopened.resolvePath(loaded!))).toBeDefined();
  });

  it('writes atomically — concurrent saves never leave a corrupt or partial manifest', async () => {
    const root = await scratch();
    const lib = await open(root);
    for (let i = 0; i < 5; i++) await seed(lib, { playerId: `p${i}` }, { pattern: i % 2 ? 'waves' : 'waves-alt', width: 200 + i * 10 });

    await Promise.all(Array.from({ length: 12 }, () => lib.save()));

    const raw = await fs.readFile(path.join(root, MANIFEST_FILENAME), 'utf8');
    const parsed = JSON.parse(raw) as AssetManifest;
    expect(parsed.assets).toHaveLength(5);
    expect(raw.endsWith('\n')).toBe(true);

    // No temp files survive a successful save.
    const leftovers = (await fs.readdir(root)).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('keeps the manifest sorted by id so diffs show real changes', async () => {
    const root = await scratch();
    const lib = await open(root);
    await seed(lib, { playerId: 'zeus' }, { pattern: 'waves' });
    await seed(lib, { playerId: 'apple' }, { pattern: 'waves-alt' });
    const parsed = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILENAME), 'utf8')) as AssetManifest;
    expect(parsed.assets.map((a) => a.id)).toEqual([...parsed.assets.map((a) => a.id)].sort());
  });

  it('starts fresh (and warns) when the manifest is corrupt, keeping a copy of the wreckage', async () => {
    const root = await scratch();
    await fs.writeFile(path.join(root, MANIFEST_FILENAME), '{"version": 1, "assets": [ THIS IS NOT JSON');

    const { logger, lines } = recordingLogger();
    const lib = new AssetLibrary(root, { logger });
    await lib.load();

    expect(lib.all()).toEqual([]);
    expect(lines.some((l) => l.level === 'warn' && /corrupt/i.test(l.msg))).toBe(true);
    const files = await fs.readdir(root);
    expect(files.some((f) => f.includes('corrupt'))).toBe(true);
  });

  it('starts fresh when the manifest is valid JSON of the wrong shape', async () => {
    const root = await scratch();
    await fs.writeFile(path.join(root, MANIFEST_FILENAME), '{"nope": true}');
    const { logger, lines } = recordingLogger();
    const lib = new AssetLibrary(root, { logger });
    await lib.load();
    expect(lib.all()).toEqual([]);
    expect(lines.some((l) => l.level === 'warn')).toBe(true);
  });

  it('drops malformed entries instead of failing the whole load, and fails licences closed', async () => {
    const root = await scratch();
    await fs.writeFile(
      path.join(root, MANIFEST_FILENAME),
      JSON.stringify({
        version: 1,
        updatedAt: '2025-01-01T00:00:00Z',
        root,
        assets: [
          { id: 'good', kind: 'portrait', path: 'a.png', metrics: {}, provenance: { source: 'x', license: 'cc-by', cleared: 'yes' }, tags: [] },
          { kind: 'portrait', path: 'b.png' },
          null,
          'nonsense',
        ],
      }),
    );

    const { logger, lines } = recordingLogger();
    const lib = new AssetLibrary(root, { logger });
    await lib.load();

    expect(lib.all().map((a) => a.id)).toEqual(['good']);
    // `cleared: 'yes'` is not `true`: an unparseable clearance is not a clearance.
    expect(lib.get('good')!.provenance.cleared).toBe(false);
    expect(lines.some((l) => l.level === 'warn' && /malformed/i.test(l.msg))).toBe(true);
  });

  it('treats a missing manifest as an empty library without writing one', async () => {
    const root = await scratch();
    const lib = new AssetLibrary(root, { logger: recordingLogger().logger });
    await lib.load();
    expect(lib.all()).toEqual([]);
    await expect(fs.access(path.join(root, MANIFEST_FILENAME))).rejects.toBeTruthy();
  });
});

describe('add', () => {
  it('copies external files into a subject-shaped layout', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib, { playerId: 'peyz', kind: 'portrait' });

    expect(asset.path).toMatch(/^players\/peyz\/portrait\/.*\.png$/);
    expect(lib.resolvePath(asset)).toBe(path.join(root, asset.path));
    await expect(fs.access(lib.resolvePath(asset))).resolves.toBeUndefined();
  });

  it('references files already inside the root without copying them', async () => {
    const root = await scratch();
    const lib = await open(root);
    const inside = await writeTestImage(path.join(root, 'incoming', 'a.png'));
    const asset = await lib.add({ path: inside, kind: 'portrait', playerId: 'peyz', provenance: testProvenance() });
    expect(asset.path).toBe('incoming/a.png');
  });

  it('refuses copy:false for a file outside the root', async () => {
    const root = await scratch();
    const lib = await open(root);
    const outside = await writeTestImage(path.join(await scratch(), 'a.png'));
    await expect(
      lib.add({ path: outside, kind: 'portrait', provenance: testProvenance(), copy: false }),
    ).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'IO_ERROR');
  });

  it('is idempotent: the same file for the same subject and kind keeps one id', async () => {
    const root = await scratch();
    const lib = await open(root);
    const src = await writeTestImage(path.join(await scratch(), 'a.png'));
    const first = await lib.add({ path: src, kind: 'portrait', playerId: 'peyz', provenance: testProvenance() });
    const second = await lib.add({ path: src, kind: 'portrait', playerId: 'peyz', provenance: testProvenance() });
    expect(second.id).toBe(first.id);
    expect(lib.all()).toHaveLength(1);
  });

  it('computes real metrics and a perceptual hash', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib, {}, { width: 512, height: 384, pattern: 'checker' });
    expect(asset.metrics.width).toBe(512);
    expect(asset.metrics.height).toBe(384);
    expect(asset.metrics.sharpness).toBeGreaterThan(0);
    expect(asset.metrics.contrast).toBeGreaterThan(0);
    expect(asset.metrics.quality).toBeGreaterThan(0);
    expect(asset.phash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('demands provenance and a kind', async () => {
    const root = await scratch();
    const lib = await open(root);
    const src = await writeTestImage(path.join(await scratch(), 'a.png'));
    await expect(
      lib.add({ path: src, kind: 'portrait', provenance: { source: '', license: 'cc-by', addedAt: '', cleared: false } }),
    ).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'INVALID_REQUEST');
    await expect(
      lib.add({ path: src, kind: undefined as never, provenance: testProvenance() }),
    ).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'INVALID_REQUEST');
    await expect(
      lib.add({ path: path.join(root, 'ghost.png'), kind: 'portrait', provenance: testProvenance() }),
    ).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'IO_ERROR');
  });
});

describe('update — the enrichment second pass', () => {
  it('deep-merges vision metrics over ingest metrics and recomputes quality', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib, { playerId: 'peyz' }, { width: 1600, height: 2400, pattern: 'waves' });
    const before = asset.metrics.quality;

    const enriched = await lib.update(asset.id, {
      metrics: {
        faceBox: { x: 600, y: 400, w: 700, h: 900, confidence: 0.97 },
        faceArea: 0.22,
        yaw: 4,
        pitch: -2,
        occlusion: 0,
      } as ReferenceAsset['metrics'],
      embedding: [0.1, 0.2],
      embeddingModel: 'buffalo_l',
    });

    // Ingest measurements survive untouched…
    expect(enriched.metrics.width).toBe(1600);
    expect(enriched.metrics.sharpness).toBe(asset.metrics.sharpness);
    // …the vision fields land…
    expect(enriched.metrics.faceBox!.confidence).toBe(0.97);
    expect(enriched.embeddingModel).toBe('buffalo_l');
    // …and quality is recomputed from the merged picture.
    expect(enriched.metrics.quality).not.toBe(before);
    expect((await open(root)).get(asset.id)!.metrics.faceBox).toBeDefined();
  });

  it('honours an explicitly pinned quality', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib);
    const pinned = await lib.update(asset.id, { metrics: { ...asset.metrics, quality: 99 } });
    expect(pinned.metrics.quality).toBe(99);
  });

  it('merges provenance, so clearing a licence does not erase the source', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib, { provenance: testProvenance({ cleared: false, license: 'unverified' }) });
    const cleared = await lib.update(asset.id, { provenance: { ...asset.provenance, license: 'cc-by', cleared: true } });
    expect(cleared.provenance.source).toBe(asset.provenance.source);
    expect(cleared.provenance.cleared).toBe(true);
  });

  it('rejects unknown ids, id changes, and paths that escape the root', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib);

    await expect(lib.update('nope', {})).rejects.toSatisfy((e: unknown) => isHexaError(e) && e.code === 'ASSET_NOT_FOUND');
    await expect(lib.update(asset.id, { id: 'other' })).rejects.toSatisfy(
      (e: unknown) => isHexaError(e) && e.code === 'INVALID_REQUEST',
    );
    await expect(lib.update(asset.id, { path: '../../etc/passwd' })).rejects.toSatisfy(
      (e: unknown) => isHexaError(e) && e.code === 'IO_ERROR',
    );
    await expect(lib.update(asset.id, { cutoutPath: '../../../evil.png' })).rejects.toSatisfy(
      (e: unknown) => isHexaError(e) && e.code === 'IO_ERROR',
    );
  });
});

describe('remove', () => {
  it('drops the index entry but never the licensed file', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib);
    const file = lib.resolvePath(asset);

    expect(await lib.remove(asset.id)).toBe(true);
    expect(lib.get(asset.id)).toBeUndefined();
    expect(await lib.remove(asset.id)).toBe(false);
    await expect(fs.access(file)).resolves.toBeUndefined();
    expect((await open(root)).all()).toEqual([]);
  });
});

describe('resolvePath', () => {
  it('rejects a hand-edited manifest that points outside the library', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib);

    // Simulate a tampered manifest: mutate the record the library handed back.
    const tampered: ReferenceAsset = { ...asset, path: '../../../etc/passwd' };
    expect(() => lib.resolvePath(tampered)).toThrowError(/escapes the library root/);
    try {
      lib.resolvePath(tampered);
    } catch (err) {
      expect(isHexaError(err) && err.code).toBe('IO_ERROR');
    }
  });

  it('also resolves a bare library-relative string, with the same containment check', async () => {
    const root = await scratch();
    const lib = await open(root);
    expect(lib.resolvePath('cutouts/a.png')).toBe(path.join(root, 'cutouts/a.png'));
    expect(() => lib.resolvePath('../../etc/passwd')).toThrowError(/escapes the library root/);
  });

  it('reports a missing cutout as ASSET_NOT_FOUND', async () => {
    const root = await scratch();
    const lib = await open(root);
    const asset = await seed(lib);
    try {
      lib.resolvePath(asset, 'cutout');
      throw new Error('should have thrown');
    } catch (err) {
      expect(isHexaError(err) && err.code).toBe('ASSET_NOT_FOUND');
    }
    const withCutout = await lib.update(asset.id, { cutoutPath: 'cutouts/a.png' });
    expect(lib.resolvePath(withCutout, 'cutout')).toBe(path.join(root, 'cutouts/a.png'));
  });
});

describe('find / best', () => {
  async function populated() {
    const root = await scratch();
    const lib = await open(root);
    const peyzPortrait = await seed(lib, { playerId: 'peyz', kind: 'portrait' }, { width: 1600, height: 2000, pattern: 'checker' });
    const peyzAction = await seed(lib, { playerId: 'peyz', kind: 'action' }, { width: 900, height: 600, pattern: 'waves', blur: 4 });
    const zeusPortrait = await seed(
      lib,
      { playerId: 'zeus', kind: 'portrait', teamId: 'T1', provenance: testProvenance({ cleared: false, license: 'unverified' }) },
      { width: 1200, height: 1600, pattern: 'waves-alt' },
    );
    return { root, lib, peyzPortrait, peyzAction, zeusPortrait };
  }

  it('filters by player, team and kind', async () => {
    const { lib, peyzPortrait, peyzAction, zeusPortrait } = await populated();
    expect(lib.find({ playerId: 'peyz' }).map((a) => a.id).sort()).toEqual([peyzAction.id, peyzPortrait.id].sort());
    expect(lib.find({ kind: 'portrait' }).map((a) => a.id).sort()).toEqual([peyzPortrait.id, zeusPortrait.id].sort());
    expect(lib.find({ kind: ['action', 'portrait'] })).toHaveLength(3);
    expect(lib.find({ teamId: 'T1' }).map((a) => a.id)).toEqual([zeusPortrait.id]);
    expect(lib.find({ playerId: 'nobody' })).toEqual([]);
  });

  it('gates on licence when a publish-grade render asks for cleared assets only', async () => {
    const { lib, zeusPortrait } = await populated();
    expect(lib.find({ playerId: 'zeus' }).map((a) => a.id)).toEqual([zeusPortrait.id]);
    expect(lib.find({ playerId: 'zeus', requireCleared: true })).toEqual([]);
    expect(lib.best({ playerId: 'zeus', requireCleared: true })).toBeUndefined();
    expect(lib.find({ requireCleared: true }).every((a) => a.provenance.cleared)).toBe(true);
  });

  it('honours minQuality', async () => {
    const { lib } = await populated();
    expect(lib.find({ minQuality: 0 })).toHaveLength(3);
    expect(lib.find({ minQuality: 101 })).toEqual([]);
  });

  it('ranks best-first and best() returns the head of find()', async () => {
    const { lib } = await populated();
    const found = lib.find({ playerId: 'peyz' });
    expect(lib.best({ playerId: 'peyz' })!.id).toBe(found[0]!.id);
  });

  it('never hard-filters on facing — a mirrorable asset stays available', async () => {
    const { lib, peyzPortrait } = await populated();
    await lib.update(peyzPortrait.id, { metrics: { ...peyzPortrait.metrics, yaw: -40 } });
    const wrongWay = lib.find({ playerId: 'peyz', kind: 'portrait', facing: 'right' });
    expect(wrongWay.map((a) => a.id)).toContain(peyzPortrait.id);
  });
});

describe('stats / coverage', () => {
  it('summarises the library and counts publish-grade assets', async () => {
    const root = await scratch();
    const lib = await open(root);
    await seed(lib, { playerId: 'peyz', kind: 'portrait' }, { pattern: 'waves' });
    await seed(lib, { playerId: 'peyz', kind: 'action' }, { pattern: 'waves-alt' });
    await seed(lib, { teamId: 'hle', kind: 'logo', provenance: testProvenance({ cleared: false }) }, { pattern: 'checker' });

    const stats = lib.stats();
    expect(stats.total).toBe(3);
    expect(stats.byPlayer).toEqual({ peyz: 2 });
    expect(stats.byKind.portrait).toBe(1);
    expect(stats.byKind.logo).toBe(1);
    expect(stats.byKind.backplate).toBe(0);
    expect(stats.cleared).toBe(2);
    expect(stats.uncleared).toBe(1);
  });

  it('reports per-player gaps a producer can act on', async () => {
    const root = await scratch();
    const lib = await open(root);
    await seed(lib, { playerId: 'peyz', kind: 'portrait' }, { width: 1800, height: 2400, pattern: 'checker' });
    await seed(
      lib,
      { playerId: 'zeus', kind: 'portrait', provenance: testProvenance({ cleared: false, license: 'unverified' }) },
      { width: 400, height: 300, pattern: 'flat', level: 128 },
    );

    const [peyz, zeus, ghost] = lib.coverage(['peyz', 'zeus', 'ghost']);

    expect(peyz!.count).toBe(1);
    expect(peyz!.cleared).toBe(1);
    expect(peyz!.bestQuality).toBeGreaterThan(0);
    expect(peyz!.gaps).toContain('missing-kind:action');
    expect(peyz!.gaps).toContain('no-cutout');

    expect(zeus!.cleared).toBe(0);
    expect(zeus!.gaps).toContain('no-cleared-licence');
    expect(zeus!.gaps).toContain('low-quality');

    expect(ghost!.count).toBe(0);
    expect(ghost!.gaps).toEqual(['no-assets']);
  });

  it('covers every player it knows about when asked for no one in particular', async () => {
    const root = await scratch();
    const lib = await open(root);
    await seed(lib, { playerId: 'zeus' }, { pattern: 'waves' });
    await seed(lib, { playerId: 'peyz' }, { pattern: 'waves-alt' });
    await seed(lib, { teamId: 'hle', kind: 'logo' }, { pattern: 'checker' });

    expect(lib.coverage().map((c) => c.playerId)).toEqual(['peyz', 'zeus']);
  });
});

describe('batch', () => {
  it('writes the manifest once for a burst of additions', async () => {
    const root = await scratch();
    const lib = await open(root);
    const before = (await fs.stat(path.join(root, MANIFEST_FILENAME))).mtimeMs;

    await lib.batch(async () => {
      for (let i = 0; i < 4; i++) await seed(lib, { playerId: `p${i}` }, { width: 200 + i * 8, pattern: 'waves' });
      // Nothing is on disk yet — the batch defers the write.
      const mid = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILENAME), 'utf8')) as AssetManifest;
      expect(mid.assets).toHaveLength(0);
      expect((await fs.stat(path.join(root, MANIFEST_FILENAME))).mtimeMs).toBe(before);
    });

    const after = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILENAME), 'utf8')) as AssetManifest;
    expect(after.assets).toHaveLength(4);
  });
});

describe('placeholders keep the pipeline runnable with no photographs', () => {
  it('registers a synthetic, cleared, clearly-tagged stand-in', async () => {
    const root = await scratch();
    const lib = await open(root);

    expect(lib.best({ playerId: 'peyz', requireCleared: true })).toBeUndefined();

    const stand = await ensurePlaceholderAsset(lib, { playerId: 'peyz', kind: 'portrait', accent: '#FF6B1A', label: 'Peyz' });
    expect(stand.tags).toContain('placeholder');
    expect(stand.provenance.cleared).toBe(true);
    expect(stand.provenance.license).toBe('owned');
    expect(stand.metrics.width).toBeGreaterThan(0);

    // A publish-grade query now resolves — the pipeline can run end to end.
    expect(lib.best({ playerId: 'peyz', requireCleared: true })!.id).toBe(stand.id);
    await expect(fs.access(lib.resolvePath(stand))).resolves.toBeUndefined();

    // Idempotent: asking again reuses the same stand-in.
    expect((await ensurePlaceholderAsset(lib, { playerId: 'peyz', kind: 'portrait' })).id).toBe(stand.id);
    expect(lib.all()).toHaveLength(1);
  });
});
