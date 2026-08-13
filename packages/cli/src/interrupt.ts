/**
 * Ctrl-C safety for anything that writes an image.
 *
 * A render takes tens of seconds and ends in `fs.writeFile(dest, encoded)` — a
 * megabyte or so that libuv splits across several syscalls. Kill the process in
 * the middle of that and the output directory keeps a truncated PNG: a file that
 * exists, has a plausible size, opens as garbage, and gets uploaded anyway
 * because nobody re-checks a file they watched appear.
 *
 * So an interrupt does not exit straight away. It first sweeps the directories a
 * command declared, and unlinks anything created during this run that is
 * provably incomplete. Two properties make that safe:
 *
 *  - Only *new* files are considered. Whatever was on disk before the command
 *    started is never touched, so an interrupt can never delete yesterday's work.
 *  - Only *provably* incomplete files are removed. Every format here is checked
 *    for its terminator (PNG's IEND, JPEG's EOI, RIFF's declared length); a file
 *    that passes is finished and is kept. A format we cannot verify is left
 *    alone unless it is zero bytes.
 *
 * Unlinking a file whose write is still in flight is deliberate and correct: the
 * writer holds the inode open, the remaining bytes land in an unlinked inode,
 * and the directory entry is already gone.
 *
 * Everything here is synchronous. A signal handler that awaits is a signal
 * handler that loses the race with `process.exit`.
 */

import fs from 'node:fs';
import path from 'node:path';

interface Watched {
  dir: string;
  /** Names present before the command started; these are never removed. */
  existing: Set<string>;
}

const watched: Watched[] = [];

/**
 * Declare a directory a command is about to write into.
 *
 * Call it *before* the first write — the snapshot of pre-existing names is what
 * separates "we made this" from "it was already here".
 */
export function watchOutputDir(dir: string): void {
  const resolved = path.resolve(dir);
  if (watched.some((w) => w.dir === resolved)) return;

  let existing: string[] = [];
  try {
    existing = fs.readdirSync(resolved);
  } catch {
    // Not created yet: everything that shows up later is ours.
  }
  watched.push({ dir: resolved, existing: new Set(existing) });
}

/** Forget every watch. Tests use it; the process exits before it would matter. */
export function clearOutputWatches(): void {
  watched.length = 0;
}

/**
 * Remove half-written files from every watched directory.
 *
 * @returns the paths removed, for the message the user sees.
 */
export function sweepPartialOutputs(): string[] {
  const removed: string[] = [];

  for (const { dir, existing } of watched) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of names) {
      if (existing.has(name)) continue;
      const file = path.join(dir, name);
      try {
        if (!fs.statSync(file).isFile()) continue;
        if (isComplete(file)) continue;
        fs.unlinkSync(file);
        removed.push(file);
      } catch {
        // Racing with the writer, or not ours to delete. Leaving the file is the
        // conservative outcome; the message below still tells the user to check.
      }
    }
  }

  return removed;
}

/**
 * Whether a file is a finished artefact.
 *
 * Unknown extensions answer `true` — "I cannot prove this is broken" must never
 * become "delete it".
 */
export function isComplete(file: string): boolean {
  const size = fs.statSync(file).size;
  if (size === 0) return false;

  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.png':
      // 8-byte signature, and an IEND chunk closing the stream.
      return startsWith(file, [0x89, 0x50, 0x4e, 0x47]) && endsWithMarker(file, 'IEND', 12);
    case '.jpg':
    case '.jpeg':
      return startsWith(file, [0xff, 0xd8]) && endsWithBytes(file, [0xff, 0xd9]);
    case '.webp':
      return riffComplete(file, size);
    case '.json':
      return isParseableJson(file);
    default:
      return true;
  }
}

function readHead(file: string, length: number): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function readTail(file: string, length: number): Buffer {
  const size = fs.statSync(file).size;
  const want = Math.min(length, size);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(want);
    const read = fs.readSync(fd, buf, 0, want, size - want);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function startsWith(file: string, bytes: number[]): boolean {
  return readHead(file, bytes.length).equals(Buffer.from(bytes));
}

function endsWithBytes(file: string, bytes: number[]): boolean {
  return readTail(file, bytes.length).equals(Buffer.from(bytes));
}

/** The marker must appear inside the last `window` bytes. */
function endsWithMarker(file: string, marker: string, window: number): boolean {
  return readTail(file, window).includes(marker, 0, 'ascii');
}

/** A RIFF container declares its own length in bytes 4–8. */
function riffComplete(file: string, size: number): boolean {
  const head = readHead(file, 12);
  if (head.length < 12 || head.subarray(0, 4).toString('ascii') !== 'RIFF') return false;
  return head.readUInt32LE(4) + 8 <= size;
}

function isParseableJson(file: string): boolean {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    return true;
  } catch {
    return false;
  }
}
