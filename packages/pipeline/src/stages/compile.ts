/**
 * Stage 6 — compile. Template + subjects + text ⇒ RenderPlan.
 *
 * This is the compiler at the centre of the product. Everything upstream gathers
 * material; everything downstream is mechanical. A RenderPlan is pure data — no
 * closures, no promises — so once it exists it can be cached, diffed between
 * variants, replayed from its seed, or shipped to a remote worker.
 *
 * HOW A COMPOSITE IS BUILT
 * Layers are emitted back-to-front in seven passes:
 *
 *   0  backplate            AI plate, a file, or a procedural backdrop
 *   1  backdrop overlays    floor gradient and colour wash that seat the scene
 *   2  atmosphere (behind)  haze, rays, speed lines, the far half of particles
 *   3  subjects             contact shadow → cutout → light wrap, per subject
 *   4  logos / shapes       supporting slots
 *   5  atmosphere (front)   ground fog and the near half of particles
 *   6  text                 at the layout's own z, so a template can put type
 *                           behind a subject if it wants to
 *
 * Splitting atmosphere across passes 2 and 5 is what makes it read as *air*
 * rather than a filter: particles pass in front of a shoulder and behind a head,
 * so the subject sits inside the scene instead of on top of it.
 *
 * Z-ORDER
 * Slot z values are multiplied by {@link Z_SCALE} and offset, which leaves room
 * between adjacent slots for the shadow/subject/light-wrap triplet each subject
 * needs. It also means text authored above the subjects lands above the front
 * atmosphere automatically, and text authored below stays below.
 *
 * DETERMINISM
 * Every stochastic choice draws from `createRng(seed)` forked per subsystem, so
 * adding a new effect cannot shift the particle positions of an existing one.
 * The only non-deterministic field in the output is `meta.createdAt`, which is
 * injectable for exactly that reason and touches no pixels.
 */

import { HexaError, createRng, mix, readableOn, shade, withAlpha } from '@hexa/core';
import type {
  BlendMode,
  FaceBox,
  Layer,
  LayerEffects,
  LayerSource,
  PixelRect,
  RenderPlan,
  Slot,
  SubjectRef,
  TemplateContext,
  TextRole,
  TextSlotSpec,
  ThumbnailTemplate,
} from '@hexa/core';
import { GENERATOR_IDS, type ResolvedSlot } from '../adapters/contracts.js';
import { adaptLayout, fitSubject, resolveLayoutPixels } from '../adapters/layout.js';
import { builtinLutNames } from '../adapters/render.js';
import { canvasFor, resolveTemplateLayout, resolveTemplateStyle } from '../adapters/templates.js';
import { autoFit, presetFor, versusMark } from '../adapters/type.js';
import {
  atmosphereFor,
  backdropFor,
  brandStrength,
  contactShadowParams,
  glowFor,
  gradeFor,
  lightRigFor,
  rimFor,
  separationShadow,
} from '../style.js';
import type { CompileInput, PreparedSubject, ResolvedPalette, VariantAxes } from '../types.js';
import { baseAxes } from '../variants.js';

/** Slot z is multiplied by this, leaving room for per-subject sub-layers. */
export const Z_SCALE = 10;
/** Slot z 0 must still sit above the backplate and its overlays. */
export const Z_SLOT_BASE = 10;

/** Buffer keys are a convention the render stage rebuilds the buffer map from. */
export const BUFFER_KEYS = {
  backplate: 'backplate',
  subject: (index: number) => `subject:${index}`,
  logo: (teamId: string) => `logo:${teamId}`,
} as const;

/** Provenance for a `{type:'buffer'}` layer, recorded into `plan.meta`. */
export interface BufferRef {
  key: string;
  kind: 'subject' | 'backplate' | 'logo';
  /** Subject index, or team id. */
  ref: string;
}

export interface TextRectRecord {
  slotId: string;
  role: TextRole;
  rect: PixelRect;
  color: string;
  fontSize: number;
  text: string;
  /** Colour immediately behind this text, for the contrast gate. */
  behind: string;
}

export interface FaceRectRecord {
  layerId: string;
  playerId: string;
  rect: PixelRect;
  /** False when no face was detected and the subject was merely centred. */
  detected: boolean;
}

export async function compilePlan(input: CompileInput): Promise<RenderPlan> {
  const axes = input.variant ?? baseAxes(input.seed);
  const rng = createRng(input.seed);
  const warnings: string[] = [];

  const canvas = await canvasFor(input.aspect);
  const ctx = templateContext(input);

  const authored = await resolveTemplateLayout(input.template, ctx);
  const layout = await adaptLayout(authored, canvas.width / canvas.height);
  const style = await resolveTemplateStyle(input.template, ctx);
  const resolved = await resolveLayoutPixels(layout, canvas.width, canvas.height);

  const rig = lightRigFor(style, axes);
  const atmosphere = atmosphereFor(style, axes, input.palette);
  const backdrop = backdropFor(style, axes);

  const layers: Layer[] = [];
  const buffers: BufferRef[] = [];
  const textRects: TextRectRecord[] = [];
  const faceRects: FaceRectRecord[] = [];
  const identityLayers: string[] = [];
  const mirrored: string[] = [];

  const subjectSlots = resolved.slots.filter((s) => s.slot.kind === 'subject');
  const subjectZ = subjectSlots.map((s) => zOf(s.slot));
  const subjectZMin = subjectZ.length ? Math.min(...subjectZ) : Z_SLOT_BASE;
  const subjectZMax = subjectZ.length ? Math.max(...subjectZ) : Z_SLOT_BASE;

  // ── pass 0–1: backplate and backdrop overlays ─────────────────────────────
  emitBackplate({ input, canvas, backdrop, layers, buffers, rng: rng.fork(1) });

  // ── pass 2: atmosphere behind the subjects ────────────────────────────────
  emitAtmosphere({
    layers,
    atmosphere,
    palette: input.palette,
    canvas,
    pass: 'behind',
    z: subjectZMin - 4,
    seed: rng.fork(2).int(0, 2 ** 30),
    rig,
  });

  // ── pass 3: subjects ──────────────────────────────────────────────────────
  const assignment = assignSubjects(subjectSlots, input.subjects);
  for (const { slot, subject } of assignment) {
    if (!subject) {
      warnings.push(`Layout slot "${slot.slot.id}" has no subject to fill it.`);
      continue;
    }
    await emitSubject({
      resolved: slot,
      subject,
      input,
      axes,
      rig,
      canvas,
      layers,
      buffers,
      identityLayers,
      faceRects,
      mirrored,
      warnings,
      hasBackplate: layers.length > 0,
    });
  }

  // ── pass 4: supporting slots ──────────────────────────────────────────────
  for (const slot of resolved.slots) {
    if (slot.slot.kind === 'shape') emitShape(slot, input.palette, style && brandStrength(style), layers);
    if (slot.slot.kind === 'backplate' && input.backplate) emitBackplateSlot(slot, layers, buffers);
  }

  // ── pass 5: atmosphere in front ───────────────────────────────────────────
  emitAtmosphere({
    layers,
    atmosphere,
    palette: input.palette,
    canvas,
    pass: 'front',
    z: subjectZMax + 4,
    seed: rng.fork(3).int(0, 2 ** 30),
    rig,
  });

  // ── pass 6: text ──────────────────────────────────────────────────────────
  await emitText({ resolved, input, axes, canvas, layers, textRects, warnings, backdrop });

  layers.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  const lutNames = await builtinLutNames();

  return {
    canvas: {
      width: canvas.width,
      height: canvas.height,
      background: input.palette.dark,
      // Subjects have hair. Rendering at 2× and downsampling is the difference
      // between a matted edge that looks cut and one that looks photographed.
      supersample: canvas.width >= 1920 ? 1 : 2,
    },
    layers,
    grade: gradeFor(style, axes, lutNames, input.grade),
    seed: input.seed,
    meta: {
      templateId: input.template.id,
      variantId: input.variantId,
      subjects: input.subjects.map((s) => s.player.id),
      createdAt: input.now ?? new Date().toISOString(),
      identityLayers,
      faceRects,
      textRects,
      buffers,
      palette: input.palette,
      aspect: input.aspect,
      lightRig: rig,
      backdrop,
      atmosphere,
      variant: axes,
      variantAxes: axes.index === 0 ? 'template default' : undefined,
      safeZones: resolved.safeZones,
      assets: input.subjects.map((s) => s.asset.id),
      placeholders: input.subjects.filter((s) => s.placeholder).map((s) => s.player.id),
      mirrored,
      anonymousSubjects: input.subjects.filter((s) => s.anonymous).map((s) => s.player.id),
      warnings,
    },
  };
}

// ── context ──────────────────────────────────────────────────────────────────

function templateContext(input: CompileInput): TemplateContext {
  const subjects: SubjectRef[] = input.subjects.map((s) => ({
    player: s.player,
    team: s.team,
    assetId: s.asset.id,
    side: s.side,
    accent: s.accent,
  }));
  return { subjects, text: input.text, aspect: input.aspect, seed: input.seed, palette: input.palette };
}

function zOf(slot: Slot): number {
  return Z_SLOT_BASE + (slot.z ?? 0) * Z_SCALE;
}

// ── pass 0–1: backplate ──────────────────────────────────────────────────────

function emitBackplate(args: {
  input: CompileInput;
  canvas: { width: number; height: number };
  backdrop: string;
  layers: Layer[];
  buffers: BufferRef[];
  rng: ReturnType<typeof createRng>;
}): void {
  const { input, canvas, backdrop, layers, buffers } = args;
  const full: PixelRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const { left, right, accent, dark } = input.palette;

  if (input.backplate) {
    layers.push({
      id: 'backplate',
      source: { type: 'buffer', key: BUFFER_KEYS.backplate },
      rect: full,
      z: 0,
      opacity: 1,
      blend: 'over',
      label: `backplate (${input.background?.mode ?? 'supplied'})`,
    });
    buffers.push({ key: BUFFER_KEYS.backplate, kind: 'backplate', ref: 'backplate' });
  } else {
    layers.push(proceduralBackdrop(backdrop, full, input.palette, input.seed));
  }

  // A colour wash carrying the two team colours across the frame. Even over an
  // AI plate this is what ties an arbitrary background to *this* matchup.
  layers.push({
    id: 'backdrop-wash',
    source: {
      type: 'gradient',
      stops: [
        { offset: 0, color: withAlpha(left, 0.55) },
        { offset: 0.5, color: withAlpha(mix(left, right, 0.5), 0.12) },
        { offset: 1, color: withAlpha(right, 0.55) },
      ],
      angle: 0,
    },
    rect: full,
    z: 2,
    opacity: 0.65,
    blend: 'soft-light',
    label: 'team colour wash',
  });

  // Darkened floor: gives the subjects something to stand on and a place for
  // the contact shadows to land.
  layers.push({
    id: 'backdrop-floor',
    source: {
      type: 'gradient',
      stops: [
        { offset: 0, color: withAlpha(dark, 0) },
        { offset: 1, color: withAlpha(shade(dark, -0.05), 0.9) },
      ],
      angle: 270,
    },
    rect: { x: 0, y: Math.round(canvas.height * 0.45), w: canvas.width, h: Math.round(canvas.height * 0.55) },
    z: 3,
    opacity: 0.85,
    blend: 'over',
    label: 'floor falloff',
  });

  // Centre pop: a soft accent glow behind where the subjects meet.
  layers.push({
    id: 'backdrop-center-glow',
    source: {
      type: 'radial',
      stops: [
        { offset: 0, color: withAlpha(accent, 0.35) },
        { offset: 1, color: withAlpha(accent, 0) },
      ],
      center: [0.5, 0.46],
      radius: 0.55,
    },
    rect: full,
    z: 4,
    opacity: 0.7,
    blend: 'screen',
    label: 'centre glow',
  });
}

function proceduralBackdrop(
  backdrop: string,
  rect: PixelRect,
  palette: ResolvedPalette,
  seed: number,
): Layer {
  const { left, right, dark, accent } = palette;
  const base = { id: 'backdrop', rect, z: 0, opacity: 1, blend: 'over' as BlendMode, label: `backdrop: ${backdrop}` };

  switch (backdrop) {
    case 'solid':
      return { ...base, source: { type: 'solid', color: dark } };
    case 'radial':
      return {
        ...base,
        source: {
          type: 'radial',
          stops: [
            { offset: 0, color: mix(dark, accent, 0.28) },
            { offset: 0.6, color: shade(dark, 0.04) },
            { offset: 1, color: shade(dark, -0.06) },
          ],
          center: [0.5, 0.44],
          radius: 0.78,
        },
      };
    case 'arena':
    case 'abstract':
    case 'shatter':
    case 'grid':
      return {
        ...base,
        source: {
          type: 'generated',
          generatorId: `${GENERATOR_IDS.backdrop}-${backdrop}`,
          params: { left, right, dark, accent, seed, treatment: backdrop },
        },
      };
    case 'gradient':
    default:
      // Diagonal rather than horizontal: a diagonal seam is the versus device,
      // and it stops the two halves reading as two separate images.
      return {
        ...base,
        source: {
          type: 'gradient',
          stops: [
            { offset: 0, color: mix(dark, left, 0.45) },
            { offset: 0.5, color: shade(dark, 0.02) },
            { offset: 1, color: mix(dark, right, 0.45) },
          ],
          angle: 12,
        },
      };
  }
}

function emitBackplateSlot(slot: ResolvedSlot, layers: Layer[], buffers: BufferRef[]): void {
  layers.push({
    id: `slot-${slot.slot.id}`,
    source: { type: 'buffer', key: BUFFER_KEYS.backplate },
    rect: slot.rect,
    z: zOf(slot.slot),
    opacity: slot.slot.opacity ?? 1,
    blend: 'over',
    label: `backplate slot ${slot.slot.id}`,
  });
  if (!buffers.some((b) => b.key === BUFFER_KEYS.backplate)) {
    buffers.push({ key: BUFFER_KEYS.backplate, kind: 'backplate', ref: 'backplate' });
  }
}

// ── pass 3: subjects ─────────────────────────────────────────────────────────

interface SlotAssignment {
  slot: ResolvedSlot;
  subject?: PreparedSubject;
}

/**
 * Match subjects to subject slots.
 *
 * Templates say what they want in `slot.meta` (`subjectIndex`, `side`) or in the
 * slot id; anything left over is filled in order. Getting this wrong swaps two
 * players' faces, so explicit hints always beat positional order.
 */
export function assignSubjects(slots: ResolvedSlot[], subjects: PreparedSubject[]): SlotAssignment[] {
  const remaining = new Set(subjects.map((s) => s.index));
  const out: SlotAssignment[] = slots.map((slot) => ({ slot }));
  const take = (predicate: (s: PreparedSubject) => boolean): PreparedSubject | undefined => {
    const found = subjects.find((s) => remaining.has(s.index) && predicate(s));
    if (found) remaining.delete(found.index);
    return found;
  };

  // 1. explicit index
  for (const entry of out) {
    const wanted = entry.slot.slot.meta?.['subjectIndex'];
    if (typeof wanted === 'number') entry.subject = take((s) => s.index === wanted);
  }
  // 2. declared side, from meta or the slot id
  for (const entry of out) {
    if (entry.subject) continue;
    const side = declaredSide(entry.slot.slot);
    if (side) entry.subject = take((s) => s.side === side);
  }
  // 3. whatever is left, in order
  for (const entry of out) {
    if (!entry.subject) entry.subject = take(() => true);
  }
  return out;
}

function declaredSide(slot: Slot): 'left' | 'right' | 'center' | undefined {
  const meta = slot.meta?.['side'];
  if (meta === 'left' || meta === 'right' || meta === 'center') return meta;
  const id = slot.id.toLowerCase();
  if (id.includes('left')) return 'left';
  if (id.includes('right')) return 'right';
  if (id.includes('center') || id.includes('centre')) return 'center';
  return undefined;
}

async function emitSubject(args: {
  resolved: ResolvedSlot;
  subject: PreparedSubject;
  input: CompileInput;
  axes: VariantAxes;
  rig: ReturnType<typeof lightRigFor>;
  canvas: { width: number; height: number };
  layers: Layer[];
  buffers: BufferRef[];
  identityLayers: string[];
  faceRects: FaceRectRecord[];
  mirrored: string[];
  warnings: string[];
  hasBackplate: boolean;
}): Promise<void> {
  const { resolved, subject, input, axes, rig, canvas, layers, buffers } = args;
  const slot = resolved.slot;
  const layerId = `subject-${subject.index}-${slot.id}`;
  const z = zOf(slot);

  const size = subject.size ?? { width: resolved.rect.w, height: resolved.rect.h };
  const fit = await fitSubject({
    slot,
    slotRect: resolved.rect,
    image: size,
    faceBox: subject.faceBox,
    landmarks: subject.landmarks,
    contentBox: subject.contentBox,
    fit: cropModeFor(slot, axes),
    scaleBias: axes.subjectScale,
    canvas,
  });

  // Mirroring: a subject on the left should look right, into the frame and at
  // their opponent. Looking out of frame reads as disengagement. The cost is
  // that jersey text and logos mirror too, so it is recorded in meta rather
  // than done silently.
  const wantFacing = preferredFacing(slot, subject.side);
  const needsMirror =
    wantFacing !== undefined && subject.facing !== undefined && subject.facing !== 'front' && subject.facing !== wantFacing;
  const flipX = Boolean(fit.flipX) !== needsMirror;
  if (needsMirror) args.mirrored.push(subject.player.id);

  const rim = rimFor(subject.side, input.palette, axes, rig, fit.rect.w);
  const effects: LayerEffects = {
    ...(input.template.style && typeof input.template.style === 'object' ? subjectEffectsOf(input.template) : {}),
    rimLight: { angle: rim.angle, width: rim.width, color: rim.color, intensity: rim.intensity },
    glow: glowFor(rim, rig),
    shadow: separationShadow(rig, input.palette, fit.rect.w),
  };

  // Contact shadow, under the subject: the pool of darkness that says a person
  // is standing on something. Without it a cutout floats like a sticker.
  const groundY = fit.rect.y + fit.rect.h;
  layers.push({
    id: `${layerId}-contact`,
    source: {
      type: 'generated',
      generatorId: GENERATOR_IDS.contactShadow,
      params: { ...contactShadowParams(rig, input.palette), angle: rim.angle, seed: input.seed + subject.index },
    },
    rect: {
      x: Math.round(fit.rect.x - fit.rect.w * 0.08),
      y: Math.round(groundY - fit.rect.h * 0.1),
      w: Math.round(fit.rect.w * 1.16),
      h: Math.round(fit.rect.h * 0.16),
    },
    z: z - 2,
    opacity: 1,
    blend: 'multiply',
    label: `contact shadow — ${subject.player.handle}`,
  });

  layers.push({
    id: layerId,
    source: { type: 'buffer', key: BUFFER_KEYS.subject(subject.index) },
    rect: fit.rect,
    z,
    opacity: slot.opacity ?? 1,
    blend: 'over',
    effects,
    flipX,
    rotation: slot.rotation,
    label: `${subject.player.handle} (${subject.team.tag})${subject.placeholder ? ' — placeholder' : ''}`,
  });
  buffers.push({ key: BUFFER_KEYS.subject(subject.index), kind: 'subject', ref: String(subject.index) });

  // Light wrap: a blurred copy of the backdrop, masked by the subject's own
  // alpha and screened over its edges. It is the single cheapest trick for
  // making a cutout belong to its scene rather than sit in front of it —
  // real light spills around a real person's edges, and this fakes that spill.
  layers.push({
    id: `${layerId}-lightwrap`,
    source: args.hasBackplate && input.backplate
      ? { type: 'buffer', key: BUFFER_KEYS.backplate }
      : { type: 'generated', generatorId: GENERATOR_IDS.lightWrap, params: { color: rim.color, angle: rim.angle } },
    rect: fit.rect,
    z: z + 1,
    opacity: 0.34,
    blend: 'screen',
    effects: { blur: Math.max(6, Math.round(fit.rect.w * 0.035)) },
    maskLayerId: layerId,
    label: `light wrap — ${subject.player.handle}`,
  });

  if (!subject.anonymous) args.identityLayers.push(layerId);

  const faceRect = fit.faceRect ?? projectFaceRect(subject.faceBox, fit, flipX);
  if (faceRect) {
    args.faceRects.push({
      layerId,
      playerId: subject.player.id,
      rect: faceRect,
      detected: subject.faceBox !== undefined,
    });
  } else if (!subject.anonymous) {
    args.warnings.push(
      `No face position for ${subject.player.handle} — QA cannot verify their likeness in this render.`,
    );
  }
}

function subjectEffectsOf(template: ThumbnailTemplate): LayerEffects {
  const style = template.style;
  return typeof style === 'object' && style?.subjectEffects ? { ...style.subjectEffects } : {};
}

/** Which way the template wants this subject to look. */
function preferredFacing(slot: Slot, side: 'left' | 'right' | 'center'): 'left' | 'right' | undefined {
  const declared = slot.meta?.['preferFacing'];
  if (declared === 'left' || declared === 'right') return declared;
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return undefined;
}

function cropModeFor(slot: Slot, axes: VariantAxes): Slot['fit'] {
  switch (axes.cropTightness) {
    case 'bust':
      return 'bust';
    case 'chest':
      return 'face-anchor';
    case 'wide':
      return 'full';
    default:
      return slot.fit;
  }
}

/**
 * Where the face landed on the canvas, when @hexa/layout did not say.
 *
 * Applies the same transform the compositor will: crop, then scale, then place,
 * then mirror within the destination rect. QA crops this region out of the
 * finished render to verify identity, so an error here shows up as a
 * false identity failure rather than a visible glitch — worth doing exactly.
 */
export function projectFaceRect(
  faceBox: FaceBox | undefined,
  fit: { rect: PixelRect; scale: number; crop?: PixelRect },
  flipX: boolean,
): PixelRect | undefined {
  if (!faceBox) return undefined;
  const cropX = fit.crop?.x ?? 0;
  const cropY = fit.crop?.y ?? 0;
  const scale = fit.scale || 1;

  const x = fit.rect.x + (faceBox.x - cropX) * scale;
  const y = fit.rect.y + (faceBox.y - cropY) * scale;
  const w = faceBox.w * scale;
  const h = faceBox.h * scale;

  const mirroredX = flipX ? fit.rect.x + fit.rect.w - (x - fit.rect.x) - w : x;
  return { x: Math.round(mirroredX), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

// ── pass 4: shapes ───────────────────────────────────────────────────────────

function emitShape(slot: ResolvedSlot, palette: ResolvedPalette, strength: number, layers: Layer[]): void {
  const role = String(slot.slot.meta?.['fill'] ?? 'accent');
  const color =
    role === 'left' ? palette.left : role === 'right' ? palette.right : role === 'dark' ? palette.dark : palette.accent;
  layers.push({
    id: `shape-${slot.slot.id}`,
    source: { type: 'solid', color },
    rect: slot.rect,
    z: zOf(slot.slot),
    opacity: (slot.slot.opacity ?? 1) * (0.5 + strength * 0.5),
    blend: (slot.slot.meta?.['blend'] as BlendMode) ?? 'over',
    rotation: slot.slot.rotation,
    label: `shape ${slot.slot.id}`,
  });
}

// ── passes 2 & 5: atmosphere ─────────────────────────────────────────────────

/**
 * Emit one atmospheric pass.
 *
 * The split is chosen so each element sits where its real-world counterpart
 * would: light shafts and speed lines come from behind the subject, ground fog
 * rolls across in front of their feet, and particles are divided between the two
 * so some drift past the camera and some hang in the distance.
 */
function emitAtmosphere(args: {
  layers: Layer[];
  atmosphere: import('@hexa/core').AtmosphereSpec;
  palette: ResolvedPalette;
  canvas: { width: number; height: number };
  pass: 'behind' | 'front';
  z: number;
  seed: number;
  rig: string;
}): void {
  const { layers, atmosphere, palette, canvas, pass, z, seed } = args;
  const full: PixelRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const suffix = pass === 'behind' ? 'back' : 'front';

  if (pass === 'behind') {
    if (atmosphere.haze && atmosphere.haze > 0.01) {
      layers.push({
        id: `fx-haze-${suffix}`,
        source: {
          type: 'generated',
          generatorId: GENERATOR_IDS.haze,
          params: { density: atmosphere.haze, color: mix(palette.light, palette.accent, 0.3), seed },
        },
        rect: full,
        z,
        opacity: Math.min(0.8, atmosphere.haze),
        blend: 'screen',
        label: `haze ${atmosphere.haze.toFixed(2)}`,
      });
    }
    if (atmosphere.rays) {
      layers.push({
        id: `fx-rays-${suffix}`,
        source: { type: 'generated', generatorId: GENERATOR_IDS.rays, params: { ...atmosphere.rays, seed } },
        rect: full,
        z: z + 1,
        opacity: Math.min(1, atmosphere.rays.intensity),
        blend: 'screen',
        label: `light shafts ×${atmosphere.rays.count}`,
      });
    }
    if (atmosphere.speedLines) {
      layers.push({
        id: `fx-speedlines-${suffix}`,
        source: { type: 'generated', generatorId: GENERATOR_IDS.speedLines, params: { ...atmosphere.speedLines, seed } },
        rect: full,
        z: z + 2,
        opacity: 0.75,
        blend: 'add',
        label: 'speed lines',
      });
    }
  } else if (atmosphere.fog) {
    layers.push({
      id: `fx-fog-${suffix}`,
      source: {
        type: 'generated',
        generatorId: GENERATOR_IDS.fog,
        params: { height: atmosphere.fog, color: mix(palette.dark, palette.light, 0.35), seed },
      },
      rect: { x: 0, y: Math.round(canvas.height * (1 - atmosphere.fog)), w: canvas.width, h: Math.round(canvas.height * atmosphere.fog) },
      z,
      opacity: 0.7,
      blend: 'screen',
      label: `ground fog ${atmosphere.fog.toFixed(2)}`,
    });
  }

  if (atmosphere.particles && atmosphere.particles.density > 0) {
    // 60/40 back/front: most of the field sits behind so the subjects stay
    // readable, with enough in front to sell the depth.
    const share = pass === 'behind' ? 0.6 : 0.4;
    layers.push({
      id: `fx-particles-${suffix}`,
      source: {
        type: 'generated',
        generatorId: GENERATOR_IDS.particles,
        params: {
          ...atmosphere.particles,
          density: atmosphere.particles.density * share,
          seed: seed + (pass === 'behind' ? 0 : 1),
          depth: pass,
        },
      },
      rect: full,
      z: z + 3,
      opacity: pass === 'behind' ? 0.85 : 0.7,
      blend: 'screen',
      // Foreground particles are out of focus: they are closer to the lens than
      // the plane the subject is on, and a sharp particle in front reads as dirt
      // on the screen rather than depth.
      effects: pass === 'front' ? { blur: 3 } : undefined,
      label: `${atmosphere.particles.kind} particles (${pass})`,
    });
  }
}

// ── pass 6: text ─────────────────────────────────────────────────────────────

async function emitText(args: {
  resolved: { slots: ResolvedSlot[] };
  input: CompileInput;
  axes: VariantAxes;
  canvas: { width: number; height: number };
  layers: Layer[];
  textRects: TextRectRecord[];
  warnings: string[];
  backdrop: string;
}): Promise<void> {
  const { resolved, input, axes, canvas, layers, textRects, warnings } = args;
  const specs = new Map((input.template.textSlots ?? []).map((s) => [s.slotId, s]));

  for (const entry of resolved.slots) {
    const slot = entry.slot;
    if (slot.kind !== 'text' && slot.kind !== 'badge') continue;

    const spec = specs.get(slot.id);
    const role = spec?.role ?? (slot.meta?.['role'] as TextRole | undefined);
    if (!role) continue;

    const copy = resolveCopy(role, spec, input);
    if (!copy) {
      if (spec?.required) {
        warnings.push(`Template "${input.template.id}" wants ${role} text and none was supplied — that slot is empty.`);
      }
      continue;
    }

    const rect = arrangeTextRect(entry.rect, role, axes.textArrangement, canvas);
    const behind = backdropColorBehind(rect, input.palette, canvas);
    const color = textColorFor(role, input.palette, behind);

    try {
      const fitted =
        role === 'vs'
          ? await versusMark({
              rect,
              text: copy,
              style: axes.versusStyle === 'template' ? String(slot.meta?.['style'] ?? 'slash') : axes.versusStyle,
              left: input.palette.left,
              right: input.palette.right,
              accent: input.palette.accent,
              seed: input.seed,
            })
          : await autoFit({
              text: copy,
              rect,
              role,
              preset: await presetFor(role),
              color,
              accent: input.palette.accent,
              align: alignFor(role, axes.textArrangement),
              seed: input.seed,
            });

      layers.push({
        id: `text-${slot.id}`,
        source: { type: 'svg', markup: fitted.markup },
        rect: fitted.rect,
        z: zOf(slot),
        opacity: slot.opacity ?? 1,
        blend: 'over',
        rotation: slot.rotation,
        label: `${role}: ${truncate(copy, 32)}`,
      });

      // QA measures the type that was actually drawn, not the slot it was asked
      // to fill — autofit shrinks and re-wraps, and a contrast gate run against
      // the slot rect would be measuring empty space.
      textRects.push({
        slotId: slot.id,
        role,
        rect: fitted.rect,
        color: fitted.color,
        fontSize: fitted.fontSize,
        text: copy,
        behind,
      });
    } catch (e) {
      if (e instanceof HexaError && e.code === 'FONT_MISSING') throw e;
      warnings.push(`Could not lay out ${role} text: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * The copy for a role.
 *
 * Falls back to the template's default and then to the subjects themselves: a
 * `left-name` slot should say "Peyz" without the caller retyping the name they
 * already passed as a subject. Derivation is what makes `hexa gen Peyz Viper`
 * produce a finished thumbnail from two words.
 */
export function resolveCopy(
  role: TextRole,
  spec: TextSlotSpec | undefined,
  input: Pick<CompileInput, 'text' | 'subjects'>,
): string | undefined {
  const supplied = input.text[role];
  const derived = supplied ?? spec?.defaultText ?? deriveFromSubjects(role, input.subjects);
  if (!derived) return undefined;

  const transformed = applyTransform(derived, spec?.transform);
  if (spec?.maxChars && transformed.length > spec.maxChars) {
    return `${transformed.slice(0, Math.max(1, spec.maxChars - 1)).trimEnd()}…`;
  }
  return transformed;
}

function deriveFromSubjects(role: TextRole, subjects: PreparedSubject[]): string | undefined {
  const left = subjects.find((s) => s.side === 'left') ?? subjects[0];
  const right = subjects.find((s) => s.side === 'right') ?? subjects[1];
  const center = subjects.find((s) => s.side === 'center') ?? left;

  switch (role) {
    case 'left-name':
      return left?.player.handle;
    case 'right-name':
      return right?.player.handle;
    case 'left-team':
      return left?.team.tag;
    case 'right-team':
      return right?.team.tag;
    case 'vs':
      return subjects.length >= 2 ? 'VS' : undefined;
    case 'headline':
      return center?.player.handle;
    default:
      return undefined;
  }
}

function applyTransform(text: string, transform: TextSlotSpec['transform']): string {
  switch (transform) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return text.replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
    default:
      return text;
  }
}

/** Roles whose position carries meaning and must not be rearranged. */
const ANCHORED_ROLES: ReadonlySet<TextRole> = new Set(['vs', 'left-name', 'right-name', 'left-team', 'right-team']);

/**
 * The text-arrangement variant axis.
 *
 * Only free-floating copy moves. A `left-name` label belongs to the player under
 * it and a `vs` mark belongs between them — shuffling those would not be a
 * variant, it would be a bug.
 */
export function arrangeTextRect(
  rect: PixelRect,
  role: TextRole,
  arrangement: VariantAxes['textArrangement'],
  canvas: { width: number; height: number },
): PixelRect {
  if (arrangement === 'template' || ANCHORED_ROLES.has(role)) return rect;

  const cx = rect.x + rect.w / 2;
  switch (arrangement) {
    case 'stacked':
      // Narrower and taller: forces more lines, which reads as a poster block.
      return clampToCanvas({ x: Math.round(cx - rect.w * 0.34), y: rect.y, w: Math.round(rect.w * 0.68), h: Math.round(rect.h * 1.25) }, canvas);
    case 'offset':
      // Pushed off-centre toward the frame edge nearest the slot.
      return clampToCanvas({ x: Math.round(rect.x + rect.w * (cx < canvas.width / 2 ? -0.12 : 0.12)), y: Math.round(rect.y + rect.h * 0.06), w: rect.w, h: rect.h }, canvas);
    case 'banner':
      // Full-bleed band: maximum size, minimum subtlety.
      return clampToCanvas({ x: Math.round(canvas.width * 0.04), y: rect.y, w: Math.round(canvas.width * 0.92), h: Math.round(rect.h * 0.8) }, canvas);
    case 'split':
      return clampToCanvas({ x: cx < canvas.width / 2 ? rect.x : Math.round(rect.x + rect.w * 0.5), y: rect.y, w: Math.round(rect.w * 0.5), h: rect.h }, canvas);
    default:
      return rect;
  }
}

function clampToCanvas(rect: PixelRect, canvas: { width: number; height: number }): PixelRect {
  const w = Math.min(rect.w, canvas.width);
  const h = Math.min(rect.h, canvas.height);
  return {
    x: Math.max(0, Math.min(rect.x, canvas.width - w)),
    y: Math.max(0, Math.min(rect.y, canvas.height - h)),
    w,
    h,
  };
}

function alignFor(role: TextRole, arrangement: VariantAxes['textArrangement']): 'left' | 'center' | 'right' {
  if (role === 'left-name' || role === 'left-team') return 'left';
  if (role === 'right-name' || role === 'right-team') return 'right';
  if (arrangement === 'offset' || arrangement === 'split') return 'left';
  return 'center';
}

/**
 * Approximate colour behind a text rect.
 *
 * The compiler knows the backdrop is a horizontal blend of the two team colours
 * over the dark base, so it can predict what sits behind a rect without
 * rasterising anything. QA measures the real thing on the finished pixels; this
 * is what the *type* colour is chosen against, one step earlier.
 */
export function backdropColorBehind(rect: PixelRect, palette: ResolvedPalette, canvas: { width: number; height: number }): string {
  const cx = (rect.x + rect.w / 2) / Math.max(1, canvas.width);
  const cy = (rect.y + rect.h / 2) / Math.max(1, canvas.height);
  const horizontal = mix(palette.left, palette.right, Math.max(0, Math.min(1, cx)));
  const overDark = mix(palette.dark, horizontal, 0.32);
  // The floor gradient darkens the lower half.
  return cy > 0.55 ? shade(overDark, -0.05) : overDark;
}

function textColorFor(role: TextRole, palette: ResolvedPalette, behind: string): string {
  if (role === 'left-name' || role === 'left-team') return readableOn(behind, palette.light, palette.dark);
  if (role === 'right-name' || role === 'right-team') return readableOn(behind, palette.light, palette.dark);
  if (role === 'kicker' || role === 'badge' || role === 'stat' || role === 'rank') return palette.accent;
  return readableOn(behind, palette.light, palette.dark);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Rebuild the buffer map a plan's `{type:'buffer'}` layers refer to. */
export function collectBuffers(
  plan: RenderPlan,
  sources: { subjects: PreparedSubject[]; backplate?: Buffer; logos?: Record<string, Buffer> },
): Record<string, Buffer> {
  const refs = (plan.meta['buffers'] as BufferRef[] | undefined) ?? [];
  const out: Record<string, Buffer> = {};
  for (const ref of refs) {
    if (ref.kind === 'subject') {
      const subject = sources.subjects.find((s) => String(s.index) === ref.ref);
      if (subject) out[ref.key] = subject.cutout;
    } else if (ref.kind === 'backplate') {
      if (sources.backplate) out[ref.key] = sources.backplate;
    } else if (ref.kind === 'logo') {
      const logo = sources.logos?.[ref.ref];
      if (logo) out[ref.key] = logo;
    }
  }
  return out;
}

export type { LayerSource };
