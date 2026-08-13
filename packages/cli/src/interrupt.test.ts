/**
 * The Ctrl-C sweep.
 *
 * These are the two properties an interrupt has to guarantee, stated as tests
 * because the failure mode is silent: a truncated PNG looks like a finished one
 * in a file listing, and the person who uploads it finds out later than anyone
 * would like.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearOutputWatches, isComplete, sweepPartialOutputs, watchOutputDir } from './interrupt.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A byte-for-byte plausible PNG: signature, one chunk, IEND. */
function completePng(): Buffer {
  const iend = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND', 'ascii'),
    Buffer.from([0xae, 0x42, 0x60, 0x82]),
  ]);
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(2048, 7), iend]);
}

/** The same file, killed mid-write: header and pixels, no terminator. */
function truncatedPng(): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(2048, 7)]);
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexa-interrupt-'));
  clearOutputWatches();
});

afterEach(() => {
  clearOutputWatches();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('isComplete', () => {
  it('accepts a PNG that reached IEND', () => {
    const file = path.join(dir, 'good.png');
    fs.writeFileSync(file, completePng());
    expect(isComplete(file)).toBe(true);
  });

  it('rejects a PNG cut off before IEND', () => {
    const file = path.join(dir, 'bad.png');
    fs.writeFileSync(file, truncatedPng());
    expect(isComplete(file)).toBe(false);
  });

  it('rejects an empty file whatever its extension', () => {
    for (const name of ['empty.png', 'empty.jpg', 'empty.webp', 'empty.tiff']) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.alloc(0));
      expect(isComplete(file), name).toBe(false);
    }
  });

  it('checks JPEG for its end-of-image marker', () => {
    const good = path.join(dir, 'good.jpg');
    fs.writeFileSync(good, Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]));
    expect(isComplete(good)).toBe(true);

    const bad = path.join(dir, 'bad.jpg');
    fs.writeFileSync(bad, Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(64, 1)]));
    expect(isComplete(bad)).toBe(false);
  });

  it('rejects a half-written plan JSON', () => {
    const bad = path.join(dir, 'thumb.plan.json');
    fs.writeFileSync(bad, '{"canvas": {"width": 1280,');
    expect(isComplete(bad)).toBe(false);
  });

  it('leaves formats it cannot verify alone', () => {
    const file = path.join(dir, 'notes.txt');
    fs.writeFileSync(file, 'anything at all');
    expect(isComplete(file)).toBe(true);
  });
});

describe('sweepPartialOutputs', () => {
  it('removes only the incomplete files it saw appear', () => {
    const finished = path.join(dir, 'thumbnail-v01.png');
    const partial = path.join(dir, 'thumbnail-v02.png');

    watchOutputDir(dir);
    fs.writeFileSync(finished, completePng());
    fs.writeFileSync(partial, truncatedPng());

    expect(sweepPartialOutputs()).toEqual([partial]);
    expect(fs.existsSync(finished)).toBe(true);
    expect(fs.existsSync(partial)).toBe(false);
  });

  it('never touches a file that was there before the render started', () => {
    const previous = path.join(dir, 'yesterday.png');
    fs.writeFileSync(previous, truncatedPng());

    watchOutputDir(dir);

    expect(sweepPartialOutputs()).toEqual([]);
    expect(fs.existsSync(previous)).toBe(true);
  });

  it('copes with a directory that was never created', () => {
    watchOutputDir(path.join(dir, 'not-yet'));
    expect(() => sweepPartialOutputs()).not.toThrow();
  });

  it('watches a directory once, however many times it is declared', () => {
    watchOutputDir(dir);
    watchOutputDir(dir);
    fs.writeFileSync(path.join(dir, 'a.png'), truncatedPng());
    expect(sweepPartialOutputs()).toHaveLength(1);
  });

  it('ignores subdirectories', () => {
    watchOutputDir(dir);
    fs.mkdirSync(path.join(dir, 'nested'));
    expect(() => sweepPartialOutputs()).not.toThrow();
    expect(fs.existsSync(path.join(dir, 'nested'))).toBe(true);
  });
});
