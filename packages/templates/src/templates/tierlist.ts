/**
 * TIERLIST — ranking grids and podiums.
 *
 * Ranking content lives or dies on legibility of *order*. Both layouts encode
 * rank spatially before they encode it typographically: the grid reads left to
 * right, top to bottom; the podium reads by height and by distance from centre.
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

// ── tierlist-grid ────────────────────────────────────────────────────────────

const tierlistGrid: ThumbnailTemplate = {
  id: 'tierlist-grid',
  name: 'Tier List Grid',
  category: 'tierlist',
  description:
    'A type column on the left third and an adaptive portrait grid filling the right two-thirds — the grid rebalances from a single row of three up to four-by-three for twelve.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 3, max: 12 },
  tags: ['tierlist', 'ranking', 'grid', 'adaptive', 'listicle', 'chips', 'analysis'],
  whenToUse:
    'Rank-the-players videos, power rankings and pool tiers. Pick it whenever the video is a list — the grid promises "several answers" at a glance.',
  layout: (ctx: TemplateContext): LayoutSpec => {
    const n = clamp(ctx.subjects.length || 6, 3, 12);
    const rows = Math.ceil(n / 4);
    const cols = Math.ceil(n / rows);
    const cells = gridSlots('rank', cols, rows, { x: 0.3, y: 0.1, w: 0.66, h: 0.8 }, 0.012)
      .slice(0, n)
      .map((s, i) => ({
        ...s,
        fit: 'face-anchor' as const,
        focal: { x: 0.5, y: 0.34 },
        meta: { ...(s.meta ?? {}), rank: i + 1, rankChip: true, faceHeight: rows > 2 ? 0.11 : 0.16 },
      }));
    return {
      id: 'tierlist-grid',
      name: 'Tier List Grid',
      description: `Adaptive ${cols}×${rows} portrait grid with rank chips, type column reserved on the left third.`,
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'grid' } }),
        blockSlot('type-plate', { x: 0, y: 0, w: 0.28, h: 1 }, {
          z: Z.backplate + 1,
          meta: { shape: 'block', fill: 'left', opacity: 0.9 },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.18 } }),
        ...cells,
        fxSlot('grid-glow', { x: 0.29, y: 0.09, w: 0.68, h: 0.82 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'edge-glow', fill: 'accent', intensity: 0.35 },
        }),
        shapeSlot('grid-frame', { x: 0.29, y: 0.09, w: 0.68, h: 0.82 }, {
          z: Z.shape,
          meta: { shape: 'frame', stroke: 'light', width: 0.003, radius: 0.008 },
        }),
        shapeSlot('type-rule', { x: 0.04, y: 0.345, w: 0.14, h: 0.005 }, {
          z: Z.shape + 1,
          meta: { shape: 'rule', fill: 'accent' },
        }),
        textSlot('kicker', { x: 0.04, y: 0.06, w: 0.2, h: 0.05 }, {
          z: Z.text,
          anchor: 'center-left',
          meta: { weight: 'semibold', tracking: 0.24 },
        }),
        textSlot('headline', { x: 0.04, y: 0.125, w: 0.22, h: 0.2 }, {
          z: Z.text + 1,
          anchor: 'center-left',
          meta: { weight: 'black', lines: 3, leading: 0.84 },
        }),
        textSlot('subhead', { x: 0.04, y: 0.37, w: 0.2, h: 0.06 }, {
          z: Z.text + 2,
          anchor: 'center-left',
          meta: { weight: 'medium' },
        }),
        textSlot('caption', { x: 0.04, y: 0.46, w: 0.2, h: 0.055 }, {
          z: Z.text + 3,
          anchor: 'center-left',
          meta: { weight: 'regular', tracking: 0.08 },
        }),
        badgeSlot('badge', { x: 0.04, y: 0.845, w: 0.18, h: 0.075 }, {
          z: Z.badge,
          anchor: 'center-left',
          meta: { shape: 'pill', fill: 'accent' },
        }),
      ],
      safeZones: ytSafeZones([
        reserve('type-column', { x: 0, y: 0, w: 0.28, h: 1 }, 'Left plate is the type column — portraits must not spill into it.'),
      ]),
      focalPoints: [
        { x: 0.15, y: 0.225 },
        { x: 0.3 + 0.66 / (cols * 2), y: 0.1 + 0.8 / (rows * 2) },
        { x: 0.63, y: 0.5 },
        { x: 0.13, y: 0.882 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'neon-wash',
    backdrop: 'grid',
    brandStrength: 0.6,
    atmosphere: {
      haze: 0.18,
      particles: { kind: 'dust', density: 0.2, bias: 'none' },
    },
    subjectEffects: {
      stroke: { width: 2, color: '#0B0C12' },
      shadow: { dx: 0, dy: 4, blur: 16, color: '#000000', opacity: 0.45 },
      contrast: 1.08,
      saturation: 1.06,
    },
    grade: {
      exposure: 0.02,
      contrast: 1.1,
      saturation: 1.1,
      temperature: -2,
      shadowTint: '#101A2A',
      highlightTint: '#EAF2FF',
      splitToneBalance: 0.5,
      lut: 'cold-steel',
      lutStrength: 0.35,
      grain: 0.05,
      bloomThreshold: 0.8,
      bloomIntensity: 0.22,
      vignette: 0.28,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 22, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 18, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 24, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 24, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 12, transform: 'upper' },
  ],
};

// ── ranking-podium ───────────────────────────────────────────────────────────

/** Position table, first place first. Distance from centre encodes rank. */
const PODIUM: { x: number; w: number; y: number; h: number; faceY: number; plinth: number }[] = [
  { x: 0.355, w: 0.29, y: 0.1, h: 0.78, faceY: 0.26, plinth: 0.28 },
  { x: 0.09, w: 0.25, y: 0.2, h: 0.68, faceY: 0.36, plinth: 0.21 },
  { x: 0.66, w: 0.25, y: 0.22, h: 0.66, faceY: 0.38, plinth: 0.19 },
  { x: -0.03, w: 0.2, y: 0.3, h: 0.58, faceY: 0.45, plinth: 0.15 },
  { x: 0.83, w: 0.2, y: 0.32, h: 0.56, faceY: 0.46, plinth: 0.13 },
];

const rankingPodium: ThumbnailTemplate = {
  id: 'ranking-podium',
  name: 'Ranking Podium',
  category: 'tierlist',
  description:
    'A ceremony: first place centred and tallest, the rest stepping down and outward onto shorter plinths, with the number one chip riding the front block.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 3, max: 5 },
  tags: ['tierlist', 'podium', 'ranking', 'ceremony', 'symmetry', 'top3', 'adaptive'],
  whenToUse:
    'Top-three and top-five countdowns where the winner is the payoff. The height difference does the ranking work before anyone reads a number.',
  layout: (ctx: TemplateContext): LayoutSpec => {
    const n = clamp(ctx.subjects.length || 3, 3, 5);
    const people: Slot[] = [];
    const plinths: Slot[] = [];
    for (let i = 0; i < n; i++) {
      const p = PODIUM[i]!;
      people.push(
        bustSlot(`place-${i + 1}`, { x: p.x, y: p.y, w: p.w, h: p.h }, {
          z: Z.subject + (5 - i),
          anchor: 'bottom-center',
          focal: { x: 0.5, y: p.faceY },
          meta: { rank: i + 1, faceHeight: i === 0 ? 0.22 : 0.16, captionFrom: 'player.handle' },
        }),
      );
      // Busts may bleed off the canvas; plinths are furniture and must not.
      const px = Math.max(0, p.x + 0.005);
      const pw = Math.min(1 - px, p.w - 0.01);
      plinths.push(
        shapeSlot(
          `plinth-${i + 1}`,
          { x: px, y: 1 - p.plinth, w: pw, h: p.plinth },
          {
            z: Z.shape + i,
            meta: { shape: 'plinth', rank: i + 1, fill: i === 0 ? 'accent' : 'dark', numeral: true },
          },
        ),
      );
    }
    return {
      id: 'ranking-podium',
      name: 'Ranking Podium',
      description: 'Centre-first podium arc, plinth heights 0.28 → 0.13 with rank, headline across the top.',
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial', center: [0.5, 0.34] } }),
        blockSlot('spot', { x: 0.24, y: 0, w: 0.52, h: 0.86 }, {
          z: Z.backplate + 1,
          meta: { shape: 'cone', fill: 'accent', opacity: 0.35 },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.42 } }),
        ...people,
        fxSlot('floor-fog', { x: -0.05, y: 0.66, w: 1.1, h: 0.4 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'fog', height: 0.3 },
        }),
        fxSlot('dust', { x: 0.1, y: -0.05, w: 0.8, h: 1.05 }, {
          z: Z.atmosphereFront + 1,
          meta: { fx: 'particles', particles: 'dust', density: 0.4, bias: 'center' },
        }),
        ...plinths,
        textSlot('headline', { x: 0.06, y: 0.05, w: 0.52, h: 0.1 }, {
          z: Z.text,
          anchor: 'center-left',
          meta: { weight: 'black' },
        }),
        textSlot('subhead', { x: 0.06, y: 0.16, w: 0.4, h: 0.055 }, {
          z: Z.text + 1,
          anchor: 'center-left',
          meta: { weight: 'medium', tracking: 0.14 },
        }),
        textSlot('rank', { x: 0.435, y: 0.775, w: 0.13, h: 0.1 }, {
          z: Z.text + 2,
          meta: { weight: 'black', italic: true },
        }),
        textSlot('caption', { x: 0.06, y: 0.875, w: 0.34, h: 0.06 }, {
          z: Z.text + 3,
          anchor: 'center-left',
          meta: { weight: 'medium' },
        }),
        badgeSlot('badge', { x: 0.7, y: 0.05, w: 0.24, h: 0.075 }, {
          z: Z.badge,
          anchor: 'center-right',
          meta: { shape: 'pill', fill: 'light' },
        }),
      ],
      safeZones: ytSafeZones([
        reserve('podium-floor', { x: 0.24, y: 0.72, w: 0.52, h: 0.28 }, 'Front plinth carries the rank numeral.'),
      ]),
      focalPoints: [
        { x: 0.5, y: 0.303 },
        { x: 0.215, y: 0.445 },
        { x: 0.785, y: 0.471 },
        { x: 0.5, y: 0.825 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'stage',
    backdrop: 'radial',
    brandStrength: 0.65,
    atmosphere: {
      haze: 0.42,
      fog: 0.3,
      rays: { angle: 90, count: 5, intensity: 0.4, color: '#FFF0CF' },
      particles: { kind: 'dust', density: 0.4, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 90, width: 4, color: '#FFE9B8', intensity: 0.8 },
      shadow: { dx: 0, dy: 12, blur: 36, color: '#000000', opacity: 0.6 },
      contrast: 1.08,
      saturation: 1.02,
    },
    grade: {
      exposure: 0.02,
      contrast: 1.16,
      saturation: 1.04,
      temperature: 10,
      shadowTint: '#1A1206',
      highlightTint: '#FFE2A6',
      splitToneBalance: 0.42,
      lut: 'ember',
      lutStrength: 0.4,
      grain: 0.09,
      bloomThreshold: 0.68,
      bloomIntensity: 0.42,
      vignette: 0.42,
      halation: 0.28,
    },
  },
  textSlots: [
    { role: 'headline', slotId: 'headline', required: true, maxChars: 26, transform: 'upper' },
    { role: 'subhead', slotId: 'subhead', required: false, maxChars: 32, transform: 'upper' },
    { role: 'rank', slotId: 'rank', required: false, defaultText: '#1', maxChars: 4, transform: 'upper' },
    { role: 'caption', slotId: 'caption', required: false, maxChars: 26, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 14, transform: 'upper' },
  ],
};

export const tierlistTemplates: ThumbnailTemplate[] = [tierlistGrid, rankingPodium];
