/**
 * Procedural painting primitives.
 *
 * The offline provider has to look like a designer made it, not like a
 * placeholder — it is the default, so for most users it *is* the product. The
 * primitives here are therefore the ones that actually separate a good plate
 * from a cheap one:
 *
 *   - **Gradients in perceptual space.** Two brand colours blended in sRGB go
 *     through mud; `@hexa/core`'s OKLab `mix` keeps the midpoint vivid.
 *   - **Real bloom.** Glow is rendered as bright geometry on black, blurred,
 *     and screened back over the plate — the same way an optical system makes
 *     it. Drawn "glow rings" always look drawn.
 *   - **Aerial perspective.** Layers get lighter and lower-contrast with
 *     distance. This one trick is most of what makes a flat 2D plate read as
 *     deep.
 *   - **Grain and vignette, last.** Applied after everything else, at low
 *     amplitude, so the plate has a photographic surface rather than the
 *     perfectly clean look that reads as CGI.
 *
 * Everything is driven by a seeded RNG so the same seed paints the same plate,
 * byte for byte.
 */

import sharp from 'sharp';
import { mix, shade, saturate, withAlpha, parseHex, toHex, type Rng } from '@hexa/core';

export interface Size {
  width: number;
  height: number;
}

/** Rasterise an SVG document to an RGBA PNG buffer at an exact size. */
export async function rasterise(svg: string, size: Size): Promise<Buffer> {
  return sharp(Buffer.from(svgDoc(svg, size)), { density: 96 })
    .resize(size.width, size.height, { fit: 'fill' })
    .png()
    .toBuffer();
}

/**
 * Rasterise a glow layer: rendered small, blurred hard, scaled back up. Doing
 * bloom at reduced resolution is both much faster and smoother than blurring
 * at full size — the downsample is itself a low-pass filter.
 */
export async function rasteriseGlow(
  svg: string,
  size: Size,
  opts: { downscale?: number; sigma?: number } = {},
): Promise<Buffer> {
  const scale = opts.downscale ?? 4;
  const w = Math.max(16, Math.round(size.width / scale));
  const h = Math.max(16, Math.round(size.height / scale));
  const sigma = Math.max(0.3, Math.min(400, opts.sigma ?? 12));
  return sharp(Buffer.from(svgDoc(svg, { width: w, height: h })), { density: 96 })
    .resize(w, h, { fit: 'fill' })
    .blur(sigma)
    .resize(size.width, size.height, { fit: 'fill', kernel: 'cubic' })
    .png()
    .toBuffer();
}

/** Wrap SVG body in a sized root element with a transparent background. */
export function svgDoc(body: string, size: Size): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" ` +
    `viewBox="0 0 ${size.width} ${size.height}">${body}</svg>`
  );
}

/** `rgba(...)` string at a given alpha — thin wrapper for readability in SVG. */
export function a(hex: string, alpha: number): string {
  return withAlpha(hex, alpha);
}

/** Perceptual blend, clamped. */
export function blend(from: string, to: string, t: number): string {
  return mix(from, to, Math.max(0, Math.min(1, t)));
}

/**
 * Push a colour toward the background haze value with distance, the way real
 * atmosphere does. `t` of 0 is the near plane, 1 is the far horizon.
 */
export function aerial(colour: string, haze: string, t: number): string {
  return mix(colour, haze, Math.max(0, Math.min(1, t)) ** 0.8 * 0.85);
}

/**
 * Film grain as a raw RGBA layer.
 *
 * Rendered at reduced resolution and scaled back with a nearest-neighbour
 * kernel: chunkier grain survives YouTube's thumbnail downscale, where
 * per-pixel noise just disappears into the encoder.
 */
export async function grainLayer(size: Size, rng: Rng, amount = 0.06): Promise<Buffer> {
  const scale = size.width > 1400 ? 2 : 1;
  const w = Math.max(8, Math.round(size.width / scale));
  const h = Math.max(8, Math.round(size.height / scale));
  const px = Buffer.allocUnsafe(w * h * 4);
  const alpha = Math.round(Math.max(0, Math.min(1, amount)) * 255);
  for (let i = 0; i < w * h; i++) {
    // Gaussian noise centred on mid-grey reads as film; uniform noise reads as sensor dirt.
    const v = Math.max(0, Math.min(255, Math.round(128 + rng.gaussian(0, 46))));
    const o = i * 4;
    px[o] = v;
    px[o + 1] = v;
    px[o + 2] = v;
    px[o + 3] = alpha;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .resize(size.width, size.height, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer();
}

/**
 * Vignette as a radial alpha ramp. Kept elliptical and slightly off-centre —
 * a perfectly symmetric vignette is a dead giveaway that nothing optical
 * happened.
 */
export function vignetteSvg(size: Size, strength: number, colour = '#000000', cx = 0.5, cy = 0.46): string {
  const s = Math.max(0, Math.min(1, strength));
  return `
    <defs>
      <radialGradient id="vig" cx="${cx}" cy="${cy}" r="0.78">
        <stop offset="0.35" stop-color="${a(colour, 0)}"/>
        <stop offset="0.72" stop-color="${a(colour, s * 0.45)}"/>
        <stop offset="1" stop-color="${a(colour, s)}"/>
      </radialGradient>
    </defs>
    <rect width="${size.width}" height="${size.height}" fill="url(#vig)"/>`;
}

/**
 * The negative-space contract, painted.
 *
 * The prompt asks hosted models to leave the subject columns clean; offline we
 * simply do it — a soft darkening wash over the columns where cut-outs land,
 * so the plate has somewhere for a subject to read against.
 */
export function subjectClearanceSvg(size: Size, subjectCount: number, strength = 0.34): string {
  const { width: w, height: h } = size;
  const s = Math.max(0, Math.min(1, strength));
  const columns =
    subjectCount <= 1
      ? [{ cx: 0.6, rx: 0.3 }]
      : subjectCount === 2
        ? [{ cx: 0.27, rx: 0.22 }, { cx: 0.73, rx: 0.22 }]
        : [{ cx: 0.5, rx: 0.46 }];

  const stops = columns
    .map(
      (c, i) => `
      <radialGradient id="clear${i}" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${a('#05060A', s)}"/>
        <stop offset="0.6" stop-color="${a('#05060A', s * 0.55)}"/>
        <stop offset="1" stop-color="${a('#05060A', 0)}"/>
      </radialGradient>`,
    )
    .join('');

  const rects = columns
    .map((c, i) => {
      const cw = c.rx * 2 * w;
      const x = c.cx * w - cw / 2;
      return `<ellipse cx="${(x + cw / 2).toFixed(1)}" cy="${(h * 0.66).toFixed(1)}" rx="${(cw / 2).toFixed(1)}" ry="${(h * 0.52).toFixed(1)}" fill="url(#clear${i})"/>`;
    })
    .join('');

  return `<defs>${stops}</defs>${rects}`;
}

/** A soft elliptical light pool — the workhorse for key light and bloom. */
export function glowSvg(
  size: Size,
  spots: ReadonlyArray<{ cx: number; cy: number; rx: number; ry?: number; colour: string; alpha: number }>,
): string {
  const defs = spots
    .map(
      (s, i) => `
      <radialGradient id="g${i}" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${a(s.colour, s.alpha)}"/>
        <stop offset="0.45" stop-color="${a(s.colour, s.alpha * 0.42)}"/>
        <stop offset="1" stop-color="${a(s.colour, 0)}"/>
      </radialGradient>`,
    )
    .join('');
  const shapes = spots
    .map(
      (s, i) =>
        `<ellipse cx="${(s.cx * size.width).toFixed(1)}" cy="${(s.cy * size.height).toFixed(1)}" ` +
        `rx="${(s.rx * size.width).toFixed(1)}" ry="${((s.ry ?? s.rx) * size.height).toFixed(1)}" fill="url(#g${i})"/>`,
    )
    .join('');
  return `<defs>${defs}</defs>${shapes}`;
}

/**
 * Volumetric beams from an overhead rig: narrow at the source, flared at the
 * floor, drawn as polygons so the haze has something to catch.
 */
export function beamsSvg(
  size: Size,
  rng: Rng,
  opts: {
    count: number;
    originY?: number;
    colours: readonly string[];
    alpha?: number;
    spread?: number;
    lean?: number;
  },
): string {
  const { width: w, height: h } = size;
  const originY = (opts.originY ?? -0.05) * h;
  const alpha = opts.alpha ?? 0.5;
  const spread = opts.spread ?? 0.18;
  const lean = opts.lean ?? 0;
  const defs: string[] = [];
  const shapes: string[] = [];

  for (let i = 0; i < opts.count; i++) {
    const colour = opts.colours[i % opts.colours.length] ?? '#FFFFFF';
    const srcX = rng.float(0.06, 0.94) * w;
    const drift = rng.float(-spread, spread) * w + lean * w;
    const footX = srcX + drift;
    const halfTop = rng.float(0.004, 0.012) * w;
    const halfBottom = rng.float(0.05, 0.13) * w;
    const reach = rng.float(0.75, 1.12) * h;
    const strength = alpha * rng.float(0.55, 1);

    defs.push(`
      <linearGradient id="b${i}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${a(colour, strength)}"/>
        <stop offset="0.45" stop-color="${a(colour, strength * 0.5)}"/>
        <stop offset="1" stop-color="${a(colour, 0)}"/>
      </linearGradient>`);
    shapes.push(
      `<polygon points="${(srcX - halfTop).toFixed(1)},${originY.toFixed(1)} ` +
        `${(srcX + halfTop).toFixed(1)},${originY.toFixed(1)} ` +
        `${(footX + halfBottom).toFixed(1)},${(originY + reach).toFixed(1)} ` +
        `${(footX - halfBottom).toFixed(1)},${(originY + reach).toFixed(1)}" fill="url(#b${i})"/>`,
    );
  }
  return `<defs>${defs.join('')}</defs>${shapes.join('')}`;
}

/**
 * Defocused points of light. Two populations — many small dim ones and a few
 * large bright ones — because that is what a real out-of-focus crowd looks
 * like, and an even distribution reads as a texture rather than a place.
 */
export function bokehSvg(
  size: Size,
  rng: Rng,
  opts: {
    count: number;
    colours: readonly string[];
    band?: { top: number; bottom: number };
    minR?: number;
    maxR?: number;
    alpha?: number;
    /** Fraction of the frame width kept clear in the middle. */
    clearCentre?: number;
  },
): string {
  const { width: w, height: h } = size;
  const band = opts.band ?? { top: 0.05, bottom: 0.7 };
  const minR = (opts.minR ?? 0.002) * w;
  const maxR = (opts.maxR ?? 0.016) * w;
  const alpha = opts.alpha ?? 0.5;
  const clear = opts.clearCentre ?? 0;
  const out: string[] = [];

  for (let i = 0; i < opts.count; i++) {
    const x = rng.float(0, 1);
    if (clear > 0 && Math.abs(x - 0.5) < clear / 2 && rng.bool(0.72)) continue;
    // Bias toward the top of the band so the crowd stacks with perspective.
    const y = band.top + (band.bottom - band.top) * rng.float(0, 1) ** 1.6;
    const big = rng.bool(0.12);
    const r = big ? rng.float(maxR * 0.7, maxR) : rng.float(minR, minR + (maxR - minR) * 0.35);
    const colour = opts.colours[rng.int(0, opts.colours.length - 1)] ?? '#FFFFFF';
    const alp = alpha * (big ? rng.float(0.55, 1) : rng.float(0.18, 0.6));
    // Real bokeh has a bright rim; two concentric circles fake it convincingly.
    out.push(
      `<circle cx="${(x * w).toFixed(1)}" cy="${(y * h).toFixed(1)}" r="${r.toFixed(2)}" fill="${a(colour, alp)}"/>`,
    );
    if (big) {
      out.push(
        `<circle cx="${(x * w).toFixed(1)}" cy="${(y * h).toFixed(1)}" r="${r.toFixed(2)}" fill="none" ` +
          `stroke="${a(colour, alp * 0.9)}" stroke-width="${(r * 0.18).toFixed(2)}"/>`,
      );
    }
  }
  return out.join('');
}

/** A jagged silhouette ridge — hills, rubble, rooftops. */
export function ridgeSvg(
  size: Size,
  rng: Rng,
  opts: { baseline: number; amplitude: number; steps: number; colour: string; alpha?: number; jitter?: number },
): string {
  const { width: w, height: h } = size;
  const pts: string[] = [`0,${h}`];
  const steps = Math.max(4, opts.steps);
  let y = opts.baseline;
  for (let i = 0; i <= steps; i++) {
    y += rng.gaussian(0, opts.amplitude * (opts.jitter ?? 1));
    y = Math.max(opts.baseline - opts.amplitude * 2, Math.min(opts.baseline + opts.amplitude * 2, y));
    pts.push(`${((i / steps) * w).toFixed(1)},${(y * h).toFixed(1)}`);
  }
  pts.push(`${w},${h}`);
  return `<polygon points="${pts.join(' ')}" fill="${a(opts.colour, opts.alpha ?? 1)}"/>`;
}

/** A city skyline of stacked boxes with lit window grids. */
export function skylineSvg(
  size: Size,
  rng: Rng,
  opts: {
    baseline: number;
    minH: number;
    maxH: number;
    colour: string;
    windowColour: string;
    windowAlpha?: number;
    count: number;
    clearCentre?: number;
  },
): string {
  const { width: w, height: h } = size;
  const out: string[] = [];
  const clear = opts.clearCentre ?? 0;
  let x = -0.04 * w;
  for (let i = 0; i < opts.count && x < w; i++) {
    const bw = rng.float(0.035, 0.11) * w;
    const centreish = Math.abs(x / w + bw / w / 2 - 0.5) < clear / 2;
    const bh = (centreish ? rng.float(opts.minH, opts.minH + (opts.maxH - opts.minH) * 0.35) : rng.float(opts.minH, opts.maxH)) * h;
    const top = opts.baseline * h - bh;
    out.push(
      `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(bh + h).toFixed(1)}" fill="${opts.colour}"/>`,
    );
    // Window grid — sparse, irregular, never a full checkerboard.
    const cols = Math.max(1, Math.floor(bw / (0.012 * w)));
    const rows = Math.max(1, Math.floor(bh / (0.028 * h)));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!rng.bool(0.22)) continue;
        const wx = x + (c + 0.28) * (bw / cols);
        const wy = top + (r + 0.3) * (bh / rows);
        const ww = (bw / cols) * 0.44;
        const wh = (bh / rows) * 0.34;
        out.push(
          `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${ww.toFixed(2)}" height="${wh.toFixed(2)}" ` +
            `fill="${a(opts.windowColour, (opts.windowAlpha ?? 0.8) * rng.float(0.35, 1))}"/>`,
        );
      }
    }
    x += bw + rng.float(0.002, 0.014) * w;
  }
  return out.join('');
}

/** Thin light streaks — sparks, rain, energy filaments. */
export function streaksSvg(
  size: Size,
  rng: Rng,
  opts: { count: number; colours: readonly string[]; angle: number; length: number; alpha?: number; width?: number },
): string {
  const { width: w, height: h } = size;
  const out: string[] = [];
  const rad = (opts.angle * Math.PI) / 180;
  for (let i = 0; i < opts.count; i++) {
    const x = rng.float(-0.05, 1.05) * w;
    const y = rng.float(-0.05, 1.05) * h;
    const len = rng.float(opts.length * 0.35, opts.length) * Math.max(w, h);
    const jitter = rng.float(-0.16, 0.16);
    const x2 = x + Math.cos(rad + jitter) * len;
    const y2 = y + Math.sin(rad + jitter) * len;
    const colour = opts.colours[rng.int(0, opts.colours.length - 1)] ?? '#FFFFFF';
    out.push(
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
        `stroke="${a(colour, (opts.alpha ?? 0.5) * rng.float(0.25, 1))}" ` +
        `stroke-width="${((opts.width ?? 0.0016) * w * rng.float(0.5, 1.6)).toFixed(2)}" stroke-linecap="round"/>`,
    );
  }
  return out.join('');
}

/** Angular shards for the shattered-glass look. */
export function shardsSvg(
  size: Size,
  rng: Rng,
  opts: { count: number; origin: { x: number; y: number }; fill: string; edge: string; alpha?: number },
): string {
  const { width: w, height: h } = size;
  const out: string[] = [];
  const ox = opts.origin.x * w;
  const oy = opts.origin.y * h;
  const reach = Math.hypot(w, h);
  for (let i = 0; i < opts.count; i++) {
    const a0 = (i / opts.count) * Math.PI * 2 + rng.float(-0.12, 0.12);
    const a1 = a0 + (Math.PI * 2) / opts.count + rng.float(-0.06, 0.1);
    const r0 = rng.float(0.06, 0.3) * reach;
    const r1 = rng.float(0.45, 1.05) * reach;
    const p = [
      [ox + Math.cos(a0) * r0, oy + Math.sin(a0) * r0],
      [ox + Math.cos(a0) * r1, oy + Math.sin(a0) * r1],
      [ox + Math.cos(a1) * r1 * rng.float(0.7, 1), oy + Math.sin(a1) * r1 * rng.float(0.7, 1)],
      [ox + Math.cos(a1) * r0, oy + Math.sin(a1) * r0],
    ];
    const pts = p.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ');
    out.push(
      `<polygon points="${pts}" fill="${a(opts.fill, (opts.alpha ?? 0.18) * rng.float(0.3, 1))}" ` +
        `stroke="${a(opts.edge, rng.float(0.25, 0.75))}" stroke-width="${(0.0011 * w).toFixed(2)}"/>`,
    );
  }
  return out.join('');
}

/**
 * Layered smoke: overlapping soft ellipses at varying densities. Blurred hard
 * afterwards, which is what turns a pile of ellipses into a volume.
 */
export function smokeSvg(
  size: Size,
  rng: Rng,
  opts: { count: number; colours: readonly string[]; alpha?: number; clearCentre?: number },
): string {
  const { width: w, height: h } = size;
  const out: string[] = [];
  const clear = opts.clearCentre ?? 0;
  for (let i = 0; i < opts.count; i++) {
    let cx = rng.float(-0.1, 1.1);
    if (clear > 0 && Math.abs(cx - 0.5) < clear / 2) cx = cx < 0.5 ? cx - clear / 2 : cx + clear / 2;
    const cy = rng.float(-0.05, 1.05);
    const rx = rng.float(0.06, 0.26);
    const ry = rx * rng.float(0.45, 1.3);
    const colour = opts.colours[rng.int(0, opts.colours.length - 1)] ?? '#FFFFFF';
    out.push(
      `<ellipse cx="${(cx * w).toFixed(1)}" cy="${(cy * h).toFixed(1)}" rx="${(rx * w).toFixed(1)}" ` +
        `ry="${(ry * h).toFixed(1)}" fill="${a(colour, (opts.alpha ?? 0.16) * rng.float(0.3, 1))}"/>`,
    );
  }
  return out.join('');
}

/** Perspective floor grid, converging on a vanishing point. */
export function floorGridSvg(
  size: Size,
  opts: { horizon: number; vanishX: number; lines: number; colour: string; alpha?: number },
): string {
  const { width: w, height: h } = size;
  const out: string[] = [];
  const hy = opts.horizon * h;
  const vx = opts.vanishX * w;
  const alpha = opts.alpha ?? 0.22;

  for (let i = 0; i <= opts.lines; i++) {
    const t = i / opts.lines;
    const x = (t * 3 - 1) * w;
    out.push(
      `<line x1="${vx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${x.toFixed(1)}" y2="${h}" ` +
        `stroke="${a(opts.colour, alpha)}" stroke-width="${(0.0012 * w).toFixed(2)}"/>`,
    );
  }
  // Transverse lines bunch toward the horizon — the cue that sells depth.
  for (let i = 1; i <= opts.lines; i++) {
    const t = (i / opts.lines) ** 2.4;
    const y = hy + (h - hy) * t;
    out.push(
      `<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" ` +
        `stroke="${a(opts.colour, alpha * (0.25 + t * 0.75))}" stroke-width="${(0.001 * w).toFixed(2)}"/>`,
    );
  }
  return out.join('');
}

/** Slight lift of the shadows toward a colour — the "filmic toe" of a grade. */
export function toneLift(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const k = Math.max(0, Math.min(1, amount));
  return toHex({ r: r + (255 - r) * k * 0.06, g: g + (255 - g) * k * 0.06, b: b + (255 - b) * k * 0.1 });
}

export { mix, shade, saturate };
