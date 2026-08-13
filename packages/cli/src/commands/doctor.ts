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

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { INTEGRATIONS, imageSize, moduleHealth, resolveCacheDir, sharpDiagnostics } from '@hexa/pipeline';
import { ai, assets as assetsAdapter, data, type as typeAdapter, vision as visionAdapter } from '@hexa/pipeline/integration';
import { createContext, globalsFrom, type CliContext } from '../context.js';
import { formatBytes } from '../ui/table.js';

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
Runs through: Node version, the image backend (by encoding a real test image),
the built output, the nine Hexa packages, the font stack, the vision sidecar, AI
providers, disk writability, and reference-photo coverage per team.

Every line that is not "ok" carries the exact command that fixes it.

Exit code is 0 when nothing failed (warnings are fine), 1 when something is
broken — so CI can gate on it. A fresh clone with no photographs, no sidecar and
no API keys is expected to exit 0: none of that stops a render.`)
    .action(async (o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const checks: Check[] = [];

      checks.push(checkNode());
      checks.push(await checkSharp());
      checks.push(await checkBuildFreshness());
      checks.push(...(await checkPackages()));
      checks.push(await checkFonts());
      checks.push(await checkEncode());
      checks.push(await checkDisk(ctx));
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

/**
 * Encode a real image, end to end.
 *
 * `sharpDiagnostics` proves the native binary loads and round-trips a 1×1
 * buffer. This goes further and asks the question a user actually has — "can
 * this install produce a picture?" — by generating a placeholder subject through
 * @hexa/assets (the exact path taken when the library is empty, which on a fresh
 * clone is every render), then decoding the bytes back to confirm they are a
 * real image rather than a plausible-looking buffer.
 */
async function checkEncode(): Promise<Check> {
  const started = Date.now();
  try {
    const png = await assetsAdapter.generatePlaceholder({
      width: 240,
      height: 320,
      label: 'HEXA',
      accent: '#F5C542',
      seed: 1,
    });

    const size = await imageSize(png);
    if (!size) {
      return {
        id: 'encode',
        label: 'Test render',
        status: 'fail',
        detail: `produced ${png.length} bytes that do not decode as an image`,
        fix: 'The image backend is producing corrupt output. Reinstall it: pnpm rebuild sharp',
      };
    }

    return {
      id: 'encode',
      label: 'Test render',
      status: 'ok',
      detail: `encoded a ${size.width}×${size.height} PNG (${formatBytes(png.length)}) in ${Date.now() - started}ms`,
    };
  } catch (e) {
    return {
      id: 'encode',
      label: 'Test render',
      status: 'fail',
      detail: `could not draw a test image — ${e instanceof Error ? e.message : String(e)}`,
      fix: 'Nothing will render. Rebuild the workspace (pnpm build) and the native backend (pnpm rebuild sharp).',
    };
  }
}

/**
 * Somewhere to put the results.
 *
 * Two directories matter and they fail independently: the working directory,
 * because `--out ./out` is the default every first run uses, and the cache,
 * because cutouts are written there. A read-only cache is a warning — renders
 * just get slower — while a read-only working directory stops everything.
 */
async function checkDisk(ctx: CliContext): Promise<Check> {
  const cwd = process.cwd();
  const cache = resolveCacheDir();

  const outcome = await probeWritable(path.join(cwd, 'out'));
  const cacheOutcome = await probeWritable(cache);

  if (!outcome.ok) {
    return {
      id: 'disk',
      label: 'Disk',
      status: 'fail',
      detail: `cannot write into ${cwd} — ${outcome.error}`,
      fix: `Renders have nowhere to go. Run hexa from a directory you own, or pass --out <dir> pointing at one.`,
    };
  }

  if (!cacheOutcome.ok) {
    return {
      id: 'disk',
      label: 'Disk',
      status: 'warn',
      detail: `output ok (${cwd}/out); cache not writable at ${cache} — ${cacheOutcome.error}`,
      fix: `Set HEXA_CACHE to a writable directory (export HEXA_CACHE=${path.join(os.tmpdir(), 'hexa-cache')}). Without a cache every render re-cuts every subject.`,
    };
  }

  return {
    id: 'disk',
    label: 'Disk',
    status: 'ok',
    detail: `writable: ./out and the cache at ${cache}`,
  };
}

async function probeWritable(dir: string): Promise<{ ok: boolean; error?: string }> {
  const probe = path.join(dir, `.hexa-doctor-${process.pid}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, 'hexa');
    await fs.rm(probe, { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Whether `dist/` still reflects `src/`.
 *
 * Editing a package and forgetting to rebuild produces the most confusing class
 * of bug there is: the code on screen is not the code that ran. `hexa doctor`
 * runs from `dist`, so it is in the perfect position to notice, and it compares
 * the newest source file in every package against that package's newest build
 * artefact. Only meaningful in a source checkout; an installed copy has no src
 * and says so.
 */
async function checkBuildFreshness(): Promise<Check> {
  const root = repoRoot();
  if (!root) {
    return { id: 'build', label: 'Build output', status: 'ok', detail: 'installed package — nothing to rebuild' };
  }

  const stale: string[] = [];
  const unbuilt: string[] = [];

  let packages: string[] = [];
  try {
    packages = (await fs.readdir(path.join(root, 'packages'), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return { id: 'build', label: 'Build output', status: 'ok', detail: 'no packages/ directory — nothing to compare' };
  }

  for (const name of packages) {
    const pkg = path.join(root, 'packages', name);
    const newestSrc = await newestMtime(path.join(pkg, 'src'), (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    if (newestSrc === undefined) continue;

    const newestDist = await newestMtime(path.join(pkg, 'dist'), (f) => f.endsWith('.js'));
    if (newestDist === undefined) {
      unbuilt.push(name);
      continue;
    }
    if (newestSrc > newestDist) stale.push(name);
  }

  if (unbuilt.length > 0) {
    return {
      id: 'build',
      label: 'Build output',
      status: 'fail',
      detail: `never built: ${unbuilt.join(', ')}`,
      fix: 'pnpm build',
    };
  }

  if (stale.length > 0) {
    return {
      id: 'build',
      label: 'Build output',
      status: 'warn',
      detail: `${stale.length} package(s) changed since the last build: ${stale.slice(0, 6).join(', ')}`,
      fix: 'pnpm build',
      notes: ['You are running the previously compiled code, so edits you have made are not in effect yet.'],
    };
  }

  return { id: 'build', label: 'Build output', status: 'ok', detail: `up to date for ${packages.length} package(s)` };
}

/** The newest mtime under `dir`, or undefined when there is nothing to look at. */
async function newestMtime(dir: string, accept: (file: string) => boolean): Promise<number | undefined> {
  let newest: number | undefined;
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (accept(entry.name)) {
        const { mtimeMs } = await fs.stat(full);
        if (newest === undefined || mtimeMs > newest) newest = mtimeMs;
      }
    }
  };
  await walk(dir);
  return newest;
}

/** Walk up from this file to the workspace root, or undefined when installed. */
function repoRoot(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    dir = path.dirname(dir);
    if (path.basename(dir) === 'packages') {
      const root = path.dirname(dir);
      return root;
    }
  }
  return undefined;
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
    // The repo ships a fetcher for exactly these families; telling somebody to
    // go and find them by hand when one command does it is worse than useless.
    fix: 'npx tsx scripts/fetch-fonts.ts   # downloads the OFL families and registers them with fontconfig',
    notes: [
      'Text is measured with the intended font and drawn with a substitute, so long headlines can overflow their slot — clipped words are the usual symptom.',
      `Offline? Download those families from fonts.google.com and drop the .ttf files into ${fonts.directory ?? 'assets/fonts/'}`,
      fonts.registered.length > 0 ? `Currently available: ${fonts.registered.join(', ')}` : 'No fonts are registered at all.',
    ],
  };
}

/** Where the sidecar is documented to listen, when it is not where we looked. */
const SIDECAR_PORTS = [8765, 8000, 8001];

async function checkVision(ctx: CliContext): Promise<Check> {
  const endpoint = ctx.visionEndpoint ?? process.env['HEXA_VISION_URL'] ?? process.env['HEXA_VISION_ENDPOINT'] ?? 'http://127.0.0.1:8765';
  if (await reachable(endpoint)) {
    return {
      id: 'vision',
      label: 'Vision sidecar',
      status: 'ok',
      detail: `reachable at ${endpoint}`,
      notes: ['Enables alpha-matted cutouts, face-anchored placement, and identity verification of the finished render.'],
    };
  }

  // The sidecar answering on a *different* port is the most confusing outcome
  // there is: the service is running, the instructions were followed, and Hexa
  // still says it is missing. Finding it and naming the fix is worth three
  // requests to localhost.
  const elsewhere = await findSidecar(endpoint);
  if (elsewhere) {
    return {
      id: 'vision',
      label: 'Vision sidecar',
      status: 'warn',
      detail: `running at ${elsewhere}, but Hexa is configured for ${endpoint}`,
      fix: `Point Hexa at it: export HEXA_VISION_URL=${elsewhere}   (or pass --vision ${elsewhere})`,
      notes: ['Until then Hexa behaves as though the sidecar were down: no matted cutouts, and identity cannot be verified.'],
    };
  }

  return {
    id: 'vision',
    label: 'Vision sidecar',
    status: 'warn',
    detail: `not reachable at ${endpoint}`,
    fix: 'Start it with: ./services/vision/run.sh   (then set HEXA_VISION_URL to the address it prints)',
    notes: [
      'Optional: it needs Python 3.10+ and downloads model weights on first run.',
      'Without it: no alpha-matted cutouts (subjects composite with their background), no face-anchored placement, and identity cannot be verified.',
      'Renders still succeed — the identity gate warns rather than silently passing.',
    ],
  };
}

async function reachable(endpoint: string): Promise<boolean> {
  try {
    const client = await visionAdapter.createVisionClient({ endpoint });
    return await visionAdapter.isAvailable(client);
  } catch {
    return false;
  }
}

/** Try the ports the sidecar is documented to use, other than the configured one. */
async function findSidecar(configured: string): Promise<string | undefined> {
  let configuredPort: string | undefined;
  try {
    configuredPort = new URL(configured).port;
  } catch {
    configuredPort = undefined;
  }

  for (const port of SIDECAR_PORTS) {
    if (String(port) === configuredPort) continue;
    const candidate = `http://127.0.0.1:${port}`;
    if (await reachable(candidate)) return candidate;
  }
  return undefined;
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
  const onDisk = await photoSize(library.root);
  const size = onDisk.files > 0
    ? `${formatBytes(onDisk.bytes)} of photography in ${onDisk.files} file(s)`
    : 'no photographs on disk';

  checks.push({
    id: 'library',
    label: 'Asset library',
    status: stats.total === 0 ? 'warn' : 'ok',
    detail: stats.total === 0
      ? `empty — ${library.root} (${size})`
      : `${stats.total} asset(s), ${stats.cleared} cleared, ${size} — ${library.root}`,
    fix: stats.total === 0
      ? 'hexa assets ingest ./photos --player <handle> --license press-kit --source "..."'
      : stats.cleared === 0
        ? 'Nothing is cleared for publishing. Read the licences, then: hexa assets clear <assetId>'
        : undefined,
    notes: stats.total === 0
      ? ['Hexa ships no player photography — see docs/IDENTITY.md for where to source it legitimately.',
         'Until then every subject renders as a schematic placeholder silhouette, and the identity gate has nothing to verify against.']
      : // Manifest entries whose files vanished are the other half of "size":
        // the count comes from the manifest, the bytes come from the disk.
        onDisk.files === 0
          ? ['The manifest lists assets but the directory is empty — run `hexa assets prune` to drop dead entries.']
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

    const shown = rows.slice(0, 6);
    if (rows.length > shown.length) shown.push(`… and ${rows.length - shown.length} more team(s)`);

    checks.push({
      id: 'coverage',
      label: 'Reference coverage',
      status: rows.length === 0 ? 'ok' : 'warn',
      detail: rows.length === 0
        ? `every roster covered (${covered} team(s))`
        : `${rows.length} of ${rows.length + covered} team(s) have gaps`,
      fix: rows.length === 0 ? undefined : 'hexa assets coverage --missing   # the full list',
      notes: shown,
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

/** Image extensions the library can ingest. */
const PHOTO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
/** Engine assets that share the root but are not photographs. */
const NOT_PHOTOGRAPHS = new Set(['fonts', 'luts', 'cache', '.git']);

/**
 * How much photography is actually on disk.
 *
 * Counting every byte under the root would count the bundled fonts and LUTs,
 * which live there too, and report a "1.6 MB asset library" to somebody who has
 * no photographs at all. Only image files outside the engine directories count.
 */
async function photoSize(root: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (NOT_PHOTOGRAPHS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          bytes += (await fs.stat(full)).size;
          files++;
        } catch {
          // Vanished mid-walk; not worth failing a diagnostic over.
        }
      }
    }
  };

  await walk(root, 0);
  return { bytes, files };
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
    ctx.say(` ${ui.dim('Fix the ✖ lines above in order; each one names the command that repairs it.')}`);
  } else if (warned > 0) {
    ctx.say(` ${ui.ok(`${glyph.ok} Nothing is broken.`)} ${ui.dim(`${warned} warning(s) — the tool works, with reduced quality.`)}`);
    ctx.say(` ${ui.dim(`${glyph.arrow} Next: ${ui.bold('hexa gen Peyz Viper --title "RIVALS"')} — it will render with placeholder silhouettes until you add photographs.`)}`);
  } else {
    ctx.say(` ${ui.ok(`${glyph.ok} Everything checks out.`)} ${ui.dim('Try: hexa gen Peyz Viper --variants 4')}`);
  }
}

export { assetsAdapter };
