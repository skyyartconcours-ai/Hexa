/**
 * The checks that run before an expensive render.
 *
 * Each of these corresponds to a failure a first-time user actually hits, and
 * the assertion is on the *hint* as much as the error: a preflight check that
 * says "IO_ERROR" without saying what to do next has only moved the confusion
 * earlier.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isHexaError } from '@hexa/core';
import { clearOutputWatches } from './interrupt.js';
import {
  ensureNamedSubjects,
  ensureReadableDir,
  ensureSubjectCount,
  ensureWritableDir,
  resolveTemplate,
} from './preflight.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-preflight-'));
  clearOutputWatches();
});

afterEach(() => {
  clearOutputWatches();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Run `fn` and hand back the HexaError it threw. */
async function failure(fn: () => Promise<unknown>): Promise<{ code: string; message: string; hint: string }> {
  try {
    await fn();
  } catch (e) {
    if (!isHexaError(e)) throw e;
    return { code: e.code, message: e.message, hint: e.hint ?? '' };
  }
  throw new Error('expected a HexaError, got success');
}

describe('ensureWritableDir', () => {
  it('creates the directory and returns it absolute', async () => {
    const target = path.join(dir, 'nested', 'out');
    expect(await ensureWritableDir(target)).toBe(path.resolve(target));
    expect(fs.existsSync(target)).toBe(true);
  });

  it('leaves no probe file behind', async () => {
    await ensureWritableDir(dir);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('explains a path whose parent is a file', async () => {
    const file = path.join(dir, 'a-file');
    fs.writeFileSync(file, 'not a directory');

    const { code, hint } = await failure(() => ensureWritableDir(path.join(file, 'deep')));
    expect(code).toBe('IO_ERROR');
    expect(hint).toMatch(/is a file/);
    expect(hint).toMatch(/--out \.\/out/);
  });

  it('names the flag it was given', async () => {
    const file = path.join(dir, 'blocker');
    fs.writeFileSync(file, 'x');
    const { hint } = await failure(() => ensureWritableDir(path.join(file, 'deep'), '--proof'));
    expect(hint).toMatch(/--proof/);
  });
});

describe('ensureReadableDir', () => {
  it('accepts an existing directory', async () => {
    expect(await ensureReadableDir(dir)).toBe(path.resolve(dir));
  });

  it('says what is missing, in terms of the positional argument', async () => {
    const { code, message, hint } = await failure(() => ensureReadableDir(path.join(dir, 'nope'), 'ingest directory'));
    expect(code).toBe('IO_ERROR');
    expect(message).toMatch(/No such ingest directory/);
    // The old message pointed at a `--from` flag this command does not have.
    expect(hint).not.toMatch(/--from/);
    expect(hint).toMatch(/hexa assets ingest/);
  });

  it('distinguishes a file from a directory', async () => {
    const file = path.join(dir, 'photo.png');
    fs.writeFileSync(file, 'x');
    const { message } = await failure(() => ensureReadableDir(file));
    expect(message).toMatch(/is a file — the directory must be a folder/);
  });
});

describe('resolveTemplate', () => {
  it('returns the template for an exact id', async () => {
    expect((await resolveTemplate('versus-classic')).id).toBe('versus-classic');
  });

  it('forgives case and punctuation slips', async () => {
    expect((await resolveTemplate('VersusClassic')).id).toBe('versus-classic');
  });

  it('suggests near misses for a typo', async () => {
    const { code, hint } = await failure(() => resolveTemplate('versus-clasic'));
    expect(code).toBe('TEMPLATE_NOT_FOUND');
    expect(hint).toMatch(/versus-classic/);
  });

  it('lists templates that fit the subject count when nothing is close', async () => {
    const { hint } = await failure(() => resolveTemplate('nope', 2));
    expect(hint).toMatch(/2 subject/);
    expect(hint).toMatch(/versus-classic/);
    expect(hint).toMatch(/hexa templates --subjects 2/);
  });

  it('falls back to the library listing with no subject count to go on', async () => {
    const { hint } = await failure(() => resolveTemplate('nope'));
    expect(hint).toMatch(/hexa templates/);
  });
});

describe('ensureSubjectCount', () => {
  it('passes a template the right number of subjects', async () => {
    const template = await resolveTemplate('versus-classic');
    await expect(ensureSubjectCount(template, 2)).resolves.toBeUndefined();
  });

  it('names templates that would have taken the subjects given', async () => {
    const template = await resolveTemplate('versus-classic');
    const { code, message, hint } = await failure(() => ensureSubjectCount(template, 1));
    expect(code).toBe('INVALID_REQUEST');
    expect(message).toMatch(/takes exactly 2 subject\(s\), and you gave 1/);
    expect(hint).toMatch(/--template /);
    expect(hint).toMatch(/hexa templates --subjects 1/);
  });

  it('accepts anything inside a range', async () => {
    const template = await resolveTemplate('roster-reveal');
    await expect(ensureSubjectCount(template, 4)).resolves.toBeUndefined();
  });
});

describe('ensureNamedSubjects', () => {
  it('accepts real handles', () => {
    expect(() => ensureNamedSubjects(['Peyz', 'Viper'])).not.toThrow();
  });

  it('rejects an empty string and says which position', () => {
    expect(() => ensureNamedSubjects(['Peyz', ''])).toThrow(/Subject 2/);
    expect(() => ensureNamedSubjects(['   '])).toThrow(/Subject 1/);
  });
});
