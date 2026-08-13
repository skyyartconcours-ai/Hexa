/**
 * DRAFT — pick & ban and champion pools.
 *
 * Draft content is inherently about *objects* (champions) attached to *people*,
 * so both layouts give the objects their own architecture — tall pick panels,
 * a tile grid — and let the player occupy the human-scale foreground.
 */

import type { Slot, ThumbnailTemplate } from '@hexa/core';
import {
  RATIO_16_9,
  WIDE_ASPECTS,
  Z,
  badgeSlot,
  blockSlot,
  bustSlot,
  fxSlot,
  hazeSlot,
  inwardBust,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

// ── pickban-duel ─────────────────────────────────────────────────────────────

const pickbanDuel: ThumbnailTemplate = {
  id: 'pickban-duel',
  name: 'Pick & Ban Duel',
  category: 'draft',
  description:
    'Two tall champion pick panels leaning toward each other with the players standing in front of them and a ban strip running along the bottom edge.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['draft', 'pickban', 'champions', 'panels', 'matchup', 'lane'],
  whenToUse:
    'Lane-matchup and draft-analysis videos where the champions matter as much as the players — the panels give the champion art a frame instead of a collage.',
  layout: {
    id: 'pickban-duel',
    name: 'Pick & Ban Duel',
    description: 'Leaning pick panels at 0.08 / 0.56, players in front with faces at y 0.64, ban strip at y 0.885.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'grid', gridScale: 0.05 } }),
      blockSlot('panel-left', { x: 0.08, y: 0.1, w: 0.36, h: 0.52 }, {
        z: Z.backplate + 1,
        meta: { shape: 'parallelogram', lean: 0.06, fill: 'left', content: 'champion-splash', side: 'left' },
      }),
      blockSlot('panel-right', { x: 0.56, y: 0.1, w: 0.36, h: 0.52 }, {
        z: Z.backplate + 2,
        meta: { shape: 'parallelogram', lean: -0.06, fill: 'right', content: 'champion-splash', side: 'right' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.26 } }),
      inwardBust('subject-left', { x: 0.02, y: 0.34, w: 0.44, h: 0.66 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.6, y: 0.45 },
        constraints: { faceKeepIn: { x: 0.18, y: 0.5, w: 0.24, h: 0.26 } },
        meta: { preferFacing: 'right', faceHeight: 0.18, side: 'left', rimAngle: 205 },
      }),
      inwardBust('subject-right', { x: 0.54, y: 0.34, w: 0.44, h: 0.66 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        focal: { x: 0.4, y: 0.45 },
        constraints: { faceKeepIn: { x: 0.58, y: 0.5, w: 0.24, h: 0.26 } },
        meta: { preferFacing: 'left', faceHeight: 0.18, side: 'right', rimAngle: 335 },
      }),
      fxSlot('panel-glow', { x: 0.06, y: 0.08, w: 0.88, h: 0.56 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'edge-glow', fill: 'accent', intensity: 0.4 },
      }),
      shapeSlot('vs-mark', { x: 0.435, y: 0.235, w: 0.13, h: 0.13 }, {
        z: Z.shape,
        rotation: 45,
        meta: { shape: 'diamond', fill: 'dark', stroke: 'light' },
      }),
      shapeSlot('ban-strip', { x: 0.04, y: 0.885, w: 0.72, h: 0.075 }, {
        z: Z.shape + 1,
        meta: { shape: 'ban-strip', count: 6, fill: 'dark', desaturate: 1, stroke: 'accent' },
      }),
      textSlot('vs', { x: 0.44, y: 0.245, w: 0.12, h: 0.11 }, {
        z: Z.text,
        meta: { weight: 'black', italic: true },
      }),
      textSlot('left-team', { x: 0.08, y: 0.055, w: 0.36, h: 0.05 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'bold', tracking: 0.14, content: 'champion' },
      }),
      textSlot('right-team', { x: 0.56, y: 0.055, w: 0.36, h: 0.05 }, {
        z: Z.text + 2,
        anchor: 'center-right',
        meta: { weight: 'bold', tracking: 0.14, content: 'champion' },
      }),
      textSlot('kicker', { x: 0.42, y: 0.125, w: 0.16, h: 0.05 }, {
        z: Z.text + 3,
        meta: { weight: 'semibold', tracking: 0.18 },
      }),
      textSlot('left-name', { x: 0.05, y: 0.775, w: 0.3, h: 0.085 }, {
        z: Z.text + 4,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('right-name', { x: 0.45, y: 0.775, w: 0.3, h: 0.085 }, {
        z: Z.text + 5,
        anchor: 'center-right',
        meta: { weight: 'black' },
      }),
      badgeSlot('badge', { x: 0.79, y: 0.775, w: 0.17, h: 0.06 }, {
        z: Z.badge,
        anchor: 'center-right',
        opacity: 0.9,
        meta: { shape: 'tag', fill: 'light', note: 'patch number, parked above the duration-pill line' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('ban-row', { x: 0.02, y: 0.87, w: 0.76, h: 0.11 }, 'Ban strip — keep player art above it.'),
    ]),
    focalPoints: [
      { x: 0.284, y: 0.637 },
      { x: 0.716, y: 0.637 },
      { x: 0.5, y: 0.3 },
      { x: 0.26, y: 0.36 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'neon-wash',
    backdrop: 'grid',
    brandStrength: 0.7,
    atmosphere: {
      haze: 0.26,
      particles: { kind: 'dust', density: 0.25, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 205, width: 3, color: '#8FD7FF', intensity: 0.75 },
      stroke: { width: 2, color: '#080B12' },
      shadow: { dx: 0, dy: 8, blur: 24, color: '#000000', opacity: 0.5 },
      contrast: 1.08,
      saturation: 1.04,
    },
    grade: {
      exposure: 0,
      contrast: 1.16,
      saturation: 1.06,
      temperature: -4,
      shadowTint: '#0A1424',
      highlightTint: '#E8F3FF',
      splitToneBalance: 0.52,
      lut: 'cold-steel',
      lutStrength: 0.45,
      grain: 0.07,
      bloomThreshold: 0.72,
      bloomIntensity: 0.34,
      vignette: 0.38,
      chromaticAberration: 1,
    },
  },
  textSlots: [
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 16, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 16, transform: 'upper' },
    { role: 'vs', slotId: 'vs', required: false, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, defaultText: 'DRAFT', maxChars: 10, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 10, transform: 'upper' },
  ],
};

// ── champion-pool ────────────────────────────────────────────────────────────

/** Six champion tiles, 3×2, inside the right-hand field. */
function poolTiles(): Slot[] {
  const area = { x: 0.46, y: 0.22, w: 0.5, h: 0.5 };
  const gap = 0.014;
  const tw = (area.w - gap * 2) / 3;
  const th = (area.h - gap) / 2;
  const out: Slot[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      out.push(
        shapeSlot(
          `tile-${i}`,
          { x: area.x + col * (tw + gap), y: area.y + row * (th + gap), w: tw, h: th },
          {
            z: Z.shape + i,
            meta: { shape: 'champion-tile', index: i, stroke: 'accent', radius: 0.008, rank: i + 1 },
          },
        ),
      );
    }
  }
  return out;
}

const championPool: ThumbnailTemplate = {
  id: 'champion-pool',
  name: 'Champion Pool',
  category: 'draft',
  description:
    'One player anchored on the left third against a six-tile champion grid — a catalogue layout that stays legible even when every tile is unfamiliar art.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['draft', 'champion-pool', 'grid', 'tiles', 'catalogue', 'single'],
  whenToUse:
    'Champion-pool reviews, "every champ he plays" videos and meta breakdowns. The tile grid promises a list without needing a number in the headline.',
  layout: {
    id: 'champion-pool',
    name: 'Champion Pool',
    description: 'Left-third bust, 3×2 champion tile grid from x 0.46, headline above the grid.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 100 } }),
      blockSlot('left-wash', { x: 0, y: 0, w: 0.46, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', fill: 'left', opacity: 0.55 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.2 } }),
      bustSlot('subject', { x: -0.02, y: 0.08, w: 0.44, h: 0.92 }, {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.64, y: 0.3 },
        constraints: { faceKeepIn: { x: 0.16, y: 0.2, w: 0.24, h: 0.3 } },
        meta: { faceHeight: 0.24, preferFacing: 'right', rimAngle: 210 },
      }),
      fxSlot('tile-glow', { x: 0.44, y: 0.2, w: 0.54, h: 0.54 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'edge-glow', fill: 'accent', intensity: 0.3 },
      }),
      ...poolTiles(),
      shapeSlot('grid-rule', { x: 0.46, y: 0.208, w: 0.5, h: 0.003 }, {
        z: Z.shape + 6,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      textSlot('headline', { x: 0.46, y: 0.055, w: 0.5, h: 0.09 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('kicker', { x: 0.46, y: 0.155, w: 0.3, h: 0.05 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.22 },
      }),
      textSlot('caption', { x: 0.46, y: 0.735, w: 0.34, h: 0.06 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.845, w: 0.3, h: 0.08 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('tile-grid', { x: 0.44, y: 0.2, w: 0.54, h: 0.54 }, 'Champion tiles — the cutout must not spill across them.'),
    ]),
    focalPoints: [
      { x: 0.262, y: 0.356 },
      { x: 0.71, y: 0.1 },
      { x: 0.54, y: 0.345 },
      { x: 0.195, y: 0.885 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'top-key',
    backdrop: 'gradient',
    brandStrength: 0.6,
    atmosphere: {
      haze: 0.2,
      particles: { kind: 'dust', density: 0.22, bias: 'left' },
    },
    subjectEffects: {
      rimLight: { angle: 210, width: 3, color: '#C7D8FF', intensity: 0.65 },
      shadow: { dx: 0, dy: 8, blur: 26, color: '#000000', opacity: 0.55 },
      contrast: 1.12,
      saturation: 0.94,
    },
    grade: {
      exposure: -0.08,
      contrast: 1.2,
      saturation: 0.88,
      temperature: -6,
      shadowTint: '#0E1422',
      highlightTint: '#E7EDF8',
      splitToneBalance: 0.56,
      lut: 'neo-noir',
      lutStrength: 0.5,
      grain: 0.1,
      bloomThreshold: 0.82,
      bloomIntensity: 0.2,
      vignette: 0.44,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 28, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 20, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 26, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 16, transform: 'upper' },
  ],
};

export const draftTemplates: ThumbnailTemplate[] = [pickbanDuel, championPool];
