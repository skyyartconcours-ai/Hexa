/**
 * Subject preparation — stages 1–4 per subject, in order.
 *
 * resolve (who) → select (which photograph) → cutout (matte it) → detect (find
 * the face). The result is a `PreparedSubject`: everything the compiler needs to
 * place a person, with no further I/O required.
 *
 * Subjects are prepared concurrently. Each one is an independent chain of a
 * roster lookup, a disk read and a sidecar round-trip, and a 5v5 lineup would
 * otherwise serialise ten segmentations back to back.
 */

import { HexaError, isHexaError } from '@hexa/core';
import type { AspectPreset, SubjectRequest } from '@hexa/core';
import { resolvePlayer, teamOfPlayer } from '../adapters/data.js';
import { alphaContentBox } from '../adapters/layout.js';
import { canvasFor } from '../adapters/templates.js';
import { imageSize } from '../image.js';
import type { PipelineDeps, PreparedSubject } from '../types.js';
import { cutoutSubject } from './cutout.js';
import { detectFace } from './detect.js';
import { selectAsset } from './select.js';

export interface PrepareOptions {
  aspect: AspectPreset;
  /** Publish-grade: refuse uncleared licences instead of warning. */
  requireCleared?: boolean;
  /** Crop to head-and-shoulders. Versus layouts want this; hero shots may not. */
  bust?: boolean;
  /** Skip the cutout cache — a forced re-cut. */
  noCache?: boolean;
  /** Max subjects prepared at once. The sidecar serialises inference anyway. */
  concurrency?: number;
}

export async function prepareSubjects(
  reqs: SubjectRequest[],
  deps: PipelineDeps,
  opts: PrepareOptions,
): Promise<PreparedSubject[]> {
  if (reqs.length === 0) return [];

  const canvas = await canvasFor(opts.aspect);
  const limit = Math.max(1, Math.min(opts.concurrency ?? 4, reqs.length));

  const prepared: PreparedSubject[] = new Array(reqs.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= reqs.length) return;
      const req = reqs[index]!;
      prepared[index] = await prepareOne(req, index, reqs.length, deps, opts, canvas);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return prepared;
}

async function prepareOne(
  req: SubjectRequest,
  index: number,
  total: number,
  deps: PipelineDeps,
  opts: PrepareOptions,
  canvas: { width: number; height: number },
): Promise<PreparedSubject> {
  const log = deps.logger.child(`subject:${index}`);
  const warnings: string[] = [];

  const player = await resolvePlayer(req.player);
  const team = await teamOfPlayer(player);
  const side = req.side ?? defaultSide(index, total);

  // Precedence: an explicit request colour, then the player's personal accent
  // (the colour they are the face of), then their team's primary.
  const accent = req.accent ?? player.accentColor ?? team.colors.primary;

  const selected = await selectAsset({
    library: deps.library,
    player,
    team,
    side,
    accent,
    aspect: opts.aspect,
    canvas,
    assetId: req.assetId,
    requireCleared: opts.requireCleared,
  });
  warnings.push(...selected.warnings);
  for (const w of selected.warnings) log.warn(w);

  const cut = await cutoutSubject({
    library: deps.library,
    vision: deps.vision,
    asset: selected.asset,
    placeholderBuffer: selected.buffer,
    cacheDir: deps.cacheDir,
    logger: log,
    bust: opts.bust ?? true,
    noCache: opts.noCache,
  });
  warnings.push(...cut.warnings);
  for (const w of cut.warnings) log.warn(w);

  const size = cut.size ?? (await imageSize(cut.buffer));
  const detected = await detectFace({
    vision: deps.vision,
    asset: selected.asset,
    cutout: cut.buffer,
    size,
    sameFramingAsOriginal: cut.sameFramingAsOriginal,
    logger: log,
  });
  warnings.push(...detected.warnings);
  for (const w of detected.warnings) log.warn(w);

  // Alpha bounds let the compiler sit the subject on the composition's floor
  // instead of on the transparent edge of their bounding box — the difference
  // between a person standing in a scene and a sticker floating in it.
  const contentBox = cut.matted ? await alphaContentBox(cut.buffer) : undefined;

  log.debug('subject prepared', {
    player: player.handle,
    asset: selected.asset.id,
    cutout: cut.source,
    face: detected.source,
    facing: detected.facing,
  });

  return {
    player,
    team,
    asset: selected.asset,
    cutout: cut.buffer,
    faceBox: detected.faceBox,
    landmarks: detected.landmarks,
    side,
    accent,
    index,
    size,
    contentBox,
    placeholder: selected.placeholder,
    facing: detected.facing,
    yaw: detected.yaw,
    alternates: selected.alternates,
    anonymous: req.anonymous ?? false,
    warnings,
  };
}

/** Two subjects with no stated side are a versus: first left, second right. */
function defaultSide(index: number, total: number): 'left' | 'right' | 'center' {
  if (total === 1) return 'center';
  if (total === 2) return index === 0 ? 'left' : 'right';
  return index < total / 2 ? 'left' : 'right';
}

/**
 * Swap in a different photograph for one subject, re-running cutout and detect.
 * This is the identity-failure retry: same person, same layout, different
 * reference — which is exactly the remedy when a face fails verification.
 */
export async function reprepareWithAsset(
  subject: PreparedSubject,
  assetId: string,
  deps: PipelineDeps,
  opts: PrepareOptions,
): Promise<PreparedSubject> {
  const replacement = subject.alternates?.find((a) => a.id === assetId) ?? deps.library.get(assetId);
  if (!replacement) {
    throw new HexaError('ASSET_NOT_FOUND', `No alternate asset "${assetId}" for ${subject.player.handle}`, {
      hint: `Add more reference photographs: hexa assets ingest <dir> --player ${subject.player.handle}`,
      details: { assetId, player: subject.player.handle },
    });
  }

  const log = deps.logger.child(`subject:${subject.index}:retry`);
  const cut = await cutoutSubject({
    library: deps.library,
    vision: deps.vision,
    asset: replacement,
    cacheDir: deps.cacheDir,
    logger: log,
    bust: opts.bust ?? true,
  });
  const size = cut.size ?? (await imageSize(cut.buffer));
  const detected = await detectFace({
    vision: deps.vision,
    asset: replacement,
    cutout: cut.buffer,
    size,
    sameFramingAsOriginal: cut.sameFramingAsOriginal,
    logger: log,
  });

  return {
    ...subject,
    asset: replacement,
    cutout: cut.buffer,
    size,
    contentBox: cut.matted ? await alphaContentBox(cut.buffer) : undefined,
    faceBox: detected.faceBox,
    landmarks: detected.landmarks,
    facing: detected.facing,
    yaw: detected.yaw,
    placeholder: false,
    alternates: (subject.alternates ?? []).filter((a) => a.id !== assetId),
    warnings: [...(subject.warnings ?? []), ...cut.warnings, ...detected.warnings],
  };
}

/** True when the failure is worth surfacing rather than retrying past. */
export function isFatalPrepareError(e: unknown): boolean {
  return isHexaError(e) && (e.code === 'PLAYER_NOT_FOUND' || e.code === 'TEAM_NOT_FOUND' || e.code === 'NO_CLEARED_ASSET');
}
