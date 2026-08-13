/**
 * Single-layer rendering: source → geometry → effects → mask.
 *
 * Effect order inside a layer is not arbitrary:
 *
 *   source → flip/rotate → pad → tone → duotone → tint → motion blur → blur
 *          → light wrap → rim light → stroke → outer glow → drop shadow → mask
 *
 * Reasoning: geometry first, because a rim light's angle describes the *scene*
 * — mirroring a subject after lighting it would light the wrong side. Colour
 * work next, so the rim is screened over the colours the layer will actually
 * show. Blurs before edge treatments, so the rim and stroke stay crisp on a
 * defocused subject (which is what a real defocused rim looks like: the subject
 * is soft, the specular edge is not). Then the inside-the-alpha effects (wrap,
 * rim), then the outside-the-alpha ones (stroke, glow, shadow) from tightest to
 * widest. The mask is last: it clips everything, including the halo.
 *
 * The layer is padded before any effect that bleeds outside its rect, and the
 * returned `rect` grows to match — that is why `renderLayer` hands back a rect
 * instead of assuming `layer.rect`.
 */

import {
  type Layer,
  type LayerEffects,
  type Canvas,
  type PixelRect,
  clamp,
} from '@hexa/core';
import type { RenderContext } from './types.js';
import { type RawImage, rawToSharp, encodePng, cropRaw } from './raw.js';
import { resolveSource } from './sources.js';
import { toneRaw, duotoneRaw, tintRaw, motionBlurRaw } from './effects/color.js';
import { rimLightRaw, lightWrapRaw, outerGlowRaw, dropShadowRaw, strokeAlphaRaw } from './effects/edge.js';
import { timed, timedSync } from './profile.js';

/**
 * Optional extension recognised on `LayerEffects`. @hexa/core does not (yet)
 * declare a light-wrap knob, so it is read defensively: templates can opt in
 * with `{ radius, intensity }` or opt out with `false`. When neither is present
 * a layer that asks for a rim light gets a modest automatic wrap, since the two
 * effects describe the same physical situation — a subject standing in a scene
 * that is lighting it.
 */
interface EffectsWithWrap extends LayerEffects {
  lightWrap?: { radius: number; intensity: number } | false;
}

export interface RenderedLayer {
  buffer: Buffer;
  /** Where to composite, in **render-space** px (canvas px × supersample). */
  rect: PixelRect;
}

/**
 * Does this layer's own appearance depend on what is underneath it?
 *
 * Only light wrap reads `ctx.backdrop`, and only two things ask for one: an
 * explicit `lightWrap` spec, or a `rimLight` (which implies a modest automatic
 * wrap — see `EffectsWithWrap`). Everything else is a pure function of the
 * layer, the canvas and the seed.
 *
 * That distinction is what lets `renderPlan` prepare layers ahead of their turn:
 * a layer that answers `false` here can be rendered at any time, in any order,
 * and still produce exactly the same pixels.
 */
export function layerReadsBackdrop(layer: Layer): boolean {
  const fx = layer.effects as EffectsWithWrap | undefined;
  if (!fx) return false;
  if (fx.lightWrap === false) return false;
  return Boolean(fx.lightWrap || fx.rimLight);
}

async function extendRaw(img: RawImage, pad: number): Promise<RawImage> {
  const { data, info } = await rawToSharp(img)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function flopRaw(img: RawImage): Promise<RawImage> {
  const { data, info } = await rawToSharp(img).flop().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function rotateRaw(img: RawImage, deg: number): Promise<RawImage> {
  const { data, info } = await rawToSharp(img)
    .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * The pipeline itself, kept in raw pixels. `renderPlan` uses this directly so a
 * 40-layer composite does not pay for 40 PNG encode/decode round trips.
 */
export async function renderLayerRaw(
  layer: Layer,
  canvas: Canvas,
  ctx: RenderContext,
): Promise<{ image: RawImage; rect: PixelRect } | null> {
  const ss = Math.max(1, Math.round(ctx.supersample || canvas.supersample || 1));
  const rect: PixelRect = {
    x: Math.round(layer.rect.x * ss),
    y: Math.round(layer.rect.y * ss),
    w: Math.round(layer.rect.w * ss),
    h: Math.round(layer.rect.h * ss),
  };
  if (rect.w <= 0 || rect.h <= 0) {
    ctx.logger.debug(`layer "${layer.id}" has a degenerate rect (${rect.w}×${rect.h}) — skipped`);
    return null;
  }

  let img = await timed(`source:${layer.source.type}`, rect.w * rect.h, () =>
    resolveSource(layer, { width: rect.w, height: rect.h }, ctx),
  );

  // ── geometry ──────────────────────────────────────────────────────────────
  if (layer.flipX) img = await timed('fx:flip', img.width * img.height, () => flopRaw(img));
  if (layer.rotation) {
    const before = { w: img.width, h: img.height };
    const spun = img;
    img = await timed('fx:rotate', spun.width * spun.height, () => rotateRaw(spun, layer.rotation!));
    // Rotation expands the raster; keep the layer centred on its original box.
    rect.x -= Math.round((img.width - before.w) / 2);
    rect.y -= Math.round((img.height - before.h) / 2);
    rect.w = img.width;
    rect.h = img.height;
  }

  const fx = (layer.effects ?? {}) as EffectsWithWrap;
  const px = (v: number): number => v * ss;

  // ── padding for everything that bleeds outside the silhouette ─────────────
  const pad = Math.ceil(
    Math.max(
      0,
      fx.blur ? px(fx.blur) * 2 : 0,
      fx.motionBlur ? px(fx.motionBlur.distance) / 2 : 0,
      fx.glow ? px(fx.glow.radius) * 1.5 : 0,
      fx.stroke ? px(fx.stroke.width) + 2 : 0,
      fx.shadow ? px(fx.shadow.blur) * 1.5 + Math.abs(px(fx.shadow.dx)) + Math.abs(px(fx.shadow.dy)) : 0,
    ),
  );
  if (pad > 0) {
    const src = img;
    img = await timed('fx:pad', src.width * src.height, () => extendRaw(src, pad));
    rect.x -= pad;
    rect.y -= pad;
    rect.w = img.width;
    rect.h = img.height;
  }

  // ── colour ────────────────────────────────────────────────────────────────
  {
    const src = img;
    img = timedSync('fx:tone', src.width * src.height, () =>
      toneRaw(src, {
        exposure: fx.exposure ?? 0,
        contrast: fx.contrast ?? 1,
        saturation: fx.saturation ?? 1,
      }),
    );
  }
  if (fx.duotone) {
    const src = img;
    img = timedSync('fx:duotone', src.width * src.height, () =>
      duotoneRaw(src, fx.duotone!.shadow, fx.duotone!.highlight, fx.duotone!.amount),
    );
  }
  if (fx.tint) {
    const src = img;
    img = timedSync('fx:tint', src.width * src.height, () => tintRaw(src, fx.tint!.color, fx.tint!.amount));
  }

  // ── spatial ───────────────────────────────────────────────────────────────
  if (fx.motionBlur && fx.motionBlur.distance >= 2) {
    const src = img;
    img = await timed('fx:motion-blur', src.width * src.height, () =>
      motionBlurRaw(src, fx.motionBlur!.angle, px(fx.motionBlur!.distance)),
    );
  }
  if (fx.blur && fx.blur > 0) {
    const src = img;
    const { data, info } = await timed('fx:blur', src.width * src.height, () =>
      rawToSharp(src)
        .blur(Math.max(0.3, px(fx.blur!)))
        .raw({ depth: 'uchar' })
        .toBuffer({ resolveWithObject: true }),
    );
    img = { data, width: info.width, height: info.height, channels: info.channels };
  }

  // ── edge treatment ────────────────────────────────────────────────────────
  const wrapSpec =
    fx.lightWrap === false
      ? null
      : fx.lightWrap
        ? fx.lightWrap
        : fx.rimLight
          ? { radius: Math.max(2, Math.round(rect.w * 0.012)), intensity: 0.45 }
          : null;
  if (wrapSpec && ctx.backdrop) {
    const src = img;
    const backdrop = ctx.backdrop;
    img = await timed('fx:light-wrap', src.width * src.height, () => {
      const plate = cropRaw(backdrop, rect.x, rect.y, rect.w, rect.h);
      return lightWrapRaw(src, plate, {
        radius: fx.lightWrap ? px(wrapSpec.radius) : wrapSpec.radius,
        intensity: wrapSpec.intensity,
      });
    });
  }
  if (fx.rimLight) {
    const src = img;
    img = await timed('fx:rim-light', src.width * src.height, () =>
      rimLightRaw(src, {
        angle: fx.rimLight!.angle,
        width: px(fx.rimLight!.width),
        color: fx.rimLight!.color,
        intensity: fx.rimLight!.intensity,
      }),
    );
  }
  if (fx.stroke && fx.stroke.width > 0) {
    const src = img;
    img = await timed('fx:stroke', src.width * src.height, () =>
      strokeAlphaRaw(src, { width: px(fx.stroke!.width), color: fx.stroke!.color }),
    );
  }
  if (fx.glow && fx.glow.radius > 0) {
    const src = img;
    img = await timed('fx:glow', src.width * src.height, () =>
      outerGlowRaw(src, { radius: px(fx.glow!.radius), color: fx.glow!.color, intensity: fx.glow!.intensity }),
    );
  }
  if (fx.shadow) {
    const src = img;
    img = await timed('fx:shadow', src.width * src.height, () =>
      dropShadowRaw(src, {
        dx: px(fx.shadow!.dx),
        dy: px(fx.shadow!.dy),
        blur: px(fx.shadow!.blur),
        color: fx.shadow!.color,
        opacity: fx.shadow!.opacity,
      }),
    );
  }

  // ── mask ──────────────────────────────────────────────────────────────────
  if (layer.maskLayerId) {
    if (!ctx.resolveMask) {
      ctx.logger.debug(`layer "${layer.id}" wants mask "${layer.maskLayerId}" but no resolver was supplied`);
    } else {
      const mask = await ctx.resolveMask(layer.maskLayerId, rect);
      if (mask) {
        const out = Buffer.from(img.data);
        const invert = layer.maskInvert === true;
        for (let i = 0, p = 3; i < img.width * img.height; i++, p += 4) {
          const m = mask.data[i] ?? 0;
          out[p] = Math.round((out[p]! * (invert ? 255 - m : m)) / 255);
        }
        img = { data: out, width: img.width, height: img.height, channels: 4 };
      } else {
        ctx.logger.warn(`layer "${layer.id}" references unknown mask layer "${layer.maskLayerId}"`);
      }
    }
  }

  return { image: img, rect };
}

/**
 * Render one layer to an RGBA PNG plus the rect it should be composited at.
 * The rect can be larger than `layer.rect` (rotation, glow, shadow) and can
 * have negative coordinates — the compositor clips.
 */
export async function renderLayer(layer: Layer, canvas: Canvas, ctx: RenderContext): Promise<RenderedLayer | null> {
  const rendered = await renderLayerRaw(layer, canvas, ctx);
  if (!rendered) return null;
  return { buffer: await encodePng(rendered.image), rect: rendered.rect };
}

/** Layer opacity, clamped — kept here so plan and layer agree on semantics. */
export function layerOpacity(layer: Layer): number {
  return clamp(layer.opacity ?? 1, 0, 1);
}
