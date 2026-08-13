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

function buildPalette(input: readonly string[] | undefined): Palette {
  const given = (input ?? []).filter((c) => typeof c === 'string' && /^#?[0-9a-f]{3,8}$/i.test(c.trim()));
  const primary = given[0] ?? FALLBACK_PRIMARY;
  const secondaryRaw = given[1] ?? complement(primary);
  const secondary = ensureDistinct(primary, secondaryRaw, 0.16);
  const accent = given[2] ?? saturate(mix(primary, secondary, 0.5), 1.5);
  return {
    primary,
    secondary,
    accent,
    // Tinted near-black: pure #000 backgrounds kill every glow composited onto them.
    deep: shade(saturate(mix(primary, '#06070C', 0.88), 0.9), -0.06),
    haze: shade(mix(primary, secondary, 0.45), 0.16),
    light: mix('#FFFFFF', accent, 0.12),
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
    const horizon = 0.63;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${shade(pal.deep, -0.03)}"/>
            <stop offset="${horizon - 0.12}" stop-color="${mix(pal.deep, pal.haze, 0.34)}"/>
            <stop offset="${horizon}" stop-color="${mix(pal.deep, pal.haze, 0.5)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.05)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // The LED wall behind the stage: the brightest thing in the room.
        {
          svg: glowSvg(size, [
            { cx: 0.5, cy: horizon - 0.16, rx: 0.46, ry: 0.3, colour: pal.primary, alpha: 0.85 },
            { cx: 0.22, cy: horizon - 0.08, rx: 0.2, ry: 0.16, colour: pal.secondary, alpha: 0.5 },
            { cx: 0.79, cy: horizon - 0.08, rx: 0.2, ry: 0.16, colour: pal.secondary, alpha: 0.5 },
          ]),
          blend: 'screen',
          glow: { sigma: 16, downscale: 4 },
        },
        // Seating bowl: rows of tiny house lights receding into the dark.
        {
          svg: bokehSvg(size, rng.fork(1), {
            count: 220,
            colours: [pal.light, pal.accent, pal.secondary],
            band: { top: 0.04, bottom: horizon - 0.12 },
            minR: 0.0016,
            maxR: 0.0075,
            alpha: 0.42,
            clearCentre: 0.34,
          }),
          blend: 'screen',
          glow: { sigma: 3, downscale: 2 },
        },
        // Overhead truss: moving heads punching down through the haze.
        {
          svg: beamsSvg(size, rng.fork(2), {
            count: 9,
            originY: -0.03,
            colours: [pal.accent, pal.primary, pal.light, pal.secondary],
            alpha: 0.4,
            spread: 0.2,
          }),
          blend: 'screen',
          glow: { sigma: 7, downscale: 3 },
        },
        // The deck itself, and the hard specular line along the stage lip.
        {
          svg: `
            ${floorGridSvg(size, { horizon, vanishX: 0.5, lines: 16, colour: pal.accent, alpha: 0.16 })}
            <rect x="0" y="${(horizon * size.height).toFixed(1)}" width="${size.width}" height="${(0.006 * size.height).toFixed(1)}" fill="${a(pal.light, 0.55)}"/>
            <rect x="0" y="${(horizon * size.height + 0.006 * size.height).toFixed(1)}" width="${size.width}" height="${(0.02 * size.height).toFixed(1)}" fill="${a(pal.accent, 0.28)}"/>`,
          blend: 'screen',
        },
        // Wet-deck reflection: the rig smeared vertically into the floor.
        {
          svg: beamsSvg(size, rng.fork(3), {
            count: 7,
            originY: 1.02,
            colours: [pal.accent, pal.primary],
            alpha: 0.22,
            spread: 0.05,
          }),
          blend: 'screen',
          glow: { sigma: 10, downscale: 4 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.3), blend: 'over' },
      ],
    };
  },

  'stadium-crowd': ({ size, rng, pal, subjects }) => {
    const rail = 0.72;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${shade(pal.deep, 0.04)}"/>
            <stop offset="0.55" stop-color="${mix(pal.deep, pal.haze, 0.4)}"/>
            <stop offset="${rail}" stop-color="${mix(pal.deep, pal.haze, 0.22)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Floodlight bank washing the top of the bowl.
        {
          svg: glowSvg(size, [
            { cx: 0.28, cy: 0.02, rx: 0.3, ry: 0.2, colour: pal.light, alpha: 0.7 },
            { cx: 0.74, cy: 0.04, rx: 0.28, ry: 0.18, colour: pal.light, alpha: 0.6 },
            { cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.3, colour: pal.primary, alpha: 0.45 },
          ]),
          blend: 'screen',
          glow: { sigma: 20, downscale: 4 },
        },
        // Tier separations — the dark horizontal gaps between decks.
        {
          svg: [0.24, 0.42, 0.58]
            .map(
              (y) =>
                `<rect x="0" y="${(y * size.height).toFixed(1)}" width="${size.width}" height="${(0.022 * size.height).toFixed(1)}" fill="${a(pal.deep, 0.62)}"/>`,
            )
            .join(''),
          blend: 'over',
          glow: { sigma: 5, downscale: 2 },
        },
        // The crowd: entirely abstract, never resolvable into people.
        {
          svg: bokehSvg(size, rng.fork(1), {
            count: 900,
            colours: [pal.light, pal.accent, pal.primary, pal.secondary],
            band: { top: 0.06, bottom: rail - 0.04 },
            minR: 0.0018,
            maxR: 0.014,
            alpha: 0.55,
            clearCentre: 0.3,
          }),
          blend: 'screen',
          glow: { sigma: 4, downscale: 2 },
        },
        // Confetti drifting through the floodlight beams.
        {
          svg: streaksSvg(size, rng.fork(2), {
            count: 90,
            colours: [pal.light, pal.accent],
            angle: 78,
            length: 0.035,
            alpha: 0.35,
            width: 0.0022,
          }),
          blend: 'screen',
          glow: { sigma: 1.4, downscale: 2 },
        },
        // Near barrier, well out of focus.
        {
          svg: `<rect x="0" y="${(rail * size.height).toFixed(1)}" width="${size.width}" height="${size.height}" fill="${a(shade(pal.deep, -0.05), 0.9)}"/>
                <rect x="0" y="${(rail * size.height).toFixed(1)}" width="${size.width}" height="${(0.008 * size.height).toFixed(1)}" fill="${a(pal.accent, 0.4)}"/>`,
          blend: 'over',
          glow: { sigma: 12, downscale: 3 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.32), blend: 'over' },
      ],
    };
  },

  abstract: ({ size, rng, pal, subjects }) => ({
    base: `
      <defs>
        <linearGradient id="bg" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stop-color="${mix(pal.deep, pal.secondary, 0.22)}"/>
          <stop offset="0.5" stop-color="${pal.deep}"/>
          <stop offset="1" stop-color="${mix(pal.deep, pal.primary, 0.28)}"/>
        </linearGradient>
      </defs>
      <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
    layers: [
      // Large defocused colour fields — the "out of focus everything" plane.
      {
        svg: glowSvg(size, [
          { cx: 0.18, cy: 0.28, rx: 0.42, ry: 0.42, colour: pal.secondary, alpha: 0.8 },
          { cx: 0.82, cy: 0.68, rx: 0.44, ry: 0.44, colour: pal.primary, alpha: 0.85 },
          { cx: 0.55, cy: 0.12, rx: 0.3, ry: 0.26, colour: pal.accent, alpha: 0.5 },
        ]),
        blend: 'screen',
        glow: { sigma: 26, downscale: 5 },
      },
      // Sweeping ribbons: the one element allowed to be sharp.
      {
        svg: ribbonsSvg(size, rng.fork(1), pal, 5),
        blend: 'screen',
        glow: { sigma: 2.2, downscale: 2 },
      },
      // Thin geometric linework for a bit of graphic structure.
      {
        svg: streaksSvg(size, rng.fork(2), {
          count: 26,
          colours: [pal.light, pal.accent],
          angle: -28,
          length: 0.5,
          alpha: 0.16,
          width: 0.0009,
        }),
        blend: 'screen',
      },
      // Suspended particulate catching the light.
      {
        svg: bokehSvg(size, rng.fork(3), {
          count: 140,
          colours: [pal.light, pal.accent],
          band: { top: 0.02, bottom: 0.98 },
          minR: 0.0012,
          maxR: 0.011,
          alpha: 0.32,
        }),
        blend: 'screen',
        glow: { sigma: 2.5, downscale: 2 },
      },
      { svg: subjectClearanceSvg(size, subjects, 0.28), blend: 'over' },
    ],
  }),

  cyber: ({ size, rng, pal, subjects }) => {
    const horizon = 0.55;
    return {
      base: `
        <defs>
          <radialGradient id="bg" cx="0.5" cy="${horizon}" r="0.8">
            <stop offset="0" stop-color="${mix(pal.deep, pal.primary, 0.42)}"/>
            <stop offset="0.45" stop-color="${mix(pal.deep, pal.primary, 0.14)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
          </radialGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // The corridor's bright vanishing point.
        {
          svg: glowSvg(size, [
            { cx: 0.5, cy: horizon, rx: 0.22, ry: 0.2, colour: pal.light, alpha: 0.8 },
            { cx: 0.5, cy: horizon, rx: 0.46, ry: 0.4, colour: pal.primary, alpha: 0.6 },
          ]),
          blend: 'screen',
          glow: { sigma: 18, downscale: 4 },
        },
        // Rack seams marching toward the vanishing point on both walls.
        { svg: rackSeamsSvg(size, rng.fork(1), pal, horizon), blend: 'screen', glow: { sigma: 2, downscale: 2 } },
        // Ceiling cable runs and the grated floor.
        {
          svg:
            floorGridSvg(size, { horizon, vanishX: 0.5, lines: 22, colour: pal.accent, alpha: 0.2 }) +
            streaksSvg(size, rng.fork(2), {
              count: 14,
              colours: [pal.secondary],
              angle: 4,
              length: 0.9,
              alpha: 0.14,
              width: 0.0014,
            }),
          blend: 'screen',
        },
        // One warm warning strip against all that cyan — the complementary hit.
        {
          svg: glowSvg(size, [{ cx: 0.9, cy: 0.3, rx: 0.1, ry: 0.06, colour: pal.secondary, alpha: 0.75 }]),
          blend: 'screen',
          glow: { sigma: 9, downscale: 3 },
        },
        // Cold fog rolling along the floor.
        {
          svg: smokeSvg(size, rng.fork(3), {
            count: 22,
            colours: [pal.haze, pal.primary],
            alpha: 0.13,
            clearCentre: 0.2,
          }),
          blend: 'screen',
          glow: { sigma: 24, downscale: 5 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.3), blend: 'over' },
      ],
    };
  },

  ruins: ({ size, rng, pal, subjects }) => {
    const floor = 0.78;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mix(pal.deep, pal.haze, 0.5)}"/>
            <stop offset="0.5" stop-color="${mix(pal.deep, pal.haze, 0.24)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Daylight through the breach in the ceiling.
        {
          svg: beamsSvg(size, rng.fork(1), {
            count: 5,
            originY: -0.08,
            colours: [pal.light, mix(pal.light, pal.secondary, 0.35)],
            alpha: 0.5,
            spread: 0.1,
            lean: 0.12,
          }),
          blend: 'screen',
          glow: { sigma: 12, downscale: 4 },
        },
        // Far arches, washed out by dust — aerial perspective doing the work.
        {
          svg: columnsSvg(size, rng.fork(2), aerial(pal.deep, pal.haze, 0.75), floor, 8, 0.42),
          blend: 'over',
          glow: { sigma: 6, downscale: 3 },
        },
        // Near columns, nearly black, framing the frame.
        { svg: columnsSvg(size, rng.fork(3), shade(pal.deep, -0.05), floor, 4, 0.9), blend: 'over' },
        // Rubble line along the floor.
        {
          svg: ridgeSvg(size, rng.fork(4), {
            baseline: floor,
            amplitude: 0.02,
            steps: 46,
            colour: shade(pal.deep, -0.03),
          }),
          blend: 'over',
        },
        // Ash and dust suspended in the shafts.
        {
          svg: bokehSvg(size, rng.fork(5), {
            count: 260,
            colours: [pal.light, pal.haze],
            band: { top: 0.1, bottom: 0.92 },
            minR: 0.001,
            maxR: 0.005,
            alpha: 0.3,
          }),
          blend: 'screen',
          glow: { sigma: 1.6, downscale: 2 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.26), blend: 'over' },
      ],
    };
  },

  void: ({ size, rng, pal, subjects }) => ({
    base: `
      <defs>
        <radialGradient id="bg" cx="0.52" cy="0.44" r="0.72">
          <stop offset="0" stop-color="${mix(pal.deep, pal.primary, 0.4)}"/>
          <stop offset="0.4" stop-color="${mix(pal.deep, pal.primary, 0.1)}"/>
          <stop offset="1" stop-color="#03040780"/>
        </radialGradient>
      </defs>
      <rect width="${size.width}" height="${size.height}" fill="${shade(pal.deep, -0.07)}"/>
      <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
    layers: [
      // Nebula banding — very low frequency, very low contrast.
      {
        svg: smokeSvg(size, rng.fork(1), {
          count: 16,
          colours: [pal.primary, pal.secondary, pal.accent],
          alpha: 0.2,
        }),
        blend: 'screen',
        glow: { sigma: 40, downscale: 6 },
      },
      // The luminous core.
      {
        svg: glowSvg(size, [
          { cx: 0.53, cy: 0.42, rx: 0.3, ry: 0.28, colour: pal.accent, alpha: 0.55 },
          { cx: 0.53, cy: 0.42, rx: 0.12, ry: 0.11, colour: pal.light, alpha: 0.7 },
        ]),
        blend: 'screen',
        glow: { sigma: 22, downscale: 4 },
      },
      // Starfield: mostly tiny, a handful bright.
      {
        svg: bokehSvg(size, rng.fork(2), {
          count: 420,
          colours: [pal.light, '#FFFFFF', pal.accent],
          band: { top: 0.01, bottom: 0.99 },
          minR: 0.0008,
          maxR: 0.004,
          alpha: 0.6,
        }),
        blend: 'screen',
      },
      { svg: subjectClearanceSvg(size, subjects, 0.22), blend: 'over' },
    ],
  }),

  nature: ({ size, rng, pal, subjects }) => {
    const horizon = 0.66;
    const sun = { x: 0.72, y: horizon - 0.04 };
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${shade(mix(pal.deep, pal.secondary, 0.45), 0.05)}"/>
            <stop offset="${horizon - 0.2}" stop-color="${mix(pal.haze, pal.accent, 0.32)}"/>
            <stop offset="${horizon}" stop-color="${mix(pal.haze, pal.light, 0.36)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.02)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Low sun sitting on the ridgeline.
        {
          svg: glowSvg(size, [
            { cx: sun.x, cy: sun.y, rx: 0.34, ry: 0.3, colour: pal.accent, alpha: 0.85 },
            { cx: sun.x, cy: sun.y, rx: 0.07, ry: 0.06, colour: '#FFF6E2', alpha: 0.95 },
          ]),
          blend: 'screen',
          glow: { sigma: 20, downscale: 4 },
        },
        // Four stacked ridges, each washed further toward the haze colour.
        {
          svg: [0.78, 0.6, 0.42, 0.26]
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
          svg: smokeSvg(size, rng.fork(2), {
            count: 18,
            colours: [pal.light, pal.haze],
            alpha: 0.16,
          }),
          blend: 'screen',
          glow: { sigma: 30, downscale: 5 },
        },
        // Pollen and insects catching the sun.
        {
          svg: bokehSvg(size, rng.fork(3), {
            count: 180,
            colours: ['#FFF3D6', pal.accent],
            band: { top: 0.4, bottom: 0.95 },
            minR: 0.0009,
            maxR: 0.006,
            alpha: 0.4,
          }),
          blend: 'screen',
          glow: { sigma: 2, downscale: 2 },
        },
        // Dark foreground grass, heavily defocused.
        {
          svg: ridgeSvg(size, rng.fork(4), {
            baseline: 0.97,
            amplitude: 0.05,
            steps: 90,
            colour: shade(pal.deep, -0.06),
          }),
          blend: 'over',
          glow: { sigma: 9, downscale: 3 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.24), blend: 'over' },
      ],
    };
  },

  studio: ({ size, rng, pal, subjects }) => {
    const sweep = 0.74;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${shade(pal.deep, -0.02)}"/>
            <stop offset="${sweep}" stop-color="${mix(pal.deep, pal.haze, 0.3)}"/>
            <stop offset="1" stop-color="${mix(pal.deep, pal.haze, 0.12)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // One big soft key, deliberately off-centre.
        {
          svg: glowSvg(size, [{ cx: 0.44, cy: 0.44, rx: 0.5, ry: 0.46, colour: pal.light, alpha: 0.42 }]),
          blend: 'screen',
          glow: { sigma: 34, downscale: 5 },
        },
        // Two gridded accents, gelled to the brand colours.
        {
          svg: glowSvg(size, [
            { cx: 0.07, cy: 0.55, rx: 0.24, ry: 0.42, colour: pal.primary, alpha: 0.7 },
            { cx: 0.95, cy: 0.42, rx: 0.22, ry: 0.4, colour: pal.secondary, alpha: 0.7 },
          ]),
          blend: 'screen',
          glow: { sigma: 28, downscale: 5 },
        },
        // The cyc curve: a soft shadow where floor meets wall.
        {
          svg: `<rect x="0" y="${(sweep * size.height).toFixed(1)}" width="${size.width}" height="${(0.05 * size.height).toFixed(1)}" fill="${a(shade(pal.deep, -0.04), 0.55)}"/>`,
          blend: 'over',
          glow: { sigma: 18, downscale: 4 },
        },
        // Floor sheen directly under the key.
        {
          svg: glowSvg(size, [{ cx: 0.46, cy: 0.92, rx: 0.34, ry: 0.1, colour: pal.light, alpha: 0.3 }]),
          blend: 'screen',
          glow: { sigma: 16, downscale: 4 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.18), blend: 'over' },
        // A whisper of haze so the accents have body.
        {
          svg: smokeSvg(size, rng.fork(1), { count: 6, colours: [pal.light], alpha: 0.05 }),
          blend: 'screen',
          glow: { sigma: 40, downscale: 6 },
        },
      ],
    };
  },

  energy: ({ size, rng, pal, subjects }) => {
    const core = { x: 0.52, y: 0.46 };
    return {
      base: `
        <defs>
          <radialGradient id="bg" cx="${core.x}" cy="${core.y}" r="0.85">
            <stop offset="0" stop-color="${mix(pal.deep, pal.accent, 0.34)}"/>
            <stop offset="0.5" stop-color="${mix(pal.deep, pal.primary, 0.12)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.05)}"/>
          </radialGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // The core, blown out at its centre.
        {
          svg: glowSvg(size, [
            { cx: core.x, cy: core.y, rx: 0.4, ry: 0.4, colour: pal.primary, alpha: 0.75 },
            { cx: core.x, cy: core.y, rx: 0.16, ry: 0.16, colour: pal.accent, alpha: 0.9 },
            { cx: core.x, cy: core.y, rx: 0.06, ry: 0.06, colour: '#FFFFFF', alpha: 0.95 },
          ]),
          blend: 'screen',
          glow: { sigma: 22, downscale: 4 },
        },
        // Shockwave rings.
        {
          svg: [0.18, 0.3, 0.46]
            .map(
              (r, i) =>
                `<ellipse cx="${(core.x * size.width).toFixed(1)}" cy="${(core.y * size.height).toFixed(1)}" ` +
                `rx="${(r * size.width).toFixed(1)}" ry="${(r * size.height * 0.92).toFixed(1)}" fill="none" ` +
                `stroke="${a(pal.light, 0.3 - i * 0.07)}" stroke-width="${(0.003 * size.width).toFixed(2)}"/>`,
            )
            .join(''),
          blend: 'screen',
          glow: { sigma: 6, downscale: 3 },
        },
        // Radiating filaments, drawn from the core outward.
        { svg: arcsSvg(size, rng.fork(1), pal, core, 34), blend: 'screen', glow: { sigma: 2.4, downscale: 2 } },
        // Sparks streaking past the lens.
        {
          svg: bokehSvg(size, rng.fork(2), {
            count: 200,
            colours: [pal.light, pal.accent, '#FFFFFF'],
            band: { top: 0.02, bottom: 0.98 },
            minR: 0.001,
            maxR: 0.009,
            alpha: 0.5,
          }),
          blend: 'screen',
          glow: { sigma: 2.2, downscale: 2 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.3), blend: 'over' },
      ],
    };
  },

  'shattered-glass': ({ size, rng, pal, subjects }) => {
    const impact = { x: 0.31, y: 0.34 };
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stop-color="${mix(pal.deep, pal.primary, 0.2)}"/>
            <stop offset="0.6" stop-color="${shade(pal.deep, -0.02)}"/>
            <stop offset="1" stop-color="${mix(pal.deep, pal.secondary, 0.16)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // Backlight behind the plane — what the shard edges catch.
        {
          svg: glowSvg(size, [
            { cx: 0.66, cy: 0.6, rx: 0.44, ry: 0.42, colour: pal.primary, alpha: 0.75 },
            { cx: impact.x, cy: impact.y, rx: 0.2, ry: 0.2, colour: pal.accent, alpha: 0.6 },
          ]),
          blend: 'screen',
          glow: { sigma: 24, downscale: 4 },
        },
        // The fracture plane itself.
        {
          svg: shardsSvg(size, rng.fork(1), {
            count: 26,
            origin: impact,
            fill: pal.haze,
            edge: pal.light,
            alpha: 0.14,
          }),
          blend: 'screen',
        },
        // A second, larger set for the near defocused shards.
        {
          svg: shardsSvg(size, rng.fork(2), {
            count: 9,
            origin: { x: impact.x + 0.05, y: impact.y + 0.06 },
            fill: pal.accent,
            edge: pal.light,
            alpha: 0.16,
          }),
          blend: 'screen',
          glow: { sigma: 9, downscale: 3 },
        },
        // Glass dust glittering in the key.
        {
          svg: bokehSvg(size, rng.fork(3), {
            count: 240,
            colours: ['#FFFFFF', pal.light, pal.accent],
            band: { top: 0.02, bottom: 0.98 },
            minR: 0.0008,
            maxR: 0.005,
            alpha: 0.45,
          }),
          blend: 'screen',
          glow: { sigma: 1.5, downscale: 2 },
        },
        { svg: subjectClearanceSvg(size, subjects, 0.26), blend: 'over' },
      ],
    };
  },

  smoke: ({ size, rng, pal, subjects }) => ({
    base: `
      <defs>
        <linearGradient id="bg" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="${mix(pal.deep, pal.accent, 0.24)}"/>
          <stop offset="0.4" stop-color="${shade(pal.deep, -0.01)}"/>
          <stop offset="1" stop-color="${shade(pal.deep, -0.05)}"/>
        </linearGradient>
      </defs>
      <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
    layers: [
      // Ember light from below — the warm base of the temperature split.
      {
        svg: glowSvg(size, [{ cx: 0.5, cy: 1.02, rx: 0.6, ry: 0.34, colour: pal.accent, alpha: 0.6 }]),
        blend: 'screen',
        glow: { sigma: 30, downscale: 5 },
      },
      // Side key defining the smoke edges.
      {
        svg: glowSvg(size, [{ cx: 0.06, cy: 0.32, rx: 0.34, ry: 0.44, colour: pal.primary, alpha: 0.7 }]),
        blend: 'screen',
        glow: { sigma: 26, downscale: 5 },
      },
      // Dense columns at the edges, clear pocket at the centre.
      {
        svg: smokeSvg(size, rng.fork(1), {
          count: 46,
          colours: [pal.haze, pal.light, pal.primary],
          alpha: 0.15,
          clearCentre: 0.34,
        }),
        blend: 'screen',
        glow: { sigma: 26, downscale: 4 },
      },
      // Thin wisps peeling off, sharper than the body.
      {
        svg: smokeSvg(size, rng.fork(2), {
          count: 20,
          colours: [pal.light],
          alpha: 0.07,
          clearCentre: 0.4,
        }),
        blend: 'screen',
        glow: { sigma: 9, downscale: 3 },
      },
      { svg: subjectClearanceSvg(size, subjects, 0.24), blend: 'over' },
    ],
  }),

  'neon-city': ({ size, rng, pal, subjects }) => {
    const road = 0.7;
    return {
      base: `
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${shade(mix(pal.deep, pal.secondary, 0.34), 0.02)}"/>
            <stop offset="0.42" stop-color="${mix(pal.deep, pal.haze, 0.4)}"/>
            <stop offset="${road}" stop-color="${mix(pal.deep, pal.haze, 0.16)}"/>
            <stop offset="1" stop-color="${shade(pal.deep, -0.04)}"/>
          </linearGradient>
        </defs>
        <rect width="${size.width}" height="${size.height}" fill="url(#bg)"/>`,
      layers: [
        // The bright gap at the end of the street.
        {
          svg: glowSvg(size, [
            { cx: 0.5, cy: road - 0.1, rx: 0.3, ry: 0.22, colour: pal.light, alpha: 0.55 },
            { cx: 0.5, cy: road - 0.06, rx: 0.55, ry: 0.34, colour: pal.primary, alpha: 0.45 },
          ]),
          blend: 'screen',
          glow: { sigma: 22, downscale: 4 },
        },
        // Far towers, hazed almost flat.
        {
          svg: skylineSvg(size, rng.fork(1), {
            baseline: road - 0.02,
            minH: 0.16,
            maxH: 0.42,
            colour: aerial(shade(pal.deep, -0.01), pal.haze, 0.72),
            windowColour: pal.light,
            windowAlpha: 0.35,
            count: 26,
            clearCentre: 0.26,
          }),
          blend: 'over',
          glow: { sigma: 4, downscale: 3 },
        },
        // Near towers: nearly black silhouettes with hot neon on the facades.
        {
          svg: skylineSvg(size, rng.fork(2), {
            baseline: road,
            minH: 0.3,
            maxH: 0.72,
            colour: shade(pal.deep, -0.06),
            windowColour: pal.accent,
            windowAlpha: 0.75,
            count: 12,
            clearCentre: 0.4,
          }),
          blend: 'over',
        },
        // Neon signage stacked up the canyon walls.
        { svg: neonSignsSvg(size, rng.fork(3), pal, road), blend: 'screen', glow: { sigma: 5, downscale: 3 } },
        // Wet asphalt: long vertical specular smears of everything above.
        {
          svg: `<rect x="0" y="${(road * size.height).toFixed(1)}" width="${size.width}" height="${size.height}" fill="${a(shade(pal.deep, -0.03), 0.55)}"/>` +
            streaksSvg(size, rng.fork(4), {
              count: 40,
              colours: [pal.accent, pal.primary, pal.secondary],
              angle: 90,
              length: 0.28,
              alpha: 0.3,
              width: 0.005,
            }),
          blend: 'screen',
          glow: { sigma: 11, downscale: 3 },
        },
        // Light rain through the signage.
        {
          svg: streaksSvg(size, rng.fork(5), {
            count: 130,
            colours: [pal.light],
            angle: 82,
            length: 0.05,
            alpha: 0.18,
            width: 0.0009,
          }),
          blend: 'screen',
        },
        { svg: subjectClearanceSvg(size, subjects, 0.32), blend: 'over' },
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
    const thickness = rng.float(0.004, 0.03) * h;
    const colour = colours[i % colours.length] ?? pal.light;
    out.push(
      `<path d="M ${-0.05 * w} ${y0.toFixed(1)} C ${(0.3 * w).toFixed(1)} ${(y0 + c1).toFixed(1)}, ` +
        `${(0.7 * w).toFixed(1)} ${(y1 + c2).toFixed(1)}, ${(1.05 * w).toFixed(1)} ${y1.toFixed(1)}" ` +
        `fill="none" stroke="${a(colour, rng.float(0.28, 0.62))}" stroke-width="${thickness.toFixed(2)}" ` +
        `stroke-linecap="round"/>`,
    );
  }
  return out.join('');
}

/** Emissive rack seams converging on the vanishing point. */
function rackSeamsSvg(size: Size, rng: Rng, pal: Palette, horizon: number): string {
  const { width: w, height: h } = size;
  const hy = horizon * h;
  const out: string[] = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 1; i <= 9; i++) {
      const t = (i / 9) ** 1.7;
      const x = 0.5 * w + side * (0.06 + t * 0.6) * w;
      const top = hy - (0.04 + t * 0.4) * h;
      const bottom = hy + (0.04 + t * 0.42) * h;
      const colour = rng.bool(0.78) ? pal.primary : pal.accent;
      out.push(
        `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(0.004 * w * (0.4 + t)).toFixed(2)}" ` +
          `height="${(bottom - top).toFixed(1)}" fill="${a(colour, 0.35 + t * 0.45)}"/>`,
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
    const x = rng.float(0.02, 0.94) * w;
    const cw = rng.float(0.02, 0.075) * w;
    const top = rng.float(0.02, 0.5) * h;
    // Snapped-off tops: a column that ends in a flat line reads as a rectangle.
    const notch = rng.float(0.01, 0.05) * h;
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
    const len = rng.float(0.14, 0.62) * Math.max(w, h);
    const bend = rng.float(-0.5, 0.5);
    const ex = cx + Math.cos(ang) * len;
    const ey = cy + Math.sin(ang) * len;
    const mx = cx + Math.cos(ang + bend) * len * 0.55;
    const my = cy + Math.sin(ang + bend) * len * 0.55;
    const colour = colours[rng.int(0, colours.length - 1)] ?? pal.light;
    out.push(
      `<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}" ` +
        `fill="none" stroke="${a(colour, rng.float(0.2, 0.6))}" stroke-width="${(rng.float(0.0006, 0.0028) * w).toFixed(2)}" ` +
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
  for (let i = 0; i < 22; i++) {
    const left = rng.bool();
    const x = left ? rng.float(0.01, 0.3) : rng.float(0.7, 0.99);
    const y = rng.float(0.06, road - 0.06);
    const vertical = rng.bool(0.45);
    const long = rng.float(0.03, 0.12);
    const thin = rng.float(0.004, 0.011);
    const colour = colours[rng.int(0, colours.length - 1)] ?? pal.accent;
    out.push(
      `<rect x="${(x * w).toFixed(1)}" y="${(y * h).toFixed(1)}" ` +
        `width="${((vertical ? thin : long) * w).toFixed(1)}" height="${((vertical ? long : thin) * h).toFixed(1)}" ` +
        `rx="${(thin * w * 0.4).toFixed(1)}" fill="${a(colour, rng.float(0.45, 0.95))}"/>`,
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
  layers.push({ input: await rasterise(vignetteSvg(size, 0.62 * (0.6 + strength * 0.5)), size), blend: 'over' });
  layers.push({ input: await grainLayer(size, rng.fork(99), 0.05 + strength * 0.03), blend: 'soft-light' });

  const composited = await sharp(base)
    .composite(layers as sharp.OverlayOptions[])
    .png()
    .toBuffer();

  // Final grade: a touch of contrast and chroma, then a light sharpen so the
  // plate still has edge definition after the compositor's own resize.
  const buffer = await sharp(composited)
    .removeAlpha()
    .modulate({ saturation: 1.04 + strength * 0.08 })
    .linear(1.05, -7)
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
