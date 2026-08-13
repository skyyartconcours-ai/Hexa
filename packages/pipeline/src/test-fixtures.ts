/**
 * Fixtures for tests that exercise the pure half of the pipeline.
 *
 * Deliberately hand-built rather than pulled from @hexa/data: a palette test
 * that breaks when a real team rebrands is testing the wrong thing.
 */

import type { BrandColors, Player, ReferenceAsset, Team } from '@hexa/core';
import type { PreparedSubject } from './types.js';

export function makeTeam(over: Partial<Team> & { id: string; colors?: Partial<BrandColors> }): Team {
  return {
    name: `${over.id} Esports`,
    shortName: over.id,
    tag: over.id.toUpperCase(),
    region: 'KR',
    league: 'LCK',
    ...over,
    colors: {
      primary: '#C8102E',
      secondary: '#111111',
      accent: '#FFB81C',
      dark: '#0B0B0F',
      light: '#F5F7FA',
      ...(over.colors ?? {}),
    },
  };
}

export function makePlayer(over: Partial<Player> & { id: string }): Player {
  return {
    handle: over.id,
    aliases: [],
    fullName: over.id,
    role: 'bot',
    teamId: 'team',
    region: 'KR',
    nationality: 'KR',
    signatureChampions: [],
    careerHighlights: [],
    referenceQueries: [],
    active: true,
    ...over,
  };
}

export function makeAsset(over: Partial<ReferenceAsset> & { id: string }): ReferenceAsset {
  return {
    kind: 'portrait',
    path: `${over.id}.png`,
    tags: [],
    ...over,
    metrics: { width: 1200, height: 1600, sharpness: 90, brightness: 128, contrast: 0.4, quality: 80, ...(over.metrics ?? {}) },
    provenance: {
      source: 'Test kit',
      license: 'press-kit',
      addedAt: '2026-01-01T00:00:00.000Z',
      cleared: true,
      ...(over.provenance ?? {}),
    },
  };
}

export function makeSubject(over: Partial<PreparedSubject> & { index: number; side: PreparedSubject['side'] }): PreparedSubject {
  const teamId = over.team?.id ?? `team-${over.index}`;
  const team = over.team ?? makeTeam({ id: teamId });
  const player = over.player ?? makePlayer({ id: `player-${over.index}`, teamId });
  return {
    player,
    team,
    asset: over.asset ?? makeAsset({ id: `asset-${over.index}`, playerId: player.id, teamId }),
    cutout: over.cutout ?? Buffer.alloc(0),
    accent: over.accent ?? team.colors.primary,
    size: { width: 1200, height: 1600 },
    ...over,
  };
}
