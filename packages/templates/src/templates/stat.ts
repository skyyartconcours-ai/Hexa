/**
 * STAT — numbers-forward layouts.
 *
 * The one family where the face is *not* the primary focal point. A record
 * thumbnail works because the number is absurdly large and the player is the
 * caption; a comparison works because two columns line up so cleanly that the
 * eye reads a verdict without reading a word.
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

// ── stat-record ──────────────────────────────────────────────────────────────

const statRecord: ThumbnailTemplate = {
  id: 'stat-record',
  name: 'Stat Record',
  category: 'stat',
  description:
    'A single enormous number filling the left half with the player relegated to the right third — the figure is the headline and the face is the evidence.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['stat', 'record', 'number', 'milestone', 'big-figure', 'ember'],
  whenToUse:
    'Milestones and records: 1000th kill, 40-minute game, 7-0 split. Only works when the number is short — three characters or fewer keeps it enormous.',
  layout: {
    id: 'stat-record',
    name: 'Stat Record',
    description: 'Numeral block 0.045–0.505 at 40% canvas height, bust on the right third, caption stack beneath.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 60 } }),
      blockSlot('numeral-wash', { x: 0, y: 0.08, w: 0.56, h: 0.62 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', fill: 'accent', opacity: 0.18, blur: 0.04 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.3 } }),
      bustSlot('subject', { x: 0.52, y: 0.05, w: 0.52, h: 0.95 }, {
        z: Z.subject,
        anchor: 'bottom-right',
        focal: { x: 0.36, y: 0.28 },
        constraints: { faceKeepIn: { x: 0.6, y: 0.18, w: 0.26, h: 0.3 } },
        meta: { faceHeight: 0.26, preferFacing: 'left', rimAngle: 150 },
      }),
      fxSlot('embers', { x: 0.3, y: -0.05, w: 0.75, h: 1.1 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'particles', particles: 'ember', density: 0.4, bias: 'right' },
      }),
      shapeSlot('numeral-rule', { x: 0.05, y: 0.575, w: 0.4, h: 0.005 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      textSlot('kicker', { x: 0.05, y: 0.075, w: 0.34, h: 0.07 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'bold', tracking: 0.22 },
      }),
      textSlot('stat', { x: 0.045, y: 0.16, w: 0.46, h: 0.4 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black', numeric: true, italic: true, tracking: -0.04 },
      }),
      textSlot('caption', { x: 0.05, y: 0.6, w: 0.4, h: 0.075 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'bold', tracking: 0.08 },
      }),
      textSlot('subhead', { x: 0.05, y: 0.695, w: 0.36, h: 0.06 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      badgeSlot('badge', { x: 0.05, y: 0.845, w: 0.3, h: 0.085 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('numeral-block', { x: 0.03, y: 0.14, w: 0.5, h: 0.44 }, 'The numeral is the subject — nothing may cross it.'),
    ]),
    focalPoints: [
      { x: 0.27, y: 0.36 },
      { x: 0.707, y: 0.316 },
      { x: 0.25, y: 0.637 },
      { x: 0.2, y: 0.887 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'under-glow',
    backdrop: 'gradient',
    brandStrength: 0.7,
    atmosphere: {
      haze: 0.3,
      particles: { kind: 'ember', density: 0.4, bias: 'right' },
    },
    subjectEffects: {
      rimLight: { angle: 150, width: 4, color: '#FFC46B', intensity: 0.85 },
      shadow: { dx: -6, dy: 10, blur: 32, color: '#000000', opacity: 0.55 },
      contrast: 1.1,
      saturation: 1.04,
    },
    grade: {
      exposure: 0.02,
      contrast: 1.18,
      saturation: 1.1,
      temperature: 12,
      shadowTint: '#1E0E06',
      highlightTint: '#FFD9A0',
      splitToneBalance: 0.42,
      lut: 'ember',
      lutStrength: 0.5,
      grain: 0.1,
      bloomThreshold: 0.68,
      bloomIntensity: 0.42,
      vignette: 0.4,
      halation: 0.3,
    },
  },
  textSlots: [
    { role: 'stat', slotId: 'stat', required: true, maxChars: 4, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: true, maxChars: 24, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 20, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 30, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 16, transform: 'upper' },
  ],
};

// ── stat-compare ─────────────────────────────────────────────────────────────

const statCompare: ThumbnailTemplate = {
  id: 'stat-compare',
  name: 'Stat Compare',
  category: 'stat',
  description:
    'Two columns of figures divided by a centre label rail, with both players reduced to duotone ghosts behind the numbers so the table stays the loudest thing in frame.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['stat', 'compare', 'table', 'columns', 'duotone', 'ghost', 'data'],
  whenToUse:
    'Head-to-head data videos where the argument is quantitative. The rows are data-driven: the pipeline fills them from the stat table, so only the names and the verdict are authored copy.',
  layout: {
    id: 'stat-compare',
    name: 'Stat Compare',
    description: 'Three paired rows at y 0.33 / 0.48 / 0.63, centre label rail, ghost busts behind at 25% opacity.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'grid', gridScale: 0.05 } }),
      blockSlot('column-left', { x: 0.03, y: 0.24, w: 0.42, h: 0.52 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', fill: 'left', opacity: 0.22, radius: 0.012 },
      }),
      blockSlot('column-right', { x: 0.55, y: 0.24, w: 0.42, h: 0.52 }, {
        z: Z.backplate + 2,
        meta: { shape: 'block', fill: 'right', opacity: 0.22, radius: 0.012 },
      }),
      bustSlot('subject-left', { x: -0.02, y: 0.02, w: 0.44, h: 0.98 }, {
        z: Z.subject,
        anchor: 'bottom-left',
        opacity: 0.55,
        focal: { x: 0.62, y: 0.23 },
        meta: { preferFacing: 'right', faceHeight: 0.2, treatment: 'duotone', side: 'left' },
      }),
      bustSlot('subject-right', { x: 0.58, y: 0.02, w: 0.44, h: 0.98 }, {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        opacity: 0.55,
        focal: { x: 0.38, y: 0.23 },
        meta: { preferFacing: 'left', faceHeight: 0.2, treatment: 'duotone', side: 'right' },
      }),
      fxSlot('scanlines', { x: 0, y: 0.24, w: 1, h: 0.52 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'scanlines', density: 0.2 },
      }),
      shapeSlot('rail', { x: 0.4985, y: 0.26, w: 0.003, h: 0.48 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'light', opacity: 0.4 },
      }),
      shapeSlot('row-rule-1', { x: 0.06, y: 0.462, w: 0.88, h: 0.002 }, {
        z: Z.shape + 1,
        meta: { shape: 'rule', fill: 'light', opacity: 0.22 },
      }),
      shapeSlot('row-rule-2', { x: 0.06, y: 0.612, w: 0.88, h: 0.002 }, {
        z: Z.shape + 2,
        meta: { shape: 'rule', fill: 'light', opacity: 0.22 },
      }),
      textSlot('left-name', { x: 0.05, y: 0.075, w: 0.36, h: 0.08 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('right-name', { x: 0.59, y: 0.075, w: 0.36, h: 0.08 }, {
        z: Z.text + 1,
        anchor: 'center-right',
        meta: { weight: 'black' },
      }),
      textSlot('kicker', { x: 0.42, y: 0.08, w: 0.16, h: 0.07 }, {
        z: Z.text + 2,
        meta: { weight: 'bold', tracking: 0.06 },
      }),
      // Data-driven rows: filled from the stat table, not from authored copy.
      textSlot('row-1-left', { x: 0.06, y: 0.33, w: 0.34, h: 0.12 }, {
        z: Z.text + 3,
        anchor: 'center-right',
        meta: { weight: 'black', numeric: true, statRow: 0, side: 'left' },
      }),
      textSlot('row-1-right', { x: 0.6, y: 0.33, w: 0.34, h: 0.12 }, {
        z: Z.text + 4,
        anchor: 'center-left',
        meta: { weight: 'black', numeric: true, statRow: 0, side: 'right' },
      }),
      textSlot('row-1-label', { x: 0.42, y: 0.365, w: 0.16, h: 0.05 }, {
        z: Z.text + 5,
        meta: { weight: 'medium', tracking: 0.16, statRow: 0, side: 'label' },
      }),
      textSlot('row-2-left', { x: 0.06, y: 0.48, w: 0.34, h: 0.12 }, {
        z: Z.text + 6,
        anchor: 'center-right',
        meta: { weight: 'black', numeric: true, statRow: 1, side: 'left' },
      }),
      textSlot('row-2-right', { x: 0.6, y: 0.48, w: 0.34, h: 0.12 }, {
        z: Z.text + 7,
        anchor: 'center-left',
        meta: { weight: 'black', numeric: true, statRow: 1, side: 'right' },
      }),
      textSlot('row-2-label', { x: 0.42, y: 0.515, w: 0.16, h: 0.05 }, {
        z: Z.text + 8,
        meta: { weight: 'medium', tracking: 0.16, statRow: 1, side: 'label' },
      }),
      textSlot('row-3-left', { x: 0.06, y: 0.63, w: 0.34, h: 0.12 }, {
        z: Z.text + 9,
        anchor: 'center-right',
        meta: { weight: 'black', numeric: true, statRow: 2, side: 'left' },
      }),
      textSlot('row-3-right', { x: 0.6, y: 0.63, w: 0.34, h: 0.12 }, {
        z: Z.text + 10,
        anchor: 'center-left',
        meta: { weight: 'black', numeric: true, statRow: 2, side: 'right' },
      }),
      textSlot('row-3-label', { x: 0.42, y: 0.665, w: 0.16, h: 0.05 }, {
        z: Z.text + 11,
        meta: { weight: 'medium', tracking: 0.16, statRow: 2, side: 'label' },
      }),
      textSlot('headline', { x: 0.06, y: 0.8, w: 0.48, h: 0.1 }, {
        z: Z.text + 12,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('stat', { x: 0.56, y: 0.8, w: 0.22, h: 0.1 }, {
        z: Z.text + 13,
        meta: { weight: 'black', numeric: true },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('table-body', { x: 0.03, y: 0.3, w: 0.94, h: 0.46 }, 'The comparison table must stay unobstructed.'),
    ]),
    focalPoints: [
      { x: 0.23, y: 0.39 },
      { x: 0.77, y: 0.39 },
      { x: 0.253, y: 0.245 },
      { x: 0.3, y: 0.85 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'clean',
    backdrop: 'grid',
    brandStrength: 0.65,
    atmosphere: { haze: 0.12 },
    subjectEffects: {
      duotone: { shadow: '#0A1424', highlight: '#7FA8D8', amount: 0.85 },
      blur: 1.5,
      contrast: 1.05,
      saturation: 0.4,
    },
    grade: {
      exposure: 0,
      contrast: 1.12,
      saturation: 0.94,
      temperature: -6,
      shadowTint: '#0B1522',
      highlightTint: '#EAF1FA',
      splitToneBalance: 0.5,
      lut: 'cold-steel',
      lutStrength: 0.4,
      grain: 0.05,
      bloomThreshold: 0.85,
      bloomIntensity: 0.16,
      vignette: 0.3,
    },
  },
  textSlots: [
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'headline', slotId: 'headline', required: false, maxChars: 26, transform: 'upper' },
    { role: 'stat', slotId: 'stat', required: false, maxChars: 6, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, defaultText: 'VS', maxChars: 6, transform: 'upper' },
  ],
};

export const statTemplates: ThumbnailTemplate[] = [statRecord, statCompare];
