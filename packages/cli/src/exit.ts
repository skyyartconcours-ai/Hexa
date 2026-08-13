/**
 * Error → exit code mapping.
 *
 * Exit codes are part of the CLI's API. A CI job that runs `hexa gen` needs to
 * tell "the roster does not have that player" (a typo, fix the command) from
 * "the identity gate rejected the render" (a real quality failure worth
 * blocking a publish on) without scraping stderr. So every `HexaErrorCode` gets
 * its own stable number, and the numbers never get reused for something else.
 *
 * Grouping, so a script can branch on a range:
 *   2      the request was wrong
 *   3–7    something could not be found or is not usable
 *   8–9    the output was made but failed quality
 *   10–12  an external service is missing or misbehaving
 *   13–15  local failure: render, fonts, disk
 */

import { isHexaError } from '@hexa/core';
import type { HexaErrorCode } from '@hexa/core';

export const EXIT_OK = 0;
/** Anything we did not anticipate. */
export const EXIT_UNKNOWN = 1;
/**
 * A malformed command line: missing argument, unknown flag, bad choice.
 *
 * Deliberately the same number as `INVALID_REQUEST`. From a caller's point of
 * view "you asked for something impossible" and "you typed the ask wrongly" are
 * one class — fix the command and run it again — and commander's undifferentiated
 * 1 would otherwise collide with "something unexpected went wrong".
 */
export const EXIT_USAGE = 2;
/** Interrupted (SIGINT). 128 + signal, by shell convention. */
export const EXIT_INTERRUPTED = 130;

export const EXIT_CODES: Readonly<Record<HexaErrorCode, number>> = {
  INVALID_REQUEST: 2,

  PLAYER_NOT_FOUND: 3,
  TEAM_NOT_FOUND: 4,
  TEMPLATE_NOT_FOUND: 5,
  ASSET_NOT_FOUND: 6,
  NO_CLEARED_ASSET: 7,

  IDENTITY_GATE_FAILED: 8,
  QA_FAILED: 9,

  VISION_UNAVAILABLE: 10,
  PROVIDER_NOT_CONFIGURED: 11,
  PROVIDER_ERROR: 12,

  RENDER_FAILED: 13,
  FONT_MISSING: 14,
  IO_ERROR: 15,
};

/** The exit code for any thrown value. Never throws itself. */
export function exitCodeFor(error: unknown): number {
  if (isHexaError(error)) return EXIT_CODES[error.code] ?? EXIT_UNKNOWN;
  return EXIT_UNKNOWN;
}

export interface RenderedError {
  code: HexaErrorCode | 'UNKNOWN';
  exitCode: number;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

/**
 * Turn any thrown value into something printable.
 *
 * `hint` is the whole point: a Hexa error is supposed to tell the operator what
 * to do next, and the CLI is where that promise gets kept. An error without a
 * hint gets a generic one rather than none, because "and now what?" always
 * needs an answer.
 */
export function describeError(error: unknown): RenderedError {
  if (isHexaError(error)) {
    return {
      code: error.code,
      exitCode: exitCodeFor(error),
      message: error.message,
      hint: error.hint ?? genericHint(error.code),
      details: error.details,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'UNKNOWN',
    exitCode: EXIT_UNKNOWN,
    message,
    hint: 'This one is unexpected. Re-run with --log debug for the full trace, and `hexa doctor` to check the install.',
  };
}

function genericHint(code: HexaErrorCode): string {
  switch (code) {
    case 'VISION_UNAVAILABLE':
      return 'Start the vision sidecar: services/vision/run.sh';
    case 'FONT_MISSING':
      return 'Run `hexa doctor` to see which fonts are missing and where to put them.';
    case 'PROVIDER_NOT_CONFIGURED':
      return 'Run `hexa providers` to see which environment variables each provider needs.';
    case 'QA_FAILED':
    case 'IDENTITY_GATE_FAILED':
      return 'Run `hexa qa <image>` for the full report, or drop --strict to write the output and inspect it.';
    default:
      return 'Run `hexa doctor` to check the install.';
  }
}
