/**
 * Minimal structured logger. Renders are long-running and multi-stage, so the
 * default surface is a progress-friendly stream rather than a firehose.
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5,
};

const COLOR = {
  reset: '\u001b[0m', dim: '\u001b[2m', red: '\u001b[31m', yellow: '\u001b[33m',
  cyan: '\u001b[36m', green: '\u001b[32m', magenta: '\u001b[35m',
};

export interface Logger {
  level: LogLevel;
  error(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
  trace(msg: string, meta?: unknown): void;
  /** Time an async stage and log its duration at debug level. */
  stage<T>(name: string, fn: () => Promise<T>): Promise<T>;
  child(prefix: string): Logger;
}

export function createLogger(level: LogLevel = 'info', prefix = '', useColor = process.stdout.isTTY ?? false): Logger {
  const paint = (c: string, s: string) => (useColor ? `${c}${s}${COLOR.reset}` : s);
  const emit = (lvl: LogLevel, color: string, msg: string, meta?: unknown) => {
    if (LEVEL_RANK[lvl] > LEVEL_RANK[level]) return;
    const tag = paint(color, lvl.toUpperCase().padEnd(5));
    const pre = prefix ? paint(COLOR.dim, `[${prefix}] `) : '';
    const line = `${tag} ${pre}${msg}`;
    const stream = LEVEL_RANK[lvl] <= 2 ? process.stderr : process.stdout;
    stream.write(meta === undefined ? `${line}\n` : `${line} ${paint(COLOR.dim, safeJson(meta))}\n`);
  };

  const logger: Logger = {
    level,
    error: (m, meta) => emit('error', COLOR.red, m, meta),
    warn: (m, meta) => emit('warn', COLOR.yellow, m, meta),
    info: (m, meta) => emit('info', COLOR.cyan, m, meta),
    debug: (m, meta) => emit('debug', COLOR.magenta, m, meta),
    trace: (m, meta) => emit('trace', COLOR.dim, m, meta),
    async stage(name, fn) {
      const t0 = performance.now();
      try {
        const out = await fn();
        emit('debug', COLOR.green, `${name} ${paint(COLOR.dim, `${(performance.now() - t0).toFixed(0)}ms`)}`);
        return out;
      } catch (err) {
        emit('error', COLOR.red, `${name} failed after ${(performance.now() - t0).toFixed(0)}ms`);
        throw err;
      }
    },
    child: (p) => createLogger(level, prefix ? `${prefix}:${p}` : p, useColor),
  };
  return logger;
}

function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Shared default; packages should accept an injected logger where practical. */
export const log = createLogger((process.env.HEXA_LOG as LogLevel) || 'info');
