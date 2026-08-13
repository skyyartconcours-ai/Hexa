/**
 * MVP — player-of-the-game cards.
 *
 * Borrowed wholesale from trading cards and broadcast player-of-the-match
 * bumpers: a hard portrait frame on the left holds the subject at card
 * proportions, and the right field becomes a small stat sheet. The frame is
 * doing the work — it says "award" before a single word is read.
 */

import type { ThumbnailTemplate } from '@hexa/core';
import {
  RATIO_16_9,
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

const mvpCard: ThumbnailTemplate = {
  id: 'mvp-card',
  name: 'MVP Card',
  category: 'mvp',
  description:
    'A portrait card frame on the left holding the subject and their nameplate, with an award headline and a three-line stat sheet filling the right field.',
  aspects: WIDE_AND_SQUARE,
  subjects: { min: 1, max: 1 },
  tags: ['mvp', 'card', 'award', 'frame', 'stats', 'gold', 'player-of-the-game'],
  whenToUse:
    'Player-of-the-game, POG-of-the-split and performance-review videos. The card frame keeps a mediocre photograph looking deliberate.',
  layout: {
    id: 'mvp-card',
    name: 'MVP Card',
    description: 'Card 0.07–0.45 at 0.88 height, face at (0.26, 0.34), stat sheet from x 0.50.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial', center: [0.3, 0.4] } }),
      blockSlot('card-plate', { x: 0.07, y: 0.06, w: 0.38, h: 0.88 }, {
        z: Z.backplate + 1,
        meta: { shape: 'card', fill: 'left', radius: 0.014, gradient: 'down' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.24 } }),
      fxSlot('card-glow', { x: 0.04, y: 0.03, w: 0.44, h: 0.94 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'edge-glow', fill: 'accent', intensity: 0.5 },
      }),
      bustSlot('subject', { x: 0.07, y: 0.06, w: 0.38, h: 0.88 }, {
        z: Z.subject,
        anchor: 'bottom-center',
        fit: 'bust',
        focal: { x: 0.5, y: 0.32 },
        constraints: { faceKeepIn: { x: 0.16, y: 0.2, w: 0.2, h: 0.26 }, clampToCanvas: true },
        meta: { faceHeight: 0.26, preferFacing: 'right', maskTo: 'card-plate', rimAngle: 60 },
      }),
      fxSlot('sparkle', { x: 0.06, y: 0.05, w: 0.4, h: 0.5 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'particles', particles: 'spark', density: 0.3, bias: 'center' },
      }),
      shapeSlot('card-frame', { x: 0.07, y: 0.06, w: 0.38, h: 0.88 }, {
        z: Z.shape,
        meta: { shape: 'frame', stroke: 'accent', width: 0.006, radius: 0.014 },
      }),
      shapeSlot('card-nameplate', { x: 0.07, y: 0.76, w: 0.38, h: 0.18 }, {
        z: Z.shape + 1,
        meta: { shape: 'bar', fill: 'dark', opacity: 0.85 },
      }),
      shapeSlot('stat-rule-1', { x: 0.5, y: 0.472, w: 0.44, h: 0.002 }, {
        z: Z.shape + 2,
        meta: { shape: 'rule', fill: 'light', opacity: 0.3 },
      }),
      shapeSlot('stat-rule-2', { x: 0.5, y: 0.552, w: 0.44, h: 0.002 }, {
        z: Z.shape + 3,
        meta: { shape: 'rule', fill: 'light', opacity: 0.3 },
      }),
      textSlot('headline', { x: 0.5, y: 0.1, w: 0.44, h: 0.16 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'black', tracking: 0.02 },
      }),
      textSlot('stat', { x: 0.5, y: 0.29, w: 0.3, h: 0.15 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', numeric: true },
      }),
      textSlot('caption', { x: 0.5, y: 0.485, w: 0.44, h: 0.055 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      textSlot('subhead', { x: 0.5, y: 0.565, w: 0.44, h: 0.055 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      textSlot('left-name', { x: 0.09, y: 0.78, w: 0.34, h: 0.09 }, {
        z: Z.text + 4,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('left-team', { x: 0.09, y: 0.875, w: 0.34, h: 0.05 }, {
        z: Z.text + 5,
        anchor: 'center-left',
        meta: { weight: 'medium', tracking: 0.16 },
      }),
      textSlot('kicker', { x: 0.5, y: 0.66, w: 0.3, h: 0.05 }, {
        z: Z.text + 6,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.22 },
      }),
      logoSlot('crest', { x: 0.86, y: 0.63, w: 0.1, h: 0.14 }, { z: Z.badge }),
      badgeSlot('badge', { x: 0.5, y: 0.745, w: 0.22, h: 0.07 }, {
        z: Z.badge + 1,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('card-area', { x: 0.05, y: 0.04, w: 0.42, h: 0.92 }, 'The card is a closed object — nothing may cross its frame.'),
    ]),
    focalPoints: [
      { x: 0.26, y: 0.342 },
      { x: 0.72, y: 0.18 },
      { x: 0.65, y: 0.365 },
      { x: 0.26, y: 0.825 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'stage',
    backdrop: 'radial',
    brandStrength: 0.75,
    atmosphere: {
      haze: 0.24,
      particles: { kind: 'spark', density: 0.3, bias: 'left' },
    },
    subjectEffects: {
      rimLight: { angle: 60, width: 4, color: '#FFD98A', intensity: 0.85 },
      shadow: { dx: 0, dy: 10, blur: 28, color: '#000000', opacity: 0.55 },
      contrast: 1.1,
      saturation: 1.04,
    },
    grade: {
      exposure: 0.04,
      contrast: 1.16,
      saturation: 1.08,
      temperature: 12,
      shadowTint: '#1B1206',
      highlightTint: '#FFE4B0',
      splitToneBalance: 0.42,
      lut: 'ember',
      lutStrength: 0.45,
      grain: 0.08,
      bloomThreshold: 0.7,
      bloomIntensity: 0.36,
      vignette: 0.42,
      halation: 0.26,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, defaultText: 'MVP', maxChars: 18, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'stat', slotId: 'stat', required: false, maxChars: 8, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 30, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 30, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 18, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 18, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 14, transform: 'upper' },
  ],
};

export const mvpTemplates: ThumbnailTemplate[] = [mvpCard];
