/**
 * Art-direction harness.
 *
 * Renders a spread of templates across every major category into `out/gallery/`
 * and assembles a contact sheet, so a change to a template or to the compiler
 * can be judged the only way design can be judged: by looking at it.
 *
 * Run:  npx tsx scripts/gallery.ts            # the standard spread
 *       npx tsx scripts/gallery.ts versus     # only ids matching a substring
 *
 * Also writes `out/gallery/proof-<id>.png` for the first few entries — the same
 * render simulated at the sizes YouTube actually displays. A thumbnail that
 * cannot be read at 168×94 has failed regardless of how it looks at 1280.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(process.cwd(), 'out', 'gallery');

interface Entry {
  templateId: string;
  players: string[];
  text: Record<string, string>;
  aspect?: 'youtube' | 'shorts';
}

/** The spread: at least one from every family that carries the product. */
const SPREAD: Entry[] = [
  { templateId: 'versus-classic', players: ['Peyz', 'Viper'], text: { headline: 'RIVALS', kicker: 'LCK FINALS' } },
  { templateId: 'versus-diagonal-shatter', players: ['Faker', 'Chovy'], text: { kicker: 'ELIMINATION' } },
  { templateId: 'versus-clash', players: ['Zeus', 'Kiin'], text: { kicker: 'GAME 5' } },
  { templateId: 'versus-split-portrait', players: ['Keria', 'Lehends'], text: { kicker: 'THE SUPPORT DEBATE' } },
  { templateId: 'versus-minimal', players: ['Oner', 'Canyon'], text: { kicker: 'HEAD TO HEAD' } },
  { templateId: 'versus-fire-ice', players: ['Deft', 'Ruler'], text: { kicker: 'STYLE CLASH' } },
  { templateId: 'hero-portrait', players: ['Faker'], text: { headline: 'UNBEATEN', kicker: 'WORLDS 2025' } },
  { templateId: 'hero-godray', players: ['Chovy'], text: { headline: 'ASCENDED', kicker: 'MID KING' } },
  { templateId: 'lineup-5v5', players: ['Zeus', 'Oner', 'Faker', 'Gumayusi', 'Keria', 'Kiin', 'Peanut', 'Zeka', 'Viper', 'Delight'], text: { headline: 'T1 VS HLE', kicker: 'LCK FINAL' } },
  { templateId: 'crest-clash', players: ['Faker', 'Zeka'], text: { headline: 'T1 VS HLE', kicker: 'SUNDAY' } },
  { templateId: 'drama-reaction', players: ['Peyz'], text: { headline: 'WHAT JUST HAPPENED', kicker: 'REACTION' } },
  { templateId: 'controversy-split', players: ['Faker', 'Chovy'], text: { headline: 'THE CALL', kicker: 'DEBATE' } },
  { templateId: 'stat-record', players: ['Ruler'], text: { headline: 'ALL TIME', stat: '3000', caption: 'CAREER KILLS' } },
  { templateId: 'stat-compare', players: ['Peyz', 'Viper'], text: { headline: 'BY THE NUMBERS', kicker: 'ADC' } },
  { templateId: 'ranking-podium', players: ['Faker', 'Chovy', 'Zeka'], text: { headline: 'TOP 3 MIDS', kicker: 'RANKED' } },
  { templateId: 'mvp-card', players: ['Gumayusi'], text: { headline: 'MVP', kicker: 'FINALS' } },
  { templateId: 'shorts-versus', players: ['Peyz', 'Viper'], text: { headline: 'WHO WINS', kicker: 'LCK' }, aspect: 'shorts' },
  { templateId: 'shorts-hero', players: ['Faker'], text: { headline: 'THE GOAT', kicker: 'T1' }, aspect: 'shorts' },
];

const DIM = '[2m';
const RED = '[31m';
const GREEN = '[32m';
const RESET = '[0m';

interface Rendered {
  id: string;
  path: string;
  qa: number;
  appeal: number;
  passed: boolean;
  findings: string[];
  width: number;
  height: number;
}

async function renderOne(entry: Entry, index: number): Promise<Rendered | undefined> {
  const { generateThumbnail } = await import('@hexa/pipeline');
  const name = entry.templateId;
  try {
    const result = await generateThumbnail({
      templateId: entry.templateId,
      subjects: entry.players.map((p, i) => ({
        player: p,
        side: entry.players.length === 2 ? (i === 0 ? 'left' : 'right') : undefined,
      })) as never,
      text: entry.text as never,
      aspect: entry.aspect ?? 'youtube',
      variants: 1,
      seed: 1337 + index,
      output: { dir: OUT, name, emitPlan: index === 0, contactSheet: false },
    });
    const best = result.variants[result.bestIndex]!;
    const meta = await sharp(best.path).metadata();
    const failed = (best.qa.findings ?? [])
      .filter((f) => f.severity === 'fail' || f.severity === 'warn')
      .map((f) => `${f.gate}: ${f.message}`);
    return {
      id: name,
      path: best.path,
      qa: best.qa.score,
      appeal: best.appeal,
      passed: best.qa.passed,
      findings: failed,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  } catch (err) {
    console.log(`${RED}✗${RESET} ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** Assemble the renders into one sheet, each cell captioned with its score. */
async function contactSheet(items: Rendered[], cols: number, cellW: number): Promise<Buffer> {
  const cellH = Math.round((cellW * 9) / 16);
  const captionH = 26;
  const pad = 10;
  const rows = Math.ceil(items.length / cols);
  const width = cols * cellW + pad * (cols + 1);
  const height = rows * (cellH + captionH) + pad * (rows + 1);

  const composites: sharp.OverlayOptions[] = [];
  for (const [i, item] of items.entries()) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cellW + pad);
    const y = pad + row * (cellH + captionH + pad);
    // `contain` so a 9:16 Short is letterboxed into the cell rather than
    // stretched — a distorted cell would misrepresent the design.
    const cell = await sharp(item.path)
      .resize(cellW, cellH, { fit: 'contain', background: { r: 8, g: 8, b: 10, alpha: 1 } })
      .toBuffer();
    composites.push({ input: cell, left: x, top: y });

    const tone = item.qa >= 70 ? '#6EE7A0' : item.qa >= 55 ? '#FFD166' : '#FF6B6B';
    const caption = `<svg width="${cellW}" height="${captionH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${cellW}" height="${captionH}" fill="#141418"/>
      <text x="6" y="18" font-family="monospace" font-size="13" fill="#E8E8EC">${item.id}</text>
      <text x="${cellW - 6}" y="18" text-anchor="end" font-family="monospace" font-size="13" fill="${tone}">qa ${item.qa.toFixed(0)} · ap ${item.appeal.toFixed(0)}</text>
    </svg>`;
    composites.push({ input: Buffer.from(caption), left: x, top: y + cellH });
  }

  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 20, b: 24 } } })
    .composite(composites)
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  const spread = filter ? SPREAD.filter((e) => e.templateId.includes(filter)) : SPREAD;
  if (!spread.length) {
    console.error(`No template ids match "${filter}"`);
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  console.log(`\nHexa gallery — ${spread.length} renders ${DIM}→ ${OUT}${RESET}\n`);

  const rendered: Rendered[] = [];
  for (const [i, entry] of spread.entries()) {
    const t0 = performance.now();
    const out = await renderOne(entry, i);
    if (!out) continue;
    rendered.push(out);
    const tone = out.qa >= 70 ? GREEN : out.qa >= 55 ? '' : RED;
    console.log(
      `${out.passed ? GREEN + '✓' : RED + '✗'}${RESET} ${out.id.padEnd(26)} ${tone}qa ${out.qa.toFixed(0).padStart(3)}${RESET}  appeal ${out.appeal.toFixed(0).padStart(3)}  ${DIM}${((performance.now() - t0) / 1000).toFixed(1)}s${RESET}`,
    );
    for (const f of out.findings.slice(0, 4)) console.log(`    ${DIM}${f}${RESET}`);
  }

  if (!rendered.length) {
    console.error('Nothing rendered.');
    process.exit(1);
  }

  const sheet = await contactSheet(rendered, 3, 420);
  await writeFile(join(OUT, 'contact-sheet.png'), sheet);

  // Proof sheets at real display sizes for the flagship renders.
  const { proofSheet } = await import('@hexa/qa');
  for (const item of rendered.slice(0, 3)) {
    const src = await sharp(item.path).toBuffer();
    await writeFile(join(OUT, `proof-${item.id}.png`), await proofSheet(src));
  }

  const mean = rendered.reduce((a, b) => a + b.qa, 0) / rendered.length;
  const meanAppeal = rendered.reduce((a, b) => a + b.appeal, 0) / rendered.length;
  console.log(
    `\n${rendered.length} renders · mean qa ${mean.toFixed(1)} · mean appeal ${meanAppeal.toFixed(1)} · ${rendered.filter((r) => r.passed).length} passing`,
  );
  console.log(`${DIM}contact sheet → ${join(OUT, 'contact-sheet.png')}${RESET}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
