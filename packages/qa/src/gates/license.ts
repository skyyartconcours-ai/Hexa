/**
 * Licence gate.
 *
 * The identity promise has a legal twin: every pixel of a real person's face
 * traces back to an asset somebody is allowed to use. `provenance.cleared` is
 * set by a human, not by the ingester, and `license: 'unverified'` means the
 * file was pulled in but never checked. Publish-grade output must have neither.
 *
 * This gate is pure metadata — no pixels — which is exactly why it is cheap
 * enough to always run.
 */

import type { QaFinding, ReferenceAsset } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';

function describe(asset: ReferenceAsset): string {
  const p = asset.provenance;
  return `${asset.id} (${asset.kind}, ${asset.path}) — licence "${p.license}", source "${p.source}", cleared=${p.cleared}`;
}

export const licenseGate: Gate = {
  id: 'license',
  weight: 1.5,
  description: 'Every contributing asset carries a cleared, verified licence when the request demands publish-grade provenance',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const required = ctx.request?.requireClearedLicense === true;
    const findings: QaFinding[] = [];
    let checked = 0;
    let problems = 0;

    for (const subject of ctx.subjects) {
      const assets = subject.assets ?? [];
      if (!assets.length) {
        if (required) {
          findings.push({
            gate: 'license',
            severity: 'warn',
            message: `No assets were recorded for ${subject.handle}, so their licence status cannot be confirmed even though this request requires cleared licences`,
            score: 0.4,
            subjectId: subject.playerId,
            suggestion: 'Pass the ReferenceAssets the compositor actually used in GateContext.subjects[].assets so provenance can be audited.',
          });
        }
        continue;
      }

      for (const asset of assets) {
        checked++;
        const uncleared = asset.provenance.cleared !== true;
        const unverified = asset.provenance.license === 'unverified';
        if (!uncleared && !unverified) continue;
        problems++;

        const reason = uncleared && unverified
          ? 'it is neither cleared nor licence-verified'
          : uncleared
            ? 'nobody has confirmed the licence permits derivative use (provenance.cleared is not true)'
            : 'its licence is recorded as "unverified"';

        findings.push({
          gate: 'license',
          severity: required ? 'fail' : 'warn',
          message: `${subject.handle}'s asset ${describe(asset)} cannot be published: ${reason}`,
          score: required ? 0 : 0.5,
          subjectId: subject.playerId,
          suggestion: required
            ? `Either clear it — confirm the licence permits derivative use and set provenance.cleared, e.g. hexa assets clear ${asset.id} --license press-kit — or re-render with requireClearedLicense and let the asset picker choose a cleared alternative (AssetQuery.requireCleared).`
            : `This render is not publish-grade. Clear ${asset.id} before it goes out, or set qa.requireClearedLicense to have the picker avoid it in the first place.`,
        });
      }
    }

    if (problems === 0) {
      findings.push({
        gate: 'license',
        severity: 'pass',
        message: checked > 0
          ? `All ${checked} contributing asset${checked === 1 ? '' : 's'} carry a cleared, verified licence`
          : 'No reference assets were recorded for this render, and the request does not require cleared licences',
        score: 1,
      });
    }

    return findings;
  },
};
