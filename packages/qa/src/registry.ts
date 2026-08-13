/**
 * The gate registry and the runner.
 *
 * Two invariants matter here:
 *   1. A broken gate must never kill a render. Any throw is caught and turned
 *      into a warning that names the gate, so a bug in banding detection cannot
 *      take down a job that was otherwise fine.
 *   2. `passed` means "no gate said fail". It does not mean "everything was
 *      checked" — an unverifiable identity is a warning, and the summary says
 *      so out loud, because "unverified" and "verified" must never be conflated.
 */

import type { QaFinding, QaReport } from '@hexa/core';
import type { Gate, GateContext } from './types.js';
import { identityGate } from './gates/identity.js';
import { legibilityGate } from './gates/legibility.js';
import { contrastGate } from './gates/contrast.js';
import { safeZoneGate } from './gates/safeZone.js';
import { facePlacementGate } from './gates/facePlacement.js';
import { clutterGate } from './gates/clutter.js';
import { colorHarmonyGate } from './gates/colorHarmony.js';
import { licenseGate } from './gates/license.js';
import { bandingGate } from './gates/banding.js';
import { duplicateGate } from './gates/duplicate.js';

/** Registered gates, in report order. Mutable so hosts can add their own. */
export const GATES: Gate[] = [
  identityGate,
  legibilityGate,
  contrastGate,
  safeZoneGate,
  facePlacementGate,
  clutterGate,
  colorHarmonyGate,
  licenseGate,
  bandingGate,
  duplicateGate,
];

/** Add a gate, or replace an existing one with the same id (which is how a host
 *  swaps in a stricter identity gate without forking the package). */
export function registerGate(g: Gate): void {
  const i = GATES.findIndex((x) => x.id === g.id);
  if (i >= 0) GATES[i] = g;
  else GATES.push(g);
}

/** Severity → score when a finding does not carry an explicit one. */
function severityScore(f: QaFinding): number {
  if (typeof f.score === 'number' && Number.isFinite(f.score)) return Math.max(0, Math.min(1, f.score));
  return f.severity === 'fail' ? 0 : f.severity === 'warn' ? 0.6 : 1;
}

/**
 * Run the gates and aggregate.
 *
 * A gate's score is the *worst* of its findings — averaging would let three
 * cheerful passes hide one broken headline. The report score is the weighted
 * mean of those gate scores, scaled to 0–100. Gates that crashed are left out
 * of both `gateScores` and the mean: a score they never produced should not be
 * invented, and the warning they generate is what the reader acts on.
 */
export async function runGates(
  ctx: GateContext,
  opts: { only?: string[]; skip?: string[] } = {},
): Promise<QaReport> {
  const selected = GATES.filter((g) => {
    if (opts.only && !opts.only.includes(g.id)) return false;
    if (opts.skip && opts.skip.includes(g.id)) return false;
    return true;
  });

  const findings: QaFinding[] = [];
  const gateScores: Record<string, number> = {};
  let weighted = 0;
  let totalWeight = 0;

  for (const gate of selected) {
    try {
      const produced = await gate.run(ctx);
      const own = produced.map((f) => ({ ...f, gate: f.gate || gate.id }));
      findings.push(...own);
      const score = own.length === 0 ? 1 : Math.min(...own.map(severityScore));
      gateScores[gate.id] = Math.round(score * 1000) / 1000;
      weighted += score * gate.weight;
      totalWeight += gate.weight;
    } catch (err) {
      findings.push({
        gate: gate.id,
        severity: 'warn',
        message: `Gate "${gate.id}" threw and was skipped: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: `This render was NOT checked for "${gate.description}". Treat it as unverified for that dimension and file the crash — a gate failing open is a hole in the guarantee.`,
      });
    }
  }

  if (totalWeight === 0) {
    findings.push({
      gate: 'qa',
      severity: 'warn',
      message: selected.length === 0
        ? 'No gates ran — every gate was filtered out by only/skip, so this render is entirely unchecked'
        : 'No gate completed successfully, so this render is entirely unchecked',
      score: 0,
      suggestion: 'Check the only/skip filters passed to runGates, or the crash warnings above.',
    });
  }

  return {
    passed: !findings.some((f) => f.severity === 'fail'),
    score: totalWeight === 0 ? 0 : Math.round((weighted / totalWeight) * 100),
    findings,
    gateScores,
  };
}
