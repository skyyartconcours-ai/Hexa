import { it } from 'vitest';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { beamsSvg, rasterise, glowSvg, type Size } from '../src/paint.js';
import { createRng, mix, shade, saturate, ensureDistinct, complement } from '@hexa/core';

const OUT = '/tmp/claude-0/-home-user-Hexa/3beac1f2-6ac9-5cfe-9d70-4a4f03c98e73/scratchpad';
it('isolate arena layers', async () => {
  const size: Size = { width: 1280, height: 720 };
  const rng = createRng(88).fork(7);
  const pal = { primary:'#E2012D', secondary: ensureDistinct('#E2012D', '#1B3FA0', 0.16), accent:'#FFC629',
    deep: mix('#090B12','#E2012D',0.12), haze: mix('#93A6C6','#1B3FA0',0.3), light: mix('#FFFFFF','#FFC629',0.08) };
  const deck = 0.66, rig = 0.13;
  const led = `<rect x="${(0.16*1280).toFixed(1)}" y="${((deck-0.36)*720).toFixed(1)}" width="${(0.68*1280).toFixed(1)}" height="${(0.32*720).toFixed(1)}" fill="rgba(226,1,45,0.85)"/>`;
  await writeFile(`${OUT}/dbg-led.png`, await rasterise(led, size));
  await writeFile(`${OUT}/dbg-beams.png`, await rasterise(beamsSvg(size, rng.fork(2), { count:10, originY: rig+0.04, colours:[pal.accent,pal.light,pal.primary,pal.secondary], alpha:1, spread:0.22 }), size));
  await writeFile(`${OUT}/dbg-refl.png`, await rasterise(beamsSvg(size, rng.fork(3), { count:8, originY:1.04, colours:[pal.accent,pal.primary,pal.light], alpha:0.4, spread:0.05 }), size));
}, 60000);
