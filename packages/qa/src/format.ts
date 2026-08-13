/**
 * Console rendering for a QA report.
 *
 * The design goal is that a person reading a failed run in a terminal knows
 * what broke, where, and what to do, without opening the JSON. Failures first,
 * suggestions attached, passes last and dimmed — and a per-gate bar so a
 * borderline render is visibly borderline rather than just "82".
 */

import type { QaFinding, QaReport, QaSeverity } from '@hexa/core';
import { GATES } from './registry.js';

const C = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
};

const ORDER: Record<QaSeverity, number> = { fail: 0, warn: 1, pass: 2 };
const TAG: Record<QaSeverity, string> = { fail: 'FAIL', warn: 'WARN', pass: 'PASS' };
const COLOR: Record<QaSeverity, string> = { fail: C.red, warn: C.yellow, pass: C.green };

/**
 * Findings as an aligned block: severity tag, gate, message, then an indented
 * remedy and location. `color` defaults to off so the output is safe to write
 * into logs and snapshots.
 */
export function formatFindings(findings: QaFinding[], opts: { color?: boolean } = {}): string {
  if (findings.length === 0) return 'No findings.';
  const useColor = opts.color ?? false;
  const paint = (c: string, s: string) => (useColor ? `${c}${s}${C.reset}` : s);

  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.gate.localeCompare(b.gate));
  const gateWidth = Math.max(...sorted.map((f) => f.gate.length));

  const lines: string[] = [];
  for (const f of sorted) {
    const tag = paint(COLOR[f.severity], TAG[f.severity]);
    const gate = paint(C.cyan, f.gate.padEnd(gateWidth));
    const body = f.severity === 'pass' ? paint(C.dim, f.message) : f.message;
    lines.push(`${tag} ${gate}  ${body}`);
    if (f.where) {
      const w = f.where;
      lines.push(paint(C.dim, `     ${' '.repeat(gateWidth)}  at x${fmt(w.x)} y${fmt(w.y)} w${fmt(w.w)} h${fmt(w.h)} (normalised)`));
    }
    if (f.suggestion) {
      lines.push(paint(C.dim, `     ${' '.repeat(gateWidth)}  → ${f.suggestion}`));
    }
  }
  return lines.join('\n');
}

function fmt(v: number): string {
  return v.toFixed(2);
}

/** Human-readable summary of a whole report: verdict, per-gate bars, findings. */
export function summarise(report: QaReport): string {
  const counts = { fail: 0, warn: 0, pass: 0 } as Record<QaSeverity, number>;
  for (const f of report.findings) counts[f.severity]++;

  const verdict = report.passed ? 'PASS' : 'FAIL';
  const header = `QA ${report.score}/100 — ${verdict}  (${counts.fail} fail, ${counts.warn} warn, ${counts.pass} pass)`;

  const ids = Object.keys(report.gateScores);
  const width = ids.length ? Math.max(...ids.map((i) => i.length)) : 0;
  const bars = ids.map((id) => {
    const score = report.gateScores[id] ?? 0;
    const filled = Math.round(score * 20);
    const weight = GATES.find((g) => g.id === id)?.weight;
    const bar = `${'█'.repeat(filled)}${'·'.repeat(20 - filled)}`;
    return `  ${id.padEnd(width)}  ${score.toFixed(2)}  ${bar}${weight ? `  ×${weight}` : ''}`;
  });

  // Any gate that was asked for but produced no score crashed; call it out,
  // because silence there would read as approval.
  const missing = report.findings
    .filter((f) => f.severity === 'warn' && !(f.gate in report.gateScores) && f.gate !== 'qa')
    .map((f) => f.gate);
  const unchecked = [...new Set(missing)];

  const parts = [header, ...(bars.length ? ['', ...bars] : [])];
  if (unchecked.length) parts.push('', `Not checked (gate crashed): ${unchecked.join(', ')}`);
  parts.push('', formatFindings(report.findings));
  return parts.join('\n');
}
