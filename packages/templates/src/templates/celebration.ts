/**
 * CELEBRATION — trophies and coronations.
 *
 * Joy reads as upward motion and warm light. `trophy-lift` puts the energy on a
 * diagonal — raised arms in the right half, type driving up the left — while
 * `champion-crowned` goes dead symmetric, because a coronation is a ceremony
 * and ceremonies are centred.
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
  logoSlot,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

// ── trophy-lift ──────────────────────────────────────────────────────────────

const trophyLift: ThumbnailTemplate = {
  id: 'trophy-lift',
  name: 'Trophy Lift',
  category: 'celebration',
  description:
    'Low-angle full-body lift in the right half — arms and silverware breaking the top edge — with confetti falling through stage beams and the headline climbing the left third.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['celebration', 'trophy', 'champion', 'confetti', 'stage', 'euphoric', 'gold'],
  whenToUse:
    'The moment itself: title wins, first trophies, grand-final recaps. Needs a raised-arms photograph; a seated or neutral shot wastes the whole composition.',
  layout: {
    id: 'trophy-lift',
    name: 'Trophy Lift',
    description: 'Figure at 0.68 with the face high at y 0.18, type column left, confetti front-loaded.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'arena' } }),
      blockSlot('spot', { x: 0.4, y: 0, w: 0.6, h: 0.9 }, {
        z: Z.backplate + 1,
        meta: { shape: 'cone', fill: 'accent', opacity: 0.4 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.5 } }),
      fxSlot('beams', { x: 0.3, y: -0.12, w: 0.8, h: 1.0 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'rays', angle: 78, count: 7, intensity: 0.5 },
      }),
      bustSlot('subject', { x: 0.44, y: -0.02, w: 0.6, h: 1.02 }, {
        z: Z.subject,
        anchor: 'bottom-center',
        fit: 'full',
        focal: { x: 0.4, y: 0.2 },
        constraints: { faceKeepIn: { x: 0.56, y: 0.08, w: 0.26, h: 0.24 } },
        meta: { faceHeight: 0.18, preferFacing: 'left', pose: 'arms-up', rimAngle: 78 },
      }),
      fxSlot('confetti', { x: -0.05, y: -0.1, w: 1.1, h: 1.15 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'particles', particles: 'confetti', density: 0.75, bias: 'center' },
      }),
      fxSlot('floor-fog', { x: -0.05, y: 0.74, w: 1.1, h: 0.32 }, {
        z: Z.atmosphereFront + 1,
        meta: { fx: 'fog', height: 0.24 },
      }),
      shapeSlot('type-rule', { x: 0.05, y: 0.305, w: 0.18, h: 0.005 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      textSlot('kicker', { x: 0.05, y: 0.235, w: 0.28, h: 0.06 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.26 },
      }),
      textSlot('headline', { x: 0.05, y: 0.325, w: 0.36, h: 0.26 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 2, leading: 0.86 },
      }),
      textSlot('subhead', { x: 0.05, y: 0.6, w: 0.32, h: 0.07 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      textSlot('date', { x: 0.05, y: 0.69, w: 0.22, h: 0.05 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'regular', tracking: 0.2 },
      }),
      badgeSlot('badge', { x: 0.05, y: 0.845, w: 0.28, h: 0.08 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('lift-column', { x: 0.42, y: 0, w: 0.58, h: 1 }, 'Raised arms and silverware own the right half.'),
    ]),
    focalPoints: [
      { x: 0.68, y: 0.184 },
      { x: 0.23, y: 0.455 },
      { x: 0.19, y: 0.265 },
      { x: 0.19, y: 0.885 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'stage',
    backdrop: 'arena',
    brandStrength: 0.7,
    atmosphere: {
      haze: 0.5,
      fog: 0.24,
      particles: { kind: 'confetti', density: 0.75, bias: 'center' },
      rays: { angle: 78, count: 7, intensity: 0.5, color: '#FFE9B0' },
    },
    subjectEffects: {
      rimLight: { angle: 78, width: 5, color: '#FFDE9B', intensity: 1 },
      glow: { radius: 24, color: '#FFC44D', intensity: 0.4 },
      contrast: 1.08,
      saturation: 1.08,
    },
    grade: {
      exposure: 0.12,
      contrast: 1.16,
      saturation: 1.16,
      temperature: 16,
      shadowTint: '#241505',
      highlightTint: '#FFE7B4',
      splitToneBalance: 0.38,
      lut: 'ember',
      lutStrength: 0.55,
      grain: 0.09,
      bloomThreshold: 0.6,
      bloomIntensity: 0.62,
      vignette: 0.36,
      halation: 0.42,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 28, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 22, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 32, transform: 'upper' },
    { role: 'date', slotId: 'date', required: false, maxChars: 12, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 16, transform: 'upper' },
  ],
};

// ── champion-crowned ─────────────────────────────────────────────────────────

const championCrowned: ThumbnailTemplate = {
  id: 'champion-crowned',
  name: 'Champion Crowned',
  category: 'celebration',
  description:
    'Dead-centre bust haloed by a glowing ring and the org crest, with a full-width champion band across the lower third and gold confetti drifting through.',
  aspects: WIDE_AND_SQUARE,
  subjects: { min: 1, max: 1 },
  tags: ['celebration', 'champion', 'symmetry', 'halo', 'crest', 'gold', 'ceremonial'],
  whenToUse:
    'Title cards and season-in-review openers. The symmetry makes it work as a square post too, which trophy-lift will not survive.',
  layout: {
    id: 'champion-crowned',
    name: 'Champion Crowned',
    description: 'Centred bust with halo at (0.5, 0.28), champion band y 0.70–0.86, everything mirrored.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial', center: [0.5, 0.32] } }),
      logoSlot('crest-halo', { x: 0.34, y: 0.1, w: 0.32, h: 0.32 }, {
        z: Z.backplate + 1,
        opacity: 0.45,
        meta: { blur: 0.01, fill: 'left' },
      }),
      fxSlot('halo-ring', { x: 0.3, y: 0.08, w: 0.4, h: 0.4 }, {
        z: Z.atmosphereBack,
        meta: { fx: 'ring-glow', fill: 'accent', intensity: 0.8 },
      }),
      hazeSlot('haze', { z: Z.atmosphereBack + 1, meta: { fx: 'haze', density: 0.4 } }),
      bustSlot('subject', { x: 0.24, y: 0.06, w: 0.52, h: 0.94 }, {
        z: Z.subject,
        anchor: 'bottom-center',
        focal: { x: 0.5, y: 0.28 },
        constraints: { faceKeepIn: { x: 0.38, y: 0.18, w: 0.24, h: 0.28 } },
        meta: { faceHeight: 0.28, preferFacing: 'center', rimAngle: 90 },
      }),
      fxSlot('confetti', { x: -0.05, y: -0.1, w: 1.1, h: 1.15 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'particles', particles: 'confetti', density: 0.55, bias: 'center', color: '#FFD27A' },
      }),
      shapeSlot('champion-band', { x: 0, y: 0.7, w: 1, h: 0.16 }, {
        z: Z.shape,
        meta: { shape: 'bar', fill: 'accent', opacity: 0.95 },
      }),
      shapeSlot('band-rule-top', { x: 0, y: 0.692, w: 1, h: 0.004 }, {
        z: Z.shape + 1,
        meta: { shape: 'rule', fill: 'light' },
      }),
      textSlot('headline', { x: 0.18, y: 0.71, w: 0.64, h: 0.125 }, {
        z: Z.text,
        meta: { weight: 'black', tracking: 0.08 },
      }),
      textSlot('subhead', { x: 0.3, y: 0.875, w: 0.4, h: 0.06 }, {
        z: Z.text + 1,
        meta: { weight: 'medium', tracking: 0.18 },
      }),
      textSlot('kicker', { x: 0.35, y: 0.045, w: 0.3, h: 0.055 }, {
        z: Z.text + 2,
        meta: { weight: 'semibold', tracking: 0.28 },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.045, w: 0.18, h: 0.065 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'light' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('halo-field', { x: 0.28, y: 0.06, w: 0.44, h: 0.44 }, 'Halo and head — nothing else enters this disc.'),
    ]),
    focalPoints: [
      { x: 0.5, y: 0.323 },
      { x: 0.5, y: 0.772 },
      { x: 0.5, y: 0.905 },
      { x: 0.5, y: 0.16 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'backlit',
    backdrop: 'radial',
    brandStrength: 0.85,
    atmosphere: {
      haze: 0.4,
      particles: { kind: 'confetti', density: 0.55, color: '#FFD27A', bias: 'center' },
      rays: { angle: 90, count: 10, intensity: 0.35, color: '#FFE3A6' },
    },
    subjectEffects: {
      rimLight: { angle: 90, width: 5, color: '#FFD98A', intensity: 0.95 },
      shadow: { dx: 0, dy: 10, blur: 34, color: '#000000', opacity: 0.5 },
      contrast: 1.08,
      saturation: 1.06,
    },
    grade: {
      exposure: 0.08,
      contrast: 1.14,
      saturation: 1.12,
      temperature: 14,
      shadowTint: '#1E1405',
      highlightTint: '#FFE9BC',
      splitToneBalance: 0.4,
      lut: 'ember',
      lutStrength: 0.6,
      grain: 0.08,
      bloomThreshold: 0.62,
      bloomIntensity: 0.55,
      vignette: 0.44,
      halation: 0.38,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, defaultText: 'CHAMPIONS', maxChars: 22, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 30, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 12, transform: 'upper' },
  ],
};

export const celebrationTemplates: ThumbnailTemplate[] = [trophyLift, championCrowned];
