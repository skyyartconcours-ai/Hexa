import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isHexaError } from '@hexa/core';
import {
  MANIFEST_FILENAME,
  extensionOf,
  isInside,
  isReservedFile,
  isSupportedImage,
  libraryRelativePath,
  manifestPath,
  normaliseRoot,
  resolveInRoot,
  slugify,
  toRelative,
} from './paths.js';

const ROOT = '/var/lib/hexa/assets';

/** Assert a thrown value is a HexaError with the expected code. */
function expectHexaError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(isHexaError(err)).toBe(true);
    expect(isHexaError(err) && err.code).toBe(code);
    return;
  }
  throw new Error(`expected a HexaError(${code}) to be thrown`);
}

describe('resolveInRoot — path traversal', () => {
  it('resolves ordinary relative paths inside the root', () => {
    expect(resolveInRoot(ROOT, 'players/peyz/portrait/a.png')).toBe(path.join(ROOT, 'players/peyz/portrait/a.png'));
  });

  it('allows traversal that stays inside the root after normalisation', () => {
    expect(resolveInRoot(ROOT, 'players/peyz/../zeus/a.png')).toBe(path.join(ROOT, 'players/zeus/a.png'));
  });

  it.each([
    ['../outside.png'],
    ['../../etc/passwd'],
    ['players/../../../etc/shadow'],
    ['./../../secrets/key.pem'],
  ])('rejects %s with IO_ERROR', (evil) => {
    expectHexaError(() => resolveInRoot(ROOT, evil), 'IO_ERROR');
  });

  it('rejects absolute paths that point outside the root', () => {
    expectHexaError(() => resolveInRoot(ROOT, '/etc/passwd'), 'IO_ERROR');
  });

  it('accepts absolute paths that are already inside the root', () => {
    const inside = path.join(ROOT, 'logos/hle.png');
    expect(resolveInRoot(ROOT, inside)).toBe(inside);
  });

  it('rejects empty paths and embedded NUL bytes', () => {
    expectHexaError(() => resolveInRoot(ROOT, ''), 'IO_ERROR');
    expectHexaError(() => resolveInRoot(ROOT, '   '), 'IO_ERROR');
    expectHexaError(() => resolveInRoot(ROOT, 'ok.png\u0000../../etc/passwd'), 'IO_ERROR');
  });

  it('rejects an empty root', () => {
    expectHexaError(() => normaliseRoot(''), 'IO_ERROR');
  });

  it('names the field in the error message so the operator knows what to fix', () => {
    try {
      resolveInRoot(ROOT, '../evil.png', 'cutoutPath');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('cutoutPath');
    }
  });
});

describe('isInside', () => {
  it('accepts the root itself and its descendants', () => {
    expect(isInside(ROOT, ROOT)).toBe(true);
    expect(isInside(ROOT, path.join(ROOT, 'a/b.png'))).toBe(true);
  });

  it('rejects siblings whose name merely shares a prefix', () => {
    expect(isInside(ROOT, `${ROOT}-evil/a.png`)).toBe(false);
    expect(isInside(ROOT, '/var/lib/hexa/other/a.png')).toBe(false);
  });
});

describe('toRelative', () => {
  it('produces posix-style relative paths', () => {
    expect(toRelative(ROOT, path.join(ROOT, 'players', 'peyz', 'a.png'))).toBe('players/peyz/a.png');
  });

  it('refuses paths outside the root', () => {
    expectHexaError(() => toRelative(ROOT, '/tmp/a.png'), 'IO_ERROR');
  });
});

describe('file classification', () => {
  it('accepts the raster formats ingest understands', () => {
    for (const f of ['a.png', 'a.jpg', 'a.JPEG', 'a.webp', 'a.avif']) expect(isSupportedImage(f)).toBe(true);
    for (const f of ['a.gif', 'a.psd', 'a.txt', 'a.svg', 'noext']) expect(isSupportedImage(f)).toBe(false);
  });

  it('never treats the manifest as artwork', () => {
    expect(isReservedFile(`/x/${MANIFEST_FILENAME}`)).toBe(true);
    expect(isReservedFile('/x/photo.png')).toBe(false);
  });

  it('lowercases extensions', () => {
    expect(extensionOf('/x/A.JPG')).toBe('.jpg');
    expect(extensionOf('/x/noext')).toBe('');
  });

  it('puts the manifest at the root', () => {
    expect(manifestPath(ROOT)).toBe(path.join(ROOT, 'manifest.json'));
  });
});

describe('slugify / libraryRelativePath', () => {
  it('produces filesystem-safe slugs', () => {
    expect(slugify('Hanwha Life Esports')).toBe('hanwha-life-esports');
    expect(slugify('Péyz!!')).toBe('peyz');
    expect(slugify('   ', 'fallback')).toBe('fallback');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });

  it('groups copies by subject and kind', () => {
    expect(libraryRelativePath({ id: 'peyz-portrait-abc', kind: 'portrait', ext: '.JPG', playerId: 'peyz' })).toBe(
      'players/peyz/portrait/peyz-portrait-abc.jpg',
    );
    expect(libraryRelativePath({ id: 'hle-logo-abc', kind: 'logo', ext: 'png', teamId: 'hle' })).toBe(
      'teams/hle/logo/hle-logo-abc.png',
    );
    expect(libraryRelativePath({ id: 'x', kind: 'backplate', ext: '.png' })).toBe('unsorted/backplate/x.png');
  });

  it('cannot be tricked into escaping the library by a hostile id', () => {
    const rel = libraryRelativePath({ id: '../../evil', kind: 'portrait', ext: '.png', playerId: '../../..' });
    expect(() => resolveInRoot(ROOT, rel)).not.toThrow();
    expect(resolveInRoot(ROOT, rel).startsWith(ROOT)).toBe(true);
  });
});
