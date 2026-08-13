/**
 * Loading requests from files.
 *
 * Three shapes are accepted, because all three are things people actually have:
 * a single JSON/YAML request, an array of them, or a CSV where each row is one
 * thumbnail. The CSV path matters most for the batch use case — a season of
 * matchups is a spreadsheet, not a hand-written JSON array.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { HexaError } from '@hexa/core';
import type { ThumbnailRequest } from '@hexa/core';
import { YamlError, parseYaml } from './yaml.js';
import { parseCsv } from './csv.js';

export type RequestFileFormat = 'json' | 'yaml' | 'csv';

export function formatOf(file: string): RequestFileFormat {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  throw new HexaError('INVALID_REQUEST', `Cannot tell what kind of file "${path.basename(file)}" is`, {
    hint: 'Use a .json, .yaml/.yml or .csv extension.',
    details: { file },
  });
}

/** Read and parse, with the parse error pointing at the line that broke. */
export async function readStructured(file: string): Promise<unknown> {
  const resolved = path.resolve(file);
  let text: string;
  try {
    text = await fs.readFile(resolved, 'utf8');
  } catch (cause) {
    throw new HexaError('IO_ERROR', `Cannot read ${resolved}`, {
      hint: 'Check the path exists and is readable.',
      details: { file: resolved },
      cause,
    });
  }

  const format = formatOf(resolved);
  try {
    if (format === 'json') return JSON.parse(text);
    if (format === 'yaml') return parseYaml(text);
    return parseCsv(text, { delimiter: path.extname(resolved).toLowerCase() === '.tsv' ? '\t' : ',' });
  } catch (cause) {
    const detail = cause instanceof YamlError || cause instanceof SyntaxError ? cause.message : String(cause);
    throw new HexaError('INVALID_REQUEST', `Could not parse ${path.basename(resolved)}: ${detail}`, {
      hint: format === 'yaml'
        ? 'This reader supports plain maps, lists and scalars. Anchors, tags and block scalars are not supported — try JSON for anything more elaborate.'
        : 'Check the file is well-formed.',
      details: { file: resolved, format },
      cause,
    });
  }
}

/**
 * Load one or more requests.
 *
 * `defaults` fill in anything a row or document leaves out — which is how a CSV
 * of "left,right,title" turns into complete requests without repeating the
 * template id and output directory on every line.
 */
export async function loadRequests(file: string, defaults: Partial<ThumbnailRequest> = {}): Promise<ThumbnailRequest[]> {
  const parsed = await readStructured(file);
  const format = formatOf(file);

  if (format === 'csv') {
    const rows = parsed as Record<string, string>[];
    if (rows.length === 0) {
      throw new HexaError('INVALID_REQUEST', `${path.basename(file)} has no data rows`, {
        hint: 'The first line is the header. Add at least one row beneath it.',
        details: { file },
      });
    }
    return rows.map((row, i) => fromCsvRow(row, i, defaults, file));
  }

  const documents = Array.isArray(parsed) ? parsed : [parsed];
  if (documents.length === 0) {
    throw new HexaError('INVALID_REQUEST', `${path.basename(file)} contains no requests`, {
      hint: 'Provide a request object, or an array of them.',
      details: { file },
    });
  }

  return documents.map((doc) => {
    if (!doc || typeof doc !== 'object') {
      throw new HexaError('INVALID_REQUEST', `${path.basename(file)} contains a non-object entry`, {
        hint: 'Each entry must be a request object with at least templateId, subjects and output.',
        details: { file },
      });
    }
    return mergeDefaults(doc as Partial<ThumbnailRequest>, defaults);
  });
}

/**
 * CSV column names, deliberately forgiving.
 *
 * A spreadsheet exported by a human says "Left"/"left player"/"player1"; making
 * them all work costs one table and saves a support conversation.
 */
const CSV_ALIASES: Record<string, readonly string[]> = {
  left: ['left', 'left player', 'player1', 'player 1', 'subject1', 'a'],
  right: ['right', 'right player', 'player2', 'player 2', 'subject2', 'b'],
  template: ['template', 'templateid', 'template id'],
  headline: ['headline', 'title', 'text'],
  subhead: ['subhead', 'subtitle'],
  kicker: ['kicker', 'eyebrow'],
  name: ['name', 'output', 'filename', 'basename'],
  aspect: ['aspect', 'format', 'size'],
  variants: ['variants', 'count'],
  seed: ['seed'],
};

function pick(row: Record<string, string>, key: keyof typeof CSV_ALIASES): string | undefined {
  const normalised = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const alias of CSV_ALIASES[key] ?? []) {
    const value = normalised.get(alias);
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function fromCsvRow(
  row: Record<string, string>,
  index: number,
  defaults: Partial<ThumbnailRequest>,
  file: string,
): ThumbnailRequest {
  const left = pick(row, 'left');
  const right = pick(row, 'right');
  if (!left) {
    throw new HexaError('INVALID_REQUEST', `Row ${index + 2} of ${path.basename(file)} has no player`, {
      hint: `Add a "left" column (aliases: ${CSV_ALIASES['left']!.join(', ')}).`,
      details: { file, row: index + 2, columns: Object.keys(row) },
    });
  }

  const subjects = right ? [{ player: left }, { player: right }] : [{ player: left }];
  const text: ThumbnailRequest['text'] = { ...(defaults.text ?? {}) };
  for (const role of ['headline', 'subhead', 'kicker'] as const) {
    const value = pick(row, role);
    if (value) text[role] = value;
  }

  const variants = pick(row, 'variants');
  const seed = pick(row, 'seed');
  const name = pick(row, 'name') ?? defaultName(left, right);

  return mergeDefaults(
    {
      templateId: pick(row, 'template') ?? defaults.templateId ?? '',
      subjects,
      text,
      aspect: (pick(row, 'aspect') as ThumbnailRequest['aspect']) ?? defaults.aspect,
      variants: variants ? Number(variants) : defaults.variants,
      seed: seed ? Number(seed) : defaults.seed,
      output: { ...(defaults.output ?? { dir: './out' }), name },
    },
    defaults,
  );
}

/** `peyz-vs-viper` — a filename you can find again in a folder of 200. */
function defaultName(left: string, right?: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return right ? `${slug(left)}-vs-${slug(right)}` : slug(left);
}

/** Shallow merge with a nested merge for `text` and `output`, request wins. */
function mergeDefaults(request: Partial<ThumbnailRequest>, defaults: Partial<ThumbnailRequest>): ThumbnailRequest {
  return {
    ...defaults,
    ...stripUndefined(request),
    text: { ...(defaults.text ?? {}), ...(request.text ?? {}) },
    output: { dir: './out', ...(defaults.output ?? {}), ...stripUndefined(request.output ?? {}) },
  } as ThumbnailRequest;
}

function stripUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
