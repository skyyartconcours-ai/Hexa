/**
 * ROSTER — reveals and transfer windows.
 *
 * These are announcement layouts, so the type leads and the cast supports. The
 * headline sits top-left where the Western eye enters the frame, and the faces
 * form a rhythm below it rather than competing for the primary read.
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

// ── roster-reveal ────────────────────────────────────────────────────────────

const rosterReveal: ThumbnailTemplate = {
  id: 'roster-reveal',
  name: 'Roster Reveal',
  category: 'roster',
  description:
    'Announcement headline top-left, crest top-right, and three to six players staggered along the lower field on a lit plinth — an adaptive lineup that never looks like a mugshot row.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 3, max: 6 },
  tags: ['roster', 'reveal', 'announcement', 'adaptive', 'stagger', 'lineup', 'offseason'],
  whenToUse:
    'Off-season roster announcements and academy call-ups. The stagger keeps an even number of players from reading as a police line-up.',
  layout: (ctx: TemplateContext): LayoutSpec => {
    const n = clamp(ctx.subjects.length || 5, 3, 6);
    const cast = gridSlots('member', n, 1, { x: 0.02, y: 0.26, w: 0.96, h: 0.74 }, 0.012).map((s, i) => ({
      ...s,
      // Alternate the baseline so the heads describe a zig-zag, not a ruler.
      rect: { ...s.rect, y: s.rect.y + (i % 2 === 0 ? -0.03 : 0.03) },
      focal: { x: 0.5, y: 0.3 },
      meta: { ...(s.meta ?? {}), faceHeight: 0.15, captionFrom: 'player.handle', stagger: i % 2 === 0 ? 'up' : 'down' },
    }));
    return {
      id: 'roster-reveal',
      name: 'Roster Reveal',
      description: 'Adaptive 3–6 cast row with ±0.03 stagger, headline block top-left, crest top-right.',
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 75 } }),
        blockSlot('wash', { x: 0, y: 0.34, w: 1, h: 0.66 }, {
          z: Z.backplate + 1,
          meta: { shape: 'block', fill: 'left', opacity: 0.5, gradient: 'up' },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.36 } }),
        fxSlot('stage-rays', { x: 0.05, y: -0.08, w: 0.9, h: 0.9 }, {
          z: Z.atmosphereBack + 1,
          meta: { fx: 'rays', angle: 90, count: 6, intensity: 0.32 },
        }),
        ...cast,
        fxSlot('plinth-fog', { x: -0.05, y: 0.78, w: 1.1, h: 0.3 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'fog', height: 0.24 },
        }),
        shapeSlot('plinth', { x: 0, y: 0.9, w: 1, h: 0.1 }, {
          z: Z.shape,
          meta: { shape: 'bar', fill: 'accent', opacity: 0.9 },
        }),
        shapeSlot('headline-rule', { x: 0.045, y: 0.108, w: 0.16, h: 0.005 }, {
          z: Z.shape + 1,
          meta: { shape: 'rule', fill: 'accent' },
        }),
        textSlot('kicker', { x: 0.045, y: 0.05, w: 0.3, h: 0.052 }, {
          z: Z.text,
          anchor: 'center-left',
          meta: { weight: 'semibold', tracking: 0.26 },
        }),
        textSlot('headline', { x: 0.045, y: 0.125, w: 0.52, h: 0.145 }, {
          z: Z.text + 1,
          anchor: 'center-left',
          meta: { weight: 'black', lines: 2, leading: 0.88 },
        }),
        textSlot('subhead', { x: 0.045, y: 0.285, w: 0.42, h: 0.055 }, {
          z: Z.text + 2,
          anchor: 'center-left',
          meta: { weight: 'medium', tracking: 0.06 },
        }),
        textSlot('date', { x: 0.62, y: 0.05, w: 0.2, h: 0.052 }, {
          z: Z.text + 3,
          anchor: 'center-right',
          meta: { weight: 'medium', tracking: 0.2 },
        }),
        logoSlot('crest', { x: 0.855, y: 0.045, w: 0.115, h: 0.165 }, { z: Z.badge }),
      ],
      safeZones: ytSafeZones([
        reserve('headline-block', { x: 0.03, y: 0.04, w: 0.56, h: 0.28 }, 'Announcement type block — keep heads below it.'),
      ]),
      focalPoints: [
        { x: 0.3, y: 0.197 },
        { x: 0.5, y: 0.482 },
        { x: 0.912, y: 0.127 },
        { x: 0.25, y: 0.312 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'stage',
    backdrop: 'arena',
    brandStrength: 0.95,
    atmosphere: {
      haze: 0.36,
      fog: 0.24,
      rays: { angle: 90, count: 6, intensity: 0.32, color: '#E6F0FF' },
      particles: { kind: 'dust', density: 0.3, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 90, width: 3, color: '#FFFFFF', intensity: 0.7 },
      shadow: { dx: 0, dy: 10, blur: 34, color: '#000000', opacity: 0.55 },
      contrast: 1.06,
      saturation: 1.04,
    },
    grade: {
      exposure: 0.04,
      contrast: 1.12,
      saturation: 1.08,
      temperature: 4,
      shadowTint: '#0A1E30',
      highlightTint: '#FFDCAF',
      splitToneBalance: 0.48,
      lut: 'teal-orange',
      lutStrength: 0.42,
      grain: 0.08,
      bloomThreshold: 0.72,
      bloomIntensity: 0.34,
      vignette: 0.36,
      halation: 0.18,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 26, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 22, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 36, transform: 'upper' },
    { role: 'date', slotId: 'date', required: false, maxChars: 14, transform: 'upper' },
  ],
};

// ── transfer-alert ───────────────────────────────────────────────────────────

const transferAlert: ThumbnailTemplate = {
  id: 'transfer-alert',
  name: 'Transfer Alert',
  category: 'roster',
  description:
    'Breaking-news geometry: player on the left third, a heavy chevron arrow driving right, the destination crest large on the right, and the old crest small in the corner.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['roster', 'transfer', 'arrow', 'breaking', 'news', 'crest', 'urgent'],
  whenToUse:
    'Signings, benchings and rumour videos. The arrow gives direction at 210 px wide even when both crests are unfamiliar to the viewer.',
  layout: {
    id: 'transfer-alert',
    name: 'Transfer Alert',
    description: 'Left-third bust, centre chevron, destination crest at 0.82 — the eye travels left to right.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'grid' } }),
      blockSlot('wedge-right', { x: 0.5, y: 0, w: 0.5, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'diagonal-half', side: 'right', lean: 0.2, fill: 'right', opacity: 0.85 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.22 } }),
      fxSlot('speed', { x: 0.24, y: 0.2, w: 0.7, h: 0.44 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'speed-lines', angle: 0, density: 0.6 },
      }),
      bustSlot('subject', { x: -0.02, y: 0.1, w: 0.48, h: 0.9 }, {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.65, y: 0.28 },
        constraints: { faceKeepIn: { x: 0.18, y: 0.2, w: 0.24, h: 0.3 } },
        meta: { faceHeight: 0.26, preferFacing: 'right', rimAngle: 200 },
      }),
      shapeSlot('arrow', { x: 0.4, y: 0.33, w: 0.24, h: 0.16 }, {
        z: Z.shape,
        meta: { shape: 'chevron', direction: 'right', fill: 'accent', stroke: 'dark' },
      }),
      logoSlot('crest-to', { x: 0.68, y: 0.19, w: 0.28, h: 0.4 }, {
        z: Z.shape + 1,
        meta: { glow: 0.55, emphasis: 'destination' },
      }),
      shapeSlot('headline-bar', { x: 0.04, y: 0.785, w: 0.56, h: 0.145 }, {
        z: Z.shape + 2,
        meta: { shape: 'bar', fill: 'accent', skew: 0.03 },
      }),
      textSlot('headline', { x: 0.06, y: 0.8, w: 0.52, h: 0.115 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('subhead', { x: 0.06, y: 0.925, w: 0.4, h: 0.055 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'medium', tracking: 0.1 },
      }),
      textSlot('kicker', { x: 0.62, y: 0.05, w: 0.34, h: 0.07 }, {
        z: Z.text + 2,
        anchor: 'center-right',
        meta: { weight: 'bold', tracking: 0.2 },
      }),
      textSlot('left-team', { x: 0.185, y: 0.055, w: 0.2, h: 0.05 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'medium', tracking: 0.16, strike: true },
      }),
      textSlot('right-team', { x: 0.68, y: 0.605, w: 0.28, h: 0.06 }, {
        z: Z.text + 4,
        meta: { weight: 'bold', tracking: 0.12 },
      }),
      logoSlot('crest-from', { x: 0.045, y: 0.045, w: 0.12, h: 0.17 }, {
        z: Z.badge,
        opacity: 0.75,
        meta: { emphasis: 'origin', desaturate: 0.6 },
      }),
      badgeSlot('badge', { x: 0.4, y: 0.5, w: 0.24, h: 0.075 }, {
        z: Z.badge + 1,
        meta: { shape: 'pill', fill: 'light' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('arrow-corridor', { x: 0.36, y: 0.28, w: 0.32, h: 0.26 }, 'The arrow corridor carries the whole idea — keep it clear.'),
    ]),
    focalPoints: [
      { x: 0.292, y: 0.352 },
      { x: 0.82, y: 0.39 },
      { x: 0.52, y: 0.41 },
      { x: 0.32, y: 0.857 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'neon-wash',
    backdrop: 'grid',
    brandStrength: 0.9,
    atmosphere: {
      haze: 0.22,
      speedLines: { angle: 0, density: 0.6, color: '#FFFFFF' },
      particles: { kind: 'spark', density: 0.25, bias: 'right' },
    },
    subjectEffects: {
      rimLight: { angle: 200, width: 3, color: '#FF3B5C', intensity: 0.8 },
      stroke: { width: 3, color: '#0B0C12' },
      contrast: 1.1,
      saturation: 1.12,
    },
    grade: {
      exposure: 0.06,
      contrast: 1.2,
      saturation: 1.24,
      temperature: 6,
      shadowTint: '#1A0A18',
      highlightTint: '#FFE7C2',
      splitToneBalance: 0.45,
      lut: 'crimson-contrast',
      lutStrength: 0.4,
      grain: 0.06,
      bloomThreshold: 0.68,
      bloomIntensity: 0.4,
      vignette: 0.32,
      chromaticAberration: 1.6,
      halation: 0.2,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 24, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, defaultText: 'TRANSFER WINDOW', maxChars: 20, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 34, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 12, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 14, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, defaultText: 'OFFICIAL', maxChars: 12, transform: 'upper' },
  ],
};

export const rosterTemplates: ThumbnailTemplate[] = [rosterReveal, transferAlert];
