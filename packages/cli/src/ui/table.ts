/**
 * Table and value formatting.
 *
 * Column widths are measured on the *visible* text, not the raw string: colour
 * escapes have zero width, and counting them is why hand-rolled terminal tables
 * usually come out ragged the moment anything is coloured.
 */

export interface Column<T> {
  header: string;
  /** Cell text. May contain colour escapes; width is measured without them. */
  value: (row: T) => string;
  align?: 'left' | 'right';
  /** Truncate to this many visible characters. */
  max?: number;
}

export interface TableOptions {
  /** Wrap the header in this (usually `ui.dim`). */
  headerStyle?: (s: string) => string;
  gap?: number;
  indent?: number;
}

const ANSI = /\[[0-9;]*m/g;

/** Visible length, ignoring colour escapes. */
export function visibleLength(s: string): number {
  return s.replace(ANSI, '').length;
}

/** Truncate to `n` visible characters, keeping escapes intact. */
export function truncateVisible(s: string, n: number): string {
  if (visibleLength(s) <= n) return s;
  let out = '';
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < n - 1) {
    const escape = /^\[[0-9;]*m/.exec(s.slice(i));
    if (escape?.[0]) {
      out += escape[0];
      i += escape[0].length;
      continue;
    }
    out += s[i];
    visible++;
    i++;
  }
  // Close any open styling so the ellipsis does not inherit a colour.
  return `${out}…${s.includes('[') ? '[0m' : ''}`;
}

function pad(s: string, width: number, align: 'left' | 'right'): string {
  const spaces = ' '.repeat(Math.max(0, width - visibleLength(s)));
  return align === 'right' ? spaces + s : s + spaces;
}

export function renderTable<T>(rows: readonly T[], columns: readonly Column<T>[], opts: TableOptions = {}): string {
  if (rows.length === 0) return '';
  const gap = ' '.repeat(opts.gap ?? 2);
  const indent = ' '.repeat(opts.indent ?? 0);

  const cells = rows.map((row) =>
    columns.map((col) => {
      const raw = col.value(row) ?? '';
      return col.max ? truncateVisible(raw, col.max) : raw;
    }),
  );

  const widths = columns.map((col, i) =>
    Math.max(visibleLength(col.header), ...cells.map((r) => visibleLength(r[i] ?? ''))),
  );

  const header = columns.map((col, i) => pad(col.header, widths[i]!, col.align ?? 'left')).join(gap);
  const styled = opts.headerStyle ? opts.headerStyle(header) : header;

  const body = cells.map((r) =>
    // The last column is not padded — trailing whitespace is noise when the
    // output gets copied out of a terminal.
    r.map((cell, i) => (i === columns.length - 1 ? cell : pad(cell, widths[i]!, columns[i]?.align ?? 'left'))).join(gap),
  );

  return [indent + styled, ...body.map((line) => indent + line)].join('\n');
}

/** `1.2 MB`, `840 kB` — base-10, matching what a file manager shows. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** `840ms`, `12.4s`, `3m 02s`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** `47/100` with the number coloured by band. */
export function formatScore(score: number, ui: { ok(s: string): string; warn(s: string): string; fail(s: string): string }): string {
  const rounded = Math.round(score);
  const text = `${rounded}/100`;
  if (rounded >= 75) return ui.ok(text);
  if (rounded >= 50) return ui.warn(text);
  return ui.fail(text);
}
