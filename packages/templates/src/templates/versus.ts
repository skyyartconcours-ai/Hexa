/**
 * VERSUS — the signature genre.
 *
 * Composition rules this family is built on, distilled from broadcast key art
 * and fight-poster convention:
 *
 *  • Two busts, both facing the centre line. Facing *out* reads as two separate
 *    portraits pasted together; facing *in* reads as a confrontation.
 *  • Faces land near the thirds (x ≈ 0.30 / 0.70) with the eyeline on the upper
 *    third (y ≈ 0.32). At 210×118 px — the size a phone actually shows — a face
 *    below ~14% of canvas height turns to mush, and above ~30% the frame loses
 *    the second subject.
 *  • The centre column belongs to the mark, not to the cast: the VS glyph owns
 *    x 0.42–0.58 so neither cutout has to be cropped to make room.
 *  • Colour blocking carries the opposition. Two complementary halves split by a
 *    diagonal beat a symmetric vertical split for energy, which is why the
 *    classic leans its seam 14% of the width.
 *  • Copy lives in the outer lower band, above y 0.84 on the right so the
 *    duration pill never eats a nameplate.
 */

import type { Rect, StyleSpec, TemplateContext, ThumbnailTemplate } from '@hexa/core';
import { mix, saturate, shade } from '@hexa/core';
import {
  RATIO_16_9,
  WIDE_ASPECTS,
  WIDE_AND_SQUARE,
  Z,
  badgeSlot,
  blockSlot,
  diagonalGuide,
  fxSlot,
  goldenGuide,
  hazeSlot,
  inwardBust,
  mirrorX,
  plateSlot,
  reserve,
  shapeSlot,
  textSlot,
  thirdsGuide,
  ytSafeZones,
} from '../helpers.js';

// ── versus-classic ───────────────────────────────────────────────────────────

/**
 * How far the seam leans off vertical, as a fraction of frame width.
 *
 * A dead-vertical split reads as two portraits filed side by side. The lean is
 * what turns the same two busts into an opposition, and it has to be shared by
 * the colour blocks, the seam glow and the diagonal guide or the frame ends up
 * with three divisions at slightly different angles.
 */
const LEAN = 0.18;

const versusClassic: ThumbnailTemplate = {
  id: 'versus-classic',
  name: 'Versus Classic',
  category: 'versus',
  description:
    'Two busts facing inward across a leaning diagonal colour split, a huge VS diamond holding the centre, and skewed nameplate bars in the lower band.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['versus', 'signature', 'diagonal', 'nameplate', 'high-energy', 'broadcast', 'teal-orange'],
  whenToUse:
    'The default for any 1v1 matchup video. Reach for it when both players are equally the story and you want the thumbnail to read as a fixture card.',
  layout: {
    id: 'versus-classic',
    name: 'Versus Classic',
    description: 'Diagonal halves, inward busts on the thirds, VS diamond centre, nameplate bars bottom.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', vignette: 0.4 } }),
      blockSlot('block-left', { x: 0, y: 0, w: 0.7, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'diagonal-half', side: 'left', lean: LEAN, fill: 'left' },
      }),
      blockSlot('block-right', { x: 0.3, y: 0, w: 0.7, h: 1 }, {
        z: Z.backplate + 2,
        meta: { shape: 'diagonal-half', side: 'right', lean: LEAN, fill: 'right' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.35 } }),
      fxSlot('floor-fog', { x: 0, y: 0.62, w: 1, h: 0.38 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'fog', height: 0.2 },
      }),
      // The near subject: larger, lower, and the one the eye is meant to land
      // on first. Two identically-sized busts at the same height read as a
      // fixture list; one clearly in front reads as a confrontation.
      inwardBust('subject-left', { x: 0.015, y: 0.1, w: 0.435, h: 0.9 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.55, y: 0.3 },
        constraints: { faceKeepIn: { x: 0.1, y: 0.16, w: 0.3, h: 0.32 } },
        meta: { preferFacing: 'right', faceHeight: 0.26, rimAngle: 200, side: 'left', depth: 'front' },
      }),
      // The far subject: ~9% smaller and set 5% of frame height higher, so it
      // sits behind rather than beside. `depth: 'back'` also costs it a little
      // exposure and saturation — atmospheric perspective, applied by the
      // compiler rather than baked into the photograph.
      inwardBust('subject-right', { x: 0.545, y: 0.175, w: 0.4, h: 0.825 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        focal: { x: 0.45, y: 0.3 },
        constraints: { faceKeepIn: { x: 0.6, y: 0.22, w: 0.28, h: 0.3 } },
        meta: { preferFacing: 'left', faceHeight: 0.24, rimAngle: 340, side: 'right', depth: 'back' },
      }),
      fxSlot('seam-glow', { x: 0.42, y: -0.08, w: 0.16, h: 1.16 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'glow-seam', lean: LEAN },
      }),
      fxSlot('sparks', { x: 0.28, y: -0.05, w: 0.44, h: 1.1 }, {
        z: Z.atmosphereFront + 1,
        meta: { fx: 'particles', particles: 'spark', bias: 'center' },
      }),
      // No plate behind the VS. The mark @hexa/type draws is already a finished
      // badge carrying both team colours, and its artwork runs up to 2× the
      // nominal size it is asked for — so any diamond sized to sit behind it
      // ends up with the mark's corners hanging over the edge, reading as two
      // shapes colliding rather than one device. The centre column is kept dark
      // by the colour blocks instead, which is what the mark actually needs.
      // A broadcast lower-third rather than a slab of brand colour: a dark bar
      // for the name to sit on, with a team-coloured rule along its top edge.
      // The solid-colour version put the plate at the same value as the subject
      // beside it, so the two fought; this way the white name is the brightest
      // thing in the lower band and the colour still says whose name it is.
      // The nameplate band is sized from the sidebar, not from the full frame.
      // A name needs ~7px of cap height at 168×94 to keep its strokes, which
      // works back to ~54px on a 1280-wide canvas — so the band is deeper than
      // it looks like it needs to be at 100%, and the plate is wider than the
      // type so the glyphs always have a clean dark field around them instead
      // of sitting half on the subject's shoulder.
      shapeSlot('plate-left', { x: 0.045, y: 0.685, w: 0.35, h: 0.145 }, {
        z: Z.shape + 1,
        opacity: 0.88,
        meta: { shape: 'bar', fill: 'dark', skew: 0.03 },
      }),
      shapeSlot('plate-right', { x: 0.605, y: 0.685, w: 0.35, h: 0.145 }, {
        z: Z.shape + 2,
        opacity: 0.88,
        meta: { shape: 'bar', fill: 'dark', skew: -0.03 },
      }),
      shapeSlot('plate-rule-left', { x: 0.045, y: 0.677, w: 0.35, h: 0.009 }, {
        z: Z.shape + 3,
        meta: { shape: 'rule', fill: 'left' },
      }),
      shapeSlot('plate-rule-right', { x: 0.605, y: 0.677, w: 0.35, h: 0.009 }, {
        z: Z.shape + 4,
        meta: { shape: 'rule', fill: 'right' },
      }),
      textSlot('vs', { x: 0.435, y: 0.32, w: 0.13, h: 0.18 }, {
        z: Z.text,
        meta: { weight: 'black', italic: true, stroke: 0.02 },
      }),
      textSlot('left-name', { x: 0.055, y: 0.695, w: 0.33, h: 0.125 }, {
        z: Z.text + 1,
        meta: { weight: 'black', tracking: -0.01 },
      }),
      textSlot('right-name', { x: 0.615, y: 0.695, w: 0.33, h: 0.125 }, {
        z: Z.text + 2,
        meta: { weight: 'black', tracking: -0.01 },
      }),
      textSlot('left-team', { x: 0.055, y: 0.6, w: 0.2, h: 0.062 }, {
        z: Z.text + 3,
        meta: { weight: 'medium', tracking: 0.12 },
      }),
      textSlot('right-team', { x: 0.745, y: 0.6, w: 0.2, h: 0.062 }, {
        z: Z.text + 4,
        meta: { weight: 'medium', tracking: 0.12 },
      }),
      textSlot('kicker', { x: 0.3, y: 0.05, w: 0.4, h: 0.085 }, {
        z: Z.text + 5,
        meta: { weight: 'semibold', tracking: 0.22 },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.05, w: 0.18, h: 0.07 }, {
        z: Z.badge,
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('vs-column', { x: 0.42, y: 0.22, w: 0.16, h: 0.36 }, 'The VS mark owns the centre column — keep cutouts out of it.'),
    ]),
    // Deliberately not mirrored: the near face outranks the far one, and the
    // list is read in order by the composition gates.
    focalPoints: [
      { x: 0.233, y: 0.37 },
      { x: 0.745, y: 0.423 },
      { x: 0.5, y: 0.41 },
      { x: 0.22, y: 0.757 },
    ],
    guides: [thirdsGuide(), diagonalGuide(LEAN)],
  },
  style: {
    lightRig: 'split-rim',
    backdrop: 'gradient',
    brandStrength: 0.85,
    atmosphere: {
      haze: 0.35,
      fog: 0.18,
      particles: { kind: 'spark', density: 0.35, bias: 'center' },
    },
    subjectEffects: {
      rimLight: { angle: 200, width: 3, color: '#8FE8FF', intensity: 0.8 },
      shadow: { dx: 0, dy: 6, blur: 28, color: '#000000', opacity: 0.55 },
      contrast: 1.06,
      saturation: 1.04,
    },
    grade: {
      exposure: 0.05,
      contrast: 1.14,
      saturation: 1.1,
      temperature: 6,
      shadowTint: '#0B2A3C',
      highlightTint: '#FFB067',
      splitToneBalance: 0.45,
      lut: 'teal-orange',
      lutStrength: 0.55,
      grain: 0.08,
      bloomThreshold: 0.72,
      bloomIntensity: 0.35,
      vignette: 0.36,
      chromaticAberration: 1.2,
      halation: 0.2,
    },
  },
  textSlots: [
    { role: 'vs', slotId: 'vs', required: true, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 12, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 12, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 30, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 12, transform: 'upper' },
  ],
};

// ── versus-diagonal-shatter ──────────────────────────────────────────────────

const versusDiagonalShatter: ThumbnailTemplate = {
  id: 'versus-diagonal-shatter',
  name: 'Versus Diagonal Shatter',
  category: 'versus',
  description:
    'A steep corner-to-corner tear with shattered glass along the seam; the left subject rides high, the right sits low, and the copy counterweights on the opposite diagonal.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['versus', 'diagonal', 'shatter', 'glass', 'aggressive', 'high-energy', 'asymmetric'],
  whenToUse:
    'Grudge matches and elimination games. The broken symmetry says "this is not a routine fixture" better than any headline can.',
  layout: {
    id: 'versus-diagonal-shatter',
    name: 'Versus Diagonal Shatter',
    description: 'Steep 0.42 lean, staggered faces, shard field along the tear, type on the counter-diagonal.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'abstract' } }),
      blockSlot('block-left', { x: 0, y: 0, w: 0.75, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'diagonal-half', side: 'left', lean: 0.42, fill: 'left' },
      }),
      blockSlot('block-right', { x: 0.25, y: 0, w: 0.75, h: 1 }, {
        z: Z.backplate + 2,
        meta: { shape: 'diagonal-half', side: 'right', lean: 0.42, fill: 'right' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.28 } }),
      inwardBust('subject-left', { x: -0.06, y: 0, w: 0.56, h: 0.92 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-left',
        rotation: -2,
        focal: { x: 0.62, y: 0.34 },
        meta: { preferFacing: 'right', faceHeight: 0.24, rimAngle: 215, side: 'left' },
      }),
      inwardBust('subject-right', { x: 0.46, y: 0.1, w: 0.6, h: 1 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        rotation: 2,
        focal: { x: 0.42, y: 0.3 },
        meta: { preferFacing: 'left', faceHeight: 0.24, rimAngle: 325, side: 'right' },
      }),
      fxSlot('shatter', { x: 0.2, y: -0.06, w: 0.6, h: 1.12 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'shatter', lean: 0.42, shardScale: 0.09 },
      }),
      fxSlot('shards', { x: 0.1, y: -0.05, w: 0.8, h: 1.1 }, {
        z: Z.atmosphereFront + 1,
        meta: { fx: 'particles', particles: 'shard', bias: 'center', density: 0.5 },
      }),
      shapeSlot('slash', { x: 0.24, y: 0, w: 0.52, h: 1 }, {
        z: Z.shape,
        meta: { shape: 'slash-rule', lean: 0.42, fill: 'accent', width: 0.006 },
      }),
      shapeSlot('name-rule-top', { x: 0.045, y: 0.168, w: 0.3, h: 0.006 }, {
        z: Z.shape + 1,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      shapeSlot('name-rule-bottom', { x: 0.44, y: 0.848, w: 0.3, h: 0.006 }, {
        z: Z.shape + 2,
        meta: { shape: 'rule', fill: 'accent' },
      }),
      textSlot('vs', { x: 0.425, y: 0.475, w: 0.15, h: 0.17 }, {
        z: Z.text,
        rotation: -14,
        meta: { weight: 'black', italic: true, stroke: 0.018 },
      }),
      textSlot('left-name', { x: 0.045, y: 0.075, w: 0.34, h: 0.09 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('left-team', { x: 0.045, y: 0.18, w: 0.24, h: 0.055 }, {
        z: Z.text + 2,
        anchor: 'center-left',
        meta: { weight: 'medium', tracking: 0.14 },
      }),
      textSlot('right-team', { x: 0.44, y: 0.785, w: 0.24, h: 0.055 }, {
        z: Z.text + 3,
        anchor: 'center-right',
        meta: { weight: 'medium', tracking: 0.14 },
      }),
      textSlot('right-name', { x: 0.44, y: 0.858, w: 0.34, h: 0.09 }, {
        z: Z.text + 4,
        anchor: 'center-right',
        meta: { weight: 'black' },
      }),
      textSlot('kicker', { x: 0.045, y: 0.858, w: 0.3, h: 0.08 }, {
        z: Z.text + 5,
        anchor: 'center-left',
        meta: { weight: 'semibold', tracking: 0.2 },
      }),
      badgeSlot('badge', { x: 0.72, y: 0.045, w: 0.235, h: 0.075 }, {
        z: Z.badge,
        meta: { shape: 'tag', fill: 'accent', skew: 0.06 },
      }),
    ],
    safeZones: ytSafeZones(),
    focalPoints: [
      { x: 0.287, y: 0.313 },
      { x: 0.712, y: 0.4 },
      { x: 0.5, y: 0.56 },
      { x: 0.215, y: 0.12 },
    ],
    guides: [thirdsGuide(), diagonalGuide(0.42)],
  },
  style: {
    lightRig: 'stage',
    backdrop: 'shatter',
    brandStrength: 0.7,
    atmosphere: {
      haze: 0.28,
      particles: { kind: 'shard', density: 0.5, bias: 'center' },
      rays: { angle: 68, count: 5, intensity: 0.35, color: '#DDEBFF' },
    },
    subjectEffects: {
      rimLight: { angle: 215, width: 4, color: '#FFFFFF', intensity: 0.9 },
      stroke: { width: 2, color: '#0B0C12' },
      contrast: 1.12,
      saturation: 0.94,
    },
    grade: {
      exposure: -0.05,
      contrast: 1.28,
      saturation: 0.92,
      temperature: -6,
      shadowTint: '#141A24',
      highlightTint: '#E8F1FF',
      splitToneBalance: 0.55,
      lut: 'bleach-bypass',
      lutStrength: 0.6,
      grain: 0.14,
      bloomThreshold: 0.78,
      bloomIntensity: 0.28,
      vignette: 0.42,
      chromaticAberration: 2,
      halation: 0.12,
    },
  },
  textSlots: [
    { role: 'vs', slotId: 'vs', required: true, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 12, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 12, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 14, transform: 'upper' },
  ],
};

// ── versus-clash ─────────────────────────────────────────────────────────────

const versusClash: ThumbnailTemplate = {
  id: 'versus-clash',
  name: 'Versus Clash',
  category: 'versus',
  description:
    'Both subjects pushed inward until their shoulders overlap at the centre line, with an energy burst blooming from the collision point and the VS tucked into the notch beneath it.',
  aspects: WIDE_AND_SQUARE,
  subjects: { min: 2, max: 2 },
  tags: ['versus', 'overlap', 'burst', 'impact', 'high-energy', 'centred', 'crimson'],
  whenToUse:
    'Rivalry hype and finals. The overlap removes the seam entirely, so it reads as one violent event rather than two portraits.',
  layout: {
    id: 'versus-clash',
    name: 'Versus Clash',
    description: 'Overlapping busts on the golden verticals, radial burst at the impact point, VS in the notch.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'radial', center: [0.5, 0.38] } }),
      fxSlot('speed-lines', { x: 0, y: 0, w: 1, h: 1 }, {
        z: Z.atmosphereBack,
        meta: { fx: 'speed-lines', angle: 0, density: 0.55 },
      }),
      fxSlot('back-glow', { x: 0.18, y: 0.02, w: 0.64, h: 0.76 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'radial-glow', fill: 'accent' },
      }),
      // The aggressor: further forward, so the collision has a direction.
      inwardBust('subject-left', { x: -0.08, y: 0.05, w: 0.58, h: 0.95 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-left',
        focal: { x: 0.7, y: 0.31 },
        constraints: { faceKeepIn: { x: 0.16, y: 0.18, w: 0.34, h: 0.32 } },
        meta: { preferFacing: 'right', faceHeight: 0.28, rimAngle: 190, side: 'left', depth: 'front' },
      }),
      inwardBust('subject-right', { x: 0.52, y: 0.11, w: 0.53, h: 0.89 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        focal: { x: 0.3, y: 0.31 },
        constraints: { faceKeepIn: { x: 0.52, y: 0.22, w: 0.32, h: 0.3 } },
        meta: { preferFacing: 'left', faceHeight: 0.26, rimAngle: 350, side: 'right', depth: 'back' },
      }),
      fxSlot('impact-burst', { x: 0.16, y: 0.02, w: 0.68, h: 0.72 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'burst', rays: 24, blend: 'add' },
      }),
      fxSlot('impact-ring', { x: 0.29, y: 0.16, w: 0.42, h: 0.42 }, {
        z: Z.atmosphereFront + 1,
        meta: { fx: 'shock-ring', blend: 'screen' },
      }),
      fxSlot('embers', { x: 0.1, y: -0.05, w: 0.8, h: 1.1 }, {
        z: Z.atmosphereFront + 2,
        meta: { fx: 'particles', particles: 'ember', bias: 'center', density: 0.6 },
      }),
      shapeSlot('vs-plate', { x: 0.42, y: 0.53, w: 0.16, h: 0.155 }, {
        z: Z.shape,
        rotation: 45,
        meta: { shape: 'diamond', fill: 'dark', stroke: 'accent' },
      }),
      textSlot('vs', { x: 0.435, y: 0.545, w: 0.13, h: 0.125 }, {
        z: Z.text,
        meta: { weight: 'black', italic: true },
      }),
      textSlot('left-name', { x: 0.045, y: 0.8, w: 0.3, h: 0.105 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('right-name', { x: 0.475, y: 0.8, w: 0.3, h: 0.105 }, {
        z: Z.text + 2,
        anchor: 'center-right',
        meta: { weight: 'black' },
      }),
      textSlot('kicker', { x: 0.33, y: 0.045, w: 0.34, h: 0.075 }, {
        z: Z.text + 3,
        meta: { weight: 'semibold', tracking: 0.2 },
      }),
      badgeSlot('badge', { x: 0.045, y: 0.05, w: 0.19, h: 0.07 }, {
        z: Z.badge,
        anchor: 'center-left',
        meta: { shape: 'pill', fill: 'accent' },
      }),
    ],
    safeZones: ytSafeZones(),
    focalPoints: [
      { x: 0.334, y: 0.338 },
      { x: 0.666, y: 0.338 },
      { x: 0.5, y: 0.38 },
      { x: 0.5, y: 0.607 },
    ],
    guides: [goldenGuide()],
  },
  style: {
    lightRig: 'backlit',
    backdrop: 'radial',
    brandStrength: 0.75,
    atmosphere: {
      haze: 0.45,
      particles: { kind: 'ember', density: 0.6, bias: 'center' },
      speedLines: { angle: 0, density: 0.55, color: '#FFD9A8' },
    },
    subjectEffects: {
      rimLight: { angle: 190, width: 5, color: '#FFCF7A', intensity: 1 },
      glow: { radius: 26, color: '#FF5A3C', intensity: 0.5 },
      contrast: 1.1,
      saturation: 1.08,
    },
    grade: {
      exposure: 0.1,
      contrast: 1.22,
      saturation: 1.18,
      temperature: 12,
      shadowTint: '#2A0B14',
      highlightTint: '#FFD08A',
      splitToneBalance: 0.4,
      lut: 'crimson-contrast',
      lutStrength: 0.5,
      grain: 0.09,
      bloomThreshold: 0.62,
      bloomIntensity: 0.55,
      vignette: 0.44,
      chromaticAberration: 2.4,
      halation: 0.35,
    },
  },
  textSlots: [
    { role: 'vs', slotId: 'vs', required: true, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 26, transform: 'upper' },
    { role: 'badge', slotId: 'badge', required: false, maxChars: 12, transform: 'upper' },
  ],
};

// ── versus-split-portrait ────────────────────────────────────────────────────

/** Centred under the left face at x 0.30; the right pair is its mirror. */
const TEAM_TAG_LEFT: Rect = { x: 0.13, y: 0.685, w: 0.34, h: 0.05 };
const NAMEPLATE_LEFT: Rect = { x: 0.13, y: 0.745, w: 0.34, h: 0.09 };

const versusSplitPortrait: ThumbnailTemplate = {
  id: 'versus-split-portrait',
  name: 'Versus Split Portrait',
  category: 'versus',
  description:
    'A hard vertical split down the exact centre with two tightly cropped, half-lit portraits — one key from the left, one from the right — and a small VS badge set into the divider.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['versus', 'portrait', 'split', 'moody', 'noir', 'premium', 'tight-crop'],
  whenToUse:
    'Character pieces: interviews, head-to-head profiles, "who is the better player" essays. The tight crop sells personality over spectacle.',
  layout: {
    id: 'versus-split-portrait',
    name: 'Versus Split Portrait',
    description: 'Exact 50/50 vertical division, tight half-lit busts, hairline divider, VS badge at the midpoint.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'solid' } }),
      blockSlot('block-left', { x: 0, y: 0, w: 0.5, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'block', fill: 'left', falloff: 0.55 },
      }),
      blockSlot('block-right', { x: 0.5, y: 0, w: 0.5, h: 1 }, {
        z: Z.backplate + 2,
        meta: { shape: 'block', fill: 'right', falloff: 0.55 },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.2 } }),
      inwardBust('subject-left', { x: 0, y: 0.02, w: 0.5, h: 0.98 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-center',
        fit: 'face-anchor',
        focal: { x: 0.6, y: 0.31 },
        constraints: { faceKeepIn: { x: 0.14, y: 0.14, w: 0.32, h: 0.36 }, clampToCanvas: true },
        meta: { preferFacing: 'right', faceHeight: 0.3, keyFrom: 'left', shadowSide: 'right' },
      }),
      inwardBust('subject-right', { x: 0.5, y: 0.02, w: 0.5, h: 0.98 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-center',
        fit: 'face-anchor',
        focal: { x: 0.4, y: 0.31 },
        constraints: { faceKeepIn: { x: 0.54, y: 0.14, w: 0.32, h: 0.36 }, clampToCanvas: true },
        meta: { preferFacing: 'left', faceHeight: 0.3, keyFrom: 'right', shadowSide: 'left' },
      }),
      shapeSlot('divider', { x: 0.4965, y: 0, w: 0.007, h: 1 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'light', glow: 0.4 },
      }),
      shapeSlot('vs-badge', { x: 0.4425, y: 0.425, w: 0.115, h: 0.12 }, {
        z: Z.shape + 1,
        meta: { shape: 'square', fill: 'dark', stroke: 'light' },
      }),
      textSlot('vs', { x: 0.4475, y: 0.43, w: 0.105, h: 0.11 }, {
        z: Z.text,
        meta: { weight: 'bold', tracking: 0.02 },
      }),
      // Both pairs are exact mirrors — mirrorX keeps them that way if either moves.
      textSlot('left-team', TEAM_TAG_LEFT, {
        z: Z.text + 1,
        meta: { weight: 'medium', tracking: 0.24 },
      }),
      textSlot('right-team', mirrorX(TEAM_TAG_LEFT), {
        z: Z.text + 2,
        meta: { weight: 'medium', tracking: 0.24 },
      }),
      textSlot('left-name', NAMEPLATE_LEFT, {
        z: Z.text + 3,
        meta: { weight: 'black', tracking: 0.01 },
      }),
      textSlot('right-name', mirrorX(NAMEPLATE_LEFT), {
        z: Z.text + 4,
        meta: { weight: 'black', tracking: 0.01 },
      }),
      textSlot('kicker', { x: 0.35, y: 0.05, w: 0.3, h: 0.065 }, {
        z: Z.text + 5,
        meta: { weight: 'medium', tracking: 0.28 },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('divider-column', { x: 0.47, y: 0, w: 0.06, h: 1 }, 'The divider must stay a clean unbroken line — no cutout may cross it (the VS badge is the one sanctioned exception).'),
    ]),
    focalPoints: [
      { x: 0.3, y: 0.324 },
      { x: 0.7, y: 0.324 },
      { x: 0.5, y: 0.485 },
      { x: 0.3, y: 0.79 },
    ],
    guides: [thirdsGuide()],
  },
  style: {
    lightRig: 'top-key',
    backdrop: 'solid',
    brandStrength: 0.45,
    atmosphere: { haze: 0.2, fog: 0.08 },
    subjectEffects: {
      rimLight: { angle: 180, width: 2, color: '#C9D8FF', intensity: 0.55 },
      shadow: { dx: 0, dy: 10, blur: 40, color: '#000000', opacity: 0.65 },
      contrast: 1.18,
      saturation: 0.82,
    },
    grade: {
      exposure: -0.12,
      contrast: 1.2,
      saturation: 0.78,
      temperature: -8,
      lift: [0.01, 0.012, 0.02],
      shadowTint: '#101828',
      highlightTint: '#F0E6DA',
      splitToneBalance: 0.6,
      lut: 'neo-noir',
      lutStrength: 0.7,
      grain: 0.16,
      bloomThreshold: 0.85,
      bloomIntensity: 0.18,
      vignette: 0.52,
      chromaticAberration: 0.6,
      halation: 0.1,
    },
  },
  textSlots: [
    { role: 'vs', slotId: 'vs', required: true, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 14, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 16, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 16, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 24, transform: 'upper' },
  ],
};

// ── versus-minimal ───────────────────────────────────────────────────────────

const versusMinimal: ThumbnailTemplate = {
  id: 'versus-minimal',
  name: 'Versus Minimal',
  category: 'versus',
  description:
    'Editorial restraint: two small busts low in the frame, an empty upper half, a hairline centre rule and letter-spaced micro-type in the corners.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['versus', 'minimal', 'negative-space', 'premium', 'editorial', 'clean', 'quiet'],
  whenToUse:
    'When the channel already has authority and you want the thumbnail to look like a magazine cover rather than a fight card. Also the safest choice when both photographs are weak.',
  layout: {
    id: 'versus-minimal',
    name: 'Versus Minimal',
    description: 'Busts sunk to the lower half, 45% of the frame deliberately empty, hairline rule, micro-type.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'solid', falloff: 0.8 } }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.1 } }),
      inwardBust('subject-left', { x: 0.1, y: 0.26, w: 0.4, h: 0.74 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-center',
        focal: { x: 0.5, y: 0.19 },
        constraints: { faceKeepIn: { x: 0.2, y: 0.32, w: 0.22, h: 0.18 } },
        meta: { preferFacing: 'right', faceHeight: 0.16, side: 'left' },
      }),
      inwardBust('subject-right', { x: 0.5, y: 0.26, w: 0.4, h: 0.74 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-center',
        focal: { x: 0.5, y: 0.19 },
        constraints: { faceKeepIn: { x: 0.58, y: 0.32, w: 0.22, h: 0.18 } },
        meta: { preferFacing: 'left', faceHeight: 0.16, side: 'right' },
      }),
      shapeSlot('hairline', { x: 0.4985, y: 0.3, w: 0.003, h: 0.44 }, {
        z: Z.shape,
        meta: { shape: 'rule', fill: 'light', opacity: 0.5 },
      }),
      shapeSlot('rule-left', { x: 0.08, y: 0.148, w: 0.28, h: 0.002 }, {
        z: Z.shape + 1,
        meta: { shape: 'rule', fill: 'light', opacity: 0.35 },
      }),
      shapeSlot('rule-right', { x: 0.64, y: 0.148, w: 0.28, h: 0.002 }, {
        z: Z.shape + 2,
        meta: { shape: 'rule', fill: 'light', opacity: 0.35 },
      }),
      textSlot('left-name', { x: 0.08, y: 0.085, w: 0.28, h: 0.05 }, {
        z: Z.text,
        anchor: 'center-left',
        meta: { weight: 'medium', tracking: 0.3 },
      }),
      textSlot('right-name', { x: 0.64, y: 0.085, w: 0.28, h: 0.05 }, {
        z: Z.text + 1,
        anchor: 'center-right',
        meta: { weight: 'medium', tracking: 0.3 },
      }),
      textSlot('date', { x: 0.42, y: 0.085, w: 0.16, h: 0.05 }, {
        z: Z.text + 2,
        meta: { weight: 'regular', tracking: 0.24 },
      }),
      textSlot('vs', { x: 0.465, y: 0.395, w: 0.07, h: 0.06 }, {
        z: Z.text + 3,
        meta: { weight: 'light', tracking: 0.1 },
      }),
      textSlot('kicker', { x: 0.4, y: 0.885, w: 0.2, h: 0.045 }, {
        z: Z.text + 4,
        meta: { weight: 'regular', tracking: 0.32 },
      }),
    ],
    safeZones: ytSafeZones([
      reserve('upper-void', { x: 0.14, y: 0.16, w: 0.72, h: 0.2 }, 'The empty upper band is the whole point — nothing may be added here.', 'hard'),
    ]),
    focalPoints: [
      { x: 0.3, y: 0.401 },
      { x: 0.7, y: 0.401 },
      { x: 0.5, y: 0.425 },
      { x: 0.22, y: 0.11 },
    ],
    guides: [goldenGuide()],
  },
  style: {
    lightRig: 'clean',
    backdrop: 'solid',
    brandStrength: 0.25,
    atmosphere: { haze: 0.1 },
    subjectEffects: {
      shadow: { dx: 0, dy: 4, blur: 22, color: '#000000', opacity: 0.4 },
      contrast: 1.04,
      saturation: 0.72,
    },
    grade: {
      exposure: -0.08,
      contrast: 1.06,
      saturation: 0.65,
      temperature: -10,
      shadowTint: '#0E141C',
      highlightTint: '#DDE6F0',
      splitToneBalance: 0.5,
      lut: 'cold-steel',
      lutStrength: 0.45,
      grain: 0.12,
      bloomThreshold: 0.9,
      bloomIntensity: 0.1,
      vignette: 0.5,
      letterbox: 0.055,
    },
  },
  textSlots: [
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'vs', slotId: 'vs', required: false, defaultText: 'vs', maxChars: 3, transform: 'lower' },
    { role: 'date', slotId: 'date', required: false, maxChars: 12, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 22, transform: 'upper' },
  ],
};

// ── versus-fire-ice ──────────────────────────────────────────────────────────

/**
 * The only template whose style is a function of context: the whole idea is a
 * temperature opposition, so the two halves are pulled toward ember and glacier
 * anchors rather than obeying the team palette straight.
 */
function fireIceStyle(ctx: TemplateContext): StyleSpec {
  const fire = saturate(mix(ctx.palette.left, '#FF6A1A', 0.55), 1.12);
  const ice = saturate(mix(ctx.palette.right, '#4FD8FF', 0.55), 1.08);
  return {
    lightRig: 'ember',
    backdrop: 'abstract',
    brandStrength: 0.5,
    atmosphere: {
      haze: 0.4,
      fog: 0.22,
      particles: { kind: 'ember', density: 0.55, color: fire, bias: 'left' },
      rays: { angle: 115, count: 4, intensity: 0.3, color: ice },
    },
    subjectEffects: {
      rimLight: { angle: 200, width: 4, color: fire, intensity: 0.95 },
      glow: { radius: 22, color: ice, intensity: 0.45 },
      contrast: 1.12,
      saturation: 1.1,
    },
    grade: {
      exposure: 0.04,
      contrast: 1.2,
      saturation: 1.16,
      temperature: 4,
      shadowTint: shade(ice, -0.28),
      highlightTint: shade(fire, 0.16),
      splitToneBalance: 0.5,
      lut: 'ember',
      lutStrength: 0.5,
      grain: 0.1,
      bloomThreshold: 0.66,
      bloomIntensity: 0.48,
      vignette: 0.4,
      chromaticAberration: 1.8,
      halation: 0.3,
    },
  };
}

const versusFireIce: ThumbnailTemplate = {
  id: 'versus-fire-ice',
  name: 'Versus Fire & Ice',
  category: 'versus',
  description:
    'Opposing temperature grade across a wave-edged seam: embers and heat haze on the left, frost and cold rim light on the right, with a split molten/frozen VS mark.',
  aspects: WIDE_ASPECTS,
  subjects: { min: 2, max: 2 },
  tags: ['versus', 'fire', 'ice', 'temperature', 'elemental', 'contrast', 'stylised'],
  whenToUse:
    'Style-clash narratives — aggression against control, carry against tank. The temperature split does the storytelling so the headline can stay short.',
  layout: {
    id: 'versus-fire-ice',
    name: 'Versus Fire & Ice',
    description: 'Wave seam, counter-rotated busts, ember field left, frost field right, centred name row.',
    designAspect: RATIO_16_9,
    slots: [
      plateSlot('backplate', { meta: { fill: 'dark', treatment: 'gradient', angle: 12 } }),
      blockSlot('block-fire', { x: 0, y: 0, w: 0.58, h: 1 }, {
        z: Z.backplate + 1,
        meta: { shape: 'wave-half', side: 'left', amplitude: 0.06, fill: 'left', temperature: 'hot' },
      }),
      blockSlot('block-ice', { x: 0.42, y: 0, w: 0.58, h: 1 }, {
        z: Z.backplate + 2,
        meta: { shape: 'wave-half', side: 'right', amplitude: 0.06, fill: 'right', temperature: 'cold' },
      }),
      hazeSlot('haze', { meta: { fx: 'haze', density: 0.4 } }),
      fxSlot('heat-haze', { x: 0, y: 0.3, w: 1, h: 0.34 }, {
        z: Z.atmosphereBack + 1,
        meta: { fx: 'heat-distortion', amount: 0.35 },
      }),
      inwardBust('subject-left', { x: -0.01, y: 0.09, w: 0.47, h: 0.91 }, 'right', {
        z: Z.subject,
        anchor: 'bottom-left',
        rotation: -3,
        focal: { x: 0.62, y: 0.29 },
        meta: { preferFacing: 'right', faceHeight: 0.26, temperature: 'hot', rimAngle: 205, depth: 'front' },
      }),
      inwardBust('subject-right', { x: 0.55, y: 0.15, w: 0.43, h: 0.85 }, 'left', {
        z: Z.subject + 1,
        anchor: 'bottom-right',
        rotation: 3,
        focal: { x: 0.38, y: 0.29 },
        meta: { preferFacing: 'left', faceHeight: 0.24, temperature: 'cold', rimAngle: 335, depth: 'back' },
      }),
      fxSlot('embers', { x: -0.05, y: -0.05, w: 0.62, h: 1.1 }, {
        z: Z.atmosphereFront,
        meta: { fx: 'particles', particles: 'ember', bias: 'left', density: 0.55 },
      }),
      fxSlot('frost', { x: 0.43, y: -0.05, w: 0.62, h: 1.1 }, {
        z: Z.atmosphereFront + 1,
        meta: { fx: 'particles', particles: 'snow', bias: 'right', density: 0.45 },
      }),
      shapeSlot('vs-mark', { x: 0.395, y: 0.255, w: 0.21, h: 0.23 }, {
        z: Z.shape,
        meta: { shape: 'split-mark', fillLeft: 'left', fillRight: 'right' },
      }),
      shapeSlot('name-bar', { x: 0.07, y: 0.765, w: 0.7, h: 0.185 }, {
        z: Z.shape + 1,
        meta: { shape: 'bar', fill: 'dark', opacity: 0.72, radius: 0.01 },
      }),
      textSlot('vs', { x: 0.41, y: 0.27, w: 0.18, h: 0.2 }, {
        z: Z.text,
        meta: { weight: 'black', italic: true, stroke: 0.016 },
      }),
      textSlot('left-team', { x: 0.1, y: 0.775, w: 0.3, h: 0.055 }, {
        z: Z.text + 1,
        anchor: 'center-left',
        meta: { weight: 'medium', tracking: 0.16 },
      }),
      textSlot('right-team', { x: 0.44, y: 0.775, w: 0.3, h: 0.055 }, {
        z: Z.text + 2,
        anchor: 'center-right',
        meta: { weight: 'medium', tracking: 0.16 },
      }),
      textSlot('left-name', { x: 0.1, y: 0.845, w: 0.3, h: 0.095 }, {
        z: Z.text + 3,
        anchor: 'center-left',
        meta: { weight: 'black' },
      }),
      textSlot('right-name', { x: 0.44, y: 0.845, w: 0.3, h: 0.095 }, {
        z: Z.text + 4,
        anchor: 'center-right',
        meta: { weight: 'black' },
      }),
      textSlot('kicker', { x: 0.33, y: 0.05, w: 0.34, h: 0.07 }, {
        z: Z.text + 5,
        meta: { weight: 'semibold', tracking: 0.2 },
      }),
    ],
    safeZones: ytSafeZones(),
    focalPoints: [
      { x: 0.299, y: 0.333 },
      { x: 0.701, y: 0.333 },
      { x: 0.5, y: 0.37 },
      { x: 0.25, y: 0.892 },
    ],
    guides: [thirdsGuide()],
  },
  style: fireIceStyle,
  textSlots: [
    { role: 'vs', slotId: 'vs', required: true, defaultText: 'VS', maxChars: 3, transform: 'upper' },
    { role: 'left-name', slotId: 'left-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'right-name', slotId: 'right-name', required: true, maxChars: 12, transform: 'upper' },
    { role: 'left-team', slotId: 'left-team', required: false, maxChars: 14, transform: 'upper' },
    { role: 'right-team', slotId: 'right-team', required: false, maxChars: 14, transform: 'upper' },
    { role: 'kicker', slotId: 'kicker', required: false, maxChars: 26, transform: 'upper' },
  ],
};

export const versusTemplates: ThumbnailTemplate[] = [
  versusClassic,
  versusDiagonalShatter,
  versusClash,
  versusSplitPortrait,
  versusMinimal,
  versusFireIce,
];
