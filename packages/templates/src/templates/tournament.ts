/**
 * TOURNAMENT — event key art and bracket furniture.
 *
 * Event thumbnails answer "what is this and when", so they are the one family
 * where symmetry is an asset: a centred, ceremonial arrangement reads as an
 * official card rather than a personal take.
 */

import type { LayoutSpec, TemplateContext, ThumbnailTemplate } from '@hexa/core';
import { clamp } from '@hexa/core';
import {
  RATIO_16_9,
  WIDE_ASPECTS,
  Z,
  badgeSlot,
  blockSlot,
  bustSlot,
  fxSlot,
  gridSlots,
  hazeSlot,
  logoSlot,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

// ── tournament-preview ───────────────────────────────────────────────────────

const tournamentPreview: ThumbnailTemplate = {
  id: 'tournament-preview',
  name: 'Tournament Preview',
  category: 'tournament',
  description:
    'Event key art: centred headline block under stage rays, an arc of two to six contenders across the lower field, event mark top-left and the date top-right.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 6 },
  tags: ['tournament', 'preview', 'event', 'arc', 'stage', 'adaptive', 'ceremonial'],
  whenToUse:
    'Group draws, day-one previews and schedule videos, where the event outranks any individual. The arc scales cleanly from a two-team preview to a six-team group.',
  layout: (ctx: TemplateContext): LayoutSpec => {
    const n = clamp(ctx.subjects.length || 4, 2, 6);
    const cast = gridSlots('contender', n, 1, { x: 0.06, y: 0.42, w: 0.88, h: 0.58 }, 0.012).map((s, i) => {
      // Arc: outer contenders sit slightly lower and smaller than the centre.
      const distance = Math.abs(i - (n - 1) / 2) / Math.max(1, (n - 1) / 2 || 1);
      return {
        ...s,
        rect: { ...s.rect, y: s.rect.y + distance * 0.035 },
        scale: 1 - distance * 0.1,
        focal: { x: 0.5, y: 0.3 },
        meta: { ...(s.meta ?? {}), faceHeight: 0.15, arcDistance: distance, captionFrom: 'team.tag' },
      };
    });
    return {
      id: 'tournament-preview',
      name: 'Tournament Preview',
      description: 'Centred type block over an arc of contenders; outer slots drop 3.5% and shrink 10%.',
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'arena' } }),
        blockSlot('stage-wash', { x: 0.12, y: 0, w: 0.76, h: 0.8 }, {
          z: Z.backplate + 1,
          meta: { shape: 'cone', fill: 'accent', opacity: 0.28 },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.45 } }),
        fxSlot('rays', { x: 0.05, y: -0.1, w: 0.9, h: 0.95 }, {
          z: Z.atmosphereBack + 1,
          meta: { fx: 'rays', angle: 90, count: 8, intensity: 0.4 },
        }),
        ...cast,
        fxSlot('floor-fog', { x: -0.05, y: 0.72, w: 1.1, h: 0.34 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'fog', height: 0.28 },
        }),
        shapeSlot('headline-rule', { x: 0.3, y: 0.325, w: 0.4, h: 0.004 }, {
          z: Z.shape,
          meta: { shape: 'rule', fill: 'accent' },
        }),
        shapeSlot('floor-bar', { x: 0, y: 0.94, w: 1, h: 0.06 }, {
          z: Z.shape + 1,
          meta: { shape: 'bar', fill: 'accent', opacity: 0.9 },
        }),
        textSlot('kicker', { x: 0.35, y: 0.065, w: 0.3, h: 0.055 }, {
          z: Z.text,
          meta: { weight: 'semibold', tracking: 0.28 },
        }),
        textSlot('headline', { x: 0.15, y: 0.15, w: 0.7, h: 0.16 }, {
          z: Z.text + 1,
          meta: { weight: 'black', lines: 2, leading: 0.88 },
        }),
        textSlot('subhead', { x: 0.3, y: 0.345, w: 0.4, h: 0.06 }, {
          z: Z.text + 2,
          meta: { weight: 'medium', tracking: 0.12 },
        }),
        textSlot('date', { x: 0.79, y: 0.075, w: 0.17, h: 0.055 }, {
          z: Z.text + 3,
          anchor: 'center-right',
          meta: { weight: 'bold', tracking: 0.12 },
        }),
        logoSlot('event-mark', { x: 0.045, y: 0.05, w: 0.13, h: 0.19 }, { z: Z.badge }),
        badgeSlot('badge', { x: 0.045, y: 0.855, w: 0.22, h: 0.07 }, {
          z: Z.badge + 1,
          anchor: 'center-left',
          meta: { shape: 'pill', fill: 'light' },
        }),
      ],
      safeZones: ytSafeZones([
        reserve('type-block', { x: 0.14, y: 0.05, w: 0.72, h: 0.36 }, 'Event type block — contenders stay below it.'),
      ]),
      focalPoints: [
        { x: 0.5, y: 0.23 },
        { x: 0.5, y: 0.594 },
        { x: 0.11, y: 0.145 },
        { x: 0.5, y: 0.375 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'stage',
    backdrop: 'arena',
    brandStrength: 0.6,
    atmosphere: {
      haze: 0.45,
      fog: 0.28,
      rays: { angle: 90, count: 8, intensity: 0.4, color: '#FFEFD0' },
      particles: { kind: 'dust', density: 0.35, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 90, width: 4, color: '#FFFFFF', intensity: 0.8 },
      shadow: { dx: 0, dy: 12, blur: 40, color: '#000000', opacity: 0.55 },
      contrast: 1.06,
      saturation: 1.02,
    },
    grade: {
      exposure: 0.04,
      contrast: 1.14,
      saturation: 1.08,
      temperature: 8,
      shadowTint: '#0B2030',
      highlightTint: '#FFDCA8',
      splitToneBalance: 0.44,
      lut: 'teal-orange',
      lutStrength: 0.48,
      grain: 0.08,
      bloomThreshold: 0.68,
      bloomIntensity: 0.45,
      vignette: 0.4,
      halation: 0.26,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 30, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 34, transform: 'upper' },
    { role: 'date', slotId: 'date', required: false, maxChars: 12, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 14, transform: 'upper' },
  ],
};

// ── bracket-clash ────────────────────────────────────────────────────────────

const bracketClash: ThumbnailTemplate = {
  id: 'bracket-clash',
  name: 'Bracket Clash',
  category: 'tournament',
  description:
    'Bracket ladder across the top, two contenders held apart at 0.27 and 0.73 by facing bracket jaws, and the round label riding the ladder.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['tournament', 'bracket', 'playoffs', 'elimination', 'structure', 'institutional'],
  whenToUse:
    'Playoff and elimination fixtures where the round matters as much as the matchup — the ladder tells the viewer this is a knockout without a word of copy.',
  layout: {
    id: 'bracket-clash',
    name: 'Bracket Clash',
    description: 'Ladder graphic on the top band, bracket jaws at 0.34 / 0.60, VS plate at the centre.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'grid', gridScale: 0.06 } }),
      blockSlot('half-left', { x: 0, y: 0.16, w: 0.5, h: 0.84 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', fill: 'left', opacity: 0.4 },
      }),
      blockSlot('half-right', { x: 0.5, y: 0.16, w: 0.5, h: 0.84 }, {
        z: Z.backplate + 2,
        meta: { shape: 'block', fill: 'right', opacity: 0.4 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.24 } }),
      bustSlot('subject-left', { x: 0.02, y: 0.1, w: 0.44, h: 0.9 }, {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.57, y: 0.3 },
        constraints: { faceKeepIn: { x: 0.16, y: 0.22, w: 0.24, h: 0.3 } },
        meta: { preferFacing: 'right', faceHeight: 0.24, side: 'left', rimAngle: 200 },
      }),
      bustSlot('subject-right', { x: 0.54, y: 0.1, w: 0.44, h: 0.9 }, {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        focal: { x: 0.43, y: 0.3 },
        constraints: { faceKeepIn: { x: 0.6, y: 0.22, w: 0.24, h: 0.3 } },
        meta: { preferFacing: 'left', faceHeight: 0.24, side: 'right', rimAngle: 340 },
      }),
      fxSlot('centre-glow', { x: 0.38, y: 0.2, w: 0.24, h: 0.5 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'radial-glow', fill: 'accent', intensity: 0.4 },
      }),
      shapeSlot('ladder', { x: 0.2, y: 0.06, w: 0.6, h: 0.09 }, {
        z: Z.shape,
        meta: { shape: 'bracket-ladder', stroke: 'light', width: 0.004 },
      }),
      shapeSlot('jaw-left', { x: 0.34, y: 0.16, w: 0.06, h: 0.42 }, {
        z: Z.shape + 1,
        meta: { shape: 'bracket', direction: 'right', stroke: 'accent', width: 0.008 },
      }),
      shapeSlot('jaw-right', { x: 0.6, y: 0.16, w: 0.06, h: 0.42 }, {
        z: Z.shape + 2,
        meta: { shape: 'bracket', direction: 'left', stroke: 'accent', width: 0.008 },
      }),
      shapeSlot('vs-plate', { x: 0.435, y: 0.3, w: 0.13, h: 0.14 }, {
        z: Z.shape + 3,
        meta: { shape: 'panel', fill: 'dark', stroke: 'light', radius: 0.008 },
      }),
      textSlot('kicker', { x: 0.35, y: 0.075, w: 0.3, h: 0.055 }, {
        z: Z.text,
        meta: { weight: 'bold', tracking: 0.2 },
      }),
      textSlot('vs', { x: 0.44, y: 0.315, w: 0.12, h: 0.11 }, {
        z: Z.text + 1,
        meta: { weight: 'black', italic: true },
      }),
      textSlot('left-team', { x: 0.05, y: 0.735, w: 0.24, h: 0.05 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium', tracking: 0.16 },
      }),
      textSlot('right-team', { x: 0.51, y: 0.735, w: 0.24, h: 0.05 }, {
        z: Z.text + 3,
        anchor: 'center-right',
        meta: { weight: 'medium', tracking: 0.16 },
      }),
      textSlot('left-name', { x: 0.05, y: 0.8, w: 0.3, h: 0.095 }, {
        z: Z.text + 4,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('right-name', { x: 0.45, y: 0.8, w: 0.3, h: 0.095 }, {
        z: Z.text + 5,
        anchor: 'center-right',
        meta: { weight: 'black' },
      }),
      badgeSlot('badge', { x: 0.79, y: 0.05, w: 0.17, h: 0.06 }, {
        z: Z.badge,
        anchor: 'center-right',
        meta: { shape: 'tag', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('ladder-band', { x: 0.18, y: 0.04, w: 0.64, h: 0.13 }, 'Bracket ladder band — keep heads out of it.'),
    ]),
    focalPoints: [
      { x: 0.271, y: 0.37 },
      { x: 0.729, y: 0.37 },
      { x: 0.5, y: 0.37 },
      { x: 0.5, y: 0.105 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'neon-wash',
    backdrop: 'grid',
    brandStrength: 0.75,
    atmosphere: {
      haze: 0.24,
      particles: { kind: 'dust', density: 0.25, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 200, width: 3, color: '#9EE7FF', intensity: 0.7 },
      stroke: { width: 2, color: '#0A0D16' },
      contrast: 1.1,
      saturation: 1.04,
    },
    grade: {
      exposure: 0,
      contrast: 1.16,
      saturation: 1.02,
      temperature: -6,
      shadowTint: '#0A1626',
      highlightTint: '#E6F4FF',
      splitToneBalance: 0.54,
      lut: 'cold-steel',
      lutStrength: 0.5,
      grain: 0.07,
      bloomThreshold: 0.74,
      bloomIntensity: 0.3,
      vignette: 0.36,
      chromaticAberration: 1.2,
    },
  },
  textSlots: [
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, defaultText: 'SEMIFINAL', maxChars: 18, transform: 'upper' },
    { role: 'vs', slotId: 'vs', required: false, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 14, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 14, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 10, transform: 'upper' },
  ],
};

export const tournamentTemplates: ThumbnailTemplate[] = [tournamentPreview, bracketClash];
