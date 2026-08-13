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
import { clearActiveSpinner, createSpinner, type Spinner } from './ui/progress.js';

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
  // user asked. picocolors honours NO_COLOR for its own helpers, but `ui.hex`
  // and the team swatches write 24-bit escapes by hand, so the environment
  // variable has to be checked here as well or `NO_COLOR=1 hexa teams` still
  // emits colour.
  const color = opts.color !== false
    && !json
    && !process.env['NO_COLOR']
    && (process.stdout.isTTY ?? false);
  const ui = createUi(color);

  // In --json mode the logger would interleave with the document; silence it
  // unless the user explicitly asked for a level.
  const logLevel: LogLevel = opts.log ?? (json ? 'silent' : (process.env['HEXA_LOG'] as LogLevel | undefined) ?? 'info');
  const logger = spinnerAware(createLogger(logLevel, 'hexa', color));

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
      // The pipeline builds its own logger, which decides on colour from
      // `process.stdout.isTTY` alone — so `--no-color` and `NO_COLOR` would be
      // honoured by everything the CLI prints and ignored by everything the
      // pipeline prints. Handing it ours makes one decision hold for the whole
      // process.
      depsPromise ??= createDeps({
        assetRoot: opts.assets,
        visionEndpoint: opts.vision,
        logLevel,
      }).then((built) => ({ ...built, logger }));
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
 * Once the fatal error has been printed, nothing else may speak.
 *
 * Subjects are prepared concurrently, so one failing while another is still
 * working means a warning about the *other* player lands underneath the error
 * that ended the run — the last line on screen ends up being unrelated advice.
 * The command is over; late log lines have nowhere useful to go.
 */
let quenched = false;

export function quenchLogs(): void {
  quenched = true;
}

/**
 * A logger that gets out of the spinner's way.
 *
 * The pipeline logs from inside the render the spinner is animating, and both
 * write to the same row: unwrapped, a placeholder warning arrives as
 * `⠋ rendering Peyz…WARN [hexa:subject:0] No photographs of Peyz`. Blanking the
 * line first costs one escape sequence and the spinner redraws on its next
 * frame, 80ms later.
 */
function spinnerAware(inner: Logger): Logger {
  const yieldLine = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A): void => {
    if (quenched) return;
    clearActiveSpinner();
    fn(...args);
  };

  const wrapped: Logger = {
    level: inner.level,
    error: yieldLine((m: string, meta?: unknown) => inner.error(m, meta)),
    warn: yieldLine((m: string, meta?: unknown) => inner.warn(m, meta)),
    info: yieldLine((m: string, meta?: unknown) => inner.info(m, meta)),
    debug: yieldLine((m: string, meta?: unknown) => inner.debug(m, meta)),
    trace: yieldLine((m: string, meta?: unknown) => inner.trace(m, meta)),

    // `stage` writes its own timing line from inside the core logger, where the
    // wrapper cannot reach it, so it is re-expressed here in terms of the
    // methods that do clear the line. Same levels, same shape.
    async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const started = performance.now();
      try {
        const out = await fn();
        wrapped.debug(`${name} ${(performance.now() - started).toFixed(0)}ms`);
        return out;
      } catch (error) {
        wrapped.error(`${name} failed after ${(performance.now() - started).toFixed(0)}ms`);
        throw error;
      }
    },

    // Children are what the pipeline actually logs through, so the wrapper has
    // to survive `logger.child('subject:0')`.
    child: (prefix) => spinnerAware(inner.child(prefix)),
  };

  return wrapped;
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
