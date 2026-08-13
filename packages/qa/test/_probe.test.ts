import { describe, it } from 'vitest';
import fs from 'node:fs';
import { fxDominanceGate } from '../src/gates/fxDominance.js';
import { EDGE_THRESHOLD, edgeDensity, loadGray, sobel } from '../src/image.js';

const CASES = [
  ['v01', '/home/user/Hexa/out/smoke/versus-v01.png', '/home/user/Hexa/out/smoke/versus-v01.plan.json'],
  ['v02', '/home/user/Hexa/out/smoke/versus-v02.png', '/home/user/Hexa/out/smoke/versus-v02.plan.json'],
  ['minimal', '/tmp/claude-0/-home-user-Hexa/3beac1f2-6ac9-5cfe-9d70-4a4f03c98e73/scratchpad/minimal/minimal.png', '/tmp/claude-0/-home-user-Hexa/3beac1f2-6ac9-5cfe-9d70-4a4f03c98e73/scratchpad/minimal/minimal.plan.json'],
];

describe('probe', () => {
  it('face ratio on real renders', async () => {
    for (const [name, png, planFile] of CASES) {
      const image = fs.readFileSync(png!);
      const plan = JSON.parse(fs.readFileSync(planFile!, 'utf8'));
      const subjects = (plan.meta.faceRects ?? []).map((f: any) => ({ playerId: f.playerId, handle: f.playerId, faceRect: f.rect }));
      const w = 384, h = 216;
      const gray = await loadGray(image, { width: w, height: h });
      const mag = sobel(gray);
      const overall = edgeDensity(mag, w, h, undefined, EDGE_THRESHOLD);
      let sum = 0;
      for (const s of subjects) {
        const r = { x: (s.faceRect.x / 1280) * w, y: (s.faceRect.y / 720) * h, w: (s.faceRect.w / 1280) * w, h: (s.faceRect.h / 720) * h };
        sum += edgeDensity(mag, w, h, r, EDGE_THRESHOLD);
      }
      console.log(name, 'overall', overall.toFixed(3), 'faceRatio', (sum / subjects.length / overall).toFixed(3));
      const findings = await fxDominanceGate.run({ image, plan, width: 1280, height: 720, subjects } as never);
      for (const f of findings) console.log('   ', f.severity, f.message.slice(0, 160));
    }
  });
});
