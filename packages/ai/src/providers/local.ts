/**
 * The offline provider — Hexa's default, and for most users the only one.
 *
 * Requires no API key, makes no network call, and still has to produce a plate
 * a designer would ship. That is the bar: `hexa render` with an empty
 * environment must not look like a placeholder.
 *
 * The approach is scene-specific procedural painting rather than "gradient plus
 * noise". Each style knows what it actually is — an arena has a truss, a rig,
 * a reflective deck and a seating bowl; a neon city has two depth planes of
 * buildings, wet-road smear and haze — and paints those elements with real
 * photographic behaviour layered on top: bloom rendered as blurred bright
 * geometry, aerial perspective washing distant planes toward the haze colour,
 * an off-centre elliptical vignette, and film grain last.
 *
 * Everything derives from the requested palette (team colours) and a seed, so
 * the same request paints the same plate byte for byte, and two different teams
 * never get the same picture.
 */

import sharp from 'sharp';
import { createRng, hashString, mix, shade, saturate, complement, ensureDistinct, HexaError, type Rng } from '@hexa/core';
import type {
  BackplateRequest,
  BackplateStyle,
  GeneratedImage,
  ImageProvider,
  ProviderCapabilities,
  UpscaleRequest,
} from '../types.js';
import { isBackplateStyle } from '../types.js';
import {
  aerial,
  a,
  beamsSvg,
  bokehSvg,
  floorGridSvg,
  glowSvg,
  grainLayer,
  rasterise,
  rasteriseGlow,
  ridgeSvg,
  shardsSvg,
  skylineSvg,
  smokeSvg,
  streaksSvg,
  subjectClearanceSvg,
  vignetteSvg,
  type Size,
} from '../paint.js';

interface Palette {
  /** Dominant brand colour. */
  primary: string;
  /** Opposing brand colour, forced distinct from `primary`. */
  secondary: string;
  /** High-chroma accent for glows and filaments. */
  accent: string;
  /** Near-black background, tinted so the plate is never dead grey. */
  deep: string;
  /** Atmospheric far-distance colour — what aerial perspective washes toward. */
  haze: string;
  /** Near-white for specular hits. */
  light: string;
}

const FALLBACK_PRIMARY = '#2C6BF2';

/**
 * Derive a working palette from the team colours.
 *
 * The subtle trap here is the accent. Blending two opposing brand colours to
 * get one — red plus blue — produces magenta, and a plate built on it reads as
 * a single muddy pink wash however good the geometry is. So the accent is a hot
 * version of the *primary* instead, the haze is a cool atmospheric grey-blue
 * tinted by the secondary (which is what distance actually looks like), and the
 * deep is near-neutral with only a whisper of primary in it. That keeps the two
 * brand colours as genuinely opposed lights rather than averaging them.
 */
function buildPalette(input: readonly string[] | undefined): Palette {
  const given = (input ?? []).filter((c) => typeof c === 'string' && /^#?[0-9a-f]{3,8}$/i.test(c.trim()));
  const primary = given[0] ?? FALLBACK_PRIMARY;
  const secondary = ensureDistinct(primary, given[1] ?? complement(primary), 0.16);
  const accent = given[2] ?? saturate(shade(primary, 0.08), 1.4);
  return {
    primary,
    secondary,
    accent,
    // Near-neutral dark: pure black kills every screened glow, and a heavily
    // tinted black turns the whole plate one colour.
    deep: mix('#090B12', primary, 0.12),
    // Aerial perspective washes toward cool grey-blue in the real world.
    haze: mix('#93A6C6', secondary, 0.3),
    light: mix('#FFFFFF', accent, 0.08),
  };
}

/** Keyword routing, so a bare prompt with no explicit style still lands somewhere sensible. */
const STYLE_HINTS: ReadonlyArray<[RegExp, BackplateStyle]> = [
  [/\b(arena|stage|venue|esports\s+stadium|tournament|lan\b)/i, 'arena'],
  [/\b(stadium|crowd|stands|terrace|bowl|fans)\b/i, 'stadium-crowd'],
  [/\b(neon|city|street|skyline|downtown|tokyo|cyberpunk\s+street)\b/i, 'neon-city'],
  [/\b(cyber|server|data\s*centre|data\s*center|circuit|tech|matrix|digital)\b/i, 'cyber'],
  [/\b(ruin|rubble|ancient|temple|collapsed|derelict|wasteland)\b/i, 'ruins'],
  [/\b(void|space|cosmic|nebula|galaxy|abyss|dark\s+empty)\b/i, 'void'],
  [/\b(forest|mountain|valley|nature|meadow|sunset|landscape|outdoor)\b/i, 'nature'],
  [/\b(studio|seamless|cyclorama|backdrop|clean\s+background)\b/i, 'studio'],
  [/\b(energy|plasma|lightning|electric|power|burst|explosion)\b/i, 'energy'],
  [/\b(glass|shatter|shard|fracture|broken)\b/i, 'shattered-glass'],
  [/\b(smoke|fog|mist|vapour|vapor|haze)\b/i, 'smoke'],
  [/\b(abstract|gradient|shapes|fluid|ribbon)\b/i, 'abstract'],
];

export function inferStyle(prompt: string, explicit?: string): BackplateStyle {
  if (explicit && isBackplateStyle(explicit)) return explicit;
  for (const [re, style] of STYLE_HINTS) if (re.test(prompt)) return style;
  return 'abstract';
}

interface Ctx {
  size: Size;
  rng: Rng;
  pal: Palette;
  /** How many cut-outs the plate must leave room for. */
  subjects: number;
  /** 0–1, how far the painter may push contrast and chroma. */
  strength: number;
}

interface LayerSpec {
  svg: string;
  blend: 'over' | 'screen' | 'add' | 'soft-light' | 'overlay' | 'multiply';
  /** Render blurred and scaled — the bloom path. */
  glow?: { sigma?: number; downscale?: number };
}

// ── Scene painters ───────────────────────────────────────────────────────────
// Each returns a base gradient plus an ordered layer stack. They are written to
// be read: the comments say what real-world element each layer stands in for.

type Painter = (ctx: Ctx) => { base: string; layers: LayerSpec[] };

const PAINTERS: Record<BackplateStyle, Painter> = {
  arena: ({ size, rng, pal, subjects }) => {
    const deck = 0.66;
    const rig = 0.13;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${shade(pal.deep, -0.05)}"/>
            <stop offset="${rig}" stop-color="${mix(pal.deep, pal.haze, 0.18)}"/>
            <stop offset="${deck - 0.1}" stop-color="${mix(pal.deep, pal.haze, 0.62)}"/>
            <stop offset="${deck}" stop-color="${mix(pal.deep, pal.light, 0.24)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.03)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Seating bowl blocked in FIRST, as dark tiers. Order matters: paint the
        // structure, then light it. Blocking in after the glow just erases it.
        {
          svg:
            `<rect x="0" y="0" width="${size.width}" height="${((deck - 0.1) * size.height).toFixed(1)}" fill="${a(shade(pal.deep, -0.05), 0.5)}"/>` +
            [0.3, 0.42, 0.52]
              .map(
                (y) =>
                  `<rect x="0" y="${(y * size.height).toFixed(1)}" width="${size.width}" height="${(0.014 * size.height).toFixed(1)}" fill="${a(shade(pal.deep, -0.06), 0.7)}"/>`,
              )
              .join(''),
          blend: 'over',
          glow: { sigma: 5, downscale: 3 },
        },
        // The LED wall behind the stage — the brightest surface in the room, and
        // the thing a cut-out subject will actually read against.
        {
          svg:
            `<rect x="${(0.16 * size.width).toFixed(1)}" y="${((deck - 0.36) * size.height).toFixed(1)}" ` +
            `width="${(0.68 * size.width).toFixed(1)}" height="${(0.32 * size.height).toFixed(1)}" ` +
            `fill="${a(pal.primary, 0.85)}"/>` +
            `<rect x="${(0.16 * size.width).toFixed(1)}" y="${((deck - 0.05) * size.height).toFixed(1)}" ` +
            `width="${(0.68 * size.width).toFixed(1)}" height="${(0.012 * size.height).toFixed(1)}" ` +
            `fill="${a(pal.light, 0.9)}"/>` +
            glowSvg(size, [{ cx: 0.5, cy: deck - 0.2, rx: 0.42, ry: 0.28, colour: pal.primary, alpha: 0.9 }]),
          blend: 'screen',
          glow: { sigma: 7, downscale: 3 },
        },
        // Two side towers gelled to the opposing brand colour: the whole point
        // of a versus plate is that the two halves are lit differently.
        {
          svg: glowSvg(size, [
            { cx: 0.02, cy: deck - 0.2, rx: 0.24, ry: 0.34, colour: pal.secondary, alpha: 1 },
            { cx: 0.99, cy: deck - 0.2, rx: 0.24, ry: 0.34, colour: pal.secondary, alpha: 1 },
          ]),
          blend: 'screen',
          glow: { sigma: 14, downscale: 4 },
        },
        // House lights scattered through the stands.
        {
          svg: bokehSvg(size, rng.fork(1), {
            count: 420,
            colours: [pal.light, pal.accent, pal.secondary],
            band: { top: 0.17, bottom: deck - 0.13 },
            minR: 0.0012,
            maxR: 0.0045,
            alpha: 0.75,
            clearCentre: 0.3,
          }),
          blend: 'screen',
          glow: { sigma: 2.5, downscale: 2 },
        },
        // Overhead truss: a hard silhouette bar, then the moving heads under it.
        {
          svg:
            `<rect x="0" y="${(rig * size.height).toFixed(1)}" width="${size.width}" height="${(0.028 * size.height).toFixed(1)}" fill="${shade(pal.deep, -0.06)}"/>` +
            `<rect x="0" y="0" width="${size.width}" height="${(rig * size.height).toFixed(1)}" fill="${a(shade(pal.deep, -0.06), 0.85)}"/>` +
            Array.from({ length: 9 }, (_, i) => {
              const x = (0.07 + i * 0.1) * size.width;
              return `<rect x="${(x - 0.008 * size.width).toFixed(1)}" y="${(rig * size.height + 0.024 * size.height).toFixed(1)}" width="${(0.016 * size.width).toFixed(1)}" height="${(0.022 * size.height).toFixed(1)}" rx="${(0.004 * size.width).toFixed(1)}" fill="${a(pal.light, 0.5)}"/>`;
            }).join(''),
          blend: 'over',
        },
        // Beams through the haze — the layer that makes the room feel like a room.
        {
          svg: beamsSvg(size, rng.fork(2), {
            count: 10,
            originY: rig + 0.04,
            colours: [pal.accent, pal.light, pal.primary, pal.secondary],
            alpha: 1,
            spread: 0.22,
          }),
          blend: 'screen',
          glow: { sigma: 4, downscale: 2 },
        },
        // Stage deck: the floor grid, the lit lip, and the glow it throws forward.
        {
          svg:
            floorGridSvg(size, { horizon: deck, vanishX: 0.5, lines: 18, colour: pal.accent, alpha: 0.3 }) +
            `<rect x="0" y="${(deck * size.height).toFixed(1)}" width="${size.width}" height="${(0.007 * size.height).toFixed(1)}" fill="${a(pal.light, 0.95)}"/>` +
            `<rect x="0" y="${(deck * size.height + 0.007 * size.height).toFixed(1)}" width="${size.width}" height="${(0.03 * size.height).toFixed(1)}" fill="${a(pal.accent, 0.5)}"/>`,
          blend: 'screen',
        },
        // Wet-deck reflection: the rig smeared vertically into the floor.
        {
          svg: beamsSvg(size, rng.fork(3), {
            count: 8,
            originY: 1.04,
            colours: [pal.accent, pal.primary, pal.light],
            alpha: 0.4,
            spread: 0.05,
          }),
          blend: 'screen',
          glow: { sigma: 9, downscale: 3 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.2), blend: 'over' },
      ],
    };
  },

  'stadium-crowd': ({ size, rng, pal, subjects }) => {
    const rail = 0.74;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mix(pal.deep, pal.haze, 0.14)}"/>
            <stop offset="0.5" stop-color="${mix(pal.deep, pal.haze, 0.3)}"/>
            <stop offset="${rail}" stop-color="${mix(pal.deep, pal.haze, 0.16)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Floodlight bank above the bowl, plus the wash it throws down.
        {
          svg: glowSvg(size, [
            { cx: 0.24, cy: -0.02, rx: 0.3, ry: 0.26, colour: pal.light, alpha: 1 },
            { cx: 0.78, cy: 0.0, rx: 0.28, ry: 0.24, colour: pal.light, alpha: 0.9 },
            { cx: 0.5, cy: 0.44, rx: 0.6, ry: 0.36, colour: pal.primary, alpha: 0.6 },
          ]),
          blend: 'screen',
          glow: { sigma: 16, downscale: 4 },
        },
        // Tier separations — the dark gaps between decks give the bowl its scale.
        {
          svg: [0.26, 0.44, 0.6]
            .map(
              (y) =>
                `<rect x="0" y="${(y * size.height).toFixed(1)}" width="${size.width}" height="${(0.026 * size.height).toFixed(1)}" fill="${a(shade(pal.deep, -0.04), 0.8)}"/>`,
            )
            .join(''),
          blend: 'over',
          glow: { sigma: 5, downscale: 2 },
        },
        // The crowd: entirely abstract, deliberately too defocused to resolve.
        {
          svg: bokehSvg(size, rng.fork(1), {
            count: 1100,
            colours: [pal.light, pal.accent, pal.primary, pal.secondary],
            band: { top: 0.08, bottom: rail - 0.04 },
            minR: 0.002,
            maxR: 0.016,
            alpha: 0.8,
            clearCentre: 0.26,
          }),
          blend: 'screen',
          glow: { sigma: 4, downscale: 2 },
        },
        // Confetti caught in the floodlight beams.
        {
          svg: streaksSvg(size, rng.fork(2), {
            count: 110,
            colours: [pal.light, pal.accent],
            angle: 78,
            length: 0.04,
            alpha: 0.55,
            width: 0.0024,
          }),
          blend: 'screen',
          glow: { sigma: 1.4, downscale: 2 },
        },
        // Near barrier, well out of focus, with a lit top rail.
        {
          svg:
            `<rect x="0" y="${(rail * size.height).toFixed(1)}" width="${size.width}" height="${size.height}" fill="${a(shade(pal.deep, -0.05), 0.92)}"/>` +
            `<rect x="0" y="${(rail * size.height).toFixed(1)}" width="${size.width}" height="${(0.009 * size.height).toFixed(1)}" fill="${a(pal.accent, 0.75)}"/>`,
          blend: 'over',
          glow: { sigma: 10, downscale: 3 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.22), blend: 'over' },
      ],
    };
  },

  abstract: ({ size, rng, pal, subjects }) => ({
    base: `
      <defs>
        <linearGradient id="bg" x1="0.05" y1="0" x2="0.95" y2="1">
          <stop offset="0" stop-color="${mix(pal.deep, pal.secondary, 0.45)}"/>
          <stop offset="0.5" stop-color="${mix(pal.deep, pal.haze, 0.2)}"/>
          <stop offset="1" stop-color="${mix(pal.deep, pal.primary, 0.5)}"/>
        </linearGradient>
      </defs>
      <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
    layers: [
      // Large defocused colour fields: the two brand colours kept on opposite
      // sides so they never average into mud.
      {
        svg: glowSvg(size, [
          { cx: 0.14, cy: 0.24, rx: 0.46, ry: 0.5, colour: pal.secondary, alpha: 1 },
          { cx: 0.86, cy: 0.72, rx: 0.48, ry: 0.52, colour: pal.primary, alpha: 1 },
          { cx: 0.58, cy: 0.1, rx: 0.3, ry: 0.28, colour: pal.accent, alpha: 0.7 },
        ]),
        blend: 'screen',
        glow: { sigma: 22, downscale: 4 },
      },
      // Sweeping ribbons — the one element allowed to be sharp.
      { svg: ribbonsSvg(size, rng.fork(1), pal, 6), blend: 'screen', glow: { sigma: 1.8, downscale: 2 } },
      // Thin geometric linework for graphic structure.
      {
        svg: streaksSvg(size, rng.fork(2), {
          count: 30,
          colours: [pal.light, pal.accent],
          angle: -28,
          length: 0.55,
          alpha: 0.3,
          width: 0.0011,
        }),
        blend: 'screen',
      },
      // Suspended particulate catching the light.
      {
        svg: bokehSvg(size, rng.fork(3), {
          count: 170,
          colours: [pal.light, pal.accent],
          band: { top: 0.02, bottom: 0.98 },
          minR: 0.0014,
          maxR: 0.014,
          alpha: 0.5,
        }),
        blend: 'screen',
        glow: { sigma: 2.5, downscale: 2 },
      },
      { svg: subjectClearanceSvg(size, subjects, 0.2), blend: 'over' },
    ],
  }),

  cyber: ({ size, rng, pal, subjects }) => {
    const horizon = 0.56;
    return {
      base: `
        <defs>
          <radialGradient id="bg" cx="0.5" cy="${horizon}" r="0.85">
            <stop offset="0" stop-color="${mix(pal.deep, pal.light, 0.34)}"/>
            <stop offset="0.22" stop-color="${mix(pal.deep, pal.primary, 0.42)}"/>
            <stop offset="0.6" stop-color="${mix(pal.deep, pal.haze, 0.1)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
          </radialGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // The corridor's blown-out vanishing point.
        {
          svg: glowSvg(size, [
            { cx: 0.5, cy: horizon, rx: 0.46, ry: 0.4, colour: pal.primary, alpha: 1 },
            { cx: 0.5, cy: horizon, rx: 0.2, ry: 0.17, colour: pal.accent, alpha: 1 },
            { cx: 0.5, cy: horizon, rx: 0.075, ry: 0.065, colour: '#FFFFFF', alpha: 1 },
          ]),
          blend: 'screen',
          glow: { sigma: 9, downscale: 3 },
        },
        // Rack walls: dark blocks flanking the corridor, so it reads as an
        // interior rather than a glow on a gradient.
        { svg: rackWallsSvg(size, horizon, shade(pal.deep, -0.05)), blend: 'over', glow: { sigma: 3, downscale: 2 } },
        // Emissive seams marching toward the vanishing point.
        { svg: rackSeamsSvg(size, rng.fork(1), pal, horizon), blend: 'screen', glow: { sigma: 2, downscale: 2 } },
        // Grated floor and ceiling cable runs.
        {
          svg:
            floorGridSvg(size, { horizon, vanishX: 0.5, lines: 24, colour: pal.accent, alpha: 0.34 }) +
            streaksSvg(size, rng.fork(2), {
              count: 16,
              colours: [pal.secondary, pal.haze],
              angle: 4,
              length: 0.9,
              alpha: 0.28,
              width: 0.0016,
            }),
          blend: 'screen',
        },
        // One warm warning strip against all that cool: the complementary hit.
        {
          svg: glowSvg(size, [{ cx: 0.9, cy: 0.26, rx: 0.14, ry: 0.1, colour: pal.secondary, alpha: 1 }]),
          blend: 'screen',
          glow: { sigma: 8, downscale: 3 },
        },
        // Cold fog rolling along the floor.
        {
          svg: smokeSvg(size, rng.fork(3), {
            count: 24,
            colours: [pal.haze, pal.primary],
            alpha: 0.22,
            clearCentre: 0.18,
          }),
          blend: 'screen',
          glow: { sigma: 20, downscale: 4 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.2), blend: 'over' },
      ],
    };
  },

  ruins: ({ size, rng, pal, subjects }) => {
    const floor = 0.8;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mix(pal.deep, pal.haze, 0.42)}"/>
            <stop offset="0.42" stop-color="${mix(mix(pal.deep, pal.haze, 0.3), pal.accent, 0.18)}"/>
            <stop offset="${floor}" stop-color="${mix(pal.deep, pal.haze, 0.12)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.03)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Daylight punching through the breach, leaning as it falls.
        {
          svg: beamsSvg(size, rng.fork(1), {
            count: 6,
            originY: -0.1,
            colours: [pal.light, mix(pal.light, pal.accent, 0.4)],
            alpha: 0.8,
            spread: 0.12,
            lean: 0.14,
          }),
          blend: 'screen',
          glow: { sigma: 10, downscale: 3 },
        },
        // Far arches, washed out by dust — aerial perspective doing the work.
        {
          svg: columnsSvg(size, rng.fork(2), aerial(pal.deep, pal.haze, 0.85), floor, 9, 0.5),
          blend: 'over',
          glow: { sigma: 5, downscale: 3 },
        },
        // Mid-distance colonnade.
        {
          svg: columnsSvg(size, rng.fork(3), aerial(pal.deep, pal.haze, 0.45), floor, 6, 0.8),
          blend: 'over',
          glow: { sigma: 2, downscale: 2 },
        },
        // Near columns, nearly black, framing the frame.
        { svg: columnsSvg(size, rng.fork(4), shade(pal.deep, -0.06), floor + 0.2, 3, 0.95), blend: 'over' },
        // Where the shafts land on the floor.
        {
          svg: glowSvg(size, [{ cx: 0.58, cy: floor, rx: 0.34, ry: 0.09, colour: pal.light, alpha: 0.8 }]),
          blend: 'screen',
          glow: { sigma: 12, downscale: 3 },
        },
        // Rubble line.
        {
          svg: ridgeSvg(size, rng.fork(5), {
            baseline: floor,
            amplitude: 0.02,
            steps: 46,
            colour: shade(pal.deep, -0.04),
          }),
          blend: 'over',
        },
        // Ash and dust suspended in the shafts.
        {
          svg: bokehSvg(size, rng.fork(6), {
            count: 320,
            colours: [pal.light, pal.haze],
            band: { top: 0.08, bottom: 0.94 },
            minR: 0.001,
            maxR: 0.006,
            alpha: 0.55,
          }),
          blend: 'screen',
          glow: { sigma: 1.6, downscale: 2 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.18), blend: 'over' },
      ],
    };
  },

  void: ({ size, rng, pal, subjects }) => ({
    base: `
      <defs>
        <radialGradient id="bg" cx="0.54" cy="0.44" r="0.78">
          <stop offset="0" stop-color="${mix(pal.deep, pal.primary, 0.65)}"/>
          <stop offset="0.32" stop-color="${mix(pal.deep, pal.primary, 0.3)}"/>
          <stop offset="0.7" stop-color="${mix(pal.deep, pal.secondary, 0.12)}"/>
          <stop offset="1" stop-color="${shade(pal.deep, -0.06)}"/>
        </radialGradient>
      </defs>
      <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
    layers: [
      // Nebula banding — very low frequency, moderate contrast.
      {
        svg: smokeSvg(size, rng.fork(1), {
          count: 20,
          colours: [pal.primary, pal.secondary, pal.accent],
          alpha: 0.3,
        }),
        blend: 'screen',
        glow: { sigma: 34, downscale: 5 },
      },
      // The luminous core.
      {
        svg: glowSvg(size, [
          { cx: 0.54, cy: 0.42, rx: 0.34, ry: 0.32, colour: pal.accent, alpha: 0.85 },
          { cx: 0.54, cy: 0.42, rx: 0.11, ry: 0.1, colour: pal.light, alpha: 1 },
        ]),
        blend: 'screen',
        glow: { sigma: 18, downscale: 4 },
      },
      // Starfield: mostly tiny, a handful bright.
      {
        svg: bokehSvg(size, rng.fork(2), {
          count: 520,
          colours: [pal.light, '#FFFFFF', pal.accent],
          band: { top: 0.01, bottom: 0.99 },
          minR: 0.0009,
          maxR: 0.0045,
          alpha: 0.9,
        }),
        blend: 'screen',
      },
      { svg: subjectClearanceSvg(size, subjects, 0.16), blend: 'over' },
    ],
  }),

  nature: ({ size, rng, pal, subjects }) => {
    const horizon = 0.66;
    const sun = { x: 0.72, y: horizon - 0.04 };
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mix(pal.deep, pal.secondary, 0.55)}"/>
            <stop offset="${horizon - 0.22}" stop-color="${mix(pal.haze, pal.accent, 0.66)}"/>
            <stop offset="${horizon}" stop-color="${mix(pal.accent, pal.light, 0.42)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.02)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Low sun sitting on the ridgeline.
        {
          svg: glowSvg(size, [
            { cx: sun.x, cy: sun.y, rx: 0.36, ry: 0.32, colour: pal.accent, alpha: 1 },
            { cx: sun.x, cy: sun.y, rx: 0.06, ry: 0.05, colour: '#FFF8E6', alpha: 1 },
          ]),
          blend: 'screen',
          glow: { sigma: 16, downscale: 4 },
        },
        // Four stacked ridges, each washed further toward the haze colour.
        {
          svg: [0.82, 0.62, 0.42, 0.24]
            .map((t, i) =>
              ridgeSvg(size, rng.fork(10 + i), {
                baseline: horizon + i * 0.055,
                amplitude: 0.03 + i * 0.012,
                steps: 12 + i * 6,
                colour: aerial(shade(pal.deep, -0.02), pal.haze, t),
              }),
            )
            .reverse()
            .join(''),
          blend: 'over',
        },
        // Valley mist pooling between the ridges.
        {
          svg: smokeSvg(size, rng.fork(2), { count: 20, colours: [pal.light, pal.haze], alpha: 0.24 }),
          blend: 'screen',
          glow: { sigma: 26, downscale: 5 },
        },
        // Pollen and insects catching the sun.
        {
          svg: bokehSvg(size, rng.fork(3), {
            count: 220,
            colours: ['#FFF3D6', pal.accent],
            band: { top: 0.4, bottom: 0.95 },
            minR: 0.001,
            maxR: 0.007,
            alpha: 0.6,
          }),
          blend: 'screen',
          glow: { sigma: 2, downscale: 2 },
        },
        // Dark foreground grass, heavily defocused.
        {
          svg: ridgeSvg(size, rng.fork(4), {
            baseline: 0.94,
            amplitude: 0.06,
            steps: 90,
            colour: shade(pal.deep, -0.07),
          }),
          blend: 'over',
          glow: { sigma: 6, downscale: 3 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.18), blend: 'over' },
      ],
    };
  },

  studio: ({ size, rng, pal, subjects }) => {
    const sweep = 0.76;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${shade(pal.deep, -0.03)}"/>
            <stop offset="0.34" stop-color="${mix(pal.deep, pal.haze, 0.34)}"/>
            <stop offset="${sweep}" stop-color="${mix(pal.deep, pal.haze, 0.5)}"/>
            <stop offset="1" stop-color="${mix(pal.deep, pal.haze, 0.14)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // One big soft key, deliberately off-centre.
        {
          svg: glowSvg(size, [{ cx: 0.46, cy: 0.4, rx: 0.44, ry: 0.42, colour: pal.light, alpha: 0.9 }]),
          blend: 'screen',
          glow: { sigma: 18, downscale: 4 },
        },
        // Two gridded accents gelled to the brand colours, hard against the edges.
        {
          svg: glowSvg(size, [
            { cx: 0.12, cy: 0.54, rx: 0.3, ry: 0.5, colour: pal.primary, alpha: 1 },
            { cx: 0.88, cy: 0.34, rx: 0.28, ry: 0.46, colour: pal.secondary, alpha: 1 },
          ]),
          blend: 'screen',
          glow: { sigma: 12, downscale: 3 },
        },
        // The cyc curve: a soft shadow where floor meets wall, which is the only
        // thing that tells you this is a room and not a gradient.
        {
          svg:
            `<rect x="0" y="${(sweep * size.height).toFixed(1)}" width="${size.width}" height="${(0.09 * size.height).toFixed(1)}" fill="${a(shade(pal.deep, -0.05), 0.8)}"/>` +
            `<rect x="0" y="${(sweep * size.height).toFixed(1)}" width="${size.width}" height="${(0.004 * size.height).toFixed(1)}" fill="${a(pal.light, 0.3)}"/>`,
          blend: 'over',
          glow: { sigma: 4, downscale: 2 },
        },
        // Floor sheen directly under the key.
        {
          svg: glowSvg(size, [{ cx: 0.46, cy: 0.94, rx: 0.36, ry: 0.11, colour: pal.light, alpha: 0.6 }]),
          blend: 'screen',
          glow: { sigma: 14, downscale: 4 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.14), blend: 'over' },
        // A whisper of haze so the accents have body.
        {
          svg: smokeSvg(size, rng.fork(1), { count: 8, colours: [pal.light], alpha: 0.09 }),
          blend: 'screen',
          glow: { sigma: 34, downscale: 6 },
        },
      ],
    };
  },

  energy: ({ size, rng, pal, subjects }) => {
    const core = { x: 0.54, y: 0.46 };
    return {
      base: `
        <defs>
          <radialGradient id="bg" cx="${core.x}" cy="${core.y}" r="0.9">
            <stop offset="0" stop-color="${mix(pal.deep, pal.accent, 0.62)}"/>
            <stop offset="0.3" stop-color="${mix(pal.deep, pal.primary, 0.4)}"/>
            <stop offset="0.7" stop-color="${mix(pal.deep, pal.secondary, 0.14)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.05)}"/>
          </radialGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // The core, blown out at its centre.
        {
          svg: glowSvg(size, [
            { cx: core.x, cy: core.y, rx: 0.44, ry: 0.44, colour: pal.primary, alpha: 0.9 },
            { cx: core.x, cy: core.y, rx: 0.17, ry: 0.17, colour: pal.accent, alpha: 1 },
            { cx: core.x, cy: core.y, rx: 0.055, ry: 0.055, colour: '#FFFFFF', alpha: 1 },
          ]),
          blend: 'screen',
          glow: { sigma: 16, downscale: 3 },
        },
        // Radiating filaments — sharp, so the burst has structure not just bloom.
        { svg: arcsSvg(size, rng.fork(1), pal, core, 44), blend: 'screen', glow: { sigma: 1.6, downscale: 2 } },
        // Shockwave rings.
        {
          svg: [0.16, 0.28, 0.44]
            .map(
              (r, i) =>
                `<ellipse cx="${(core.x * size.width).toFixed(1)}" cy="${(core.y * size.height).toFixed(1)}" ` +
                `rx="${(r * size.width).toFixed(1)}" ry="${(r * size.height * 0.92).toFixed(1)}" fill="none" ` +
                `stroke="${a(pal.light, 0.55 - i * 0.13)}" stroke-width="${(0.0035 * size.width).toFixed(2)}"/>`,
            )
            .join(''),
          blend: 'screen',
          glow: { sigma: 4, downscale: 2 },
        },
        // Sparks streaking past the lens.
        {
          svg:
            streaksSvg(size, rng.fork(2), {
              count: 60,
              colours: [pal.light, pal.accent],
              angle: -20,
              length: 0.1,
              alpha: 0.5,
              width: 0.0018,
            }) +
            bokehSvg(size, rng.fork(3), {
              count: 230,
              colours: [pal.light, pal.accent, '#FFFFFF'],
              band: { top: 0.02, bottom: 0.98 },
              minR: 0.001,
              maxR: 0.01,
              alpha: 0.7,
            }),
          blend: 'screen',
          glow: { sigma: 2, downscale: 2 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.22), blend: 'over' },
      ],
    };
  },

  'shattered-glass': ({ size, rng, pal, subjects }) => {
    const impact = { x: 0.32, y: 0.36 };
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0" stop-color="${mix(pal.deep, pal.secondary, 0.4)}"/>
            <stop offset="0.5" stop-color="${mix(pal.deep, pal.haze, 0.26)}"/>
            <stop offset="1" stop-color="${mix(pal.deep, pal.primary, 0.42)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Backlight behind the plane — what the shard edges catch.
        {
          svg: glowSvg(size, [
            { cx: 0.68, cy: 0.62, rx: 0.5, ry: 0.48, colour: pal.primary, alpha: 1 },
            { cx: 0.68, cy: 0.62, rx: 0.16, ry: 0.15, colour: pal.light, alpha: 0.7 },
            { cx: impact.x, cy: impact.y, rx: 0.24, ry: 0.24, colour: pal.accent, alpha: 1 },
          ]),
          blend: 'screen',
          glow: { sigma: 14, downscale: 3 },
        },
        // The fracture plane: bright edges are what read as glass.
        {
          svg: shardsSvg(size, rng.fork(1), {
            count: 28,
            origin: impact,
            fill: pal.haze,
            edge: pal.light,
            alpha: 0.3,
          }),
          blend: 'screen',
        },
        // A second, larger set for the near defocused shards.
        {
          svg: shardsSvg(size, rng.fork(2), {
            count: 9,
            origin: { x: impact.x + 0.06, y: impact.y + 0.07 },
            fill: pal.accent,
            edge: pal.light,
            alpha: 0.28,
          }),
          blend: 'screen',
          glow: { sigma: 8, downscale: 3 },
        },
        // Glass dust glittering in the key.
        {
          svg: bokehSvg(size, rng.fork(3), {
            count: 300,
            colours: ['#FFFFFF', pal.light, pal.accent],
            band: { top: 0.02, bottom: 0.98 },
            minR: 0.0009,
            maxR: 0.006,
            alpha: 0.75,
          }),
          blend: 'screen',
          glow: { sigma: 1.4, downscale: 2 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.2), blend: 'over' },
      ],
    };
  },

  smoke: ({ size, rng, pal, subjects }) => ({
    base: `
      <defs>
        <linearGradient id="bg" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="${mix(pal.deep, pal.accent, 0.55)}"/>
          <stop offset="0.32" stop-color="${mix(pal.deep, pal.haze, 0.18)}"/>
          <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
        </linearGradient>
      </defs>
      <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
    layers: [
      // Ember light from below — the warm base of the temperature split.
      {
        svg: glowSvg(size, [{ cx: 0.5, cy: 1.04, rx: 0.62, ry: 0.4, colour: pal.accent, alpha: 0.95 }]),
        blend: 'screen',
        glow: { sigma: 26, downscale: 5 },
      },
      // Side key defining the smoke edges.
      {
        svg: glowSvg(size, [
          { cx: 0.04, cy: 0.3, rx: 0.4, ry: 0.5, colour: pal.primary, alpha: 1 },
          { cx: 0.98, cy: 0.62, rx: 0.26, ry: 0.4, colour: pal.secondary, alpha: 0.7 },
        ]),
        blend: 'screen',
        glow: { sigma: 22, downscale: 4 },
      },
      // Dense columns at the edges, clear pocket at the centre.
      {
        svg: smokeSvg(size, rng.fork(1), {
          count: 54,
          colours: [pal.haze, pal.light, pal.primary],
          alpha: 0.26,
          clearCentre: 0.3,
        }),
        blend: 'screen',
        glow: { sigma: 20, downscale: 4 },
      },
      // Thin wisps peeling off, sharper than the body.
      {
        svg: smokeSvg(size, rng.fork(2), { count: 26, colours: [pal.light], alpha: 0.2, clearCentre: 0.36 }),
        blend: 'screen',
        glow: { sigma: 5, downscale: 2 },
      },
      // A dark near column at each edge: without one hard edge, layered smoke
      // reads as a flat wash rather than a volume.
      {
        svg: smokeSvg(size, rng.fork(3), {
          count: 14,
          colours: [shade(pal.deep, -0.07)],
          alpha: 0.55,
          clearCentre: 0.52,
        }),
        blend: 'over',
        glow: { sigma: 16, downscale: 4 },
      },
      { svg: subjectClearanceSvg(size, subjects, 0.2), blend: 'over' },
    ],
  }),

  'neon-city': ({ size, rng, pal, subjects }) => {
    const road = 0.72;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mix(pal.deep, pal.secondary, 0.5)}"/>
            <stop offset="0.38" stop-color="${mix(pal.deep, pal.haze, 0.58)}"/>
            <stop offset="${road}" stop-color="${mix(pal.deep, pal.haze, 0.3)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // The bright gap at the end of the street.
        {
          svg: glowSvg(size, [
            { cx: 0.5, cy: road - 0.12, rx: 0.34, ry: 0.26, colour: pal.light, alpha: 0.85 },
            { cx: 0.5, cy: road - 0.08, rx: 0.6, ry: 0.4, colour: pal.primary, alpha: 0.7 },
          ]),
          blend: 'screen',
          glow: { sigma: 18, downscale: 4 },
        },
        // Far towers, hazed almost flat.
        {
          svg: skylineSvg(size, rng.fork(1), {
            baseline: road - 0.02,
            minH: 0.16,
            maxH: 0.42,
            colour: aerial(shade(pal.deep, -0.01), pal.haze, 0.78),
            windowColour: pal.light,
            windowAlpha: 0.5,
            count: 26,
            clearCentre: 0.24,
          }),
          blend: 'over',
          glow: { sigma: 4, downscale: 3 },
        },
        // Near towers: nearly black silhouettes with hot neon on the facades.
        {
          svg: skylineSvg(size, rng.fork(2), {
            baseline: road,
            minH: 0.3,
            maxH: 0.74,
            colour: shade(pal.deep, -0.06),
            windowColour: pal.accent,
            windowAlpha: 0.9,
            count: 12,
            clearCentre: 0.38,
          }),
          blend: 'over',
        },
        // Neon signage stacked up the canyon walls.
        { svg: neonSignsSvg(size, rng.fork(3), pal, road), blend: 'screen', glow: { sigma: 4, downscale: 3 } },
        // Wet asphalt: long vertical specular smears of everything above.
        {
          svg:
            `<rect x="0" y="${(road * size.height).toFixed(1)}" width="${size.width}" height="${size.height}" fill="${a(shade(pal.deep, -0.03), 0.45)}"/>` +
            streaksSvg(size, rng.fork(4), {
              count: 46,
              colours: [pal.accent, pal.primary, pal.secondary, pal.light],
              angle: 90,
              length: 0.3,
              alpha: 0.45,
              width: 0.006,
            }),
          blend: 'screen',
          glow: { sigma: 9, downscale: 3 },
        },
        // Light rain through the signage.
        {
          svg: streaksSvg(size, rng.fork(5), {
            count: 150,
            colours: [pal.light],
            angle: 82,
            length: 0.05,
            alpha: 0.28,
            width: 0.001,
          }),
          blend: 'screen',
        },
        { svg: subjectClearanceSvg(size, subjects, 0.24), blend: 'over' },
      ],
    };
  },
};

// ── Style-specific geometry helpers ──────────────────────────────────────────

/** Broad sweeping ribbons for the abstract style. */
function ribbonsSvg(size: Size, rng: Rng, pal: Palette, count: number): string {
  const { width: w, height: h } = size;
  const colours = [pal.accent, pal.light, pal.primary, pal.secondary];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const y0 = rng.float(0.1, 0.9) * h;
    const y1 = y0 + rng.float(-0.3, 0.3) * h;
    const c1 = rng.float(-0.4, 0.4) * h;
    const c2 = rng.float(-0.4, 0.4) * h;
    const thickness = rng.float(0.006, 0.045) * h;
    const colour = colours[i % colours.length] ?? pal.light;
    out.push(
      `<path d="M ${-0.05 * w} ${y0.toFixed(1)} C ${(0.3 * w).toFixed(1)} ${(y0 + c1).toFixed(1)}, ` +
        `${(0.7 * w).toFixed(1)} ${(y1 + c2).toFixed(1)}, ${(1.05 * w).toFixed(1)} ${y1.toFixed(1)}" ` +
        `fill="none" stroke="${a(colour, rng.float(0.4, 0.8))}" stroke-width="${thickness.toFixed(2)}" ` +
        `stroke-linecap="round"/>`,
    );
  }
  return out.join('');
}

/** Dark rack blocks flanking the cyber corridor, converging on the horizon. */
function rackWallsSvg(size: Size, horizon: number, colour: string): string {
  const { width: w, height: h } = size;
  const hy = horizon * h;
  const inset = 0.09 * w;
  return (
    `<polygon points="0,0 ${inset.toFixed(1)},${(hy - 0.1 * h).toFixed(1)} ${inset.toFixed(1)},${(hy + 0.12 * h).toFixed(1)} 0,${h}" fill="${a(colour, 0.92)}"/>` +
    `<polygon points="${w},0 ${(w - inset).toFixed(1)},${(hy - 0.1 * h).toFixed(1)} ${(w - inset).toFixed(1)},${(hy + 0.12 * h).toFixed(1)} ${w},${h}" fill="${a(colour, 0.92)}"/>` +
    `<rect x="0" y="0" width="${w}" height="${(hy - 0.34 * h).toFixed(1)}" fill="${a(colour, 0.3)}"/>`
  );
}

/** Emissive rack seams converging on the vanishing point. */
function rackSeamsSvg(size: Size, rng: Rng, pal: Palette, horizon: number): string {
  const { width: w, height: h } = size;
  const hy = horizon * h;
  const out: string[] = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 1; i <= 10; i++) {
      const t = (i / 10) ** 1.7;
      const x = 0.5 * w + side * (0.05 + t * 0.62) * w;
      const top = hy - (0.03 + t * 0.42) * h;
      const bottom = hy + (0.03 + t * 0.44) * h;
      const colour = rng.bool(0.75) ? pal.primary : pal.accent;
      out.push(
        `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(0.005 * w * (0.4 + t)).toFixed(2)}" ` +
          `height="${(bottom - top).toFixed(1)}" fill="${a(colour, 0.55 + t * 0.45)}"/>`,
      );
    }
  }
  return out.join('');
}

/** Broken columns for the ruins style. */
function columnsSvg(size: Size, rng: Rng, colour: string, floor: number, count: number, alpha: number): string {
  const { width: w, height: h } = size;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = rng.float(0.01, 0.95) * w;
    const cw = rng.float(0.025, 0.085) * w;
    const top = rng.float(0.02, 0.5) * h;
    // Snapped-off tops: a column ending in a flat line reads as a rectangle.
    const notch = rng.float(0.01, 0.06) * h;
    out.push(
      `<polygon points="${x.toFixed(1)},${(top + notch).toFixed(1)} ${(x + cw * 0.5).toFixed(1)},${top.toFixed(1)} ` +
        `${(x + cw).toFixed(1)},${(top + notch * 0.6).toFixed(1)} ${(x + cw).toFixed(1)},${(floor * h).toFixed(1)} ` +
        `${x.toFixed(1)},${(floor * h).toFixed(1)}" fill="${a(colour, alpha)}"/>`,
    );
  }
  return out.join('');
}

/** Radiating plasma filaments. */
function arcsSvg(size: Size, rng: Rng, pal: Palette, core: { x: number; y: number }, count: number): string {
  const { width: w, height: h } = size;
  const cx = core.x * w;
  const cy = core.y * h;
  const colours = [pal.light, pal.accent, '#FFFFFF', pal.primary];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const ang = rng.float(0, Math.PI * 2);
    const len = rng.float(0.16, 0.66) * Math.max(w, h);
    const bend = rng.float(-0.5, 0.5);
    const ex = cx + Math.cos(ang) * len;
    const ey = cy + Math.sin(ang) * len;
    const mx = cx + Math.cos(ang + bend) * len * 0.55;
    const my = cy + Math.sin(ang + bend) * len * 0.55;
    const colour = colours[rng.int(0, colours.length - 1)] ?? pal.light;
    out.push(
      `<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}" ` +
        `fill="none" stroke="${a(colour, rng.float(0.35, 0.85))}" stroke-width="${(rng.float(0.0008, 0.0034) * w).toFixed(2)}" ` +
        `stroke-linecap="round"/>`,
    );
  }
  return out.join('');
}

/** Neon signage: vertical and horizontal bars up the canyon walls. */
function neonSignsSvg(size: Size, rng: Rng, pal: Palette, road: number): string {
  const { width: w, height: h } = size;
  const colours = [pal.accent, pal.primary, pal.secondary, pal.light];
  const out: string[] = [];
  for (let i = 0; i < 26; i++) {
    const left = rng.bool();
    const x = left ? rng.float(0.01, 0.3) : rng.float(0.7, 0.99);
    const y = rng.float(0.06, road - 0.06);
    const vertical = rng.bool(0.45);
    const long = rng.float(0.035, 0.13);
    const thin = rng.float(0.005, 0.013);
    const colour = colours[rng.int(0, colours.length - 1)] ?? pal.accent;
    out.push(
      `<rect x="${(x * w).toFixed(1)}" y="${(y * h).toFixed(1)}" ` +
        `width="${((vertical ? thin : long) * w).toFixed(1)}" height="${((vertical ? long : thin) * h).toFixed(1)}" ` +
        `rx="${(thin * w * 0.4).toFixed(1)}" fill="${a(colour, rng.float(0.65, 1))}"/>`,
    );
  }
  return out.join('');
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const MAX_SIZE = { width: 8192, height: 8192 };

async function paintBackplate(req: BackplateRequest): Promise<GeneratedImage> {
  const width = clampDimension(req.width, 'width');
  const height = clampDimension(req.height, 'height');
  const size: Size = { width, height };

  const style = inferStyle(req.prompt ?? '', req.style);
  const seed = Number.isFinite(req.seed) ? (req.seed as number) : hashString(`${style}:${req.prompt ?? ''}`);
  const rng = createRng(seed >>> 0);
  const pal = buildPalette(req.palette);
  const strength = clamp01(req.strength ?? 0.75);
  const subjects = subjectCountFromPrompt(req.prompt ?? '');

  const painter = PAINTERS[style] ?? PAINTERS.abstract;
  const scene = painter({ size, rng: rng.fork(7), pal, subjects, strength });

  const base = await rasterise(scene.base, size);
  const layers = await Promise.all(
    scene.layers.map(async (l) => ({
      input: l.glow ? await rasteriseGlow(l.svg, size, l.glow) : await rasterise(l.svg, size),
      blend: l.blend,
    })),
  );

  // Vignette and grain go on last so they sit over every scene element — the
  // order a camera would apply them in.
  layers.push({ input: await rasterise(vignetteSvg(size, 0.34 + strength * 0.14), size), blend: 'over' });
  layers.push({ input: await grainLayer(size, rng.fork(99), 0.045 + strength * 0.03), blend: 'soft-light' });

  const composited = await sharp(base)
    .composite(layers as sharp.OverlayOptions[])
    .png()
    .toBuffer();

  // Final grade: a touch of contrast and chroma, then a light sharpen so the
  // plate still has edge definition after the compositor's own resize.
  const buffer = await sharp(composited)
    .removeAlpha()
    .modulate({ saturation: 1.1 + strength * 0.1, brightness: 1.04 })
    // Gentle S-curve: lift the gain, barely touch the black point. Crushing the
    // toe here was what made every early plate read as a dark smear.
    .linear(1.12, -4)
    .sharpen({ sigma: 0.7 })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    buffer,
    width,
    height,
    provider: 'local',
    model: `procedural/${style}`,
    seed: seed >>> 0,
    cost: 0,
    promptUsed: req.prompt ?? '',
  };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.75;
}

function clampDimension(v: number, name: 'width' | 'height'): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 16) {
    throw new HexaError('INVALID_REQUEST', `Backplate ${name} must be at least 16 pixels (got ${v}).`, {
      hint: 'Use the aspect presets from @hexa/core rather than raw pixel values.',
    });
  }
  return Math.min(n, MAX_SIZE[name]);
}

/** "two players facing off" ⇒ leave two columns. Read from the prompt, not guessed. */
function subjectCountFromPrompt(prompt: string): number {
  const m = /\b(?:space|room|gap|columns?)\s+for\s+(one|two|three|four|five|\d+)\b/i.exec(prompt);
  if (m) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const raw = m[1]!.toLowerCase();
    return words[raw] ?? Math.max(1, Math.min(6, Number.parseInt(raw, 10) || 1));
  }
  if (/\b(versus|vs\.?|head[- ]to[- ]head|face[- ]off|1v1|2v2)\b/i.test(prompt)) return 2;
  if (/\b(lineup|roster|full\s+team|five\s+stack)\b/i.test(prompt)) return 5;
  return 1;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class LocalProvider implements ImageProvider {
  readonly id = 'local';

  readonly capabilities: ProviderCapabilities = {
    backplate: true,
    // Honest: procedural painting cannot follow an edit instruction, so it must
    // never be routed an identity-preserving edit.
    identityGuidedEdit: false,
    inpaint: false,
    // sharp's Lanczos resampling is a real upscale — modest, but not a lie.
    upscale: true,
    maxSize: MAX_SIZE,
  };

  /** No key, no network. Always available — that is the entire point. */
  isConfigured(): boolean {
    return true;
  }

  async generateBackplate(req: BackplateRequest): Promise<GeneratedImage> {
    return paintBackplate(req);
  }

  async upscale(req: UpscaleRequest): Promise<GeneratedImage> {
    if (!Buffer.isBuffer(req.image) || req.image.length === 0) {
      throw new HexaError('INVALID_REQUEST', 'Upscale requires an image buffer.');
    }
    const factor = req.factor === 4 ? 4 : 2;
    const meta = await sharp(req.image).metadata();
    const width = Math.min((meta.width ?? 0) * factor, MAX_SIZE.width);
    const height = Math.min((meta.height ?? 0) * factor, MAX_SIZE.height);
    if (width < 1 || height < 1) {
      throw new HexaError('INVALID_REQUEST', 'Could not read the source image dimensions for upscaling.');
    }
    const buffer = await sharp(req.image)
      .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
      // Lanczos leaves a slight softness; a restrained unsharp mask puts the
      // apparent detail back without ringing on the edges.
      .sharpen({ sigma: 0.8, m1: 0.6, m2: 2 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return {
      buffer,
      width,
      height,
      provider: 'local',
      model: `lanczos3-x${factor}`,
      cost: 0,
      promptUsed: '',
    };
  }
}

export const localProvider = new LocalProvider();
