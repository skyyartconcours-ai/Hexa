/**
 * Global options → the context every command runs in.
 *
 * Two things matter here. First, `--json` is contagious: it forces colour off,
 * silences the logger and routes human prose to stderr, so stdout carries
 * nothing but the JSON document a caller is piping into `jq`. Second, the
 * dependency set is built *lazily* — `hexa templates` should not open the asset
 * library or reach for the vision sidecar just to list template ids.
 */

import { createLogger } from '@hexa/core';
import type { LogLevel, Logger } from '@hexa/core';
import { createDeps } from '@hexa/pipeline';
import type { PipelineDeps } from '@hexa/pipeline';
import { createUi, glyphs, type Ui } from './ui/style.js';
import { createSpinner, type Spinner } from './ui/progress.js';

export interface GlobalOptions {
  log?: LogLevel;
  assets?: string;
  vision?: string;
  seed?: number;
  json?: boolean;
  /** commander sets this false for `--no-color`. */
  color?: boolean;
}

export interface CliContext {
  ui: Ui;
  glyph: ReturnType<typeof glyphs>;
  json: boolean;
  logLevel: LogLevel;
  logger: Logger;
  assetRoot?: string;
  visionEndpoint?: string;
  seed?: number;

  /** Print to stdout. In `--json` mode this is reserved for the JSON document. */
  out(line?: string): void;
  /** Human-facing prose. Goes to stderr so it never pollutes a pipe. */
  say(line?: string): void;
  /** Emit the machine-readable result and mark the document written. */
  emitJson(value: unknown): void;

  /** Build (once) the real pipeline dependencies. */
  deps(): Promise<PipelineDeps>;
  spinner(text?: string): Spinner;
}

export function createContext(opts: GlobalOptions): CliContext {
  const json = opts.json === true;
  // Colour off for --json (escape codes in a parsed stream) and whenever the
  // user asked. picocolors handles NO_COLOR and non-TTY on its own.
  const color = opts.color !== false && !json && (process.stdout.isTTY ?? false);
  const ui = createUi(color);

  // In --json mode the logger would interleave with the document; silence it
  // unless the user explicitly asked for a level.
  const logLevel: LogLevel = opts.log ?? (json ? 'silent' : (process.env['HEXA_LOG'] as LogLevel | undefined) ?? 'info');
  const logger = createLogger(logLevel, 'hexa', color);

  let depsPromise: Promise<PipelineDeps> | undefined;

  return {
    ui,
    glyph: glyphs(),
    json,
    logLevel,
    logger,
    assetRoot: opts.assets,
    visionEndpoint: opts.vision,
    seed: opts.seed,

    out(line = '') {
      process.stdout.write(`${line}\n`);
    },
    say(line = '') {
      if (json) return;
      process.stdout.write(`${line}\n`);
    },
    emitJson(value) {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    },

    deps() {
      depsPromise ??= createDeps({
        assetRoot: opts.assets,
        visionEndpoint: opts.vision,
        logLevel,
      });
      return depsPromise;
    },

    spinner(text) {
      // A spinner competes with log lines for the cursor, so it is only drawn
      // when the logger is quiet enough to leave the line alone.
      const quiet = logLevel === 'silent' || logLevel === 'error' || logLevel === 'warn' || logLevel === 'info';
      const s = createSpinner({ ui, enabled: !json && quiet });
      if (text) s.start(text);
      return s;
    },
  };
}

/**
 * Pull global options off whichever command is running.
 *
 * Commander keeps globals on the root command, so a subcommand has to ask for
 * them explicitly — `optsWithGlobals()` merges both. Wrapped here so every
 * command does it the same way.
 */
export function globalsFrom(command: { optsWithGlobals(): Record<string, unknown> }): GlobalOptions {
  const o = command.optsWithGlobals();
  return {
    log: o['log'] as LogLevel | undefined,
    assets: o['assets'] as string | undefined,
    vision: o['vision'] as string | undefined,
    seed: o['seed'] as number | undefined,
    json: o['json'] as boolean | undefined,
    color: o['color'] as boolean | undefined,
  };
}
