/**
 * HERO — one subject, one idea.
 *
 * With a single face the frame stops being a fixture card and becomes a poster,
 * so the governing decision is which third the subject owns and which third the
 * type owns. All three layouts here keep those two territories strictly
 * separate: no headline ever crosses into the face column.
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
  goldenGuide,
  hazeSlot,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

// ── hero-portrait ────────────────────────────────────────────────────────────

const heroPortrait: ThumbnailTemplate = {
  id: 'hero-portrait',
  name: 'Hero Portrait',
  category: 'hero',
  description:
    'A single bust on the right third under a hard overhead key, with a three-line headline stack owning the left third and deep unlit space between them.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['hero', 'portrait', 'top-key', 'moody', 'noir', 'headline', 'single'],
  whenToUse:
    'Profile pieces, retirement and signing stories, "the fall of…" essays — anything where one person and one sentence carry the whole video.',
  layout: {
    id: 'hero-portrait',
    name: 'Hero Portrait',
    description: 'Face on the right third at 30% height, type column on the left third, top-key cone.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 115 } }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.42 } }),
      fxSlot('dust', { x: 0.3, y: -0.05, w: 0.75, h: 1.1 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'particles', particles: 'dust', bias: 'right', density: 0.4 },
      }),
      bustSlot('subject', { x: 0.42, y: 0, w: 0.62, h: 1 }, {
        z: Z.subject,
        anchor: 'bottom-right',
        focal: { x: 0.39, y: 0.36 },
        constraints: { faceKeepIn: { x: 0.54, y: 0.2, w: 0.28, h: 0.32 } },
        meta: { faceHeight: 0.3, preferFacing: 'left', keyFrom: 'top', rimAngle: 20 },
      }),
      fxSlot('key-cone', { x: 0.42, y: -0.1, w: 0.5, h: 0.8 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'light-cone', angle: 100, softness: 0.6 },
      }),
      shapeSlot('rule', { x: 0.05, y: 0.256, w: 0.13, h: 0.005 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      textSlot('kicker', { x: 0.05, y: 0.185, w: 0.3, h: 0.062 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.26 },
      }),
      textSlot('headline', { x: 0.05, y: 0.285, w: 0.42, h: 0.27 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 3, leading: 0.86 },
      }),
      textSlot('subhead', { x: 0.05, y: 0.575, w: 0.34, h: 0.075 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      badgeSlot('badge', { x: 0.05, y: 0.845, w: 0.28, h: 0.085 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('type-column', { x: 0.03, y: 0.16, w: 0.4, h: 0.56 }, 'Reserved for the headline stack — keep the cutout out of it.'),
    ]),
    focalPoints: [
      { x: 0.662, y: 0.36 },
      { x: 0.23, y: 0.42 },
      { x: 0.2, y: 0.216 },
      { x: 0.19, y: 0.887 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'top-key',
    backdrop: 'gradient',
    brandStrength: 0.55,
    atmosphere: {
      haze: 0.42,
      fog: 0.1,
      particles: { kind: 'dust', density: 0.4, bias: 'right' },
    },
    subjectEffects: {
      rimLight: { angle: 20, width: 3, color: '#FFE3B0', intensity: 0.85 },
      shadow: { dx: -6, dy: 12, blur: 44, color: '#000000', opacity: 0.7 },
      contrast: 1.16,
      saturation: 0.9,
    },
    grade: {
      exposure: -0.14,
      contrast: 1.24,
      saturation: 0.84,
      temperature: -4,
      lift: [0.008, 0.01, 0.018],
      shadowTint: '#0D1420',
      highlightTint: '#F2DCC0',
      splitToneBalance: 0.58,
      lut: 'neo-noir',
      lutStrength: 0.65,
      grain: 0.15,
      bloomThreshold: 0.8,
      bloomIntensity: 0.22,
      vignette: 0.55,
      chromaticAberration: 0.8,
      halation: 0.16,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 42, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 40, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 16, transform: 'upper' },
  ],
};

// ── hero-fullbody ────────────────────────────────────────────────────────────

const heroFullbody: ThumbnailTemplate = {
  id: 'hero-fullbody',
  name: 'Hero Full Body',
  category: 'hero',
  description:
    'Full-height figure standing on the left third against a backlit disc with ground fog at the feet, and a tall type stack filling the right half.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['hero', 'full-body', 'backlit', 'poster', 'silhouette', 'stance', 'single'],
  whenToUse:
    'Signature-pose art and jersey reveals, where posture and silhouette say more than an expression. Needs a clean full-length cutout — do not pick it for a cropped press photo.',
  layout: {
    id: 'hero-fullbody',
    name: 'Hero Full Body',
    description: 'Figure at 0.33 running the full canvas height, disc behind, right-half type stack.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 90 } }),
      blockSlot('disc', { x: 0.06, y: 0.06, w: 0.54, h: 0.86 }, {
        z: Z.backplate + 1,
        meta: { shape: 'circle', fill: 'left', opacity: 0.85, blur: 0.02 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.34 } }),
      fxSlot('backlight', { x: 0.12, y: 0.02, w: 0.42, h: 0.62 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'radial-glow', fill: 'accent', intensity: 0.7 },
      }),
      bustSlot('subject', { x: 0.1, y: 0.02, w: 0.46, h: 0.98 }, {
        z: Z.subject,
        anchor: 'bottom-center',
        fit: 'full',
        focal: { x: 0.49, y: 0.14 },
        constraints: { faceKeepIn: { x: 0.24, y: 0.06, w: 0.2, h: 0.18 }, clampToCanvas: true },
        meta: { faceHeight: 0.12, preferFacing: 'right', rimAngle: 250 },
      }),
      fxSlot('ground-fog', { x: -0.05, y: 0.72, w: 1.1, h: 0.35 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'fog', height: 0.28, drift: 0.3 },
      }),
      shapeSlot('type-rule', { x: 0.6, y: 0.232, w: 0.2, h: 0.005 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      textSlot('kicker', { x: 0.6, y: 0.16, w: 0.34, h: 0.06 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.24 },
      }),
      textSlot('headline', { x: 0.6, y: 0.26, w: 0.36, h: 0.29 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 3, leading: 0.86 },
      }),
      textSlot('subhead', { x: 0.6, y: 0.565, w: 0.34, h: 0.07 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      badgeSlot('badge', { x: 0.6, y: 0.67, w: 0.24, h: 0.075 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'tag', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('figure-column', { x: 0.04, y: 0, w: 0.5, h: 1 }, 'Full-length figure column — no copy may enter it.'),
    ]),
    focalPoints: [
      { x: 0.325, y: 0.157 },
      { x: 0.78, y: 0.4 },
      { x: 0.77, y: 0.19 },
      { x: 0.33, y: 0.66 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'backlit',
    backdrop: 'radial',
    brandStrength: 0.7,
    atmosphere: {
      haze: 0.34,
      fog: 0.28,
      particles: { kind: 'dust', density: 0.35, bias: 'left' },
      rays: { angle: 100, count: 3, intensity: 0.22, color: '#FFF3DC' },
    },
    subjectEffects: {
      rimLight: { angle: 250, width: 5, color: '#FFFFFF', intensity: 1 },
      shadow: { dx: 0, dy: 14, blur: 50, color: '#000000', opacity: 0.6 },
      contrast: 1.14,
      saturation: 0.92,
    },
    grade: {
      exposure: -0.06,
      contrast: 1.26,
      saturation: 0.86,
      temperature: -2,
      shadowTint: '#101820',
      highlightTint: '#EFF6FF',
      splitToneBalance: 0.52,
      lut: 'bleach-bypass',
      lutStrength: 0.5,
      grain: 0.13,
      bloomThreshold: 0.72,
      bloomIntensity: 0.34,
      vignette: 0.48,
      chromaticAberration: 1,
      halation: 0.22,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 40, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 38, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 14, transform: 'upper' },
  ],
};

// ── hero-godray ──────────────────────────────────────────────────────────────

const heroGodray: ThumbnailTemplate = {
  id: 'hero-godray',
  name: 'Hero God Ray',
  category: 'hero',
  description:
    'Near-silhouette subject just left of centre with volumetric shafts raking down from an off-centre hotspot, and the headline sitting in the bright floor haze beneath.',
  aspects: WIDE_AND_SQUARE,
  subjects: { min: 1, max: 1 },
  tags: ['hero', 'god-rays', 'volumetric', 'silhouette', 'cinematic', 'reverent', 'single'],
  whenToUse:
    'Legacy and comeback stories. The rays make an ordinary press photo feel like an altarpiece, which is exactly the register a retirement or return video wants.',
  layout: {
    id: 'hero-godray',
    name: 'Hero God Ray',
    description: 'Subject at x 0.44 with the ray hotspot at 0.62 — an asymmetry that keeps a symmetric idea alive.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial', center: [0.62, 0.24] } }),
      fxSlot('hotspot', { x: 0.46, y: 0.02, w: 0.36, h: 0.36 }, {
        z: Z.atmosphereBack,
        meta: { fx: 'radial-glow', intensity: 0.9, fill: 'light' },
      }),
      fxSlot('rays-back', { x: 0.1, y: -0.1, w: 0.86, h: 1.15 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'rays', angle: 68, count: 7, intensity: 0.55 },
      }),
      hazeSlot('haze', { z: Z.atmosphereBack + 2, meta: { fx: 'haze', density: 0.55 } }),
      bustSlot('subject', { x: 0.16, y: 0.02, w: 0.62, h: 0.98 }, {
        z: Z.subject,
        anchor: 'bottom-center',
        focal: { x: 0.45, y: 0.31 },
        constraints: { faceKeepIn: { x: 0.34, y: 0.18, w: 0.24, h: 0.3 } },
        meta: { faceHeight: 0.26, preferFacing: 'right', rimAngle: 68, silhouette: 0.35 },
      }),
      fxSlot('rays-front', { x: 0.1, y: -0.1, w: 0.86, h: 1.15 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'rays', angle: 68, count: 4, intensity: 0.3, blend: 'screen' },
      }),
      fxSlot('floor-haze', { x: 0, y: 0.66, w: 1, h: 0.34 }, {
        z: Z.atmosphereFront + 1,
        meta: { fx: 'fog', height: 0.3 },
      }),
      shapeSlot('headline-scrim', { x: 0, y: 0.74, w: 0.82, h: 0.26 }, {
        z: Z.shape,
        meta: { shape: 'scrim', fill: 'dark', opacity: 0.55, gradient: 'up' },
      }),
      textSlot('kicker', { x: 0.06, y: 0.715, w: 0.34, h: 0.06 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.26 },
      }),
      textSlot('headline', { x: 0.06, y: 0.79, w: 0.7, h: 0.115 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.05, w: 0.2, h: 0.07 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones(),
    focalPoints: [
      { x: 0.439, y: 0.324 },
      { x: 0.62, y: 0.24 },
      { x: 0.41, y: 0.848 },
      { x: 0.23, y: 0.745 },
    ],
    guides: [goldenGuide()],
  },
  style: {
    lightRig: 'god-rays',
    backdrop: 'gradient',
    brandStrength: 0.5,
    atmosphere: {
      haze: 0.55,
      fog: 0.3,
      rays: { angle: 68, count: 7, intensity: 0.55, color: '#FFE9C4' },
      particles: { kind: 'dust', density: 0.5, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 68, width: 6, color: '#FFF0D2', intensity: 1 },
      exposure: -0.25,
      contrast: 1.2,
      saturation: 0.8,
    },
    grade: {
      exposure: 0,
      contrast: 1.18,
      saturation: 0.95,
      temperature: 14,
      shadowTint: '#141B26',
      highlightTint: '#FFDFA8',
      splitToneBalance: 0.42,
      lut: 'ember',
      lutStrength: 0.45,
      grain: 0.11,
      bloomThreshold: 0.6,
      bloomIntensity: 0.6,
      vignette: 0.5,
      halation: 0.4,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 34, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 14, transform: 'upper' },
  ],
};

export const heroTemplates: ThumbnailTemplate[] = [heroPortrait, heroFullbody, heroGodray];
