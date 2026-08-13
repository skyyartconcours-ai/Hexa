/**
 * Alpha bounds — where does a cutout actually live inside its canvas?
 *
 * Used by the compositor to decide whether an asset is a full-bleed photograph
 * or a transparent cutout (which changes the fit mode), by the debug overlay,
 * and by callers that want to tighten a slot around a subject.
 */

/**
 * Tight bounding box of pixels whose alpha exceeds `threshold`.
 *
 * @param rgba   interleaved 8-bit RGBA, `width * height * 4` bytes
 * @returns null when the image is fully transparent
 */
export function alphaBounds(
  rgba: Buffer,
  width: number,
  height: number,
  threshold = 8,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    let rowHit = false;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        rowHit = true;
      }
    }
    if (rowHit) {
      if (y < minY) minY = y;
      maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
