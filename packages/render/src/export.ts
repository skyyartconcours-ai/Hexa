/**
 * Encoding and review surfaces: final image export, the layer debug overlay and
 * the contact sheet used to eyeball a batch of variants side by side.
 */

import sharp from 'sharp';
import { HexaError, type PixelRect, parseHex } from '@hexa/core';
import { type RawImage, toRaw, rawToSharp } from './raw.js';
import { f, svgDoc } from './generators/util.js';

const FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'avif']);

/** Encode a raw frame. Kept separate so `renderPlan` never round-trips a PNG. */
export async function exportRaw(img: RawImage, format: string, quality = 92): Promise<Buffer> {
  const fmt = format.toLowerCase();
  if (!FORMATS.has(fmt)) {
    throw new HexaError('INVALID_REQUEST', `unsupported export format "${format}"`, {
      hint: `Supported: ${[...FORMATS].join(', ')}`,
    });
  }
  const pipe = rawToSharp(img);
  switch (fmt) {
    case 'png':
      // Level 8, not 9. A *graded* thumbnail is not the flat graphic it looks
      // like — film grain puts high-entropy noise in every pixel, and zlib's
      // top level has almost nothing left to find in it. Measured on a finished
      // 1280×720 frame: level 8 gives 889 KB in 67 ms, level 9 gives 882 KB in
      // 126 ms. Eight tenths of a percent is not worth doubling the encode.
      return pipe.png({ compressionLevel: 8 }).toBuffer();
    case 'jpeg':
    case 'jpg':
      // 4:4:4 because saturated red/blue esports branding is exactly what
      // chroma subsampling smears.
      return pipe
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
    case 'webp':
      return pipe.webp({ quality, effort: 4 }).toBuffer();
    default:
      return pipe.avif({ quality, effort: 3 }).toBuffer();
  }
}

export async function exportImage(buffer: Buffer, format: string, quality?: number): Promise<Buffer> {
  return exportRaw(await toRaw(buffer), format, quality);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Debug overlay: every layer's final bounding box plus its id, colour-coded by
 * paint order. Template authors spend most of their time asking "where did that
 * layer actually land?", and this answers it in one render.
 */
export function debugOverlaySvg(
  width: number,
  height: number,
  boxes: { id: string; rect: PixelRect; z: number; blend?: string }[],
): string {
  const fontSize = Math.max(11, Math.round(height * 0.016));
  const parts: string[] = [];
  // Full-canvas layers all start at (0,0); stagger their labels down a row each
  // so an FX stack does not collapse into one illegible smear of text.
  const rows = new Map<string, number>();
  boxes.forEach((box, i) => {
    const hue = Math.round((i / Math.max(1, boxes.length)) * 320);
    const stroke = `hsl(${hue},95%,62%)`;
    const { x, y, w, h } = box.rect;
    const labelW = (box.id.length + 6) * fontSize * 0.58;
    const key = `${Math.round(x)},${Math.round(y)}`;
    const row = rows.get(key) ?? 0;
    rows.set(key, row + 1);
    const ly = Math.max(fontSize + 2, y) + row * (fontSize + 6);
    parts.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="${stroke}" ` +
        `stroke-width="2" stroke-dasharray="7 5"/>`,
      `<rect x="${f(x)}" y="${f(ly - fontSize - 3)}" width="${f(labelW)}" height="${f(fontSize + 6)}" ` +
        `fill="rgba(0,0,0,0.72)"/>`,
      `<text x="${f(x + 4)}" y="${f(ly)}" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" ` +
        `fill="${stroke}">${esc(box.id)} · z${box.z}</text>`,
    );
  });
  return svgDoc(width, height, parts.join(''));
}

/**
 * Contact sheet — tile rendered variants with labels so a human can pick.
 * Cells are laid out on a fixed column grid; each row is as tall as its tallest
 * image, so mixed aspect ratios do not leave ragged gaps.
 */
export async function contactSheet(
  images: { buffer: Buffer; label: string }[],
  opts: { cols?: number; width?: number; background?: string } = {},
): Promise<Buffer> {
  if (images.length === 0) {
    throw new HexaError('INVALID_REQUEST', 'contactSheet() needs at least one image');
  }
  const cols = Math.max(1, Math.round(opts.cols ?? 3));
  const sheetW = Math.max(320, Math.round(opts.width ?? 1600));
  const bg = parseHex(opts.background ?? '#0B0B0F');
  const pad = Math.round(sheetW * 0.012);
  const gap = Math.round(sheetW * 0.01);
  const cellW = Math.floor((sheetW - pad * 2 - gap * (cols - 1)) / cols);
  const fontSize = Math.max(12, Math.round(cellW * 0.045));
  const labelH = Math.round(fontSize * 1.9);

  const cells = await Promise.all(
    images.map(async ({ buffer, label }) => {
      const meta = await sharp(buffer).metadata();
      const iw = meta.width ?? cellW;
      const ih = meta.height ?? cellW;
      const cellH = Math.max(1, Math.round((cellW * ih) / iw));
      const resized = await sharp(buffer)
        .resize(cellW, cellH, { fit: 'fill', kernel: 'lanczos3' })
        .ensureAlpha()
        .raw({ depth: 'uchar' })
        .toBuffer();
      return { data: resized, w: cellW, h: cellH, label };
    }),
  );

  const rows = Math.ceil(cells.length / cols);
  const rowH: number[] = [];
  for (let r = 0; r < rows; r++) {
    let tallest = 0;
    for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c];
      if (cell) tallest = Math.max(tallest, cell.h);
    }
    rowH.push(tallest + labelH);
  }
  const sheetH = pad * 2 + rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1);

  const composites: sharp.OverlayOptions[] = [];
  const labels: string[] = [];
  let y = pad;
  for (let r = 0; r < rows; r++) {
    let x = pad;
    for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c];
      if (cell) {
        composites.push({
          input: cell.data,
          raw: { width: cell.w, height: cell.h, channels: 4 },
          left: x,
          top: y,
        });
        labels.push(
          `<text x="${f(x + 2)}" y="${f(y + cell.h + fontSize + 4)}" font-family="DejaVu Sans, sans-serif" ` +
            `font-size="${fontSize}" fill="#E8E8F0">${esc(cell.label)}</text>`,
        );
      }
      x += cellW + gap;
    }
    y += rowH[r]! + gap;
  }
  composites.push({ input: Buffer.from(svgDoc(sheetW, sheetH, labels.join(''))), left: 0, top: 0 });

  return sharp({
    create: {
      width: sheetW,
      height: sheetH,
      channels: 4,
      background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();
}
