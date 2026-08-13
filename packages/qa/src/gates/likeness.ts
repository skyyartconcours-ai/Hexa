/**
 * Likeness gate — does this render actually depict the person it names?
 *
 * Hexa can render a subject without a photograph: a schematic placeholder bust
 * stands in, deliberately drawn so no human would mistake it for a person. That
 * is a good property of the *renderer*. It is a dangerous property of the
 * *output*, because the thumbnail still carries the player's handle, the team
 * badge and the framing of a portrait — and once it is out of the tool, nothing
 * about the file says the figure under the name is a diagram.
 *
 * The identity gate cannot catch this. It compares a rendered face against a
 * reference gallery, and a placeholder subject has no gallery, so identity says
 * "unverified" — a warning that reads like a missing-dependency notice rather
 * than what it is: *this picture does not show that person*. Those are different
 * claims and the report must not blur them.
 *
 * So this gate states it plainly and vetoes. The only way to silence it is to
 * declare the truth: mark the subject `anonymous` (a silhouette treatment the
 * caller has chosen and is not passing off as a likeness), or ingest a licensed
 * photograph. Both are honest; shipping a named placeholder is not.
 *
 * Overlap with the identity gate is deliberate, and so is the disagreement.
 * Identity flags a placeholder it can see in `subject.assets`, at warning level
 * unless the request asked for publish-grade provenance. This gate reads the
 * *plan's* own record as well (`meta.placeholders`, which the pipeline writes
 * whether or not the caller passes assets through), and it vetoes every time,
 * because "publish-grade" is a property of the request and "this is not that
 * person" is a property of the picture. A render nobody marked publish-grade
 * still ends up in a channel by being a file on disk.
 */

import type { QaFinding, ReferenceAsset } from '@hexa/core';
import type { Gate, GateContext, GateSubject } from '../types.js';
import { placeholderSubjects } from '../plan.js';

/** Tags the asset library puts on anything synthetic. */
const SYNTHETIC_TAGS = ['placeholder', 'synthetic', 'no-identity'];

export const likenessGate: Gate = {
  id: 'likeness',
  weight: 2.5,
  description: 'Every named subject is a real photographic likeness, not a synthetic stand-in presented under their name',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    if (ctx.subjects.length === 0) {
      return [{
        gate: 'likeness',
        severity: 'pass',
        message: 'No subjects in this render — no likeness is being claimed',
        score: 1,
      }];
    }

    const fromPlan = placeholderSubjects(ctx.plan);
    const findings: QaFinding[] = [];
    let real = 0;

    for (const subject of ctx.subjects) {
      const evidence = synthetic(subject, fromPlan);

      if (subject.anonymous) {
        findings.push({
          gate: 'likeness',
          severity: 'pass',
          message: evidence
            ? `${subject.handle} is a declared anonymous treatment drawn from ${evidence} — no likeness claimed, and the request says so`
            : `${subject.handle} is a declared anonymous treatment — no likeness claimed`,
          score: 1,
          subjectId: subject.playerId,
        });
        continue;
      }

      if (!evidence) {
        real++;
        continue;
      }

      findings.push({
        gate: 'likeness',
        severity: 'fail',
        message: `This render does not depict ${subject.handle}. The subject slot under that name was filled with a synthetic stand-in (${evidence}) — there is no photographic likeness of ${subject.handle} anywhere in these pixels, only a schematic figure captioned with their handle`,
        score: 0,
        subjectId: subject.playerId,
        suggestion:
          `Ingest a licensed photograph — hexa assets ingest <dir> --player ${subject.handle} --license press-kit --source "..." — and re-render. ` +
          'If the stand-in is intentional (a teaser, a silhouette treatment), mark that subject anonymous so the report records that no likeness is being claimed. ' +
          'What must not happen is this file leaving the tool as a picture of a player it does not show.',
      });
    }

    if (findings.length === 0) {
      findings.push({
        gate: 'likeness',
        severity: 'pass',
        message: `All ${real} subject${real === 1 ? '' : 's'} were rendered from real reference photography`,
        score: 1,
      });
    } else if (real === 0 && findings.every((f) => f.severity === 'fail')) {
      findings.push({
        gate: 'likeness',
        severity: 'fail',
        message: `Every subject in this render is a placeholder — the thumbnail depicts nobody at all, while naming ${ctx.subjects.map((s) => s.handle).join(' and ')}`,
        score: 0,
        suggestion: 'Treat this render as a layout proof, not as a thumbnail of these players. It is safe to review internally and not safe to publish.',
      });
    }

    return findings;
  },
};

/**
 * Why we believe this subject is synthetic, or null.
 *
 * Three independent signals, because they come from different layers and any one
 * of them can be missing: the pipeline records `meta.placeholders`, the asset
 * library tags the record, and the provenance note says so in prose.
 */
function synthetic(subject: GateSubject, fromPlan: Set<string>): string | null {
  if (fromPlan.has(subject.playerId)) return 'plan.meta.placeholders lists this subject';

  for (const asset of subject.assets ?? []) {
    const tag = (asset.tags ?? []).find((t) => SYNTHETIC_TAGS.includes(t.toLowerCase()));
    if (tag) return `asset ${asset.id} is tagged "${tag}"`;
    if (isSyntheticProvenance(asset)) return `asset ${asset.id} declares provenance "${asset.provenance.source}"`;
  }
  return null;
}

function isSyntheticProvenance(asset: ReferenceAsset): boolean {
  const source = `${asset.provenance?.source ?? ''} ${asset.provenance?.notes ?? ''}`.toLowerCase();
  return /placeholder|synthetic|stand-?in|generated schematic/.test(source);
}
