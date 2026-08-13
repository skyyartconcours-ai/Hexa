/**
 * Typed errors. The CLI maps `code` to an exit status and to a remediation
 * hint, so failures tell the user what to do next rather than dumping a stack.
 */

export type HexaErrorCode =
  | 'PLAYER_NOT_FOUND'
  | 'TEAM_NOT_FOUND'
  | 'TEMPLATE_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'NO_CLEARED_ASSET'
  | 'IDENTITY_GATE_FAILED'
  | 'QA_FAILED'
  | 'VISION_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'RENDER_FAILED'
  | 'FONT_MISSING'
  | 'IO_ERROR';

export class HexaError extends Error {
  readonly code: HexaErrorCode;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: HexaErrorCode, message: string, opts: { hint?: string; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'HexaError';
    this.code = code;
    this.hint = opts.hint;
    this.details = opts.details;
  }
}

export function isHexaError(e: unknown): e is HexaError {
  return e instanceof HexaError;
}

/** Suggest close matches for a mistyped name — cheap Levenshtein. */
export function didYouMean(input: string, candidates: string[], limit = 3): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(input);
  return candidates
    .map((c) => ({ c, d: levenshtein(target, norm(c)) }))
    .filter(({ d }) => d <= Math.max(2, Math.floor(target.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ c }) => c);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}
