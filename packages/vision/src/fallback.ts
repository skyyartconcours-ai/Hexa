/**
 * Pure-TypeScript degradation path — what @hexa/vision does when the Python
 * sidecar is not running.
 *
 * READ THIS BEFORE TRUSTING ANYTHING IN HERE.
 *
 * None of this is face recognition. `heuristicFaceLocate` is a skin-tone blob
 * finder: it answers "roughly where in this frame is there a face-shaped patch
 * of skin-plausible pixels", and it is wrong in entirely ordinary situations —
 * bare arms, wooden stage furniture, warm tungsten backlight, dark skin under
 * heavy blue grading, two players in one frame. It exists so that layout code
 * has *a* focal point to reason about instead of crashing, and so cutouts are
 * framed better than a centre crop. It cannot tell you *who* is in the picture.
 *
 * Identity verification — the product guarantee that "Peyz vs Viper" renders
 * the real Peyz and the real Viper — requires the sidecar. There is no
 * TypeScript substitute for a 512-d ArcFace embedding, and pretending otherwise
 * by shipping a weak lookalike metric would be worse than failing loudly.
 * `VisionClient.similarity()` therefore throws VISION_UNAVAILABLE rather than
 * guessing.
 *
 * Likewise `fallbackMatte` is a border-seeded chroma/luma key, not a matting
 * model. On a clean studio backdrop it is decent. On a busy stage photo it will
 * leave chunks of background attached or eat into a dark jersey.
 */

import sharp from 'sharp';
import type { AssetMetrics, FaceBox, Logger } from '@hexa/core';
import { HexaError } from '@hexa/core';
import type { DetectedFace, SegmentOptions } from './types.js';

/** Analysis resolutions. Small enough to be instant, big enough to be stable. */
const FACE_ANALYSIS_EDGE = 224;
const MATTE_ANALYSIS_EDGE = 384;
const METRIC_ANALYSIS_EDGE = 1024; // must match SHARPNESS_LONG_EDGE in pipeline.py

/**
 * Ceiling on the confidence this file will ever report. A real SCRFD detection
 * lands at 0.7–0.95; capping the heuristic well below that means any code that
 * merges or ranks detections naturally prefers sidecar results, and any
 * threshold tuned for a real detector rejects these.
 */
const MAX_HEURISTIC_CONFIDENCE = 0.4;

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  /** Multiply analysis-space coordinates by this to get source pixels. */
  scale: number;
  srcWidth: number;
  srcHeight: number;
}

/** EXIF-oriented source dimensions — cv2.imdecode auto-orients too, so the
 * sidecar and this path agree on the coordinate frame. */
async function orientedSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  let meta;
  try {
    meta = await sharp(bytes, { failOn: 'none' }).metadata();
  } catch (cause) {
    // sharp throws a plain Error for undecodable input; the CLI maps HexaError
    // codes to exit statuses and remediation hints, so never let that escape.
    throw new HexaError('IO_ERROR', `could not decode image: ${(cause as Error).message}`, {
      hint: 'Supported inputs are what libvips can decode: JPEG, PNG, WebP, AVIF, TIFF, GIF, SVG.',
      cause,
    });
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) {
    throw new HexaError('IO_ERROR', 'could not read image dimensions', {
      hint: 'The buffer may be truncated or not an image sharp can decode.',
    });
  }
  const swap = (meta.orientation ?? 1) >= 5;
  return swap ? { width: h, height: w } : { width: w, height: h };
}

async function rawRgb(bytes: Buffer, maxEdge: number): Promise<RawImage> {
  const src = await orientedSize(bytes);
  const { data, info } = await sharp(bytes, { failOn: 'none' })
    .rotate() // apply EXIF orientation
    .removeAlpha()
    // Force 3 bands: a greyscale or CMYK source would otherwise come back with
    // a different channel count and silently corrupt every `i * 3` index below.
    .toColourspace('srgb')
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    scale: src.width / info.width,
    srcWidth: src.width,
    srcHeight: src.height,
  };
}

/** BT.601 luma + chroma, matching cv2's BGR2YCrCb so both paths use one window. */
function ycbcr(r: number, g: number, b: number): [number, number, number] {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ];
}

// ---------------------------------------------------------------------------
// Binary mask helpers
// ---------------------------------------------------------------------------

function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const up = y > 0 ? mask[i - w]! : 0;
      const down = y < h - 1 ? mask[i + w]! : 0;
      const left = x > 0 ? mask[i - 1]! : 0;
      const right = x < w - 1 ? mask[i + 1]! : 0;
      out[i] = up && down && left && right ? 1 : 0;
    }
  }
  return out;
}

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) {
        out[i] = 1;
        continue;
      }
      const up = y > 0 ? mask[i - w]! : 0;
      const down = y < h - 1 ? mask[i + w]! : 0;
      const left = x > 0 ? mask[i - 1]! : 0;
      const right = x < w - 1 ? mask[i + 1]! : 0;
      out[i] = up || down || left || right ? 1 : 0;
    }
  }
  return out;
}

interface Blob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

/** 8-connected labelling with an explicit stack (recursion would blow up on a
 * full-frame blob). */
function connectedComponents(mask: Uint8Array, w: number, h: number, minCount = 12): Blob[] {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const blobs: Blob[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const blob: Blob = { minX: w, minY: h, maxX: -1, maxY: -1, count: 0 };

    while (sp > 0) {
      const idx = stack[--sp]!;
      const x = idx % w;
      const y = (idx - x) / w;
      blob.count++;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            stack[sp++] = n;
          }
        }
      }
    }
    if (blob.count >= minCount) blobs.push(blob);
  }
  return blobs;
}

/** Mask of the `mask` pixels reachable from the image border — i.e. the true
 * outside, as opposed to same-coloured pockets inside the subject. */
function floodFromBorder(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let sp = 0;
  const push = (i: number) => {
    if (mask[i] && !out[i]) {
      out[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp > 0) {
    const idx = stack[--sp]!;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Heuristic face locator
// ---------------------------------------------------------------------------

/**
 * Rough face locator: largest skin-plausible connected region, sanity-checked.
 *
 * The YCbCr window (Cb 77–127, Cr 133–173) is the classic Chai & Ngan skin
 * model. It is luma-tolerant, which is why it holds up across skin tones better
 * than an RGB rule — but it is still a *colour* rule, so anything skin-coloured
 * qualifies: hands, arms, wood, cardboard, sand, some jerseys.
 *
 * NOT A DETECTOR. Confidence is capped at 0.4 and landmarks are never
 * fabricated. Returns [] when nothing plausible is found, which callers should
 * treat as "unknown", not "no face".
 */
export async function heuristicFaceLocate(bytes: Buffer, log?: Logger): Promise<DetectedFace[]> {
  const img = await rawRgb(bytes, FACE_ANALYSIS_EDGE);
  const { data, width: w, height: h } = img;
  const px = w * h;

  const mask = new Uint8Array(px);
  for (let i = 0; i < px; i++) {
    const o = i * 3;
    const [y, cb, cr] = ycbcr(data[o]!, data[o + 1]!, data[o + 2]!);
    // y >= 40 drops crushed-black noise, which otherwise reads as skin because
    // chroma is meaningless down there.
    mask[i] = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && y >= 40 ? 1 : 0;
  }

  // Open (despeckle) then close (fill nostril/eye holes) so one face is one blob.
  let clean = dilate(erode(mask, w, h), w, h);
  clean = erode(dilate(clean, w, h), w, h);

  const blobs = connectedComponents(clean, w, h, Math.max(12, Math.round(px * 0.0015)));
  if (blobs.length === 0) {
    log?.debug('vision fallback: no skin-plausible region found');
    return [];
  }

  const ranked: Array<{ face: DetectedFace; score: number }> = [];
  for (const blob of blobs) {
    const bx = blob.minX;
    const by = blob.minY;
    const bw = blob.maxX - blob.minX + 1;
    let bh = blob.maxY - blob.minY + 1;
    const areaFrac = blob.count / px;
    const fill = blob.count / Math.max(1, bw * bh);

    // Too small to be a subject, or so large it is obviously the backdrop.
    if (areaFrac < 0.003 || areaFrac > 0.62) continue;
    // A blob with a very low fill ratio is a scattered mess, not a head.
    if (fill < 0.42) continue;

    // Face + neck + chest reads as one tall blob; the face is the top of it.
    // Anchor at the top and clamp to a head-ish aspect.
    if (bh > 1.35 * bw) bh = Math.round(1.3 * bw);
    // Very wide blobs are arms/torso/backdrop, not a head.
    if (bw > 2.0 * bh) continue;

    const aspect = bw / bh;
    if (aspect < 0.45 || aspect > 1.9) continue;

    // Confidence is compactness-driven and hard-capped; see the constant.
    const aspectScore = 1 - Math.min(1, Math.abs(aspect - 0.78) / 0.8);
    const confidence = Math.min(MAX_HEURISTIC_CONFIDENCE, 0.15 + 0.15 * fill + 0.12 * aspectScore);

    const box: FaceBox = {
      x: Math.round(bx * img.scale),
      y: Math.round(by * img.scale),
      w: Math.round(bw * img.scale),
      h: Math.round(bh * img.scale),
      confidence: Number(confidence.toFixed(3)),
    };
    // Rank by "biggest, most compact, most head-shaped".
    ranked.push({ face: { box }, score: areaFrac * fill * (0.5 + 0.5 * aspectScore) });
  }

  ranked.sort((a, b) => b.score - a.score);
  // Multi-face separation is beyond a colour rule; report the best few only.
  return ranked.slice(0, 3).map((r) => r.face);
}

// ---------------------------------------------------------------------------
// Bust framing without landmarks
// ---------------------------------------------------------------------------

/**
 * Head-and-shoulders rect derived from a face box alone.
 *
 * The sidecar does this properly from landmarks (see `bust_rect` in
 * pipeline.py). Without landmarks we only know a box, so we assume the box is
 * the face and that crown-to-chin is ~1.45× the box height — true enough for a
 * frontal detection, increasingly wrong as the head turns.
 */
export function bustRectFromBox(box: FaceBox, srcW: number, srcH: number, shoulderRatio = 1.9) {
  const headH = box.h * 1.45;
  const cx = box.x + box.w / 2;
  // Crown sits ~0.30 head-heights above the top of the face box.
  const crownY = box.y - 0.3 * headH;
  const bottomY = crownY + (shoulderRatio + 0.18) * headH;
  const width = 2.05 * headH;

  const x = Math.max(0, Math.round(cx - width / 2));
  const y = Math.max(0, Math.round(crownY));
  const right = Math.min(srcW, Math.round(cx + width / 2));
  const bottom = Math.min(srcH, Math.round(bottomY));
  return { left: x, top: y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

// ---------------------------------------------------------------------------
// Fallback matte
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Border-seeded chroma/luma key with edge feathering.
 *
 * Samples the frame border for a background estimate, marks every pixel close
 * to it in luma+chroma, keeps only the part of that mask connected to the
 * border (so a jersey the same colour as the backdrop is not punched out), then
 * chokes and feathers the edge.
 *
 * This is the "good enough to keep working" path, not a matting model: it has
 * no notion of hair, no trimap, and no idea what a person is.
 */
export async function fallbackMatte(bytes: Buffer, opts: SegmentOptions = {}, log?: Logger): Promise<Buffer> {
  let source = bytes;

  if (opts.bust) {
    const faces = await heuristicFaceLocate(source, log);
    const primary = faces[0];
    if (primary) {
      const size = await orientedSize(source);
      const rect = bustRectFromBox(primary.box, size.width, size.height);
      log?.debug('vision fallback: bust crop from heuristic box (approximate)', rect);
      source = await sharp(source, { failOn: 'none' }).rotate().extract(rect).png().toBuffer();
    } else {
      log?.warn('vision fallback: bust requested but no face located — segmenting the full frame');
    }
  }

  const size = await orientedSize(source);
  const { width: W, height: H } = size;

  // If the caller handed us something that is already cut out, respect it.
  const existing = await existingAlpha(source);
  const alphaFull = existing ?? (await keyAlpha(source, log));

  const feather = opts.feather !== undefined ? opts.feather : defaultFeather(Math.max(W, H));
  let alphaImg = sharp(alphaFull.data, {
    raw: { width: alphaFull.width, height: alphaFull.height, channels: 1 },
  }).resize(W, H, { fit: 'fill', kernel: 'cubic' });
  // sharp's blur has a 0.3 floor; below that the request is a no-op anyway.
  if (feather >= 0.3) alphaImg = alphaImg.blur(feather);
  // Without this the pipeline hands back a 3-band sRGB copy of the mask and
  // joinChannel would read RGB triplets as alpha.
  const alphaResized = await alphaImg.toColourspace('b-w').raw().toBuffer();
  if (alphaResized.length !== W * H) {
    throw new HexaError('RENDER_FAILED', `fallback matte produced ${alphaResized.length} alpha bytes, expected ${W * H}`);
  }

  const rgb = await sharp(source, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer();

  return sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(alphaResized, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
}

function defaultFeather(longEdge: number): number {
  // ~1px of softness at 1000px wide, clamped so tiny thumbnails do not turn to
  // mush and huge plates still get a visible edge transition.
  return Math.min(2.5, Math.max(0.6, longEdge / 1000));
}

/** Reuse a real alpha channel if the input already has one. */
async function existingAlpha(bytes: Buffer): Promise<{ data: Buffer; width: number; height: number } | null> {
  const meta = await sharp(bytes, { failOn: 'none' }).metadata();
  if (!meta.hasAlpha) return null;
  try {
    const stats = await sharp(bytes, { failOn: 'none' }).stats();
    const alphaChannel = stats.channels[stats.channels.length - 1];
    if (!alphaChannel || alphaChannel.min > 250) return null; // fully opaque — nothing to reuse
  } catch {
    return null;
  }
  const { data, info } = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .ensureAlpha()
    .extractChannel(3)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function keyAlpha(bytes: Buffer, log?: Logger): Promise<{ data: Buffer; width: number; height: number }> {
  const img = await rawRgb(bytes, MATTE_ANALYSIS_EDGE);
  const { data, width: w, height: h } = img;
  const px = w * h;

  // Background estimate: median of a 2px border band, in YCbCr.
  const bandY: number[] = [];
  const bandCb: number[] = [];
  const bandCr: number[] = [];
  const sample = (x: number, y: number) => {
    const o = (y * w + x) * 3;
    const [Y, Cb, Cr] = ycbcr(data[o]!, data[o + 1]!, data[o + 2]!);
    bandY.push(Y);
    bandCb.push(Cb);
    bandCr.push(Cr);
  };
  for (let x = 0; x < w; x++) {
    sample(x, 0);
    sample(x, h - 1);
    if (h > 3) {
      sample(x, 1);
      sample(x, h - 2);
    }
  }
  for (let y = 0; y < h; y++) {
    sample(0, y);
    sample(w - 1, y);
  }
  const bgY = median(bandY);
  const bgCb = median(bandCb);
  const bgCr = median(bandCr);

  // How uniform is that border? A busy stage background makes this key useless
  // and the caller deserves to know why the cutout looks bad.
  const spread = median(bandY.map((v) => Math.abs(v - bgY)));
  if (spread > 28) {
    log?.warn(
      'vision fallback: background is not uniform (border luma spread ' +
        `${spread.toFixed(0)}/255) — the chroma key will be rough. Run services/vision/run.sh for real segmentation.`,
    );
  }

  const NEAR = 0.1; // fully background below this distance
  const FAR = 0.22; // fully foreground above it
  const bgLike = new Uint8Array(px);
  const dist = new Float32Array(px);
  for (let i = 0; i < px; i++) {
    const o = i * 3;
    const [Y, Cb, Cr] = ycbcr(data[o]!, data[o + 1]!, data[o + 2]!);
    const dY = Math.abs(Y - bgY) / 255;
    const dC = Math.hypot(Cb - bgCb, Cr - bgCr) / 181;
    const d = Math.min(1, 0.35 * dY + 0.65 * dC);
    dist[i] = d;
    bgLike[i] = d < FAR ? 1 : 0;
  }

  // Only border-connected background is really background.
  const outside = floodFromBorder(bgLike, w, h);

  const alpha = new Uint8Array(px);
  for (let i = 0; i < px; i++) {
    if (!outside[i]) {
      alpha[i] = 255;
      continue;
    }
    const d = dist[i]!;
    // Ramp inside the transition band so the choke below has something to bite.
    const t = (d - NEAR) / (FAR - NEAR);
    alpha[i] = Math.round(255 * Math.max(0, Math.min(1, t)));
  }

  // Choke by one pixel: a hard key always leaves a rim of background colour,
  // and pulling in beats haloing once the edge is feathered.
  const solid = new Uint8Array(px);
  for (let i = 0; i < px; i++) solid[i] = alpha[i]! > 200 ? 1 : 0;
  const choked = erode(solid, w, h);
  for (let i = 0; i < px; i++) {
    if (solid[i] && !choked[i]) alpha[i] = Math.min(alpha[i]!, 170);
  }

  return { data: Buffer.from(alpha), width: w, height: h };
}

// ---------------------------------------------------------------------------
// Fallback metrics
// ---------------------------------------------------------------------------

/**
 * Metrics computable without any model. Sharpness/brightness/contrast/palette
 * are honest numbers — the same formulas the sidecar uses, on the same
 * long-edge-normalised copy, so scores are comparable either way.
 *
 * Head pose and occlusion are simply absent: they need landmarks. faceBox and
 * faceArea come from the heuristic locator and inherit all of its caveats.
 */
export async function fallbackMetrics(bytes: Buffer, log?: Logger): Promise<Partial<AssetMetrics>> {
  const src = await orientedSize(bytes);
  const img = await rawRgb(bytes, METRIC_ANALYSIS_EDGE);
  const { data, width: w, height: h } = img;
  const px = w * h;

  const luma = new Float32Array(px);
  let sum = 0;
  for (let i = 0; i < px; i++) {
    const o = i * 3;
    const y = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
    luma[i] = y;
    sum += y;
  }
  const mean = sum / px;
  let varSum = 0;
  for (let i = 0; i < px; i++) {
    const d = luma[i]! - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / px);

  // Variance of the 4-neighbour Laplacian — identical kernel to cv2.Laplacian
  // with ksize=1, so "<40 is soft" means the same thing on both paths.
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = luma[i - w]! + luma[i + w]! + luma[i - 1]! + luma[i + 1]! - 4 * luma[i]!;
      lapSum += v;
      lapSqSum += v * v;
      lapCount++;
    }
  }
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const sharpness = lapCount ? lapSqSum / lapCount - lapMean * lapMean : 0;

  const out: Partial<AssetMetrics> = {
    width: src.width,
    height: src.height,
    sharpness: Number(sharpness.toFixed(3)),
    brightness: Number(mean.toFixed(3)),
    contrast: Number((std / 255).toFixed(5)),
    palette: await dominantColours(bytes),
  };

  const faces = await heuristicFaceLocate(bytes, log);
  const primary = faces[0];
  if (primary) {
    out.faceBox = primary.box;
    out.faceArea = Number((((primary.box.w * primary.box.h) / (src.width * src.height)) || 0).toFixed(6));
  }
  return out;
}

/** Dominant colours by coarse RGB bucketing — cheap stand-in for k-means. */
async function dominantColours(bytes: Buffer, count = 5): Promise<string[]> {
  const { data, info } = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const o = i * 3;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    // 5 bits per channel: coarse enough to merge gradients, fine enough to keep
    // a team's red and orange apart.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = buckets.get(key);
    if (hit) {
      hit.n++;
      hit.r += r;
      hit.g += g;
      hit.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map(({ n, r, g, b }) => hex(r / n, g / n, b / n));
}

function hex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
