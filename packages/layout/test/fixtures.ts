import type { FaceBox, FaceLandmarks, LayoutSpec, PixelRect, Slot } from '@hexa/core';
import { THIRDS } from '@hexa/core';
import { safeZonesFor } from '../src/index.js';

/** A realistic 16:9 versus layout: two subjects, headline, VS badge, name plates. */
export function versusLayout(): LayoutSpec {
  const slots: Slot[] = [
    { id: 'bg', kind: 'backplate', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'center', z: 0 },
    {
      id: 'left-subject',
      kind: 'subject',
      rect: { x: 0.02, y: 0.1, w: 0.46, h: 0.9 },
      anchor: 'bottom-left',
      z: 10,
      fit: 'face-anchor',
      focal: { x: 0.42, y: 0.34 },
      meta: { faceInward: true },
    },
    {
      id: 'right-subject',
      kind: 'subject',
      rect: { x: 0.52, y: 0.1, w: 0.46, h: 0.9 },
      anchor: 'bottom-right',
      z: 10,
      fit: 'face-anchor',
      focal: { x: 0.58, y: 0.34 },
      meta: { faceInward: true },
    },
    { id: 'headline', kind: 'text', rect: { x: 0.25, y: 0.04, w: 0.5, h: 0.14 }, anchor: 'top-center', z: 30 },
    { id: 'vs', kind: 'badge', rect: { x: 0.45, y: 0.42, w: 0.1, h: 0.16 }, anchor: 'center', z: 40 },
    { id: 'left-name', kind: 'text', rect: { x: 0.05, y: 0.8, w: 0.28, h: 0.08 }, anchor: 'bottom-left', z: 31 },
    { id: 'right-name', kind: 'text', rect: { x: 0.67, y: 0.8, w: 0.28, h: 0.08 }, anchor: 'bottom-right', z: 31 },
  ];
  return {
    id: 'versus-classic',
    name: 'Versus Classic',
    description: 'Two players, split frame.',
    designAspect: 16 / 9,
    slots,
    safeZones: safeZonesFor(16 / 9),
    focalPoints: [
      { x: 1 / 3, y: 0.38 },
      { x: 2 / 3, y: 0.38 },
      { x: 0.5, y: 0.5 },
    ],
    guides: [{ kind: 'thirds', points: [...THIRDS] }],
  };
}

/** The same composition already authored for 9:16. */
export function verticalVersusLayout(): LayoutSpec {
  const slots: Slot[] = [
    { id: 'bg', kind: 'backplate', rect: { x: 0, y: 0, w: 1, h: 1 }, anchor: 'center', z: 0 },
    { id: 'top-subject', kind: 'subject', rect: { x: 0.14, y: 0.3, w: 0.62, h: 0.37 }, anchor: 'bottom-center', z: 10, fit: 'bust' },
    { id: 'bottom-subject', kind: 'subject', rect: { x: 0.24, y: 0.63, w: 0.62, h: 0.37 }, anchor: 'bottom-center', z: 10, fit: 'bust' },
    { id: 'headline', kind: 'text', rect: { x: 0.06, y: 0.05, w: 0.88, h: 0.09 }, anchor: 'top-center', z: 30 },
    { id: 'vs', kind: 'badge', rect: { x: 0.42, y: 0.62, w: 0.16, h: 0.05 }, anchor: 'center', z: 40 },
  ];
  return {
    id: 'versus-vertical',
    name: 'Versus Vertical',
    designAspect: 9 / 16,
    slots,
    safeZones: safeZonesFor(9 / 16),
    focalPoints: [
      { x: 0.45, y: 0.4 },
      { x: 0.55, y: 0.75 },
    ],
  };
}

export function face(x: number, y: number, w: number, h: number, confidence = 0.99): FaceBox {
  return { x, y, w, h, confidence };
}

/** Landmarks consistent with `box`, turned by `turn` (−1 left … +1 right). */
export function landmarksFor(box: FaceBox, turn = 0): FaceLandmarks {
  const cx = box.x + box.w / 2;
  const eyeY = box.y + box.h * 0.42;
  const span = box.w * 0.36;
  return {
    leftEye: [cx - span, eyeY],
    rightEye: [cx + span, eyeY],
    nose: [cx + turn * span * 0.8, box.y + box.h * 0.62],
    mouthLeft: [cx - span * 0.55, box.y + box.h * 0.8],
    mouthRight: [cx + span * 0.55, box.y + box.h * 0.8],
  };
}

export function rect(x: number, y: number, w: number, h: number): PixelRect {
  return { x, y, w, h };
}

/** Every rect sits inside the unit canvas (with a float tolerance). */
export function insideCanvas(r: { x: number; y: number; w: number; h: number }, eps = 1e-6): boolean {
  return r.x >= -eps && r.y >= -eps && r.x + r.w <= 1 + eps && r.y + r.h <= 1 + eps;
}
