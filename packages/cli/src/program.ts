/**
 * Program construction.
 *
 * Kept separate from `bin.ts` and free of side effects so tests can build the
 * program, parse an argv, and assert on what came out without spawning a process
 * or rendering anything.
 */

import { Command, Option } from 'commander';
import { registerGen, registerMake } from './commands/gen.js';
import { registerPlayers, registerTeams, registerTemplates } from './commands/browse.js';
import { registerAssets } from './commands/assets.js';
import { registerDoctor } from './commands/doctor.js';
import { registerBatch, registerPreview, registerProviders, registerQa } from './commands/tools.js';

export const VERSION = '0.1.0';

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
everything still works — see \`hexa assets\` to add references.`;

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
      writeErr: (str) => process.stderr.write(str),
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
    throw new Error(`--seed expects a number, got "${value}"`);
  }
  return Math.trunc(n) >>> 0;
}

/** Every command name the program exposes. Used by tests and completions. */
export function commandNames(program: Command): string[] {
  return program.commands.map((c) => c.name()).sort();
}
