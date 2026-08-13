/**
 * `hexa players`, `hexa teams`, `hexa templates` — the browse commands.
 *
 * These exist because the other commands take names as arguments, and a CLI that
 * demands an exact id without offering a way to find one is a CLI you have to
 * read the source of. All three support `--json` so they compose with scripts.
 */

import { Command, Option } from 'commander';
import type { Player, Role, Team, ThumbnailTemplate } from '@hexa/core';
import { data, templates as templatesAdapter } from '@hexa/pipeline/integration';
import { createContext, globalsFrom, type CliContext } from '../context.js';
import { renderTable } from '../ui/table.js';

export function registerPlayers(program: Command): void {
  program
    .command('players')
    .description('List or search the roster')
    .argument('[query]', 'fuzzy search over handles, names and aliases')
    .option('--team <tag>', 'filter to one team (tag, name or id)')
    .addOption(new Option('--role <role>', 'filter by role').choices(['top', 'jungle', 'mid', 'bot', 'support', 'coach', 'staff']))
    .option('--region <region>', 'filter by region, e.g. KR, EU, NA')
    .option('--all', 'include inactive/retired players')
    .option('--limit <n>', 'maximum rows', (v) => Number.parseInt(v, 10), 50)
    .addHelpText('after', `
Examples:
  ${'$'} hexa players                     # the whole active roster
  ${'$'} hexa players peyz                # fuzzy search
  ${'$'} hexa players --team T1 --role mid
  ${'$'} hexa players --json | jq -r '.[].handle'`)
    .action(async (query: string | undefined, o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const players = await findPlayers(query, o);

      if (ctx.json) {
        ctx.emitJson(players.map(serialisePlayer));
        return;
      }
      if (players.length === 0) {
        ctx.say(ctx.ui.warn(`No players matched.${query ? ` Try a shorter query than "${query}".` : ''}`));
        return;
      }

      const teams = new Map((await data.allTeams()).map((t) => [t.id, t]));
      ctx.say(renderTable(
        players,
        [
          { header: 'HANDLE', value: (p) => ctx.ui.bold(p.handle), max: 18 },
          { header: 'TEAM', value: (p) => colouredTag(ctx, teams.get(p.teamId)), max: 10 },
          { header: 'ROLE', value: (p) => p.role, max: 8 },
          { header: 'REGION', value: (p) => p.region, max: 6 },
          { header: 'NAME', value: (p) => ctx.ui.dim(p.fullName), max: 28 },
          { header: '', value: (p) => (p.active ? '' : ctx.ui.dim('(inactive)')) },
        ],
        { headerStyle: ctx.ui.dim, indent: 1 },
      ));
      ctx.say(`\n ${ctx.ui.dim(`${players.length} player(s)`)}`);
    });
}

async function findPlayers(query: string | undefined, o: Record<string, unknown>): Promise<Player[]> {
  const limit = (o['limit'] as number | undefined) ?? 50;
  const team = o['team'] as string | undefined;

  // A fuzzy query goes through the ranked search; filters go through the
  // structured lookup. Combining both means filtering the ranked results, which
  // keeps the ranking rather than re-sorting alphabetically.
  const base = query
    ? await data.searchPlayers(query, Math.max(limit, 100))
    : await data.listPlayers({
        teamId: team ? (await data.resolveTeam(team)).id : undefined,
        role: o['role'] as Role | undefined,
        region: o['region'] as Player['region'] | undefined,
        active: o['all'] === true ? undefined : true,
      });

  const resolvedTeam = query && team ? (await data.resolveTeam(team)).id : undefined;

  return base
    .filter((p) => (resolvedTeam ? p.teamId === resolvedTeam : true))
    .filter((p) => (query && o['role'] ? p.role === o['role'] : true))
    .filter((p) => (query && o['region'] ? p.region === o['region'] : true))
    .filter((p) => (o['all'] === true ? true : p.active))
    .slice(0, limit);
}

export function registerTeams(program: Command): void {
  program
    .command('teams')
    .description('List teams with their brand colours')
    .option('--region <region>', 'filter by region')
    .option('--league <league>', 'filter by league')
    .addHelpText('after', `
Examples:
  ${'$'} hexa teams
  ${'$'} hexa teams --region KR
  ${'$'} hexa teams --json | jq '.[] | {tag, primary: .colors.primary}'

Brand colours drive the whole palette: the left subject is rimmed in the right
team's colour and vice versa, which is what makes a versus composite read.`)
    .action(async (o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      let teams = [...(await data.allTeams())];
      if (o['region']) teams = teams.filter((t) => t.region === o['region']);
      if (o['league']) teams = teams.filter((t) => t.league === String(o['league']).toUpperCase());

      if (ctx.json) {
        ctx.emitJson(teams);
        return;
      }
      if (teams.length === 0) {
        ctx.say(ctx.ui.warn('No teams matched.'));
        return;
      }

      ctx.say(renderTable(
        teams,
        [
          { header: 'TAG', value: (t) => ctx.ui.bold(ctx.ui.hex(t.colors.primary, t.tag)), max: 8 },
          { header: 'NAME', value: (t) => t.name, max: 28 },
          { header: 'REGION', value: (t) => t.region, max: 6 },
          { header: 'LEAGUE', value: (t) => t.league, max: 7 },
          // Swatches beat hex codes: the point is what the colour looks like,
          // and truecolor blocks show that instantly.
          { header: 'PALETTE', value: (t) => swatches(ctx, t) },
        ],
        { headerStyle: ctx.ui.dim, indent: 1 },
      ));
      ctx.say(`\n ${ctx.ui.dim(`${teams.length} team(s) — swatches are primary, secondary, accent, dark, light`)}`);
    });
}

function swatches(ctx: CliContext, team: Team): string {
  const c = team.colors;
  const blocks = [c.primary, c.secondary, c.accent, c.dark, c.light].map((hex) => ctx.ui.swatch(hex)).join('');
  return `${blocks} ${ctx.ui.dim(c.primary)}`;
}

function colouredTag(ctx: CliContext, team: Team | undefined): string {
  if (!team) return ctx.ui.dim('—');
  return ctx.ui.hex(team.colors.primary, team.tag);
}

export function registerTemplates(program: Command): void {
  program
    .command('templates')
    .description('List the template library')
    .argument('[query]', 'filter by id, name or tag')
    .option('--category <category>', 'filter by category, e.g. versus, hero, drama')
    .option('--subjects <n>', 'only templates that take this many subjects', (v) => Number.parseInt(v, 10))
    .option('--aspect <preset>', 'only templates supporting this aspect')
    .option('--verbose', 'show whenToUse and the full tag list')
    .addHelpText('after', `
Examples:
  ${'$'} hexa templates
  ${'$'} hexa templates --category versus --verbose
  ${'$'} hexa templates --subjects 5          # 5v5 lineup layouts
  ${'$'} hexa preview versus-classic          # see one, with placeholders`)
    .action(async (query: string | undefined, o: Record<string, unknown>, command: Command) => {
      const ctx = createContext(globalsFrom(command));
      const list = await selectTemplates(query, o);

      if (ctx.json) {
        ctx.emitJson(list.map(serialiseTemplate));
        return;
      }
      if (list.length === 0) {
        ctx.say(ctx.ui.warn('No templates matched. Run `hexa templates` for the whole library.'));
        return;
      }

      ctx.say(renderTable(
        list,
        [
          { header: 'ID', value: (t) => ctx.ui.bold(t.id), max: 24 },
          { header: 'CATEGORY', value: (t) => ctx.ui.cyan(t.category), max: 12 },
          { header: 'SUBJECTS', value: (t) => subjectRange(t), align: 'right', max: 8 },
          { header: 'ASPECTS', value: (t) => ctx.ui.dim(t.aspects.join(', ')), max: 30 },
          { header: 'DESCRIPTION', value: (t) => t.description, max: o['verbose'] ? 200 : 44 },
        ],
        { headerStyle: ctx.ui.dim, indent: 1 },
      ));

      if (o['verbose']) {
        for (const t of list) {
          if (!t.whenToUse) continue;
          ctx.say(`\n ${ctx.ui.bold(t.id)}\n   ${ctx.ui.dim(`${ctx.glyph.arrow} ${t.whenToUse}`)}`);
          if (t.tags?.length) ctx.say(`   ${ctx.ui.dim(`tags: ${t.tags.join(', ')}`)}`);
        }
      }

      ctx.say(`\n ${ctx.ui.dim(`${list.length} template(s)${o['verbose'] ? '' : ' — add --verbose for when to use each'}`)}`);
    });
}

async function selectTemplates(query: string | undefined, o: Record<string, unknown>): Promise<ThumbnailTemplate[]> {
  const subjects = o['subjects'] as number | undefined;
  let list = subjects !== undefined
    ? await templatesAdapter.templatesForSubjectCount(subjects)
    : await templatesAdapter.listTemplates();

  const category = o['category'] as string | undefined;
  if (category) list = list.filter((t) => t.category === category);

  const aspect = o['aspect'] as ThumbnailTemplate['aspects'][number] | undefined;
  if (aspect) list = list.filter((t) => t.aspects.includes(aspect));

  if (query) {
    const q = query.toLowerCase();
    list = list.filter((t) =>
      t.id.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
    );
  }
  return list;
}

function subjectRange(t: ThumbnailTemplate): string {
  const { min, max } = t.subjects;
  return min === max ? String(min) : `${min}–${max}`;
}

function serialisePlayer(p: Player) {
  return {
    id: p.id,
    handle: p.handle,
    fullName: p.fullName,
    role: p.role,
    teamId: p.teamId,
    region: p.region,
    active: p.active,
    aliases: p.aliases,
  };
}

function serialiseTemplate(t: ThumbnailTemplate) {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    subjects: t.subjects,
    aspects: t.aspects,
    tags: t.tags,
    whenToUse: t.whenToUse,
  };
}
