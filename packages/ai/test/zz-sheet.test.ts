import { it } from 'vitest';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { LocalProvider } from '../src/providers/local.js';
import { buildBackplatePrompt } from '../src/prompt.js';
import { BACKPLATE_STYLES } from '../src/types.js';

const OUT = '/tmp/claude-0/-home-user-Hexa/3beac1f2-6ac9-5cfe-9d70-4a4f03c98e73/scratchpad';
const P = new LocalProvider();
const PAL = ['#E2012D', '#1B3FA0', '#FFC629'];
const W = 426, H = 240;

it('contact sheet', async () => {
  const tiles: Buffer[] = [];
  for (const style of BACKPLATE_STYLES) {
    const { prompt } = buildBackplatePrompt({ style, palette: PAL, subjectCount: 2 });
    const out = await P.generateBackplate({ prompt, style, width: W, height: H, seed: 2024, palette: PAL });
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="24"><rect width="${W}" height="24" fill="#000000cc"/><text x="8" y="17" font-family="monospace" font-size="14" fill="#ffffff">${style}</text></svg>`;
    tiles.push(await sharp(out.buffer).composite([{ input: Buffer.from(label), top: H - 24, left: 0 }]).png().toBuffer());
  }
  const cols = 3, rows = Math.ceil(tiles.length / cols);
  const sheet = await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * W, top: Math.floor(i / cols) * H })))
    .png().toBuffer();
  await writeFile(`${OUT}/sheet.png`, sheet);

  // one big single plate to judge detail
  const { prompt } = buildBackplatePrompt({ style: 'arena', palette: PAL, subjectCount: 2, lightDirection: 'left' });
  const big = await P.generateBackplate({ prompt, style: 'arena', width: 1280, height: 720, seed: 88, palette: PAL });
  await writeFile(`${OUT}/arena.png`, big.buffer);
  const neon = await P.generateBackplate({ prompt: buildBackplatePrompt({ style: 'neon-city', palette: ['#00E5FF','#FF2E88'] }).prompt, style: 'neon-city', width: 1280, height: 720, seed: 5, palette: ['#00E5FF','#FF2E88'] });
  await writeFile(`${OUT}/neon.png`, neon.buffer);
}, 180000);
