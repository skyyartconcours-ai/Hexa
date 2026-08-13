import { describe, expect, it } from 'vitest';
import type { LicenseKind, ReferenceAsset } from '@hexa/core';
import { isHexaError } from '@hexa/core';
import {
  LICENCE_RULES,
  assertPublishable,
  creditLine,
  isPublishable,
  licenceObligations,
  licenceRequiresCredit,
  publishBlockers,
} from './provenance.js';

const ALL_LICENCES: LicenseKind[] = ['press-kit', 'cc-by', 'cc-by-sa', 'cc0', 'owned', 'rights-managed', 'unverified'];

function asset(over: Partial<ReferenceAsset> = {}, prov: Partial<ReferenceAsset['provenance']> = {}): ReferenceAsset {
  return {
    id: 'a',
    kind: 'portrait',
    path: 'a.png',
    metrics: { width: 100, height: 100, sharpness: 100, brightness: 128, contrast: 0.3, quality: 50 },
    provenance: { source: 'LCK', license: 'press-kit', addedAt: '2025-01-01T00:00:00Z', cleared: true, ...prov },
    tags: [],
    ...over,
  };
}

describe('LICENCE_RULES', () => {
  it('documents every licence kind in the contract', () => {
    for (const l of ALL_LICENCES) {
      expect(LICENCE_RULES[l]).toBeDefined();
      expect(LICENCE_RULES[l].label.length).toBeGreaterThan(0);
      expect(LICENCE_RULES[l].notes.length).toBeGreaterThan(0);
    }
    expect(Object.keys(LICENCE_RULES).sort()).toEqual([...ALL_LICENCES].sort());
  });

  it('marks only `unverified` as never publishable', () => {
    for (const l of ALL_LICENCES) {
      expect(LICENCE_RULES[l].publishable).toBe(l !== 'unverified');
    }
  });

  it('knows which licences oblige an attribution line', () => {
    expect(licenceRequiresCredit('cc-by')).toBe(true);
    expect(licenceRequiresCredit('cc-by-sa')).toBe(true);
    expect(licenceRequiresCredit('press-kit')).toBe(true);
    expect(licenceRequiresCredit('rights-managed')).toBe(true);
    expect(licenceRequiresCredit('cc0')).toBe(false);
    expect(licenceRequiresCredit('owned')).toBe(false);
  });

  it('carries copyleft through to the output', () => {
    expect(LICENCE_RULES['cc-by-sa'].requiresShareAlike).toBe(true);
    expect(licenceObligations([asset({}, { license: 'cc-by-sa' })])[0]).toMatch(/ShareAlike|CC BY-SA/);
  });
});

describe('isPublishable — the gate', () => {
  it('requires both a human clearance and a known licence', () => {
    expect(isPublishable(asset({}, { license: 'cc-by', cleared: true }))).toBe(true);
    expect(isPublishable(asset({}, { license: 'cc-by', cleared: false }))).toBe(false);
    // The contradiction case: someone ticked "cleared" but never recorded what
    // they cleared. Fails closed.
    expect(isPublishable(asset({}, { license: 'unverified', cleared: true }))).toBe(false);
    expect(isPublishable(asset({}, { license: 'unverified', cleared: false }))).toBe(false);
  });

  it('treats a missing or non-boolean `cleared` as not cleared', () => {
    expect(isPublishable(asset({}, { cleared: undefined as unknown as boolean }))).toBe(false);
    expect(isPublishable(asset({}, { cleared: 'yes' as unknown as boolean }))).toBe(false);
    expect(isPublishable({ ...asset(), provenance: undefined as unknown as ReferenceAsset['provenance'] })).toBe(false);
  });

  it('explains exactly what is blocking', () => {
    expect(publishBlockers(asset({}, { license: 'cc-by', cleared: true }))).toEqual([]);
    const blockers = publishBlockers(asset({}, { license: 'unverified', cleared: false }));
    expect(blockers.join(' ')).toMatch(/unverified/);
    expect(blockers.join(' ')).toMatch(/cleared/);
  });

  it('throws NO_CLEARED_ASSET when a publish-grade render reaches for a blocked asset', () => {
    expect(() => assertPublishable([asset({ id: 'ok' }, { license: 'cc-by', cleared: true })])).not.toThrow();
    try {
      assertPublishable([asset({ id: 'bad' }, { license: 'unverified', cleared: false })]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      expect(isHexaError(err) && err.code).toBe('NO_CLEARED_ASSET');
      expect((err as Error).message).toContain('bad');
    }
  });
});

describe('creditLine', () => {
  it('builds "Photos: X (LCK), Y (Riot Games)" from the assets actually used', () => {
    const line = creditLine([
      asset({ id: '1' }, { photographer: 'X', source: 'LCK', license: 'press-kit' }),
      asset({ id: '2' }, { photographer: 'Y', source: 'Riot Games', license: 'press-kit' }),
    ]);
    expect(line).toBe('Photos: X (LCK), Y (Riot Games)');
  });

  it('deduplicates and sorts, so the same set always renders the same line', () => {
    const a = asset({ id: '1' }, { photographer: 'Y', source: 'Riot Games' });
    const b = asset({ id: '2' }, { photographer: 'y', source: 'riot games' });
    const c = asset({ id: '3' }, { photographer: 'X', source: 'LCK' });
    expect(creditLine([a, b, c])).toBe('Photos: X (LCK), Y (Riot Games)');
    expect(creditLine([c, b, a])).toBe(creditLine([a, b, c]));
  });

  it('prefers an explicit credit string when one was recorded', () => {
    const line = creditLine([asset({}, { credit: '© 2025 Riot Games / Colin Young-Wolff', photographer: 'ignored' })]);
    expect(line).toBe('Photos: © 2025 Riot Games / Colin Young-Wolff');
  });

  it('falls back to the source when no photographer is known', () => {
    expect(creditLine([asset({}, { source: 'LCK Media Kit', photographer: undefined })])).toBe('Photos: LCK Media Kit');
  });

  it('omits licences that need no credit, but honours a volunteered one', () => {
    expect(creditLine([asset({}, { license: 'cc0', photographer: 'Nobody' })])).toBe('');
    expect(creditLine([asset({}, { license: 'owned', source: 'me' })])).toBe('');
    expect(creditLine([asset({}, { license: 'cc0', credit: 'Kind Soul' })])).toBe('Photos: Kind Soul');
  });

  it('returns an empty string for an empty set', () => {
    expect(creditLine([])).toBe('');
  });

  it('does not repeat a name when photographer and source are the same', () => {
    expect(creditLine([asset({}, { photographer: 'LCK', source: 'LCK' })])).toBe('Photos: LCK');
  });
});
