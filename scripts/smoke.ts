/**
 * End-to-end smoke test.
 *
 * Exercises the whole pipeline the way a first-time user would: no API keys, no
 * Python sidecar, no reference photographs. Everything must still produce a real
 * image. Run with:  npx tsx scripts/smoke.ts
 *
 * This is deliberately not a vitest suite — it is the "does the product work"
 * check, and it writes inspectable PNGs to ./out/smoke so failures are visible
 * rather than merely asserted.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(process.cwd(), 'out', 'smoke');

interface Check {
  name: string;
  run: () => Promise<string>;
}

const checks: Check[] = [];

function check(name: string, run: () => Promise<string>): void {
  checks.push({ name, run });
}

/** Assert a buffer is a real, non-blank image and report its statistics. */
async function describeImage(buf: Buffer, label: string): Promise<string> {
  const img = sharp(buf);
  const meta = await img.metadata();
  const stats = await img.stats();
  const meanSpread = Math.max(...stats.channels.map((c) => c.stdev));
  if (!meta.width || !meta.height) throw new Error(`${label}: no dimensions`);
  if (meanSpread < 1) throw new Error(`${label}: image is flat (stdev ${meanSpread.toFixed(2)}) — probably blank`);
  return `${meta.width}×${meta.height} ${meta.format} · ${(buf.length / 1024).toFixed(0)}KB · stdev ${meanSpread.toFixed(1)}`;
}

// ── Roster ───────────────────────────────────────────────────────────────────
check('roster resolves players and teams', async () => {
  const { PLAYERS, TEAMS, findPlayer, rosterOf, searchPlayers } = await import('@hexa/data');
  const peyz = findPlayer('Peyz');
  const viper = findPlayer('viper');
  if (!peyz) throw new Error('Peyz did not resolve');
  if (!viper) throw new Error('Viper did not resolve');
  const t1 = rosterOf('t1');
  if (t1.length !== 5) throw new Error(`T1 starting roster is ${t1.length}, expected 5`);
  const fuzzy = searchPlayers('fakr', 3);
  return `${PLAYERS.length} players · ${TEAMS.length} teams · Peyz→${peyz.teamId} · Viper→${viper.teamId} · fuzzy "fakr"→${fuzzy[0]?.handle ?? 'none'}`;
});

// ── Templates ────────────────────────────────────────────────────────────────
check('every template validates', async () => {
  const { TEMPLATES, validateTemplate } = await import('@hexa/templates');
  const bad = TEMPLATES.flatMap((t) => validateTemplate(t).map((p) => `${t.id}: ${p}`));
  if (bad.length) throw new Error(`${bad.length} problems\n  ${bad.slice(0, 8).join('\n  ')}`);
  const cats = new Set(TEMPLATES.map((t) => t.category));
  return `${TEMPLATES.length} templates across ${cats.size} categories, all valid`;
});

// ── Render primitives ────────────────────────────────────────────────────────
check('procedural generators produce real images', async () => {
  const { generators } = await import('@hexa/render');
  const size = { width: 640, height: 360 };
  const results: string[] = [];
  for (const [id, gen] of Object.entries(generators)) {
    const buf = await gen({}, size, 42);
    const img = sharp(buf);
    const meta = await img.metadata();
    if (meta.width !== size.width || meta.height !== size.height) {
      throw new Error(`generator "${id}" returned ${meta.width}×${meta.height}`);
    }
    results.push(id);
  }
  return `${results.length} generators OK: ${results.join(', ')}`;
});

check('render is deterministic by seed', async () => {
  const { generators } = await import('@hexa/render');
  const gen = generators['particles'];
  if (!gen) throw new Error('no "particles" generator');
  const size = { width: 320, height: 180 };
  const [a, b, c] = await Promise.all([gen({}, size, 7), gen({}, size, 7), gen({}, size, 8)]);
  if (!a!.equals(b!)) throw new Error('same seed produced different bytes');
  if (a!.equals(c!)) throw new Error('different seeds produced identical bytes');
  return 'same seed ⇒ identical bytes; different seed ⇒ different bytes';
});

// ── Typography ───────────────────────────────────────────────────────────────
check('typography rasterises to valid non-blank SVG', async () => {
  const { autoFit, preset, versusMark } = await import('@hexa/type');
  const laid = autoFit({
    block: { text: 'RIVALS RENEWED', style: preset('headline-heavy') },
    box: { x: 0, y: 0, w: 900, h: 200 },
    anchor: 'center',
    wrap: true,
  });
  const png = await sharp(Buffer.from(laid.markup)).png().toBuffer();
  const desc = await describeImage(png, 'headline');
  const mark = versusMark({ size: 220, style: 'slash', leftColor: '#E4002B', rightColor: '#FF6B00', glow: true });
  await sharp(Buffer.from(mark.markup)).png().toBuffer();
  return `headline ${laid.fontSize}px in ${laid.lines.length} line(s) · ${desc} · versus mark OK`;
});

// ── AI boundary ──────────────────────────────────────────────────────────────
check('AI package refuses to generate people', async () => {
  const { assertNoPersonGeneration } = await import('@hexa/ai');
  const mustPass = ['empty esports arena, volumetric haze, no people'];
  const mustFail = [
    'portrait of a korean esports player',
    'a man who looks like Faker',
    'photorealistic face of a young gamer',
    'crowd of people cheering, faces visible',
  ];
  for (const p of mustPass) assertNoPersonGeneration(p);
  for (const p of mustFail) {
    let threw = false;
    try { assertNoPersonGeneration(p); } catch { threw = true; }
    if (!threw) throw new Error(`guard let through: "${p}"`);
  }
  return `${mustFail.length} person-prompts blocked, ${mustPass.length} scene-prompts allowed`;
});

check('offline backplate provider works with zero configuration', async () => {
  const { generateBackplate } = await import('@hexa/ai');
  const img = await generateBackplate({
    prompt: 'empty stadium at dusk, volumetric light, deep negative space',
    width: 1280, height: 720, seed: 3, provider: 'local',
    palette: ['#E4002B', '#FF6B00'],
  });
  await writeFile(join(OUT, 'backplate-local.png'), img.buffer);
  return `${img.provider}/${img.model} · ${await describeImage(img.buffer, 'backplate')}`;
});

// ── Vision degradation ───────────────────────────────────────────────────────
check('vision degrades gracefully with no sidecar', async () => {
  const { VisionClient } = await import('@hexa/vision');
  const v = new VisionClient({ endpoint: 'http://127.0.0.1:59999', timeoutMs: 800 });
  const t0 = performance.now();
  const up = await v.available();
  const ms = performance.now() - t0;
  if (up) throw new Error('expected no sidecar on port 59999');
  if (ms > 3000) throw new Error(`availability probe took ${ms.toFixed(0)}ms — too slow to block a render`);
  return `probe returned false in ${ms.toFixed(0)}ms without throwing`;
});

// ── Full pipeline ────────────────────────────────────────────────────────────
check('full pipeline renders a versus thumbnail end to end', async () => {
  const { generateThumbnail } = await import('@hexa/pipeline');
  const result = await generateThumbnail({
    templateId: 'versus-classic',
    subjects: [{ player: 'Peyz', side: 'left' }, { player: 'Viper', side: 'right' }],
    text: { headline: 'RIVALS', kicker: 'LCK FINALS' },
    aspect: 'youtube',
    variants: 2,
    seed: 1337,
    output: { dir: OUT, name: 'versus', emitPlan: true, contactSheet: true },
  });
  if (!result.variants.length) throw new Error('no variants produced');
  for (const v of result.variants) {
    const buf = await sharp(v.path).toBuffer();
    await describeImage(buf, v.id);
  }
  const best = result.variants[result.bestIndex]!;
  return `${result.variants.length} variants in ${result.totalMs}ms · best=${best.id} qa=${best.qa.score.toFixed(0)} appeal=${best.appeal.toFixed(0)} · ${result.warnings.length} warnings`;
});

check('QA proof sheet renders at real display sizes', async () => {
  const { proofSheet, simulateSizes } = await import('@hexa/qa');
  const src = await sharp(join(OUT, 'backplate-local.png')).toBuffer();
  const sizes = await simulateSizes(src);
  const sheet = await proofSheet(src);
  await writeFile(join(OUT, 'proof-sheet.png'), sheet);
  return `${sizes.length} display sizes simulated · ${await describeImage(sheet, 'proof sheet')}`;
});

// ── Runner ───────────────────────────────────────────────────────────────────
const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  console.log(`\nHexa smoke test ${DIM}→ ${OUT}${RESET}\n`);

  let passed = 0;
  const failures: { name: string; error: unknown }[] = [];

  for (const { name, run } of checks) {
    const t0 = performance.now();
    try {
      const detail = await run();
      const ms = (performance.now() - t0).toFixed(0);
      console.log(`${GREEN}✓${RESET} ${name} ${DIM}(${ms}ms)${RESET}\n  ${DIM}${detail}${RESET}`);
      passed++;
    } catch (err) {
      console.log(`${RED}✗${RESET} ${name}\n  ${RED}${err instanceof Error ? err.message : String(err)}${RESET}`);
      failures.push({ name, error: err });
    }
  }

  console.log(`\n${passed}/${checks.length} checks passed`);
  if (failures.length) {
    console.log(`\n${RED}Failed:${RESET} ${failures.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
