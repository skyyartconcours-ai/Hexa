/**
 * The compositor: `RenderPlan` → finished frame.
 *
 * Pipeline:
 *   canvas fill → layers by z ascending (each: render → mask → blend) →
 *   Lanczos downsample → colour grade → debug overlay → encode
 *
 * Two decisions worth calling out.
 *
 * **Progressive compositing, with a small lookahead.** Layers are composited one
 * at a time into a single raw accumulator and released immediately, so peak
 * memory is bounded by the accumulator plus the handful of layers in flight —
 * not by the layer count. A 40-layer plan would need ~1.3 GB if every layer were
 * decoded up front.
 *
 * The lookahead is what keeps four cores busy. Compositing must stay strictly
 * sequential in z (that is what compositing *means*), but *preparing* a layer —
 * decoding its source, running its effect stack — is a pure function of the
 * layer, the canvas and the seed for every layer that does not read the
 * backdrop, which is all of them except light wrap. Those are started up to
 * `LOOKAHEAD` positions early, so a libvips blur on one layer overlaps the
 * JavaScript effect loop of another instead of idling behind it. Order,
 * seeding and therefore output bytes are unchanged: the same plan renders
 * byte-identically with the lookahead set to 1.
 *
 * **Downsample before grade.** Supersampling exists to kill *geometric*
 * aliasing — cutout edges, hairlines, rotated text — so it is resolved as soon
 * as the geometry is final. The grade is resolution-referred: grain size,
 * vignette feather, aberration displacement and letterbox bars are all authored
 * in output pixels, and grain in particular would be averaged away by a
 * downsample that ran after it.
 */

import {
  HexaError,
  log,
  clamp,
  type RenderPlan,
  type RenderResult,
  type PixelRect,
} from '@hexa/core';
import type { RenderOptions, RenderContext } from './types.js';
import { type RawImage, solidRaw, rawToSharp, scaleAlpha } from './raw.js';
import { renderLayerRaw, layerOpacity, layerReadsBackdrop } from './layer.js';
import { compositeLayer } from './blend.js';
import { applyGradeRaw } from './grade.js';
import { exportRaw, debugOverlaySvg } from './export.js';
import { timed } from './profile.js';

export async function renderPlan(plan: RenderPlan, opts: RenderOptions = {}): Promise<RenderResult> {
  const started = performance.now();
  const timings: Record<string, number> = {};
  const logger = opts.logger ?? log.child('render');
  const canvas = plan.canvas;

  const W = Math.round(canvas.width);
  const H = Math.round(canvas.height);
  if (!(W > 0) || !(H > 0)) {
    throw new HexaError('INVALID_REQUEST', `canvas must have positive dimensions, got ${canvas.width}×${canvas.height}`);
  }
  const requested = Math.round(canvas.supersample ?? 1);
  const ss = clamp(requested || 1, 1, 4);
  if (requested > 4) logger.warn(`supersample ${requested}× clamped to 4× (memory)`);
  const RW = W * ss;
  const RH = H * ss;

  const t0 = performance.now();
  let acc: RawImage = solidRaw(RW, RH, canvas.background);
  const byId = new Map(plan.layers.map((l) => [l.id, l]));
  const maskCache = new Map<string, Promise<{ image: RawImage; rect: PixelRect } | null>>();
  const resolving = new Set<string>();

  const ctx: RenderContext = {
    seed: plan.seed,
    supersample: ss,
    buffers: opts.buffers ?? {},
    logger,
    resolveMask: async (layerId: string, rect: PixelRect): Promise<RawImage | null> => {
      const layer = byId.get(layerId);
      if (!layer) return null;
      if (resolving.has(layerId)) {
        logger.warn(`mask cycle detected via layer "${layerId}" — mask ignored`);
        return null;
      }
      // Cache the *promise*, not the result: with layers preparing concurrently
      // two of them can ask for the same mask at once, and a value cache would
      // render it twice.
      let pending = maskCache.get(layerId);
      if (pending === undefined) {
        resolving.add(layerId);
        // Mask renders never see a backdrop: a mask is a stencil, and light
        // wrapping a stencil would be meaningless.
        pending = renderLayerRaw(layer, canvas, { ...ctx, backdrop: undefined }).finally(() => {
          resolving.delete(layerId);
        });
        pending.catch(() => {}); // failure surfaces at the await below
        maskCache.set(layerId, pending);
      }
      const entry = await pending;
      if (!entry) return null;
      const out = Buffer.alloc(rect.w * rect.h, 0);
      for (let y = 0; y < rect.h; y++) {
        const sy = rect.y + y - entry.rect.y;
        if (sy < 0 || sy >= entry.image.height) continue;
        for (let x = 0; x < rect.w; x++) {
          const sx = rect.x + x - entry.rect.x;
          if (sx < 0 || sx >= entry.image.width) continue;
          out[y * rect.w + x] = entry.image.data[(sy * entry.image.width + sx) * 4 + 3]!;
        }
      }
      return { data: out, width: rect.w, height: rect.h, channels: 1 };
    },
  };
  timings.setup = performance.now() - t0;

  // Stable sort by z: equal-z layers keep their authored order.
  const ordered = [...plan.layers].sort((a, b) => a.z - b.z);
  const boxes: { id: string; rect: PixelRect; z: number }[] = [];

  // Layers whose pixels do not depend on the composite below them are started
  // early. The window is small on purpose: it exists to keep libvips and the
  // JavaScript effect loops overlapping, and every extra slot is another decoded
  // layer held in memory.
  const prepared = new Map<number, Promise<{ image: RawImage; rect: PixelRect } | null>>();
  const prefetch = (index: number): void => {
    const layer = ordered[index];
    if (!layer || prepared.has(index) || layerReadsBackdrop(layer)) return;
    const task = renderLayerRaw(layer, canvas, { ...ctx, backdrop: undefined });
    task.catch(() => {}); // failure surfaces where the layer is awaited
    prepared.set(index, task);
  };

  const tLayers = performance.now();
  for (let index = 0; index < ordered.length; index++) {
    const layer = ordered[index]!;
    for (let ahead = index; ahead < Math.min(ordered.length, index + LOOKAHEAD); ahead++) prefetch(ahead);

    const t = performance.now();
    let rendered: { image: RawImage; rect: PixelRect } | null;
    const early = prepared.get(index);
    if (early) {
      prepared.delete(index);
      rendered = await early;
    } else {
      ctx.backdrop = acc;
      rendered = await renderLayerRaw(layer, canvas, ctx);
    }
    if (!rendered) continue;
    boxes.push({ id: layer.id, rect: rendered.rect, z: layer.z });

    const opacity = layerOpacity(layer);
    if (opacity <= 0) {
      logger.debug(`layer "${layer.id}" has zero opacity — rendered for masking only`);
      continue;
    }
    const image = opacity < 1 ? scaleAlpha(rendered.image, opacity) : rendered.image;
    acc = await compositeLayer(acc, image, rendered.rect.x, rendered.rect.y, layer.blend, logger);
    timings[`layer:${layer.id}`] = performance.now() - t;
  }
  ctx.backdrop = undefined;
  timings.layers = performance.now() - tLayers;

  if (ss > 1) {
    const t = performance.now();
    const full = acc;
    const { data, info } = await timed('downsample', full.width * full.height, () =>
      rawToSharp(full)
        .resize(W, H, { kernel: 'lanczos3', fit: 'fill' })
        .raw({ depth: 'uchar' })
        .toBuffer({ resolveWithObject: true }),
    );
    acc = { data, width: info.width, height: info.height, channels: info.channels };
    timings.downsample = performance.now() - t;
  }

  const tGrade = performance.now();
  acc = await applyGradeRaw(acc, plan.grade ?? {}, canvas, plan.seed);
  timings.grade = performance.now() - tGrade;

  if (opts.debugOverlay) {
    const t = performance.now();
    const svg = debugOverlaySvg(
      W,
      H,
      boxes.map((b) => ({
        id: b.id,
        z: b.z,
        rect: { x: b.rect.x / ss, y: b.rect.y / ss, w: b.rect.w / ss, h: b.rect.h / ss },
      })),
    );
    const { data, info } = await rawToSharp(acc)
      .composite([{ input: Buffer.from(svg), left: 0, top: 0, blend: 'over' }])
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });
    acc = { data, width: info.width, height: info.height, channels: info.channels };
    timings.overlay = performance.now() - t;
  }

  const tExport = performance.now();
  const format = opts.format ?? 'png';
  const encoded = acc;
  const buffer = await timed(`export:${format}`, encoded.width * encoded.height, () =>
    exportRaw(encoded, format, opts.quality),
  );
  timings.export = performance.now() - tExport;
  timings.total = performance.now() - started;

  logger.debug(
    `rendered ${W}×${H} @${ss}× · ${ordered.length} layers · ${timings.total.toFixed(0)}ms`,
    { format, bytes: buffer.length },
  );

  return { buffer, width: W, height: H, format, timings, plan };
}
