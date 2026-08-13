/**
 * Safe-zone gate — keep the important marks out of the regions the platform
 * paints over.
 *
 * The template declares its own zones (`plan.meta.safeZones`, straight from the
 * LayoutSpec). When it declares none we still check YouTube's own furniture —
 * duration pill, progress bar, hover buttons — but only ever as warnings, since
 * the template never opted in.
 */

import { overlapRatio } from '@hexa/core';
import type { QaFinding, QaSeverity, Rect } from '@hexa/core';
import type { Gate, GateContext } from '../types.js';
import { clamp01, collectMarkRects, collectSafeZones, collectTextRects, toNormRect } from '../geom.js';

/** Fraction of the smaller rect that must overlap before we complain. A couple
 *  of stray pixels of a glow are not a violation. */
const MIN_OVERLAP = 0.1;

export const safeZoneGate: Gate = {
  id: 'safe-zone',
  weight: 1,
  description: 'Text, badges and logos stay clear of the plan\'s declared safe zones (and of YouTube\'s own overlays)',

  async run(ctx: GateContext): Promise<QaFinding[]> {
    const { zones, declared } = collectSafeZones(ctx.plan);
    const elements = [
      ...collectTextRects(ctx).map((t) => ({ kind: 'text', name: t.role, rect: t.rect })),
      ...collectMarkRects(ctx.plan).map((m) => ({ kind: 'mark', name: m.role, rect: m.rect })),
    ];

    if (elements.length === 0) {
      return [{ gate: 'safe-zone', severity: 'pass', message: 'No text, badge or logo layers to keep out of the safe zones', score: 1 }];
    }

    const enforce = ctx.request?.safeZones !== false;
    const findings: QaFinding[] = [];
    let violations = 0;

    for (const zone of zones) {
      for (const el of elements) {
        const rect: Rect = toNormRect(el.rect, ctx.width, ctx.height);
        const overlap = overlapRatio(rect, zone.rect);
        if (overlap < MIN_OVERLAP) continue;
        violations++;

        const hard = zone.severity === 'hard' && declared && enforce;
        const severity: QaSeverity = hard ? 'fail' : 'warn';
        findings.push({
          gate: 'safe-zone',
          severity,
          message: `${el.kind === 'text' ? 'Text' : 'Mark'} "${el.name}" intrudes ${(overlap * 100).toFixed(0)}% into ${zone.severity} safe zone "${zone.id}" — ${zone.reason}`,
          score: clamp01(1 - overlap) * (hard ? 0.4 : 0.7),
          where: rect,
          suggestion: hard
            ? `Move "${el.name}" out of ${zone.id}; this zone is declared hard, which means the layout author considered it unusable.`
            : `Nudge "${el.name}" clear of ${zone.id} if you can — it will be partly covered in the feed.`,
        });
      }
    }

    if (violations === 0) {
      findings.push({
        gate: 'safe-zone',
        severity: 'pass',
        message: declared
          ? `All ${elements.length} placed element${elements.length === 1 ? '' : 's'} clear of ${zones.length} declared safe zone${zones.length === 1 ? '' : 's'}`
          : `No safe zones declared in the plan; checked against YouTube's default overlays instead and found no intrusions`,
        score: 1,
      });
    } else if (!declared) {
      findings.push({
        gate: 'safe-zone',
        severity: 'warn',
        message: 'This plan declares no safe zones, so only YouTube\'s default overlay regions were checked',
        score: 0.8,
        suggestion: 'Give the template a LayoutSpec.safeZones list and copy it into plan.meta.safeZones so violations can be enforced rather than guessed at.',
      });
    }

    return findings;
  },
};
