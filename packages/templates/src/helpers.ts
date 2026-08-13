/**
 * Layout construction helpers.
 *
 * Templates are data, but hand-writing every slot literal invites drift: one
 * template puts nameplates at z 12 and another at z 400, one bleeds a bust off
 * the left edge and another clamps it. These helpers encode the house rules —
 * paint-order bands, default focal points, the platform safe zones — so a
 * template author spends their attention on composition instead of bookkeeping.
 *
 * Everything here is pure: no rendering, no I/O, no sharp.
 */

import type {
  AspectPreset,
  Rect,
  SafeZone,
  Slot,
  SlotKind,
  Vec2,
} from '@hexa/core';

// ── Canvas sizes ─────────────────────────────────────────────────────────────

export const ASPECT_SIZES: Record<AspectPreset, { width: number; height: number }> = {
  youtube: { width: 1280, height: 720 },
  'youtube-hd': { width: 1920, height: 1080 },
  shorts: { width: 1080, height: 1920 },
  twitch: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
  twitter: { width: 1600, height: 900 },
  banner: { width: 2560, height: 1440 },
};

export function aspectRatio(a: AspectPreset): number {
  const s = ASPECT_SIZES[a];
  return s.width / s.height;
}

/** Every 16:9 surface. A wide template declares this list wholesale. */
export const WIDE_ASPECTS: AspectPreset[] = ['youtube', 'youtube-hd', 'twitch', 'twitter', 'banner'];
/** Wide plus square — only for compositions that survive a centre crop. */
export const WIDE_AND_SQUARE: AspectPreset[] = [...WIDE_ASPECTS, 'square'];
export const VERTICAL_ASPECTS: AspectPreset[] = ['shorts'];

export const RATIO_16_9 = 16 / 9;
export const RATIO_9_16 = 9 / 16;

// ── Paint order ──────────────────────────────────────────────────────────────

/**
 * Paint-order bands. Each band is 100 wide so a layout can stack a dozen
 * elements inside one band and still never cross into the next.
 *
 *   backplate < atmosphere-back < subjects < atmosphere-front < shapes < text < badges
 *
 * "backplate" also covers colour blocking — a diagonal team-colour half is a
 * plate, not a shape, because subjects must stand in front of it. "shape" is
 * reserved for furniture that sits *over* the cutouts: nameplate bars, the VS
 * diamond, telestrator arrows, podium plinths.
 */
export const Z = {
  backplate: 0,
  atmosphereBack: 100,
  subject: 200,
  atmosphereFront: 300,
  shape: 400,
  text: 500,
  badge: 600,
} as const;

export const Z_BAND_WIDTH = 100;

/** Bands each slot kind is allowed to live in. Enforced by validateTemplate. */
export const KIND_BANDS: Record<SlotKind, number[]> = {
  backplate: [Z.backplate],
  fx: [Z.atmosphereBack, Z.atmosphereFront],
  subject: [Z.subject],
  shape: [Z.shape],
  text: [Z.text],
  badge: [Z.badge],
  // A crest can be a giant watermark behind the cast, furniture in the middle
  // of the stack, or a corner badge — all three are legitimate.
  logo: [Z.backplate, Z.shape, Z.badge],
};

// ── Colour grading vocabulary ────────────────────────────────────────────────

/** LUTs shipped with the engine. `validateTemplate` rejects anything else. */
export const BUILTIN_LUTS = [
  'teal-orange',
  'bleach-bypass',
  'neo-noir',
  'ember',
  'cold-steel',
  'crimson-contrast',
] as const;

export type BuiltinLut = (typeof BUILTIN_LUTS)[number];

// ── Slot factories ───────────────────────────────────────────────────────────

/** Head-and-shoulders subject. Defaults to a bust crop with natural headroom. */
export function bustSlot(id: string, rect: Rect, opts: Partial<Slot> = {}): Slot {
  return {
    id,
    kind: 'subject',
    rect,
    anchor: 'bottom-center',
    z: Z.subject,
    fit: 'bust',
    focal: { x: 0.5, y: 0.32 },
    ...opts,
  };
}

/** A block of copy. Anchor drives typographic alignment inside the rect. */
export function textSlot(id: string, rect: Rect, opts: Partial<Slot> = {}): Slot {
  return {
    id,
    kind: 'text',
    rect,
    anchor: 'center',
    z: Z.text,
    constraints: { minContrast: 4.5, clampToCanvas: true },
    ...opts,
  };
}

/** Atmosphere / energy layer. Sits in front of subjects unless z says otherwise. */
export function fxSlot(id: string, rect: Rect, opts: Partial<Slot> = {}): Slot {
  return {
    id,
    kind: 'fx',
    rect,
    anchor: 'center',
    z: Z.atmosphereFront,
    opacity: 1,
    ...opts,
  };
}

/**
 * A `cols × rows` grid of subject cells inside `area`, laid out reading order.
 * Used by every adaptive template (tier lists, lineups, rosters) so cell maths
 * lives in exactly one place.
 */
export function gridSlots(prefix: string, cols: number, rows: number, area: Rect, gap = 0.012): Slot[] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const cw = (area.w - gap * (c - 1)) / c;
  const ch = (area.h - gap * (r - 1)) / r;
  const out: Slot[] = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      const i = row * c + col;
      out.push(
        bustSlot(
          `${prefix}-${i}`,
          { x: area.x + col * (cw + gap), y: area.y + row * (ch + gap), w: cw, h: ch },
          {
            z: Z.subject + i,
            focal: { x: 0.5, y: 0.34 },
            meta: { index: i, col, row, captionFrom: 'player.handle' },
          },
        ),
      );
    }
  }
  return out;
}

// ── Internal factories (not part of the published helper API) ────────────────

/** Full-canvas background plate. */
export function plateSlot(id = 'backplate', opts: Partial<Slot> = {}): Slot {
  return {
    id,
    kind: 'backplate',
    rect: { x: 0, y: 0, w: 1, h: 1 },
    anchor: 'center',
    z: Z.backplate,
    ...opts,
  };
}

/** Colour blocking — a plate, because subjects must stand in front of it. */
export function blockSlot(id: string, rect: Rect, opts: Partial<Slot> = {}): Slot {
  return { id, kind: 'backplate', rect, anchor: 'center', z: Z.backplate + 1, ...opts };
}

/** Foreground furniture: bars, diamonds, arrows, plinths, frames. */
export function shapeSlot(id: string, rect: Rect, opts: Partial<Slot> = {}): Slot {
  return { id, kind: 'shape', rect, anchor: 'center', z: Z.shape, ...opts };
}

export function logoSlot(id: string, rect: Rect, opts: Partial<Slot> = {}): Slot {
  return { id, kind: 'logo', rect, anchor: 'center', z: Z.badge, fit: 'contain', ...opts };
}

export function badgeSlot(id: string, rect: Rect, opts: Partial<Slot> = {}): Slot {
  return { id, kind: 'badge', rect, anchor: 'center', z: Z.badge, ...opts };
}

/** Full-canvas haze — the cheapest cinematic lever there is. */
export function hazeSlot(id = 'haze', opts: Partial<Slot> = {}): Slot {
  return fxSlot(id, { x: 0, y: 0, w: 1, h: 1 }, { z: Z.atmosphereBack, meta: { fx: 'haze' }, ...opts });
}

/**
 * A subject that must face the centre. `facing` is guidance, not a command:
 * the pipeline reads `meta.preferFacing` and only sets `flipX` when the chosen
 * photograph actually looks the wrong way, so a mirrored jersey number is never
 * introduced for a subject that already faces correctly.
 */
export function inwardBust(
  id: string,
  rect: Rect,
  facing: 'left' | 'right',
  opts: Partial<Slot> = {},
): Slot {
  const meta = { preferFacing: facing, ...(opts.meta ?? {}) };
  return bustSlot(id, rect, { ...opts, meta });
}

/** Canvas-space position of a slot's face point, from its rect and focal. */
export function facePoint(slot: Slot): Vec2 {
  const f = slot.focal ?? { x: 0.5, y: 0.38 };
  return { x: slot.rect.x + f.x * slot.rect.w, y: slot.rect.y + f.y * slot.rect.h };
}

// ── Safe zones ───────────────────────────────────────────────────────────────

/**
 * YouTube furniture. The duration pill is ~120×60 px on a 1280×720 frame and
 * sits in the bottom-right with an 8 px inset; reserving the corner outright is
 * the only way a nameplate never ends up half-eaten. The watched-progress bar
 * is a thin red line along the bottom edge of the card in the home feed.
 */
export function ytSafeZones(extra: SafeZone[] = []): SafeZone[] {
  return [
    {
      id: 'duration-pill',
      rect: { x: 0.8, y: 0.84, w: 0.2, h: 0.16 },
      severity: 'hard',
      reason: 'YouTube stamps the duration badge over the bottom-right corner — no copy may live here.',
    },
    {
      id: 'progress-bar',
      rect: { x: 0, y: 0.955, w: 1, h: 0.045 },
      severity: 'soft',
      reason: 'Watched-progress bar covers the bottom edge in the home feed.',
    },
    {
      id: 'feed-crop-margin',
      rect: { x: 0, y: 0, w: 1, h: 0.055 },
      severity: 'soft',
      reason: 'Some surfaces crop to the centre 1100×620 — keep the top strip decorative.',
    },
    ...extra,
  ];
}

/** Vertical surfaces bury the bottom fifth under captions and the CTA rail. */
export function shortsSafeZones(extra: SafeZone[] = []): SafeZone[] {
  return [
    {
      id: 'shorts-caption',
      rect: { x: 0, y: 0.8, w: 0.86, h: 0.2 },
      severity: 'hard',
      reason: 'Title, handle and CTA sit over the bottom fifth of a Short.',
    },
    {
      id: 'shorts-action-rail',
      rect: { x: 0.84, y: 0.4, w: 0.16, h: 0.4 },
      severity: 'hard',
      reason: 'Like / comment / share / remix rail runs down the right edge.',
    },
    {
      id: 'shorts-status',
      rect: { x: 0, y: 0, w: 1, h: 0.075 },
      severity: 'soft',
      reason: 'Device status bar and Shorts header overlay the top strip.',
    },
    ...extra,
  ];
}

/** A designer-declared keep-clear region, e.g. "this column is for type". */
export function reserve(id: string, rect: Rect, reason: string, severity: 'hard' | 'soft' = 'soft'): SafeZone {
  return { id, rect, severity, reason };
}

// ── Guides ───────────────────────────────────────────────────────────────────

export function thirdsGuide(): { kind: 'thirds'; points: Vec2[] } {
  return {
    kind: 'thirds',
    points: [
      { x: 1 / 3, y: 1 / 3 },
      { x: 2 / 3, y: 1 / 3 },
      { x: 1 / 3, y: 2 / 3 },
      { x: 2 / 3, y: 2 / 3 },
    ],
  };
}

export function goldenGuide(): { kind: 'golden'; points: Vec2[] } {
  const p = 0.381966011;
  return {
    kind: 'golden',
    points: [
      { x: p, y: p },
      { x: 1 - p, y: p },
      { x: p, y: 1 - p },
      { x: 1 - p, y: 1 - p },
    ],
  };
}

/** `lean` > 0 tips the diagonal so its top edge sits right of its bottom edge. */
export function diagonalGuide(lean = 0.14): { kind: 'diagonal'; points: Vec2[] } {
  return {
    kind: 'diagonal',
    points: [
      { x: 0.5 + lean, y: 0 },
      { x: 0.5 - lean, y: 1 },
    ],
  };
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/** Mirror a rect about the vertical centre line — keeps versus layouts honest. */
export function mirrorX(r: Rect): Rect {
  return { x: 1 - r.x - r.w, y: r.y, w: r.w, h: r.h };
}
