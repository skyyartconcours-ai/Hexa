/**
 * `hexa gen` and `hexa make` — the two ways to ask for a thumbnail.
 *
 * `gen` is the headline command and takes the shortest possible path from
 * intent to image: two player names and you have a versus thumbnail. Every other
 * decision has a defensible default, and the defaults are chosen so the first
 * run produces something worth looking at rather than something that needs six
 * more flags.
 *
 * `make` is the same engine with the whole request surface exposed, plus
 * `--file` for a JSON/YAML request. They share `runGeneration` so a flag added
 * to one cannot silently behave differently in the other.
 */

import { Command, Option } from 'commander';
import { HexaError } from '@hexa/core';
import type { AspectPreset, GradeSpec, SubjectRequest, ThumbnailRequest } from '@hexa/core';
import { generateThumbnail } from '@hexa/pipeline';
import { createContext, globalsFrom, type CliContext } from '../context.js';
import { loadRequests } from '../io/request-file.js';
import { ensureNamedSubjects, ensureSubjectCount, ensureWritableDir, resolveTemplate } from '../preflight.js';
import { reportJob } from './report.js';

/** The template `gen` reaches for when none is named. */
export const DEFAULT_TEMPLATE = 'versus-classic';

/**
 * …and when only one player was named.
 *
 * `hexa gen Faker` documents itself as a single-subject thumbnail, so it has to
 * pick a template that takes one subject rather than failing against the versus
 * default. The user can still name any template explicitly.
 */
export const DEFAULT_SOLO_TEMPLATE = 'hero-portrait';

/** The template a subject count implies when the user named none. */
export function defaultTemplateFor(subjects: number): string {
  return subjects === 1 ? DEFAULT_SOLO_TEMPLATE : DEFAULT_TEMPLATE;
}

export function registerGen(program: Command): void {
  program
    .command('gen')
    .description('Generate a versus thumbnail from two player names — the fast path')
    .argument('<left>', 'player on the left (handle, id or alias)')
    .argument('[right]', 'player on the right; omit for a single-subject thumbnail')
    .option('-t, --template <id>', `template id (default: ${DEFAULT_TEMPLATE} for two subjects)`)
    .option('--title <text>', 'headline copy')
    .option('--subhead <text>', 'secondary line')
    .option('--kicker <text>', 'small line above the headline')
    .addOption(new Option('-a, --aspect <preset>', 'output aspect').choices([
      'youtube', 'youtube-hd', 'shorts', 'twitch', 'square', 'twitter', 'banner',
    ]))
    .option('-n, --variants <count>', 'how many distinct variants to explore', parseCount, 1)
    .option('-o, --out <dir>', 'output directory', './out')
    .option('--name <basename>', 'output filename without extension')
    .addOption(new Option('-f, --format <format>', 'image format').choices(['png', 'jpeg', 'webp', 'avif']))
    .option('-q, --quality <n>', 'encoder quality 1–100', parseCount)
    .option('--accent <hex>', 'override the accent colour')
    .option('--left-color <hex>', 'override the left palette colour')
    .option('--right-color <hex>', 'override the right palette colour')
    .option('--bg <mode>', 'background: auto, ai, file, color, gradient, none')
    .option('--bg-prompt <text>', 'prompt for an AI backplate (never a person)')
    .option('--bg-file <path>', 'use this image as the background')
    .option('--bg-color <hex>', 'flat background colour')
    .option('--plan', 'also write the RenderPlan as JSON next to each image')
    .option('--sheet', 'also write a contact sheet of every variant')
    .option('--strict', 'fail the command if a variant does not pass QA')
    .option('--require-cleared', 'refuse photographs whose licence is not cleared')
    .option('--no-qa-legibility', 'skip the small-size legibility gate')
    .option('--no-qa-safe-zones', 'skip the safe-zone gate')
    .option('--identity-threshold <n>', 'cosine similarity the face must reach (0–1)', parseFloatArg)
    .addHelpText('after', `
Examples:
  ${'$'} hexa gen Peyz Viper
  ${'$'} hexa gen Peyz Viper --template versus-classic --title "RIVALS" --variants 4 --out ./out
  ${'$'} hexa gen Faker --template hero-portrait --title "THE GOAT" --aspect shorts
  ${'$'} hexa gen Peyz Viper --variants 6 --sheet --plan     # explore, then pick

Notes:
  With no photographs in the asset library, subjects render as schematic
  placeholders and the command still succeeds — add references with
  \`hexa assets ingest\`. Run \`hexa doctor\` if anything looks off.`)
    .action(async (left: string, right: string | undefined, options: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      ensureNamedSubjects(right === undefined ? [left] : [left, right]);

      const subjects: SubjectRequest[] = right
        ? [{ player: left, side: 'left' }, { player: right, side: 'right' }]
        : [{ player: left, side: 'center' }];

      await runGeneration(ctx, buildRequest(ctx, subjects, options));
    });
}

export function registerMake(program: Command): void {
  program
    .command('make')
    .description('Generate from explicit flags or a JSON/YAML request file')
    .option('--file <path>', 'read the request(s) from a .json/.yaml file')
    .option('-s, --subject <player...>', 'subject player handles, in composition order')
    .option('-t, --template <id>', 'template id')
    .option('--title <text>', 'headline copy')
    .option('--subhead <text>', 'secondary line')
    .option('--kicker <text>', 'small line above the headline')
    .option('--text <role=value...>', 'set any text role, e.g. --text stat="18/2/9"')
    .addOption(new Option('-a, --aspect <preset>', 'output aspect').choices([
      'youtube', 'youtube-hd', 'shorts', 'twitch', 'square', 'twitter', 'banner',
    ]))
    .option('-n, --variants <count>', 'how many distinct variants to explore', parseCount)
    .option('-o, --out <dir>', 'output directory', './out')
    .option('--name <basename>', 'output filename without extension')
    .addOption(new Option('-f, --format <format>', 'image format').choices(['png', 'jpeg', 'webp', 'avif']))
    .option('-q, --quality <n>', 'encoder quality 1–100', parseCount)
    .option('--accent <hex>', 'override the accent colour')
    .option('--left-color <hex>', 'override the left palette colour')
    .option('--right-color <hex>', 'override the right palette colour')
    .option('--bg <mode>', 'background: auto, ai, file, color, gradient, none')
    .option('--bg-prompt <text>', 'prompt for an AI backplate (never a person)')
    .option('--bg-file <path>', 'use this image as the background')
    .option('--bg-color <hex>', 'flat background colour')
    .option('--grade <key=value...>', 'grade overrides, e.g. --grade saturation=1.2 vignette=0.4')
    .option('--plan', 'also write the RenderPlan as JSON')
    .option('--sheet', 'also write a contact sheet')
    .option('--strict', 'fail the command if a variant does not pass QA')
    .option('--require-cleared', 'refuse photographs whose licence is not cleared')
    .option('--identity-threshold <n>', 'cosine similarity the face must reach (0–1)', parseFloatArg)
    .addHelpText('after', `
Examples:
  ${'$'} hexa make --subject Peyz Viper --template versus-classic --title "RIVALS"
  ${'$'} hexa make --file ./requests/finals.yaml
  ${'$'} hexa make --subject Faker --template hero-portrait --text stat="1000 GAMES" --grade saturation=1.15

A request file may hold one request or an array of them:
  templateId: versus-classic
  subjects:
    - player: Peyz
    - player: Viper
  text:
    headline: RIVALS
  output:
    dir: ./out`)
    .action(async (options: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));

      if (options['file']) {
        const requests = await loadRequests(String(options['file']), fileDefaults(ctx, options));
        for (const [i, request] of requests.entries()) {
          if (requests.length > 1) ctx.say(ctx.ui.heading(`\n[${i + 1}/${requests.length}] ${request.templateId}`));
          await runGeneration(ctx, request);
        }
        return;
      }

      const players = (options['subject'] as string[] | undefined) ?? [];
      if (players.length === 0) {
        throw new HexaError('INVALID_REQUEST', 'No subjects given', {
          hint: 'Pass --subject <player> (repeatable), or --file with a request document. `hexa gen A B` is the short form.',
        });
      }
      ensureNamedSubjects(players);

      const subjects: SubjectRequest[] = players.map((player, i) => ({
        player,
        side: players.length === 1 ? 'center' : i < players.length / 2 ? 'left' : 'right',
      }));

      await runGeneration(ctx, buildRequest(ctx, subjects, options));
    });
}

/**
 * Run one request and report it, sharing the library for the credit line.
 *
 * The three checks in front of the render are the ones whose answers cannot
 * change while it runs — the template exists, it wants this many subjects, the
 * output directory accepts bytes — and each of them would otherwise surface
 * thirty seconds of work later, after everything expensive had already happened.
 */
export async function runGeneration(ctx: CliContext, request: ThumbnailRequest): Promise<void> {
  const template = await resolveTemplate(request.templateId, request.subjects.length);
  await ensureSubjectCount(template, request.subjects.length);
  await ensureWritableDir(request.output?.dir ?? './out');

  const deps = await ctx.deps();
  const label = request.subjects.map((s) => s.player).join(' vs ');
  const spinner = ctx.spinner(`rendering ${label}…`);

  try {
    const result = await generateThumbnail(request, deps);
    spinner.succeed(`${label} ${ctx.ui.dim(`— ${result.variants.length} variant(s)`)}`);
    await reportJob(ctx, result, deps.library);
  } catch (e) {
    spinner.fail(`${label} failed`);
    throw e;
  }
}

/** Flags → a ThumbnailRequest. Validation is the pipeline's job, not ours. */
export function buildRequest(ctx: CliContext, subjects: SubjectRequest[], o: Record<string, unknown>): ThumbnailRequest {
  const text: ThumbnailRequest['text'] = {};
  if (o['title']) text.headline = String(o['title']);
  if (o['subhead']) text.subhead = String(o['subhead']);
  if (o['kicker']) text.kicker = String(o['kicker']);
  Object.assign(text, parseKeyValues((o['text'] as string[] | undefined) ?? []));

  const palette = compact({
    left: o['leftColor'] as string | undefined,
    right: o['rightColor'] as string | undefined,
    accent: o['accent'] as string | undefined,
  });

  const request: ThumbnailRequest = {
    // One player means a single-subject template, which is what `hexa gen Faker`
    // documents itself as doing.
    templateId: (o['template'] as string | undefined) ?? defaultTemplateFor(subjects.length),
    subjects,
    text,
    aspect: o['aspect'] as AspectPreset | undefined,
    variants: o['variants'] as number | undefined,
    seed: ctx.seed,
    output: {
      dir: (o['out'] as string | undefined) ?? './out',
      name: o['name'] as string | undefined,
      format: o['format'] as ThumbnailRequest['output']['format'],
      quality: o['quality'] as number | undefined,
      emitPlan: o['plan'] === true,
      contactSheet: o['sheet'] === true,
    },
    qa: compact({
      strict: o['strict'] === true ? true : undefined,
      requireClearedLicense: o['requireCleared'] === true ? true : undefined,
      identityThreshold: o['identityThreshold'] as number | undefined,
      // commander gives `--no-qa-legibility` as `qaLegibility: false`.
      legibility: o['qaLegibility'] === false ? false : undefined,
      safeZones: o['qaSafeZones'] === false ? false : undefined,
    }),
  };

  const background = buildBackground(o);
  if (background) request.background = background;
  if (Object.keys(palette).length > 0) request.palette = palette;

  const grade = parseGrade((o['grade'] as string[] | undefined) ?? []);
  if (Object.keys(grade).length > 0) request.grade = grade;

  return request;
}

function buildBackground(o: Record<string, unknown>): ThumbnailRequest['background'] | undefined {
  const explicit = o['bg'] as string | undefined;
  const prompt = o['bgPrompt'] as string | undefined;
  const file = o['bgFile'] as string | undefined;
  const color = o['bgColor'] as string | undefined;

  // Infer the mode from whichever background flag was actually used, so
  // `--bg-file x.png` does not also need `--bg file`.
  const mode = explicit ?? (file ? 'file' : color ? 'color' : prompt ? 'ai' : undefined);
  if (!mode) return undefined;

  return compact({ mode, prompt, path: file, color }) as ThumbnailRequest['background'];
}

/** `--text stat="18/2/9"` → `{ stat: '18/2/9' }`. */
export function parseKeyValues(pairs: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) {
      throw new HexaError('INVALID_REQUEST', `Expected key=value, got "${pair}"`, {
        hint: 'For example: --text headline="RIVALS" stat="18/2/9"',
      });
    }
    out[pair.slice(0, at).trim()] = pair.slice(at + 1);
  }
  return out;
}

/** `--grade saturation=1.2 lut=teal-orange` → a partial GradeSpec. */
export function parseGrade(pairs: readonly string[]): Partial<GradeSpec> {
  const grade: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parseKeyValues(pairs))) {
    const numeric = Number(value);
    // `lut` and the tint fields are strings; everything else in GradeSpec is a
    // number, so a numeric-looking value is taken as one.
    grade[key] = value !== '' && Number.isFinite(numeric) ? numeric : value;
  }
  return grade as Partial<GradeSpec>;
}

function fileDefaults(ctx: CliContext, o: Record<string, unknown>): Partial<ThumbnailRequest> {
  return compact({
    templateId: o['template'] as string | undefined,
    aspect: o['aspect'] as AspectPreset | undefined,
    variants: o['variants'] as number | undefined,
    seed: ctx.seed,
    output: compact({
      dir: (o['out'] as string | undefined) ?? './out',
      format: o['format'] as ThumbnailRequest['output']['format'],
      quality: o['quality'] as number | undefined,
      emitPlan: o['plan'] === true ? true : undefined,
      contactSheet: o['sheet'] === true ? true : undefined,
    }) as ThumbnailRequest['output'],
  });
}

function compact<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

export function parseCount(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new HexaError('INVALID_REQUEST', `Expected a number, got "${value}"`, { hint: 'For example: --variants 4' });
  }
  return n;
}

export function parseFloatArg(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    throw new HexaError('INVALID_REQUEST', `Expected a number, got "${value}"`, { hint: 'For example: --identity-threshold 0.45' });
  }
  return n;
}
