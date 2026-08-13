/**
 * The generative contract.
 *
 * Hexa splits image synthesis into two disjoint jobs, and this file is where
 * that split becomes a type. Photographs supply identity; generative models
 * supply environment, atmosphere and light. A provider may therefore paint an
 * arena, an energy field or a dusk skyline (`generateBackplate`), and it may
 * *edit around* a face that a photograph already established
 * (`identityGuidedEdit`) — but nothing in this interface accepts "draw me a
 * person" as a legitimate request. `guard.ts` enforces that at runtime.
 */

/** Named looks the prompt builder and the offline painter both understand. */
export type BackplateStyle =
  | 'arena'
  | 'abstract'
  | 'cyber'
  | 'ruins'
  | 'void'
  | 'nature'
  | 'studio'
  | 'stadium-crowd'
  | 'energy'
  | 'shattered-glass'
  | 'smoke'
  | 'neon-city';

export const BACKPLATE_STYLES: readonly BackplateStyle[] = [
  'arena', 'abstract', 'cyber', 'ruins', 'void', 'nature',
  'studio', 'stadium-crowd', 'energy', 'shattered-glass', 'smoke', 'neon-city',
] as const;

export function isBackplateStyle(v: string): v is BackplateStyle {
  return (BACKPLATE_STYLES as readonly string[]).includes(v);
}

export interface ProviderCapabilities {
  /** Can synthesise a background plate from a prompt. */
  backplate: boolean;
  /** Can edit a photograph while preserving the photographed face. */
  identityGuidedEdit: boolean;
  /** Can fill a masked region. */
  inpaint: boolean;
  /** Can enlarge without the mush. */
  upscale: boolean;
  /** Largest plate the provider will return; requests above this are downscaled or clamped. */
  maxSize: { width: number; height: number };
}

export interface BackplateRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  style?: BackplateStyle;
  /** Hex colours (`#RRGGBB`) the plate should be built from — usually team brand colours. */
  palette?: string[];
  /** 0–1. How far from a neutral plate the provider may stray, where supported. */
  strength?: number;
}

export interface IdentityEditRequest {
  image: Buffer;
  prompt: string;
  mask?: Buffer;
  strength: number;
  seed?: number;
  /** Regions that must not be altered — the face. */
  preserve?: { x: number; y: number; w: number; h: number }[];
}

export interface InpaintRequest {
  image: Buffer;
  mask: Buffer;
  prompt: string;
  seed?: number;
}

export interface UpscaleRequest {
  image: Buffer;
  factor: 2 | 4;
}

export interface GeneratedImage {
  buffer: Buffer;
  width: number;
  height: number;
  provider: string;
  model: string;
  seed?: number;
  /** Estimated USD cost of the call, when the provider publishes a per-image rate. */
  cost?: number;
  promptUsed: string;
  /** Some providers rewrite the prompt before sampling; keep it for the render plan. */
  revisedPrompt?: string;
  /**
   * True when a generative model has touched pixels containing a face, so these
   * bytes carry an identity claim nothing has checked yet.
   *
   * `guardIdentityEdit` caps `strength` and requires the face to be protected by
   * `preserve` and by the mask, but a capped edit is a *bound on the risk*, not
   * a guarantee about the result: no strength setting makes a diffusion model
   * promise the jawline survived. The only thing that settles it is embedding
   * the output and comparing it to the reference gallery — `@hexa/qa`'s
   * identityGate. This flag exists so a caller cannot mistake "the edit was
   * allowed" for "the person is still the person".
   */
  requiresIdentityVerification?: boolean;
}

export interface ImageProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  /**
   * True when the provider paints locally from deterministic code rather than
   * calling a billed, latent remote service.
   *
   * The response cache exists to avoid paying twice for the same network call.
   * A local painter has nothing to save — and caching it is actively harmful,
   * because the key hashes the *request*, not the code that served it, so an
   * improvement to the painter would keep returning the old pixels until
   * someone thought to clear the cache by hand.
   */
  readonly local?: boolean;
  isConfigured(): boolean;
  generateBackplate(req: BackplateRequest): Promise<GeneratedImage>;
  identityGuidedEdit?(req: IdentityEditRequest): Promise<GeneratedImage>;
  inpaint?(req: InpaintRequest): Promise<GeneratedImage>;
  upscale?(req: UpscaleRequest): Promise<GeneratedImage>;
}

/** Shape returned by `providerStatus()`, backing the `hexa providers` command. */
export interface ProviderStatus {
  id: string;
  configured: boolean;
  capabilities: ProviderCapabilities;
  /** Env var that would configure this provider, when it needs one. */
  envVar?: string;
  /** Human-readable note for the CLI — why it is unavailable, or what it does. */
  note?: string;
}
