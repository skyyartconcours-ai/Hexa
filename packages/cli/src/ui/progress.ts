/**
 * Spinners and progress bars.
 *
 * Renders are slow — segmentation alone is seconds per subject — and a silent
 * terminal during a 30-second job reads as a hang. Both widgets here are
 * strictly decorative and strictly opt-out: with no TTY, with `--json`, or under
 * a log level that is already printing lines, they become no-ops rather than
 * spraying escape codes into a pipe.
 */

import type { Ui } from './style.js';

export interface Spinner {
  start(text?: string): void;
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

export interface SpinnerOptions {
  ui: Ui;
  /** Force off — for --json, --log debug, or a non-TTY stream. */
  enabled?: boolean;
  stream?: NodeJS.WriteStream;
}

export function createSpinner(opts: SpinnerOptions): Spinner {
  const stream = opts.stream ?? process.stderr;
  const enabled = (opts.enabled ?? true) && Boolean(stream.isTTY);

  let timer: NodeJS.Timeout | undefined;
  let frame = 0;
  let text = '';
  let active = false;

  const clear = (): void => {
    if (!enabled) return;
    stream.write('\r[2K');
  };

  const draw = (): void => {
    if (!enabled) return;
    clear();
    stream.write(`${opts.ui.cyan(FRAMES[frame % FRAMES.length]!)} ${text}`);
    frame++;
  };

  const finish = (symbol: string, final?: string): void => {
    if (!active) return;
    active = false;
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!enabled) return;
    clear();
    stream.write(`${symbol} ${final ?? text}\n`);
  };

  return {
    start(t = '') {
      text = t;
      if (!enabled || active) return;
      active = true;
      draw();
      timer = setInterval(draw, FRAME_MS);
      // Never keep the process alive for an animation.
      timer.unref?.();
    },
    update(t) {
      text = t;
    },
    succeed: (t) => finish(opts.ui.ok('✔'), t),
    fail: (t) => finish(opts.ui.fail('✖'), t),
    stop() {
      if (!active) return;
      active = false;
      if (timer) clearInterval(timer);
      timer = undefined;
      clear();
    },
  };
}

export interface ProgressBar {
  update(done: number, total: number, label?: string): void;
  done(): void;
}

/** A single-line bar. Batch jobs are long; a bare count is not enough feedback. */
export function createProgressBar(opts: SpinnerOptions & { width?: number }): ProgressBar {
  const stream = opts.stream ?? process.stderr;
  const enabled = (opts.enabled ?? true) && Boolean(stream.isTTY);
  const width = opts.width ?? 24;
  let lastLine = '';

  return {
    update(done, total, label = '') {
      if (!enabled || total <= 0) return;
      const ratio = Math.max(0, Math.min(1, done / total));
      const filled = Math.round(ratio * width);
      const bar = `${'█'.repeat(filled)}${opts.ui.dim('░'.repeat(width - filled))}`;
      const pct = `${String(Math.round(ratio * 100)).padStart(3)}%`;
      const counter = opts.ui.dim(`${done}/${total}`);
      const line = `${opts.ui.cyan(bar)} ${pct} ${counter} ${truncate(label, 40)}`;
      if (line === lastLine) return;
      lastLine = line;
      stream.write(`\r[2K${line}`);
    },
    done() {
      if (!enabled) return;
      stream.write('\r[2K');
    },
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
