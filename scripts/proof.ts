/**
 * Small-size proof — the test most thumbnails fail.
 *
 * A thumbnail is almost never seen at 1280×720. It is seen in a 168×94 sidebar
 * strip. This runs @hexa/qa's own `proofSheet` and `simulateSizes` over a set of
 * renders and reports, per size, whether the image still carries readable
 * structure.
 *
 *   npx tsx scripts/proof.ts out/showcase/hero/hero-portrait-faker.png ...
 *
 * With no arguments it proofs the best and worst five renders recorded in
 * out/showcase/index.json.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';

const OUT = join(process.cwd(), 'out', 'showcase', 'proof');

interface Record_ {
  id: string;
  templateId: string;
  bestPath?: string;
  qaScore?: number;
  appeal?: number;
  ok: boolean;
}

async function pickFromIndex(): Promise<{ label: string; path: string }[]> {
  const raw = await readFile(join(process.cwd(), 'out', 'showcase', 'index.json'), 'utf8');
  const records = (JSON.parse(raw).records as Record_[]).filter((r) => r.ok && r.bestPath);
  const sorted = [...records].sort((a, b) => (b.qaScore ?? 0) - (a.qaScore ?? 0));
  const best = sorted.slice(0, 5).map((r) => ({ label: `BEST ${r.templateId} (qa ${r.qaScore})`, path: r.bestPath! }));
  const worst = sorted.slice(-5).map((r) => ({ label: `WORST ${r.templateId} (qa ${r.qaScore})`, path: r.bestPath! }));
  return [...best, ...worst];
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const { proofSheet, simulateSizes } = await import('@hexa/qa');

  const args = process.argv.slice(2);
  const targets = args.length ? args.map((p) => ({ label: basename(p), path: p })) : await pickFromIndex();

  console.log(`\nSmall-size proof — ${targets.length} render(s) → ${OUT}\n`);

  for (const { label, path } of targets) {
    const src = await sharp(path).png().toBuffer();
    const sizes = await simulateSizes(src);
    const sheet = await proofSheet(src);
    const dest = join(OUT, `${basename(path, '.png')}.proof.png`);
    await writeFile(dest, sheet);

    console.log(label);
    for (const s of sizes) {
      console.log(
        `  ${s.label.padEnd(8)} ${String(s.width).padStart(4)}×${String(s.height).padEnd(4)} ` +
          `${s.legible ? 'legible' : 'ILLEGIBLE'}  edge ${(s.edgeDensity * 100).toFixed(0)}%  — ${s.notes.join('; ')}`,
      );
    }
    console.log(`  → ${dest}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
