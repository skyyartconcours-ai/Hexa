/**
 * Public types owned by @hexa/render. Everything describing *what* to draw
 * lives in @hexa/core (RenderPlan, Layer, GradeSpec…); this file only describes
 * *how* this renderer is driven.
 */

import type { Logger, PixelRect } from '@hexa/core';
import type { RawImage } from './raw.js';

export type { PixelRect };

export interface RenderOptions {
  /** In-memory assets addressed by `{ type: 'buffer', key }` layer sources. */
  buffers?: Record<string, Buffer>;
  format?: 'png' | 'jpeg' | 'webp' | 'avif';
  /** 1–100 for lossy formats; ignored by PNG. */
  quality?: number;
  logger?: Logger;
  /** Draw layer bounding boxes and ids over the finished frame. */
  debugOverlay?: boolean;
}

/**
 * Everything a single layer needs that is not on the layer itself.
 *
 * `backdrop` is the composite *below* the current layer and is what makes light
 * wrap possible — a layer cannot know what it is sitting on top of otherwise.
 * `resolveMask` is a callback rather than a map so `renderPlan` can render mask
 * layers lazily (and cache them) instead of pre-rendering the whole plan twice.
 */
export interface RenderContext {
  /** Plan seed; every stochastic decision in a layer derives from it. */
  seed: number;
  /** Supersampling factor currently in force. Effect radii are multiplied by
   *  it, because they are authored in output pixels. */
  supersample: number;
  buffers: Record<string, Buffer>;
  logger: Logger;
  /** Flattened composite so far, in render-space pixels. */
  backdrop?: RawImage;
  /** Alpha of another layer, already resolved into the requested rect. */
  resolveMask?: (layerId: string, rect: PixelRect) => Promise<RawImage | null>;
}

/**
 * A procedural FX source. Must be deterministic in `seed` and must return an
 * RGBA PNG of exactly `size`.
 */
export type Generator = (
  params: Record<string, unknown>,
  size: { width: number; height: number },
  seed: number,
) => Promise<Buffer>;
