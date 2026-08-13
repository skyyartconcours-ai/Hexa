/**
 * STREAM — podcasts, watch-alongs and live cards.
 *
 * Live and long-form formats need a different register: warmer, closer to
 * broadcast furniture than to poster art. The organising device is the lower
 * third, exactly as it would be on the stream itself.
 */

import type { LayoutSpec, Slot, TemplateContext, ThumbnailTemplate } from '@hexa/core';
import { clamp } from '@hexa/core';
import {
  RATIO_16_9,
  WIDE_ASPECTS,
  Z,
  badgeSlot,
  blockSlot,
  bustSlot,
  facePoint,
  fxSlot,
  gridSlots,
  hazeSlot,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

// ── podcast-panel ────────────────────────────────────────────────────────────

const podcastPanel: ThumbnailTemplate = {
  id: 'podcast-panel',
  name: 'Podcast Panel',
  category: 'stream',
  description:
    'Two to four seated panellists across a warm studio band with a broadcast lower third carrying the episode title and number.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 4 },
  tags: ['stream', 'podcast', 'panel', 'lower-third', 'studio', 'adaptive', 'warm'],
  whenToUse:
    'Podcasts, watch-alongs and desk segments. Faces sit at eye level and stay the same size, which is what makes a panel read as a conversation rather than a versus.',
  layout: (ctx: TemplateContext): LayoutSpec => {
    const n = clamp(ctx.subjects.length || 3, 2, 4);
    const panel: Slot[] = gridSlots('host', n, 1, { x: 0.08, y: 0.1, w: 0.84, h: 0.72 }, 0.015).map((s, i) => ({
      ...s,
      focal: { x: 0.5, y: 0.36 },
      meta: { ...(s.meta ?? {}), faceHeight: n > 3 ? 0.17 : 0.21, seat: i, captionFrom: 'player.handle' },
    }));
    const faces = panel.map((s) => facePoint(s));
    return {
      id: 'podcast-panel',
      name: 'Podcast Panel',
      description: 'Even seating across x 0.08–0.92 with eyes on y 0.36 and a 14%-tall lower third.',
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 70 } }),
        blockSlot('studio-wash', { x: 0, y: 0, w: 1, h: 0.8 }, {
          z: Z.backplate + 1,
          meta: { shape: 'block', fill: 'left', opacity: 0.4, bokeh: 0.4 },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.3 } }),
        fxSlot('bokeh', { x: 0, y: 0, w: 1, h: 0.7 }, {
          z: Z.atmosphereBack + 1,
          meta: { fx: 'bokeh', density: 0.4, fill: 'accent' },
        }),
        ...panel,
        fxSlot('desk-glow', { x: 0, y: 0.66, w: 1, h: 0.2 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'glow-bar', fill: 'accent', intensity: 0.35 },
        }),
        shapeSlot('lower-third', { x: 0, y: 0.78, w: 1, h: 0.14 }, {
          z: Z.shape,
          meta: { shape: 'bar', fill: 'dark', opacity: 0.9, stroke: 'accent' },
        }),
        shapeSlot('lower-third-tab', { x: 0, y: 0.78, w: 0.012, h: 0.14 }, {
          z: Z.shape + 1,
          meta: { shape: 'bar', fill: 'accent' },
        }),
        textSlot('headline', { x: 0.05, y: 0.795, w: 0.62, h: 0.09 }, {
          z: Z.text,
          anchor: 'center-left',
          meta: { weight: 'black' },
        }),
        textSlot('caption', { x: 0.05, y: 0.895, w: 0.44, h: 0.055 }, {
          z: Z.text + 1,
          anchor: 'center-left',
          meta: { weight: 'medium', tracking: 0.1 },
        }),
        textSlot('kicker', { x: 0.7, y: 0.06, w: 0.26, h: 0.055 }, {
          z: Z.text + 2,
          anchor: 'center-right',
          meta: { weight: 'semibold', tracking: 0.22 },
        }),
        badgeSlot('badge', { x: 0.045, y: 0.055, w: 0.16, h: 0.075 }, {
          z: Z.badge,
          anchor: 'center-left',
          meta: { shape: 'square', fill: 'accent' },
        }),
      ],
      safeZones: ytSafeZones([
        reserve('lower-third-band', { x: 0, y: 0.76, w: 0.78, h: 0.24 }, 'Lower third — panellists must be cropped above it.'),
      ]),
      focalPoints: [
        faces[0] ?? { x: 0.29, y: 0.36 },
        faces[1] ?? { x: 0.71, y: 0.36 },
        { x: 0.36, y: 0.84 },
        { x: 0.125, y: 0.0925 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'clean',
    backdrop: 'gradient',
    brandStrength: 0.5,
    atmosphere: {
      haze: 0.3,
      particles: { kind: 'dust', density: 0.2, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 120, width: 3, color: '#FFD9A8', intensity: 0.55 },
      shadow: { dx: 0, dy: 8, blur: 26, color: '#000000', opacity: 0.45 },
      contrast: 1.04,
      saturation: 1.02,
    },
    grade: {
      exposure: 0.02,
      contrast: 1.08,
      saturation: 1.04,
      temperature: 10,
      shadowTint: '#1A1408',
      highlightTint: '#FFEBC8',
      splitToneBalance: 0.46,
      lut: 'ember',
      lutStrength: 0.3,
      grain: 0.07,
      bloomThreshold: 0.78,
      bloomIntensity: 0.24,
      vignette: 0.34,
      halation: 0.16,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 34, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 30, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 20, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, defaultText: 'EP', maxChars: 6, transform: 'upper' },
  ],
};

// ── watchparty-live ──────────────────────────────────────────────────────────

const watchpartyLive: ThumbnailTemplate = {
  id: 'watchparty-live',
  name: 'Watchparty Live',
  category: 'stream',
  description:
    'Live card: a red LIVE flag top-left over a big two-line hook, a framed facecam parked in the lower-left corner, and a column of schedule chips down the right.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 1, max: 1 },
  tags: ['stream', 'live', 'watchparty', 'facecam', 'schedule', 'urgent', 'single'],
  whenToUse:
    'Co-streams, watch parties and premieres. The facecam frame lets you use a webcam grab — the one place in the library where a low-resolution source is on-brand.',
  layout: {
    id: 'watchparty-live',
    name: 'Watchparty Live',
    description: 'Hook top-left, 0.26×0.40 facecam frame bottom-left, three schedule chips on the right.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'ai', blur: 0.02 } }),
      blockSlot('scrim', { x: 0, y: 0, w: 0.68, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'scrim', fill: 'dark', opacity: 0.72, gradient: 'right' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.18 } }),
      bustSlot('subject', { x: 0.045, y: 0.52, w: 0.26, h: 0.4 }, {
        z: Z.subject,
        anchor: 'bottom-center',
        fit: 'face-anchor',
        focal: { x: 0.5, y: 0.36 },
        constraints: { faceKeepIn: { x: 0.08, y: 0.58, w: 0.19, h: 0.18 }, clampToCanvas: true },
        meta: { faceHeight: 0.16, preferFacing: 'right', source: 'facecam', maskTo: 'facecam-frame' },
      }),
      fxSlot('live-pulse', { x: 0.03, y: 0.03, w: 0.2, h: 0.1 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'pulse', fill: '#FF2E3F', rate: 0.5 },
      }),
      shapeSlot('facecam-frame', { x: 0.045, y: 0.52, w: 0.26, h: 0.4 }, {
        z: Z.shape,
        meta: { shape: 'frame', stroke: 'accent', width: 0.005, radius: 0.012 },
      }),
      shapeSlot('chip-1', { x: 0.62, y: 0.2, w: 0.34, h: 0.1 }, {
        z: Z.shape + 1,
        meta: { shape: 'panel', fill: 'dark', opacity: 0.7, stroke: 'accent', radius: 0.008 },
      }),
      shapeSlot('chip-2', { x: 0.62, y: 0.34, w: 0.34, h: 0.1 }, {
        z: Z.shape + 2,
        meta: { shape: 'panel', fill: 'dark', opacity: 0.7, stroke: 'accent', radius: 0.008 },
      }),
      shapeSlot('chip-3', { x: 0.62, y: 0.48, w: 0.34, h: 0.1 }, {
        z: Z.shape + 3,
        meta: { shape: 'panel', fill: 'dark', opacity: 0.7, stroke: 'accent', radius: 0.008 },
      }),
      textSlot('headline', { x: 0.045, y: 0.13, w: 0.52, h: 0.22 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'black', lines: 2, leading: 0.88 },
      }),
      textSlot('subhead', { x: 0.045, y: 0.375, w: 0.44, h: 0.06 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'medium' },
      }),
      textSlot('caption', { x: 0.64, y: 0.215, w: 0.3, h: 0.07 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'bold', scheduleRow: 0 },
      }),
      textSlot('kicker', { x: 0.64, y: 0.355, w: 0.3, h: 0.07 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'bold', scheduleRow: 1 },
      }),
      textSlot('date', { x: 0.64, y: 0.495, w: 0.3, h: 0.07 }, {
        z: Z.text + 4,
        anchor: 'center-left',
        meta: { weight: 'bold', scheduleRow: 2 },
      }),
      textSlot('left-name', { x: 0.045, y: 0.93, w: 0.26, h: 0.055 }, {
        z: Z.text + 5,
        meta: { weight: 'bold', tracking: 0.1 },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.045, w: 0.14, h: 0.065 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: '#FF2E3F', dot: true },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('facecam-box', { x: 0.03, y: 0.5, w: 0.29, h: 0.44 }, 'Facecam frame — keep chips and copy out of it.'),
    ]),
    focalPoints: [
      { x: 0.29, y: 0.24 },
      { x: 0.175, y: 0.664 },
      { x: 0.79, y: 0.25 },
      { x: 0.115, y: 0.078 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'neon-wash',
    backdrop: 'ai',
    brandStrength: 0.55,
    atmosphere: {
      haze: 0.18,
      particles: { kind: 'dust', density: 0.18, bias: 'right' },
    },
    subjectEffects: {
      rimLight: { angle: 160, width: 2, color: '#FF6A78', intensity: 0.5 },
      shadow: { dx: 0, dy: 6, blur: 20, color: '#000000', opacity: 0.5 },
      contrast: 1.06,
      saturation: 1.06,
    },
    grade: {
      exposure: 0.02,
      contrast: 1.14,
      saturation: 1.12,
      temperature: 4,
      shadowTint: '#1A0810',
      highlightTint: '#FFE0D0',
      splitToneBalance: 0.44,
      lut: 'crimson-contrast',
      lutStrength: 0.35,
      grain: 0.06,
      bloomThreshold: 0.72,
      bloomIntensity: 0.32,
      vignette: 0.36,
      chromaticAberration: 1,
      halation: 0.18,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 32, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 34, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 22, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 22, transform: 'upper' },
    { role: 'date', slotId: 'date', required: false, maxChars: 22, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: false, maxChars: 16, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, defaultText: 'LIVE', maxChars: 6, transform: 'upper' },
  ],
};

export const streamTemplates: ThumbnailTemplate[] = [podcastPanel, watchpartyLive];
