/**
 * Layout domain — the geometry half of a template.
 *
 * A LayoutSpec is resolution-independent: every rect is expressed in
 * normalised 0–1 canvas units so one template serves 1280×720, 1920×1080 and
 * 1080×1920 without a rewrite. The renderer resolves to pixels exactly once.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Normalised rect. x/y are the top-left corner in 0–1 canvas units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export type SlotKind = 'subject' | 'text' | 'logo' | 'fx' | 'badge' | 'shape' | 'backplate';

/** How a subject image is fitted into its slot. */
export type FitMode =
  | 'cover'      // fill the slot, crop overflow
  | 'contain'    // fit entirely inside
  | 'face-anchor'// scale so the detected face lands on `focal`, crop the rest
  | 'bust'       // crop to head-and-shoulders using landmarks
  | 'full';      // full subject height, width free

export interface SlotConstraints {
  /** Slot must not overlap slots carrying these ids. */
  noOverlapWith?: string[];
  /** Minimum contrast ratio against whatever sits behind it (WCAG-style). */
  minContrast?: number;
  /** Keep the subject's face inside this sub-rect of the canvas. */
  faceKeepIn?: Rect;
  /** Never let the rendered content leave the canvas. */
  clampToCanvas?: boolean;
}

export interface Slot {
  id: string;
  kind: SlotKind;
  rect: Rect;
  anchor: Anchor;
  /** Paint order; higher sits on top. */
  z: number;
  rotation?: number;
  scale?: number;
  /** Mirror horizontally — used to make both subjects face the centre. */
  flipX?: boolean;
  fit?: FitMode;
  /**
   * Where the subject's face should land inside the slot, in slot-local 0–1
   * units. Defaults to (0.5, 0.38) which reads as natural headroom.
   */
  focal?: Vec2;
  opacity?: number;
  constraints?: SlotConstraints;
  /** Free-form hints consumed by specific template renderers. */
  meta?: Record<string, unknown>;
}

/** A region that must stay free of clutter (platform UI, duration badge…). */
export interface SafeZone {
  id: string;
  rect: Rect;
  /** 'hard' fails QA on violation, 'soft' only warns. */
  severity: 'hard' | 'soft';
  reason: string;
}

export interface LayoutSpec {
  id: string;
  name: string;
  description?: string;
  /** Reference aspect this layout was designed against, e.g. 16/9. */
  designAspect: number;
  slots: Slot[];
  safeZones: SafeZone[];
  /**
   * Points the eye should be pulled to, strongest first. Used by the
   * composition scorer to check the design actually has a focal hierarchy.
   */
  focalPoints: Vec2[];
  /** Guide lines the layout was built on, kept for the debug overlay. */
  guides?: { kind: 'thirds' | 'golden' | 'diagonal' | 'custom'; points: Vec2[] }[];
}

/** Pixel-resolved version of a Rect, produced by the layout resolver. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
