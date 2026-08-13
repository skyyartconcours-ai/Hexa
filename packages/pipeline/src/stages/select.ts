/**
 * Stage 2 — select.
 *
 * Pick the photograph that represents each subject.
 *
 * The rule that shapes this whole file: **an empty library is not an error.** A
 * new user has downloaded the tool and has no press photos yet; if that stops
 * the render, they never get to see what the tool does and never learn what
 * photographs to go and license. So a miss synthesises a schematic placeholder
 * and records a warning, and everything downstream keeps working.
 *
 * The other job here is producing *runners-up*. When the identity gate rejects a
 * render, the retry needs the next-best photograph of that player, and asking
 * the library again after the fact would just return the same winner.
 */

import { HexaError } from '@hexa/core';
import type { AspectPreset, AssetKind, AssetQuery, Player, ReferenceAsset, Team } from '@hexa/core';
import { bestAsset, generatePlaceholder, rankedAssets } from '../adapters/assets.js';
import type { AssetLibrary } from '../adapters/contracts.js';
import { imageSize } from '../image.js';

export interface SelectOptions {
  library: AssetLibrary;
  player: Player;
  team: Team;
  side: 'left' | 'right' | 'center';
  accent: string;
  aspect: AspectPreset;
  canvas: { width: number; height: number };
  /** Explicit asset id from the request — an override, so a miss is fatal. */
  assetId?: string;
  /** Publish-grade renders refuse uncleared licences. */
  requireCleared?: boolean;
}

export interface SelectedAsset {
  asset: ReferenceAsset;
  /** Ranked runners-up for the identity-failure retry, best first. */
  alternates: ReferenceAsset[];
  /** True when `asset` is a synthesised silhouette rather than a photograph. */
  placeholder: boolean;
  /** Bytes, only for placeholders — they exist nowhere on disk. */
  buffer?: Buffer;
  warnings: string[];
}

/**
 * Kinds worth compositing as a subject, best-suited first.
 *
 * Portraits and jersey shots crop to a bust cleanly; action and celebration
 * shots bring energy but often crop badly; full-body is last because it needs a
 * layout designed for it. Logos and backplates carry no face and are excluded.
 */
const SUBJECT_KINDS: readonly AssetKind[] = ['portrait', 'jersey', 'action', 'celebration', 'fullbody'];

/**
 * Which way we want the subject to look.
 *
 * A left-hand subject should look *right*, into the frame and at their opponent.
 * Looking out of the frame reads as disengagement — it is the single most common
 * amateur composite mistake. The library may satisfy this by mirroring a cutout,
 * which is why this is a preference passed to the query rather than a filter.
 */
function preferredFacing(side: 'left' | 'right' | 'center'): AssetQuery['facing'] {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return 'any';
}

export function buildQuery(opts: SelectOptions): AssetQuery {
  return {
    playerId: opts.player.id,
    kind: [...SUBJECT_KINDS],
    facing: preferredFacing(opts.side),
    requireCleared: opts.requireCleared ?? false,
    weights: {
      // A thumbnail is judged at 210×118. Face area dominates because a face
      // that survives that downscale is the whole game; sharpness matters next
      // because upscaling a soft crop looks like a mistake, not a style.
      faceArea: 1.4,
      sharpness: 1.1,
      frontality: 0.8,
      recency: 0.6,
    },
  };
}

export async function selectAsset(opts: SelectOptions): Promise<SelectedAsset> {
  const warnings: string[] = [];

  if (opts.assetId) {
    const explicit = opts.library.get(opts.assetId);
    if (!explicit) {
      throw new HexaError('ASSET_NOT_FOUND', `No asset with id "${opts.assetId}"`, {
        hint: `Run \`hexa assets list\` to see ids, or drop the override to let Hexa pick the best photo of ${opts.player.handle}.`,
        details: { assetId: opts.assetId, player: opts.player.handle },
      });
    }
    if (explicit.playerId && explicit.playerId !== opts.player.id) {
      warnings.push(
        `Asset ${explicit.id} belongs to ${explicit.playerId}, not ${opts.player.handle} — the identity gate will almost certainly reject it.`,
      );
    }
    return { asset: explicit, alternates: [], placeholder: false, warnings };
  }

  const query = buildQuery(opts);
  const ranked = await rankedAssets(opts.library, query);
  const winner = ranked[0] ?? (await bestAsset(opts.library, query));

  if (winner) {
    return { asset: winner, alternates: ranked.filter((a) => a.id !== winner.id), placeholder: false, warnings };
  }

  // Nothing suitable. Distinguish "no photos at all" from "photos exist but none
  // are cleared", because the fixes are completely different.
  const anyForPlayer = opts.library.find({ playerId: opts.player.id });
  if (opts.requireCleared && anyForPlayer.length > 0) {
    throw new HexaError('NO_CLEARED_ASSET', `No cleared photographs of ${opts.player.handle} (${anyForPlayer.length} uncleared on file)`, {
      hint: `Record the licence and clear them: \`hexa assets list --player ${opts.player.handle}\`, then tick provenance.cleared. Or drop --require-cleared for a draft render.`,
      details: { player: opts.player.handle, uncleared: anyForPlayer.length },
    });
  }

  warnings.push(
    anyForPlayer.length > 0
      ? `No usable photograph of ${opts.player.handle} (${anyForPlayer.length} on file, none matched) — using a placeholder silhouette.`
      : `No photographs of ${opts.player.handle} in the asset library — using a placeholder silhouette. ` +
          `Add some with: hexa assets ingest <dir> --player ${opts.player.handle} --license press-kit --source "..."`,
  );

  return placeholderFor(opts, warnings);
}

/**
 * Synthesise a stand-in.
 *
 * The placeholder is deliberately schematic — a silhouette, not a face. Hexa
 * never depicts an invented person, so a missing photograph produces something
 * that is obviously a gap rather than something that looks like a bad guess at
 * what the player looks like (docs/IDENTITY.md).
 */
async function placeholderFor(opts: SelectOptions, warnings: string[]): Promise<SelectedAsset> {
  const height = Math.round(opts.canvas.height * 0.9);
  const width = Math.round(height * 0.72);
  const buffer = await generatePlaceholder({
    width,
    height,
    // 'portrait' is the head-and-shoulders silhouette family — the shape a
    // versus bust slot expects where a real photograph would have gone.
    kind: 'portrait',
    label: opts.player.handle,
    accent: opts.accent,
    seed: hashOf(opts.player.id),
  });

  const size = (await imageSize(buffer)) ?? { width, height };
  const asset: ReferenceAsset = {
    id: `placeholder:${opts.player.id}`,
    playerId: opts.player.id,
    teamId: opts.team.id,
    kind: 'portrait',
    // Never resolved against the library root — the bytes travel with the
    // subject. The scheme makes an accidental filesystem read fail loudly.
    path: `placeholder://${opts.player.id}.png`,
    metrics: {
      width: size.width,
      height: size.height,
      sharpness: 0,
      brightness: 0,
      contrast: 0,
      quality: 0,
    },
    provenance: {
      source: 'Hexa generated placeholder',
      license: 'owned',
      addedAt: new Date(0).toISOString(),
      cleared: true,
      notes: 'Schematic silhouette generated by Hexa. Depicts no person and carries no likeness. Replace with a licensed photograph before publishing.',
    },
    tags: ['placeholder', 'synthetic'],
  };

  return { asset, alternates: [], placeholder: true, buffer, warnings };
}

function hashOf(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
