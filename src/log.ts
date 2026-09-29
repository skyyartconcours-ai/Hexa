const COLORS = {
  reset: '[0m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  blue: '[34m',
  magenta: '[35m',
  cyan: '[36m',
} as const;

function stamp(): string {
  return new Date().toLocaleTimeString('fr-FR', { hour12: false });
}

function emit(color: string, tag: string, args: unknown[]): void {
  console.log(`${COLORS.dim}${stamp()}${COLORS.reset} ${color}${tag}${COLORS.reset}`, ...args);
}

/** `npm run preview` n'affiche que son compte rendu : avertissements et erreurs seulement. */
let quiet = false;
export function setQuiet(value: boolean): void {
  quiet = value;
}

export const log = {
  info: (...args: unknown[]) => void (quiet || emit(COLORS.blue, '[info]', args)),
  ok: (...args: unknown[]) => void (quiet || emit(COLORS.green, '[ ok ]', args)),
  warn: (...args: unknown[]) => emit(COLORS.yellow, '[warn]', args),
  error: (...args: unknown[]) => emit(COLORS.red, '[err ]', args),
  twitch: (...args: unknown[]) => void (quiet || emit(COLORS.magenta, '[twch]', args)),
  roast: (...args: unknown[]) => void (quiet || emit(COLORS.cyan, '[rost]', args)),
};
