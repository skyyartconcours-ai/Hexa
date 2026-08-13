/**
 * `hexa assets` — curating the reference library.
 *
 * This is where the identity guarantee is actually maintained. Hexa ships no
 * player photography, so the quality of every render traces back to what an
 * operator ingested and cleared here. The subcommands are built around the two
 * questions that come up in practice: "what do I have?" (`list`, `stats`) and
 * "what am I missing?" (`coverage`).
 */

import path from 'node:path';
import { Command, Option } from 'commander';
import { HexaError } from '@hexa/core';
import type { AssetKind, LicenseKind, ReferenceAsset } from '@hexa/core';
import { assets as assetsAdapter, data } from '@hexa/pipeline/integration';
import type { AssetLibrary, CoverageReport } from '@hexa/pipeline/integration';
import { createContext, globalsFrom, type CliContext } from '../context.js';
import { formatBytes, renderTable } from '../ui/table.js';

const LICENSES: LicenseKind[] = ['press-kit', 'cc-by', 'cc-by-sa', 'cc0', 'owned', 'rights-managed', 'unverified'];
const KINDS: AssetKind[] = ['portrait', 'action', 'celebration', 'jersey', 'fullbody', 'logo', 'backplate'];

export function registerAssets(program: Command): void {
  const assets = program
    .command('assets')
    .description('Manage the licensed reference photo library')
    .addHelpText('after', `
The library is the whole ballgame: Hexa never invents a face, so every render is
only as good as the photographs you have licensed and cleared.

Examples:
  ${'$'} hexa assets ingest ./press-kit --player Peyz --license press-kit --source "LCK Media Kit 2026"
  ${'$'} hexa assets coverage              # who still has no references
  ${'$'} hexa assets list --player Peyz
  ${'$'} hexa assets stats`);

  assets
    .command('ingest')
    .description('Import a directory of images into the library')
    .argument('<dir>', 'directory to walk')
    .option('--player <handle>', 'attribute every image to this player')
    .option('--team <tag>', 'attribute every image to this team')
    .addOption(new Option('--kind <kind>', 'asset kind when it cannot be inferred').choices(KINDS))
    .addOption(new Option('--license <license>', 'licence for every image').choices(LICENSES).default('unverified'))
    .option('--source <text>', 'where these came from, e.g. "LCK Official Media Kit 2026 Spring"')
    .option('--credit <text>', 'attribution string to print with published output')
    .option('--photographer <name>', 'photographer credit')
    .option('--cleared', 'mark as human-cleared for publish-grade output')
    .option('--no-recursive', 'do not descend into subdirectories')
    .option('--tag <tag...>', 'extra tags')
    .addHelpText('after', `
Provenance is required, not optional: --source and --license are what make the
licence gate meaningful. Folder layout is used as a hint — refs/peyz/portrait/*
infers player "peyz" and kind "portrait".

Nothing is publish-grade until a human passes --cleared, having read the terms.`)
    .action(async (dir: string, o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const source = o['source'] as string | undefined;
      if (!source) {
        throw new HexaError('INVALID_REQUEST', 'Ingestion needs --source', {
          hint: 'Say where the photographs came from, e.g. --source "LCK Official Media Kit 2026 Spring". ' +
            'Provenance is what makes the licence gate meaningful.',
        });
      }

      const deps = await ctx.deps();
      const playerId = o['player'] ? (await data.resolvePlayer(String(o['player']))).id : undefined;
      const teamId = o['team'] ? (await data.resolveTeam(String(o['team']))).id : undefined;

      const spinner = ctx.spinner(`ingesting ${dir}…`);
      const result = await assetsAdapter.ingestDirectory(deps.library, path.resolve(dir), {
        playerId,
        teamId,
        kind: o['kind'] as AssetKind | undefined,
        license: o['license'] as LicenseKind,
        source,
        credit: o['credit'] as string | undefined,
        photographer: o['photographer'] as string | undefined,
        cleared: o['cleared'] === true,
        recursive: o['recursive'] !== false,
        tags: o['tag'] as string[] | undefined,
      });
      spinner.succeed(`ingested ${result.added.length} asset(s)`);

      if (ctx.json) {
        ctx.emitJson({
          added: result.added.map((a) => ({ id: a.id, path: a.path, kind: a.kind, playerId: a.playerId })),
          skipped: result.skipped,
          duplicates: result.duplicates,
          errors: result.errors,
        });
        return;
      }

      ctx.say(`\n  ${ctx.ui.ok(`${ctx.glyph.ok} ${result.added.length} added`)}`);
      if (result.duplicates.length) ctx.say(`  ${ctx.ui.dim(`${result.duplicates.length} near-duplicate(s) skipped`)}`);
      if (result.skipped.length) ctx.say(`  ${ctx.ui.dim(`${result.skipped.length} skipped`)}`);
      for (const e of result.errors.slice(0, 5)) ctx.say(`  ${ctx.ui.fail(ctx.glyph.fail)} ${path.basename(e.path)}: ${e.message}`);

      if (o['cleared'] !== true && result.added.length > 0) {
        ctx.say(`\n  ${ctx.ui.warn(`${ctx.glyph.warn} Not cleared for publishing.`)} ` +
          `Read the licence terms, then re-run with --cleared, or renders will warn.`);
      }
    });

  assets
    .command('list')
    .description('List assets in the library')
    .option('--player <handle>', 'filter to one player')
    .option('--team <tag>', 'filter to one team')
    .addOption(new Option('--kind <kind>', 'filter by kind').choices(KINDS))
    .option('--uncleared', 'only assets that are not publish-grade')
    .option('--limit <n>', 'maximum rows', (v) => Number.parseInt(v, 10), 40)
    .action(async (o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const deps = await ctx.deps();

      const playerId = o['player'] ? (await data.resolvePlayer(String(o['player']))).id : undefined;
      const teamId = o['team'] ? (await data.resolveTeam(String(o['team']))).id : undefined;

      let list = deps.library.find({ playerId, teamId, kind: o['kind'] as AssetKind | undefined });
      if (o['uncleared']) {
        const checked = await Promise.all(list.map(async (a) => ({ a, ok: await assetsAdapter.isPublishable(a) })));
        list = checked.filter((c) => !c.ok).map((c) => c.a);
      }
      list = list.slice(0, (o['limit'] as number | undefined) ?? 40);

      if (ctx.json) {
        ctx.emitJson(list);
        return;
      }
      if (list.length === 0) {
        ctx.say(ctx.ui.dim('No assets matched. Add some with `hexa assets ingest <dir> --player <handle> --source "..."`.'));
        return;
      }

      // Pair each asset with its publish verdict up front; asking inside the
      // cell renderer would mean an async lookup per row.
      const rows = await Promise.all(
        list.map(async (asset) => ({ asset, cleared: await assetsAdapter.isPublishable(asset) })),
      );

      ctx.say(renderTable(
        rows,
        [
          { header: 'ID', value: (r) => ctx.ui.bold(r.asset.id), max: 26 },
          { header: 'PLAYER', value: (r) => r.asset.playerId ?? ctx.ui.dim('—'), max: 14 },
          { header: 'KIND', value: (r) => r.asset.kind, max: 12 },
          { header: 'QUALITY', value: (r) => String(Math.round(r.asset.metrics?.quality ?? 0)), align: 'right', max: 7 },
          { header: 'LICENCE', value: (r) => r.asset.provenance.license, max: 15 },
          { header: 'CLEARED', value: (r) => (r.cleared ? ctx.ui.ok(ctx.glyph.ok) : ctx.ui.warn(ctx.glyph.warn)) },
        ],
        { headerStyle: ctx.ui.dim, indent: 1 },
      ));
      ctx.say(`\n ${ctx.ui.dim(`${list.length} asset(s)`)}`);
    });

  assets
    .command('stats')
    .description('Summarise the library')
    .action(async (_o: unknown, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const deps = await ctx.deps();
      const stats = deps.library.stats();

      if (ctx.json) {
        ctx.emitJson({ root: deps.library.root, ...stats });
        return;
      }

      ctx.say(`\n ${ctx.ui.heading('Asset library')} ${ctx.ui.dim(deps.library.root)}`);
      ctx.say(`   total        ${ctx.ui.bold(String(stats.total))}`);
      ctx.say(`   cleared      ${stats.cleared > 0 ? ctx.ui.ok(String(stats.cleared)) : ctx.ui.warn('0')}`);
      ctx.say(`   uncleared    ${stats.uncleared > 0 ? ctx.ui.warn(String(stats.uncleared)) : '0'}`);
      ctx.say(`   players      ${Object.keys(stats.byPlayer ?? {}).length}`);
      const kinds = Object.entries(stats.byKind ?? {}).sort((a, b) => b[1] - a[1]);
      if (kinds.length) ctx.say(`   by kind      ${kinds.map(([k, n]) => `${k} ${ctx.ui.bold(String(n))}`).join('  ')}`);

      if (stats.total === 0) {
        ctx.say(`\n ${ctx.ui.warn(`${ctx.glyph.warn} The library is empty.`)} Renders will use placeholder silhouettes.`);
        ctx.say(`   ${ctx.ui.dim('hexa assets ingest ./photos --player Peyz --license press-kit --source "..."')}`);
      }
    });

  assets
    .command('coverage')
    .description('Which players still need reference photographs')
    .option('--team <tag>', 'limit to one team')
    .option('--missing', 'only players with no usable references')
    .action(async (o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const deps = await ctx.deps();
      const rows = await coverageRows(deps.library, o['team'] as string | undefined);
      const shown = o['missing'] ? rows.filter((r) => r.count === 0) : rows;

      if (ctx.json) {
        ctx.emitJson(shown);
        return;
      }
      if (shown.length === 0) {
        ctx.say(ctx.ui.ok(`${ctx.glyph.ok} Every player in scope has references.`));
        return;
      }

      const handles = new Map((await data.allPlayers()).map((p) => [p.id, p.handle]));
      ctx.say(renderTable(
        shown,
        [
          { header: 'PLAYER', value: (r) => ctx.ui.bold(handles.get(r.playerId) ?? r.playerId), max: 18 },
          { header: 'ASSETS', value: (r) => (r.count === 0 ? ctx.ui.fail('0') : String(r.count)), align: 'right', max: 6 },
          { header: 'CLEARED', value: (r) => (r.cleared === 0 ? ctx.ui.warn('0') : ctx.ui.ok(String(r.cleared))), align: 'right', max: 7 },
          { header: 'BEST', value: (r) => String(Math.round(r.bestQuality ?? 0)), align: 'right', max: 5 },
          { header: 'GAPS', value: (r) => ctx.ui.dim((r.gaps ?? []).join(', ')), max: 50 },
        ],
        { headerStyle: ctx.ui.dim, indent: 1 },
      ));

      const empty = rows.filter((r) => r.count === 0).length;
      ctx.say(`\n ${ctx.ui.dim(`${rows.length} player(s); ${empty} with no references at all`)}`);
      if (empty > 0) {
        ctx.say(` ${ctx.ui.dim('Those render as placeholder silhouettes until you add photographs.')}`);
      }
    });

  assets
    .command('clear')
    .description('Mark an asset as human-cleared for publish-grade output')
    .argument('<assetId>', 'asset id (see `hexa assets list`)')
    .option('--undo', 'clear the flag again instead')
    .addHelpText('after', `
Clearing is a human act: it records that a person read the licence and accepted
its terms. Hexa will not do it for you, and publish-grade renders refuse
anything uncleared.`)
    .action(async (assetId: string, o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const deps = await ctx.deps();
      const asset = deps.library.get(assetId);
      if (!asset) throw notFound(assetId);

      const cleared = o['undo'] !== true;
      const updated = await deps.library.update(assetId, { provenance: { ...asset.provenance, cleared } });
      await deps.library.save();

      if (ctx.json) {
        ctx.emitJson({ id: updated.id, cleared });
        return;
      }
      ctx.say(cleared
        ? ctx.ui.ok(`${ctx.glyph.ok} ${assetId} cleared for publishing`)
        : ctx.ui.warn(`${ctx.glyph.warn} ${assetId} is no longer cleared`));

      if (cleared && asset.provenance.license === 'unverified') {
        ctx.say(ctx.ui.warn(`  ${ctx.glyph.warn} Its licence is still "unverified", so it stays blocked from publish-grade output.`));
        ctx.say(ctx.ui.dim('     Re-ingest with --license and --source to record where it came from.'));
      }
    });

  assets
    .command('prune')
    .description('Remove manifest entries whose files are gone')
    .option('--dry-run', 'list what would be removed without touching the manifest')
    .action(async (o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const deps = await ctx.deps();
      const dead = await findDeadEntries(deps.library);

      if (ctx.json) {
        ctx.emitJson({ dead: dead.map((a) => ({ id: a.id, path: a.path })), removed: o['dryRun'] !== true });
        return;
      }
      if (dead.length === 0) {
        ctx.say(ctx.ui.ok(`${ctx.glyph.ok} Every manifest entry has a file behind it.`));
        return;
      }

      for (const asset of dead) ctx.say(`  ${ctx.ui.dim(asset.id)} ${ctx.ui.dim(ctx.glyph.arrow)} ${asset.path}`);
      if (o['dryRun'] === true) {
        ctx.say(`\n ${ctx.ui.dim(`${dead.length} dead entr(ies). Re-run without --dry-run to remove them.`)}`);
        return;
      }
      for (const asset of dead) await deps.library.remove(asset.id);
      await deps.library.save();
      ctx.say(`\n ${ctx.ui.ok(`${ctx.glyph.ok} removed ${dead.length} dead entr(ies)`)}`);
    });
}

/** Coverage rows, optionally narrowed to one team's roster. */
async function coverageRows(library: AssetLibrary, team?: string): Promise<CoverageReport[]> {
  if (!team) return library.coverage();
  const resolved = await data.resolveTeam(team);
  const roster = await data.playersByTeam(resolved.id);
  return library.coverage(roster.map((p) => p.id));
}

async function findDeadEntries(library: AssetLibrary): Promise<ReferenceAsset[]> {
  const fs = await import('node:fs/promises');
  const dead: ReferenceAsset[] = [];
  for (const asset of library.all()) {
    try {
      await fs.access(library.resolvePath(asset, 'source'));
    } catch {
      dead.push(asset);
    }
  }
  return dead;
}

function notFound(assetId: string): HexaError {
  return new HexaError('ASSET_NOT_FOUND', `No asset with id "${assetId}"`, {
    hint: 'Run `hexa assets list` to see the ids in your library.',
    details: { assetId },
  });
}

export { formatBytes };
