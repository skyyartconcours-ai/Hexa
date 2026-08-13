/**
 * Render profiler — where does a versus thumbnail actually spend its time?
 *
 * Renders the *real* plan the smoke test renders (versus-classic, two subjects,
 * 1280×720, two variants) and reports three views of the same run:
 *
 *   1. **Pipeline stages** — resolve / prepare / backplate / compile / render /
 *      qa / emit, captured by wrapping the injected logger's `stage()`.
 *   2. **Render stages** — `RenderResult.timings`, including per-layer cost.
 *   3. **Primitives** — every expensive call the compositor makes, with call
 *      counts and megapixels, from @hexa/render's opt-in profiler.
 *
 * The third view is the one that matters: stage timings tell you *where* to
 * look, call counts tell you *what* is wrong. A generator that shows up as
 * "1 call, 900ms" is slow; the same generator showing "1 call + 1 PNG encode +
 * 1 PNG decode of the same 3.7 megapixels" is slow *for a reason you can fix*.
 *
 * Usage:
 *   npx tsx scripts/profile.ts               # 2 variants, the standard case
 *   npx tsx scripts/profile.ts --variants 4
 *   npx tsx scripts/profile.ts --json        # machine-readable, for diffing
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, type Logger } from '@hexa/core';

const OUT = join(process.cwd(), 'out', 'profile');

const argv = process.argv.slice(2);
const flag = (name: string, def: number): number => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};
const VARIANTS = flag('variants', 2);
const JSON_OUT = argv.includes('--json');

// ── stage-timing logger ──────────────────────────────────────────────────────
interface StageRecord {
  name: string;
  ms: number;
}

/**
 * A logger that records every `stage()` it is asked to time.
 *
 * The pipeline already wraps each stage in `logger.stage(name, fn)` for its
 * debug output, so the timings are there for the taking — no instrumentation
 * needed inside @hexa/pipeline itself.
 */
function recordingLogger(sink: StageRecord[], base: Logger, prefix = ''): Logger {
  return {
    get level() {
      return base.level;
    },
    error: (m, meta) => base.error(m, meta),
    warn: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        sink.push({ name: prefix ? `${prefix}/${name}` : name, ms: performance.now() - t0 });
      }
    },
    child: (p: string) => recordingLogger(sink, base, prefix ? `${prefix}:${p}` : p),
  } as Logger;
}

// ── formatting ───────────────────────────────────────────────────────────────
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

function bar(fraction: number, width = 24): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

function table(title: string, rows: { label: string; ms: number; extra?: string }[], total: number): void {
  console.log(`\n${BOLD}${title}${RESET}`);
  const width = Math.max(...rows.map((r) => r.label.length), 10);
  for (const r of rows) {
    const pct = total > 0 ? r.ms / total : 0;
    console.log(
      `  ${r.label.padEnd(width)}  ${r.ms.toFixed(0).padStart(6)}ms ` +
        `${(pct * 100).toFixed(1).padStart(5)}%  ${DIM}${bar(pct)}${RESET}` +
        (r.extra ? `  ${DIM}${r.extra}${RESET}` : ''),
    );
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const { generateThumbnail, completeDeps } = await import('@hexa/pipeline');
  const render = await import('@hexa/render');

  const stages: StageRecord[] = [];
  const quiet = createLogger('error', 'hexa');
  const deps = await completeDeps({ logger: recordingLogger(stages, quiet) });

  // Warm sharp/libvips, librsvg's font cache and the module graph. Without this
  // the first render pays ~400ms of one-time cost and every conclusion drawn
  // from the profile is off by that much.
  render.startProfile();
  await generateThumbnail(
    {
      templateId: 'versus-classic',
      subjects: [{ player: 'Peyz', side: 'left' }, { player: 'Viper', side: 'right' }],
      text: { headline: 'RIVALS', kicker: 'LCK FINALS' },
      aspect: 'youtube',
      variants: 1,
      seed: 999,
      output: { dir: OUT, name: 'warmup' },
    },
    deps,
  );
  render.endProfile();
  stages.length = 0;

  // ── the measured run ───────────────────────────────────────────────────────
  render.startProfile();
  const t0 = performance.now();
  const result = await generateThumbnail(
    {
      templateId: 'versus-classic',
      subjects: [{ player: 'Peyz', side: 'left' }, { player: 'Viper', side: 'right' }],
      text: { headline: 'RIVALS', kicker: 'LCK FINALS' },
      aspect: 'youtube',
      variants: VARIANTS,
      seed: 1337,
      output: { dir: OUT, name: 'versus', emitPlan: true },
    },
    deps,
  );
  const wall = performance.now() - t0;
  const profile = render.endProfile();

  if (JSON_OUT) {
    console.log(JSON.stringify({ wall, totalMs: result.totalMs, stages, profile }, null, 2));
    return;
  }

  console.log(
    `\n${BOLD}Hexa render profile${RESET} ${DIM}· versus-classic · 1280×720 · ` +
      `${result.variants.length} variants · ${wall.toFixed(0)}ms wall${RESET}`,
  );

  // 1. pipeline stages, top level only (children are nested inside them)
  const topLevel = stages.filter((s) => !s.name.includes('/'));
  const byStage = new Map<string, { ms: number; n: number }>();
  for (const s of topLevel) {
    const key = s.name.replace(/^[a-z0-9]+:v\d+\//, '');
    const e = byStage.get(key) ?? { ms: 0, n: 0 };
    e.ms += s.ms;
    e.n++;
    byStage.set(key, e);
  }
  const nested = stages.filter((s) => s.name.includes('/'));
  for (const s of nested) {
    const key = s.name.slice(s.name.lastIndexOf('/') + 1);
    const e = byStage.get(key) ?? { ms: 0, n: 0 };
    e.ms += s.ms;
    e.n++;
    byStage.set(key, e);
  }
  table(
    'Pipeline stages',
    [...byStage.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([label, e]) => ({ label, ms: e.ms, extra: `×${e.n}` })),
    wall,
  );

  // 2. compositor primitives — the actionable view
  const prims = Object.entries(profile)
    .map(([label, e]) => ({ label, ms: e.ms, calls: e.calls, mpx: e.mpx }))
    .sort((a, b) => b.ms - a.ms);
  const primTotal = prims.reduce((a, b) => a + b.ms, 0);
  table(
    'Compositor primitives (wall-clock inside each; nested calls double-count)',
    prims
      .filter((p) => p.ms >= 1)
      .map((p) => ({
        label: p.label,
        ms: p.ms,
        extra: `×${p.calls}  ${p.mpx.toFixed(1)}Mpx  ${(p.ms / Math.max(1, p.calls)).toFixed(0)}ms/call`,
      })),
    primTotal,
  );

  // 3. the headline number the target is measured against
  console.log(
    `\n${BOLD}Total${RESET}  ${result.totalMs}ms for ${result.variants.length} variants ` +
      `${DIM}(${(result.totalMs / result.variants.length).toFixed(0)}ms per variant)${RESET}`,
  );
  if (result.warnings.length) console.log(`${DIM}${result.warnings.length} warnings${RESET}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
