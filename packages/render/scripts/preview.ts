/**
 * Preview harness.
 *
 *   npx tsx scripts/preview.ts            (from packages/render)
 *
 * Renders a demo plan that exercises most of the engine and writes the results
 * to `preview/`, then reads every PNG back and prints size + per-channel
 * mean/stdev/entropy so the output can be checked for being a real image rather
 * than a blank canvas.
 *
 * No photographic assets ship with the repo, so the "players" are synthesised
 * SVG busts with hard alpha edges — which is exactly what the cutout-specific
 * effects (rim light, light wrap, stroke, glow) need to be judged on.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createRng, mix, shade, type RenderPlan, type Layer } from '@hexa/core';
import {
  renderPlan,
  contactSheet,
  generators,
  BUILTIN_LUTS,
  applyLut,
  rimLight,
  lightWrap,
  outerGlow,
  dropShadow,
  strokeAlpha,
  duotone,
  motionBlur,
  bloom,
  chromaticAberration,
  filmGrain,
  vignette,
  halation,
} from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'preview');

/** A stylised player bust with a hard alpha edge. */
function subjectSvg(w: number, h: number, jersey: string, skin: string, seed: number): string {
  const rng = createRng(seed);
  const cx = w / 2;
  const headR = w * 0.17;
  const headY = h * 0.24;
  const accent = mix(jersey, '#FFFFFF', 0.35);
  const specks = Array.from({ length: 22 }, () => {
    const x = cx + rng.float(-w * 0.3, w * 0.3);
    const y = h * 0.55 + rng.float(-h * 0.2, h * 0.35);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rng.float(1, 4).toFixed(1)}" fill="${accent}" opacity="${rng.float(0.1, 0.4).toFixed(2)}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="j" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="${shade(jersey, -0.28)}"/>
      <stop offset="0.55" stop-color="${jersey}"/>
      <stop offset="1" stop-color="${shade(jersey, -0.42)}"/>
    </linearGradient>
    <linearGradient id="s" x1="0.2" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="${mix(skin, '#FFFFFF', 0.25)}"/>
      <stop offset="1" stop-color="${shade(skin, -0.3)}"/>
    </linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#20232B"/><stop offset="1" stop-color="#0A0B10"/>
    </linearGradient>
  </defs>
  <path d="M ${cx - w * 0.42} ${h}
           C ${cx - w * 0.4} ${h * 0.62}, ${cx - w * 0.24} ${h * 0.47}, ${cx - w * 0.1} ${h * 0.42}
           L ${cx + w * 0.1} ${h * 0.42}
           C ${cx + w * 0.24} ${h * 0.47}, ${cx + w * 0.4} ${h * 0.62}, ${cx + w * 0.42} ${h} Z"
        fill="url(#j)"/>
  <rect x="${cx - w * 0.075}" y="${headY + headR * 0.55}" width="${w * 0.15}" height="${h * 0.09}" fill="url(#s)"/>
  <ellipse cx="${cx}" cy="${headY}" rx="${headR}" ry="${headR * 1.22}" fill="url(#s)"/>
  <path d="M ${cx - headR * 1.04} ${headY - headR * 0.15}
           C ${cx - headR} ${headY - headR * 1.5}, ${cx + headR} ${headY - headR * 1.5}, ${cx + headR * 1.04} ${headY - headR * 0.15}
           C ${cx + headR * 0.6} ${headY - headR * 0.95}, ${cx - headR * 0.6} ${headY - headR * 0.95}, ${cx - headR * 1.04} ${headY - headR * 0.15} Z"
        fill="url(#hair)"/>
  <path d="M ${cx - w * 0.1} ${h * 0.44} L ${cx} ${h * 0.58} L ${cx + w * 0.1} ${h * 0.44} Z" fill="${shade(jersey, -0.5)}" opacity="0.85"/>
  <rect x="${cx - w * 0.3}" y="${h * 0.66}" width="${w * 0.6}" height="${h * 0.045}" rx="${h * 0.02}" fill="${accent}" opacity="0.55"/>
  ${specks}
</svg>`;
}

async function svgBuffer(markup: string): Promise<Buffer> {
  return sharp(Buffer.from(markup)).png().toBuffer();
}

function titleSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <text x="0" y="${h * 0.62}" font-family="DejaVu Sans" font-weight="bold" font-size="${h * 0.7}"
        fill="#FFFFFF" letter-spacing="${h * 0.02}">GRAND FINAL</text>
  <rect x="0" y="${h * 0.78}" width="${w * 0.42}" height="${h * 0.07}" fill="#FF3B6B"/>
</svg>`;
}

function demoPlan(width: number, height: number, seed: number): RenderPlan {
  const layers: Layer[] = [
    {
      id: 'backdrop',
      source: { type: 'generated', generatorId: 'arena', params: { color: '#1E5BFF', accent: '#FF2E63', horizon: 0.6 } },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 0,
      opacity: 1,
      blend: 'over',
      effects: { blur: 2.5, saturation: 1.05 },
      label: 'arena plate',
    },
    {
      id: 'hexgrid',
      source: { type: 'generated', generatorId: 'hexgrid', params: { color: '#63E6FF', size: width / 22 } },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 1,
      opacity: 0.35,
      blend: 'screen',
    },
    {
      id: 'rays',
      source: {
        type: 'generated',
        generatorId: 'rays',
        params: { origin: [0.18, -0.05], angle: -58, spread: 52, count: 11, color: '#FFE0A8' },
      },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 2,
      opacity: 0.8,
      blend: 'add',
    },
    {
      id: 'burst',
      source: {
        type: 'generated',
        generatorId: 'energy-burst',
        params: { origin: [0.5, 0.52], color: '#FF6A00', count: 70 },
      },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 3,
      opacity: 0.5,
      blend: 'screen',
    },
    {
      id: 'fog',
      source: { type: 'generated', generatorId: 'fog', params: { color: '#B9CBE0', density: 0.7, center: 0.74 } },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 4,
      opacity: 0.75,
      blend: 'screen',
    },
    {
      id: 'subject-left',
      source: { type: 'buffer', key: 'playerA' },
      rect: { x: Math.round(width * 0.04), y: Math.round(height * 0.16), w: Math.round(width * 0.4), h: Math.round(height * 0.84) },
      z: 5,
      opacity: 1,
      blend: 'over',
      effects: {
        // Key light comes from the upper right (the rays' side), so the rim
        // hugs the right edge of this subject and the left of the other one.
        rimLight: { angle: 18, width: 7, color: '#FFD9A0', intensity: 1.15 },
        glow: { radius: 26, color: '#1E5BFF', intensity: 0.5 },
        shadow: { dx: 10, dy: 14, blur: 22, color: '#000010', opacity: 0.6 },
        contrast: 1.06,
      },
      label: 'player A',
    },
    {
      id: 'subject-right',
      source: { type: 'buffer', key: 'playerB' },
      rect: { x: Math.round(width * 0.56), y: Math.round(height * 0.18), w: Math.round(width * 0.4), h: Math.round(height * 0.82) },
      z: 6,
      opacity: 1,
      blend: 'over',
      flipX: true,
      effects: {
        rimLight: { angle: 162, width: 7, color: '#7FD4FF', intensity: 1.1 },
        glow: { radius: 24, color: '#FF2E63', intensity: 0.45 },
        shadow: { dx: -10, dy: 14, blur: 22, color: '#100004', opacity: 0.55 },
        contrast: 1.06,
      },
      label: 'player B',
    },
    {
      id: 'embers',
      source: { type: 'generated', generatorId: 'particles', params: { bias: 0.2, density: 1.2 } },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 7,
      opacity: 0.9,
      blend: 'add',
    },
    {
      id: 'shatter',
      source: { type: 'generated', generatorId: 'shatter', params: { origin: [0.5, 0.45], spokes: 22, rings: 6 } },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 8,
      opacity: 0.28,
      blend: 'screen',
    },
    {
      id: 'title-plate',
      source: {
        type: 'gradient',
        stops: [
          { offset: 0, color: '#0A0C14EE' },
          { offset: 1, color: '#0A0C1400' },
        ],
        angle: 90,
      },
      rect: { x: 0, y: Math.round(height * 0.72), w: width, h: Math.round(height * 0.28) },
      z: 9,
      opacity: 0.9,
      blend: 'over',
    },
    {
      id: 'title',
      source: { type: 'svg', markup: titleSvg(1200, 200) },
      rect: { x: Math.round(width * 0.06), y: Math.round(height * 0.76), w: Math.round(width * 0.6), h: Math.round(height * 0.13) },
      z: 10,
      opacity: 1,
      blend: 'over',
      effects: { shadow: { dx: 3, dy: 5, blur: 10, color: '#000000', opacity: 0.8 } },
      label: 'title',
    },
    {
      id: 'scanlines',
      source: { type: 'generated', generatorId: 'scanlines', params: { spacing: 4, opacity: 0.18 } },
      rect: { x: 0, y: 0, w: width, h: height },
      z: 11,
      opacity: 0.5,
      blend: 'multiply',
    },
  ];

  return {
    canvas: { width, height, background: '#05060B', supersample: 2 },
    layers,
    grade: {
      exposure: 0.12,
      contrast: 1.1,
      saturation: 1.08,
      temperature: 12,
      tint: -4,
      lift: [0.005, 0.008, 0.02],
      gamma: [1, 1, 0.98],
      gain: [1.02, 1, 0.99],
      shadowTint: '#1E6E8C',
      highlightTint: '#FFB870',
      splitToneBalance: 0.15,
      lut: 'teal-orange',
      lutStrength: 0.55,
      bloomThreshold: 0.7,
      bloomIntensity: 0.55,
      halation: 0.35,
      chromaticAberration: 1.6,
      vignette: 0.42,
      grain: 0.16,
      letterbox: 0.045,
    },
    seed,
    meta: {
      templateId: 'demo-clash',
      subjects: ['playerA', 'playerB'],
      createdAt: '2026-01-01T00:00:00.000Z',
      identityLayers: ['subject-left', 'subject-right'],
    },
  };
}

async function report(file: string): Promise<void> {
  const buf = await fs.readFile(file);
  const meta = await sharp(buf).metadata();
  const stats = await sharp(buf).stats();
  const chans = stats.channels
    .slice(0, 3)
    .map((c) => `${c.mean.toFixed(1)}±${c.stdev.toFixed(1)}`)
    .join('  ');
  console.log(
    `${path.basename(file).padEnd(22)} ${String(meta.width).padStart(5)}×${String(meta.height).padEnd(5)} ` +
      `${(buf.length / 1024).toFixed(1).padStart(8)} KiB  RGB ${chans}  entropy ${stats.entropy.toFixed(2)}`,
  );
}

async function main(): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const W = 1280;
  const H = 720;

  const playerA = await svgBuffer(subjectSvg(720, 900, '#1E5BFF', '#C98D63', 7));
  const playerB = await svgBuffer(subjectSvg(720, 900, '#FF2E63', '#8D5A3B', 19));
  const buffers = { playerA, playerB };

  const plan = demoPlan(W, H, 20260813);
  const written: string[] = [];

  const hero = await renderPlan(plan, { buffers });
  await fs.writeFile(path.join(outDir, 'hero.png'), hero.buffer);
  written.push(path.join(outDir, 'hero.png'));
  const slowest = Object.entries(hero.timings)
    .filter(([k]) => k.startsWith('layer:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v.toFixed(0)}ms`)
    .join(' ');
  console.log(
    `hero timings: total=${hero.timings.total?.toFixed(0)}ms layers=${hero.timings.layers?.toFixed(0)}ms ` +
      `downsample=${hero.timings.downsample?.toFixed(0)}ms grade=${hero.timings.grade?.toFixed(0)}ms ` +
      `export=${hero.timings.export?.toFixed(0)}ms | slowest ${slowest}`,
  );

  const debug = await renderPlan(plan, { buffers, debugOverlay: true });
  await fs.writeFile(path.join(outDir, 'hero-debug.png'), debug.buffer);
  written.push(path.join(outDir, 'hero-debug.png'));

  const jpeg = await renderPlan(plan, { buffers, format: 'jpeg', quality: 88 });
  await fs.writeFile(path.join(outDir, 'hero.jpg'), jpeg.buffer);

  // Same plan, different seed — proves variants diverge.
  const variant = await renderPlan(demoPlan(W, H, 99), { buffers });
  await fs.writeFile(path.join(outDir, 'hero-seed99.png'), variant.buffer);
  written.push(path.join(outDir, 'hero-seed99.png'));

  // Contact sheet of every generator.
  const genTiles = await Promise.all(
    Object.keys(generators)
      .sort()
      .map(async (id) => ({
        buffer: await generators[id]!({}, { width: 480, height: 270 }, 4242),
        label: id,
      })),
  );
  const genSheet = await contactSheet(genTiles, { cols: 5, width: 1800, background: '#0B0B0F' });
  await fs.writeFile(path.join(outDir, 'generators.png'), genSheet);
  written.push(path.join(outDir, 'generators.png'));

  // Contact sheet of the effect primitives on one subject over one backdrop.
  const plate = await sharp(
    await generators.arena!({ color: '#123A7A', accent: '#FF7A00' }, { width: 480, height: 600 }, 5),
  )
    .png()
    .toBuffer();
  const subj = await sharp(await svgBuffer(subjectSvg(480, 600, '#2266FF', '#C98D63', 3)))
    .png()
    .toBuffer();
  const onPlate = async (fx: Buffer): Promise<Buffer> =>
    sharp(plate)
      .composite([{ input: fx, left: 0, top: 0 }])
      .png()
      .toBuffer();

  const fxTiles: { buffer: Buffer; label: string }[] = [
    { buffer: await onPlate(subj), label: 'subject (no treatment)' },
    { buffer: await onPlate(await rimLight(subj, { angle: 0, width: 9, color: '#FFD9A0', intensity: 1.3 })), label: 'rimLight 0° (right)' },
    { buffer: await onPlate(await rimLight(subj, { angle: 90, width: 9, color: '#8CF5FF', intensity: 1.3 })), label: 'rimLight 90° (top)' },
    { buffer: await onPlate(await rimLight(subj, { angle: 180, width: 9, color: '#FF7ACF', intensity: 1.3 })), label: 'rimLight 180° (left)' },
    { buffer: await onPlate(await lightWrap(subj, plate, { radius: 26, intensity: 1.6 })), label: 'lightWrap (backdrop spill)' },
    { buffer: await onPlate(await outerGlow(subj, { radius: 30, color: '#2E9BFF', intensity: 0.9 })), label: 'outerGlow' },
    { buffer: await onPlate(await dropShadow(subj, { dx: 16, dy: 20, blur: 24, color: '#000000', opacity: 0.75 })), label: 'dropShadow' },
    { buffer: await onPlate(await strokeAlpha(subj, { width: 5, color: '#FFFFFF' })), label: 'strokeAlpha' },
    { buffer: await onPlate(await duotone(subj, '#0B1E3A', '#FFB86B', 0.9)), label: 'duotone' },
    { buffer: await onPlate(await motionBlur(subj, 12, 26)), label: 'motionBlur 12°' },
    { buffer: await bloom(await onPlate(subj), 0.6, 1.1), label: 'bloom' },
    { buffer: await halation(await onPlate(subj), 0.9), label: 'halation' },
    { buffer: await chromaticAberration(await onPlate(subj), 6), label: 'chromaticAberration 6px' },
    { buffer: await vignette(await onPlate(subj), 0.7, 0.35), label: 'vignette' },
    { buffer: await filmGrain(await onPlate(subj), 0.5, 11), label: 'filmGrain' },
  ];
  const fxSheet = await contactSheet(fxTiles, { cols: 5, width: 1800, background: '#0B0B0F' });
  await fs.writeFile(path.join(outDir, 'effects.png'), fxSheet);
  written.push(path.join(outDir, 'effects.png'));

  // Contact sheet of the built-in LUTs applied to the ungraded hero.
  const flat = await renderPlan({ ...plan, grade: {} }, { buffers });
  const lutTiles = [{ buffer: flat.buffer, label: 'no LUT (ungraded)' }];
  for (const [name, lut] of Object.entries(BUILTIN_LUTS)) {
    lutTiles.push({ buffer: await applyLut(flat.buffer, lut, 1), label: name });
  }
  const lutSheet = await contactSheet(lutTiles, { cols: 4, width: 1800, background: '#0B0B0F' });
  await fs.writeFile(path.join(outDir, 'luts.png'), lutSheet);
  written.push(path.join(outDir, 'luts.png'));

  console.log('\nwritten to', outDir);
  for (const file of [...written, path.join(outDir, 'hero.jpg')]) await report(file);
}

await main();
