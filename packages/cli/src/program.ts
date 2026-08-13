/**
 * Program construction.
 *
 * Kept separate from `bin.ts` and free of side effects so tests can build the
 * program, parse an argv, and assert on what came out without spawning a process
 * or rendering anything.
 */

import { Command, Option } from 'commander';
import { HexaError } from '@hexa/core';
import { registerGen, registerMake } from './commands/gen.js';
import { registerPlayers, registerTeams, registerTemplates } from './commands/browse.js';
import { registerAssets } from './commands/assets.js';
import { registerDoctor } from './commands/doctor.js';
import { registerBatch, registerPreview, registerProviders, registerQa } from './commands/tools.js';

export const VERSION = '0.1.0';

/** What commander wanted to say about a parse failure, before we reword it. */
const commanderErrors: string[] = [];

/** Take (and clear) commander's buffered error text. */
export function drainCommanderOutput(): string {
  const text = commanderErrors.join('');
  commanderErrors.length = 0;
  return text;
}

const BANNER = `
Cinematic esports thumbnails with identity-locked player likeness.

Every face comes from a licensed photograph of that player, and the render is
rejected if it does not verify. Backgrounds, light and atmosphere are generated;
people never are.

Get started:
  $ hexa doctor                                  what is installed, what is missing
  $ hexa players                                 who is in the roster
  $ hexa templates                               what you can make
  $ hexa gen Peyz Viper --title "RIVALS"         make one

With no photographs on file, subjects render as schematic placeholders and
everything still works — see \`hexa assets\` to add references.

Exit codes, for scripting:
  0   done          2      the request or the command line was wrong
  3–7 not found     8–9    made, but failed quality (identity, QA)
  10–12 provider or sidecar problem      13–15 local failure (render, fonts, disk)
  130 interrupted — any half-written image is removed before exit`;

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('hexa')
    .description('Cinematic esports thumbnail generator')
    .version(VERSION, '-v, --version', 'print the version')
    .addHelpText('after', BANNER)
    // Errors are rendered by `bin.ts` with a hint and a stable exit code, so
    // commander must hand control back rather than calling process.exit itself.
    .exitOverride()
    .configureOutput({
      // Parse failures are buffered rather than printed: `bin.ts` re-renders
      // them with a usage line and an example, and commander printing first
      // would mean the same fault twice in two different voices.
      writeErr: (str) => void commanderErrors.push(str),
      writeOut: (str) => process.stdout.write(str),
    })
    .showSuggestionAfterError(true)
    .showHelpAfterError('(run `hexa --help` for the full list of commands)');

  // ── global options ─────────────────────────────────────────────────────────
  program
    .addOption(
      new Option('--log <level>', 'log verbosity')
        .choices(['silent', 'error', 'warn', 'info', 'debug', 'trace'])
        .default(undefined, 'info'),
    )
    .option('--assets <dir>', 'asset library root (default: ./assets, or $HEXA_ASSETS)')
    .option('--vision <url>', 'vision sidecar endpoint (default: $HEXA_VISION_URL or http://127.0.0.1:8000)')
    .option('--seed <n>', 'deterministic seed; omit to derive one from the request', parseSeed)
    .option('--json', 'machine-readable output on stdout')
    .option('--no-color', 'disable colour output');

  registerGen(program);
  registerMake(program);
  registerPlayers(program);
  registerTeams(program);
  registerTemplates(program);
  registerAssets(program);
  registerDoctor(program);
  registerPreview(program);
  registerBatch(program);
  registerProviders(program);
  registerQa(program);

  return program;
}

/** Seeds are unsigned 32-bit; anything else would not round-trip a render. */
export function parseSeed(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HexaError('INVALID_REQUEST', `--seed expects a number, got "${value}"`, {
      hint: 'A seed is any integer — `--seed 1234`. It makes a render repeatable: the same seed and the same request produce the same image. ' +
        'Omit it and Hexa derives one, printed with every variant.',
      details: { value },
    });
  }
  return Math.trunc(n) >>> 0;
}

/**
 * The usage line and a worked example for whichever command argv was aiming at.
 *
 * The example is lifted from the command's own `--help` text rather than
 * duplicated here, so it cannot drift: whatever the help promises is what a
 * failed parse suggests.
 */
export function usageContext(argv: readonly string[]): { usage?: string; example?: string } {
  const program = buildProgram();
  const names = new Set(program.commands.map((c) => c.name()));

  // argv is [node, bin, command, ...]; the first token that names a command
  // wins, so `hexa --json gen` and `hexa gen --json` behave the same.
  const name = argv.slice(2).find((token) => names.has(token));
  const command = name ? program.commands.find((c) => c.name() === name) : undefined;
  if (!command) {
    return { usage: 'hexa <command> [options]', example: 'hexa gen Peyz Viper --title "RIVALS"' };
  }

  const sub = subcommandFor(command, argv);
  const target = sub ?? command;
  const path = sub ? `hexa ${command.name()} ${sub.name()}` : `hexa ${command.name()}`;

  return {
    usage: `${path} ${target.usage()}`,
    example: firstExample(target) ?? firstExample(command),
  };
}

function subcommandFor(command: Command, argv: readonly string[]): Command | undefined {
  const names = new Set(command.commands.map((c) => c.name()));
  const name = argv.slice(2).find((token) => names.has(token));
  return name ? command.commands.find((c) => c.name() === name) : undefined;
}

/**
 * The first `$ hexa …` line in a command's help text.
 *
 * The examples live in `addHelpText('after', …)`, which commander renders by
 * emitting an event rather than storing a string, so `helpInformation()` does
 * not contain them. Emitting the event with our own sink collects the same text
 * the user would see under `--help`, which is the point: a failed parse should
 * suggest exactly what the help promises, with no second copy to keep in sync.
 */
function firstExample(command: Command): string | undefined {
  const chunks: string[] = [];
  try {
    // `Command` is an EventEmitter at runtime; its public typings do not say so.
    const emitter = command as unknown as { emit(event: string, context: unknown): boolean };
    emitter.emit('afterHelp', { error: false, command, write: (s: string) => chunks.push(s) });
  } catch {
    // No help text registered, or a commander version that stores it elsewhere.
  }

  const match = /^\s*\$\s+(hexa .+?)\s*$/m.exec(chunks.join(''));
  return match?.[1] ?? FALLBACK_EXAMPLES[command.name()];
}

/** For commands whose help carries no `$ hexa …` line. */
const FALLBACK_EXAMPLES: Record<string, string> = {
  gen: 'hexa gen Peyz Viper --title "RIVALS"',
  players: 'hexa players --team T1',
  teams: 'hexa teams',
  templates: 'hexa templates --category versus',
  doctor: 'hexa doctor',
  providers: 'hexa providers',
};

/** Every command name the program exposes. Used by tests and completions. */
export function commandNames(program: Command): string[] {
  return program.commands.map((c) => c.name()).sort();
}
