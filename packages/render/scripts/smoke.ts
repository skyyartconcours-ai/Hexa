import sharp from 'sharp';
import { generators } from '../src/index.js';

const size = { width: 320, height: 180 };
for (const [id, gen] of Object.entries(generators)) {
  const t = Date.now();
  try {
    const buf = await gen({}, size, 12345);
    const meta = await sharp(buf).metadata();
    const st = await sharp(buf).stats();
    const mean = st.channels.map((c) => c.mean.toFixed(1)).join(',');
    const std = st.channels.map((c) => c.stdev.toFixed(1)).join(',');
    console.log(`${id.padEnd(13)} ${meta.width}x${meta.height} ch=${meta.channels} alpha=${meta.hasAlpha} ${String(buf.length).padStart(7)}B  mean[${mean}] std[${std}] ${Date.now() - t}ms`);
  } catch (e) {
    console.log(`${id.padEnd(13)} FAILED: ${(e as Error).message}`);
  }
}
