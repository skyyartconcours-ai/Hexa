/**
 * @hexa/vision — face detection, identity embeddings and subject segmentation.
 *
 * This package is what makes "Peyz vs Viper" mean Peyz and Viper. Reference
 * photos are segmented and composited here, and the finished render's face
 * region is embedded and compared back to the player's reference vectors. If
 * the cosine similarity falls under DEFAULT_IDENTITY_THRESHOLD, the render is
 * not the player and should be rejected.
 *
 * The heavy lifting lives in an OPTIONAL Python sidecar (services/vision). With
 * it running you get SCRFD detection, ArcFace embeddings, head pose and
 * alpha-matted cutouts. Without it, everything still runs on pure TypeScript
 * heuristics — except identity verification, which refuses to guess. See
 * `VisionClient.similarity` and the notes in fallback.ts.
 *
 *   const vision = new VisionClient();
 *   if (await vision.available()) { ...full quality... }
 *
 *   const refs   = await vision.embedBatch(player.assetPaths);
 *   const probe  = await vision.embed(renderedFaceCrop);
 *   const sim    = bestSimilarity(probe!.vector, refs.filter(Boolean).map(r => r!.vector));
 *   const gate   = identityVerdict(sim, DEFAULT_IDENTITY_THRESHOLD);
 *   if (!gate.pass) throw new HexaError('IDENTITY_GATE_FAILED', ...);
 */

export { VisionClient } from './client.js';
export {
  DEFAULT_IDENTITY_THRESHOLD,
  bestSimilarity,
  cosineSimilarity,
  identityVerdict,
  meanEmbedding,
} from './embedding.js';

export type {
  DetectedFace,
  FaceEmbedding,
  IdentityVerdict,
  ImageInput,
  SegmentOptions,
  VisionOptions,
} from './types.js';
