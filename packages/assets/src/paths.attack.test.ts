/**
 * Hostile-input tests for library path containment.
 *
 * `paths.test.ts` covers the shapes a *mistake* produces. This file covers the
 * shapes an *attacker* produces, and the distinction that matters between them
 * is the filesystem: `resolveInRoot` is lexical and never touches the disk,
 * which makes it fast and usable for paths that do not exist yet — but it also
 * means a symlink inside the root resolves to a perfectly contained-looking
 * string that points anywhere on the machine. A manifest is a plain JSON file a
 * downloaded library ships with, so both halves have to hold.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHexaError } from '@hexa/core';
import { isInside, resolveInRoot, resolveInRootReal, slugify, toRelative } from './paths.js';

const ROOT = '/var/lib/hexa/assets';

async function expectHexaAsync(fn: () => Promise<unknown>, code: string): Promise<Error & { code: string }> {
  try {
    await fn();
  } catch (err) {
    expect(isHexaError(err)).toBe(true);
    expect(isHexaError(err) && err.code).toBe(code);
    return err as Error & { code: string };
  }
  throw new Error(`expected a HexaError(${code})`);
}

function expectHexa(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(isHexaError(err) && err.code).toBe(code);
    return;
  }
  throw new Error(`expected a HexaError(${code})`);
}

describe('resolveInRoot — lexical containment against hostile manifests', () => {
  it.each([
    ['plain traversal', '../../etc/passwd'],
    ['traversal after a decoy segment', 'players/peyz/../../../../etc/passwd'],
    ['absolute escape', '/etc/passwd'],
    ['absolute escape with traversal', '/var/lib/hexa/assets/../../../etc/passwd'],
    ['home-relative', '~/../../etc/passwd'],
    ['trailing traversal', 'a/b/c/../../../../..'],
  ])('rejects %s', (_label, evil) => {
    expectHexa(() => resolveInRoot(ROOT, evil), 'IO_ERROR');
  });

  it('rejects a NUL byte before it can truncate the path at the syscall layer', () => {
    expectHexa(() => resolveInRoot(ROOT, 'ok.png\0/../../etc/passwd'), 'IO_ERROR');
    expectHexa(() => resolveInRoot(ROOT, '\0'), 'IO_ERROR');
  });

  it('treats percent-encoded traversal as a literal filename, never as traversal', () => {
    // Nothing in this package URL-decodes, so `..%2f` must stay one weird
    // filename inside the root rather than becoming `../`.
    const resolved = resolveInRoot(ROOT, '..%2f..%2fetc%2fpasswd');
    expect(resolved.startsWith(ROOT + path.sep)).toBe(true);
    expect(resolved).not.toContain('/etc/passwd');
  });

  it('treats a Windows-style separator as a literal character on POSIX', () => {
    // On POSIX `..\..\etc` is a filename, not a path. It must stay inside the
    // root; on Win32 `path.resolve` splits it and the containment check catches it.
    const resolved = resolveInRoot(ROOT, '..\\..\\etc\\passwd');
    expect(isInside(ROOT, resolved)).toBe(true);
  });

  it('refuses a prefix sibling of the root — /root-evil must not count as inside /root', () => {
    expect(isInside('/var/lib/hexa/assets', '/var/lib/hexa/assets-evil/x.png')).toBe(false);
    expect(isInside('/var/lib/hexa/assets', '/var/lib/hexa/assetsevil')).toBe(false);
    expectHexa(() => toRelative('/var/lib/hexa/assets', '/var/lib/hexa/assets-evil/x.png'), 'IO_ERROR');
  });

  it('survives pathological nesting without blowing the stack', () => {
    const deep = Array.from({ length: 5_000 }, (_, i) => `d${i}`).join('/');
    expect(resolveInRoot(ROOT, deep).startsWith(ROOT + path.sep)).toBe(true);
    // The same depth in reverse must still be caught once it walks past the root.
    expectHexa(() => resolveInRoot(ROOT, `${deep}/${'../'.repeat(6_000)}etc/passwd`), 'IO_ERROR');
  });

  it('rejects non-string paths from a hand-edited manifest', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expectHexa(() => resolveInRoot(ROOT, bad as unknown as string), 'IO_ERROR');
    }
  });

  it('slugify never produces a path separator, a traversal or a NUL', () => {
    for (const evil of ['../../etc/passwd', '..\\..\\windows', 'a\0b', '////', '..', '.', '~/.ssh/id_rsa']) {
      const slug = slugify(evil, 'asset');
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug).not.toContain('..');
    }
  });
});

describe('resolveInRootReal — symlink containment', () => {
  let root: string;
  let outside: string;

  beforeAll(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hexa-paths-'));
    root = path.join(base, 'library');
    outside = path.join(base, 'outside');
    await fs.mkdir(path.join(root, 'players'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });

    await fs.writeFile(path.join(outside, 'secret.png'), 'NOT-AN-IMAGE-BUT-SECRET');
    await fs.writeFile(path.join(root, 'real.png'), 'inside');

    // The attack: a symlink that lives inside the root and points out of it.
    await fs.symlink(path.join(outside, 'secret.png'), path.join(root, 'escape.png'));
    // …and the directory form, which hides the escape one level up.
    await fs.symlink(outside, path.join(root, 'players', 'linked'));
    // A dangling link: resolution must fail cleanly, not throw a raw ENOENT.
    await fs.symlink(path.join(outside, 'gone.png'), path.join(root, 'dangling.png'));
  });

  afterAll(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true }).catch(() => {});
  });

  it('resolves an ordinary file inside the root', async () => {
    await expect(resolveInRootReal(root, 'real.png')).resolves.toBe(path.join(root, 'real.png'));
  });

  it('the lexical check alone is fooled by a symlink — this is why the real check exists', () => {
    // Documents the gap rather than asserting it is fine: resolveInRoot says
    // yes, because lexically the path really is inside the root.
    expect(resolveInRoot(root, 'escape.png')).toBe(path.join(root, 'escape.png'));
  });

  it('refuses a file symlink that points outside the root', async () => {
    const err = await expectHexaAsync(() => resolveInRootReal(root, 'escape.png'), 'IO_ERROR');
    expect(err.message).toMatch(/symlink|escapes/i);
  });

  it('refuses a path that traverses a directory symlink pointing outside the root', async () => {
    await expectHexaAsync(() => resolveInRootReal(root, 'players/linked/secret.png'), 'IO_ERROR');
  });

  it('reports a dangling symlink as a clean IO_ERROR, not a raw ENOENT', async () => {
    const err = await expectHexaAsync(() => resolveInRootReal(root, 'dangling.png'), 'IO_ERROR');
    expect(err.message).not.toContain('ENOENT');
  });

  it('still allows a path that does not exist yet, when its parent is contained', async () => {
    // Cutouts are resolved before they are written, so a missing leaf is normal.
    await expect(resolveInRootReal(root, 'players/new-cutout.png')).resolves.toBe(
      path.join(root, 'players', 'new-cutout.png'),
    );
  });

  it('rejects a not-yet-existing file whose parent directory escapes via a symlink', async () => {
    await expectHexaAsync(() => resolveInRootReal(root, 'players/linked/new.png'), 'IO_ERROR');
  });

  it('applies the lexical check first, so traversal never reaches the filesystem', async () => {
    await expectHexaAsync(() => resolveInRootReal(root, '../../etc/passwd'), 'IO_ERROR');
  });
});
