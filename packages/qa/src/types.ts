/**
 * QA context contracts.
 *
 * A gate is deliberately given the *rendered pixels* plus the plan that made
 * them. Checking only the plan would let a compositor bug slip through; checking
 * only the pixels would throw away everything we know about intent (which layer
 * is text, which colour it was supposed to be, which zones must stay clear).
 * Gates read both and are free to disagree with the plan.
 */

import type { QaRequest, ReferenceAsset, RenderPlan } from '@hexa/core';

/** Axis-aligned rect. Accepted in normalised 0–1 units or device pixels — see
 *  `toPixelRect` in `./geom.js` for how the two are told apart. */
export interface QaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A subject as the gates see it: who it is, where their face landed, and what
 *  we are allowed to compare that face against. */
export interface GateSubject {
  playerId: string;
  handle: string;
  /** Where the face ended up in the *render* (not in the source photo). */
  faceRect?: QaRect;
  /** L2-normalised reference gallery for this player. Best match wins. */
  referenceEmbeddings?: number[][];
  /** Silhouette/blurred treatments opt out of identity verification. */
  anonymous?: boolean;
  /** Assets that contributed this subject — used by the licence gate. */
  assets?: ReferenceAsset[];
}

/** A text rect the renderer actually laid out, keyed by its template role. */
export interface GateTextRect {
  role: string;
  rect: QaRect;
}

/** Face embedder. Kept structural so `@hexa/vision`, a remote service or a test
 *  double all satisfy it without this package depending on any of them. */
export interface VisionPort {
  embed(input: Buffer | string): Promise<{ vector: number[] } | null>;
  available(): Promise<boolean>;
}

export interface GateContext {
  /** The rendered thumbnail, encoded (PNG/JPEG/WebP — sharp decodes it). */
  image: Buffer;
  plan: RenderPlan;
  width: number;
  height: number;
  subjects: GateSubject[];
  /** Laid-out text rects. When omitted, gates fall back to deriving them from
   *  the plan's text layers (see `collectTextRects`). */
  textRects?: GateTextRect[];
  request?: QaRequest;
  vision?: VisionPort;
}

export interface Gate {
  /** Stable id — used by `only`/`skip`, and as `QaFinding.gate`. */
  id: string;
  /** Relative importance in the weighted aggregate. Identity is the highest. */
  weight: number;
  description: string;
  run(ctx: GateContext): Promise<import('@hexa/core').QaFinding[]>;
}

export interface AppealContext {
  image: Buffer;
  width: number;
  height: number;
  textRects?: GateTextRect[];
  faceRects?: QaRect[];
}
