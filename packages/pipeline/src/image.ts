/**
 * Local image primitives.
 *
 * The compositor owns pixels; this module only answers the cheap questions the
 * *compiler* needs before a plan exists — chiefly "how big is this cutout?",
 * which decides every crop, scale and face position downstream. sharp reads a
 * PNG header for that without decoding the image.
 */

import fs from 'node:fs/promises';
import sharp from 'sharp';

export interface ImageSize {
  width: number;
  height: number;
}

/** Intrinsic size, or `undefined` when the bytes are not a decodable image. */
export async function imageSize(image: Buffer): Promise<ImageSize | undefined> {
  try {
    const meta = await sharp(image).metadata();
    if (!meta.width || !meta.height) return undefined;
    // An EXIF orientation of 5–8 swaps the axes; sharp reports pre-rotation
    // dimensions, and compositing against the wrong axis order would silently
    // squash every photo shot in portrait on a phone.
    const swapped = (meta.orientation ?? 1) >= 5;
    return swapped
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height };
  } catch {
    return undefined;
  }
}

/** Read a file, or `undefined` when it is missing/unreadable. */
export async function readFileSafe(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch {
    return undefined;
  }
}

/** True when the image carries an alpha channel — i.e. it is already a cutout. */
export async function hasAlpha(image: Buffer): Promise<boolean> {
  try {
    return (await sharp(image).metadata()).hasAlpha === true;
  } catch {
    return false;
  }
}

/**
 * Crop to a rect, clamped to the image. Used to hand QA the face region of a
 * finished render for identity verification.
 */
export async function cropTo(image: Buffer, rect: { x: number; y: number; w: number; h: number }): Promise<Buffer | undefined> {
  try {
    const meta = await sharp(image).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;
    if (iw === 0 || ih === 0) return undefined;
    const left = clampInt(rect.x, 0, iw - 1);
    const top = clampInt(rect.y, 0, ih - 1);
    const width = clampInt(rect.w, 1, iw - left);
    const height = clampInt(rect.h, 1, ih - top);
    return await sharp(image).extract({ left, top, width, height }).png().toBuffer();
  } catch {
    return undefined;
  }
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
