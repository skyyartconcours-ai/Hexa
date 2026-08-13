/**
 * Small-size simulation.
 *
 * The single most common way a beautiful thumbnail fails is that nobody ever
 * sees it at 1280×720. It is judged in a sidebar strip barely wider than a
 * postage stamp. This module renders the truth: the same image at every box
 * YouTube actually paints it into, plus a proof sheet you can eyeball.
 */

import sharp from 'sharp';
import { EDGE_THRESHOLD, edgeDensity, loadGray, rmsContrast, sobel } from './image.js';

export interface DisplaySize {
  w: number;
  h: number;
  label: string;
}

/**
 * The boxes a YouTube thumbnail is rendered into on the web client, plus the
 * mobile feed. Sources:
 *  - `i.ytimg.com` named renditions, which are the sizes YouTube itself
 *    generates and serves: `default.jpg` 120×90, `mqdefault.jpg` 320×180,
 *    `hqdefault.jpg` 480×360, `sddefault.jpg` 640×480, `maxresdefault.jpg`
 *    1280×720. The 320×180 rendition is what the mobile feed requests.
 *  - The rendered CSS boxes of the web client: the related/up-next sidebar
 *    strip (~168×94), the browse/home grid tile at its densest column count
 *    (~210×118), and the search-results row (~360×202).
 *
 * These are representative, not eternal: YouTube reflows its grid regularly and
 * the exact CSS widths drift by a few pixels between layout revisions. They are
 * the right order of magnitude, which is what legibility turns on — the sidebar
 * box is roughly 1.7% of the pixel count of the master render.
 */
export const YOUTUBE_DISPLAY_SIZES: DisplaySize[] = [
  { w: 168, h: 94, label: 'sidebar' },
  { w: 210, h: 118, label: 'home' },
  { w: 320, h: 180, label: 'mobile' },
  { w: 360, h: 202, label: 'search' },
];

export interface SimulatedSize {
  label: string;
  width: number;
  height: number;
  buffer: Buffer;
  legible: boolean;
  edgeDensity: number;
  notes: string[];
}

/**
 * Downscale to each display size and report what survived.
 *
 * `legible` here is an image-level verdict — it knows nothing about where the
 * text is (that is `legibilityGate`'s job, which is given the text rects). It
 * answers a coarser question: after the downsample, does this image still carry
 * readable structure and tonal separation, or has it collapsed into mush /
 * exploded into noise? Both failure modes are real:
 *   - too little edge density ⇒ shapes have dissolved, nothing reads;
 *   - too much ⇒ every pixel is an edge, which at this size is indistinguishable
 *     from static and the eye finds no shape at all.
 */
export async function simulateSizes(image: Buffer, sizes: DisplaySize[] = YOUTUBE_DISPLAY_SIZES): Promise<SimulatedSize[]> {
  const out: SimulatedSize[] = [];
  for (const size of sizes) {
    const buffer = await sharp(image, { failOn: 'none' })
      .resize(size.w, size.h, { fit: 'fill', kernel: 'lanczos3' })
      .png()
      .toBuffer();

    const gray = await loadGray(buffer);
    const mag = sobel(gray);
    const density = edgeDensity(mag, gray.width, gray.height, undefined, EDGE_THRESHOLD);
    const contrast = rmsContrast(gray);

    const notes: string[] = [];
    let legible = true;

    if (density < 0.04) {
      legible = false;
      notes.push(`only ${(density * 100).toFixed(1)}% of pixels carry an edge at ${size.w}×${size.h} — shapes dissolve at this size`);
    }
    if (contrast < 0.09) {
      legible = false;
      notes.push(`tonal range collapses to ${(contrast * 100).toFixed(1)}% RMS contrast — the image greys out`);
    }
    if (density > 0.55) {
      legible = false;
      notes.push(`${(density * 100).toFixed(0)}% of pixels are edges — reads as static rather than a subject`);
    } else if (density > 0.4) {
      notes.push(`busy at this size (${(density * 100).toFixed(0)}% edge pixels); check the focal point still wins`);
    }
    if (legible && notes.length === 0) {
      notes.push(`holds up: ${(density * 100).toFixed(0)}% edge pixels, ${(contrast * 100).toFixed(0)}% RMS contrast`);
    }

    out.push({ label: size.label, width: size.w, height: size.h, buffer, legible, edgeDensity: density, notes });
  }
  return out;
}

/**
 * One PNG with the thumbnail at every display size, laid out left to right,
 * largest first, each captioned. Print it, or drop it in a PR — the honest
 * reviewer's tool. Labels are drawn through sharp's SVG rasteriser; if no font
 * is installed the strip still renders, just without captions.
 */
export async function proofSheet(image: Buffer, opts: { background?: string } = {}): Promise<Buffer> {
  const background = opts.background ?? '#0B0B0F';
  const sizes = [...YOUTUBE_DISPLAY_SIZES].sort((a, b) => b.w - a.w);
  const pad = 18;
  const captionH = 22;

  const tiles = await Promise.all(
    sizes.map(async (s) => ({
      size: s,
      buffer: await sharp(image, { failOn: 'none' }).resize(s.w, s.h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer(),
    })),
  );

  const sheetW = pad + tiles.reduce((acc, t) => acc + t.size.w + pad, 0);
  const tallest = Math.max(...tiles.map((t) => t.size.h));
  const sheetH = pad + captionH + tallest + pad;

  const composites: sharp.OverlayOptions[] = [];
  const captions: string[] = [];
  let x = pad;
  for (const t of tiles) {
    const top = pad + captionH;
    composites.push({ input: t.buffer, left: x, top });
    captions.push(
      `<text x="${x}" y="${pad + 14}" font-family="sans-serif" font-size="12" fill="#E8E8F0">${t.size.label.toUpperCase()} ${t.size.w}×${t.size.h}</text>`,
      // 1px keyline so a dark thumbnail does not bleed into a dark sheet.
      `<rect x="${x - 0.5}" y="${top - 0.5}" width="${t.size.w + 1}" height="${t.size.h + 1}" fill="none" stroke="#2A2A36" stroke-width="1"/>`,
    );
    x += t.size.w + pad;
  }

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}">${captions.join('')}</svg>`,
  );

  let pipe = sharp({ create: { width: sheetW, height: sheetH, channels: 3, background } }).composite([
    ...composites,
    { input: overlay, left: 0, top: 0 },
  ]);

  try {
    return await pipe.png().toBuffer();
  } catch {
    // No fontconfig / no SVG rasteriser: emit the strip without captions rather
    // than failing a QA run over decoration.
    pipe = sharp({ create: { width: sheetW, height: sheetH, channels: 3, background } }).composite(composites);
    return pipe.png().toBuffer();
  }
}
