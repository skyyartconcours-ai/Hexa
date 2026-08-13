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

import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import sharp from 'sharp';
import { HexaError, createRng, hashString, mix, parseHex, readableOn, sanitiseXmlText, shade, withAlpha } from '@hexa/core';
import type { AssetKind, ReferenceAsset, Rng } from '@hexa/core';
import type { AssetLibrary } from './library.js';
import { slugify } from './paths.js';

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

/** Opacity of the caption plate over the silhouette. */
const PLATE_ALPHA = 0.72;

const MIN_DIM = 16;
const MAX_DIM = 8192;

/**
 * Longest label drawn on the plate.
 *
 * The plate is one line of shrink-to-fit text on a decorative caption, so past
 * a few dozen characters nothing is legible anyway — but the *document* still
 * grows linearly with the string, and a 100 000-character handle means a
 * 100 KB SVG that librsvg must parse to draw an illegible smear. Truncating is
 * honest here in a way it would not be for a headline: the placeholder already
 * announces itself as a stand-in.
 */
const MAX_LABEL_CHARS = 64;

/**
 * Render a placeholder as a PNG buffer with a real alpha channel.
 *
 * @throws HexaError `INVALID_REQUEST` for bad dimensions or an unparseable accent.
 * @throws HexaError `RENDER_FAILED` if rasterisation fails.
 */
export async function generatePlaceholder(opts: PlaceholderOptions): Promise<Buffer> {
  const svg = buildPlaceholderSvg(opts);
  try {
    // density 72 ⇒ 1 SVG user unit renders as exactly 1 pixel, so the buffer
    // comes back at the requested slot size rather than a DPI-scaled variant.
    return await sharp(Buffer.from(svg, 'utf8'), { density: 72 })
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
  const label = truncate(String(opts?.label ?? '').trim(), MAX_LABEL_CHARS) || 'UNKNOWN';
  const accent = validAccent(opts?.accent);
  const seed = Number.isFinite(opts?.seed) ? (opts!.seed as number) >>> 0 : hashString(`${label}:${kind}`);
  const rng = createRng(seed);

  // Vertical gradient: lifted accent at the top, deep accent at the bottom.
  // Subtle on purpose — this is scaffolding, not a hero background.
  const top = mix(shade(accent, 0.18), '#FFFFFF', 0.12);
  const bottom = mix(shade(accent, -0.26), INK, 0.35);
  const line = withAlpha(mix(accent, '#FFFFFF', 0.7), 0.5);
  // The label sits on the ink plate, not on the accent — pick the text colour
  // against what is actually behind it, or a dark accent gets dark text.
  const textColor = readableOn(mix(accent, INK, PLATE_ALPHA));

  const body =
    kind === 'logo'
      ? logoMark(w, h, rng)
      : kind === 'backplate'
        ? backplatePanel(w, h, rng)
        : bustSilhouette(w, h, kind, rng);

  const stamp = kind === 'logo' || kind === 'backplate' ? 'PLACEHOLDER' : 'NO LICENSED REFERENCE';
  const hatch = Math.max(8, Math.min(w, h) * 0.028);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    '<defs>',
    `<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${top}"/>`,
    `<stop offset="0.55" stop-color="${accent}"/>`,
    `<stop offset="1" stop-color="${bottom}"/>`,
    '</linearGradient>',
    // Diagonal hatch, drawn *over* the opaque fill so alpha stays 1 inside the
    // shape while the surface still reads as "schematic". Scaled with the frame
    // so the texture is equally visible on a 240px thumb and a 4K plate.
    `<pattern id="hatch" width="${f(hatch)}" height="${f(hatch)}" patternUnits="userSpaceOnUse" patternTransform="rotate(35 0 0)">`,
    `<line x1="0" y1="0" x2="0" y2="${f(hatch)}" stroke="${withAlpha('#FFFFFF', 0.08)}" stroke-width="${f(Math.max(1, hatch * 0.14))}"/>`,
    '</pattern>',
    '</defs>',
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

  const headR = s * (fullBody ? 0.115 : 0.175) * rng.float(0.94, 1.06);
  const headCx = w / 2 + w * rng.float(-0.02, 0.02);
  const headCy = h * (fullBody ? 0.17 : 0.3) + s * rng.float(-0.015, 0.015);
  // Slight vertical stretch: heads are not circles, and the variation keeps a
  // row of placeholders from looking rubber-stamped.
  const headRy = headR * rng.float(1.08, 1.2);

  const neckW = headR * rng.float(0.52, 0.66);
  const neckTop = headCy + headRy * 0.7;
  const neckBase = neckTop + s * rng.float(0.028, 0.042);
  // Deltoid point: where the trapezius stops rising and the arm starts falling.
  const shoulderY = neckBase + s * rng.float(0.07, 0.095);
  const shoulderW = headR * (fullBody ? 3.2 : 3.6) * rng.float(0.95, 1.05);
  // Arms splay outward on the way down for a bust, and taper for a full body.
  const hipW = shoulderW * (fullBody ? 0.86 : 1.1);

  const left = headCx - shoulderW / 2;
  const right = headCx + shoulderW / 2;
  const bottom = h + 2; // bleed past the edge so the cutout has no floating base
  const drop = bottom - shoulderY;

  // Shared upper body: neck → trapezius → deltoid, mirrored back up the far
  // side. Where it ends differs by kind — a bust bleeds off the bottom edge, a
  // full body stops at the hips and grows legs.
  const shoulderIn = (side: -1 | 1): string =>
    `C ${f(headCx + side * shoulderW * 0.2)} ${f(shoulderY - s * 0.05)} ${f(headCx + side * neckW * 1.15)} ${f(neckBase + s * 0.012)} ${f(headCx + side * (neckW / 2))} ${f(neckBase)}`;
  const shoulderOut = (side: -1 | 1): string =>
    `C ${f(headCx + side * neckW * 1.15)} ${f(neckBase + s * 0.012)} ${f(headCx + side * shoulderW * 0.2)} ${f(shoulderY - s * 0.05)} ${f(headCx + side * (shoulderW / 2))} ${f(shoulderY)}`;

  let torso: string;
  if (fullBody) {
    // Standing figure: torso narrows at the waist, widens at the hips, then
    // splits into two legs that run off the bottom edge.
    const waistY = shoulderY + (h - shoulderY) * 0.3;
    const hipY = shoulderY + (h - shoulderY) * 0.46;
    const waistW = shoulderW * 0.76;
    const hipsW = shoulderW * 0.9;
    const gap = shoulderW * 0.17;
    const legIn = gap / 2;
    torso = [
      `M ${f(headCx - neckW / 2)} ${f(neckTop)}`,
      `L ${f(headCx - neckW / 2)} ${f(neckBase)}`,
      shoulderOut(-1),
      `C ${f(left - shoulderW * 0.02)} ${f(waistY - (waistY - shoulderY) * 0.35)} ${f(headCx - waistW / 2)} ${f(waistY - (waistY - shoulderY) * 0.3)} ${f(headCx - waistW / 2)} ${f(waistY)}`,
      `L ${f(headCx - hipsW / 2)} ${f(hipY)}`,
      // Left leg down, right leg back up, with a gap between them.
      `L ${f(headCx - hipsW * 0.42)} ${f(bottom)}`,
      `L ${f(headCx - legIn)} ${f(bottom)}`,
      `L ${f(headCx - legIn * 0.6)} ${f(hipY + (bottom - hipY) * 0.12)}`,
      `L ${f(headCx + legIn * 0.6)} ${f(hipY + (bottom - hipY) * 0.12)}`,
      `L ${f(headCx + legIn)} ${f(bottom)}`,
      `L ${f(headCx + hipsW * 0.42)} ${f(bottom)}`,
      `L ${f(headCx + hipsW / 2)} ${f(hipY)}`,
      `L ${f(headCx + waistW / 2)} ${f(waistY)}`,
      `C ${f(headCx + waistW / 2)} ${f(waistY - (waistY - shoulderY) * 0.3)} ${f(right + shoulderW * 0.02)} ${f(waistY - (waistY - shoulderY) * 0.35)} ${f(right)} ${f(shoulderY)}`,
      shoulderIn(1),
      `L ${f(headCx + neckW / 2)} ${f(neckTop)}`,
      'Z',
    ].join(' ');
  } else {
    torso = [
      `M ${f(headCx - neckW / 2)} ${f(neckTop)}`,
      `L ${f(headCx - neckW / 2)} ${f(neckBase)}`,
      shoulderOut(-1),
      // Arm: bows very slightly outward on the way off the bottom edge.
      `C ${f(left - shoulderW * 0.03)} ${f(shoulderY + drop * 0.35)} ${f(headCx - hipW / 2 - shoulderW * 0.01)} ${f(shoulderY + drop * 0.7)} ${f(headCx - hipW / 2)} ${f(bottom)}`,
      `L ${f(headCx + hipW / 2)} ${f(bottom)}`,
      `C ${f(headCx + hipW / 2 + shoulderW * 0.01)} ${f(shoulderY + drop * 0.7)} ${f(right + shoulderW * 0.03)} ${f(shoulderY + drop * 0.35)} ${f(right)} ${f(shoulderY)}`,
      shoulderIn(1),
      `L ${f(headCx + neckW / 2)} ${f(neckTop)}`,
      'Z',
    ].join(' ');
  }

  const collarY = shoulderY + s * rng.float(0.05, 0.075);
  const shape = [
    '<g>',
    `<path d="${torso}" fill="url(#grad)"/>`,
    `<ellipse cx="${f(headCx)}" cy="${f(headCy)}" rx="${f(headR)}" ry="${f(headRy)}" fill="url(#grad)"/>`,
    // Hatch overlay on the same geometry: texture without touching alpha.
    `<path d="${torso}" fill="url(#hatch)"/>`,
    `<ellipse cx="${f(headCx)}" cy="${f(headCy)}" rx="${f(headR)}" ry="${f(headRy)}" fill="url(#hatch)"/>`,
    // Collar seam: reads as a technical drawing, costs no alpha.
    `<path d="M ${f(left + shoulderW * 0.14)} ${f(collarY)} Q ${f(headCx)} ${f(collarY + s * 0.045)} ${f(right - shoulderW * 0.14)} ${f(collarY)}" stroke="${withAlpha('#FFFFFF', 0.28)}" stroke-width="${f(Math.max(1, s * 0.004))}" fill="none" stroke-dasharray="${f(s * 0.028)} ${f(s * 0.018)}"/>`,
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
  // Perspective rows converge on the bottom edge asymptotically, so the count
  // is bounded explicitly — an "until it reaches the edge" loop never would.
  for (let i = 1; i <= 16; i++) {
    const y = horizon + (h - horizon) * (1 - 1 / (1 + i * 0.45));
    if (y >= h - 1) break;
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
  // Full-body figures carry the plate at chest height so it never bridges the
  // gap between the legs and muddies the silhouette; a logo keeps it clear of
  // the mark entirely.
  const cy =
    kind === 'backplate' ? h * 0.5 : kind === 'fullbody' ? h * 0.46 : kind === 'logo' ? h * 0.88 : h * 0.83;
  const x = (w - plateW) / 2;
  const y = cy - plateH / 2;
  const r = Math.min(plateH * 0.18, s * 0.02);

  return [
    `<g>`,
    `<rect x="${f(x)}" y="${f(y)}" width="${f(plateW)}" height="${f(plateH)}" rx="${f(r)}" fill="${withAlpha(INK, PLATE_ALPHA)}" stroke="${withAlpha('#FFFFFF', 0.25)}" stroke-width="1"/>`,
    `<text x="${f(w / 2)}" y="${f(y + fontSize * 1.28)}" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${f(fontSize)}" font-weight="700" letter-spacing="${f(fontSize * 0.06)}" fill="${textColor}">${esc(text)}</text>`,
    `<text x="${f(w / 2)}" y="${f(y + fontSize * 1.28 + capSize * 1.5)}" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${f(capSize)}" letter-spacing="${f(capSize * 0.18)}" fill="${withAlpha('#FFFFFF', 0.72)}">${esc(stamp)}</text>`,
    `</g>`,
  ].join('');
}

// ── library integration ──────────────────────────────────────────────────────

/** Tag every synthetic asset carries, so identity gates can spot one instantly. */
export const PLACEHOLDER_TAG = 'placeholder';

export interface PlaceholderAssetOptions {
  playerId?: string;
  teamId?: string;
  kind?: AssetKind;
  /** Defaults to the playerId/teamId. */
  label?: string;
  /** Defaults to a neutral slate blue — pass the team accent when you have one. */
  accent?: string;
  width?: number;
  height?: number;
  seed?: number;
}

/**
 * Materialise a placeholder *into* a library and register it, so a clean
 * checkout with no photographs can still resolve a subject and render.
 *
 * Idempotent: if a placeholder for this subject+kind already exists it is
 * returned untouched. The record is licensed `owned` and cleared — the artwork
 * is genuinely ours — but it carries the `placeholder`/`synthetic` tags so the
 * identity gate can refuse to pass it off as a likeness of a real person.
 */
export async function ensurePlaceholderAsset(lib: AssetLibrary, opts: PlaceholderAssetOptions = {}): Promise<ReferenceAsset> {
  const kind: AssetKind = opts.kind ?? 'portrait';
  const subject = opts.playerId ?? opts.teamId;
  const existing = lib
    .all()
    .find((a) => a.tags.includes(PLACEHOLDER_TAG) && a.kind === kind && (a.playerId ?? a.teamId) === subject);
  if (existing) return existing;

  const label = opts.label ?? subject ?? 'REFERENCE';
  const width = opts.width ?? (kind === 'backplate' ? 1920 : 900);
  const height = opts.height ?? (kind === 'backplate' ? 1080 : 1200);
  const png = await generatePlaceholder({
    width,
    height,
    label,
    accent: opts.accent ?? '#4C6FFF',
    kind,
    ...(opts.seed === undefined ? {} : { seed: opts.seed }),
  });

  const rel = `generated/placeholders/${slugify(`${subject ?? 'unassigned'}-${kind}-${label}`, 'placeholder')}.png`;
  const dest = nodePath.join(lib.root, rel);
  await fsp.mkdir(nodePath.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, png);

  return lib.add({
    path: dest,
    kind,
    ...(opts.playerId ? { playerId: opts.playerId } : {}),
    ...(opts.teamId ? { teamId: opts.teamId } : {}),
    copy: false,
    tags: [PLACEHOLDER_TAG, 'synthetic', 'no-identity'],
    provenance: {
      source: 'Hexa synthetic placeholder',
      license: 'owned',
      cleared: true,
      addedAt: new Date().toISOString(),
      notes: 'Generated schematic stand-in. Contains no photographic likeness — replace with a licensed reference photo before publishing a likeness.',
    },
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Fixed-precision numbers keep the SVG (and therefore the PNG) byte-stable. */
function f(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/**
 * Cut to `max` characters, counting by code point so an emoji or a surrogate
 * pair is never split in half — half a pair is exactly the malformed input
 * `esc` then has to repair.
 */
function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Escape for SVG *and* remove what escaping cannot fix.
 *
 * Escaping the five markup characters handles `</text><script>`; it does
 * nothing for a raw U+0000 or an unpaired surrogate, which produce a document
 * librsvg refuses to parse at all. Since the label is a player handle — roster
 * data, a CLI flag, an HTTP body — that failure turns a stray control character
 * into a hard `RENDER_FAILED` on the very path that exists to keep the pipeline
 * runnable when nothing else works. Strip first, then escape.
 */
function esc(s: string): string {
  return sanitiseXmlText(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
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
