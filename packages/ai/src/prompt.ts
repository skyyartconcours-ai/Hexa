/**
 * Backplate prompt construction.
 *
 * A backplate is not "a cool background" — it is the *unoccupied* half of a
 * composition whose other half arrives later as a cut-out photograph. That
 * constraint drives everything here:
 *
 *   - The plate must have somewhere for the subject to stand. Every prompt
 *     carries explicit negative-space instructions (`COMPOSITION_RULES`), or
 *     the model helpfully fills the middle of the frame with detail and the
 *     compositor has nowhere to put anybody.
 *   - The plate must have a *stated* light direction, because the subject's
 *     rim light is chosen from the photograph and the two have to agree. A
 *     plate lit from the right behind a subject lit from the left reads as
 *     fake instantly, even to viewers who cannot say why.
 *   - The plate must be describable in photographic terms — focal length,
 *     aperture, colour temperature — because that is the vocabulary these
 *     models were trained on. "Cinematic" is a wish; "35mm, f/2.0, 5600K key
 *     with a 3200K practical" is an instruction.
 *   - The plate must contain no people. That belongs in both the positive and
 *     the negative prompt, and it is enforced separately in `guard.ts`.
 */

import { parseHex } from '@hexa/core';
import { assertNoPersonGeneration } from './guard.js';
import type { BackplateStyle } from './types.js';

/**
 * Terms suppressed on every backplate, no matter the style or provider.
 *
 * The first group is the identity rule made literal: no people means no people.
 * The second is the "AI slop" tell-list — mangled text, watermarks, stock-photo
 * furniture — which is what actually gets a thumbnail scrolled past. The third
 * is technical: artefacts that survive compositing and ruin the plate.
 */
export const NEGATIVE_BASE: string =
  // Identity rule — the whole reason this package has a guard.
  'people, person, human, humans, man, woman, crowd of faces, face, faces, facial features, ' +
  'portrait, headshot, character, characters, figure in frame, mascot, avatar, silhouette of a person, ' +
  'body parts, hands, limbs, ' +
  // Slop tells
  'text, lettering, typography, caption, subtitles, words, letters, numbers, signature, ' +
  'watermark, logo, brand mark, trademark, copyright notice, ui, hud, user interface, ' +
  'stock photo, clip art, meme, collage, frame, border, vignette overlay, ' +
  // Technical failures
  'blurry, out of focus subject, low resolution, jpeg artifacts, banding, posterisation, ' +
  'oversaturated, blown highlights, crushed blacks, flat lighting, muddy colours, ' +
  'cluttered centre, busy centre, distracting foreground clutter, tiling, seams, ' +
  'deformed geometry, extra objects, duplicated elements';

/**
 * Composition contract shared by every backplate.
 *
 * Exported because the QA gates and the studio overlay both need to know what
 * the plate was *asked* for before they can judge whether it delivered.
 */
export const COMPOSITION_RULES: string =
  'no people, no faces, no characters, empty scene, negative space in the centre-left and ' +
  'centre-right for subject placement, uncluttered mid-ground, strong depth separation between ' +
  'foreground and background, darker edges falling off toward the corners, brightest value just ' +
  'off-centre so a cut-out subject reads against it, horizon kept low in the frame, ' +
  'clean value structure that survives being scaled down to a 320-pixel-wide thumbnail';

/** Where the key light comes from, phrased for the model and for the compositor. */
export type LightDirection = 'left' | 'right' | 'back' | 'top';

const LIGHT_PHRASING: Record<LightDirection, string> = {
  left:
    'key light raking in from frame left at roughly 45 degrees, long soft shadows thrown to the right, ' +
    'cool fill on the right-hand side',
  right:
    'key light raking in from frame right at roughly 45 degrees, long soft shadows thrown to the left, ' +
    'cool fill on the left-hand side',
  back:
    'strong backlight behind the mid-ground throwing a bright halo forward, atmospheric haze catching ' +
    'the beam, near-silhouette separation at the horizon line',
  top:
    'hard top light from an overhead rig punching straight down, tight pools of light on the floor, ' +
    'deep falloff at standing height',
};

interface StyleRecipe {
  /** The scene itself. */
  scene: string;
  /** Lens, aperture, camera position. */
  optics: string;
  /** Volumetrics, particulate, weather. */
  atmosphere: string;
  /** Explicit foreground / mid-ground / background cues. */
  depth: string;
  /** Kelvin values and how the temperatures are mixed. */
  colourTemp: string;
  /** Surface and material notes that keep it from looking like a render. */
  materials: string;
}

const RECIPES: Record<BackplateStyle, StyleRecipe> = {
  arena: {
    scene:
      'an empty esports arena stage shot from the floor, dark tiered seating receding into blackness, ' +
      'a raised competition stage with a glossy reflective deck, LED ribbon boards running along the ' +
      'stage lip, an overhead lighting truss loaded with moving heads',
    optics:
      'shot on a 35mm lens at f/2.0 from chest height, slight upward tilt for scale, shallow depth of ' +
      'field falling off past the stage lip, anamorphic flare streaking horizontally from the rig',
    atmosphere:
      'heavy theatrical haze so every beam is a visible volumetric cone, fine dust drifting through ' +
      'the light, faint smoke pooling at deck level',
    depth:
      'foreground: the dark blurred stage lip; mid-ground: the lit deck and negative space where the ' +
      'subject will stand; background: seating and rig dissolving into deep shadow',
    colourTemp:
      '5600K white key from the truss against 3200K tungsten practicals in the seating, cool 7000K ' +
      'rim from the LED wall behind',
    materials:
      'brushed aluminium truss, matte black stage skirt, polished deck with wet-looking specular ' +
      'reflections, real optical bokeh in the far seating',
  },
  abstract: {
    scene:
      'a non-representational field of layered translucent forms — broad sweeping ribbons, soft ' +
      'gradient washes and thin geometric linework drifting through empty space',
    optics:
      'rendered as a macro plate on an 85mm lens at f/1.8, extreme shallow focus so only one ribbon ' +
      'band is sharp and everything else melts',
    atmosphere:
      'fine suspended particulate catching the light, gentle chromatic dispersion at the edges of ' +
      'each form, subtle film grain',
    depth:
      'foreground: heavily defocused colour wash; mid-ground: the one sharp ribbon; background: an ' +
      'even gradient void with no detail at all',
    colourTemp:
      'cool 7500K shadow side against a warm 3000K core, temperature split across the frame rather ' +
      'than blended',
    materials:
      'liquid glass and brushed metal surfaces, soft caustics, no hard edges anywhere except the ' +
      'single sharp band',
  },
  cyber: {
    scene:
      'a cavernous near-future server hall or data spire interior, endless racks glowing along their ' +
      'seams, cable runs overhead, a wet reflective floor grating, holographic readouts hanging in ' +
      'mid air well off to the sides',
    optics:
      'shot on a 24mm lens at f/2.8, low camera position for scale, strong one-point perspective ' +
      'running to a distant vanishing point',
    atmosphere:
      'cold volumetric fog, condensation in the air, thin drifting steam from floor vents, light ' +
      'bloom around every emissive seam',
    depth:
      'foreground: dark out-of-focus rack edges framing the shot; mid-ground: clean empty floor; ' +
      'background: a glowing corridor receding to a bright point',
    colourTemp:
      'dominant 9000K cyan emissives cut by a single 2200K amber warning strip, deliberate ' +
      'complementary tension',
    materials:
      'anodised metal, smoked acrylic, fibre-optic filaments, rain-slick floor with long specular ' +
      'streaks',
  },
  ruins: {
    scene:
      'a monumental ruined hall, collapsed stone columns and a torn-open ceiling, rubble scattered ' +
      'to the edges of the frame, shafts of daylight punching through the breach',
    optics:
      'shot on a 28mm lens at f/4 from ground level, slight wide-angle distortion at the frame ' +
      'edges, deep focus into the far arches',
    atmosphere:
      'thick dust hanging in every light shaft, floating ash, faint heat shimmer near the brightest ' +
      'patch of floor',
    depth:
      'foreground: dark rubble silhouettes; mid-ground: a swept clear floor in the light; ' +
      'background: broken arches fading into dusty haze',
    colourTemp:
      'warm 4200K daylight shafts against deep 8000K skylight fill in the shadows, strong warm-cool ' +
      'separation',
    materials:
      'weathered limestone, oxidised bronze fittings, cracked mosaic floor, moss creeping into the ' +
      'stone joints',
  },
  void: {
    scene:
      'an infinite dark void with a single soft luminous gradient at its core, distant drifting ' +
      'nebula banding, no ground plane and no horizon',
    optics:
      'shot on a 50mm lens at f/1.4, focus set at infinity, gentle lens breathing and a soft ' +
      'circular falloff',
    atmosphere:
      'faint starfield, drifting motes catching the core light, extremely low-frequency cloud noise',
    depth:
      'foreground: nothing but a few defocused motes; mid-ground: the luminous core; background: ' +
      'absolute black with the faintest colour bleed',
    colourTemp:
      'a 6500K neutral core bleeding to 9500K blue at the extremities, no warm light anywhere',
    materials:
      'pure light and vapour, no solid surfaces, smooth 10-bit gradients with zero banding',
  },
  nature: {
    scene:
      'a wide mountain valley at golden hour, a low ridgeline, mist gathered in the folds of the ' +
      'land, sparse silhouetted conifers at the frame edges, an open meadow floor',
    optics:
      'shot on a 70mm telephoto at f/4 with strong compression, distant ridges stacked into flat ' +
      'tonal planes',
    atmosphere:
      'layered valley mist separating each ridge, pollen and insects catching the low sun, gentle ' +
      'aerial perspective washing the far hills to pale blue',
    depth:
      'foreground: dark defocused grass heads; mid-ground: the open lit meadow; background: three ' +
      'or four stacked ridge silhouettes in progressively lighter values',
    colourTemp:
      '2700K low sun raking across the valley against 8500K open-shade fill in the mist, the classic ' +
      'golden-hour split',
    materials:
      'wet grass with specular highlights, rough bark silhouettes, real atmospheric scattering',
  },
  studio: {
    scene:
      'a clean seamless studio cyclorama sweep, an infinite curve with no visible corner, one large ' +
      'soft source and a pair of gridded accent lights, a subtle floor gradient',
    optics:
      'shot on an 85mm lens at f/5.6 from eye level, dead-flat perspective, edge-to-edge sharpness',
    atmosphere:
      'a whisper of haze to give the accent lights body, otherwise clean air',
    depth:
      'foreground: nothing; mid-ground: the lit sweep and its pool of light; background: the sweep ' +
      'falling off smoothly to near-black at the frame edges',
    colourTemp:
      '5600K neutral key with two coloured gels on the accents, controlled and deliberate',
    materials:
      'matte painted cyclorama, faint floor sheen, absolutely no texture noise or seams',
  },
  'stadium-crowd': {
    scene:
      'a packed stadium bowl seen from pitch level, tiers of out-of-focus seating rising steeply, ' +
      'thousands of tiny points of phone light scattered through the stands, banners hanging from ' +
      'the upper deck',
    optics:
      'shot on a 135mm telephoto at f/2.0, the entire crowd rendered as creamy circular bokeh, only ' +
      'the near barrier remotely sharp',
    atmosphere:
      'stadium haze lit from above, confetti drifting through the beams, floodlight flare across the ' +
      'top of the frame',
    depth:
      'foreground: dark blurred barrier; mid-ground: an empty lit strip of turf; background: the ' +
      'bokeh crowd wall, entirely abstract',
    colourTemp:
      '5000K floodlights above a warm 2900K sea of small crowd lights, temperature layered by depth',
    materials:
      'no recognisable detail in the stands at all — pure abstracted light points, deliberately too ' +
      'defocused to resolve anything',
  },
  energy: {
    scene:
      'a raw energy burst — arcs of plasma radiating from an off-centre core, sheets of light bending ' +
      'through space, crackling filaments spidering outward and dying at the frame edges',
    optics:
      'shot on a 50mm lens at f/2.8 with a long exposure, motion trails on the fastest arcs, heavy ' +
      'lens bloom around the core',
    atmosphere:
      'ionised particulate glowing along each arc, shockwave distortion rings, sparks trailing smoke',
    depth:
      'foreground: bright sparks streaking past the lens; mid-ground: the plasma core offset to one ' +
      'side; background: a deep dark field the energy reads against',
    colourTemp:
      'a blue-white 12000K core cooling to deep 4000K amber at the arc tips, a full temperature ramp ' +
      'along every filament',
    materials:
      'pure emissive plasma, no solid geometry, real bloom and diffraction rather than drawn glow',
  },
  'shattered-glass': {
    scene:
      'a plane of tempered glass caught mid-shatter, large angular shards fanning outward and ' +
      'tumbling, a spiderweb fracture pattern spreading from an impact point placed near a corner',
    optics:
      'shot on a 100mm macro at f/2.8, ultra-high shutter speed freezing every shard, razor-thin ' +
      'plane of focus on the nearest fragments',
    atmosphere:
      'glass dust glittering in the beam, faint smoke behind the plane, prismatic dispersion where ' +
      'light passes through the shard edges',
    depth:
      'foreground: two or three huge defocused shards; mid-ground: the fracture plane; background: ' +
      'a dark gradient seen through the gaps',
    colourTemp:
      'cool 7000K key catching the shard edges against a warm 3400K glow behind the plane',
    materials:
      'real tempered-glass fracture behaviour, refractive caustics, bright specular edges on every ' +
      'broken facet',
  },
  smoke: {
    scene:
      'dense volumetric smoke rolling through an otherwise empty dark space, thick billowing columns ' +
      'at the frame edges opening into a clear pocket at the centre',
    optics:
      'shot on a 50mm lens at f/2.0, focus on the near smoke wall, the far volume softening into ' +
      'flat tone',
    atmosphere:
      'the smoke itself is the subject — layered densities, curling vortices, thin wisps peeling off ' +
      'the main column',
    depth:
      'foreground: a dark smoke curtain framing the shot; mid-ground: the clear lit pocket; ' +
      'background: an impenetrable dark wall of vapour',
    colourTemp:
      'a 6000K side key defining the smoke edges against 2000K ember light glowing from below',
    materials:
      'physically plausible smoke scattering with soft self-shadowing, no cotton-wool clumping',
  },
  'neon-city': {
    scene:
      'a rain-soaked city street canyon at dusk seen from a low angle, towers receding on both sides, ' +
      'neon signage stacked up the facades, reflected light smeared across wet asphalt, the far end ' +
      'of the street opening onto a bright skyline',
    optics:
      'shot on a 35mm lens at f/1.8, low camera near the road surface, strong perspective convergence ' +
      'and heavy bokeh in the distant signage',
    atmosphere:
      'light rain streaking through every sign, steam rising from vents, thick evening haze diffusing ' +
      'the far towers into flat blue shapes',
    depth:
      'foreground: dark defocused street furniture at the edges; mid-ground: the empty wet road; ' +
      'background: the glowing skyline gap',
    colourTemp:
      'magenta and cyan neon at 8000K over a 2400K sodium street-lamp base, the two never mixing ' +
      'evenly',
    materials:
      'wet asphalt with long vertical specular smears, weathered concrete, glass tower facades ' +
      'catching the last of the sky',
  },
};

/** Rough perceptual name for a hex colour, so prompts read like a brief. */
export function describeColour(hex: string): string {
  let rgb: { r: number; g: number; b: number };
  try {
    rgb = parseHex(hex);
  } catch {
    return 'neutral grey';
  }
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (s < 0.12) {
    if (l < 0.12) return 'near-black';
    if (l < 0.35) return 'charcoal grey';
    if (l < 0.65) return 'neutral grey';
    if (l < 0.88) return 'silver grey';
    return 'paper white';
  }

  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;

  const HUES: ReadonlyArray<[number, string]> = [
    [12, 'red'], [26, 'vermilion'], [42, 'orange'], [56, 'amber'], [70, 'yellow'],
    [90, 'lime'], [150, 'green'], [175, 'teal'], [195, 'cyan'], [215, 'azure'],
    [250, 'blue'], [275, 'indigo'], [295, 'violet'], [320, 'magenta'], [345, 'crimson'],
    [360, 'red'],
  ];
  const hue = HUES.find(([edge]) => h < edge)?.[1] ?? 'red';

  const intensity =
    s > 0.85 && l > 0.4 && l < 0.7 ? 'electric ' :
    s > 0.65 ? 'vivid ' :
    s < 0.3 ? 'muted ' : '';
  const value = l < 0.25 ? 'deep ' : l > 0.78 ? 'pale ' : '';
  return `${value}${intensity}${hue}`.trim();
}

export interface BackplatePromptInput {
  style: BackplateStyle;
  /** Free-form emotional register: "tense", "triumphant", "ominous". */
  mood?: string;
  /** Hex colours the plate should be built from — usually team brand colours. */
  palette?: string[];
  lightDirection?: LightDirection;
  /** How many cut-out subjects the plate has to accommodate. */
  subjectCount?: number;
  /**
   * Anything the caller wants appended verbatim.
   *
   * Verbatim is the whole risk: this text lands after the composition contract
   * ("no people, no faces, no characters, empty scene"), which is exactly where
   * an injection wants to be — close to the end, contradicting what came
   * before. It is vetted on its own before it is appended, so the refusal names
   * the operator's text rather than the assembled paragraph they never wrote.
   */
  extra?: string;
}

/** Negative-space guidance tuned to how many subjects have to fit. */
function subjectSpace(count: number): string {
  if (count <= 1) {
    return 'reserve a clean, low-detail column through the centre-right third of the frame where a ' +
      'single cut-out subject will be placed, and keep the brightest background value directly ' +
      'behind that column so the subject separates';
  }
  if (count === 2) {
    return 'reserve two clean, low-detail columns — one in the centre-left third and one in the ' +
      'centre-right third — for two cut-out subjects facing each other, and keep the centre line ' +
      'itself darker so the two sides read as opposed';
  }
  return `reserve a clean, evenly lit horizontal band across the lower two-thirds of the frame wide ` +
    `enough for ${count} cut-out subjects standing side by side, with detail pushed to the top ` +
    `quarter and the extreme edges only`;
}

/**
 * Build a matched positive/negative prompt pair for a backplate.
 *
 * The output is intentionally long. These models weight specificity heavily,
 * and a short prompt is how you get the generic teal-and-orange plate that
 * every other thumbnail already uses.
 */
export function buildBackplatePrompt(input: BackplatePromptInput): {
  prompt: string;
  negativePrompt: string;
} {
  const recipe = RECIPES[input.style] ?? RECIPES.abstract;
  const light = LIGHT_PHRASING[input.lightDirection ?? 'left'];
  const count = Number.isFinite(input.subjectCount) ? Math.max(0, Math.trunc(input.subjectCount!)) : 1;

  const palette = (input.palette ?? []).filter((c) => typeof c === 'string' && c.trim() !== '');
  const names = palette.map(describeColour);
  const paletteClause =
    names.length === 0
      ? 'restrained two-colour palette with one dominant hue and one complementary accent'
      : names.length === 1
        ? `built around ${names[0]} as the dominant hue, with its complement used sparingly for accents`
        : `built around ${names[0]} and ${names[1]} as opposing dominants` +
          (names.length > 2 ? `, with ${names.slice(2).join(' and ')} reserved for small accents only` : '') +
          ', the two dominants kept on separate sides of the frame rather than blended into mud';

  // Caller-supplied text is vetted before it is folded in, not after: by the
  // time it is one paragraph among fourteen, a refusal cannot say which words
  // were the operator's.
  if (input.extra?.trim()) assertNoPersonGeneration(input.extra.trim());
  if (input.mood?.trim()) assertNoPersonGeneration(input.mood.trim());

  const moodClause = input.mood?.trim()
    ? `overall mood: ${input.mood.trim()}`
    : 'overall mood: high-stakes and cinematic without being melodramatic';

  const segments = [
    'Cinematic esports thumbnail backplate.',
    recipe.scene + '.',
    recipe.optics + '.',
    light + '.',
    recipe.colourTemp + '.',
    paletteClause + '.',
    recipe.atmosphere + '.',
    recipe.depth + '.',
    recipe.materials + '.',
    moodClause + '.',
    subjectSpace(count) + '.',
    COMPOSITION_RULES + '.',
    'photographic realism, physically plausible light transport, 16-bit colour depth, ' +
      'shot for compositing.',
  ];
  if (input.extra?.trim()) segments.push(input.extra.trim() + '.');

  return {
    prompt: segments.join(' ').replace(/\s+/g, ' ').trim(),
    negativePrompt: NEGATIVE_BASE,
  };
}

/** The recipe behind a style, for the studio UI and for docs. */
export function describeStyle(style: BackplateStyle): StyleRecipe {
  return { ...(RECIPES[style] ?? RECIPES.abstract) };
}
