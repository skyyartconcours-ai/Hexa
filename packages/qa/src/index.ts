/**
 * @hexa/qa — the gates that let Hexa promise quality instead of hoping for it.
 *
 * Every rendered thumbnail is run through a set of gates that can veto it. The
 * headline gate is identity: if the face in the output does not match the real
 * player's reference embeddings, the render is rejected, full stop. The rest
 * encode the craft rules that separate a professional thumbnail from a
 * mediocre one — above all legibility at the size YouTube actually displays,
 * which is as small as 168×94 in a sidebar and smaller still in a phone's
 * peripheral vision.
 *
 * Two principles run through the whole package:
 *
 *   • "Unchecked" is never reported as "fine". A missing embedder, a crashed
 *     gate or an absent face rect produces a warning that says what was not
 *     verified and how to enable it.
 *   • Findings carry a remedy. A gate that tells you a number without telling
 *     you what to change has moved the work, not done it.
 *
 * Typical use:
 *
 *   const report = await runGates({ image, plan, width, height, subjects, textRects, request, vision });
 *   if (!report.passed) console.error(summarise(report));
 *   const proof = await proofSheet(image);          // eyeball it small
 *   const best  = pickBest(variants);               // heuristic ranking
 */

// ── contracts ────────────────────────────────────────────────────────────────
export type {
  AppealContext,
  Gate,
  GateContext,
  GateSubject,
  GateTextRect,
  QaRect,
  VisionPort,
} from './types.js';

// ── registry + runner ────────────────────────────────────────────────────────
export { GATES, registerGate, runGates } from './registry.js';

// ── reporting ────────────────────────────────────────────────────────────────
export { formatFindings, summarise } from './format.js';

// ── individual gates, exported for direct use and testing ───────────────────
export { identityGate, DEFAULT_IDENTITY_THRESHOLD, cosine } from './gates/identity.js';
export { legibilityGate } from './gates/legibility.js';
export { contrastGate } from './gates/contrast.js';
export { safeZoneGate } from './gates/safeZone.js';
export { facePlacementGate } from './gates/facePlacement.js';
export { clutterGate } from './gates/clutter.js';
export { colorHarmonyGate } from './gates/colorHarmony.js';
export { licenseGate } from './gates/license.js';
export { bandingGate } from './gates/banding.js';
export { duplicateGate } from './gates/duplicate.js';

// ── appeal ranking (a heuristic — read the docstring in ./appeal.ts) ─────────
export { APPEAL_WEIGHTS, combinedScore, pickBest, rankVariants, scoreAppeal } from './appeal.js';
export type { AppealResult } from './appeal.js';

// ── small-size simulation ────────────────────────────────────────────────────
export { YOUTUBE_DISPLAY_SIZES, proofSheet, simulateSizes } from './sizes.js';
export type { DisplaySize, SimulatedSize } from './sizes.js';

// ── perceptual hashing (variant de-duplication) ─────────────────────────────
export { DUPLICATE_DISTANCE, dHash, hamming } from './hash.js';
