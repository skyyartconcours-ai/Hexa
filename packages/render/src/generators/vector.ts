/**
 * Vector-authored FX generators.
 *
 * Each one is a pure function of `(params, size, seed)` — no clocks, no
 * `Math.random`, no ambient state — so a plan replays byte-for-byte.
 */

import { createRng, mix, shade, saturate, clamp, degToRad } from '@hexa/core';
import type { Generator } from '../types.js';
import { createNoise } from '../noise.js';
import { rawToSharp } from '../raw.js';
import {
  f,
  num,
  str,
  colors,
  vec2,
  rgba,
  svgDoc,
  renderSvg,
  toRgbaPng,
  addLayers,
  softenLayer,
} from './util.js';

/**
 * particles — depth-layered embers and dust.
 *
 * Three bands stand in for three focal planes. Far dust is small, dim and very
 * slightly hazed by atmosphere; the mid band is the sharpest because it sits at
 * the focal plane; near embers are large, bright and *defocused*, which is the
 * cue that actually sells depth. Each band is blurred independently and the
 * bands are combined additively, because glowing motes add light.
 */
export const particles: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const palette = colors(params, 'colors', ['#FFD9A0', '#FF8A3D', '#FFF3E0']);
  const density = num(params, 'density', 1);
  const bias = num(params, 'bias', str(params, 'side', 'right') === 'left' ? -0.7 : 0.7);
  const scale = Math.sqrt((w * h) / (1280 * 720));
  // Counts thin out on a small canvas, but radii must not collapse below a
  // pixel or the whole field disappears into the downsample.
  const rScale = Math.max(0.75, scale);
  const nScale = Math.max(0.35, scale);

  const bands = [
    { count: 240, rMin: 0.5, rMax: 1.7, alpha: 0.34, sigma: 1.3 * rScale, drift: 0.0 },
    { count: 96, rMin: 1.5, rMax: 3.8, alpha: 0.62, sigma: 0.5 * rScale, drift: 0.35 },
    { count: 26, rMin: 3.4, rMax: 9.5, alpha: 0.85, sigma: 3.2 * rScale, drift: 0.9 },
  ];

  const layers = [];
  for (let bi = 0; bi < bands.length; bi++) {
    const band = bands[bi]!;
    const rng = createRng(seed).fork(bi * 17 + 3);
    const defs = palette
      .map(
        (c, i) =>
          `<radialGradient id="p${bi}_${i}">` +
          `<stop offset="0" stop-color="${rgba(c, 1)}"/>` +
          `<stop offset="0.42" stop-color="${rgba(c, 0.55)}"/>` +
          `<stop offset="1" stop-color="${rgba(c, 0)}"/></radialGradient>`,
      )
      .join('');

    const parts: string[] = [];
    const count = Math.round(band.count * density * scale);
    for (let i = 0; i < count; i++) {
      // Bias: raising a uniform to a power skews the population toward one
      // edge without ever producing a hard boundary.
      const u = rng.next();
      const skew = bias >= 0 ? 1 - u ** (1 + Math.abs(bias) * 2.2) : u ** (1 + Math.abs(bias) * 2.2);
      const x = skew * w;
      const y = rng.next() * h;
      const r = rng.float(band.rMin, band.rMax) * scale;
      const a = band.alpha * rng.float(0.45, 1);
      const gi = rng.int(0, palette.length - 1);
      // A few motes are stretched along their drift direction — embers rise.
      if (band.drift > 0 && rng.bool(0.25)) {
        const stretch = rng.float(1.6, 3.4);
        const rot = rng.float(-25, 25);
        parts.push(
          `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * stretch)}" fill="url(#p${bi}_${gi})" ` +
            `opacity="${a.toFixed(3)}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})"/>`,
        );
      } else {
        parts.push(
          `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#p${bi}_${gi})" opacity="${a.toFixed(3)}"/>`,
        );
      }
    }
    const img = await renderSvg(svgDoc(w, h, parts.join(''), defs));
    layers.push(await softenLayer(img, band.sigma));
  }

  return toRgbaPng(await addLayers(w, h, layers));
};

/**
 * rays — volumetric light shafts.
 *
 * Each shaft is a wedge from a common origin, widening with distance and faded
 * out along its own axis by a userSpaceOnUse gradient. Drawing every wedge
 * inside a `rotate()` group means one straight gradient serves all directions.
 * Widths, opacities and hues are jittered per shaft so the fan never looks
 * mechanically regular, then the whole layer is blurred: real shafts are the
 * integral of scattered light and have no crisp edge.
 */
export const rays: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(11);
  const origin = vec2(params, 'origin', [0.22, -0.08]);
  const ox = origin[0] * w;
  const oy = origin[1] * h;
  const baseAngle = num(params, 'angle', -62); // CCW from +x, y up
  const spread = num(params, 'spread', 46);
  const count = Math.max(1, Math.round(num(params, 'count', 9)));
  const base = str(params, 'color', '#FFE7B8');
  const accent = str(params, 'accent', mix(base, '#7FD4FF', 0.5));
  const intensity = num(params, 'intensity', 1);
  const diag = Math.hypot(w, h);
  const length = num(params, 'length', 1.35) * diag;

  const defs: string[] = [];
  const body: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = baseAngle - spread / 2 + spread * t + rng.float(-2.5, 2.5);
    const len = length * rng.float(0.72, 1);
    const near = rng.float(2, 9);
    const far = rng.float(26, 90);
    const col = mix(base, accent, rng.float(0, 0.55));
    const a = clamp(rng.float(0.18, 0.5) * intensity, 0, 1);
    defs.push(
      `<linearGradient id="r${i}" gradientUnits="userSpaceOnUse" x1="${f(ox)}" y1="${f(oy)}" x2="${f(ox + len)}" y2="${f(oy)}">` +
        `<stop offset="0" stop-color="${rgba(col, a)}"/>` +
        `<stop offset="0.28" stop-color="${rgba(col, a * 0.6)}"/>` +
        `<stop offset="1" stop-color="${rgba(col, 0)}"/></linearGradient>`,
    );
    body.push(
      `<g transform="rotate(${f(-angle)} ${f(ox)} ${f(oy)})">` +
        `<polygon points="${f(ox)},${f(oy - near)} ${f(ox + len)},${f(oy - far)} ${f(ox + len)},${f(oy + far)} ${f(ox)},${f(oy + near)}" ` +
        `fill="url(#r${i})"/></g>`,
    );
  }

  const img = await renderSvg(svgDoc(w, h, body.join(''), defs.join('')));
  const soft = await softenLayer(img, Math.max(0.3, diag * 0.004));
  return toRgbaPng(soft);
};

/**
 * speedlines — parallel motion streaks.
 *
 * Rects inside one rotated group, each faded at both ends by a single
 * objectBoundingBox gradient (which rescales per element, so one def covers
 * every length). Lengths and offsets are jittered; a light directional blur is
 * baked in by making the streaks thin rather than by blurring, which keeps them
 * crisp along their axis.
 */
export const speedlines: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(23);
  const angle = num(params, 'angle', 0);
  const count = Math.max(1, Math.round(num(params, 'count', 70)));
  const color = str(params, 'color', '#FFFFFF');
  const accent = str(params, 'accent', color);
  const thickness = num(params, 'thickness', 2);
  const diag = Math.hypot(w, h);
  const cx = w / 2;
  const cy = h / 2;

  const defs =
    `<linearGradient id="sl" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${rgba(color, 0)}"/>` +
    `<stop offset="0.35" stop-color="${rgba(color, 1)}"/>` +
    `<stop offset="0.72" stop-color="${rgba(accent, 0.85)}"/>` +
    `<stop offset="1" stop-color="${rgba(accent, 0)}"/></linearGradient>`;

  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = diag * rng.float(0.12, 0.55);
    const x = cx - diag / 2 + rng.next() * diag;
    const y = cy - diag / 2 + rng.next() * diag;
    const t = thickness * rng.float(0.5, 1.8);
    const a = rng.float(0.12, 0.6);
    lines.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(len)}" height="${f(t)}" fill="url(#sl)" opacity="${a.toFixed(3)}"/>`,
    );
  }

  const body = `<g transform="rotate(${f(-angle)} ${f(cx)} ${f(cy)})">${lines.join('')}</g>`;
  return toRgbaPng(await renderSvg(svgDoc(w, h, body, defs)));
};

/**
 * grid — tech grid, flat or in floor perspective.
 *
 * Perspective mode converges every "vertical" onto a vanishing point and spaces
 * the "horizontals" by a power law, so it reads as a stage floor receding to a
 * horizon rather than as graph paper. Line opacity falls off toward the
 * horizon, which is the depth cue that makes the illusion hold.
 */
export const grid: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(5);
  const color = str(params, 'color', '#5FE3FF');
  const mode = str(params, 'mode', 'perspective');
  const thickness = num(params, 'thickness', 1.2);
  const alpha = num(params, 'opacity', 0.5);
  const parts: string[] = [];

  if (mode === 'flat') {
    const cell = num(params, 'cell', Math.max(24, Math.round(w / 24)));
    for (let x = 0; x <= w; x += cell) {
      parts.push(
        `<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${h}" stroke="${rgba(color, alpha * rng.float(0.5, 1))}" stroke-width="${f(thickness)}"/>`,
      );
    }
    for (let y = 0; y <= h; y += cell) {
      parts.push(
        `<line x1="0" y1="${f(y)}" x2="${w}" y2="${f(y)}" stroke="${rgba(color, alpha * rng.float(0.5, 1))}" stroke-width="${f(thickness)}"/>`,
      );
    }
  } else {
    const horizon = num(params, 'horizon', 0.42) * h;
    const vpx = num(params, 'vanishingX', 0.5) * w;
    const cols = Math.max(4, Math.round(num(params, 'columns', 18)));
    const rowsN = Math.max(3, Math.round(num(params, 'rows', 14)));
    // Verticals: fan from the vanishing point out through the bottom edge.
    for (let i = -cols; i <= cols; i++) {
      const bx = vpx + (i / cols) * w * 1.9;
      parts.push(
        `<line x1="${f(vpx)}" y1="${f(horizon)}" x2="${f(bx)}" y2="${h}" ` +
          `stroke="${rgba(color, alpha * 0.75)}" stroke-width="${f(thickness)}"/>`,
      );
    }
    // Horizontals: power-law spacing ⇒ apparent perspective compression.
    for (let k = 1; k <= rowsN; k++) {
      const t = k / rowsN;
      const y = horizon + (h - horizon) * t ** 2.3;
      parts.push(
        `<line x1="0" y1="${f(y)}" x2="${w}" y2="${f(y)}" ` +
          `stroke="${rgba(color, alpha * (0.25 + 0.75 * t))}" stroke-width="${f(thickness * (0.6 + t))}"/>`,
      );
    }
    // Horizon glow anchors the grid in a space.
    parts.unshift(
      `<rect x="0" y="${f(horizon - h * 0.02)}" width="${w}" height="${f(h * 0.04)}" fill="url(#hz)"/>`,
    );
  }

  const defs =
    `<linearGradient id="hz" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${rgba(color, 0)}"/>` +
    `<stop offset="0.5" stop-color="${rgba(color, alpha * 0.7)}"/>` +
    `<stop offset="1" stop-color="${rgba(color, 0)}"/></linearGradient>`;
  return toRgbaPng(await renderSvg(svgDoc(w, h, parts.join(''), defs)));
};

/**
 * shatter — fractured glass.
 *
 * Real glass fails as radial cracks from the impact plus concentric rings, so
 * the shards are the quads of that (spoke × ring) mesh with jittered vertices.
 * Every shard gets a faint fill and a bright edge; a handful get a hot glint,
 * which is what makes broken glass read as glass rather than as a mosaic.
 */
export const shatter: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(31);
  const origin = vec2(params, 'origin', [0.5, 0.46]);
  const ox = origin[0] * w;
  const oy = origin[1] * h;
  const spokes = Math.max(6, Math.round(num(params, 'spokes', 20)));
  const rings = Math.max(2, Math.round(num(params, 'rings', 6)));
  const edge = str(params, 'edge', '#DFF6FF');
  const fill = str(params, 'fill', '#0A1420');
  const maxR = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)) * 1.05;

  const angles: number[] = [];
  for (let s = 0; s < spokes; s++) {
    angles.push((s / spokes) * 360 + rng.float(-7, 7));
  }
  const radii: number[][] = [];
  for (let k = 0; k <= rings; k++) {
    const base = maxR * (k / rings) ** 1.3;
    radii.push(angles.map(() => base * rng.float(0.86, 1.16)));
  }

  const pt = (k: number, s: number): [number, number] => {
    const a = degToRad(angles[s % spokes]!);
    const r = radii[k]![s % spokes]!;
    return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
  };

  const parts: string[] = [];
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < spokes; s++) {
      const a = pt(k, s);
      const b = pt(k, s + 1);
      const c = pt(k + 1, s + 1);
      const d = pt(k + 1, s);
      const glint = rng.bool(0.12);
      const fillA = rng.float(0.05, 0.22) * (1 - k / (rings + 1));
      const strokeA = glint ? rng.float(0.75, 1) : rng.float(0.18, 0.5);
      const sw = glint ? rng.float(1.4, 2.6) : rng.float(0.6, 1.4);
      parts.push(
        `<polygon points="${f(a[0])},${f(a[1])} ${f(b[0])},${f(b[1])} ${f(c[0])},${f(c[1])} ${f(d[0])},${f(d[1])}" ` +
          `fill="${rgba(glint ? edge : fill, fillA)}" stroke="${rgba(edge, strokeA)}" stroke-width="${f(sw)}" ` +
          `stroke-linejoin="round"/>`,
      );
    }
  }
  // Impact core: a small bright starburst where the energy went in.
  parts.push(`<circle cx="${f(ox)}" cy="${f(oy)}" r="${f(maxR * 0.045)}" fill="url(#impact)"/>`);
  const defs =
    `<radialGradient id="impact"><stop offset="0" stop-color="${rgba(edge, 0.95)}"/>` +
    `<stop offset="1" stop-color="${rgba(edge, 0)}"/></radialGradient>`;

  return toRgbaPng(await renderSvg(svgDoc(w, h, parts.join(''), defs)));
};

/**
 * arena — an abstract stage: floor gradient, crowd bokeh band, truss
 * silhouettes and spotlight cones.
 *
 * Assembled from three passes because they need different treatment: the stage
 * is crisp, the crowd is a blurred bokeh field (a real long lens cannot hold
 * both the stage and row 40), and the spotlights are blurred *and* additive.
 */
export const arena: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(47);
  const key = str(params, 'color', '#2E7BFF');
  const accent = str(params, 'accent', '#FF3B6B');
  const horizon = num(params, 'horizon', 0.58) * h;
  const floorDark = shade(key, -0.42);

  const stageDefs =
    `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${rgba(shade(key, -0.62), 1)}"/>` +
    `<stop offset="1" stop-color="${rgba(shade(key, -0.34), 1)}"/></linearGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${rgba(saturate(key, 1.2), 0.85)}"/>` +
    `<stop offset="0.35" stop-color="${rgba(floorDark, 0.95)}"/>` +
    `<stop offset="1" stop-color="${rgba(shade(key, -0.72), 1)}"/></linearGradient>`;

  const stage: string[] = [
    `<rect x="0" y="0" width="${w}" height="${f(horizon)}" fill="url(#wall)"/>`,
    `<rect x="0" y="${f(horizon)}" width="${w}" height="${f(h - horizon)}" fill="url(#floor)"/>`,
    // Reflected key light on the floor, straight under the stage.
    `<ellipse cx="${f(w / 2)}" cy="${f(horizon + (h - horizon) * 0.45)}" rx="${f(w * 0.42)}" ry="${f((h - horizon) * 0.4)}" fill="${rgba(key, 0.16)}"/>`,
  ];

  // Truss: a dark lattice band across the top with X bracing.
  const trussH = h * 0.075;
  stage.push(`<rect x="0" y="0" width="${w}" height="${f(trussH)}" fill="${rgba('#05070C', 0.92)}"/>`);
  const bay = w / 26;
  for (let i = 0; i < 26; i++) {
    const x0 = i * bay;
    stage.push(
      `<path d="M${f(x0)},2 L${f(x0 + bay)},${f(trussH - 2)} M${f(x0 + bay)},2 L${f(x0)},${f(trussH - 2)}" ` +
        `stroke="${rgba('#0D1522', 1)}" stroke-width="${f(Math.max(1, w * 0.0016))}" fill="none"/>`,
    );
  }
  const stageImg = await renderSvg(svgDoc(w, h, stage.join(''), stageDefs));

  // Crowd: thousands of tiny lights would be slow, a few hundred blurred discs
  // are indistinguishable once defocused. Six pre-mixed tints stand in for the
  // spread of phone screens and reflected stage light in a real crowd.
  const crowdTints = [
    mix(key, '#FFFFFF', 0.35),
    mix(key, '#FFFFFF', 0.7),
    '#FFFFFF',
    mix(accent, '#FFFFFF', 0.3),
    mix(accent, '#FFFFFF', 0.65),
    mix(key, accent, 0.5),
  ];
  const crowdDefs = crowdTints
    .map(
      (c, i) =>
        `<radialGradient id="cd${i}"><stop offset="0" stop-color="${rgba(c, 0.95)}"/>` +
        `<stop offset="0.55" stop-color="${rgba(c, 0.35)}"/>` +
        `<stop offset="1" stop-color="${rgba(c, 0)}"/></radialGradient>`,
    )
    .join('');
  const crowdParts: string[] = [];
  const bandTop = horizon - h * 0.16;
  for (let i = 0; i < 420; i++) {
    const x = rng.next() * w;
    const y = bandTop + rng.next() ** 1.4 * (h * 0.16);
    const r = rng.float(1.2, 4.5) * Math.max(0.6, w / 1280);
    const tint = rng.bool(0.7) ? rng.int(0, 2) : rng.int(3, 5);
    crowdParts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#cd${tint})" opacity="${rng.float(0.25, 0.9).toFixed(3)}"/>`,
    );
  }
  const crowd = await softenLayer(
    await renderSvg(svgDoc(w, h, crowdParts.join(''), crowdDefs)),
    Math.max(0.6, w * 0.0035),
  );

  // Spotlights: cones from the truss, additive and soft.
  const lightDefs: string[] = [];
  const lightParts: string[] = [];
  const beams = Math.max(2, Math.round(num(params, 'beams', 6)));
  for (let i = 0; i < beams; i++) {
    const bx = ((i + 0.5) / beams) * w + rng.float(-w * 0.04, w * 0.04);
    const len = h * rng.float(0.75, 1.1);
    const col = rng.bool(0.6) ? mix(key, '#FFFFFF', 0.45) : mix(accent, '#FFFFFF', 0.4);
    const a = rng.float(0.16, 0.34);
    lightDefs.push(
      `<linearGradient id="b${i}" gradientUnits="userSpaceOnUse" x1="${f(bx)}" y1="${f(trussH)}" x2="${f(bx)}" y2="${f(trussH + len)}">` +
        `<stop offset="0" stop-color="${rgba(col, a)}"/><stop offset="1" stop-color="${rgba(col, 0)}"/></linearGradient>`,
    );
    const spread = w * rng.float(0.06, 0.16);
    lightParts.push(
      `<g transform="rotate(${f(rng.float(-14, 14))} ${f(bx)} ${f(trussH)})">` +
        `<polygon points="${f(bx - w * 0.008)},${f(trussH)} ${f(bx - spread)},${f(trussH + len)} ` +
        `${f(bx + spread)},${f(trussH + len)} ${f(bx + w * 0.008)},${f(trussH)}" fill="url(#b${i})"/></g>`,
    );
  }
  const lights = await softenLayer(
    await renderSvg(svgDoc(w, h, lightParts.join(''), lightDefs.join(''))),
    Math.max(0.6, w * 0.006),
  );

  // Stage first (opaque), then crowd over it, then lights added.
  const { data, info } = await rawToSharp(stageImg)
    .composite([
      { input: crowd.data, raw: { width: w, height: h, channels: 4 }, blend: 'over' },
      { input: lights.data, raw: { width: w, height: h, channels: 4 }, blend: 'add' },
    ])
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return toRgbaPng({ data, width: info.width, height: info.height, channels: info.channels });
};

/**
 * abstract — a layered graphic backdrop: soft colour fields, angular shards and
 * hairlines. Deliberately low-frequency so it can sit behind a subject without
 * competing with it.
 */
export const abstract: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(59);
  const palette = colors(params, 'colors', ['#1B2A4A', '#2E7BFF', '#FF3B6B']);
  const baseCol = palette[0]!;

  const defs: string[] = [
    `<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">` +
      `<stop offset="0" stop-color="${rgba(shade(baseCol, -0.28), 1)}"/>` +
      `<stop offset="1" stop-color="${rgba(shade(baseCol, -0.55), 1)}"/></linearGradient>`,
  ];
  const body: string[] = [`<rect width="${w}" height="${h}" fill="url(#bg)"/>`];

  const blobs = Math.max(2, Math.round(num(params, 'blobs', 4)));
  for (let i = 0; i < blobs; i++) {
    const c = palette[rng.int(0, palette.length - 1)]!;
    defs.push(
      `<radialGradient id="bl${i}"><stop offset="0" stop-color="${rgba(c, rng.float(0.4, 0.75))}"/>` +
        `<stop offset="1" stop-color="${rgba(c, 0)}"/></radialGradient>`,
    );
    body.push(
      `<ellipse cx="${f(rng.next() * w)}" cy="${f(rng.next() * h)}" rx="${f(w * rng.float(0.18, 0.48))}" ` +
        `ry="${f(h * rng.float(0.18, 0.5))}" fill="url(#bl${i})"/>`,
    );
  }

  const shards = Math.max(0, Math.round(num(params, 'shards', 7)));
  for (let i = 0; i < shards; i++) {
    const c = mix(palette[rng.int(0, palette.length - 1)]!, '#FFFFFF', rng.float(0, 0.35));
    const x = rng.next() * w;
    const y = rng.next() * h;
    const len = w * rng.float(0.15, 0.6);
    const thick = h * rng.float(0.01, 0.06);
    body.push(
      `<g transform="rotate(${f(rng.float(-40, 40))} ${f(x)} ${f(y)})">` +
        `<rect x="${f(x)}" y="${f(y)}" width="${f(len)}" height="${f(thick)}" fill="${rgba(c, rng.float(0.08, 0.3))}"/></g>`,
    );
  }

  for (let i = 0; i < 14; i++) {
    const y = rng.next() * h;
    body.push(
      `<line x1="0" y1="${f(y)}" x2="${w}" y2="${f(y + rng.float(-h * 0.2, h * 0.2))}" ` +
        `stroke="${rgba('#FFFFFF', rng.float(0.02, 0.09))}" stroke-width="${f(rng.float(0.6, 1.8))}"/>`,
    );
  }

  return toRgbaPng(await renderSvg(svgDoc(w, h, body.join(''), defs.join(''))));
};

/**
 * bokeh — defocused highlights. The gradient is ring-weighted (brighter at the
 * rim than the centre) because a defocused point source images the aperture,
 * not a gaussian; that ring is why real bokeh looks like coins of light.
 */
export const bokeh: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(67);
  const palette = colors(params, 'colors', ['#7FD4FF', '#FFFFFF', '#FFB36B']);
  const count = Math.max(1, Math.round(num(params, 'count', 34)));
  const sizeScale = num(params, 'size', 1);

  const defs = palette
    .map(
      (c, i) =>
        `<radialGradient id="bk${i}">` +
        `<stop offset="0" stop-color="${rgba(c, 0.42)}"/>` +
        `<stop offset="0.72" stop-color="${rgba(c, 0.5)}"/>` +
        `<stop offset="0.92" stop-color="${rgba(c, 0.85)}"/>` +
        `<stop offset="1" stop-color="${rgba(c, 0)}"/></radialGradient>`,
    )
    .join('');

  const body: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.min(w, h) * rng.float(0.015, 0.075) * sizeScale;
    body.push(
      `<circle cx="${f(rng.next() * w)}" cy="${f(rng.next() * h)}" r="${f(r)}" ` +
        `fill="url(#bk${rng.int(0, palette.length - 1)})" opacity="${rng.float(0.25, 0.8).toFixed(3)}"/>`,
    );
  }

  const img = await renderSvg(svgDoc(w, h, body.join(''), defs));
  return toRgbaPng(await softenLayer(img, Math.max(0.3, Math.min(w, h) * 0.004)));
};

/**
 * energy-burst — radial speed streaks from a focal point plus a hot core.
 * Streak length follows a power distribution so a few reach the frame edge
 * while most stay short, which reads as motion rather than as a sunburst.
 */
export const energyBurst: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(71);
  const origin = vec2(params, 'origin', [0.5, 0.5]);
  const ox = origin[0] * w;
  const oy = origin[1] * h;
  const color = str(params, 'color', '#FF6A00');
  const accent = str(params, 'accent', mix(color, '#FFFFFF', 0.6));
  const count = Math.max(4, Math.round(num(params, 'count', 64)));
  const diag = Math.hypot(w, h);

  const defs: string[] = [
    `<radialGradient id="core"><stop offset="0" stop-color="${rgba(accent, 0.95)}"/>` +
      `<stop offset="0.45" stop-color="${rgba(color, 0.45)}"/>` +
      `<stop offset="1" stop-color="${rgba(color, 0)}"/></radialGradient>`,
  ];
  const body: string[] = [];

  for (let i = 0; i < count; i++) {
    const angle = rng.float(0, 360);
    const inner = diag * rng.float(0.04, 0.16);
    const len = diag * (0.12 + rng.next() ** 2.2 * 0.62);
    const t0 = Math.max(0.6, diag * rng.float(0.001, 0.005));
    const col = mix(color, accent, rng.float(0, 0.8));
    const a = rng.float(0.25, 0.85);
    defs.push(
      `<linearGradient id="eb${i}" gradientUnits="userSpaceOnUse" x1="${f(ox + inner)}" y1="${f(oy)}" x2="${f(ox + inner + len)}" y2="${f(oy)}">` +
        `<stop offset="0" stop-color="${rgba(col, a)}"/>` +
        `<stop offset="0.5" stop-color="${rgba(col, a * 0.5)}"/>` +
        `<stop offset="1" stop-color="${rgba(col, 0)}"/></linearGradient>`,
    );
    body.push(
      `<g transform="rotate(${f(-angle)} ${f(ox)} ${f(oy)})">` +
        `<polygon points="${f(ox + inner)},${f(oy - t0)} ${f(ox + inner + len)},${f(oy - t0 * 0.35)} ` +
        `${f(ox + inner + len)},${f(oy + t0 * 0.35)} ${f(ox + inner)},${f(oy + t0)}" fill="url(#eb${i})"/></g>`,
    );
  }
  body.push(`<circle cx="${f(ox)}" cy="${f(oy)}" r="${f(diag * 0.13)}" fill="url(#core)"/>`);

  const img = await renderSvg(svgDoc(w, h, body.join(''), defs.join('')));
  return toRgbaPng(await softenLayer(img, Math.max(0.3, diag * 0.0025)));
};

/**
 * hexgrid — the house tech grid. A honeycomb of pointy-top cells whose opacity
 * is driven by value noise, so clusters of cells light up instead of the whole
 * lattice buzzing at once. A radial falloff keeps it out of the centre where a
 * subject usually sits.
 */
export const hexgrid: Generator = async (params, size, seed) => {
  const { width: w, height: h } = size;
  const rng = createRng(seed).fork(83);
  const noise = createNoise(seed ^ 0x5eed, 64);
  const color = str(params, 'color', '#5FE3FF');
  const cell = Math.max(6, num(params, 'size', Math.max(18, w / 26)));
  const thickness = num(params, 'thickness', 1.1);
  const alpha = num(params, 'opacity', 0.55);
  const fade = num(params, 'centerFade', 0.55);

  const hexW = Math.sqrt(3) * cell;
  const hexH = 2 * cell;
  const rowStep = hexH * 0.75;
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.hypot(cx, cy);

  const body: string[] = [];
  let row = 0;
  for (let y = -hexH; y < h + hexH; y += rowStep, row++) {
    const offset = row % 2 === 0 ? 0 : hexW / 2;
    for (let x = -hexW; x < w + hexW; x += hexW) {
      const px = x + offset;
      const n = noise.fbm(px / (cell * 6), y / (cell * 6), 3);
      const d = Math.hypot(px - cx, y - cy) / maxD;
      const vis = clamp((n - 0.32) * 2.2, 0, 1) * clamp(d * (1 + fade), 0, 1);
      if (vis < 0.05) continue;
      const pts: string[] = [];
      for (let k = 0; k < 6; k++) {
        const a = degToRad(60 * k - 90);
        pts.push(`${f(px + Math.cos(a) * cell)},${f(y + Math.sin(a) * cell)}`);
      }
      const hot = n > 0.62 && rng.bool(0.22);
      body.push(
        `<polygon points="${pts.join(' ')}" fill="${hot ? rgba(color, vis * 0.22) : 'none'}" ` +
          `stroke="${rgba(color, alpha * vis)}" stroke-width="${f(thickness)}"/>`,
      );
    }
  }

  return toRgbaPng(await renderSvg(svgDoc(w, h, body.join(''), '')));
};
