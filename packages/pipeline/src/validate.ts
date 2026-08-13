/**
 * Request validation and normalisation.
 *
 * A ThumbnailRequest arrives from a CLI flag soup, a JSON file or an HTTP body,
 * so it is checked once, here, and every stage downstream can assume a
 * well-formed request with defaults applied. Errors are `INVALID_REQUEST` and
 * always carry a `hint` naming the fix — the CLI prints the hint, so a bad flag
 * should read like advice, not a stack trace.
 *
 * Pure: no I/O, no roster lookups. Whether a *player* exists is the resolve
 * stage's business; whether the request is *shaped* right is this file's.
 */

import { HexaError, hashString } from '@hexa/core';
import type {
  AspectPreset,
  BackgroundRequest,
  OutputRequest,
  QaRequest,
  SubjectRequest,
  TextRole,
  ThumbnailRequest,
} from '@hexa/core';

export const ASPECTS: readonly AspectPreset[] = [
  'youtube', 'youtube-hd', 'shorts', 'twitch', 'square', 'twitter', 'banner',
];

export const TEXT_ROLES: readonly TextRole[] = [
  'headline', 'subhead', 'kicker', 'vs', 'left-name', 'right-name',
  'left-team', 'right-team', 'badge', 'stat', 'caption', 'rank', 'date',
];

export const OUTPUT_FORMATS: readonly NonNullable<OutputRequest['format']>[] = ['png', 'jpeg', 'webp', 'avif'];

export const BACKGROUND_MODES: readonly BackgroundRequest['mode'][] = ['auto', 'ai', 'file', 'color', 'gradient', 'none'];

export const SIDES: readonly NonNullable<SubjectRequest['side']>[] = ['left', 'right', 'center'];

/** Beyond this a layout has nowhere to put anyone; 5v5 is the real ceiling. */
export const MAX_SUBJECTS = 12;
/** Variants are rendered serially per job; more than this is a batch, not a job. */
export const MAX_VARIANTS = 24;

/** A request with every optional field resolved to a concrete value. */
export interface NormalisedRequest extends ThumbnailRequest {
  aspect: AspectPreset;
  variants: number;
  seed: number;
  subjects: Required<Pick<SubjectRequest, 'player'>>[] & SubjectRequest[];
  output: OutputRequest & { format: NonNullable<OutputRequest['format']>; quality: number; name: string };
  qa: Required<Pick<QaRequest, 'legibility' | 'safeZones' | 'strict' | 'requireClearedLicense'>> & QaRequest;
}

/**
 * Validate and fill in defaults.
 *
 * @throws HexaError `INVALID_REQUEST` — with `details.field` naming the offender.
 */
export function validateRequest(req: ThumbnailRequest): NormalisedRequest {
  if (!req || typeof req !== 'object') {
    throw invalid('request', 'The request must be an object', 'See `hexa make --help` for the flag form, or pass --file with a JSON/YAML request.');
  }

  const templateId = str(req.templateId);
  if (!templateId) {
    throw invalid('templateId', 'No template specified', 'Run `hexa templates` to list ids, then pass --template <id>.');
  }

  const subjects = validateSubjects(req.subjects);
  const aspect = validateAspect(req.aspect);
  const text = validateText(req.text);
  const output = validateOutput(req.output);
  const background = validateBackground(req.background);
  const variants = validateVariants(req.variants);
  const qa = validateQa(req.qa);
  const palette = validatePalette(req.palette);

  // A request with no seed still has to be reproducible: derive one from the
  // content so re-running the same command twice yields the same thumbnail.
  // A clock-based default would make every render un-reproducible by default,
  // which quietly breaks caching, diffing and bug reports.
  const seed = req.seed !== undefined ? validateSeed(req.seed) : derivedSeed(templateId, subjects, text);

  return {
    ...req,
    templateId,
    subjects,
    text,
    aspect,
    variants,
    seed,
    output,
    qa,
    ...(background ? { background } : {}),
    ...(palette ? { palette } : {}),
  } as NormalisedRequest;
}

function validateSubjects(subjects: unknown): SubjectRequest[] {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    throw invalid('subjects', 'A thumbnail needs at least one subject', 'Pass players positionally (`hexa gen Peyz Viper`) or with --subject <player>.');
  }
  if (subjects.length > MAX_SUBJECTS) {
    throw invalid('subjects', `Too many subjects (${subjects.length}); the maximum is ${MAX_SUBJECTS}`, 'Split this into several thumbnails, or use a roster template that groups players.');
  }

  return subjects.map((raw, i) => {
    const s = (raw ?? {}) as SubjectRequest;
    const player = str(s.player);
    if (!player) {
      throw invalid(`subjects[${i}].player`, `Subject ${i + 1} has no player`, 'Each subject needs a handle, id or alias — run `hexa players` to search the roster.');
    }
    if (s.side !== undefined && !SIDES.includes(s.side)) {
      throw invalid(`subjects[${i}].side`, `Unknown side "${String(s.side)}"`, `Use one of: ${SIDES.join(', ')}.`);
    }
    if (s.accent !== undefined && !isHex(s.accent)) {
      throw invalid(`subjects[${i}].accent`, `"${String(s.accent)}" is not a hex colour`, 'Use #RRGGBB, e.g. #E8433B.');
    }
    return {
      ...s,
      player,
      // Two subjects with no stated side are a versus by convention: first is
      // left, second is right. Beyond two, sides come from the layout.
      side: s.side ?? defaultSide(i, subjects.length),
    };
  });
}

function defaultSide(index: number, total: number): SubjectRequest['side'] {
  if (total === 1) return 'center';
  if (total === 2) return index === 0 ? 'left' : 'right';
  return index < total / 2 ? 'left' : 'right';
}

function validateAspect(aspect: unknown): AspectPreset {
  if (aspect === undefined) return 'youtube';
  if (typeof aspect !== 'string' || !ASPECTS.includes(aspect as AspectPreset)) {
    throw invalid('aspect', `Unknown aspect "${String(aspect)}"`, `Use one of: ${ASPECTS.join(', ')}.`);
  }
  return aspect as AspectPreset;
}

function validateText(text: unknown): Partial<Record<TextRole, string>> {
  if (text === undefined || text === null) return {};
  if (typeof text !== 'object' || Array.isArray(text)) {
    throw invalid('text', 'text must be a map of role → string', `Valid roles: ${TEXT_ROLES.join(', ')}.`);
  }
  const out: Partial<Record<TextRole, string>> = {};
  for (const [role, value] of Object.entries(text as Record<string, unknown>)) {
    if (!TEXT_ROLES.includes(role as TextRole)) {
      throw invalid(`text.${role}`, `Unknown text role "${role}"`, `Valid roles: ${TEXT_ROLES.join(', ')}.`);
    }
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw invalid(`text.${role}`, `text.${role} must be a string`, 'Quote the value, e.g. --title "RIVALS".');
    }
    const trimmed = value.trim();
    if (trimmed) out[role as TextRole] = trimmed;
  }
  return out;
}

function validateOutput(output: unknown): NormalisedRequest['output'] {
  const o = (output ?? {}) as OutputRequest;
  const dir = str(o.dir);
  if (!dir) {
    throw invalid('output.dir', 'No output directory', 'Pass --out <dir>, e.g. --out ./out.');
  }
  const format = o.format ?? 'png';
  if (!OUTPUT_FORMATS.includes(format)) {
    throw invalid('output.format', `Unknown format "${String(o.format)}"`, `Use one of: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  const quality = o.quality ?? (format === 'png' ? 100 : 92);
  if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
    throw invalid('output.quality', `Quality must be 1–100 (got ${String(o.quality)})`, 'Try --quality 92.');
  }
  const name = str(o.name) ?? 'thumbnail';
  if (/[\\/\0]/.test(name)) {
    throw invalid('output.name', `"${name}" is not a valid basename`, 'Use a filename without slashes; set the directory with --out.');
  }
  return { ...o, dir, format, quality, name };
}

function validateBackground(background: unknown): BackgroundRequest | undefined {
  if (background === undefined || background === null) return undefined;
  const b = background as BackgroundRequest;
  if (!BACKGROUND_MODES.includes(b.mode)) {
    throw invalid('background.mode', `Unknown background mode "${String(b.mode)}"`, `Use one of: ${BACKGROUND_MODES.join(', ')}.`);
  }
  if (b.mode === 'file' && !str(b.path)) {
    throw invalid('background.path', 'background.mode is "file" but no path was given', 'Pass --bg-file <path>, or use --bg auto.');
  }
  if (b.mode === 'color' && !isHex(b.color)) {
    throw invalid('background.color', 'background.mode is "color" but no valid hex colour was given', 'Pass --bg-color "#101018".');
  }
  if (b.mode === 'ai' && !str(b.prompt)) {
    // Not fatal: @hexa/ai derives a prompt from the template and palette.
    return { ...b, prompt: undefined };
  }
  return b;
}

function validateVariants(variants: unknown): number {
  if (variants === undefined) return 1;
  if (!Number.isInteger(variants) || (variants as number) < 1) {
    throw invalid('variants', `variants must be a positive integer (got ${String(variants)})`, 'Try --variants 4.');
  }
  if ((variants as number) > MAX_VARIANTS) {
    throw invalid('variants', `Too many variants (${String(variants)}); the maximum is ${MAX_VARIANTS}`, `Render up to ${MAX_VARIANTS} at a time, or use \`hexa batch\` for bulk work.`);
  }
  return variants as number;
}

function validateSeed(seed: unknown): number {
  if (!Number.isFinite(seed)) {
    throw invalid('seed', `seed must be a number (got ${String(seed)})`, 'Pass --seed 1234, or omit it to derive one from the request.');
  }
  return Math.trunc(seed as number) >>> 0;
}

function validateQa(qa: unknown): NormalisedRequest['qa'] {
  const q = (qa ?? {}) as QaRequest;
  if (q.identityThreshold !== undefined) {
    if (!Number.isFinite(q.identityThreshold) || q.identityThreshold < 0 || q.identityThreshold > 1) {
      throw invalid('qa.identityThreshold', `identityThreshold must be 0–1 (got ${String(q.identityThreshold)})`, 'Cosine similarity is 0–1; 0.35 is the default for buffalo_l.');
    }
  }
  return {
    ...q,
    legibility: q.legibility ?? true,
    safeZones: q.safeZones ?? true,
    strict: q.strict ?? false,
    requireClearedLicense: q.requireClearedLicense ?? false,
  };
}

function validatePalette(palette: unknown): ThumbnailRequest['palette'] | undefined {
  if (palette === undefined || palette === null) return undefined;
  const p = palette as NonNullable<ThumbnailRequest['palette']>;
  for (const key of ['left', 'right', 'accent'] as const) {
    const v = p[key];
    if (v !== undefined && !isHex(v)) {
      throw invalid(`palette.${key}`, `"${String(v)}" is not a hex colour`, 'Use #RRGGBB, e.g. --accent "#F5C542".');
    }
  }
  return p;
}

/**
 * Content-derived seed. Order-sensitive on subjects (swapping sides is a
 * different thumbnail) and on text, but blind to output paths and QA settings —
 * re-rendering to a different folder should not change the picture.
 */
export function derivedSeed(
  templateId: string,
  subjects: readonly SubjectRequest[],
  text: Partial<Record<TextRole, string>>,
): number {
  const parts = [
    templateId,
    ...subjects.map((s) => `${s.player}|${s.side ?? ''}|${s.assetId ?? ''}|${s.accent ?? ''}`),
    ...TEXT_ROLES.filter((r) => text[r] !== undefined).map((r) => `${r}=${text[r]}`),
  ];
  return hashString(parts.join(' '));
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function isHex(v: unknown): boolean {
  return typeof v === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
}

function invalid(field: string, message: string, hint: string): HexaError {
  return new HexaError('INVALID_REQUEST', message, { hint, details: { field } });
}
