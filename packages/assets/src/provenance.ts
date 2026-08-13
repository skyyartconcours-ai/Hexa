/**
 * Licensing and provenance.
 *
 * The product rule is absolute: a generative model never invents a human face.
 * Every face pixel traces to a real photograph — which means every render also
 * inherits that photograph's licence. This module is where that inheritance is
 * made explicit and enforceable, rather than a README promise.
 *
 * Three jobs:
 *   1. {@link LICENCE_RULES} — a machine-readable statement of what each
 *      licence actually permits, so the gate is auditable instead of folklore.
 *   2. {@link isPublishable} — the single predicate publish-grade renders use.
 *   3. {@link creditLine} — the attribution string that must ship *with* the
 *      output, built from the assets actually composited, not from a guess.
 */

import type { LicenseKind, ReferenceAsset } from '@hexa/core';
import { HexaError } from '@hexa/core';

/** What a single licence permits, in terms the pipeline can act on. */
export interface LicenceRule {
  /** Short human label for CLI output and the studio UI. */
  label: string;
  /** May the photograph be altered/composited at all? */
  allowsDerivatives: boolean;
  /** May the output be used commercially (sponsored thumbnails, ads)? */
  allowsCommercial: boolean;
  /** Must an attribution string accompany published output? */
  requiresCredit: boolean;
  /** Must the derivative carry the same licence (copyleft)? */
  requiresShareAlike: boolean;
  /**
   * Can this licence ever reach publish-grade output? `unverified` is the only
   * hard "no" — everything else still needs a human to tick `cleared`.
   */
  publishable: boolean;
  /** One-line explanation shown when the gate blocks a render. */
  notes: string;
}

/**
 * Per-licence permissions.
 *
 * Deliberately conservative: when a licence family has variants (CC BY-NC,
 * agency deals with territory limits), the strictest common reading wins and
 * the per-asset `provenance.notes` carries the specifics. This table is a gate,
 * not legal advice — `cleared` still requires a human.
 */
export const LICENCE_RULES: Record<LicenseKind, LicenceRule> = {
  'press-kit': {
    label: 'Official press kit',
    allowsDerivatives: true,
    allowsCommercial: false, // editorial use; sponsored/ad use needs a separate deal
    requiresCredit: true,
    requiresShareAlike: false,
    publishable: true,
    notes: 'League/team media kit. Editorial use with credit; check the kit terms before commercial use.',
  },
  'cc-by': {
    label: 'CC BY',
    allowsDerivatives: true,
    allowsCommercial: true,
    requiresCredit: true,
    requiresShareAlike: false,
    publishable: true,
    notes: 'Creative Commons Attribution — free to remix, credit is mandatory.',
  },
  'cc-by-sa': {
    label: 'CC BY-SA',
    allowsDerivatives: true,
    allowsCommercial: true,
    requiresCredit: true,
    requiresShareAlike: true,
    publishable: true,
    notes: 'Attribution + ShareAlike — the rendered thumbnail inherits the CC BY-SA licence.',
  },
  cc0: {
    label: 'CC0 / public domain',
    allowsDerivatives: true,
    allowsCommercial: true,
    requiresCredit: false,
    requiresShareAlike: false,
    publishable: true,
    notes: 'No rights reserved. Credit is courteous but not required.',
  },
  owned: {
    label: 'Owned outright',
    allowsDerivatives: true,
    allowsCommercial: true,
    requiresCredit: false,
    requiresShareAlike: false,
    publishable: true,
    notes: 'Shot by, or fully assigned to, the operator. No external attribution needed.',
  },
  'rights-managed': {
    label: 'Rights-managed licence',
    allowsDerivatives: true,
    allowsCommercial: true,
    requiresCredit: true,
    requiresShareAlike: false,
    publishable: true,
    notes: 'Agency licence with scope limits (term, territory, placement). Credit the agency; keep the licence id in notes.',
  },
  unverified: {
    label: 'Unverified',
    allowsDerivatives: false,
    allowsCommercial: false,
    requiresCredit: true,
    requiresShareAlike: false,
    publishable: false,
    notes: 'Provenance unknown. Usable for local previews only — never for publish-grade output.',
  },
};

/** Does this licence oblige us to print an attribution line? */
export function licenceRequiresCredit(l: LicenseKind): boolean {
  return LICENCE_RULES[l]?.requiresCredit ?? true; // unknown licence ⇒ assume the strict answer
}

/** Look up a licence rule, falling back to the strictest entry. */
export function licenceRule(l: LicenseKind): LicenceRule {
  return LICENCE_RULES[l] ?? LICENCE_RULES.unverified;
}

/**
 * The publish gate.
 *
 * Both halves matter and neither implies the other:
 *  - `cleared` is the human signature: someone read the terms and accepted them.
 *  - `license !== 'unverified'` is the record: we know *what* was accepted.
 * A ticked `cleared` on an `unverified` licence is a contradiction, so it fails.
 */
export function isPublishable(a: ReferenceAsset): boolean {
  const p = a?.provenance;
  if (!p) return false;
  if (p.cleared !== true) return false;
  if (p.license === 'unverified') return false;
  return licenceRule(p.license).publishable;
}

/**
 * Build the attribution string that must accompany published output.
 *
 * Format: `Photos: Name (Source), Other Name (Other Source)`.
 *
 * Entries are deduplicated case-insensitively and sorted, so the same set of
 * assets always yields a byte-identical line regardless of the order they were
 * composited in (renders stay diffable and cacheable). Where two records spell
 * the same credit differently, the better-capitalised spelling wins — names are
 * proper nouns, and "Riot Games" beats "riot games".
 *
 * An asset contributes an entry when its licence requires credit, or whenever
 * an explicit `provenance.credit` was recorded — an operator who chose to
 * credit a CC0 photographer gets their wish honoured.
 */
export function creditLine(assets: readonly ReferenceAsset[], opts: { prefix?: string } = {}): string {
  const prefix = opts.prefix ?? 'Photos';
  const entries = new Map<string, string>(); // lowercased key → display form

  for (const a of assets ?? []) {
    const p = a?.provenance;
    if (!p) continue;
    const explicit = clean(p.credit);
    if (!explicit && !licenceRequiresCredit(p.license)) continue;

    const entry = explicit ?? formatEntry(clean(p.photographer), clean(p.source));
    if (!entry) continue;
    const key = entry.toLowerCase();
    const held = entries.get(key);
    if (held === undefined || preferSpelling(entry, held) < 0) entries.set(key, entry);
  }

  if (entries.size === 0) return '';
  const sorted = [...entries.values()].sort((x, y) => x.localeCompare(y, 'en'));
  return `${prefix}: ${sorted.join(', ')}`;
}

/** `Photographer (Source)`, degrading gracefully when one half is missing. */
function formatEntry(photographer: string | undefined, source: string | undefined): string | undefined {
  if (photographer && source && photographer.toLowerCase() !== source.toLowerCase()) {
    return `${photographer} (${source})`;
  }
  return photographer ?? source;
}

/**
 * Order two spellings of the same credit: more capitals first (proper nouns),
 * then alphabetically. Negative ⇒ `a` is the better spelling. Total and
 * order-independent, so the printed line does not depend on composite order.
 */
function preferSpelling(a: string, b: string): number {
  const capitals = (s: string) => (s.match(/[A-Z]/g) ?? []).length;
  return capitals(b) - capitals(a) || a.localeCompare(b, 'en');
}

function clean(v: string | undefined): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/**
 * Human-readable reasons an asset is not publish-grade. Empty array ⇒ it is.
 * Used by the CLI to tell an operator exactly which box to tick.
 */
export function publishBlockers(a: ReferenceAsset): string[] {
  const out: string[] = [];
  const p = a?.provenance;
  if (!p) return ['no provenance recorded'];
  if (p.license === 'unverified') out.push('licence is unverified — record where the photo came from');
  if (p.cleared !== true) out.push('not cleared — a human must confirm the licence permits derivative use');
  if (p.license !== 'unverified' && !licenceRule(p.license).allowsDerivatives) {
    out.push(`${licenceRule(p.license).label} does not permit derivative works`);
  }
  return out;
}

/**
 * Extra obligations the *output* inherits from the assets used — surfaced next
 * to a finished render so the operator knows what ships with it.
 */
export function licenceObligations(assets: readonly ReferenceAsset[]): string[] {
  const out = new Set<string>();
  for (const a of assets ?? []) {
    const rule = licenceRule(a?.provenance?.license ?? 'unverified');
    if (rule.requiresShareAlike) out.add(`Output inherits ${rule.label}: publish the thumbnail under the same licence.`);
    if (!rule.allowsCommercial) out.add(`${rule.label}: editorial use only — clear commercial use separately.`);
  }
  return [...out].sort((x, y) => x.localeCompare(y, 'en'));
}

/**
 * Throw unless every asset clears the publish gate. Publish-grade render paths
 * call this once, with the exact assets they composited.
 *
 * @throws HexaError `NO_CLEARED_ASSET`
 */
export function assertPublishable(assets: readonly ReferenceAsset[]): void {
  const bad = (assets ?? []).filter((a) => !isPublishable(a));
  if (bad.length === 0) return;
  throw new HexaError(
    'NO_CLEARED_ASSET',
    `${bad.length} asset(s) are not cleared for publish-grade output: ${bad.map((a) => a.id).join(', ')}`,
    {
      hint: 'Record the licence and tick `provenance.cleared` (hexa assets clear <id>), or re-render with --draft.',
      details: {
        blockers: Object.fromEntries(bad.map((a) => [a.id, publishBlockers(a)])),
      },
    },
  );
}
