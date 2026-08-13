/**
 * Text → SVG.
 *
 * Paint order is the whole ballgame in esports typography, and it is fixed:
 *
 *   plate → [ extrusion → stroke → fill ] → glow
 *
 * The bracketed group is what casts the drop shadow, so the slab and its
 * outline throw one shadow together rather than three overlapping ones. The
 * glow comes last but is knocked out in the middle (see `glowFilter`), so it
 * reads as a halo around the lockup instead of a haze over it.
 */

import { HexaError, anchorOffset, shade } from '@hexa/core';
import type { LayoutTextInput, LaidOutText, TextStyle } from './types.js';
import { createIdScope, canonical, type IdScope } from './ids.js';
import { attrs, escapeXml, n, svgDocument, skewAbout } from './xml.js';
import { fontStack } from './fonts.js';
import { resolveFill, shadowFilter, glowFilter, fade, type Box } from './paint.js';
import { measureLine, blockMetrics, wrapText, applyCase, normaliseLine, type BlockMetrics } from './measure.js';

/** Hard ceiling on extrusion copies — a runaway depth must not emit 10 000 nodes. */
const MAX_EXTRUDE_STEPS = 96;

interface Positioned {
  text: string;
  x: number;
  baseline: number;
  width: number;
}

/** How far decoration pushes past the glyph ink, per side. */
interface Overhang {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far the *hard* ink — plate, extrusion slab, outline, glyph faces — pushes
 * past the glyph advance box, per side.
 *
 * Everything counted here has a crisp edge, so anything left out of it gets
 * visibly chopped at the document boundary. `shadow` and `glow` are deliberately
 * *not* counted: they are soft, they are meant to fade into the frame, and
 * reserving room for a 26 px blur inside a 76 px nameplate would shrink the type
 * to nothing. They are kept off the fitted bounds and instead given room inside
 * their own filter region (see `paintBlock`).
 */
function decorationOverhang(style: TextStyle, blockH: number): Overhang {
  const half = style.stroke ? Math.max(0, style.stroke.width) / 2 : 0;
  let left = half;
  let right = half;
  let top = half;
  let bottom = half;

  if (style.extrude && style.extrude.depth > 0) {
    const rad = (style.extrude.angle * Math.PI) / 180;
    const ex = style.extrude.depth * Math.cos(rad);
    const ey = style.extrude.depth * Math.sin(rad);
    // Extrusion runs one way only, so it widens exactly one side per axis.
    right += Math.max(0, ex);
    left += Math.max(0, -ex);
    bottom += Math.max(0, ey);
    top += Math.max(0, -ey);
  }

  if (style.plate) {
    left += Math.max(0, style.plate.padX);
    right += Math.max(0, style.plate.padX);
    top += Math.max(0, style.plate.padY);
    bottom += Math.max(0, style.plate.padY);
  }

  // Skew shears the block horizontally about its vertical centre.
  const skew = Math.abs(style.skewX ?? 0) + Math.abs(style.plate?.skewX ?? 0);
  if (skew > 0) {
    const shear = Math.tan((Math.min(skew, 60) * Math.PI) / 180) * ((blockH + top + bottom) / 2);
    left += shear;
    right += shear;
  }

  // An oblique face leans right above the baseline and left below it, so the
  // ink escapes the advance box on *both* sides, not just one.
  if (style.italic) {
    const lean = blockH * 0.06;
    left += lean;
    right += lean;
  }

  // Jitter displaces each glyph by up to `offset` on both axes and spins it
  // about its own centre; neither shows up in the advance width.
  if (style.jitter && (style.jitter.offset || style.jitter.rotate)) {
    const offset = Math.max(0, style.jitter.offset ?? 0);
    const rotate = Math.min(45, Math.abs(style.jitter.rotate ?? 0));
    // A glyph box no larger than (size × blockH) spun by `rotate` about its
    // centre reaches at most half its diagonal further out.
    const spin = rotate > 0 ? Math.sin((rotate * Math.PI) / 180) * (style.size + blockH) * 0.5 : 0;
    const reach = offset + spin;
    left += reach;
    right += reach;
    top += reach;
    bottom += reach;
  }

  return { left, right, top, bottom };
}

function textAttrs(style: TextStyle, size: number): Record<string, string | number | undefined> {
  return {
    'font-family': fontStack(style.family),
    'font-size': size,
    'font-weight': style.weight ?? 400,
    'font-style': style.italic ? 'italic' : undefined,
    'letter-spacing': style.tracking ? style.tracking * size : undefined,
    'text-anchor': 'start',
    'dominant-baseline': 'alphabetic',
  };
}

/** mulberry32, inlined so jitter stays a pure function of the seed. */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Emit one full pass over every line — used identically for the extrusion
 * copies, the stroke and the fill, so the three always register perfectly.
 */
function emitRun(
  lines: Positioned[],
  style: TextStyle,
  size: number,
  paint: Record<string, string | number | undefined>,
  dx: number,
  dy: number,
): string {
  const common = { ...textAttrs(style, size), ...paint };
  const jitter = style.jitter;

  if (!jitter || (!jitter.rotate && !jitter.offset)) {
    return lines
      .filter((l) => l.text.length > 0)
      .map((l) => `<text${attrs({ ...common, x: l.x + dx, y: l.baseline + dy })}>${escapeXml(l.text)}</text>`)
      .join('');
  }

  // Per-character jitter: each glyph becomes its own <text> so it can carry a
  // rotation about its own centre. Deterministic — same seed, same scatter.
  const rotate = jitter.rotate ?? 0;
  const offset = jitter.offset ?? 0;
  const out: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    if (!line.text) continue;
    const chars = [...line.text];
    const rand = rngFrom((jitter.seed ?? hash(line.text)) + li * 7919);
    let cursor = line.x;
    for (const ch of chars) {
      const w = measureLine(ch, { ...style, size, case: 'none' });
      if (ch !== ' ') {
        const r = (rand() * 2 - 1) * rotate;
        const ox = (rand() * 2 - 1) * offset;
        const oy = (rand() * 2 - 1) * offset;
        const cx = cursor + w / 2;
        const cy = line.baseline - size * 0.35;
        const transform = r ? `rotate(${n(r)},${n(cx)},${n(cy)})` : undefined;
        out.push(
          `<text${attrs({ ...common, x: cursor + dx + ox, y: line.baseline + dy + oy, transform })}>` +
          `${escapeXml(ch)}</text>`,
        );
      }
      cursor += w + (style.tracking ?? 0) * size;
    }
  }
  return out.join('');
}

function emitPlates(lines: Positioned[], style: TextStyle, metrics: BlockMetrics): string {
  const p = style.plate;
  if (!p) return '';
  const out: string[] = [];
  for (const line of lines) {
    if (!line.text) continue;
    const x = line.x - p.padX;
    const y = line.baseline - metrics.ascent - p.padY;
    const w = line.width + p.padX * 2;
    const h = metrics.ascent + metrics.descent + p.padY * 2;
    const rect = `<rect${attrs({
      x, y, width: w, height: h,
      rx: p.radius ?? undefined, ry: p.radius ?? undefined,
      fill: p.color,
      opacity: p.opacity !== undefined && p.opacity < 1 ? p.opacity : undefined,
    })}/>`;
    const skew = p.skewX ? skewAbout(p.skewX, x + w / 2, y + h / 2) : '';
    out.push(skew ? `<g${attrs({ transform: skew })}>${rect}</g>` : rect);
  }
  return out.join('');
}

function emitExtrusion(lines: Positioned[], style: TextStyle, size: number, strokeW: number): string {
  const e = style.extrude;
  if (!e || e.depth <= 0) return '';
  const steps = Math.max(1, Math.min(MAX_EXTRUDE_STEPS, Math.round(e.depth)));
  const rad = (e.angle * Math.PI) / 180;
  const stepX = (e.depth * Math.cos(rad)) / steps;
  const stepY = (e.depth * Math.sin(rad)) / steps;
  const fadeAmt = Math.max(0, Math.min(1, e.fade ?? 0));

  const out: string[] = [];
  // Farthest copy first so nearer slices paint over it.
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    const color = fadeAmt > 0 ? shadeSafe(e.color, -0.28 * fadeAmt * t) : e.color;
    const alpha = 1 - 0.5 * fadeAmt * t;
    out.push(
      emitRun(
        lines, style, size,
        {
          fill: alpha < 1 ? fade(color, alpha) : color,
          // Carrying the stroke through keeps the slab flush with the outlined
          // face instead of leaving a hairline gap along the extrusion edge.
          stroke: strokeW > 0 ? (alpha < 1 ? fade(color, alpha) : color) : undefined,
          'stroke-width': strokeW > 0 ? strokeW : undefined,
          'stroke-linejoin': strokeW > 0 ? (style.stroke?.join ?? 'round') : undefined,
        },
        stepX * i, stepY * i,
      ),
    );
  }
  return out.join('');
}

function shadeSafe(color: string, amount: number): string {
  try {
    return shade(color, amount);
  } catch {
    return color;
  }
}

function validate(input: LayoutTextInput): void {
  if (!input || !input.block) {
    throw new HexaError('INVALID_REQUEST', 'renderText requires { block, box }');
  }
  const { box } = input;
  if (!box || !Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0) {
    throw new HexaError('INVALID_REQUEST', 'renderText requires a box with positive width and height', {
      details: { box },
    });
  }
}

/**
 * Lay out and draw one text block.
 *
 * Returns a standalone SVG document of exactly `box.w × box.h`, plus the
 * measured content bounds. Those bounds *include* every hard-edged part of the
 * treatment — stroke, extrusion, plate padding, skew shear, jitter scatter —
 * and they are what `autoFit` tests against the box, so a fitted headline never
 * has its outline clipped.
 *
 * They exclude `shadow` and `glow`, which are soft by construction and bleed
 * past the document edge on purpose; reserving room for a 26 px blur inside a
 * 76 px nameplate would leave nothing to read. See `decorationOverhang`.
 */
export function renderText(input: LayoutTextInput): LaidOutText {
  validate(input);
  const { block, box } = input;
  const style = block.style;
  if (!Number.isFinite(style?.size) || style.size <= 0) {
    throw new HexaError('INVALID_REQUEST', `TextStyle.size must be a positive number, got ${String(style?.size)}`);
  }

  const size = style.size;
  const align = block.align ?? 'left';
  const anchor = input.anchor ?? 'top-left';
  const measureStyle: TextStyle = { ...style, case: 'none' };

  // 1. Break into lines against the width left over after decoration.
  const probeOver = decorationOverhang(style, size);
  const avail = Math.max(1, box.w - probeOver.left - probeOver.right);
  const cased = applyCase(block.text ?? '', style.case);
  const lines =
    input.wrap === false
      ? capLines(cased.split('\n').map(normaliseLine), measureStyle, avail, input.maxLines)
      : wrapText(cased, measureStyle, avail, input.maxLines);

  // 2. Vertical metrics, then the real overhang now that the height is known.
  const metrics = blockMetrics(lines, style);
  const widths = lines.map((l) => measureLine(l, measureStyle));
  const inkW = widths.reduce((a, b) => Math.max(a, b), 0);
  const over = decorationOverhang(style, metrics.height);

  const contentW = inkW + over.left + over.right;
  const contentH = metrics.height + over.top + over.bottom;

  // 3. Anchor the content inside the box.
  const off = anchorOffset(anchor, box.w, box.h, contentW, contentH);
  const inkX = off.x + over.left;
  const inkY = off.y + over.top;

  const positioned: Positioned[] = lines.map((text, i) => {
    const w = widths[i] ?? 0;
    const x = align === 'center' ? inkX + (inkW - w) / 2 : align === 'right' ? inkX + (inkW - w) : inkX;
    return { text, x, baseline: inkY + metrics.ascent + i * metrics.lineAdvance, width: w };
  });

  // 4. Paint.
  const scope = createIdScope(
    canonical({ text: block.text, align, anchor, box, style, wrap: input.wrap, maxLines: input.maxLines }),
  );
  const inkBox: Box = { x: inkX, y: inkY, w: Math.max(1, inkW), h: Math.max(1, metrics.height) };
  // A filter region is a hard clip on everything the filter emits, including the
  // `SourceGraphic` it merges back in. Sizing it to the bare glyph box therefore
  // guillotines the outline, the extrusion slab and the jitter — so filters get
  // the decorated box, while the gradient still spans the glyphs themselves.
  const decoratedBox: Box = {
    x: inkBox.x - over.left,
    y: inkBox.y - over.top,
    w: Math.max(1, inkBox.w + over.left + over.right),
    h: Math.max(1, inkBox.h + over.top + over.bottom),
  };
  const body = paintBlock(scope, positioned, style, size, metrics, inkBox, decoratedBox);

  const skew = style.skewX ? skewAbout(style.skewX, inkX + inkW / 2, inkY + metrics.height / 2) : '';
  const inner = skew ? `<g${attrs({ transform: skew })}>${body}</g>` : body;
  const opacity = style.opacity !== undefined && style.opacity < 1 ? style.opacity : undefined;
  const wrapped = opacity !== undefined ? `<g${attrs({ opacity })}>${inner}</g>` : inner;

  return {
    markup: svgDocument(box.w, box.h, scope.defs() + wrapped),
    width: contentW,
    height: contentH,
    lines,
    fontSize: size,
    box: { ...box },
  };
}

/** Apply `maxLines` (with ellipsis) to pre-split, non-wrapped lines. */
function capLines(lines: string[], style: TextStyle, maxWidth: number, maxLines?: number): string[] {
  if (maxLines === undefined || !Number.isFinite(maxLines) || maxLines < 1 || lines.length <= maxLines) {
    return lines.length ? lines : [''];
  }
  const kept = lines.slice(0, Math.floor(maxLines));
  const last = kept[kept.length - 1] ?? '';
  // Reuse the wrapper's own truncation so the ellipsis rules stay in one place.
  const truncated = wrapText(`${last}…`, style, maxWidth, 1);
  kept[kept.length - 1] = truncated[0] ?? last;
  return kept;
}

function paintBlock(
  scope: IdScope,
  lines: Positioned[],
  style: TextStyle,
  size: number,
  metrics: BlockMetrics,
  inkBox: Box,
  /** `inkBox` grown by the decoration — the extent filters must not clip. */
  decoratedBox: Box = inkBox,
): string {
  const strokeW = style.stroke ? Math.max(0, style.stroke.width) : 0;
  const fill = resolveFill(scope, style.fill, inkBox);

  const plate = emitPlates(lines, style, metrics);
  const extrusion = emitExtrusion(lines, style, size, strokeW);

  const stroke = strokeW > 0
    ? emitRun(lines, style, size, {
        fill: 'none',
        stroke: style.stroke!.color,
        'stroke-width': strokeW,
        'stroke-linejoin': style.stroke!.join ?? 'round',
        'stroke-linecap': 'round',
      }, 0, 0)
    : '';

  const face = emitRun(lines, style, size, { fill }, 0, 0);

  // The slab + outline + face cast one shadow together.
  let lockup = extrusion + stroke + face;
  if (style.shadow) {
    const filterId = shadowFilter(scope, style.shadow, decoratedBox);
    lockup = `<g${attrs({ filter: `url(#${filterId})` })}>${lockup}</g>`;
  }

  let glow = '';
  if (style.glow && style.glow.radius > 0 && style.glow.intensity > 0) {
    const filterId = glowFilter(scope, style.glow, decoratedBox);
    // Glow source is the silhouette including the outline, so the halo hugs
    // the outer edge of the lockup rather than the bare glyphs.
    const silhouette = strokeW > 0
      ? emitRun(lines, style, size, {
          fill: style.glow.color,
          stroke: style.glow.color,
          'stroke-width': strokeW,
          'stroke-linejoin': style.stroke?.join ?? 'round',
        }, 0, 0)
      : emitRun(lines, style, size, { fill: style.glow.color }, 0, 0);
    glow = `<g${attrs({ filter: `url(#${filterId})` })}>${silhouette}</g>`;
  }

  return plate + lockup + glow;
}

// ── autoFit ──────────────────────────────────────────────────────────────────

/**
 * Scale a style to a new size, carrying its decoration with it.
 *
 * Stroke width, extrusion depth, plate padding, shadow offset and glow radius
 * are all absolute pixels, so leaving them fixed while the size changes
 * silently redesigns the type: a 6 px outline is a crisp edge on a 500 px
 * headline and a solid blob on a 20 px one. Scaling them preserves the
 * designer's *proportions*, and it is also what makes the no-overflow
 * guarantee reachable — with a fixed stroke, content width has a hard floor of
 * the stroke width itself, so a small enough box could never be satisfied.
 */
function scaleStyle(style: TextStyle, size: number): TextStyle {
  const k = style.size > 0 ? size / style.size : 1;
  if (k === 1) return style;
  const out: TextStyle = { ...style, size };
  if (style.stroke) out.stroke = { ...style.stroke, width: style.stroke.width * k };
  if (style.extrude) out.extrude = { ...style.extrude, depth: style.extrude.depth * k };
  if (style.plate) {
    out.plate = {
      ...style.plate,
      padX: style.plate.padX * k,
      padY: style.plate.padY * k,
      radius: style.plate.radius === undefined ? undefined : style.plate.radius * k,
    };
  }
  if (style.shadow) {
    out.shadow = { ...style.shadow, dx: style.shadow.dx * k, dy: style.shadow.dy * k, blur: style.shadow.blur * k };
  }
  if (style.glow) out.glow = { ...style.glow, radius: style.glow.radius * k };
  if (style.jitter && style.jitter.offset) out.jitter = { ...style.jitter, offset: style.jitter.offset * k };
  return out;
}

/**
 * Binary-search the largest font size whose laid-out content fits `box`.
 *
 * Decoration scales with the size (see `scaleStyle`), so the fitted result
 * keeps the proportions of the style it was given.
 *
 * Two guarantees, both tested:
 *
 *  - **Termination.** A fixed iteration budget, then a bounded shrink loop.
 *  - **No overflow.** The search assumes fit is monotone in size, which
 *    wrapping makes *almost* true — a size bump can reflow a line and change
 *    the height non-monotonically. So the binary search only proposes a
 *    candidate; every returned layout is one that was explicitly verified to
 *    fit. `min` is a preference, and is undercut (down to 1 px) only when
 *    honouring it would mean returning something that overflows.
 */
export function autoFit(
  input: LayoutTextInput,
  opts: { min?: number; max?: number; steps?: number } = {},
): LaidOutText {
  validate(input);
  const min = Math.max(1, opts.min ?? 8);
  const max = Math.max(min, opts.max ?? Math.max(min, input.box.h * 1.2));
  const steps = Math.max(4, Math.min(64, Math.floor(opts.steps ?? 24)));

  const at = (size: number): LaidOutText =>
    renderText({ ...input, block: { ...input.block, style: scaleStyle(input.block.style, size) } });

  const fits = (r: LaidOutText): boolean =>
    r.width <= input.box.w + 0.01 && r.height <= input.box.h + 0.01;

  let lo = min;
  let hi = max;
  let best: LaidOutText | null = null;

  const atMin = at(min);
  if (fits(atMin)) best = atMin;

  for (let i = 0; i < steps && hi - lo > 0.25; i++) {
    const mid = (lo + hi) / 2;
    const candidate = at(mid);
    if (fits(candidate)) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (best) return best;

  // Nothing in [min, max] fits. Never return an overflowing layout: shrink
  // below `min` geometrically, bounded so this always terminates.
  let size = min;
  for (let i = 0; i < 40 && size > 1; i++) {
    size = Math.max(1, size * 0.85);
    const candidate = at(size);
    if (fits(candidate)) return candidate;
  }
  return at(1);
}
