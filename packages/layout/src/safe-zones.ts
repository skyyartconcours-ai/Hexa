/**
 * Platform safe zones.
 *
 * Every figure below is an APPROXIMATION measured off the current platform UI
 * (YouTube web + Android, Shorts player, sampled 2025-Q4 at 1280×720 and
 * 1080×1920). Platform chrome moves — treat these as a starting point and
 * re-measure whenever a redesign ships. Each zone carries the source of its
 * numbers in `reason` so a future maintainer knows what to re-check.
 *
 * Severity contract (from @hexa/core):
 *   'hard' → QA fails when content lands inside.
 *   'soft' → QA warns; a designer may knowingly accept it.
 */

import type { SafeZone } from '@hexa/core';

/**
 * Outer bleed ring, emitted as four strips because a SafeZone is a single
 * rect and a ring is not expressible as one.
 *
 * Rationale: thumbnails get rounded corners on mobile, letterboxed in the
 * watch-page "up next" rail, and cropped a few percent by some embeds. Nothing
 * load-bearing (a name, a score, a logo lock-up) should live in the outer 4%.
 */
function bleedZones(margin: number, prefix: string, reason: string): SafeZone[] {
  return [
    { id: `${prefix}-bleed-top`, rect: { x: 0, y: 0, w: 1, h: margin }, severity: 'soft', reason },
    { id: `${prefix}-bleed-bottom`, rect: { x: 0, y: 1 - margin, w: 1, h: margin }, severity: 'soft', reason },
    { id: `${prefix}-bleed-left`, rect: { x: 0, y: 0, w: margin, h: 1 }, severity: 'soft', reason },
    { id: `${prefix}-bleed-right`, rect: { x: 1 - margin, y: 0, w: margin, h: 1 }, severity: 'soft', reason },
  ];
}

/** How much of the frame the outer-bleed ring claims on 16:9 surfaces. */
export const YOUTUBE_BLEED = 0.04;

/** How much of the frame the outer-bleed ring claims on vertical surfaces. */
export const SHORTS_BLEED = 0.03;

/**
 * 16:9 YouTube surfaces (search results, home grid, watch-page sidebar,
 * end screens).
 */
export const YOUTUBE_SAFE_ZONES: readonly SafeZone[] = Object.freeze([
  {
    id: 'yt-duration-pill',
    // APPROX: the duration pill is inset ~4px from the bottom-right of the card
    // and is ~40×20px on a 210×118 grid card — i.e. ~19% wide, ~17% tall, but it
    // grows with longer runtimes ("1:23:45") so the box is widened to 19%.
    rect: { x: 0.80, y: 0.84, w: 0.19, h: 0.13 },
    severity: 'hard',
    reason:
      'Duration/timestamp pill is painted over the bottom-right of every YouTube thumbnail (also used for LIVE and "Watched" chips). APPROX, re-measure against current YouTube web/mobile cards.',
  },
  {
    id: 'yt-progress-bar',
    // APPROX: the red watched-progress bar is ~4px tall on a 118px-tall card
    // (~3.4%), drawn flush to the bottom edge, full width.
    rect: { x: 0, y: 0.955, w: 1, h: 0.045 },
    severity: 'hard',
    reason:
      'Red watch-progress bar covers the bottom strip for any partially-watched video. Hard because it is an unconditional wipe for returning viewers. APPROX (~4px of 118px), re-measure.',
  },
  {
    id: 'yt-hover-controls',
    // APPROX: "Add to queue" / "Watch later" buttons fade in on hover in the
    // top-right of the card, roughly a 28% × 22% region on desktop.
    rect: { x: 0.72, y: 0, w: 0.28, h: 0.22 },
    severity: 'soft',
    reason:
      'Desktop hover controls (Watch later / Add to queue) overlay the top-right corner. Soft: only visible on hover, and only on desktop. APPROX, re-measure.',
  },
  ...bleedZones(
    YOUTUBE_BLEED,
    'yt',
    'Outer bleed: rounded corners on mobile cards, minor crops in embeds and the up-next rail. Keep names, scores and logo lock-ups out of this ring. APPROX.',
  ),
]);

/**
 * 9:16 vertical surfaces (YouTube Shorts, and close enough for Reels/TikTok
 * to be a sane default).
 */
export const SHORTS_SAFE_ZONES: readonly SafeZone[] = Object.freeze([
  {
    id: 'shorts-action-rail',
    // APPROX: like / dislike / comment / share / remix / rotating sound disc,
    // stacked down the right edge of a 1080×1920 player, occupying roughly the
    // right 18% between 35% and 95% of the height.
    rect: { x: 0.82, y: 0.35, w: 0.18, h: 0.60 },
    severity: 'hard',
    reason:
      'Shorts right-hand action rail (like/comment/share/remix/sound). Permanently on screen. APPROX (~right 18%, y 35–95%), re-measure against the current Shorts player.',
  },
  {
    id: 'shorts-caption-block',
    // APPROX: channel handle + title/caption + CTA button occupy the bottom-left,
    // clearing the action rail horizontally.
    rect: { x: 0, y: 0.78, w: 0.82, h: 0.17 },
    severity: 'hard',
    reason:
      'Shorts caption block: @handle, video title and subscribe/CTA row sit bottom-left. APPROX, re-measure.',
  },
  {
    id: 'shorts-bottom-nav',
    // APPROX: app tab bar + scrub/progress line + device home indicator.
    rect: { x: 0, y: 0.95, w: 1, h: 0.05 },
    severity: 'hard',
    reason:
      'App tab bar, scrubber and the phone home indicator eat the bottom strip. APPROX, re-measure per-device.',
  },
  {
    id: 'shorts-top-status',
    // APPROX: device status bar plus the Shorts header (search / camera icons).
    rect: { x: 0, y: 0, w: 1, h: 0.09 },
    severity: 'soft',
    reason:
      'Device status bar and the Shorts header row (search, camera). Soft: it dims rather than fully occludes on some builds. APPROX, re-measure per-device.',
  },
  ...bleedZones(
    SHORTS_BLEED,
    'shorts',
    'Outer bleed for vertical surfaces: notches, rounded corners and per-app crops. APPROX.',
  ),
]);

/**
 * Neutral zones for square-ish canvases (1:1 posts, 4:5 portraits). No known
 * platform chrome is assumed — only the outer bleed and the very bottom strip
 * many feeds overlay with captions.
 */
export const SQUARE_SAFE_ZONES: readonly SafeZone[] = Object.freeze([
  {
    id: 'sq-caption-strip',
    rect: { x: 0, y: 0.90, w: 1, h: 0.10 },
    severity: 'soft',
    reason:
      'Square feed surfaces commonly overlay a caption/handle row at the bottom. APPROX and highly platform-dependent.',
  },
  ...bleedZones(0.035, 'sq', 'Outer bleed for square crops and rounded feed cards. APPROX.'),
]);

/** Aspect above which a canvas is treated as a wide/landscape surface. */
export const WIDE_ASPECT_MIN = 1.2;
/** Aspect below which a canvas is treated as a vertical surface. */
export const TALL_ASPECT_MAX = 0.85;

export type Orientation = 'wide' | 'square' | 'tall';

/** Coarse orientation bucket used by both safe zones and the reflow rules. */
export function orientationOf(aspect: number): Orientation {
  if (!Number.isFinite(aspect) || aspect <= 0) return 'wide';
  if (aspect >= WIDE_ASPECT_MIN) return 'wide';
  if (aspect <= TALL_ASPECT_MAX) return 'tall';
  return 'square';
}

/**
 * Pick the platform safe-zone set that matches a canvas aspect (width/height).
 * 16:9 → YouTube, 9:16 → Shorts, everything in between → the neutral square set.
 */
export function safeZonesFor(aspect: number): SafeZone[] {
  const set =
    orientationOf(aspect) === 'wide'
      ? YOUTUBE_SAFE_ZONES
      : orientationOf(aspect) === 'tall'
        ? SHORTS_SAFE_ZONES
        : SQUARE_SAFE_ZONES;
  // Return a mutable copy: callers stitch these into LayoutSpec.safeZones.
  return set.map((z) => ({ ...z, rect: { ...z.rect } }));
}

/** Ids owned by this module — used by `adaptLayout` to swap platform zones. */
export function isPlatformZoneId(id: string): boolean {
  return id.startsWith('yt-') || id.startsWith('shorts-') || id.startsWith('sq-');
}
