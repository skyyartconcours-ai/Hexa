#!/usr/bin/env node
/**
 * The `hexa` entry point.
 *
 * Its whole job is the boundary: parse, run, and turn whatever comes back into
 * an exit code and a message a person can act on. Nothing else lives here, so
 * the interesting parts stay testable without spawning a process.
 */

import { buildProgram } from './program.js';
import { EXIT_INTERRUPTED, EXIT_OK, describeError } from './exit.js';
import { createUi } from './ui/style.js';

async function main(argv: string[]): Promise<number> {
  const program = buildProgram();

  try {
    await program.parseAsync(argv);
    // A command may set process.exitCode to signal a soft failure (QA did not
    // pass, a batch had losses) without throwing.
    return typeof process.exitCode === 'number' ? process.exitCode : EXIT_OK;
  } catch (error) {
    // `--help` and `--version` come back through the error channel because of
    // exitOverride; they are successful outcomes, not failures.
    const commanderCode = (error as { code?: string }).code;
    if (commanderCode === 'commander.helpDisplayed' || commanderCode === 'commander.help' || commanderCode === 'commander.version') {
      return EXIT_OK;
    }
    if (commanderCode === 'commander.executeSubCommandAsync') return EXIT_OK;
    // Commander already printed its own message for these (unknown option,
    // missing argument); re-printing it would just be noise.
    if (typeof commanderCode === 'string' && commanderCode.startsWith('commander.')) {
      return (error as { exitCode?: number }).exitCode ?? 1;
    }

    reportError(error, argv);
    return describeError(error).exitCode;
  }
}

function reportError(error: unknown, argv: string[]): void {
  const jsonMode = argv.includes('--json');
  const ui = createUi(!jsonMode && process.stderr.isTTY === true && !argv.includes('--no-color'));
  const rendered = describeError(error);

  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ error: rendered }, null, 2)}\n`);
    return;
  }

  process.stderr.write(`\n${ui.fail('✖')} ${ui.bold(rendered.message)}\n`);
  if (rendered.hint) process.stderr.write(`  ${ui.cyan('→')} ${rendered.hint}\n`);

  // `didYouMean` suggestions travel in details and are the single most useful
  // thing to surface for a typo, so they get their own line.
  const suggestions = rendered.details?.['suggestions'];
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    process.stderr.write(`  ${ui.dim(`did you mean: ${suggestions.join(', ')}`)}\n`);
  }

  process.stderr.write(`  ${ui.dim(`${rendered.code} (exit ${rendered.exitCode})`)}\n\n`);

  if (argv.includes('--log') && error instanceof Error && error.stack) {
    process.stderr.write(`${ui.dim(error.stack)}\n`);
  }
}

process.on('SIGINT', () => {
  process.stderr.write('\n');
  process.exit(EXIT_INTERRUPTED);
});

// An unhandled rejection anywhere in the pipeline should still exit non-zero
// with something readable rather than Node's default trace.
process.on('unhandledRejection', (reason) => {
  reportError(reason, process.argv);
  process.exit(describeError(reason).exitCode);
});

process.exitCode = await main(process.argv);
