/**
 * Template domain — a template is the marriage of a LayoutSpec (geometry),
 * a StyleSpec (light, colour, atmosphere) and a text schema. Templates are
 * data-first: a template author writes a declarative object, not a render
 * routine, so templates stay diffable, testable and remixable.
 */

import type { LayoutSpec } from './layout.js';
import type { GradeSpec, LayerEffects } from './render.js';
import type { SubjectRef } from './identity.js';

export type TemplateCategory =
  | 'versus'        // 1v1 head-to-head, the Kaydreal signature
  | 'team-versus'   // 5v5 lineups
  | 'hero'          // single subject portrait
  | 'roster'        // roster reveal / transfer window
  | 'tierlist'      // ranking grids
  | 'analysis'      // breakdown / coaching, callout arrows
  | 'drama'         // reaction, controversy, big-text
  | 'stat'          // record, milestone, numbers-forward
  | 'tournament'    // bracket, preview, schedule
  | 'celebration'   // trophy, championship
  | 'shorts'        // vertical formats
  | 'stream'        // podcast, watchparty, live
  | 'draft'         // pick & ban, champion pool
  | 'mvp';          // player of the game cards

export type AspectPreset =
  | 'youtube'       // 1280×720
  | 'youtube-hd'    // 1920×1080
  | 'shorts'        // 1080×1920
  | 'twitch'        // 1920×1080
  | 'square'        // 1080×1080
  | 'twitter'       // 1600×900
  | 'banner';       // 2560×1440

/** Named light rigs. Lighting is what makes a composite read as cinematic. */
export type LightRig =
  | 'split-rim'      // opposing coloured rims, classic versus
  | 'top-key'        // dramatic overhead key, deep eye shadows
  | 'under-glow'     // uplight, menacing
  | 'backlit'        // subject nearly silhouetted against a bright plate
  | 'stage'          // arena spotlights with visible cones
  | 'neon-wash'      // flat neon fill, cyberpunk
  | 'god-rays'       // volumetric shafts from behind
  | 'ember'          // warm particulate, embers drifting
  | 'clean';         // minimal, product-shot neutrality

export interface AtmosphereSpec {
  /** Volumetric haze density 0–1 — the single biggest "cinematic" lever. */
  haze?: number;
  /** Particle system: floating dust, embers, sparks, shattered glass. */
  particles?: {
    kind: 'dust' | 'ember' | 'spark' | 'shard' | 'snow' | 'confetti' | 'smoke';
    density: number;
    color?: string;
    /** Bias particles toward this side to reinforce the light direction. */
    bias?: 'left' | 'right' | 'center' | 'none';
  };
  /** Ground fog height as a fraction of canvas height. */
  fog?: number;
  /** Visible light shafts. */
  rays?: { angle: number; count: number; intensity: number; color: string };
  /** Speed/energy streaks behind the subject. */
  speedLines?: { angle: number; density: number; color: string };
}

export interface StyleSpec {
  lightRig: LightRig;
  grade: GradeSpec;
  atmosphere?: AtmosphereSpec;
  /** Effects applied to every subject layer unless overridden per-slot. */
  subjectEffects?: LayerEffects;
  /** How strongly team colours drive the palette, 0–1. */
  brandStrength?: number;
  /** Background treatment when no AI backplate is supplied. */
  backdrop?: 'gradient' | 'radial' | 'arena' | 'abstract' | 'shatter' | 'grid' | 'solid' | 'ai';
}

export type TextRole =
  | 'headline' | 'subhead' | 'kicker' | 'vs' | 'left-name' | 'right-name'
  | 'left-team' | 'right-team' | 'badge' | 'stat' | 'caption' | 'rank' | 'date';

export interface TextSlotSpec {
  role: TextRole;
  slotId: string;
  /** Fallback copy when the caller does not supply this role. */
  defaultText?: string;
  required: boolean;
  maxChars?: number;
  /** Force casing — esports headlines are overwhelmingly uppercase. */
  transform?: 'upper' | 'lower' | 'title' | 'none';
}

export interface TemplateContext {
  subjects: SubjectRef[];
  text: Partial<Record<TextRole, string>>;
  aspect: AspectPreset;
  seed: number;
  /** Resolved palette after brand blending. */
  palette: {
    left: string;
    right: string;
    accent: string;
    dark: string;
    light: string;
  };
}

export interface ThumbnailTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  /** Aspects this template is designed to support. */
  aspects: AspectPreset[];
  /** Subject count bounds. A versus template is {min:2,max:2}. */
  subjects: { min: number; max: number };
  /** Static layout, or a function of context for adaptive templates. */
  layout: LayoutSpec | ((ctx: TemplateContext) => LayoutSpec);
  style: StyleSpec | ((ctx: TemplateContext) => StyleSpec);
  textSlots: TextSlotSpec[];
  tags: string[];
  /** Author-facing note on when this template is the right pick. */
  whenToUse?: string;
}
