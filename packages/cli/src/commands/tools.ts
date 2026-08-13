/**
 * `hexa preview`, `hexa batch`, `hexa providers`, `hexa qa`.
 *
 * The supporting commands: see a template before committing to it, render a
 * spreadsheet of matchups, check what the AI layer is configured for, and audit
 * an image that already exists.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { HexaError } from '@hexa/core';
import type { RenderPlan, ThumbnailRequest } from '@hexa/core';
import { batchGenerate, summariseBatch } from '@hexa/pipeline';
import { ai, data, qa as qaAdapter, templates as templatesAdapter } from '@hexa/pipeline/integration';
import { createContext, globalsFrom, type CliContext } from '../context.js';
import { loadRequests } from '../io/request-file.js';
import { createProgressBar } from '../ui/progress.js';
import { displayPath, formatDuration, formatScore, renderTable } from '../ui/table.js';
import { formatFinding, reportJob, topFindings } from './report.js';
import { parseCount } from './gen.js';

// ── preview ──────────────────────────────────────────────────────────────────

export function registerPreview(program: Command): void {
  program
    .command('preview')
    .description('Render a template so you can see what it looks like')
    .argument('<id>', 'template id (see `hexa templates`)')
    .option('-s, --subject <player...>', 'use these players instead of roster samples')
    .option('-o, --out <dir>', 'output directory', './out')
    .option('-a, --aspect <preset>', 'aspect to preview')
    .option('-n, --variants <count>', 'preview this many variants', parseCount, 1)
    .option('--title <text>', 'headline copy', 'PREVIEW')
    .option('--sheet', 'write a contact sheet when previewing several variants')
    .addHelpText('after', `
Examples:
  ${'$'} hexa preview versus-classic
  ${'$'} hexa preview hero-portrait --aspect shorts --variants 4 --sheet

Subjects come from the roster, so a template with no reference photographs on
file still renders — as schematic placeholder silhouettes. That is the point:
you can evaluate a composition before sourcing any photography.`)
    .action(async (id: string, o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const template = await templatesAdapter.requireTemplate(id);

      const wanted = template.subjects.min;
      const explicit = (o['subject'] as string[] | undefined) ?? [];
      const players = explicit.length > 0 ? explicit : await sampleRoster(wanted);

      if (players.length < wanted) {
        throw new HexaError('INVALID_REQUEST', `Template "${id}" needs ${wanted} subject(s), and only ${players.length} could be found`, {
          hint: 'Pass them explicitly: hexa preview ' + id + ' --subject <player> <player>',
        });
      }

      const request: ThumbnailRequest = {
        templateId: template.id,
        subjects: players.slice(0, Math.max(wanted, Math.min(explicit.length || wanted, template.subjects.max))).map((player, i, all) => ({
          player,
          side: all.length === 1 ? 'center' : i < all.length / 2 ? 'left' : 'right',
        })),
        text: { headline: String(o['title'] ?? 'PREVIEW') },
        aspect: (o['aspect'] as ThumbnailRequest['aspect']) ?? template.aspects[0],
        variants: (o['variants'] as number | undefined) ?? 1,
        seed: ctx.seed,
        output: {
          dir: String(o['out'] ?? './out'),
          name: `preview-${template.id}`,
          contactSheet: o['sheet'] === true,
        },
      };

      ctx.say(`\n ${ctx.ui.heading(template.name)} ${ctx.ui.dim(`(${template.id})`)}`);
      ctx.say(` ${ctx.ui.dim(template.description)}`);
      if (template.whenToUse) ctx.say(` ${ctx.ui.dim(`${ctx.glyph.arrow} ${template.whenToUse}`)}`);

      const { generateThumbnail } = await import('@hexa/pipeline');
      const deps = await ctx.deps();
      const spinner = ctx.spinner(`rendering ${template.id}…`);
      try {
        const result = await generateThumbnail(request, deps);
        spinner.succeed(`previewed ${template.id}`);
        await reportJob(ctx, result, deps.library);
      } catch (e) {
        spinner.fail(`preview of ${template.id} failed`);
        throw e;
      }
    });
}

/** Deterministic roster sample — the same template previews the same way twice. */
async function sampleRoster(count: number): Promise<string[]> {
  const players = (await data.listPlayers({ active: true })).slice(0, Math.max(count, 2));
  return players.map((p) => p.handle);
}

// ── batch ────────────────────────────────────────────────────────────────────

export function registerBatch(program: Command): void {
  program
    .command('batch')
    .description('Generate many thumbnails from a JSON, YAML or CSV file')
    .argument('<file>', 'requests file (.json, .yaml, .csv)')
    .option('-t, --template <id>', 'default template for rows that do not name one')
    .option('-o, --out <dir>', 'default output directory', './out')
    .option('-a, --aspect <preset>', 'default aspect')
    .option('-n, --variants <count>', 'default variant count', parseCount)
    .option('-c, --concurrency <n>', 'how many jobs at once', parseCount, 2)
    .option('--continue-on-error', 'keep going after a failure (default)', true)
    .addHelpText('after', `
Examples:
  ${'$'} hexa batch ./week1.csv --template versus-classic --out ./out
  ${'$'} hexa batch ./requests.yaml --concurrency 4

A CSV needs a header row. Recognised columns (aliases in brackets):
  left [player1, a]   right [player2, b]   template   headline [title]
  subhead   kicker   name [output]   aspect   variants   seed

  left,right,title
  Peyz,Viper,RIVALS
  Faker,Chovy,"THE CLASSIC, AGAIN"

Concurrency defaults to 2: each job holds several decoded images in memory and
the render is CPU-bound, so more is usually slower on a laptop.`)
    .action(async (file: string, o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));

      const requests = await loadRequests(file, {
        templateId: o['template'] as string | undefined,
        aspect: o['aspect'] as ThumbnailRequest['aspect'],
        variants: o['variants'] as number | undefined,
        seed: ctx.seed,
        output: { dir: String(o['out'] ?? './out') },
      });

      ctx.say(` ${ctx.ui.dim(`${requests.length} request(s) from ${path.basename(file)}`)}\n`);

      const bar = createProgressBar({ ui: ctx.ui, enabled: !ctx.json });
      const deps = await ctx.deps();
      const started = Date.now();

      const results = await batchGenerate(requests, deps, {
        concurrency: (o['concurrency'] as number | undefined) ?? 2,
        onProgress: (done, total, current) => bar.update(done, total, current),
      });
      bar.done();

      const summary = summariseBatch(results);

      if (ctx.json) {
        ctx.emitJson({
          ...summary,
          wallMs: Date.now() - started,
          results: results.map((r) => ({
            request: { templateId: r.request.templateId, subjects: r.request.subjects.map((s) => s.player) },
            variants: r.variants.map((v) => ({ id: v.id, path: v.path, qa: v.qa.score, passed: v.qa.passed, appeal: v.appeal })),
            best: r.variants[r.bestIndex]?.path,
            warnings: r.warnings,
          })),
        });
        return;
      }

      for (const result of results) {
        const best = result.variants[result.bestIndex];
        const label = result.request.subjects.map((s) => s.player).join(' vs ');
        if (!best) {
          ctx.say(` ${ctx.ui.fail(ctx.glyph.fail)} ${label} ${ctx.ui.dim(result.warnings[0] ?? 'failed')}`);
          continue;
        }
        const mark = best.qa.passed ? ctx.ui.ok(ctx.glyph.ok) : ctx.ui.warn(ctx.glyph.warn);
        ctx.say(` ${mark} ${ctx.ui.bold(label.padEnd(28))} ${formatScore(best.qa.score, ctx.ui)}  ${ctx.ui.dim(displayPath(best.path))}`);
      }

      ctx.say(`\n ${ctx.ui.bold(`${summary.succeeded}/${summary.total}`)} succeeded, ` +
        `${summary.images} image(s) in ${formatDuration(Date.now() - started)}`);

      if (summary.failed > 0) {
        ctx.say(` ${ctx.ui.warn(`${ctx.glyph.warn} ${summary.failed} failed — re-run with --log debug for detail`)}`);
        // A partly-failed batch is a partial failure, and a CI job should know.
        process.exitCode = 1;
      }
    });
}

// ── providers ────────────────────────────────────────────────────────────────

export function registerProviders(program: Command): void {
  program
    .command('providers')
    .description('Show AI provider configuration')
    .addHelpText('after', `
AI is optional and used only for background plates — never for faces. A prompt
that asks for a person is refused before it reaches any provider
(see docs/IDENTITY.md).

With nothing configured, templates asking for an AI backdrop fall back to a
procedural one and the render still succeeds.`)
    .action(async (_o: unknown, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const statuses = await ai.providerStatuses();

      if (ctx.json) {
        ctx.emitJson(statuses);
        return;
      }
      if (statuses.length === 0) {
        ctx.say(ctx.ui.warn(`${ctx.glyph.warn} No AI providers are registered.`));
        ctx.say(ctx.ui.dim('  Backplates will be procedural. That is a supported way to run Hexa.'));
        return;
      }

      ctx.say(renderTable(
        statuses,
        [
          { header: '', value: (p) => (p.configured ? ctx.ui.ok(ctx.glyph.ok) : ctx.ui.dim(ctx.glyph.dot)) },
          { header: 'PROVIDER', value: (p) => ctx.ui.bold(p.id), max: 16 },
          { header: 'STATUS', value: (p) => (p.configured ? ctx.ui.ok('configured') : ctx.ui.dim('not configured')), max: 16 },
          { header: 'ENV VAR', value: (p) => (p.envVar ? ctx.ui.cyan(p.envVar) : ctx.ui.dim('—')), max: 26 },
          { header: 'NOTE', value: (p) => ctx.ui.dim(p.note ?? ''), max: 46 },
        ],
        { headerStyle: ctx.ui.dim, indent: 1 },
      ));

      const configured = statuses.filter((p) => p.configured);
      ctx.say(`\n ${ctx.ui.dim(`${configured.length}/${statuses.length} configured`)}`);
      if (configured.length === 0) {
        const vars = [...new Set(statuses.map((p) => p.envVar).filter(Boolean))];
        if (vars.length > 0) ctx.say(` ${ctx.ui.dim(`Set one of: ${vars.join(', ')}`)}`);
      }
    });
}

// ── qa ───────────────────────────────────────────────────────────────────────

export function registerQa(program: Command): void {
  program
    .command('qa')
    .description('Run the quality gates against an image that already exists')
    .argument('<image>', 'path to a rendered thumbnail')
    .option('--plan <path>', 'the RenderPlan JSON (defaults to <image>.plan.json)')
    .option('--proof <path>', 'also write a proof sheet showing it at real display sizes')
    .option('--only <gate...>', 'run only these gates')
    .option('--skip <gate...>', 'skip these gates')
    .option('--gates', 'list the available gates and exit')
    .addHelpText('after', `
Examples:
  ${'$'} hexa qa ./out/thumbnail.png
  ${'$'} hexa qa ./out/thumbnail.png --proof ./out/proof.png
  ${'$'} hexa qa --gates

The identity and safe-zone gates need the RenderPlan — it is what says where the
faces and text ended up. Render with --plan to get one written alongside the
image. Without it, only the gates that read pixels alone can run.`)
    .action(async (image: string, o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));

      if (o['gates'] === true) {
        const gates = await qaAdapter.gateList();
        if (ctx.json) {
          ctx.emitJson(gates);
          return;
        }
        ctx.say(renderTable(
          gates,
          [
            { header: 'GATE', value: (g) => ctx.ui.bold(g.id), max: 20 },
            { header: 'WEIGHT', value: (g) => String(g.weight), align: 'right', max: 6 },
            { header: 'CHECKS', value: (g) => ctx.ui.dim(g.description), max: 70 },
          ],
          { headerStyle: ctx.ui.dim, indent: 1 },
        ));
        return;
      }

      const imagePath = path.resolve(image);
      const bytes = await readImage(imagePath);
      const plan = await loadPlan(imagePath, o['plan'] as string | undefined);

      if (!plan) {
        throw new HexaError('INVALID_REQUEST', `No RenderPlan found for ${path.basename(imagePath)}`, {
          hint: `Pass --plan <path>, or re-render with --plan so the JSON is written alongside the image. ` +
            `The gates need it to know where the faces and text are.`,
          details: { image: imagePath, tried: `${imagePath.replace(/\.[^.]+$/, '')}.plan.json` },
        });
      }

      const deps = await ctx.deps();
      const spinner = ctx.spinner('running gates…');

      const subjects = ((plan.meta['faceRects'] as { playerId: string; rect: unknown }[] | undefined) ?? []).map((f) => ({
        playerId: f.playerId,
        handle: f.playerId,
        faceRect: f.rect as { x: number; y: number; w: number; h: number },
      }));

      const report = await qaAdapter.runGates({
        image: bytes,
        plan,
        subjects,
        textRects: ((plan.meta['textRects'] as { role: string; rect: unknown }[] | undefined) ?? [])
          .map((t) => ({ role: t.role, rect: t.rect as { x: number; y: number; w: number; h: number } })),
        vision: deps.vision as never,
        only: o['only'] as string[] | undefined,
        skip: o['skip'] as string[] | undefined,
      });

      const appeal = await qaAdapter.scoreAppealDetailed({
        image: bytes,
        width: plan.canvas.width,
        height: plan.canvas.height,
      });
      spinner.stop();

      let proofPath: string | undefined;
      if (o['proof']) {
        const sheet = await qaAdapter.proofSheet(bytes);
        if (sheet) {
          proofPath = path.resolve(String(o['proof']));
          await fs.mkdir(path.dirname(proofPath), { recursive: true });
          await fs.writeFile(proofPath, sheet);
        }
      }

      if (ctx.json) {
        ctx.emitJson({ image: imagePath, report, appeal, proofSheet: proofPath });
        process.exitCode = report.passed ? 0 : 9;
        return;
      }

      printReport(ctx, imagePath, report, appeal, proofPath);
      // Exit 9 (QA_FAILED) so CI can gate a publish on this.
      if (!report.passed) process.exitCode = 9;
    });
}

function printReport(
  ctx: CliContext,
  imagePath: string,
  report: Awaited<ReturnType<typeof qaAdapter.runGates>>,
  appeal: { score: number; parts: Record<string, number>; notes: string[] },
  proofPath?: string,
): void {
  const { ui, glyph } = ctx;
  ctx.say(`\n ${ui.heading(path.basename(imagePath))}`);
  ctx.say(` ${report.passed ? ui.ok(`${glyph.ok} passed`) : ui.fail(`${glyph.fail} failed`)}   ` +
    `qa ${formatScore(report.score, ui)}   appeal ${formatScore(appeal.score, ui)}`);

  const gateScores = Object.entries(report.gateScores ?? {});
  if (gateScores.length > 0) {
    ctx.say(`\n ${ui.dim('per gate')}`);
    for (const [gate, score] of gateScores.sort((a, b) => a[1] - b[1])) {
      ctx.say(`   ${gate.padEnd(20)} ${formatScore(score * (score <= 1 ? 100 : 1), ui)}`);
    }
  }

  const findings = topFindings(report, 12);
  if (findings.length > 0) {
    ctx.say(`\n ${ui.dim('findings')}`);
    for (const finding of findings) ctx.say(`   ${formatFinding(ctx, finding)}`);
  }

  if (appeal.notes.length > 0) {
    ctx.say(`\n ${ui.dim('appeal notes')}`);
    for (const note of appeal.notes.slice(0, 5)) ctx.say(`   ${ui.dim('•')} ${note}`);
  }

  if (proofPath) {
    ctx.say(`\n ${glyph.arrow} proof sheet ${ui.bold(displayPath(proofPath))} ${ui.dim('— check it reads at the small sizes')}`);
  }
}

async function readImage(file: string): Promise<Buffer> {
  try {
    return await fs.readFile(file);
  } catch (cause) {
    throw new HexaError('IO_ERROR', `Cannot read ${file}`, {
      hint: 'Check the path points at a rendered image.',
      details: { file },
      cause,
    });
  }
}

/** The plan beside the image, or the one the caller named. */
async function loadPlan(imagePath: string, explicit?: string): Promise<RenderPlan | undefined> {
  const candidate = explicit ? path.resolve(explicit) : `${imagePath.replace(/\.[^.]+$/, '')}.plan.json`;
  try {
    return JSON.parse(await fs.readFile(candidate, 'utf8')) as RenderPlan;
  } catch (cause) {
    // An explicitly named plan that will not load is an error; a missing
    // sidecar file is just "there isn't one".
    if (explicit) {
      throw new HexaError('IO_ERROR', `Cannot read the plan at ${candidate}`, {
        hint: 'Point --plan at the .plan.json written by `hexa gen --plan`.',
        details: { plan: candidate },
        cause,
      });
    }
    return undefined;
  }
}
