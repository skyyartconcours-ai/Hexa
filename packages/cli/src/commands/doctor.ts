/**
 * `hexa doctor` — what is wrong, and exactly how to fix it.
 *
 * Hexa has more moving parts than most CLIs: nine TypeScript packages, a native
 * image backend, a font stack, an optional Python sidecar, optional AI providers
 * and a user-curated photo library. Any of them can be half-installed, and the
 * symptom is usually something oblique — a headline that overflows, a subject
 * with a rectangular background, a render that will not verify.
 *
 * So every check here answers three things: what was tested, what was found, and
 * the exact command to run next. A check that reports a problem without a remedy
 * has moved the work rather than done it. Severity is honest too: a missing
 * sidecar is a `warn` because the tool still works without it, while a broken
 * sharp is a `fail` because nothing renders.
 */

import { Command } from 'commander';
import { INTEGRATIONS, moduleHealth, sharpDiagnostics } from '@hexa/pipeline';
import { ai, assets as assetsAdapter, data, type as typeAdapter, vision as visionAdapter } from '@hexa/pipeline/integration';
import { createContext, globalsFrom, type CliContext } from '../context.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was actually found. */
  detail: string;
  /** The command or edit that fixes it. Omitted only when nothing is wrong. */
  fix?: string;
  notes?: string[];
}

/** Node floor from the repo's `engines`; below it, `sharp` and ESM misbehave. */
const MIN_NODE = [20, 11] as const;

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check the install and report exactly what to fix')
    .option('--quick', 'skip the network check for the vision sidecar')
    .addHelpText('after', `
Runs through: Node version, the image backend, the nine Hexa packages, the font
stack, the vision sidecar, AI providers, and reference-photo coverage per team.

Exit code is 0 when nothing failed (warnings are fine), 1 when something is
broken — so CI can gate on it.`)
    .action(async (o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const checks: Check[] = [];

      checks.push(checkNode());
      checks.push(await checkSharp());
      checks.push(...(await checkPackages()));
      checks.push(await checkFonts());
      if (o['quick'] !== true) checks.push(await checkVision(ctx));
      checks.push(await checkProviders());
      checks.push(...(await checkLibrary(ctx)));

      if (ctx.json) {
        ctx.emitJson({
          ok: !checks.some((c) => c.status === 'fail'),
          checks,
        });
      } else {
        printChecks(ctx, checks);
      }

      // Warnings are expected on a fresh install (no photos, no sidecar); only a
      // real failure should break a CI job.
      if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
    });
}

function checkNode(): Check {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  return {
    id: 'node',
    label: 'Node.js',
    status: ok ? 'ok' : 'fail',
    detail: `v${process.versions.node} (need >= ${MIN_NODE[0]}.${MIN_NODE[1]})`,
    fix: ok ? undefined : `Install Node ${MIN_NODE[0]}.${MIN_NODE[1]} or newer — nvm install ${MIN_NODE[0]}`,
  };
}

async function checkSharp(): Promise<Check> {
  const s = await sharpDiagnostics();
  if (!s.ok) {
    return {
      id: 'sharp',
      label: 'Image backend (sharp)',
      status: 'fail',
      detail: s.error ?? 'sharp could not process an image',
      fix: 'Reinstall the native binary: pnpm rebuild sharp — or `pnpm install --force` if that does not help.',
    };
  }

  const missing = ['png', 'jpeg', 'webp', 'avif'].filter((f) => !s.formats.includes(f));
  return {
    id: 'sharp',
    label: 'Image backend (sharp)',
    status: missing.length > 0 ? 'warn' : 'ok',
    detail: `sharp ${s.version ?? '?'} / libvips ${s.vips ?? '?'}, ${s.formats.length} output formats`,
    fix: missing.length > 0 ? `No encoder for ${missing.join(', ')} — those --format values will fail. Reinstall sharp for a full-featured build.` : undefined,
  };
}

/** Every Hexa package, and whether it exports what the pipeline integrates against. */
async function checkPackages(): Promise<Check[]> {
  const results = await Promise.all(
    INTEGRATIONS.map(async (integration) => {
      const health = await moduleHealth(integration.module, integration.exports);
      const required = integration.required;

      if (health.ok) {
        return {
          id: `pkg:${integration.module}`,
          label: integration.module,
          status: 'ok' as CheckStatus,
          detail: integration.purpose,
        };
      }

      const notBuilt = Boolean(health.error);
      return {
        id: `pkg:${integration.module}`,
        label: integration.module,
        status: required ? ('fail' as CheckStatus) : ('warn' as CheckStatus),
        detail: notBuilt
          ? `not loadable — ${health.error}`
          : `loaded, but missing ${health.missing.length} export(s): ${health.missing.slice(0, 6).join(', ')}`,
        fix: notBuilt
          ? `pnpm --filter ${integration.module} build`
          : `${integration.module} has drifted from the declared contract. Fix its adapter in packages/pipeline/src/adapters/, or restore the export.`,
      };
    }),
  );
  return results;
}

async function checkFonts(): Promise<Check> {
  const fonts = await typeAdapter.fontDiagnostics();

  if (fonts.error) {
    return {
      id: 'fonts',
      label: 'Fonts',
      status: 'warn',
      detail: `font stack could not be inspected — ${fonts.error}`,
      fix: 'Check @hexa/type is built: pnpm --filter @hexa/type build',
    };
  }

  if (fonts.missing.length === 0) {
    return {
      id: 'fonts',
      label: 'Fonts',
      status: 'ok',
      detail: `${fonts.registered.length} famil(ies) registered; all design faces present`,
    };
  }

  // The important nuance: having *some* fonts is not the same as having the
  // *right* ones. Text is measured with the intended face's metrics and drawn
  // with whatever the rasteriser substitutes, so headlines overflow their box.
  return {
    id: 'fonts',
    label: 'Fonts',
    status: 'warn',
    detail: `${fonts.missing.length} design face(s) missing: ${fonts.missing.join(', ')}`,
    fix: `Download those families and drop the .ttf/.otf files into ${fonts.directory ?? 'assets/fonts/'}`,
    notes: [
      'Text is measured with the intended font and drawn with a substitute, so long headlines can overflow their slot.',
      fonts.registered.length > 0 ? `Currently available: ${fonts.registered.join(', ')}` : 'No fonts are registered at all.',
    ],
  };
}

async function checkVision(ctx: CliContext): Promise<Check> {
  const endpoint = ctx.visionEndpoint ?? process.env['HEXA_VISION_URL'] ?? 'http://127.0.0.1:8000';
  try {
    const client = await visionAdapter.createVisionClient({ endpoint });
    const available = await visionAdapter.isAvailable(client);
    if (available) {
      return { id: 'vision', label: 'Vision sidecar', status: 'ok', detail: `reachable at ${endpoint}` };
    }
  } catch {
    // fall through to the same advice
  }

  return {
    id: 'vision',
    label: 'Vision sidecar',
    status: 'warn',
    detail: `not reachable at ${endpoint}`,
    fix: 'Start it with: services/vision/run.sh   (or set --vision / HEXA_VISION_URL)',
    notes: [
      'Without it: no alpha-matted cutouts (subjects composite with their background), no face-anchored placement, and identity cannot be verified.',
      'Renders still succeed — the identity gate warns rather than silently passing.',
    ],
  };
}

async function checkProviders(): Promise<Check> {
  const statuses = await ai.providerStatuses();
  if (statuses.length === 0) {
    return {
      id: 'ai',
      label: 'AI providers',
      status: 'warn',
      detail: 'no providers reported',
      fix: 'Optional. Without one, AI backplates fall back to procedural backdrops.',
    };
  }

  const configured = statuses.filter((p) => p.configured);
  if (configured.length > 0) {
    return {
      id: 'ai',
      label: 'AI providers',
      status: 'ok',
      detail: `${configured.length} configured: ${configured.map((p) => p.id).join(', ')}`,
    };
  }

  const envVars = statuses.map((p) => p.envVar).filter((v): v is string => Boolean(v));
  return {
    id: 'ai',
    label: 'AI providers',
    status: 'warn',
    detail: `${statuses.length} available, none configured`,
    fix: envVars.length > 0
      ? `Set one of: ${[...new Set(envVars)].join(', ')} — see \`hexa providers\``
      : 'See `hexa providers` for what each one needs.',
    notes: ['Optional: templates asking for an AI backplate fall back to a procedural backdrop.'],
  };
}

/** Library health, plus per-team reference coverage. */
async function checkLibrary(ctx: CliContext): Promise<Check[]> {
  const checks: Check[] = [];

  let library;
  try {
    const deps = await ctx.deps();
    library = deps.library;
  } catch (e) {
    return [{
      id: 'library',
      label: 'Asset library',
      status: 'fail',
      detail: e instanceof Error ? e.message : String(e),
      fix: 'Point --assets at a writable directory, or set HEXA_ASSETS.',
    }];
  }

  const stats = library.stats();
  checks.push({
    id: 'library',
    label: 'Asset library',
    status: stats.total === 0 ? 'warn' : 'ok',
    detail: stats.total === 0
      ? `empty (${library.root})`
      : `${stats.total} asset(s), ${stats.cleared} cleared — ${library.root}`,
    fix: stats.total === 0
      ? 'hexa assets ingest ./photos --player <handle> --license press-kit --source "..."'
      : stats.cleared === 0
        ? 'Nothing is cleared for publishing. Read the licences, then: hexa assets clear <assetId>'
        : undefined,
    notes: stats.total === 0
      ? ['Hexa ships no player photography — see docs/IDENTITY.md for where to source it legitimately.',
         'Until then every subject renders as a schematic placeholder silhouette.']
      : undefined,
  });

  // Per-team coverage: the question an operator actually has is "which teams can
  // I make thumbnails for tonight", not "how many files are on disk".
  try {
    const teams = await data.allTeams();
    const rows: string[] = [];
    let covered = 0;

    for (const team of teams) {
      const roster = await data.playersByTeam(team.id);
      if (roster.length === 0) continue;
      const coverage = library.coverage(roster.map((p) => p.id));
      const withPhotos = coverage.filter((c) => c.count > 0).length;
      if (withPhotos === roster.length) covered++;
      if (withPhotos < roster.length) {
        rows.push(`${team.tag}: ${withPhotos}/${roster.length} players have references`);
      }
    }

    checks.push({
      id: 'coverage',
      label: 'Reference coverage',
      status: rows.length === 0 ? 'ok' : 'warn',
      detail: rows.length === 0
        ? `every roster covered (${covered} team(s))`
        : `${rows.length} team(s) with gaps`,
      fix: rows.length === 0 ? undefined : 'hexa assets coverage --missing   # the full list',
      notes: rows.slice(0, 6),
    });
  } catch (e) {
    checks.push({
      id: 'coverage',
      label: 'Reference coverage',
      status: 'warn',
      detail: `could not be computed — ${e instanceof Error ? e.message : String(e)}`,
      fix: 'Check @hexa/data is built: pnpm --filter @hexa/data build',
    });
  }

  return checks;
}

export function printChecks(ctx: CliContext, checks: readonly Check[]): void {
  const { ui, glyph } = ctx;
  const mark = (s: CheckStatus): string => (s === 'ok' ? ui.ok(glyph.ok) : s === 'warn' ? ui.warn(glyph.warn) : ui.fail(glyph.fail));

  ctx.say(`\n ${ui.heading('hexa doctor')}\n`);

  for (const check of checks) {
    ctx.say(` ${mark(check.status)} ${ui.bold(check.label.padEnd(22))} ${check.detail}`);
    for (const note of check.notes ?? []) ctx.say(`     ${ui.dim(note)}`);
    if (check.fix) ctx.say(`     ${ui.cyan(`${glyph.arrow} ${check.fix}`)}`);
  }

  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;

  ctx.say('');
  if (failed > 0) {
    ctx.say(` ${ui.fail(`${failed} problem(s) will stop renders.`)} ${warned > 0 ? ui.dim(`${warned} warning(s) will degrade them.`) : ''}`);
  } else if (warned > 0) {
    ctx.say(` ${ui.ok(`${glyph.ok} Nothing is broken.`)} ${ui.dim(`${warned} warning(s) — the tool works, with reduced quality.`)}`);
  } else {
    ctx.say(` ${ui.ok(`${glyph.ok} Everything checks out.`)} ${ui.dim('Try: hexa gen Peyz Viper --variants 4')}`);
  }
}

export { assetsAdapter };
