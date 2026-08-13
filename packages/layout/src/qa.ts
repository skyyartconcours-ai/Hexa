/**
 * Safe-zone gate.
 *
 * Platform chrome is painted ON TOP of the thumbnail, so anything underneath it
 * is simply gone. This gate is cheap, deterministic and catches the failure
 * nobody notices until the video is live.
 */

import type { PixelRect, QaFinding } from '@hexa/core';
import { intersect, normaliseRect, rectArea } from '@hexa/core';
import type { ResolvedLayout } from './resolve.js';

/** A zone counts as violated once this much of it is covered. */
const ZONE_COVERAGE_LIMIT = 0.06;
/** …or once this much of the intruding element sits inside it. */
const OCCUPANT_COVERAGE_LIMIT = 0.25;

export interface OccupiedRect {
  id: string;
  rect: PixelRect;
}

/**
 * Report every occupied rect that intrudes into a safe zone.
 *
 * An empty array means clean. Findings are 'fail' for hard zones and 'warn' for
 * soft ones, and every finding carries the cheapest escape move we can compute.
 */
export function checkSafeZones(layout: ResolvedLayout, occupied: OccupiedRect[]): QaFinding[] {
  const findings: QaFinding[] = [];
  const { width, height } = layout.canvas;

  for (const { zone, rect: zoneRect } of layout.safeZones) {
    const zoneArea = rectArea(zoneRect);
    for (const occ of occupied) {
      const hit = intersect(occ.rect, zoneRect);
      if (!hit) continue;
      const hitArea = rectArea(hit);
      const zoneCoverage = zoneArea > 0 ? hitArea / zoneArea : 0;
      const occArea = rectArea(occ.rect);
      const occCoverage = occArea > 0 ? hitArea / occArea : 0;
      if (zoneCoverage < ZONE_COVERAGE_LIMIT && occCoverage < OCCUPANT_COVERAGE_LIMIT) continue;

      const worst = Math.max(zoneCoverage, occCoverage);
      findings.push({
        gate: 'safe-zones',
        severity: zone.severity === 'hard' ? 'fail' : 'warn',
        message:
          `"${occ.id}" overlaps safe zone "${zone.id}" ` +
          `(${Math.round(occCoverage * 100)}% of the element, ${Math.round(zoneCoverage * 100)}% of the zone). ${zone.reason}`,
        score: Math.max(0, 1 - worst),
        where: normaliseRect(hit, width, height),
        suggestion: escapeHint(occ, hit, zoneRect),
      });
    }
  }
  return findings;
}

/** Cheapest translation that clears the zone, phrased as an instruction. */
function escapeHint(occ: OccupiedRect, hit: PixelRect, zone: PixelRect): string {
  const left = occ.rect.x + occ.rect.w - zone.x; // px to move left to clear
  const right = zone.x + zone.w - occ.rect.x;
  const up = occ.rect.y + occ.rect.h - zone.y;
  const down = zone.y + zone.h - occ.rect.y;
  const options: { dir: string; cost: number }[] = [
    { dir: 'left', cost: left },
    { dir: 'right', cost: right },
    { dir: 'up', cost: up },
    { dir: 'down', cost: down },
  ].filter((o) => o.cost > 0);
  options.sort((a, b) => a.cost - b.cost);
  const best = options[0];
  if (!best) return `Move "${occ.id}" out of the reserved region.`;
  return `Move "${occ.id}" ~${Math.ceil(best.cost)}px ${best.dir} (or shrink it by ${Math.ceil(Math.min(hit.w, hit.h))}px) to clear the zone.`;
}
