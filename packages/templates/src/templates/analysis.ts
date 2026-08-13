/**
 * ANALYSIS — coaching, telestrator and breakdown layouts.
 *
 * Analytical thumbnails have the opposite problem to hype thumbnails: they must
 * look considered rather than loud. Both layouts here keep one large clean
 * region for annotation, drop saturation, and let a panel edge — not an
 * explosion — carry the structure.
 */

import type { ThumbnailTemplate } from '@hexa/core';
import {
  RATIO_16_9,
  WIDE_ASPECTS,
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

// ── analysis-callout ─────────────────────────────────────────────────────────

const analysisCallout: ThumbnailTemplate = {
  id: 'analysis-callout',
  name: 'Analysis Callout',
  category: 'analysis',
  description:
    'Subject on the left third under a telestrator ring, with a bordered annotation panel occupying the right half and an arrow running from the panel back to the player.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['analysis', 'callout', 'telestrator', 'coaching', 'panel', 'annotation', 'clean'],
  whenToUse:
    'Coaching breakdowns and "why this works" explainers. The panel gives you a legitimate place to put three short lines without the frame turning into a slide.',
  layout: {
    id: 'analysis-callout',
    name: 'Analysis Callout',
    description: 'Left-third subject with ring highlight, right-half annotation panel, callout arrow between.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'grid', gridScale: 0.04 } }),
      blockSlot('wash', { x: 0, y: 0, w: 0.5, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', fill: 'left', opacity: 0.4 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.14 } }),
      bustSlot('subject', { x: -0.02, y: 0.08, w: 0.46, h: 0.92 }, {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.66, y: 0.3 },
        constraints: { faceKeepIn: { x: 0.16, y: 0.2, w: 0.26, h: 0.3 } },
        meta: { faceHeight: 0.24, preferFacing: 'right', rimAngle: 210 },
      }),
      fxSlot('ring-highlight', { x: 0.16, y: 0.22, w: 0.26, h: 0.28 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'ring-highlight', stroke: 'accent', dashed: true },
      }),
      shapeSlot('panel', { x: 0.46, y: 0.1, w: 0.5, h: 0.62 }, {
        z: Z.shape,
        meta: { shape: 'panel', fill: 'dark', opacity: 0.86, stroke: 'accent', radius: 0.012 },
      }),
      shapeSlot('callout-arrow', { x: 0.34, y: 0.42, w: 0.16, h: 0.16 }, {
        z: Z.shape + 1,
        meta: { shape: 'callout-arrow', direction: 'left', fill: 'accent' },
      }),
      shapeSlot('bullet-1', { x: 0.49, y: 0.358, w: 0.018, h: 0.018 }, {
        z: Z.shape + 2,
        meta: { shape: 'tick', fill: 'accent' },
      }),
      shapeSlot('bullet-2', { x: 0.49, y: 0.448, w: 0.018, h: 0.018 }, {
        z: Z.shape + 3,
        meta: { shape: 'tick', fill: 'accent' },
      }),
      textSlot('kicker', { x: 0.46, y: 0.035, w: 0.3, h: 0.055 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.24 },
      }),
      textSlot('headline', { x: 0.49, y: 0.15, w: 0.44, h: 0.16 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 2, leading: 0.9 },
      }),
      textSlot('subhead', { x: 0.52, y: 0.34, w: 0.41, h: 0.06 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      textSlot('caption', { x: 0.52, y: 0.43, w: 0.41, h: 0.06 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      textSlot('stat', { x: 0.52, y: 0.53, w: 0.41, h: 0.11 }, {
        z: Z.text + 4,
        anchor: 'center-left',
        meta: { weight: 'black', numeric: true },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.845, w: 0.34, h: 0.075 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('panel-area', { x: 0.46, y: 0.1, w: 0.5, h: 0.62 }, 'Annotation panel — no subject art may cross into it.'),
    ]),
    focalPoints: [
      { x: 0.284, y: 0.356 },
      { x: 0.71, y: 0.23 },
      { x: 0.42, y: 0.5 },
      { x: 0.215, y: 0.882 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'clean',
    backdrop: 'grid',
    brandStrength: 0.5,
    atmosphere: { haze: 0.14 },
    subjectEffects: {
      stroke: { width: 2, color: '#0B0C12' },
      shadow: { dx: 0, dy: 6, blur: 20, color: '#000000', opacity: 0.45 },
      contrast: 1.04,
      saturation: 0.96,
    },
    grade: {
      exposure: 0,
      contrast: 1.06,
      saturation: 0.92,
      temperature: -6,
      shadowTint: '#0E1826',
      highlightTint: '#E9F2FF',
      splitToneBalance: 0.52,
      lut: 'cold-steel',
      lutStrength: 0.35,
      grain: 0.04,
      bloomThreshold: 0.86,
      bloomIntensity: 0.14,
      vignette: 0.24,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 38, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 22, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 34, transform: 'none' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 34, transform: 'none' },
    { role: 'stat', slotId: 'stat', required: false, maxChars: 10, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 18, transform: 'upper' },
  ],
};

// ── breakdown-split ──────────────────────────────────────────────────────────

const breakdownSplit: ThumbnailTemplate = {
  id: 'breakdown-split',
  name: 'Breakdown Split',
  category: 'analysis',
  description:
    'A horizontal division at 55%: desaturated play footage with telestrator marks above, a dark verdict strip below carrying the number, the read and the analyst.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['analysis', 'breakdown', 'horizontal-split', 'footage', 'verdict', 'documentary', 'moody'],
  whenToUse:
    'Post-match reviews and "what actually happened" videos, where the play matters more than the person. The strip gives the verdict a home so the footage can stay uncluttered.',
  layout: {
    id: 'breakdown-split',
    name: 'Breakdown Split',
    description: 'Footage plate 0–0.55, verdict strip 0.55–1.0, analyst bust on the lower-right thirds point.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'solid' } }),
      blockSlot('footage-plate', { x: 0, y: 0, w: 1, h: 0.55 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', treatment: 'ai', desaturate: 0.45, source: 'backplate' },
      }),
      blockSlot('verdict-plate', { x: 0, y: 0.55, w: 1, h: 0.45 }, {
        z: Z.backplate + 2,
        meta: { shape: 'block', fill: 'dark', opacity: 0.96 },
      }),
      blockSlot('scrim', { x: 0, y: 0, w: 0.68, h: 0.55 }, {
        z: Z.backplate + 3,
        meta: { shape: 'scrim', fill: 'dark', opacity: 0.6, gradient: 'right' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.16 } }),
      bustSlot('subject', { x: 0.56, y: 0.3, w: 0.46, h: 0.7 }, {
        z: Z.subject,
        anchor: 'bottom-right',
        focal: { x: 0.31, y: 0.48 },
        constraints: { faceKeepIn: { x: 0.6, y: 0.5, w: 0.26, h: 0.26 } },
        meta: { faceHeight: 0.2, preferFacing: 'left', rimAngle: 160 },
      }),
      fxSlot('telestrator', { x: 0.55, y: 0.05, w: 0.42, h: 0.45 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'telestrator', marks: ['arc', 'arrow'], stroke: 'accent' },
      }),
      shapeSlot('divider', { x: 0, y: 0.545, w: 1, h: 0.008 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      shapeSlot('stat-chip', { x: 0.04, y: 0.59, w: 0.26, h: 0.16 }, {
        z: Z.shape + 1,
        meta: { shape: 'panel', fill: 'accent', opacity: 0.16, stroke: 'accent', radius: 0.01 },
      }),
      textSlot('kicker', { x: 0.05, y: 0.07, w: 0.3, h: 0.055 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.24 },
      }),
      textSlot('headline', { x: 0.05, y: 0.14, w: 0.56, h: 0.22 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 2, leading: 0.88 },
      }),
      textSlot('stat', { x: 0.05, y: 0.6, w: 0.24, h: 0.14 }, {
        z: Z.text + 2,
        meta: { weight: 'black', numeric: true },
      }),
      textSlot('subhead', { x: 0.32, y: 0.615, w: 0.26, h: 0.06 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'bold' },
      }),
      textSlot('caption', { x: 0.32, y: 0.69, w: 0.26, h: 0.055 }, {
        z: Z.text + 4,
        anchor: 'center-left',
        meta: { weight: 'regular' },
      }),
      badgeSlot('badge', { x: 0.05, y: 0.8, w: 0.22, h: 0.065 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'light' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('verdict-strip', { x: 0, y: 0.55, w: 0.55, h: 0.45 }, 'Verdict strip — reserved for the number and the read.'),
    ]),
    focalPoints: [
      { x: 0.703, y: 0.636 },
      { x: 0.33, y: 0.25 },
      { x: 0.17, y: 0.67 },
      { x: 0.76, y: 0.27 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'top-key',
    backdrop: 'abstract',
    brandStrength: 0.4,
    atmosphere: { haze: 0.16, fog: 0.06 },
    subjectEffects: {
      rimLight: { angle: 160, width: 2, color: '#BFD6FF', intensity: 0.5 },
      shadow: { dx: -4, dy: 8, blur: 26, color: '#000000', opacity: 0.55 },
      contrast: 1.1,
      saturation: 0.88,
    },
    grade: {
      exposure: -0.1,
      contrast: 1.18,
      saturation: 0.8,
      temperature: -8,
      lift: [0.006, 0.008, 0.014],
      shadowTint: '#0C1220',
      highlightTint: '#E4EAF2',
      splitToneBalance: 0.58,
      lut: 'neo-noir',
      lutStrength: 0.55,
      grain: 0.12,
      bloomThreshold: 0.84,
      bloomIntensity: 0.16,
      vignette: 0.42,
      chromaticAberration: 0.5,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 36, transform: 'upper' },
    { role: 'stat', slotId: 'stat', required: false, maxChars: 8, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 22, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 26, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 30, transform: 'none' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 16, transform: 'upper' },
  ],
};

export const analysisTemplates: ThumbnailTemplate[] = [analysisCallout, breakdownSplit];
