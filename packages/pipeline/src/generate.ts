/**
 * The orchestrator: request in, thumbnails out.
 *
 * Stage order — resolve, select, cutout, detect, backplate, compile, render, QA,
 * retry, emit — with each stage a function you can call and test on its own.
 * This file is the wiring, the timing and the one piece of real control flow:
 * the identity retry.
 *
 * THE RETRY
 * When QA rejects a render because a face does not verify, the remedy is not to
 * re-roll the seed — the composite is fine, the *photograph* was wrong for it
 * (an extreme angle, heavy stage lighting, a partly occluded face). So the
 * failing subject is re-prepared from the next-best asset in their ranked list
 * and the variant is recompiled once. One retry, not a loop: if the second-best
 * photograph also fails, the honest answer is a warning and a report the
 * operator can act on, not a machine grinding through a library.
 */

import { HexaError, isHexaError } from '@hexa/core';
import type {
  QaReport,
  ReferenceAsset,
  RenderPlan,
  ThumbnailJobResult,
  ThumbnailRequest,
  ThumbnailVariant,
} from '@hexa/core';
import { completeDeps } from './deps.js';
import { resolvePalette } from './palette.js';
import { compilePlan } from './stages/compile.js';
import { prepareBackplate } from './stages/backplate.js';
import { emitContactSheet, emitVariant, ensureOutputDir, creditFor } from './stages/emit.js';
import { prepareSubjects, reprepareWithAsset } from './stages/prepare.js';
import { runQaStage } from './stages/qa.js';
import { renderVariant } from './stages/render.js';
import { resolveRequest } from './stages/resolve.js';
import { resolveTemplateStyle } from './adapters/templates.js';
import * as qaAdapter from './adapters/qa.js';
import type { CompileInput, PipelineDeps, PreparedSubject } from './types.js';
import { describeVariant, planVariants } from './variants.js';
import { validateRequest } from './validate.js';

/**
 * Generate a thumbnail job: one request, one or more variants, QA'd and written.
 *
 * @param deps partial dependencies; anything omitted is built with `createDeps`
 */
export async function generateThumbnail(
  req: ThumbnailRequest,
  deps?: Partial<PipelineDeps>,
): Promise<ThumbnailJobResult> {
  const started = performance.now();
  const request = validateRequest(req);
  const resolved = await completeDeps(deps);
  const log = resolved.logger.child('job');
  const warnings: string[] = [];

  const { template, aspect, canvas, warnings: resolveWarnings } = await log.stage('resolve', () =>
    resolveRequest(request),
  );
  warnings.push(...resolveWarnings);

  const subjects = await log.stage('prepare-subjects', () =>
    prepareSubjects(request.subjects, resolved, {
      aspect,
      requireCleared: request.qa.requireClearedLicense,
      bust: true,
    }),
  );
  for (const s of subjects) warnings.push(...(s.warnings ?? []));

  const palette = resolvePalette(subjects, request.palette);

  const style = await resolveTemplateStyle(template, {
    subjects: subjects.map((s) => ({ player: s.player, team: s.team, side: s.side, accent: s.accent })),
    text: request.text,
    aspect,
    seed: request.seed,
    palette,
  });

  // Generated once and shared by every variant: an image-model call is the most
  // expensive thing in the pipeline by orders of magnitude, and the variants
  // differ in light, grade, crop and atmosphere — not in what the arena behind
  // them looks like. (Consequence: the `backdrop` variant axis only bites when
  // the backdrop is procedural.)
  const backplate = await log.stage('backplate', () =>
    prepareBackplate({
      template,
      style,
      palette,
      canvas,
      seed: request.seed,
      background: request.background,
      provider: resolved.aiProvider,
      logger: log,
    }),
  );
  warnings.push(...backplate.warnings);

  const base: CompileInput = {
    template,
    subjects,
    text: request.text,
    aspect,
    seed: request.seed,
    palette,
    backplate: backplate.buffer,
    deps: resolved,
    grade: request.grade,
    background: request.background,
  };

  const plans = planVariants(base, request.variants);
  const outputDir = await ensureOutputDir(request.output.dir);

  const variants: ThumbnailVariant[] = [];
  const images: Buffer[] = [];
  const labels: string[] = [];
  const usedAssets: ReferenceAsset[] = [];
  const rejected: { variantId: string; report: QaReport }[] = [];

  for (const input of plans) {
    const variantId = input.variantId ?? 'v01';
    const vlog = log.child(variantId);

    try {
      const outcome = await renderWithIdentityRetry(input, resolved, request, vlog);
      warnings.push(...outcome.warnings);
      usedAssets.push(...outcome.subjects.map((s) => s.asset));

      // Strict mode aborts rather than shipping something the gates rejected.
      // The image is still not written, but the report travels back so the
      // operator can see exactly which gate objected.
      if (request.qa.strict && !outcome.qa.passed) {
        rejected.push({ variantId, report: outcome.qa });
        vlog.warn('variant failed QA and strict mode is on — not written', {
          score: outcome.qa.score,
        });
        continue;
      }

      const emitted = await emitVariant({
        image: outcome.image,
        plan: outcome.plan,
        variantId,
        total: plans.length,
        dir: outputDir,
        options: { output: request.output, logger: vlog },
      });

      variants.push({
        id: variantId,
        path: emitted.imagePath,
        plan: outcome.plan,
        qa: outcome.qa,
        appeal: outcome.appeal,
        seed: input.seed,
      });
      images.push(outcome.image);
      labels.push(`${variantId} · ${describeVariant(input.variant ?? { index: 0 } as never)}`);
    } catch (e) {
      // One bad variant should not lose the others: a template that cannot lay
      // out one crop tightness can usually lay out the rest.
      if (plans.length === 1) throw e;
      const reason = e instanceof Error ? e.message : String(e);
      warnings.push(`Variant ${variantId} failed: ${reason}`);
      vlog.error('variant failed', { reason });
    }
  }

  if (variants.length === 0) {
    throw noVariantsError(rejected, warnings);
  }

  const bestIndex = await qaAdapter.pickBest(variants.map((v) => ({ qa: v.qa, appeal: v.appeal })));

  const contactSheetPath = request.output.contactSheet
    ? await emitContactSheet({ images, labels, dir: outputDir, name: request.output.name, logger: log })
    : undefined;

  const credit = await creditFor(usedAssets);
  if (credit) warnings.push(`Attribution required with published output — ${credit}`);

  return {
    request,
    variants,
    bestIndex: Math.max(0, bestIndex),
    contactSheetPath,
    totalMs: Math.round(performance.now() - started),
    warnings: dedupe(warnings),
  };
}

interface VariantOutcome {
  image: Buffer;
  plan: RenderPlan;
  qa: QaReport;
  appeal: number;
  subjects: PreparedSubject[];
  warnings: string[];
}

/**
 * Compile → render → QA, with a single identity retry.
 *
 * Everything about what happened is recorded: which subject failed, which
 * photograph was tried instead, and whether it helped. A silent retry would make
 * a library of unusable photographs look like a library of fine ones.
 */
async function renderWithIdentityRetry(
  input: CompileInput,
  deps: PipelineDeps,
  request: ReturnType<typeof validateRequest>,
  log: PipelineDeps['logger'],
): Promise<VariantOutcome> {
  const warnings: string[] = [];
  let subjects = input.subjects;

  let plan = await log.stage('compile', () => compilePlan({ ...input, subjects }));
  let rendered = await log.stage('render', () =>
    renderVariant({ plan, subjects, backplate: input.backplate, logger: log }),
  );
  let assessed = await log.stage('qa', () =>
    runQaStage({
      image: rendered.buffer,
      plan,
      subjects,
      library: deps.library,
      vision: deps.vision,
      request: request.qa,
      logger: log,
    }),
  );
  warnings.push(...assessed.warnings);

  if (assessed.identityFailures.length === 0) {
    return { image: rendered.buffer, plan, qa: assessed.report, appeal: assessed.appeal, subjects, warnings };
  }

  // ── the one retry ─────────────────────────────────────────────────────────
  const swaps: string[] = [];
  const retried: PreparedSubject[] = [];
  for (const subject of subjects) {
    if (!assessed.identityFailures.includes(subject.player.id)) {
      retried.push(subject);
      continue;
    }
    const next = subject.alternates?.[0];
    if (!next) {
      warnings.push(
        `${subject.player.handle} failed identity verification and there is no other photograph to try. ` +
          `Add more references: hexa assets ingest <dir> --player ${subject.player.handle}`,
      );
      retried.push(subject);
      continue;
    }
    try {
      retried.push(await reprepareWithAsset(subject, next.id, deps, { aspect: input.aspect, bust: true }));
      swaps.push(`${subject.player.handle}: ${subject.asset.id} → ${next.id}`);
    } catch (e) {
      warnings.push(`Could not retry ${subject.player.handle} with ${next.id}: ${e instanceof Error ? e.message : String(e)}`);
      retried.push(subject);
    }
  }

  if (swaps.length === 0) {
    warnings.push(`Identity gate failed for ${assessed.identityFailures.join(', ')} and no retry was possible.`);
    return { image: rendered.buffer, plan, qa: assessed.report, appeal: assessed.appeal, subjects, warnings };
  }

  log.info('identity gate failed — retrying with alternate reference photos', { swaps });
  subjects = retried;

  plan = await log.stage('compile-retry', () => compilePlan({ ...input, subjects }));
  rendered = await log.stage('render-retry', () =>
    renderVariant({ plan, subjects, backplate: input.backplate, logger: log }),
  );
  const second = await log.stage('qa-retry', () =>
    runQaStage({
      image: rendered.buffer,
      plan,
      subjects,
      library: deps.library,
      vision: deps.vision,
      request: request.qa,
      logger: log,
    }),
  );
  warnings.push(...second.warnings);

  warnings.push(
    second.identityFailures.length === 0
      ? `Identity gate initially failed; retried with a different reference photo and passed (${swaps.join('; ')}).`
      : `Identity gate still failing after retry for ${second.identityFailures.join(', ')} (tried ${swaps.join('; ')}). ` +
          `Those photographs may be mislabelled, or too extreme in angle or lighting to verify.`,
  );

  // If the retry made things worse, keep the better of the two. A swap is meant
  // to rescue a render, not to be honoured out of principle.
  if (second.report.score < assessed.report.score && second.identityFailures.length > 0) {
    warnings.push('Retry scored lower than the original; kept the original render.');
    return { image: rendered.buffer, plan, qa: assessed.report, appeal: assessed.appeal, subjects, warnings };
  }

  return { image: rendered.buffer, plan, qa: second.report, appeal: second.appeal, subjects, warnings };
}

function noVariantsError(rejected: { variantId: string; report: QaReport }[], warnings: string[]): HexaError {
  if (rejected.length > 0) {
    const findings = rejected
      .flatMap((r) => r.report.findings.filter((f) => f.severity === 'fail'))
      .map((f) => `${f.gate}: ${f.message}`);
    const unique = dedupe(findings);
    return new HexaError('QA_FAILED', `All ${rejected.length} variant(s) failed the quality gates`, {
      hint:
        unique[0] !== undefined
          ? `First failure — ${unique[0]}. Drop --strict to write the output anyway and inspect it.`
          : 'Drop --strict to write the output anyway and inspect it.',
      details: { failures: unique, variants: rejected.map((r) => r.variantId) },
    });
  }
  return new HexaError('RENDER_FAILED', 'No variants were produced', {
    hint: 'Run with --log debug to see where each variant failed.',
    details: { warnings },
  });
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((s) => s.trim() !== ''))];
}

export { isHexaError };
