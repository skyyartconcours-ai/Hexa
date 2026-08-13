/**
 * TEAM-VERSUS — 5v5 lineups and crest-led matchups.
 *
 * Ten faces will never read like two faces, so these layouts stop pretending.
 * The organising element becomes the band, the rail or the crest, and the cast
 * is arranged into an even rhythm behind it. Faces here run 11–14% of canvas
 * height: small, but readable because every cell is identical and the eye only
 * has to parse the pattern once.
 */

import type { LayoutSpec, Slot, TemplateContext, ThumbnailTemplate } from '@hexa/core';
import { clamp } from '@hexa/core';
import {
  RATIO_16_9,
  WIDE_ASPECTS,
  Z,
  badgeSlot,
  blockSlot,
  fxSlot,
  gridSlots,
  hazeSlot,
  inwardBust,
  logoSlot,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

/** Re-key a generated row so ids, z and meta stay unique across two calls. */
function offsetRow(slots: Slot[], zBase: number, indexBase: number, extra: Record<string, unknown>): Slot[] {
  return slots.map((s, i) => ({
    ...s,
    z: zBase + i,
    meta: { ...(s.meta ?? {}), index: indexBase + i, ...extra },
  }));
}

// ── lineup-5v5 ───────────────────────────────────────────────────────────────

const lineup5v5: ThumbnailTemplate = {
  id: 'lineup-5v5',
  name: 'Lineup 5v5',
  category: 'team-versus',
  description:
    'Two rows of five separated by a full-width broadcast band carrying both team tags, their crests and the VS — the fixture-card read for a full roster clash.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 10, max: 10 },
  tags: ['team-versus', 'lineup', '5v5', 'band', 'broadcast', 'roster', 'grid'],
  whenToUse:
    'Full-roster matchups where every player matters: series previews, playoff fixtures, and any video whose title names the teams rather than the players.',
  layout: (): LayoutSpec => {
    const rowA = gridSlots('player-a', 5, 1, { x: 0.015, y: 0.14, w: 0.97, h: 0.3 }, 0.012);
    const rowB = offsetRow(
      gridSlots('player-b', 5, 1, { x: 0.015, y: 0.56, w: 0.97, h: 0.3 }, 0.012),
      Z.subject + 5,
      5,
      { side: 'bottom', faceHeight: 0.12 },
    );
    return {
      id: 'lineup-5v5',
      name: 'Lineup 5v5',
      description: 'Five-up, five-down, split by a 9%-tall band at the vertical centre.',
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'arena' } }),
        blockSlot('block-top', { x: 0, y: 0, w: 1, h: 0.46 }, {
          z: Z.backplate + 1,
          meta: { shape: 'block', fill: 'left', falloff: 0.6 },
        }),
        blockSlot('block-bottom', { x: 0, y: 0.54, w: 1, h: 0.46 }, {
          z: Z.backplate + 2,
          meta: { shape: 'block', fill: 'right', falloff: 0.6 },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.3 } }),
        ...rowA.map((s, i) => ({ ...s, meta: { ...(s.meta ?? {}), side: 'top', faceHeight: 0.12, roleOrder: i } })),
        ...rowB,
        fxSlot('band-glow', { x: 0, y: 0.42, w: 1, h: 0.16 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'glow-bar', fill: 'accent' },
        }),
        shapeSlot('band', { x: 0, y: 0.455, w: 1, h: 0.09 }, {
          z: Z.shape,
          meta: { shape: 'bar', fill: 'dark', opacity: 0.92, stroke: 'accent' },
        }),
        textSlot('vs', { x: 0.44, y: 0.462, w: 0.12, h: 0.076 }, {
          z: Z.text,
          meta: { weight: 'black', italic: true },
        }),
        textSlot('left-team', { x: 0.03, y: 0.462, w: 0.28, h: 0.076 }, {
          z: Z.text + 1,
          anchor: 'center-left',
          meta: { weight: 'bold', tracking: 0.08 },
        }),
        textSlot('right-team', { x: 0.69, y: 0.462, w: 0.28, h: 0.076 }, {
          z: Z.text + 2,
          anchor: 'center-right',
          meta: { weight: 'bold', tracking: 0.08 },
        }),
        textSlot('headline', { x: 0.12, y: 0.885, w: 0.56, h: 0.085 }, {
          z: Z.text + 3,
          anchor: 'center-left',
          meta: { weight: 'black' },
        }),
        textSlot('kicker', { x: 0.34, y: 0.035, w: 0.32, h: 0.065 }, {
          z: Z.text + 4,
          meta: { weight: 'semibold', tracking: 0.22 },
        }),
        logoSlot('crest-left', { x: 0.335, y: 0.458, w: 0.075, h: 0.084 }, { z: Z.badge }),
        logoSlot('crest-right', { x: 0.59, y: 0.458, w: 0.075, h: 0.084 }, { z: Z.badge + 1 }),
        badgeSlot('badge', { x: 0.025, y: 0.885, w: 0.08, h: 0.085 }, {
          z: Z.badge + 2,
          meta: { shape: 'square', fill: 'accent' },
        }),
      ],
      safeZones: ytSafeZones([
        reserve('centre-band', { x: 0, y: 0.44, w: 1, h: 0.12 }, 'The band is the spine of the layout — no cutout may cross it.'),
      ]),
      focalPoints: [
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.242 },
        { x: 0.5, y: 0.662 },
        { x: 0.4, y: 0.928 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'stage',
    backdrop: 'arena',
    brandStrength: 0.9,
    atmosphere: {
      haze: 0.3,
      fog: 0.12,
      rays: { angle: 90, count: 6, intensity: 0.25, color: '#CFE4FF' },
    },
    subjectEffects: {
      rimLight: { angle: 90, width: 3, color: '#FFFFFF', intensity: 0.6 },
      shadow: { dx: 0, dy: 5, blur: 18, color: '#000000', opacity: 0.5 },
      contrast: 1.05,
    },
    grade: {
      exposure: 0,
      contrast: 1.12,
      saturation: 1.06,
      temperature: 2,
      shadowTint: '#0C1E2E',
      highlightTint: '#FFE1B8',
      splitToneBalance: 0.5,
      lut: 'teal-orange',
      lutStrength: 0.4,
      grain: 0.07,
      bloomThreshold: 0.75,
      bloomIntensity: 0.28,
      vignette: 0.34,
      halation: 0.15,
    },
  },
  textSlots: [
    { role: 'left-team', slotId: 'left-team', required: true, maxChars: 16, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: true, maxChars: 16, transform: 'upper' },
    { role: 'vs', slotId: 'vs', required: false, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'headline', slotId: 'headline', required: false, maxChars: 34, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 28, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 3, transform: 'upper' },
  ],
};

// ── lineup-hero-flank ────────────────────────────────────────────────────────

const lineupHeroFlank: ThumbnailTemplate = {
  id: 'lineup-hero-flank',
  name: 'Lineup Hero Flank',
  category: 'team-versus',
  description:
    'Two star players large on the thirds with their three teammates stacked small down each outer rail — hierarchy first, roster second.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 8, max: 8 },
  tags: ['team-versus', 'lineup', 'hierarchy', 'rail', 'stars', 'flank', 'roster'],
  whenToUse:
    'When the story is a duel inside a team fixture — the carry matchup that decides the series — but you still want to show who else is on the server.',
  layout: (): LayoutSpec => {
    const flankLeft = offsetRow(
      gridSlots('flank-left', 1, 3, { x: 0.005, y: 0.06, w: 0.115, h: 0.68 }, 0.015),
      Z.subject,
      0,
      { side: 'left', role: 'flank', faceHeight: 0.09 },
    );
    const flankRight = offsetRow(
      gridSlots('flank-right', 1, 3, { x: 0.88, y: 0.06, w: 0.115, h: 0.68 }, 0.015),
      Z.subject + 3,
      3,
      { side: 'right', role: 'flank', faceHeight: 0.09 },
    );
    return {
      id: 'lineup-hero-flank',
      name: 'Lineup Hero Flank',
      description: 'Two 0.30/0.70 hero busts, six 9% flank heads on the outer rails, VS plate at centre.',
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 90 } }),
        blockSlot('rail-plate-left', { x: 0, y: 0, w: 0.13, h: 1 }, {
          z: Z.backplate + 1,
          meta: { shape: 'block', fill: 'left', opacity: 0.85 },
        }),
        blockSlot('rail-plate-right', { x: 0.87, y: 0, w: 0.13, h: 1 }, {
          z: Z.backplate + 2,
          meta: { shape: 'block', fill: 'right', opacity: 0.85 },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.32 } }),
        ...flankLeft,
        ...flankRight,
        inwardBust('star-left', { x: 0.1, y: 0.06, w: 0.44, h: 0.94 }, 'right', {
          z: Z.subject + 10,
          anchor: 'bottom-center',
          focal: { x: 0.455, y: 0.3 },
          constraints: { faceKeepIn: { x: 0.2, y: 0.2, w: 0.24, h: 0.3 } },
          meta: { preferFacing: 'right', faceHeight: 0.24, role: 'star', side: 'left', rimAngle: 205 },
        }),
        inwardBust('star-right', { x: 0.46, y: 0.06, w: 0.44, h: 0.94 }, 'left', {
          z: Z.subject + 11,
          anchor: 'bottom-center',
          focal: { x: 0.545, y: 0.3 },
          constraints: { faceKeepIn: { x: 0.56, y: 0.2, w: 0.24, h: 0.3 } },
          meta: { preferFacing: 'left', faceHeight: 0.24, role: 'star', side: 'right', rimAngle: 335 },
        }),
        fxSlot('centre-glow', { x: 0.36, y: 0.1, w: 0.28, h: 0.7 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'radial-glow', fill: 'accent' },
        }),
        shapeSlot('rail-rule-left', { x: 0.128, y: 0.06, w: 0.004, h: 0.68 }, {
          z: Z.shape,
          meta: { shape: 'rule', fill: 'accent' },
        }),
        shapeSlot('rail-rule-right', { x: 0.868, y: 0.06, w: 0.004, h: 0.68 }, {
          z: Z.shape + 1,
          meta: { shape: 'rule', fill: 'accent' },
        }),
        shapeSlot('vs-plate', { x: 0.435, y: 0.335, w: 0.13, h: 0.15 }, {
          z: Z.shape + 2,
          rotation: 45,
          meta: { shape: 'diamond', fill: 'dark', stroke: 'light' },
        }),
        textSlot('vs', { x: 0.445, y: 0.35, w: 0.11, h: 0.12 }, {
          z: Z.text,
          meta: { weight: 'black', italic: true },
        }),
        textSlot('left-team', { x: 0.06, y: 0.775, w: 0.24, h: 0.055 }, {
          z: Z.text + 1,
          anchor: 'center-left',
          meta: { weight: 'medium', tracking: 0.16 },
        }),
        textSlot('right-team', { x: 0.5, y: 0.775, w: 0.24, h: 0.055 }, {
          z: Z.text + 2,
          anchor: 'center-right',
          meta: { weight: 'medium', tracking: 0.16 },
        }),
        textSlot('left-name', { x: 0.06, y: 0.845, w: 0.3, h: 0.095 }, {
          z: Z.text + 3,
          anchor: 'center-left',
          meta: { weight: 'black' },
        }),
        textSlot('right-name', { x: 0.44, y: 0.845, w: 0.3, h: 0.095 }, {
          z: Z.text + 4,
          anchor: 'center-right',
          meta: { weight: 'black' },
        }),
        textSlot('kicker', { x: 0.35, y: 0.03, w: 0.3, h: 0.06 }, {
          z: Z.text + 5,
          meta: { weight: 'semibold', tracking: 0.24 },
        }),
      ],
      safeZones: ytSafeZones([
        reserve('flank-rails', { x: 0, y: 0.04, w: 0.14, h: 0.72 }, 'Left rail belongs to the flank heads.'),
      ]),
      focalPoints: [
        { x: 0.3, y: 0.342 },
        { x: 0.7, y: 0.342 },
        { x: 0.5, y: 0.41 },
        { x: 0.21, y: 0.892 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'split-rim',
    backdrop: 'gradient',
    brandStrength: 0.8,
    atmosphere: {
      haze: 0.32,
      fog: 0.14,
      particles: { kind: 'dust', density: 0.3, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 205, width: 3, color: '#9FE0FF', intensity: 0.75 },
      shadow: { dx: 0, dy: 6, blur: 24, color: '#000000', opacity: 0.5 },
      contrast: 1.06,
      saturation: 1.02,
    },
    grade: {
      exposure: 0.02,
      contrast: 1.15,
      saturation: 1.05,
      temperature: 4,
      shadowTint: '#0A2434',
      highlightTint: '#FFCB8F',
      splitToneBalance: 0.48,
      lut: 'teal-orange',
      lutStrength: 0.5,
      grain: 0.08,
      bloomThreshold: 0.74,
      bloomIntensity: 0.32,
      vignette: 0.38,
      chromaticAberration: 1,
      halation: 0.18,
    },
  },
  textSlots: [
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'vs', slotId: 'vs', required: false, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 14, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 14, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 26, transform: 'upper' },
  ],
};

// ── crest-clash ──────────────────────────────────────────────────────────────

const crestClash: ThumbnailTemplate = {
  id: 'crest-clash',
  name: 'Crest Clash',
  category: 'team-versus',
  description:
    'Two team crests blown up to 44% of frame height dominate the upper field while the players stand small along the bottom — the org is the story, the cast is the evidence.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 6 },
  tags: ['team-versus', 'crest', 'logo', 'org', 'institutional', 'adaptive'],
  whenToUse:
    'Org-level narratives — franchise rivalries, standings, "the state of Team X" — or any matchup where the audience knows the badge better than the roster.',
  layout: (ctx: TemplateContext): LayoutSpec => {
    const n = clamp(ctx.subjects.length || 2, 2, 6);
    const leftCount = Math.ceil(n / 2);
    const rightCount = n - leftCount;
    const left = offsetRow(
      gridSlots('cast-left', leftCount, 1, { x: 0.02, y: 0.46, w: 0.44, h: 0.54 }, 0.01),
      Z.subject,
      0,
      { side: 'left', faceHeight: 0.13, preferFacing: 'right' },
    );
    const right = offsetRow(
      gridSlots('cast-right', Math.max(1, rightCount), 1, { x: 0.54, y: 0.46, w: 0.44, h: 0.54 }, 0.01),
      Z.subject + leftCount,
      leftCount,
      { side: 'right', faceHeight: 0.13, preferFacing: 'left' },
    ).slice(0, rightCount);
    return {
      id: 'crest-clash',
      name: 'Crest Clash',
      description: 'Crests at 0.25/0.75 on the upper field, cast row beneath, VS between the badges.',
      designAspect: RATIO_16_9,
      slots: [
        plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial' } }),
        blockSlot('wash-left', { x: 0, y: 0, w: 0.5, h: 1 }, {
          z: Z.backplate + 1,
          meta: { shape: 'block', fill: 'left', opacity: 0.55 },
        }),
        blockSlot('wash-right', { x: 0.5, y: 0, w: 0.5, h: 1 }, {
          z: Z.backplate + 2,
          meta: { shape: 'block', fill: 'right', opacity: 0.55 },
        }),
        logoSlot('crest-left', { x: 0.1, y: 0.14, w: 0.3, h: 0.44 }, {
          z: Z.backplate + 3,
          meta: { glow: 0.5, fill: 'left' },
        }),
        logoSlot('crest-right', { x: 0.6, y: 0.14, w: 0.3, h: 0.44 }, {
          z: Z.backplate + 4,
          meta: { glow: 0.5, fill: 'right' },
        }),
        hazeSlot('haze', { meta: { fx: 'haze', density: 0.35 } }),
        ...left,
        ...right,
        fxSlot('floor-fog', { x: 0, y: 0.58, w: 1, h: 0.42 }, {
          z: Z.atmosphereFront,
          meta: { fx: 'fog', height: 0.26 },
        }),
        shapeSlot('vs-plate', { x: 0.435, y: 0.29, w: 0.13, h: 0.14 }, {
          z: Z.shape,
          rotation: 45,
          meta: { shape: 'diamond', fill: 'dark', stroke: 'accent' },
        }),
        shapeSlot('headline-bar', { x: 0.04, y: 0.85, w: 0.68, h: 0.12 }, {
          z: Z.shape + 1,
          meta: { shape: 'bar', fill: 'dark', opacity: 0.75, skew: 0.02 },
        }),
        textSlot('vs', { x: 0.44, y: 0.3, w: 0.12, h: 0.12 }, {
          z: Z.text,
          meta: { weight: 'black', italic: true },
        }),
        textSlot('left-team', { x: 0.06, y: 0.1, w: 0.28, h: 0.06 }, {
          z: Z.text + 1,
          anchor: 'center-left',
          meta: { weight: 'bold', tracking: 0.14 },
        }),
        textSlot('right-team', { x: 0.66, y: 0.1, w: 0.28, h: 0.06 }, {
          z: Z.text + 2,
          anchor: 'center-right',
          meta: { weight: 'bold', tracking: 0.14 },
        }),
        textSlot('headline', { x: 0.06, y: 0.865, w: 0.62, h: 0.09 }, {
          z: Z.text + 3,
          anchor: 'center-left',
          meta: { weight: 'black' },
        }),
        textSlot('kicker', { x: 0.36, y: 0.045, w: 0.28, h: 0.065 }, {
          z: Z.text + 4,
          meta: { weight: 'semibold', tracking: 0.22 },
        }),
      ],
      safeZones: ytSafeZones(),
      focalPoints: [
        { x: 0.25, y: 0.36 },
        { x: 0.75, y: 0.36 },
        { x: 0.5, y: 0.36 },
        { x: 0.5, y: 0.644 },
      ],
      guides: [thirdsGuide()],
    };
  },
  style: {
    lightRig: 'under-glow',
    backdrop: 'radial',
    brandStrength: 1,
    atmosphere: {
      haze: 0.35,
      fog: 0.26,
      particles: { kind: 'dust', density: 0.35, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 270, width: 3, color: '#FFFFFF', intensity: 0.7 },
      shadow: { dx: 0, dy: 8, blur: 30, color: '#000000', opacity: 0.6 },
      contrast: 1.08,
      saturation: 0.98,
    },
    grade: {
      exposure: -0.04,
      contrast: 1.16,
      saturation: 1.08,
      temperature: -2,
      shadowTint: '#0B1220',
      highlightTint: '#E8F4FF',
      splitToneBalance: 0.55,
      lut: 'cold-steel',
      lutStrength: 0.45,
      grain: 0.09,
      bloomThreshold: 0.7,
      bloomIntensity: 0.4,
      vignette: 0.46,
      halation: 0.2,
    },
  },
  textSlots: [
    { role: 'left-team', slotId: 'left-team', required: true, maxChars: 18, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: true, maxChars: 18, transform: 'upper' },
    { role: 'vs', slotId: 'vs', required: false, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'headline', slotId: 'headline', required: false, maxChars: 32, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
  ],
};

export const teamVersusTemplates: ThumbnailTemplate[] = [lineup5v5, lineupHeroFlank, crestClash];
