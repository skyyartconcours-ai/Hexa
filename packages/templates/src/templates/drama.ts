/**
 * DRAMA — reaction and controversy.
 *
 * Two ways to make a frame feel like an argument. `drama-reaction` throws scale
 * at it: one face at 40%+ of canvas height, mouth open, headline hammered down
 * the opposite third. `controversy-split` does the opposite — it turns the two
 * subjects *away* from each other, which is the only versus-shaped composition
 * in the library that deliberately breaks the face-inward rule, because the
 * subject of the video is the rift itself.
 */

import type { ThumbnailTemplate } from '@hexa/core';
import {
  RATIO_16_9,
  WIDE_ASPECTS,
  WIDE_AND_SQUARE,
  Z,
  badgeSlot,
  blockSlot,
  bustSlot,
  fxSlot,
  hazeSlot,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

// ── drama-reaction ───────────────────────────────────────────────────────────

const dramaReaction: ThumbnailTemplate = {
  id: 'drama-reaction',
  name: 'Drama Reaction',
  category: 'drama',
  description:
    'One face at 40% of canvas height blown off the right edge, lit from below, with a three-line screaming headline stacked hard against the left margin.',
  aspects: WIDE_AND_SQUARE,
  subjects: { min: 1, max: 1 },
  tags: ['drama', 'reaction', 'face', 'shock', 'big-text', 'loud', 'under-glow'],
  whenToUse:
    'Upsets, meltdowns, "he actually said that" clips. Requires a photograph with a real expression — on a neutral press shot this layout collapses.',
  layout: {
    id: 'drama-reaction',
    name: 'Drama Reaction',
    description: 'Oversized face bleeding right, headline column on the left margin, red flash behind.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial', center: [0.66, 0.34] } }),
      blockSlot('flash', { x: 0.3, y: 0, w: 0.7, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'burst-block', fill: 'accent', opacity: 0.5 },
      }),
      fxSlot('shout-rays', { x: 0.34, y: -0.05, w: 0.66, h: 0.8 }, {
        z: Z.atmosphereBack,
        meta: { fx: 'rays', angle: 0, count: 16, intensity: 0.5, radial: true },
      }),
      hazeSlot('haze', { z: Z.atmosphereBack + 1, meta: { fx: 'haze', density: 0.24 } }),
      bustSlot('subject', { x: 0.28, y: -0.06, w: 0.8, h: 1.1 }, {
        z: Z.subject,
        anchor: 'bottom-right',
        fit: 'face-anchor',
        focal: { x: 0.46, y: 0.34 },
        constraints: { faceKeepIn: { x: 0.5, y: 0.14, w: 0.36, h: 0.38 } },
        meta: { faceHeight: 0.42, preferFacing: 'left', keyFrom: 'below', rimAngle: 300 },
      }),
      fxSlot('speed', { x: 0.0, y: 0.1, w: 1, h: 0.8 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'speed-lines', angle: 8, density: 0.35 },
      }),
      shapeSlot('headline-slab', { x: 0.02, y: 0.265, w: 0.37, h: 0.33 }, {
        z: Z.shape,
        meta: { shape: 'bar', fill: 'dark', opacity: 0.55, skew: 0.02 },
      }),
      textSlot('kicker', { x: 0.035, y: 0.185, w: 0.28, h: 0.07 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'bold', tracking: 0.2 },
      }),
      textSlot('headline', { x: 0.035, y: 0.28, w: 0.34, h: 0.3 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 3, leading: 0.82, stroke: 0.014 },
      }),
      textSlot('subhead', { x: 0.035, y: 0.6, w: 0.32, h: 0.075 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      badgeSlot('badge', { x: 0.035, y: 0.845, w: 0.26, h: 0.08 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('headline-column', { x: 0.02, y: 0.16, w: 0.38, h: 0.52 }, 'Headline column — the cutout must stay right of it.'),
    ]),
    focalPoints: [
      { x: 0.648, y: 0.314 },
      { x: 0.205, y: 0.43 },
      { x: 0.175, y: 0.22 },
      { x: 0.165, y: 0.885 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'under-glow',
    backdrop: 'radial',
    brandStrength: 0.55,
    atmosphere: {
      haze: 0.24,
      particles: { kind: 'spark', density: 0.3, bias: 'right' },
      speedLines: { angle: 8, density: 0.35, color: '#FFFFFF' },
    },
    subjectEffects: {
      rimLight: { angle: 300, width: 4, color: '#FF4D4D', intensity: 0.9 },
      glow: { radius: 30, color: '#FF2E2E', intensity: 0.45 },
      contrast: 1.18,
      saturation: 1.2,
    },
    grade: {
      exposure: 0.08,
      contrast: 1.3,
      saturation: 1.3,
      temperature: 8,
      shadowTint: '#2C0610',
      highlightTint: '#FFD6C2',
      splitToneBalance: 0.38,
      lut: 'crimson-contrast',
      lutStrength: 0.65,
      grain: 0.16,
      bloomThreshold: 0.6,
      bloomIntensity: 0.55,
      vignette: 0.5,
      chromaticAberration: 3,
      halation: 0.45,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 30, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 20, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 34, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 16, transform: 'upper' },
  ],
};

// ── controversy-split ────────────────────────────────────────────────────────

const controversySplit: ThumbnailTemplate = {
  id: 'controversy-split',
  name: 'Controversy Split',
  category: 'drama',
  description:
    'Two subjects turned away from each other with a torn seam between them and a full-width headline band driven through the middle of the frame.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['drama', 'controversy', 'split', 'tear', 'facing-out', 'tabloid', 'rift'],
  whenToUse:
    'Fallouts, feuds and he-said-she-said stories. The outward facing is the whole point: these two are not looking at each other any more.',
  layout: {
    id: 'controversy-split',
    name: 'Controversy Split',
    description: 'Outward-facing busts at 0.24 / 0.76, torn seam, headline band across y 0.40–0.60.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'abstract' } }),
      blockSlot('block-left', { x: 0, y: 0, w: 0.51, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'torn-half', side: 'left', fill: 'left', roughness: 0.4 },
      }),
      blockSlot('block-right', { x: 0.49, y: 0, w: 0.51, h: 1 }, {
        z: Z.backplate + 2,
        meta: { shape: 'torn-half', side: 'right', fill: 'right', roughness: 0.4 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.3 } }),
      fxSlot('smoke', { x: 0.3, y: -0.05, w: 0.4, h: 1.1 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'particles', particles: 'smoke', density: 0.45, bias: 'center' },
      }),
      bustSlot('subject-left', { x: -0.05, y: 0.04, w: 0.52, h: 0.96 }, {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.55, y: 0.28 },
        constraints: { faceKeepIn: { x: 0.12, y: 0.16, w: 0.26, h: 0.3 } },
        // Deliberately outward: the rift is the subject of the picture.
        meta: { preferFacing: 'left', faceHeight: 0.26, side: 'left', rimAngle: 210 },
      }),
      bustSlot('subject-right', { x: 0.53, y: 0.04, w: 0.52, h: 0.96 }, {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        focal: { x: 0.45, y: 0.28 },
        constraints: { faceKeepIn: { x: 0.62, y: 0.16, w: 0.26, h: 0.3 } },
        meta: { preferFacing: 'right', faceHeight: 0.26, side: 'right', rimAngle: 330 },
      }),
      fxSlot('tear-glow', { x: 0.42, y: -0.06, w: 0.16, h: 1.12 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'glow-seam', jagged: true },
      }),
      shapeSlot('headline-band', { x: 0, y: 0.4, w: 1, h: 0.2 }, {
        z: Z.shape,
        rotation: -2,
        meta: { shape: 'bar', fill: 'dark', opacity: 0.88, stroke: 'accent' },
      }),
      shapeSlot('question-mark', { x: 0.76, y: 0.415, w: 0.18, h: 0.17 }, {
        z: Z.shape + 1,
        rotation: -2,
        meta: { shape: 'glyph', glyph: '?', fill: 'accent' },
      }),
      textSlot('headline', { x: 0.06, y: 0.425, w: 0.66, h: 0.15 }, {
        z: Z.text,
        anchor: 'center-left',
        rotation: -2,
        meta: { weight: 'black', lines: 2, leading: 0.86 },
      }),
      textSlot('left-name', { x: 0.05, y: 0.775, w: 0.3, h: 0.085 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'bold' },
      }),
      textSlot('right-name', { x: 0.45, y: 0.775, w: 0.3, h: 0.085 }, {
        z: Z.text + 2,
        anchor: 'center-right',
        meta: { weight: 'bold' },
      }),
      textSlot('kicker', { x: 0.35, y: 0.05, w: 0.3, h: 0.06 }, {
        z: Z.text + 3,
        meta: { weight: 'semibold', tracking: 0.24 },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.05, w: 0.2, h: 0.07 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'tag', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('band-corridor', { x: 0, y: 0.38, w: 1, h: 0.24 }, 'The headline band cuts the frame — keep faces above it.'),
    ]),
    focalPoints: [
      { x: 0.236, y: 0.309 },
      { x: 0.764, y: 0.309 },
      { x: 0.39, y: 0.5 },
      { x: 0.85, y: 0.5 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'neon-wash',
    backdrop: 'abstract',
    brandStrength: 0.6,
    atmosphere: {
      haze: 0.3,
      particles: { kind: 'smoke', density: 0.45, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 210, width: 3, color: '#FFFFFF', intensity: 0.7 },
      shadow: { dx: 0, dy: 8, blur: 30, color: '#000000', opacity: 0.6 },
      contrast: 1.16,
      saturation: 0.9,
    },
    grade: {
      exposure: -0.06,
      contrast: 1.32,
      saturation: 0.86,
      temperature: -4,
      shadowTint: '#181C24',
      highlightTint: '#FFF2E4',
      splitToneBalance: 0.56,
      lut: 'bleach-bypass',
      lutStrength: 0.7,
      grain: 0.18,
      bloomThreshold: 0.82,
      bloomIntensity: 0.2,
      vignette: 0.46,
      chromaticAberration: 1.4,
      halation: 0.12,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 40, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: false, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: false, maxChars: 14, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 22, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 14, transform: 'upper' },
  ],
};

export const dramaTemplates: ThumbnailTemplate[] = [dramaReaction, controversySplit];
