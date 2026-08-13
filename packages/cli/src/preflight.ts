/**
 * Checks that run *before* the expensive part.
 *
 * A render is thirty seconds of segmentation, compositing and QA. Finding out
 * afterwards that `--out` was never writable is the worst possible ordering:
 * the work is done, the machine is warm, and there is nothing to show for it.
 * Every check here is milliseconds and answers a question whose answer cannot
 * change during the render, so asking first costs nothing and saves the run.
 *
 * The errors are deliberately specific. "Permission denied" is a fact; "that
 * directory belongs to root — write somewhere you own, e.g. --out ./out" is a
 * fix, and a fix is what the operator actually needed.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { HexaError, didYouMean } from '@hexa/core';
import type { ThumbnailTemplate } from '@hexa/core';
import { templates as templatesAdapter } from '@hexa/pipeline/integration';
import { watchOutputDir } from './interrupt.js';

/**
 * Make sure `dir` exists and can actually be written to, then start watching it
 * for the interrupt sweep.
 *
 * @returns the resolved absolute directory
 * @throws HexaError `IO_ERROR`
 */
export async function ensureWritableDir(dir: string, flag = '--out'): Promise<string> {
  const resolved = path.resolve(dir);

  try {
    await fs.mkdir(resolved, { recursive: true });
  } catch (cause) {
    throw new HexaError('IO_ERROR', `Cannot create the output directory ${resolved}`, {
      hint: explainWriteFailure(cause, resolved, flag),
      details: { dir: resolved, syscall: errno(cause) },
      cause,
    });
  }

  // Existence is not permission, and permission bits are not the whole story
  // either (read-only mounts, full disks, an immutable flag). Writing a byte is
  // the only question worth asking, so ask it.
  const probe = path.join(resolved, `.hexa-write-probe-${process.pid}`);
  try {
    await fs.writeFile(probe, 'hexa');
    await fs.rm(probe, { force: true });
  } catch (cause) {
    throw new HexaError('IO_ERROR', `${resolved} exists but nothing can be written into it`, {
      hint: explainWriteFailure(cause, resolved, flag),
      details: { dir: resolved, syscall: errno(cause) },
      cause,
    });
  }

  watchOutputDir(resolved);
  return resolved;
}

/**
 * A directory that must already exist and be readable — an ingest source.
 *
 * @throws HexaError `IO_ERROR`
 */
export async function ensureReadableDir(dir: string, what = 'directory'): Promise<string> {
  const resolved = path.resolve(dir);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (cause) {
    throw new HexaError('IO_ERROR', `No such ${what}: ${resolved}`, {
      hint: `Check the path. It is a positional argument, not a flag: hexa assets ingest ./photos --source "..."`,
      details: { dir: resolved, syscall: errno(cause) },
      cause,
    });
  }

  if (!stat.isDirectory()) {
    throw new HexaError('IO_ERROR', `${resolved} is a file — the ${what} must be a folder`, {
      hint: 'Point it at the folder that holds the images, not at one image.',
      details: { dir: resolved },
    });
  }

  try {
    await fs.readdir(resolved);
  } catch (cause) {
    throw new HexaError('IO_ERROR', `${resolved} cannot be read`, {
      hint: `Check the permissions: ls -ld ${resolved}`,
      details: { dir: resolved, syscall: errno(cause) },
      cause,
    });
  }

  return resolved;
}

/** Turn a filesystem errno into the sentence that fixes it. */
function explainWriteFailure(cause: unknown, dir: string, flag: string): string {
  switch (errno(cause)) {
    case 'EACCES':
    case 'EPERM':
      return `No permission to write there. Choose a directory you own — ${flag} ./out — or create it first: sudo mkdir -p ${dir} && sudo chown "$USER" ${dir}`;
    case 'EROFS':
      return `That filesystem is mounted read-only. Pick a writable location, e.g. ${flag} ./out`;
    case 'ENOTDIR':
      return `Part of that path is a file, so it cannot hold a directory. Check each segment of ${dir}, or use ${flag} ./out`;
    case 'ENOSPC':
      return 'The disk is full. Free some space, or write to another volume.';
    case 'ENAMETOOLONG':
      return `That path is longer than the filesystem allows. Use something shorter, e.g. ${flag} ./out`;
    default:
      return `Pick a directory you can write to, e.g. ${flag} ./out`;
  }
}

function errno(cause: unknown): string | undefined {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Resolve a template id, and fail with real alternatives rather than a shrug.
 *
 * `subjects` is how many players the user actually passed: when the id is a
 * miss, the most useful list is not the whole 33-template library but the ones
 * that would have taken those subjects.
 *
 * @throws HexaError `TEMPLATE_NOT_FOUND`
 */
export async function resolveTemplate(id: string, subjects?: number): Promise<ThumbnailTemplate> {
  const all = await templatesAdapter.listTemplates();
  const found = all.find((t) => t.id === id);
  if (found) return found;

  // A case or separator slip is a match, not a miss.
  const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const loose = all.find((t) => slug(t.id) === slug(id));
  if (loose) return loose;

  const ids = all.map((t) => t.id);
  const near = didYouMean(id, ids, 3);
  const substring = ids.filter((candidate) => slug(candidate).includes(slug(id))).slice(0, 3);
  const suggestions = [...new Set([...near, ...substring])].slice(0, 4);

  const fits = subjects === undefined
    ? []
    : all.filter((t) => subjects >= t.subjects.min && subjects <= t.subjects.max).map((t) => t.id);

  throw new HexaError('TEMPLATE_NOT_FOUND', `No template with id "${id}"`, {
    hint: buildTemplateHint(suggestions, fits, subjects),
    details: { id, suggestions, fitsSubjectCount: fits.slice(0, 12) },
  });
}

function buildTemplateHint(suggestions: string[], fits: string[], subjects?: number): string {
  if (suggestions.length > 0) {
    return `Did you mean: ${suggestions.join(', ')}? Run \`hexa templates\` for all 33.`;
  }
  if (fits.length > 0) {
    const shown = fits.slice(0, 5).join(', ');
    const rest = fits.length > 5 ? `, and ${fits.length - 5} more` : '';
    return `Templates that take ${subjects} subject(s): ${shown}${rest}. See them all with \`hexa templates --subjects ${subjects}\`.`;
  }
  return 'Run `hexa templates` to list the library, or `hexa templates --category versus` to narrow it.';
}

/**
 * The template has to want the number of subjects it was given.
 *
 * The pipeline enforces this too, but only after the dependency set is built and
 * the roster resolved; catching it here makes the message name the templates
 * that *would* have worked.
 *
 * @throws HexaError `INVALID_REQUEST`
 */
export async function ensureSubjectCount(template: ThumbnailTemplate, count: number): Promise<void> {
  const { min, max } = template.subjects;
  if (count >= min && count <= max) return;

  const alternatives = (await templatesAdapter.listTemplates())
    .filter((t) => count >= t.subjects.min && count <= t.subjects.max)
    .map((t) => t.id);

  const wants = min === max ? `exactly ${min}` : `${min}–${max}`;
  const shown = alternatives.slice(0, 4).join(', ');
  const rest = alternatives.length > 4 ? `, and ${alternatives.length - 4} more` : '';

  throw new HexaError('INVALID_REQUEST', `Template "${template.id}" takes ${wants} subject(s), and you gave ${count}`, {
    hint: alternatives.length > 0
      ? `For ${count} subject(s) try: ${shown}${rest} — e.g. --template ${alternatives[0]}. Full list: hexa templates --subjects ${count}`
      : `Nothing in the library takes ${count} subject(s). Run \`hexa templates\` to see the shapes that exist.`,
    details: { templateId: template.id, given: count, wants: template.subjects, alternatives: alternatives.slice(0, 12) },
  });
}

/**
 * Reject blank subject names before they become a confusing lookup failure.
 *
 * @throws HexaError `INVALID_REQUEST`
 */
export function ensureNamedSubjects(names: readonly (string | undefined)[]): void {
  const blankAt = names.findIndex((n) => n === undefined || n.trim() === '');
  if (blankAt === -1) return;

  throw new HexaError('INVALID_REQUEST', `Subject ${blankAt + 1} is an empty name`, {
    hint: 'Pass a handle, id or alias — `hexa gen Peyz Viper`. Run `hexa players` to see the roster, or `hexa players chov` to search it.',
    details: { position: blankAt + 1 },
  });
}
