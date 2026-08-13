/** One-off memory/throughput check: 1920×1080, 40 layers. */
import type { RenderPlan, Layer } from '@hexa/core';
import { createLogger } from '@hexa/core';
import { renderPlan } from '../src/index.js';

const W = 1920, H = 1080;
const kinds = ['particles', 'rays', 'fog', 'hexgrid', 'bokeh', 'shatter', 'smoke', 'grid'];
const layers: Layer[] = Array.from({ length: 40 }, (_, i): Layer => ({
  id: `l${i}`,
  source: i % 4 === 0
    ? { type: 'generated', generatorId: kinds[i % kinds.length]!, params: {} }
    : i % 4 === 1
      ? { type: 'gradient', stops: [{ offset: 0, color: '#102040' }, { offset: 1, color: '#00000000' }], angle: i * 9 }
      : i % 4 === 2
        ? { type: 'noise', seed: i, scale: 5, octaves: 4 }
        : { type: 'solid', color: '#204080' },
  rect: { x: (i * 37) % 600, y: (i * 53) % 400, w: 1200, h: 640 },
  z: i,
  opacity: 0.35,
  blend: (['over', 'screen', 'add', 'multiply', 'overlay'] as const)[i % 5]!,
  effects: i % 7 === 0 ? { rimLight: { angle: 25, width: 6, color: '#FFD9A0', intensity: 1 }, glow: { radius: 14, color: '#2E7BFF', intensity: 0.4 } } : undefined,
}));

const plan: RenderPlan = {
  canvas: { width: W, height: H, background: '#05060B', supersample: 1 },
  layers,
  grade: { exposure: 0.1, contrast: 1.08, saturation: 1.05, lut: 'teal-orange', lutStrength: 0.5, bloomThreshold: 0.7, bloomIntensity: 0.4, halation: 0.3, chromaticAberration: 1.4, vignette: 0.35, grain: 0.12, letterbox: 0.04 },
  seed: 11,
  meta: { templateId: 'bench', subjects: [], createdAt: '2026-01-01T00:00:00.000Z' },
};

let peak = 0;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
const t = Date.now();
const out = await renderPlan(plan, { logger: createLogger('silent') });
clearInterval(timer);
peak = Math.max(peak, process.memoryUsage().rss);
console.log(`40 layers @ ${W}×${H}: ${Date.now() - t}ms, ${(out.buffer.length / 1024 / 1024).toFixed(2)} MiB png, peak RSS ${(peak / 1024 / 1024).toFixed(0)} MiB`);
console.log(`stages: layers=${out.timings.layers?.toFixed(0)}ms grade=${out.timings.grade?.toFixed(0)}ms export=${out.timings.export?.toFixed(0)}ms`);
