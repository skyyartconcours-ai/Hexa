/**
 * Synthetic stand-ins.
 *
 * Hexa ships zero copyrighted photographs, and it must never invent a face.
 * Those two facts together would normally mean a fresh clone cannot render
 * anything — no reference photo, no subject, no thumbnail. Placeholders close
 * that gap: a schematic bust with a real alpha channel, so every downstream
 * stage (cutout compositing, layout measurement, rim lighting, QA) runs on day
 * one against a shape that behaves exactly like a real cutout.
 *
 * The art direction is a deliberate constraint, not a limitation:
 *
 *   - It must read as a diagram. Flat geometry, visible construction lines, a
 *     "NO REFERENCE" stamp. Nobody should ever mistake the output for a person,
 *     and no screenshot of it should be mistakable for a finished render.
 *   - It must never suggest a face. There are no eyes, nose or mouth — the head
 *     carries a crosshair and a question mark instead. A plausible-looking
 *     synthetic face is precisely the failure mode this product exists to
 *     prevent, so the placeholder leans the other way, hard.
 *   - It must be a genuine RGBA PNG: transparent background, opaque silhouette.
 *     Cutout-consuming code stays unchanged whether the alpha came from a
 *     matting model or from here.
 *
 * Output is deterministic: same options ⇒ same pixels, so placeholder-backed
 * renders are still diffable and cacheable.
 */

import sharp from 'sharp';
import { HexaError, createRng, hashString, mix, parseHex, readableOn, shade, withAlpha } from '@hexa/core';
import type { AssetKind, Rng } from '@hexa/core';

export interface PlaceholderOptions {
  width: number;
  height: number;
  /** Shown on the plate — usually a player handle or team tag. */
  label: string;
  /** Hex accent, `#RGB`/`#RRGGBB`; drives the gradient. */
  accent: string;
  /** Varies the silhouette. Defaults to a hash of the label, so "Peyz" is always the same shape. */
  seed?: number;
  /** Selects the silhouette family. Defaults to 'portrait'. */
  kind?: AssetKind;
}

/** Ink used for construction lines and the caption plate. */
const INK = '#0B0B0F';

const MIN_DIM = 16;
const MAX_DIM = 8192;

/**
 * Render a placeholder as a PNG buffer with a real alpha channel.
 *
 * @throws HexaError `INVALID_REQUEST` for bad dimensions or an unparseable accent.
 * @throws HexaError `RENDER_FAILED` if rasterisation fails.
 */
export async function generatePlaceholder(opts: PlaceholderOptions): Promise<Buffer> {
  const svg = buildPlaceholderSvg(opts);
  try {
    return await sharp(Buffer.from(svg, 'utf8'), { density: 96 })
      .ensureAlpha() // guarantee 4 channels even if the shape happens to fill the frame
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    throw new HexaError('RENDER_FAILED', 'Failed to rasterise placeholder', {
      hint: 'sharp needs librsvg for SVG input — reinstall sharp if this persists.',
      details: { width: opts.width, height: opts.height, kind: opts.kind },
      cause: err,
    });
  }
}

/**
 * The SVG behind {@link generatePlaceholder}. Exported because it is pure and
 * cheap to assert on — geometry tests do not need a rasteriser.
 */
export function buildPlaceholderSvg(opts: PlaceholderOptions): string {
  const w = validDim(opts?.width, 'width');
  const h = validDim(opts?.height, 'height');
  const kind: AssetKind = opts?.kind ?? 'portrait';
  const label = String(opts?.label ?? '').trim() || 'UNKNOWN';
  const accent = validAccent(opts?.accent);
  const seed = Number.isFinite(opts?.seed) ? (opts!.seed as number) >>> 0 : hashString(`${label}:${kind}`);
  const rng = createRng(seed);

  // Vertical gradient: lifted accent at the top, deep accent at the bottom.
  // Subtle on purpose — this is scaffolding, not a hero background.
  const top = mix(shade(accent, 0.18), '#FFFFFF', 0.12);
  const bottom = mix(shade(accent, -0.26), INK, 0.35);
  const line = withAlpha(mix(accent, '#FFFFFF', 0.7), 0.5);
  const textColor = readableOn(shade(accent, -0.1));

  const body =
    kind === 'logo'
      ? logoMark(w, h, rng)
      : kind === 'backplate'
        ? backplatePanel(w, h, rng)
        : bustSilhouette(w, h, kind, rng);

  const stamp = kind === 'logo' || kind === 'backplate' ? 'PLACEHOLDER' : 'NO LICENSED REFERENCE';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    '<defs>',
    `<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${top}"/>`,
    `<stop offset="0.55" stop-color="${accent}"/>`,
    `<stop offset="1" stop-color="${bottom}"/>`,
    '</linearGradient>',
    // Diagonal hatch, drawn *over* the opaque fill so alpha stays 1 inside the
    // shape while the surface still reads as "schematic".
    `<pattern id="hatch" width="${f(14)}" height="${f(14)}" patternUnits="userSpaceOnUse" patternTransform="rotate(35 0 0)">`,
    `<line x1="0" y1="0" x2="0" y2="${f(14)}" stroke="${withAlpha('#FFFFFF', 0.08)}" stroke-width="2"/>`,
    '</pattern>',
    '</defs>',
    body.defs ?? '',
    // Background stays fully transparent: this is a cutout, not a card.
    body.shape,
    constructionMarks(w, h, line, body.headMark, rng),
    captionPlate(w, h, label, stamp, textColor, kind),
    '</svg>',
  ].join('');
}

// ── silhouettes ──────────────────────────────────────────────────────────────

interface BodyArt {
  /** Opaque geometry: the alpha shape the layout engine measures. */
  shape: string;
  defs?: string;
  /** Where to draw the "no face here" crosshair, if anywhere. */
  headMark?: { cx: number; cy: number; r: number };
}

/**
 * Head + neck + shoulders, bleeding off the bottom edge like a real bust
 * cutout. Every dimension is jittered from the seed, so two players never get
 * the same outline while both stay obviously schematic.
 */
function bustSilhouette(w: number, h: number, kind: AssetKind, rng: Rng): BodyArt {
  const fullBody = kind === 'fullbody';
  const s = Math.min(w, h);

  const headR = s * (fullBody ? 0.11 : 0.165) * rng.float(0.94, 1.06);
  const headCx = w / 2 + w * rng.float(-0.02, 0.02);
  const headCy = h * (fullBody ? 0.17 : 0.3) + s * rng.float(-0.015, 0.015);
  // Slight vertical stretch: heads are not circles, and the variation keeps a
  // row of placeholders from looking rubber-stamped.
  const headRy = headR * rng.float(1.08, 1.2);

  const neckW = headR * rng.float(0.5, 0.62);
  const neckTop = headCy + headRy * 0.72;
  const shoulderY = neckTop + s * rng.float(0.07, 0.1);
  const shoulderW = headR * (fullBody ? 3.1 : 3.7) * rng.float(0.94, 1.06);
  const shoulderSlope = s * rng.float(0.045, 0.075);
  const hipW = shoulderW * (fullBody ? 0.82 : 1);

  const left = headCx - shoulderW / 2;
  const right = headCx + shoulderW / 2;
  const bottom = h + 2; // bleed past the edge so the cutout has no floating base

  // Torso: shoulders curve out from the neck, then run down (tapering slightly
  // for full-body) to below the frame.
  const torso = [
    `M ${f(headCx - neckW / 2)} ${f(neckTop)}`,
    `C ${f(headCx - neckW / 2)} ${f(shoulderY - shoulderSlope * 0.4)} ${f(left + shoulderW * 0.16)} ${f(shoulderY - shoulderSlope)} ${f(left)} ${f(shoulderY + shoulderSlope)}`,
    `L ${f(headCx - hipW / 2)} ${f(bottom)}`,
    `L ${f(headCx + hipW / 2)} ${f(bottom)}`,
    `L ${f(right)} ${f(shoulderY + shoulderSlope)}`,
    `C ${f(right - shoulderW * 0.16)} ${f(shoulderY - shoulderSlope)} ${f(headCx + neckW / 2)} ${f(shoulderY - shoulderSlope * 0.4)} ${f(headCx + neckW / 2)} ${f(neckTop)}`,
    'Z',
  ].join(' ');

  const shape = [
    '<g>',
    `<path d="${torso}" fill="url(#grad)"/>`,
    `<ellipse cx="${f(headCx)}" cy="${f(headCy)}" rx="${f(headR)}" ry="${f(headRy)}" fill="url(#grad)"/>`,
    // Hatch overlay, clipped to the same geometry.
    `<path d="${torso}" fill="url(#hatch)"/>`,
    `<ellipse cx="${f(headCx)}" cy="${f(headCy)}" rx="${f(headR)}" ry="${f(headRy)}" fill="url(#hatch)"/>`,
    // Shoulder seam line: reads as a technical drawing, costs no alpha.
    `<path d="M ${f(left + shoulderW * 0.12)} ${f(shoulderY + shoulderSlope * 1.6)} L ${f(right - shoulderW * 0.12)} ${f(shoulderY + shoulderSlope * 1.6)}" stroke="${withAlpha('#FFFFFF', 0.25)}" stroke-width="${f(Math.max(1, s * 0.004))}" fill="none" stroke-dasharray="${f(s * 0.03)} ${f(s * 0.02)}"/>`,
    '</g>',
  ].join('');

  return { shape, headMark: { cx: headCx, cy: headCy, r: Math.max(headR, headRy) } };
}

/** A hexagon mark — a stand-in team crest, obviously generic. */
function logoMark(w: number, h: number, rng: Rng): BodyArt {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.36 * rng.float(0.94, 1.06);
  const rot = rng.float(0, 60);
  const pts = (radius: number): string =>
    Array.from({ length: 6 }, (_, i) => {
      const a = ((rot + i * 60 - 90) * Math.PI) / 180;
      return `${f(cx + radius * Math.cos(a))},${f(cy + radius * Math.sin(a))}`;
    }).join(' ');

  const shape = [
    '<g>',
    `<polygon points="${pts(r)}" fill="url(#grad)"/>`,
    `<polygon points="${pts(r)}" fill="url(#hatch)"/>`,
    `<polygon points="${pts(r * 0.62)}" fill="none" stroke="${withAlpha('#FFFFFF', 0.35)}" stroke-width="${f(Math.max(1, r * 0.03))}"/>`,
    '</g>',
  ].join('');
  return { shape };
}

/** A full-bleed environment plate: opaque everywhere, with a horizon grid. */
function backplatePanel(w: number, h: number, rng: Rng): BodyArt {
  const horizon = h * rng.float(0.55, 0.68);
  const step = Math.max(24, Math.min(w, h) / rng.float(7, 11));
  const lines: string[] = [];
  for (let x = 0; x <= w; x += step) {
    lines.push(
      `<line x1="${f(x)}" y1="${f(horizon)}" x2="${f(w / 2 + (x - w / 2) * 3)}" y2="${f(h)}" stroke="${withAlpha('#FFFFFF', 0.12)}" stroke-width="1"/>`,
    );
  }
  for (let i = 1, y = horizon; y < h; i++) {
    y = horizon + (h - horizon) * (1 - 1 / (1 + i * 0.45));
    lines.push(`<line x1="0" y1="${f(y)}" x2="${f(w)}" y2="${f(y)}" stroke="${withAlpha('#FFFFFF', 0.1)}" stroke-width="1"/>`);
  }

  const shape = [
    '<g>',
    `<rect x="0" y="0" width="${f(w)}" height="${f(h)}" fill="url(#grad)"/>`,
    `<rect x="0" y="0" width="${f(w)}" height="${f(h)}" fill="url(#hatch)"/>`,
    `<line x1="0" y1="${f(horizon)}" x2="${f(w)}" y2="${f(horizon)}" stroke="${withAlpha('#FFFFFF', 0.3)}" stroke-width="${f(Math.max(1, h * 0.003))}"/>`,
    ...lines,
    '</g>',
  ].join('');
  return { shape };
}

// ── schematic furniture ──────────────────────────────────────────────────────

/**
 * Dashed frame, corner ticks, and — over the head — a crosshair plus a question
 * mark. The crosshair is the honest bit: it marks where a face *would* go once
 * a licensed photograph is ingested, and states that none is there yet.
 */
function constructionMarks(
  w: number,
  h: number,
  line: string,
  headMark: BodyArt['headMark'],
  rng: Rng,
): string {
  const inset = Math.min(w, h) * 0.035;
  const tick = Math.min(w, h) * 0.06;
  const sw = Math.max(1, Math.min(w, h) * 0.004);
  const out: string[] = [
    `<rect x="${f(inset)}" y="${f(inset)}" width="${f(w - inset * 2)}" height="${f(h - inset * 2)}" fill="none" stroke="${line}" stroke-width="${f(sw)}" stroke-dasharray="${f(tick * 0.35)} ${f(tick * 0.35)}"/>`,
  ];
  // Corner ticks, solid, so the frame reads as a registration mark.
  for (const [x, y, dx, dy] of [
    [inset, inset, 1, 1],
    [w - inset, inset, -1, 1],
    [inset, h - inset, 1, -1],
    [w - inset, h - inset, -1, -1],
  ] as const) {
    out.push(
      `<path d="M ${f(x)} ${f(y + dy * tick)} L ${f(x)} ${f(y)} L ${f(x + dx * tick)} ${f(y)}" fill="none" stroke="${line}" stroke-width="${f(sw * 1.6)}"/>`,
    );
  }

  if (headMark) {
    const { cx, cy, r } = headMark;
    const jitter = r * rng.float(-0.04, 0.04);
    out.push(
      `<g stroke="${withAlpha('#FFFFFF', 0.55)}" stroke-width="${f(sw)}" fill="none">`,
      `<circle cx="${f(cx + jitter)}" cy="${f(cy)}" r="${f(r * 0.55)}" stroke-dasharray="${f(r * 0.18)} ${f(r * 0.12)}"/>`,
      `<line x1="${f(cx + jitter - r * 0.8)}" y1="${f(cy)}" x2="${f(cx + jitter + r * 0.8)}" y2="${f(cy)}"/>`,
      `<line x1="${f(cx + jitter)}" y1="${f(cy - r * 0.8)}" x2="${f(cx + jitter)}" y2="${f(cy + r * 0.8)}"/>`,
      '</g>',
      `<text x="${f(cx + jitter)}" y="${f(cy + r * 0.42)}" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${f(r * 1.1)}" font-weight="700" fill="${withAlpha('#FFFFFF', 0.75)}">?</text>`,
    );
  }
  return out.join('');
}

/**
 * The label plate: player handle plus a standing "no licensed reference" stamp,
 * so the placeholder announces itself in any screenshot.
 */
function captionPlate(w: number, h: number, label: string, stamp: string, textColor: string, kind: AssetKind): string {
  const s = Math.min(w, h);
  const fontSize = Math.max(10, s * (kind === 'backplate' ? 0.055 : 0.075));
  const capSize = Math.max(7, fontSize * 0.34);
  const text = label.toUpperCase();
  // Rough advance width for DejaVu-ish caps at the tracking below; the plate is
  // decorative so an approximation is fine and avoids a font-metrics dependency.
  const plateW = Math.min(w * 0.92, text.length * fontSize * 0.72 + fontSize * 1.4);
  const plateH = fontSize * 1.7 + capSize * 1.9;
  const cy = kind === 'backplate' ? h * 0.5 : h * 0.83;
  const x = (w - plateW) / 2;
  const y = cy - plateH / 2;
  const r = Math.min(plateH * 0.18, s * 0.02);

  return [
    `<g>`,
    `<rect x="${f(x)}" y="${f(y)}" width="${f(plateW)}" height="${f(plateH)}" rx="${f(r)}" fill="${withAlpha(INK, 0.72)}" stroke="${withAlpha('#FFFFFF', 0.25)}" stroke-width="1"/>`,
    `<text x="${f(w / 2)}" y="${f(y + fontSize * 1.28)}" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${f(fontSize)}" font-weight="700" letter-spacing="${f(fontSize * 0.06)}" fill="${textColor}">${esc(text)}</text>`,
    `<text x="${f(w / 2)}" y="${f(y + fontSize * 1.28 + capSize * 1.5)}" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${f(capSize)}" letter-spacing="${f(capSize * 0.18)}" fill="${withAlpha('#FFFFFF', 0.72)}">${esc(stamp)}</text>`,
    `</g>`,
  ].join('');
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Fixed-precision numbers keep the SVG (and therefore the PNG) byte-stable. */
function f(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function validDim(v: number, what: string): number {
  if (!Number.isFinite(v) || v < MIN_DIM || v > MAX_DIM) {
    throw new HexaError('INVALID_REQUEST', `Placeholder ${what} must be between ${MIN_DIM} and ${MAX_DIM}px, got ${String(v)}`, {
      hint: 'Pass the slot dimensions from the layout, e.g. { width: 720, height: 1080 }.',
    });
  }
  return Math.round(v);
}

function validAccent(accent: string): string {
  try {
    const { r, g, b } = parseHex(accent);
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  } catch (err) {
    throw new HexaError('INVALID_REQUEST', `Invalid placeholder accent colour: ${String(accent)}`, {
      hint: 'Use a hex colour such as "#FF5A1F" — team accents come from Team.colors.',
      cause: err,
    });
  }
}
