/**
 * Exit codes are part of the CLI's API: CI scripts branch on them. These tests
 * exist to make changing one a deliberate act rather than an accident.
 */

import { describe, expect, it } from 'vitest';
import { HexaError } from '@hexa/core';
import type { HexaErrorCode } from '@hexa/core';
import { EXIT_CODES, EXIT_OK, EXIT_UNKNOWN, describeError, exitCodeFor } from './exit.js';

const ALL_CODES: HexaErrorCode[] = [
  'PLAYER_NOT_FOUND', 'TEAM_NOT_FOUND', 'TEMPLATE_NOT_FOUND', 'ASSET_NOT_FOUND',
  'NO_CLEARED_ASSET', 'IDENTITY_GATE_FAILED', 'QA_FAILED', 'VISION_UNAVAILABLE',
  'PROVIDER_ERROR', 'PROVIDER_NOT_CONFIGURED', 'INVALID_REQUEST', 'RENDER_FAILED',
  'FONT_MISSING', 'IO_ERROR',
];

describe('EXIT_CODES', () => {
  it('covers every error code the core defines', () => {
    for (const code of ALL_CODES) {
      expect(EXIT_CODES[code], `${code} has no exit code`).toBeTypeOf('number');
    }
  });

  it('gives every code a distinct number', () => {
    const values = ALL_CODES.map((c) => EXIT_CODES[c]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('never collides with success or the generic failure', () => {
    for (const code of ALL_CODES) {
      expect(EXIT_CODES[code]).not.toBe(EXIT_OK);
      expect(EXIT_CODES[code]).not.toBe(EXIT_UNKNOWN);
    }
  });

  it('stays inside the range a shell can report', () => {
    for (const code of ALL_CODES) {
      expect(EXIT_CODES[code]).toBeGreaterThan(0);
      expect(EXIT_CODES[code]).toBeLessThan(126);
    }
  });

  it('pins the published numbers', () => {
    // Changing any of these breaks somebody's CI script — that is the point of
    // asserting them literally rather than deriving them.
    expect(EXIT_CODES.INVALID_REQUEST).toBe(2);
    expect(EXIT_CODES.PLAYER_NOT_FOUND).toBe(3);
    expect(EXIT_CODES.TEMPLATE_NOT_FOUND).toBe(5);
    expect(EXIT_CODES.IDENTITY_GATE_FAILED).toBe(8);
    expect(EXIT_CODES.QA_FAILED).toBe(9);
    expect(EXIT_CODES.VISION_UNAVAILABLE).toBe(10);
    expect(EXIT_CODES.RENDER_FAILED).toBe(13);
    expect(EXIT_CODES.IO_ERROR).toBe(15);
  });

  it('groups related failures into contiguous ranges', () => {
    const notFound = ['PLAYER_NOT_FOUND', 'TEAM_NOT_FOUND', 'TEMPLATE_NOT_FOUND', 'ASSET_NOT_FOUND', 'NO_CLEARED_ASSET'] as const;
    for (const code of notFound) {
      expect(EXIT_CODES[code], code).toBeGreaterThanOrEqual(3);
      expect(EXIT_CODES[code], code).toBeLessThanOrEqual(7);
    }
    for (const code of ['VISION_UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_ERROR'] as const) {
      expect(EXIT_CODES[code], code).toBeGreaterThanOrEqual(10);
      expect(EXIT_CODES[code], code).toBeLessThanOrEqual(12);
    }
  });
});

describe('exitCodeFor', () => {
  it('maps a HexaError by its code', () => {
    expect(exitCodeFor(new HexaError('QA_FAILED', 'nope'))).toBe(9);
    expect(exitCodeFor(new HexaError('PLAYER_NOT_FOUND', 'who?'))).toBe(3);
  });

  it('falls back for a plain error', () => {
    expect(exitCodeFor(new Error('boom'))).toBe(EXIT_UNKNOWN);
  });

  it('does not throw on a non-error', () => {
    expect(exitCodeFor('a string')).toBe(EXIT_UNKNOWN);
    expect(exitCodeFor(undefined)).toBe(EXIT_UNKNOWN);
    expect(exitCodeFor(null)).toBe(EXIT_UNKNOWN);
  });
});

describe('describeError', () => {
  it('keeps the message, hint and details of a HexaError', () => {
    const error = new HexaError('PLAYER_NOT_FOUND', 'No player matches "Peyzz"', {
      hint: 'Did you mean: Peyz?',
      details: { suggestions: ['Peyz'] },
    });
    const rendered = describeError(error);
    expect(rendered.code).toBe('PLAYER_NOT_FOUND');
    expect(rendered.exitCode).toBe(3);
    expect(rendered.message).toContain('Peyzz');
    expect(rendered.hint).toBe('Did you mean: Peyz?');
    expect(rendered.details?.['suggestions']).toEqual(['Peyz']);
  });

  it('always supplies a hint, even when the error carried none', () => {
    // "And now what?" must always have an answer — that is the whole reason
    // HexaError has a hint field.
    for (const code of ALL_CODES) {
      const rendered = describeError(new HexaError(code, 'something went wrong'));
      expect(rendered.hint, `${code} produced no hint`).toBeTruthy();
    }
  });

  it('describes a plain Error as unknown, with advice', () => {
    const rendered = describeError(new Error('kaboom'));
    expect(rendered.code).toBe('UNKNOWN');
    expect(rendered.exitCode).toBe(EXIT_UNKNOWN);
    expect(rendered.message).toBe('kaboom');
    expect(rendered.hint).toContain('--log debug');
  });

  it('survives a thrown non-error', () => {
    expect(describeError('just a string').message).toBe('just a string');
    expect(describeError(42).message).toBe('42');
  });
});
