/**
 * SHORTS — 9:16.
 *
 * A vertical frame is not a rotated horizontal one. Three things change:
 *  • The platform eats the bottom fifth (title, handle, CTA) and a rail down the
 *    right edge, so the usable box is roughly x 0.05–0.82, y 0.08–0.78.
 *  • Two subjects stack rather than flank, so "facing inward" becomes a
 *    diagonal: upper subject pushed left facing right, lower pushed right
 *    facing left, with the mark at the crossing.
 *  • Type must be bigger relative to the frame — a Short is usually watched at
 *    full height, but the thumbnail is browsed in a 3-up grid.
 */

import type { ThumbnailTemplate } from '@hexa/core';
import {
  RATIO_9_16,
  VERTICAL_ASPECTS,
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
  shortsSafeZones,
  textSlot,
  thirdsGuide,
} from '../helpers.js';

// ── shorts-versus ────────────────────────────────────────────────────────────

const shortsVersus: ThumbnailTemplate = {
  id: 'shorts-versus',
  name: 'Shorts Versus',
  category: 'shorts',
  description:
    'Vertical head-to-head: upper subject pushed left facing right, lower subject pushed right facing left, a diagonal seam between them and the VS at the crossing point.',
  aspects: VERTICAL_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['shorts', 'vertical', 'versus', 'diagonal', '9:16', 'stacked', 'high-energy'],
  whenToUse:
    'Vertical clip content pitting two players against each other. Keep the headline to three words — vertical thumbnails are browsed three across.',
  layout: {
    id: 'shorts-versus',
    name: 'Shorts Versus',
    description: 'Stacked busts on a descending diagonal, VS at (0.5, 0.45), everything clear of the caption strip.',
    designAspect: RATIO_9_16,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 30 } }),
      blockSlot('block-top', { x: 0, y: 0, w: 1, h: 0.52 }, {
        z: Z.backplate + 1,
        meta: { shape: 'diagonal-half', side: 'top', lean: 0.18, fill: 'left' },
      }),
      blockSlot('block-bottom', { x: 0, y: 0.4, w: 1, h: 0.6 }, {
        z: Z.backplate + 2,
        meta: { shape: 'diagonal-half', side: 'bottom', lean: 0.18, fill: 'right' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.34 } }),
      inwardBust('subject-top', { x: -0.06, y: 0.05, w: 0.84, h: 0.45 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.48, y: 0.47 },
        constraints: { faceKeepIn: { x: 0.16, y: 0.16, w: 0.4, h: 0.22 } },
        meta: { preferFacing: 'right', faceHeight: 0.15, side: 'top', rimAngle: 200 },
      }),
      inwardBust('subject-bottom', { x: 0.22, y: 0.42, w: 0.84, h: 0.45 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        focal: { x: 0.52, y: 0.47 },
        constraints: { faceKeepIn: { x: 0.46, y: 0.55, w: 0.4, h: 0.22 } },
        meta: { preferFacing: 'left', faceHeight: 0.15, side: 'bottom', rimAngle: 340 },
      }),
      fxSlot('seam', { x: -0.05, y: 0.4, w: 1.1, h: 0.1 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'glow-seam', angle: 12 },
      }),
      fxSlot('sparks', { x: 0.05, y: 0.28, w: 0.9, h: 0.34 }, {
        z: Z.atmosphereFront + 1,
        meta: { fx: 'particles', particles: 'spark', density: 0.5, bias: 'center' },
      }),
      shapeSlot('vs-diamond', { x: 0.38, y: 0.385, w: 0.24, h: 0.13 }, {
        z: Z.shape,
        rotation: 45,
        meta: { shape: 'diamond', fill: 'light', stroke: 'accent' },
      }),
      textSlot('vs', { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, {
        z: Z.text,
        meta: { weight: 'black', italic: true },
      }),
      textSlot('left-name', { x: 0.06, y: 0.145, w: 0.52, h: 0.075 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('right-name', { x: 0.3, y: 0.7, w: 0.52, h: 0.075 }, {
        z: Z.text + 2,
        anchor: 'center-right',
        meta: { weight: 'black' },
      }),
      textSlot('headline', { x: 0.08, y: 0.3, w: 0.7, h: 0.075 }, {
        z: Z.text + 3,
        meta: { weight: 'bold' },
      }),
      textSlot('kicker', { x: 0.24, y: 0.082, w: 0.52, h: 0.048 }, {
        z: Z.text + 4,
        anchor: 'center-right',
        meta: { weight: 'semibold', tracking: 0.24 },
      }),
      badgeSlot('badge', { x: 0.05, y: 0.082, w: 0.16, h: 0.048 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: shortsSafeZones([
      reserve('crossing', { x: 0.34, y: 0.36, w: 0.32, h: 0.18 }, 'The VS crossing point — keep both cutouts clear of it.'),
    ]),
    focalPoints: [
      { x: 0.343, y: 0.262 },
      { x: 0.657, y: 0.632 },
      { x: 0.5, y: 0.45 },
      { x: 0.43, y: 0.338 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'split-rim',
    backdrop: 'gradient',
    brandStrength: 0.85,
    atmosphere: {
      haze: 0.34,
      particles: { kind: 'spark', density: 0.5, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 200, width: 4, color: '#8FE8FF', intensity: 0.85 },
      shadow: { dx: 0, dy: 8, blur: 26, color: '#000000', opacity: 0.55 },
      contrast: 1.08,
      saturation: 1.08,
    },
    grade: {
      exposure: 0.06,
      contrast: 1.18,
      saturation: 1.16,
      temperature: 6,
      shadowTint: '#0B2A3C',
      highlightTint: '#FFB067',
      splitToneBalance: 0.45,
      lut: 'teal-orange',
      lutStrength: 0.55,
      grain: 0.08,
      bloomThreshold: 0.7,
      bloomIntensity: 0.4,
      vignette: 0.3,
      chromaticAberration: 1.4,
      halation: 0.24,
    },
  },
  textSlots: [
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'vs', slotId: 'vs', required: false, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'headline', slotId: 'headline', required: false, maxChars: 20, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 18, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 8, transform: 'upper' },
  ],
};

// ── shorts-hero ──────────────────────────────────────────────────────────────

const shortsHero: ThumbnailTemplate = {
  id: 'shorts-hero',
  name: 'Shorts Hero',
  category: 'shorts',
  description:
    'One face filling the upper half of a vertical frame with a heavy two-line headline stacked in the lower-left, sized to survive a three-across browse grid.',
  aspects: VERTICAL_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['shorts', 'vertical', 'hero', 'face', '9:16', 'big-text', 'single'],
  whenToUse:
    'Vertical clips built around one player or one quote. The face sits high so the platform caption never crowds it.',
  layout: {
    id: 'shorts-hero',
    name: 'Shorts Hero',
    description: 'Full-bleed face at y 0.27, headline block y 0.60–0.76, all copy inside x 0.05–0.82.',
    designAspect: RATIO_9_16,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial', center: [0.5, 0.3] } }),
      blockSlot('accent-bar', { x: 0, y: 0.44, w: 0.06, h: 0.44 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', fill: 'accent' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.3 } }),
      bustSlot('subject', { x: -0.1, y: 0.1, w: 1.2, h: 0.78 }, {
        z: Z.subject,
        anchor: 'top-center',
        fit: 'face-anchor',
        focal: { x: 0.47, y: 0.22 },
        constraints: { faceKeepIn: { x: 0.28, y: 0.16, w: 0.44, h: 0.24 } },
        meta: { faceHeight: 0.2, preferFacing: 'center', rimAngle: 250 },
      }),
      fxSlot('scrim', { x: 0, y: 0.42, w: 1, h: 0.58 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'scrim', fill: 'dark', opacity: 0.6, gradient: 'up' },
      }),
      shapeSlot('headline-rule', { x: 0.06, y: 0.585, w: 0.2, h: 0.005 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      textSlot('left-name', { x: 0.06, y: 0.455, w: 0.4, h: 0.06 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'black', tracking: 0.02 },
      }),
      textSlot('kicker', { x: 0.06, y: 0.53, w: 0.44, h: 0.045 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.22 },
      }),
      textSlot('headline', { x: 0.06, y: 0.6, w: 0.62, h: 0.16 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 2, leading: 0.86 },
      }),
      badgeSlot('badge', { x: 0.06, y: 0.1, w: 0.3, h: 0.055 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: shortsSafeZones([
      reserve('face-field', { x: 0.16, y: 0.12, w: 0.68, h: 0.3 }, 'Face field — no copy above the scrim line.'),
    ]),
    focalPoints: [
      { x: 0.464, y: 0.272 },
      { x: 0.37, y: 0.68 },
      { x: 0.28, y: 0.552 },
      { x: 0.21, y: 0.127 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'top-key',
    backdrop: 'radial',
    brandStrength: 0.6,
    atmosphere: {
      haze: 0.3,
      particles: { kind: 'dust', density: 0.3, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 250, width: 4, color: '#FF7A5C', intensity: 0.8 },
      shadow: { dx: 0, dy: 10, blur: 30, color: '#000000', opacity: 0.6 },
      contrast: 1.14,
      saturation: 1.1,
    },
    grade: {
      exposure: 0.04,
      contrast: 1.24,
      saturation: 1.18,
      temperature: 8,
      shadowTint: '#22090F',
      highlightTint: '#FFD9C0',
      splitToneBalance: 0.4,
      lut: 'crimson-contrast',
      lutStrength: 0.45,
      grain: 0.12,
      bloomThreshold: 0.66,
      bloomIntensity: 0.42,
      vignette: 0.44,
      chromaticAberration: 2,
      halation: 0.3,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 26, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: false, maxChars: 14, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 20, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 12, transform: 'upper' },
  ],
};

export const shortsTemplates: ThumbnailTemplate[] = [shortsVersus, shortsHero];
