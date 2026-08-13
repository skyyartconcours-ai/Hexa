#!/usr/bin/env node
/**
 * The `hexa` entry point.
 *
 * Its whole job is the boundary: parse, run, and turn whatever comes back into
 * an exit code and a message a person can act on. Nothing else lives here, so
 * the interesting parts stay testable without spawning a process.
 *
 * Three boundary conditions are handled here and nowhere else, because they are
 * about the *process* rather than about any one command:
 *
 *  - A usage mistake (missing argument, bad choice, unknown flag) is rendered in
 *    the same shape as every other Hexa error, with an example pulled from the
 *    command's own help, and exits 2 — "the request was wrong" — rather than
 *    commander's undifferentiated 1.
 *  - Ctrl-C sweeps any half-written image out of the output directory before it
 *    exits 130, so an interrupted render never leaves a corrupt PNG behind.
 *  - A closed pipe (`hexa players | head -3`) is a normal end, not a crash.
 */

import { buildProgram, drainCommanderOutput, usageContext } from './program.js';
import { EXIT_INTERRUPTED, EXIT_OK, EXIT_USAGE, describeError } from './exit.js';
import { sweepPartialOutputs } from './interrupt.js';
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
      // Help and version print through `writeOut`; nothing should be waiting on
      // the error channel, and if it is, it is the after-error hint we replace.
      drainCommanderOutput();
      return EXIT_OK;
    }
    if (commanderCode === 'commander.executeSubCommandAsync') return EXIT_OK;
    if (typeof commanderCode === 'string' && commanderCode.startsWith('commander.')) {
      return reportUsageError(error, argv);
    }

    reportError(error, argv);
    return describeError(error).exitCode;
  }
}

/**
 * Render a commander parse failure the way Hexa renders everything else.
 *
 * Commander's own text is accurate but bare: "error: missing required argument
 * 'left'" tells you what is absent, never what a correct command looks like. Its
 * buffered output is drained (so it cannot print twice) and re-emitted with a
 * usage line and a working example lifted from that command's help.
 */
function reportUsageError(error: unknown, argv: string[]): number {
  const buffered = drainCommanderOutput();
  const jsonMode = argv.includes('--json');
  const ui = createUi(!jsonMode && process.stderr.isTTY === true && !argv.includes('--no-color') && !process.env['NO_COLOR']);

  // "error: unknown option '--tema'\n(Did you mean --team?)\n" — the first line
  // is the fault, anything after it is commander's own suggestion.
  const lines = buffered.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => l.startsWith('error:')) ?? lines[0] ?? 'That command could not be parsed';
  const message = first.replace(/^error:\s*/, '');
  const extras = lines.filter((l) => l !== first && !l.startsWith('(run `hexa'));

  const { usage, example } = usageContext(argv);

  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ error: { code: 'INVALID_REQUEST', exitCode: EXIT_USAGE, message, usage, example } }, null, 2)}\n`);
    return EXIT_USAGE;
  }

  process.stderr.write(`\n${ui.fail('✖')} ${ui.bold(capitalise(message))}\n`);
  for (const extra of extras) process.stderr.write(`  ${ui.dim(extra.replace(/^\(|\)$/g, ''))}\n`);
  if (usage) process.stderr.write(`  ${ui.cyan('→')} usage: ${usage}\n`);
  if (example) process.stderr.write(`  ${ui.cyan('→')} for example: ${ui.bold(example)}\n`);
  process.stderr.write(`  ${ui.dim(`INVALID_REQUEST (exit ${EXIT_USAGE})`)}\n\n`);

  return EXIT_USAGE;
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function reportError(error: unknown, argv: string[]): void {
  const jsonMode = argv.includes('--json');
  const ui = createUi(!jsonMode && process.stderr.isTTY === true && !argv.includes('--no-color') && !process.env['NO_COLOR']);
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

/**
 * Interrupt handling.
 *
 * The sweep is what makes Ctrl-C safe rather than merely fast: an in-flight
 * `writeFile` is unlinked before the process dies, so the directory is left with
 * finished images or nothing at all. A second Ctrl-C skips even that.
 */
let interrupting = false;
function onInterrupt(signal: NodeJS.Signals): void {
  if (interrupting) process.exit(EXIT_INTERRUPTED);
  interrupting = true;

  const ui = createUi(process.stderr.isTTY === true && !process.env['NO_COLOR']);
  const removed = sweepPartialOutputs();

  process.stderr.write(`\n${ui.warn('!')} interrupted (${signal})\n`);
  for (const file of removed) {
    process.stderr.write(`  ${ui.dim(`removed half-written ${file}`)}\n`);
  }
  process.stderr.write(`  ${ui.dim(removed.length > 0
    ? 'Nothing incomplete was left behind. Re-run to start over.'
    : 'No output had been written yet.')}\n`);

  process.exit(EXIT_INTERRUPTED);
}

process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

// `hexa players | head -3` closes the pipe early. That is the reader saying
// "enough", not a failure worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') process.exit(EXIT_OK);
    throw e;
  });
}

// An unhandled rejection anywhere in the pipeline should still exit non-zero
// with something readable rather than Node's default trace.
process.on('unhandledRejection', (reason) => {
  reportError(reason, process.argv);
  process.exit(describeError(reason).exitCode);
});

process.exitCode = await main(process.argv);
