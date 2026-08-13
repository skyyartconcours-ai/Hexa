/**
 * Terminal styling.
 *
 * picocolors already respects `NO_COLOR` and pipe detection; this wraps it so
 * `--no-color` and `--json` can force plain output too. Every command draws
 * through `ui()` rather than importing picocolors directly, which is what makes
 * `--json` output guaranteed-clean: no escape sequence can leak into a stream
 * something else is about to parse.
 */

import pc from 'picocolors';

export interface Ui {
  enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  cyan(s: string): string;
  magenta(s: string): string;
  /** 24-bit foreground from a hex colour — team brand swatches. */
  hex(hex: string, s: string): string;
  /** 24-bit background, with a readable foreground picked automatically. */
  onHex(hex: string, s: string): string;
  /** A solid block in a brand colour. */
  swatch(hex: string, width?: number): string;
  heading(s: string): string;
  ok(s: string): string;
  warn(s: string): string;
  fail(s: string): string;
  bullet(s: string): string;
}

const identity = (s: string): string => s;

export function createUi(enabled: boolean): Ui {
  const c = enabled ? pc : plain();

  const rgb = (hex: string): [number, number, number] => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m?.[1]) return [128, 128, 128];
    const n = Number.parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  const hex = (h: string, s: string): string => {
    if (!enabled) return s;
    const [r, g, b] = rgb(h);
    return `[38;2;${r};${g};${b}m${s}[39m`;
  };

  const onHex = (h: string, s: string): string => {
    if (!enabled) return s;
    const [r, g, b] = rgb(h);
    // Relative luminance decides black-or-white text, so a swatch label stays
    // readable on both a near-white and a near-black brand colour.
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const fg = lum > 0.55 ? '30' : '97';
    return `[48;2;${r};${g};${b}m[${fg}m${s}[39m[49m`;
  };

  return {
    enabled,
    bold: c.bold,
    dim: c.dim,
    red: c.red,
    green: c.green,
    yellow: c.yellow,
    blue: c.blue,
    cyan: c.cyan,
    magenta: c.magenta,
    hex,
    onHex,
    // Two spaces of solid colour reads as a swatch in every terminal font,
    // where a single column can look like a stray character.
    swatch: (h, width = 2) => onHex(h, ' '.repeat(width)),
    heading: (s) => c.bold(c.cyan(s)),
    ok: (s) => c.green(s),
    warn: (s) => c.yellow(s),
    fail: (s) => c.red(s),
    bullet: (s) => `${c.dim('•')} ${s}`,
  };
}

function plain(): typeof pc {
  return new Proxy({} as typeof pc, {
    get: (_t, prop) => (prop === 'isColorSupported' ? false : identity),
  });
}

/** Status glyphs. ASCII fallbacks keep alignment in terminals without symbols. */
export function glyphs(unicode = supportsUnicode()) {
  return unicode
    ? { ok: '✔', warn: '!', fail: '✖', info: 'ℹ', arrow: '→', dot: '·' }
    : { ok: 'OK', warn: '!', fail: 'X', info: 'i', arrow: '->', dot: '-' };
}

function supportsUnicode(): boolean {
  if (process.platform !== 'win32') return true;
  return Boolean(process.env['WT_SESSION'] || process.env['TERM_PROGRAM']);
}
