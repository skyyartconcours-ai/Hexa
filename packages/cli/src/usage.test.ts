/**
 * The usage-error boundary.
 *
 * A mistyped command is the most common thing that happens to a CLI, and the
 * reply is the first prose most users read. These tests pin the two halves of
 * that reply: commander's message never reaches the terminal on its own (or the
 * fault gets stated twice, in two voices), and the replacement carries a usage
 * line plus an example taken from the command's own help.
 */

import { describe, expect, it } from 'vitest';
import { buildProgram, drainCommanderOutput, usageContext } from './program.js';
import { EXIT_USAGE } from './exit.js';

/** Parse argv against a fresh program and hand back the commander error. */
async function parseFailure(argv: string[]): Promise<{ code?: string; buffered: string }> {
  drainCommanderOutput();
  const program = buildProgram();
  try {
    await program.parseAsync(['node', 'hexa', ...argv]);
    return { buffered: drainCommanderOutput() };
  } catch (e) {
    return { code: (e as { code?: string }).code, buffered: drainCommanderOutput() };
  }
}

describe('commander output capture', () => {
  it('buffers a parse failure instead of printing it', async () => {
    const { code, buffered } = await parseFailure(['gen']);
    expect(code).toBe('commander.missingArgument');
    expect(buffered).toMatch(/missing required argument/);
  });

  it('empties the buffer once drained, so the next command starts clean', async () => {
    await parseFailure(['gen']);
    expect(drainCommanderOutput()).toBe('');
  });

  it('captures the suggestion commander makes for a near-miss flag', async () => {
    const { buffered } = await parseFailure(['players', '--tema', 'T1']);
    expect(buffered).toMatch(/unknown option/);
    expect(buffered).toMatch(/--team/);
  });
});

describe('usageContext', () => {
  it('describes the command that was being attempted', () => {
    const { usage, example } = usageContext(['node', 'hexa', 'gen']);
    expect(usage).toBe('hexa gen [options] <left> [right]');
    expect(example).toMatch(/^hexa gen /);
  });

  it('reaches into subcommands', () => {
    const { usage, example } = usageContext(['node', 'hexa', 'assets', 'ingest']);
    expect(usage).toBe('hexa assets ingest [options] <dir>');
    expect(example).toMatch(/^hexa assets ingest /);
  });

  it('takes the example from the command help, so the two cannot drift', () => {
    const help: string[] = [];
    const gen = buildProgram().commands.find((c) => c.name() === 'gen');
    (gen as unknown as { emit(e: string, c: unknown): boolean })
      .emit('afterHelp', { error: false, command: gen, write: (s: string) => help.push(s) });

    const { example } = usageContext(['node', 'hexa', 'gen']);
    expect(help.join('')).toContain(example);
  });

  it('falls back to the top-level shape when no command was named', () => {
    const { usage, example } = usageContext(['node', 'hexa', '--nonsense']);
    expect(usage).toBe('hexa <command> [options]');
    expect(example).toBeTruthy();
  });

  it('finds the command wherever it sits among the flags', () => {
    expect(usageContext(['node', 'hexa', '--json', 'qa']).usage).toBe('hexa qa [options] <image>');
  });
});

describe('exit codes', () => {
  it('treats a malformed command line as a bad request', () => {
    expect(EXIT_USAGE).toBe(2);
  });
});

describe('the help banner', () => {
  it('documents the exit codes a script would branch on', () => {
    const help = buildProgram().helpInformation();
    // The banner is added through the help event, so ask for it the same way.
    const chunks: string[] = [];
    const program = buildProgram();
    (program as unknown as { emit(e: string, c: unknown): boolean })
      .emit('afterHelp', { error: false, command: program, write: (s: string) => chunks.push(s) });

    const text = help + chunks.join('');
    expect(text).toMatch(/Exit codes/);
    expect(text).toMatch(/130/);
  });
});
