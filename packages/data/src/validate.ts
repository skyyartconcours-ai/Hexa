/**
 * Roster integrity pass.
 *
 * This mostly catches *shape* errors, not *fact* errors. It cannot tell you
 * that a player was traded last Tuesday; it can tell you that two rows claim
 * the same id, that a team has six starters, or that someone is missing the
 * reference queries the asset ingester needs to find photographs of them.
 *
 * The one *provenance* rule it does enforce, added in the 2026-08-13 audit:
 * **a player may not carry career highlights with no sources behind them.**
 * Career highlights are claims about a real person's achievements. Shipping one
 * that nobody can trace is the failure mode this package most needs to prevent,
 * so it is a hard validation error rather than a lint warning.
 *
 * `validateRoster()` returns human-readable problems and returns `[]` when the
 * dataset is clean. The vitest suite asserts on the empty array, so a bad edit
 * fails CI rather than surfacing as a wrong face — or a wrong trophy — in a
 * render.
 */

import { ROLE_ORDER } from '@hexa/core';
import type { Player, Role } from '@hexa/core';

import { PLAYERS } from './roster.js';
import { TEAMS } from './teams.js';
import { VERIFICATION } from './verification.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ISO_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const MIN_REFERENCE_QUERIES = 3;

function isLaneRole(role: Role): boolean {
  return ROLE_ORDER.includes(role);
}

function isStarter(player: Player): boolean {
  return player.active && (player.tags?.includes('starter') ?? false);
}

/**
 * Returns a list of integrity problems with the shipped roster and team data.
 * An empty array means the dataset is internally consistent.
 */
export function validateRoster(): string[] {
  const problems: string[] = [];

  // ---- Teams -------------------------------------------------------------
  const seenTeamIds = new Set<string>();
  const seenTeamTags = new Set<string>();

  for (const team of TEAMS) {
    if (seenTeamIds.has(team.id)) problems.push(`Duplicate team id: "${team.id}".`);
    seenTeamIds.add(team.id);

    if (seenTeamTags.has(team.tag)) problems.push(`Duplicate team tag: "${team.tag}" (${team.id}).`);
    seenTeamTags.add(team.tag);

    for (const [slot, value] of Object.entries(team.colors)) {
      if (!HEX_COLOR.test(value)) {
        problems.push(`Team "${team.id}" has an invalid ${slot} colour: "${value}" (expected #RRGGBB).`);
      }
    }
  }

  // ---- Players -----------------------------------------------------------
  const seenPlayerIds = new Set<string>();

  for (const player of PLAYERS) {
    const label = `${player.handle} (${player.id})`;

    if (seenPlayerIds.has(player.id)) problems.push(`Duplicate player id: "${player.id}".`);
    seenPlayerIds.add(player.id);

    if (!seenTeamIds.has(player.teamId)) {
      problems.push(`Player ${label} references unknown teamId "${player.teamId}".`);
    }

    if (player.referenceQueries.length < MIN_REFERENCE_QUERIES) {
      problems.push(
        `Player ${label} has ${player.referenceQueries.length} referenceQueries; at least ${MIN_REFERENCE_QUERIES} are needed for asset ingestion.`,
      );
    }
    if (player.referenceQueries.some((q) => q.trim().length === 0)) {
      problems.push(`Player ${label} has an empty referenceQuery.`);
    }

    if (player.fullName.trim().length === 0) problems.push(`Player ${label} has an empty fullName.`);
    if (player.careerHighlights.length === 0) problems.push(`Player ${label} has no careerHighlights.`);

    // ---- Provenance: no unsourced claims about a real person -------------
    // A career highlight asserts that a named human won something. If no URL
    // backs it, delete the highlight or find a source — do not ship it.
    if (player.careerHighlights.length > 0) {
      const audit = VERIFICATION[player.id];
      if (audit === undefined) {
        problems.push(
          `Player ${label} carries ${player.careerHighlights.length} careerHighlights but has no entry in verification.ts. ` +
            `Add one with source URLs, or remove the highlights.`,
        );
      } else {
        const highlights = audit.fields.careerHighlights;
        if (highlights === undefined) {
          problems.push(
            `Player ${label} carries careerHighlights but verification.ts records no provenance for that field. ` +
              `Add sources, or remove the highlights.`,
          );
        } else if (highlights.sources.length === 0) {
          problems.push(
            `Player ${label} carries careerHighlights with zero source URLs (confidence: "${highlights.confidence}"). ` +
              `An unsourced achievement attributed to a real person must not ship.`,
          );
        }
      }
    }

    // A verification entry that cites nothing is worse than none at all: it
    // looks like diligence and provides none.
    const audit = VERIFICATION[player.id];
    if (audit !== undefined) {
      for (const [field, record] of Object.entries(audit.fields)) {
        if (!record) continue;
        if (record.confidence !== 'unverified' && record.sources.length === 0) {
          problems.push(
            `Player ${label} claims "${record.confidence}" confidence for "${field}" but lists no sources. ` +
              `Only "unverified" may have an empty source list.`,
          );
        }
      }
      for (const url of Object.values(audit.fields).flatMap((f) => f?.sources ?? [])) {
        if (!url.startsWith('https://')) {
          problems.push(`Player ${label} has a non-https verification source: "${url}".`);
        }
      }
    }

    if (player.jerseyNumber !== undefined && !Number.isInteger(player.jerseyNumber)) {
      problems.push(`Player ${label} has a non-integer jerseyNumber: ${player.jerseyNumber}.`);
    }

    if (player.joinedAt !== undefined && !ISO_DATE.test(player.joinedAt)) {
      problems.push(`Player ${label} has a malformed joinedAt "${player.joinedAt}" (expected YYYY, YYYY-MM or YYYY-MM-DD).`);
    }

    if (player.accentColor !== undefined && !HEX_COLOR.test(player.accentColor)) {
      problems.push(`Player ${label} has an invalid accentColor "${player.accentColor}" (expected #RRGGBB).`);
    }

    if (isStarter(player) && !isLaneRole(player.role)) {
      problems.push(`Player ${label} is tagged 'starter' but plays role "${player.role}", which is not a lane role.`);
    }
  }

  // ---- Per-team invariants ----------------------------------------------
  for (const team of TEAMS) {
    const squad = PLAYERS.filter((p) => p.teamId === team.id);
    const starters = squad.filter(isStarter);

    if (starters.length !== ROLE_ORDER.length) {
      problems.push(
        `Team "${team.id}" has ${starters.length} active starters, expected ${ROLE_ORDER.length} (${starters
          .map((p) => p.handle)
          .join(', ')}).`,
      );
    }

    for (const role of ROLE_ORDER) {
      const inRole = starters.filter((p) => p.role === role);
      if (inRole.length > 1) {
        problems.push(`Team "${team.id}" has ${inRole.length} starters at ${role}: ${inRole.map((p) => p.handle).join(', ')}.`);
      } else if (inRole.length === 0) {
        problems.push(`Team "${team.id}" has no active starter at ${role}.`);
      }
    }

    const numbers = new Map<number, string[]>();
    for (const player of squad) {
      if (player.jerseyNumber === undefined) continue;
      const holders = numbers.get(player.jerseyNumber) ?? [];
      holders.push(player.handle);
      numbers.set(player.jerseyNumber, holders);
    }
    for (const [number, holders] of numbers) {
      if (holders.length > 1) {
        problems.push(`Team "${team.id}" has duplicate jersey number ${number}: ${holders.join(', ')}.`);
      }
    }
  }

  // ---- Cross-cutting -----------------------------------------------------
  const orphanTeams = TEAMS.filter((t) => !PLAYERS.some((p) => p.teamId === t.id));
  for (const team of orphanTeams) {
    problems.push(`Team "${team.id}" has no players.`);
  }

  return problems;
}
