/**
 * @hexa/layout — the geometry brain.
 *
 *   LayoutSpec (0–1 units)  ──resolveLayout──▶  ResolvedLayout (pixels)
 *   cut-out + face box      ──fitSubject────▶  srcCrop / destRect / scale
 *   resolved composition    ──scoreComposition──▶ 0–100 + actionable findings
 *
 * Nothing in here touches pixels of image data; it is pure geometry and pure
 * opinion, which is what makes it testable.
 */

export {
  resolveLayout,
  withSlots,
  type ResolvedSlot,
  type ResolvedLayout,
  type ResolvedSafeZone,
} from './resolve.js';

export { adaptLayout, TEXT_LEGIBILITY_BOOST } from './adapt.js';

export {
  fitSubject,
  bustCrop,
  alphaContentBox,
  facingFromLandmarks,
  crownY,
  eyeLineY,
  DEFAULT_FOCAL,
  DEFAULT_FACE_HEIGHT_RATIO,
  DEFAULT_BUST_HEADROOM,
  DEFAULT_SHOULDER_RATIO,
  CROWN_ABOVE_FACE,
  type SubjectFit,
  type FitSubjectInput,
  type BustCropOptions,
} from './subject.js';

export {
  scoreComposition,
  COMPOSITION_WEIGHTS,
  FACE_MIN_HEIGHT,
  FACE_MAX_HEIGHT,
  type CompositionScore,
  type ScoreCompositionInput,
  type ScoredFace,
} from './score.js';

export { checkSafeZones, type OccupiedRect } from './qa.js';

export { resolveOverlaps, isMovable, type ResolveOverlapsResult } from './overlap.js';

export {
  YOUTUBE_SAFE_ZONES,
  SHORTS_SAFE_ZONES,
  SQUARE_SAFE_ZONES,
  safeZonesFor,
  orientationOf,
  isPlatformZoneId,
  YOUTUBE_BLEED,
  SHORTS_BLEED,
  WIDE_ASPECT_MIN,
  TALL_ASPECT_MAX,
  type Orientation,
} from './safe-zones.js';

export { makeGrid, diagonalSplit, type GridOptions, type DiagonalSplit } from './grid.js';
