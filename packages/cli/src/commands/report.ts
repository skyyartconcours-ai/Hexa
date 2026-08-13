/**
 * Reporting a finished job.
 *
 * What a person needs after a render, in the order they need it: where the files
 * are, whether they passed, which one to use, and what they owe the
 * photographer. The credit line is not decoration — publishing a press-kit photo
 * without attribution breaks the licence that made it usable, so it is printed
 * every time rather than hidden behind a flag.
 */

import path from 'node:path';
import type { QaFinding, QaReport, ThumbnailJobResult } from '@hexa/core';
import { assets as assetsAdapter, qa as qaAdapter } from '@hexa/pipeline/integration';
import type { AssetLibrary } from '@hexa/pipeline';
import type { CliContext } from '../context.js';
import { displayPath, formatDuration, formatScore } from '../ui/table.js';

export async function reportJob(ctx: CliContext, result: ThumbnailJobResult, library?: AssetLibrary): Promise<void> {
  const credit = await creditFor(result, library);

  if (ctx.json) {
    ctx.emitJson({
      variants: result.variants.map((v) => ({
        id: v.id,
        path: v.path,
        seed: v.seed,
        qa: { passed: v.qa.passed, score: v.qa.score, findings: v.qa.findings },
        appeal: v.appeal,
        variant: describeAxes(v.plan.meta['variant']),
      })),
      best: result.variants[result.bestIndex]?.id,
      bestIndex: result.bestIndex,
      contactSheet: result.contactSheetPath,
      credit,
      totalMs: result.totalMs,
      warnings: result.warnings,
    });
    return;
  }

  const { ui, glyph } = ctx;
  ctx.say();

  for (const [i, variant] of result.variants.entries()) {
    const best = i === result.bestIndex;
    const mark = variant.qa.passed ? ui.ok(glyph.ok) : ui.fail(glyph.fail);
    const star = best ? ui.bold(ui.yellow(' ★ best')) : '';
    const axes = describeAxes(variant.plan.meta['variant']);

    ctx.say(
      `  ${mark} ${ui.bold(displayPath(variant.path))}${star}\n` +
        `      qa ${formatScore(variant.qa.score, ui)}   appeal ${formatScore(variant.appeal, ui)}   ` +
        `${ui.dim(`seed ${variant.seed}`)}${axes ? `   ${ui.dim(axes)}` : ''}`,
    );
  }

  if (result.contactSheetPath) {
    ctx.say(`\n  ${glyph.arrow} contact sheet ${ui.bold(displayPath(result.contactSheetPath))}`);
  }

  const best = result.variants[result.bestIndex];
  if (best && !best.qa.passed) {
    ctx.say(`\n${ui.warn(`${glyph.warn} Even the best variant did not pass every gate:`)}`);
    for (const finding of topFindings(best.qa)) ctx.say(`    ${formatFinding(ctx, finding)}`);
  }

  printWarnings(ctx, result.warnings);

  if (credit) {
    ctx.say(`\n  ${ui.bold('Credit')} ${ui.dim('— required with published output')}`);
    ctx.say(`  ${credit}`);
  }

  ctx.say(`\n  ${ui.dim(`${result.variants.length} variant(s) in ${formatDuration(result.totalMs)}`)}`);
}

/**
 * The attribution line for the assets actually composited.
 *
 * Resolved from the plan's recorded asset ids rather than from the job's
 * warnings, so it stays correct when the identity retry swapped a photograph
 * mid-job.
 */
export async function creditFor(result: ThumbnailJobResult, library?: AssetLibrary): Promise<string> {
  if (!library) return '';
  const ids = new Set<string>();
  for (const variant of result.variants) {
    for (const id of (variant.plan.meta['assets'] as string[] | undefined) ?? []) ids.add(id);
  }

  const used = [...ids].map((id) => library.get(id)).filter((a): a is NonNullable<typeof a> => a !== undefined);
  if (used.length === 0) return '';
  try {
    return await assetsAdapter.creditLine(used);
  } catch {
    return '';
  }
}

/** Failures first, then warnings; capped so one bad render is not a wall of text. */
export function topFindings(report: QaReport, limit = 5): QaFinding[] {
  const rank = (f: QaFinding): number => (f.severity === 'fail' ? 0 : f.severity === 'warn' ? 1 : 2);
  return [...report.findings].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

export function formatFinding(ctx: CliContext, finding: QaFinding): string {
  const { ui, glyph } = ctx;
  const mark = finding.severity === 'fail' ? ui.fail(glyph.fail) : finding.severity === 'warn' ? ui.warn(glyph.warn) : ui.ok(glyph.ok);
  const gate = ui.dim(`[${finding.gate}]`);
  const suggestion = finding.suggestion ? `\n        ${ui.dim(`${glyph.arrow} ${finding.suggestion}`)}` : '';
  return `${mark} ${gate} ${finding.message}${suggestion}`;
}

export function printWarnings(ctx: CliContext, warnings: readonly string[], limit = 8): void {
  // The attribution line is printed as its own section; repeating it as a
  // warning would make the licence obligation look like a complaint.
  const shown = warnings.filter((w) => !w.startsWith('Attribution required'));
  if (shown.length === 0) return;

  ctx.say(`\n  ${ctx.ui.warn(`${ctx.glyph.warn} ${shown.length} warning(s)`)}`);
  for (const warning of shown.slice(0, limit)) ctx.say(`    ${ctx.ui.dim('•')} ${warning}`);
  if (shown.length > limit) ctx.say(`    ${ctx.ui.dim(`… and ${shown.length - limit} more (--log debug for all)`)}`);
}

/** One-line summary of where a variant sits in the variant space. */
function describeAxes(variant: unknown): string {
  if (!variant || typeof variant !== 'object') return '';
  const v = variant as Record<string, unknown>;
  if (v['index'] === 0) return 'template default';
  const parts = [v['lightRig'], v['gradeBias'] === 'template' ? undefined : v['gradeBias'], v['cropTightness'] === 'template' ? undefined : `${String(v['cropTightness'])} crop`]
    .filter((p): p is string => typeof p === 'string');
  return parts.join(' · ');
}

/** Best-variant QA summary, for commands that print one line rather than a block. */
export async function summariseReport(report: QaReport): Promise<string> {
  return qaAdapter.summarise(report);
}
