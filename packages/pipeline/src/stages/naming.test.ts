/**
 * Nameplates must name the face above them.
 *
 * The bug this pins: `assignSubjects` resolves slot→subject in three passes and
 * consumes subjects as it goes, while name derivation independently picked the
 * first subject declaring a side. On any layout where several slots share a side
 * — a hero plus its flankers — the two disagreed and the big face got a
 * different player's name.
 *
 * Mislabelling a real person is the worst output this tool can produce, and
 * real photographs make it more convincing rather than more obviously wrong.
 */

import { describe, expect, it } from 'vitest';
import type { Slot } from '@hexa/core';
import { assignSubjects, resolveCopy } from './compile.js';
import type { PreparedSubject } from '../types.js';

function subject(handle: string, side: 'left' | 'right' | 'center', index: number): PreparedSubject {
  return {
    index,
    side,
    accent: '#FF0000',
    player: { handle, id: handle.toLowerCase(), teamId: 't', role: 'mid' },
    team: { id: 't', tag: handle.slice(0, 2).toUpperCase() },
  } as unknown as PreparedSubject;
}

function slot(id: string, w: number, h: number, meta?: Record<string, unknown>): { slot: Slot; rect: { x: number; y: number; w: number; h: number }; z: number } {
  return {
    slot: { id, kind: 'subject', rect: { x: 0, y: 0, w: 0.2, h: 0.5 }, anchor: 'center', z: 10, ...(meta ? { meta } : {}) } as Slot,
    rect: { x: 0, y: 0, w, h },
    z: 10,
  };
}

describe('nameplates follow the assigned face', () => {
  it('names the hero, not whichever subject merely declared the same side', () => {
    // The flanker slot is listed first, so it consumes the first left subject.
    // The hero — the big face a viewer reads as "the left player" — gets the next.
    const slots = [
      slot('flank-left-1', 120, 200),
      slot('hero-left', 600, 900),
      slot('flank-right-1', 120, 200),
      slot('hero-right', 600, 900),
    ];
    const subjects = [
      subject('Caliste', 'left', 0),
      subject('Canna', 'left', 1),
      subject('HansSama', 'right', 2),
      subject('BrokenBlade', 'right', 3),
    ];

    const assignment = assignSubjects(slots as never, subjects);
    const heroLeft = assignment.find((a) => a.slot.slot.id === 'hero-left')?.subject;
    const heroRight = assignment.find((a) => a.slot.slot.id === 'hero-right')?.subject;

    const leftName = resolveCopy('left-name', undefined, { text: {}, subjects } as never, assignment);
    const rightName = resolveCopy('right-name', undefined, { text: {}, subjects } as never, assignment);

    // Whoever the compiler actually painted into the hero slot is who the
    // nameplate must name — that is the invariant, whichever subject it is.
    expect(leftName).toBe(heroLeft?.player.handle);
    expect(rightName).toBe(heroRight?.player.handle);
  });

  it('still names correctly in the simple two-slot versus case', () => {
    const slots = [slot('subject-left', 400, 700), slot('subject-right', 400, 700)];
    const subjects = [subject('Peyz', 'left', 0), subject('Viper', 'right', 1)];
    const assignment = assignSubjects(slots as never, subjects);

    expect(resolveCopy('left-name', undefined, { text: {}, subjects } as never, assignment)).toBe('Peyz');
    expect(resolveCopy('right-name', undefined, { text: {}, subjects } as never, assignment)).toBe('Viper');
  });

  it('prefers an explicit subjectIndex binding over side', () => {
    const slots = [
      slot('hero-left', 600, 900, { subjectIndex: 1 }),
      slot('hero-right', 600, 900, { subjectIndex: 0 }),
    ];
    const subjects = [subject('Peyz', 'left', 0), subject('Viper', 'right', 1)];
    const assignment = assignSubjects(slots as never, subjects);

    // The template pinned Viper to the left slot, so the left nameplate says Viper.
    expect(assignment.find((a) => a.slot.slot.id === 'hero-left')?.subject?.player.handle).toBe('Viper');
    expect(resolveCopy('left-name', undefined, { text: {}, subjects } as never, assignment)).toBe('Viper');
  });

  it('an explicitly supplied name always wins over derivation', () => {
    const slots = [slot('hero-left', 600, 900)];
    const subjects = [subject('Peyz', 'left', 0)];
    const assignment = assignSubjects(slots as never, subjects);

    expect(
      resolveCopy('left-name', undefined, { text: { 'left-name': 'Anonymous' }, subjects } as never, assignment),
    ).toBe('Anonymous');
  });
});
