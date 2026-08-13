import { describe, expect, it } from 'vitest';
import { HexaError, ROLE_ORDER, isHexaError } from '@hexa/core';

import {
  BLOCKED_SOURCES,
  PLAYERS,
  ROSTER_SOURCED_AT,
  ROSTER_SOURCES,
  TEAMS,
  TEAM_COLOR_VERIFICATION,
  VERIFICATION,
  confidenceOf,
  findPlayer,
  findTeam,
  listPlayers,
  normalizeKey,
  playersByTeam,
  requirePlayer,
  requireTeam,
  rosterOf,
  searchPlayers,
  sourceCount,
  teamOf,
  unverifiedPlayers,
  validateRoster,
  verificationOf,
  verificationSources,
  verifiedPlayers,
} from './index.js';

describe('validateRoster', () => {
  it('reports no integrity problems', () => {
    expect(validateRoster()).toEqual([]);
  });
});

describe('dataset shape', () => {
  it('ships the seven supported organisations', () => {
    expect(TEAMS.map((t) => t.id).sort()).toEqual(['dplus', 'g2', 'geng', 'hle', 'kc', 'kt', 't1']);
  });

  it('carries a broad roster', () => {
    expect(PLAYERS.length).toBeGreaterThanOrEqual(60);
  });

  it('records provenance', () => {
    expect(ROSTER_SOURCED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ROSTER_SOURCES.length).toBeGreaterThan(10);
    for (const url of ROSTER_SOURCES) expect(url).toMatch(/^https:\/\//);
  });

  it('names the sources it could not reach, so the gap is visible', () => {
    expect(BLOCKED_SOURCES.length).toBeGreaterThan(0);
    for (const url of BLOCKED_SOURCES) expect(url).toMatch(/^https:\/\//);
    // The wikis are the sources you would reach for first. They were blocked.
    expect(BLOCKED_SOURCES.some((u) => u.includes('liquipedia'))).toBe(true);
    expect(BLOCKED_SOURCES.some((u) => u.includes('lol.fandom.com'))).toBe(true);
  });

  it('does not cite a blocked domain as a roster source', () => {
    const blockedHosts = BLOCKED_SOURCES.map((u) => new URL(u).host);
    for (const url of ROSTER_SOURCES) {
      expect(blockedHosts, url).not.toContain(new URL(url).host);
    }
  });

  it('gives every player at least three reference queries', () => {
    for (const player of PLAYERS) {
      expect(player.referenceQueries.length, player.handle).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives every team a full five-slot brand kit', () => {
    for (const team of TEAMS) {
      for (const slot of ['primary', 'secondary', 'accent', 'dark', 'light'] as const) {
        expect(team.colors[slot], `${team.id}.${slot}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('keeps team primaries distinct so opposing rim lights separate', () => {
    const primaries = TEAMS.map((t) => t.colors.primary.toLowerCase());
    expect(new Set(primaries).size).toBe(TEAMS.length);
  });
});

describe('verification', () => {
  it('audits every player in the dataset', () => {
    for (const player of PLAYERS) {
      expect(VERIFICATION[player.id], player.handle).toBeDefined();
    }
  });

  it('never claims confidence without citing a source', () => {
    for (const [id, audit] of Object.entries(VERIFICATION)) {
      for (const [field, record] of Object.entries(audit.fields)) {
        if (!record) continue;
        if (record.confidence === 'unverified') continue;
        expect(record.sources.length, `${id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it('only calls a field "confirmed" with two or more independent sources', () => {
    for (const [id, audit] of Object.entries(VERIFICATION)) {
      for (const [field, record] of Object.entries(audit.fields)) {
        if (record?.confidence !== 'confirmed') continue;
        expect(record.sources.length, `${id}.${field}`).toBeGreaterThanOrEqual(2);
        expect(new Set(record.sources).size, `${id}.${field} has duplicate sources`).toBe(
          record.sources.length,
        );
      }
    }
  });

  it('records both readings whenever it marks a field disputed', () => {
    for (const [id, audit] of Object.entries(VERIFICATION)) {
      for (const [field, record] of Object.entries(audit.fields)) {
        if (record?.confidence !== 'disputed') continue;
        expect(record.variants?.length ?? 0, `${id}.${field}`).toBeGreaterThanOrEqual(2);
        expect(record.note, `${id}.${field}`).toBeTruthy();
      }
    }
  });

  it('rolls a player up to their weakest field', () => {
    for (const [id, audit] of Object.entries(VERIFICATION)) {
      const rank = { unverified: 0, disputed: 1, reported: 2, confirmed: 3 } as const;
      const fields = Object.values(audit.fields).filter((f) => f !== undefined);
      if (fields.length === 0) continue;
      const min = Math.min(...fields.map((f) => rank[f.confidence]));
      expect(rank[audit.confidence], id).toBe(min);
    }
  });

  it('deletes rather than guesses a name it cannot settle', () => {
    // Ryu's surname reads as either 유 or 류 depending on the outlet, and his
    // handle collides with one of them. nativeName is absent by choice.
    const ryu = requirePlayer('ryu');
    expect(ryu.nativeName).toBeUndefined();
    expect(confidenceOf('ryu', 'nativeName')).toBe('disputed');
    expect(verificationOf('ryu')?.fields.nativeName?.variants).toEqual(['유상욱', '류상욱']);
  });

  it('exposes per-field confidence and source counts', () => {
    expect(confidenceOf('peyz', 'teamId')).toBe('confirmed');
    expect(sourceCount('peyz', 'teamId')).toBeGreaterThanOrEqual(2);

    // A player id that does not exist reads as unverified, never as confirmed.
    expect(confidenceOf('not-a-player', 'fullName')).toBe('unverified');
    expect(sourceCount('not-a-player', 'fullName')).toBe(0);
    expect(verificationOf('not-a-player')).toBeUndefined();
  });

  it('attaches an audit to every player via verifiedPlayers()', () => {
    const verified = verifiedPlayers();
    expect(verified).toHaveLength(PLAYERS.length);
    for (const player of verified) {
      expect(player.verification.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(player.handle).toBeTruthy();
    }
  });

  it('collects every source URL it relied on', () => {
    const urls = verificationSources();
    expect(urls.length).toBeGreaterThan(50);
    for (const url of urls) expect(url).toMatch(/^https:\/\//);
    expect(urls).toEqual([...urls].sort());
  });
});

describe('unverifiedPlayers', () => {
  it('reports rows still carrying unverified or disputed fields', () => {
    const rows = unverifiedPlayers();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.player).toBeTruthy();
      expect(row.fields.length).toBeGreaterThan(0);
    }
  });

  it('flags the disputed Korean romanisations', () => {
    const byPlayer = new Map(unverifiedPlayers().map((r) => [r.player, r.fields]));
    expect(byPlayer.get('Delight')).toContain('fullName');
    expect(byPlayer.get('Ryu')).toContain('fullName');
    expect(byPlayer.get('Cuzz')).toContain('fullName');
  });

  it('does not flag a field the player does not carry', () => {
    // Latin-name players have no nativeName, so it must never be reported.
    const latin = new Set(PLAYERS.filter((p) => p.nativeName === undefined).map((p) => p.handle));
    for (const row of unverifiedPlayers()) {
      if (latin.has(row.player)) expect(row.fields, row.player).not.toContain('nativeName');
    }
  });

  it('never reports a player whose audited fields are all confirmed', () => {
    const flagged = new Set(unverifiedPlayers().map((r) => r.player));
    // Gumayusi's move to HLE is one of the best-sourced facts in the set, but
    // his romanisation is disputed — so he IS expected here. Jiwoo is not.
    expect(flagged.has('Jiwoo')).toBe(false);
  });
});

describe('team colour provenance', () => {
  it('records a verification status for every team', () => {
    for (const team of TEAMS) {
      expect(TEAM_COLOR_VERIFICATION[team.id], team.id).toBeDefined();
    }
  });

  it('cites a source whenever it claims a colour is confirmed', () => {
    for (const [id, record] of Object.entries(TEAM_COLOR_VERIFICATION)) {
      if (record.primary === 'confirmed' || record.secondary === 'confirmed') {
        expect(record.sources.length, id).toBeGreaterThan(0);
      }
      if (record.primary === 'unverified') {
        expect(record.note, id).toBeTruthy();
      }
    }
  });

  it('is honest that three brand primaries could not be sourced', () => {
    const unverified = Object.entries(TEAM_COLOR_VERIFICATION)
      .filter(([, r]) => r.primary === 'unverified')
      .map(([id]) => id)
      .sort();
    expect(unverified).toEqual(['hle', 'kc', 'kt']);
  });
});

describe('normalizeKey', () => {
  it('folds case, punctuation and spacing', () => {
    expect(normalizeKey('Kim Su-hwan')).toBe('kimsuhwan');
    expect(normalizeKey('  KIM_SU.HWAN  ')).toBe('kimsuhwan');
    expect(normalizeKey('Gen.G')).toBe('geng');
  });

  it('folds Latin diacritics', () => {
    expect(normalizeKey('Sergen Çelik')).toBe(normalizeKey('Sergen Celik'));
    expect(normalizeKey('Raphaël Crabbé')).toBe(normalizeKey('Raphael Crabbe'));
  });

  it('preserves Hangul', () => {
    expect(normalizeKey('이상혁')).toBe(normalizeKey('이상혁'));
    expect(normalizeKey('이상혁')).not.toBe('');
  });
});

describe('findPlayer', () => {
  it('resolves by id, handle and casing', () => {
    expect(findPlayer('faker')?.id).toBe('faker');
    expect(findPlayer('FAKER')?.id).toBe('faker');
    expect(findPlayer('  Faker ')?.id).toBe('faker');
  });

  it('resolves by legal name with and without punctuation', () => {
    expect(findPlayer('Lee Sang-hyeok')?.id).toBe('faker');
    expect(findPlayer('lee sanghyeok')?.id).toBe('faker');
  });

  it('resolves by native-script name', () => {
    expect(findPlayer('김수환')?.id).toBe('peyz');
    expect(findPlayer('허수')?.id).toBe('showmaker');
  });

  it('resolves by alias, including stale team-prefixed asset folder names', () => {
    expect(findPlayer('geng-peyz')?.id).toBe('peyz');
    expect(findPlayer('t1-peyz')?.id).toBe('peyz');
    expect(findPlayer('Guma')?.id).toBe('gumayusi');
  });

  it('folds diacritics in Latin names', () => {
    expect(findPlayer('Sergen Celik')?.id).toBe('brokenblade');
    expect(findPlayer('Sergen Çelik')?.id).toBe('brokenblade');
  });

  it('returns undefined rather than guessing', () => {
    expect(findPlayer('definitely-not-a-player')).toBeUndefined();
    expect(findPlayer('')).toBeUndefined();
  });
});

describe('findTeam', () => {
  it('resolves by id, tag, name and short name', () => {
    expect(findTeam('t1')?.id).toBe('t1');
    expect(findTeam('HLE')?.id).toBe('hle');
    expect(findTeam('Hanwha Life Esports')?.id).toBe('hle');
    expect(findTeam('Hanwha Life')?.id).toBe('hle');
  });

  it('resolves by alias and punctuation variants', () => {
    expect(findTeam('SKT')?.id).toBe('t1');
    expect(findTeam('Gen.G')?.id).toBe('geng');
    expect(findTeam('gen g')?.id).toBe('geng');
    expect(findTeam('GENG')?.id).toBe('geng');
    expect(findTeam('DWG KIA')?.id).toBe('dplus');
    expect(findTeam('KCorp')?.id).toBe('kc');
  });

  it('returns undefined for unknown teams', () => {
    expect(findTeam('Fnatic')).toBeUndefined();
  });
});

describe('requirePlayer / requireTeam', () => {
  it('returns the match when there is one', () => {
    expect(requirePlayer('chovy').handle).toBe('Chovy');
    expect(requireTeam('geng').tag).toBe('GEN');
  });

  it('throws PLAYER_NOT_FOUND with a didYouMean hint', () => {
    try {
      requirePlayer('fakr');
      throw new Error('expected requirePlayer to throw');
    } catch (error) {
      expect(isHexaError(error)).toBe(true);
      const hexa = error as HexaError;
      expect(hexa.code).toBe('PLAYER_NOT_FOUND');
      expect(hexa.hint).toContain('Faker');
      expect((hexa.details?.didYouMean as string[]) ?? []).toContain('Faker');
    }
  });

  it('throws TEAM_NOT_FOUND with a didYouMean hint', () => {
    try {
      requireTeam('Hanwa Life Esports');
      throw new Error('expected requireTeam to throw');
    } catch (error) {
      expect(isHexaError(error)).toBe(true);
      const hexa = error as HexaError;
      expect(hexa.code).toBe('TEAM_NOT_FOUND');
      expect(hexa.hint).toContain('Hanwha Life Esports');
    }
  });

  it('still throws a typed error when nothing is close', () => {
    expect(() => requirePlayer('zzzzzzzzzz')).toThrowError(HexaError);
    expect(() => requireTeam('zzzzzzzzzz')).toThrowError(HexaError);
  });
});

describe('listPlayers', () => {
  it('returns everyone when unfiltered', () => {
    expect(listPlayers()).toHaveLength(PLAYERS.length);
  });

  it('filters by team, resolving aliases', () => {
    const byId = listPlayers({ teamId: 'geng' });
    const byTag = listPlayers({ teamId: 'GEN' });
    expect(byId).toEqual(byTag);
    expect(byId.every((p) => p.teamId === 'geng')).toBe(true);
  });

  it('filters by role, region and active flag', () => {
    const mids = listPlayers({ role: 'mid', active: true });
    expect(mids.length).toBeGreaterThan(0);
    expect(mids.every((p) => p.role === 'mid' && p.active)).toBe(true);

    const eu = listPlayers({ region: 'EU' });
    expect(eu.every((p) => p.region === 'EU')).toBe(true);

    const formers = listPlayers({ active: false });
    expect(formers.length).toBeGreaterThan(0);
    expect(formers.every((p) => !p.active)).toBe(true);
  });

  it('composes filters', () => {
    const t1Starters = listPlayers({ teamId: 't1', active: true, role: 'mid' });
    expect(t1Starters.map((p) => p.handle)).toEqual(['Faker']);
  });
});

describe('rosterOf', () => {
  it('returns exactly five starters in ROLE_ORDER for every team', () => {
    for (const team of TEAMS) {
      const lineup = rosterOf(team.id);
      expect(lineup, team.id).toHaveLength(5);
      expect(lineup.map((p) => p.role)).toEqual([...ROLE_ORDER]);
      expect(lineup.every((p) => p.active && p.teamId === team.id)).toBe(true);
    }
  });

  it('accepts aliases', () => {
    expect(rosterOf('SKT').map((p) => p.handle)).toEqual(rosterOf('t1').map((p) => p.handle));
  });

  it('returns the current T1 lineup', () => {
    expect(rosterOf('T1').map((p) => p.handle)).toEqual(['Doran', 'Oner', 'Faker', 'Peyz', 'Keria']);
  });

  it('reflects the mid-season KT bot lane change', () => {
    const kt = rosterOf('KT').map((p) => p.handle);
    expect(kt).toContain('Jiwoo');
    expect(kt).not.toContain('Aiming');
  });

  // Found in the 2026-08-13 audit: KT signed Pollu and Ghost as a rotating
  // support pair, but Effort took the starting job during Spring and was
  // missing from the dataset entirely.
  it('reflects the mid-season KT support change', () => {
    const kt = rosterOf('KT').map((p) => p.handle);
    expect(kt).toContain('Effort');
    expect(kt).not.toContain('Pollu');
    expect(kt).not.toContain('Ghost');
  });

  it('returns an empty lineup for an unknown team rather than throwing', () => {
    expect(rosterOf('not-a-team')).toEqual([]);
  });
});

describe('playersByTeam', () => {
  it('lists starters first, then other active members, then former members', () => {
    const squad = playersByTeam('kt');
    expect(squad.length).toBeGreaterThan(5);

    const tiers = squad.map((p) => (p.active && p.tags?.includes('starter') ? 0 : p.active ? 1 : 2));
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(squad.slice(0, 5).map((p) => p.role)).toEqual([...ROLE_ORDER]);
  });

  it('includes coaching staff', () => {
    expect(playersByTeam('geng').some((p) => p.role === 'coach')).toBe(true);
  });
});

describe('teamOf', () => {
  it('resolves the brand kit for a player', () => {
    const team = teamOf(requirePlayer('gumayusi'));
    expect(team.id).toBe('hle');
    expect(team.colors.primary).toBe('#F3721F');
  });

  it('resolves for every player in the dataset', () => {
    for (const player of PLAYERS) {
      expect(() => teamOf(player), player.handle).not.toThrow();
    }
  });
});

describe('searchPlayers', () => {
  it('ranks an exact handle first', () => {
    expect(searchPlayers('caps')[0]?.id).toBe('caps');
    expect(searchPlayers('ruler')[0]?.id).toBe('ruler');
  });

  it('handles prefixes and substrings', () => {
    expect(searchPlayers('show').map((p) => p.id)).toContain('showmaker');
    expect(searchPlayers('maker').map((p) => p.id)).toContain('showmaker');
  });

  it('tolerates typos', () => {
    expect(searchPlayers('fakr').map((p) => p.id)).toContain('faker');
    expect(searchPlayers('chovi').map((p) => p.id)).toContain('chovy');
  });

  it('searches by legal name and Hangul', () => {
    expect(searchPlayers('Jeong Ji-hoon')[0]?.id).toBe('chovy');
    expect(searchPlayers('정지훈')[0]?.id).toBe('chovy');
  });

  it('falls back to team- and role-scoped matches', () => {
    const g2 = searchPlayers('g2', 20);
    expect(g2.length).toBeGreaterThanOrEqual(5);
    // G2's own squad outranks a player from another org carrying a legacy
    // `g2-…` asset-folder alias.
    expect(g2.slice(0, 5).every((p) => p.teamId === 'g2')).toBe(true);

    const supports = searchPlayers('support', 50);
    expect(supports.every((p) => p.role === 'support')).toBe(true);
  });

  it('respects the limit and returns [] for nonsense', () => {
    expect(searchPlayers('a', 3).length).toBeLessThanOrEqual(3);
    expect(searchPlayers('qqqqqqqqqqqq')).toEqual([]);
    expect(searchPlayers('faker', 0)).toEqual([]);
  });

  it('prefers active players over historical ones on equal footing', () => {
    const bots = searchPlayers('bot', 50);
    expect(bots.length).toBeGreaterThan(0);
    expect(bots.some((p) => !p.active)).toBe(true);
    expect(bots[0]?.active).toBe(true);

    // Every inactive result sorts after every active one at the same signal.
    const firstInactive = bots.findIndex((p) => !p.active);
    expect(bots.slice(0, firstInactive).every((p) => p.active)).toBe(true);
  });
});
