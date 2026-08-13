/**
 * The registry: the template list plus everything that queries or checks it.
 *
 * `validateTemplate` is the interesting part. Templates are data written by
 * hand, and hand-written geometry rots quietly — a nameplate creeps under the
 * duration pill, two text blocks start to overlap, an adaptive grid stops
 * emitting the number of cells it promised. Every rule below exists because it
 * is the kind of mistake that survives a code review and dies in a thumbnail.
 */

import type {
  AspectPreset,
  LayoutSpec,
  Player,
  StyleSpec,
  SubjectRef,
  Team,
  TemplateCategory,
  TemplateContext,
  ThumbnailTemplate,
  Vec2,
} from '@hexa/core';
import { HexaError, didYouMean, overlapRatio } from '@hexa/core';

import { BUILTIN_LUTS, KIND_BANDS, Z_BAND_WIDTH, aspectRatio, facePoint } from './helpers.js';
import { versusTemplates } from './templates/versus.js';
import { teamVersusTemplates } from './templates/teamVersus.js';
import { heroTemplates } from './templates/hero.js';
import { rosterTemplates } from './templates/roster.js';
import { tierlistTemplates } from './templates/tierlist.js';
import { analysisTemplates } from './templates/analysis.js';
import { dramaTemplates } from './templates/drama.js';
import { statTemplates } from './templates/stat.js';
import { tournamentTemplates } from './templates/tournament.js';
import { celebrationTemplates } from './templates/celebration.js';
import { shortsTemplates } from './templates/shorts.js';
import { draftTemplates } from './templates/draft.js';
import { mvpTemplates } from './templates/mvp.js';
import { streamTemplates } from './templates/stream.js';

// ── The library ──────────────────────────────────────────────────────────────

export const TEMPLATES: ThumbnailTemplate[] = [
  ...versusTemplates,
  ...teamVersusTemplates,
  ...heroTemplates,
  ...rosterTemplates,
  ...tierlistTemplates,
  ...analysisTemplates,
  ...dramaTemplates,
  ...statTemplates,
  ...tournamentTemplates,
  ...celebrationTemplates,
  ...shortsTemplates,
  ...draftTemplates,
  ...mvpTemplates,
  ...streamTemplates,
];

const BY_ID = new Map<string, ThumbnailTemplate>(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): ThumbnailTemplate | undefined {
  return BY_ID.get(id);
}

export function requireTemplate(id: string): ThumbnailTemplate {
  const found = BY_ID.get(id);
  if (found) return found;
  const near = didYouMean(id, [...BY_ID.keys()]);
  throw new HexaError('TEMPLATE_NOT_FOUND', `No template with id "${id}".`, {
    hint: near.length
      ? `Did you mean ${near.map((n) => `"${n}"`).join(' or ')}?`
      : 'Call listTemplates() to see the available ids.',
    details: { id, suggestions: near, available: TEMPLATES.length },
  });
}

// ── Filtering ────────────────────────────────────────────────────────────────

export interface TemplateFilter {
  category?: TemplateCategory;
  aspect?: AspectPreset;
  /** Keep templates whose subject bounds admit exactly this many subjects. */
  subjects?: number;
  /** Every listed tag must be present (AND, case-insensitive). */
  tags?: string[];
}

export function listTemplates(filter: TemplateFilter = {}): ThumbnailTemplate[] {
  const wanted = filter.tags?.map((t) => t.toLowerCase()) ?? [];
  return TEMPLATES.filter((t) => {
    if (filter.category && t.category !== filter.category) return false;
    if (filter.aspect && !t.aspects.includes(filter.aspect)) return false;
    if (filter.subjects !== undefined && !acceptsSubjects(t, filter.subjects)) return false;
    if (wanted.length) {
      const has = new Set(t.tags.map((x) => x.toLowerCase()));
      if (!wanted.every((x) => has.has(x))) return false;
    }
    return true;
  });
}

export function templatesForSubjectCount(n: number): ThumbnailTemplate[] {
  return TEMPLATES.filter((t) => acceptsSubjects(t, n));
}

function acceptsSubjects(t: ThumbnailTemplate, n: number): boolean {
  return n >= t.subjects.min && n <= t.subjects.max;
}

// ── Suggestion ───────────────────────────────────────────────────────────────

/** Mood words a caller might type, mapped onto the tag vocabulary in use. */
const MOOD_SYNONYMS: Record<string, string[]> = {
  hype: ['high-energy', 'explosive', 'impact', 'aggressive'],
  hyped: ['high-energy', 'impact', 'aggressive'],
  epic: ['cinematic', 'ceremonial', 'stage', 'volumetric'],
  loud: ['big-text', 'loud', 'high-energy'],
  aggressive: ['aggressive', 'impact', 'shatter', 'high-energy'],
  angry: ['drama', 'reaction', 'aggressive', 'loud'],
  drama: ['drama', 'reaction', 'controversy', 'tabloid'],
  scandal: ['controversy', 'tabloid', 'rift'],
  minimal: ['minimal', 'negative-space', 'clean', 'quiet'],
  clean: ['clean', 'minimal', 'editorial'],
  premium: ['premium', 'editorial', 'minimal', 'noir'],
  editorial: ['editorial', 'premium', 'quiet'],
  dark: ['moody', 'noir', 'silhouette'],
  moody: ['moody', 'noir', 'documentary'],
  noir: ['noir', 'moody', 'premium'],
  fire: ['fire', 'ember', 'temperature', 'gold'],
  hot: ['fire', 'ember'],
  cold: ['ice', 'temperature', 'institutional'],
  ice: ['ice', 'temperature'],
  celebration: ['celebration', 'trophy', 'champion', 'confetti', 'gold'],
  happy: ['celebration', 'euphoric', 'confetti'],
  victory: ['celebration', 'champion', 'trophy'],
  analytical: ['analysis', 'callout', 'annotation', 'data'],
  tactical: ['analysis', 'annotation', 'coaching'],
  educational: ['analysis', 'coaching', 'annotation'],
  data: ['data', 'stat', 'table', 'number'],
  numbers: ['stat', 'number', 'data', 'big-figure'],
  official: ['broadcast', 'institutional', 'ceremonial', 'org'],
  broadcast: ['broadcast', 'band', 'institutional'],
  cinematic: ['cinematic', 'volumetric', 'stage', 'moody'],
  vertical: ['shorts', 'vertical', '9:16'],
  live: ['live', 'stream', 'urgent'],
};

export interface SuggestInput {
  subjects: number;
  mood?: string;
  category?: TemplateCategory;
  aspect?: AspectPreset;
}

/**
 * Rank templates for a brief. Hard constraints (subject count, category,
 * aspect) filter; mood only ranks, so a caller always gets something back.
 */
export function suggestTemplates(input: SuggestInput, limit = 5): ThumbnailTemplate[] {
  const pool = listTemplates({
    ...(input.category ? { category: input.category } : {}),
    ...(input.aspect ? { aspect: input.aspect } : {}),
    subjects: input.subjects,
  });

  const tokens = (input.mood ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const expanded = new Set<string>(tokens);
  for (const tok of tokens) for (const syn of MOOD_SYNONYMS[tok] ?? []) expanded.add(syn);

  const scored = pool.map((t, index) => {
    let score = 0;
    const tags = new Set(t.tags.map((x) => x.toLowerCase()));
    const haystack = `${t.id} ${t.name} ${t.description} ${t.whenToUse ?? ''}`.toLowerCase();

    for (const tok of tokens) {
      if (tags.has(tok)) score += 4;
      if (haystack.includes(tok)) score += 1;
    }
    for (const syn of expanded) {
      if (!tokens.includes(syn) && tags.has(syn)) score += 2;
    }
    // A template built for exactly this cast beats one that merely tolerates it.
    if (t.subjects.min === input.subjects && t.subjects.max === input.subjects) score += 3;
    else if (t.subjects.max - t.subjects.min <= 3) score += 1;
    if (input.category && t.category === input.category) score += 2;
    if (input.aspect && t.aspects[0] === input.aspect) score += 1;

    return { t, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((s) => s.t);
}

// ── Resolution ───────────────────────────────────────────────────────────────

export function resolveLayout(t: ThumbnailTemplate, ctx: TemplateContext): LayoutSpec {
  return typeof t.layout === 'function' ? t.layout(ctx) : t.layout;
}

export function resolveStyle(t: ThumbnailTemplate, ctx: TemplateContext): StyleSpec {
  return typeof t.style === 'function' ? t.style(ctx) : t.style;
}

// ── Sample contexts (used by validation and by tests) ────────────────────────

const SAMPLE_TEAM: Team = {
  id: 'sample-team',
  name: 'Sample Esports',
  shortName: 'Sample',
  tag: 'SMP',
  region: 'INT',
  league: 'OTHER',
  colors: {
    primary: '#E4322B',
    secondary: '#2B6BE4',
    accent: '#FFC63A',
    dark: '#0A0B10',
    light: '#F5F7FB',
  },
};

function samplePlayer(i: number): Player {
  return {
    id: `sample-player-${i}`,
    handle: `Player${i}`,
    aliases: [],
    fullName: `Sample Player ${i}`,
    role: 'mid',
    teamId: SAMPLE_TEAM.id,
    region: 'INT',
    nationality: 'INT',
    signatureChampions: [],
    careerHighlights: [],
    referenceQueries: [],
    active: true,
  };
}

export function sampleContext(subjects: number, aspect: AspectPreset, seed = 1): TemplateContext {
  const refs: SubjectRef[] = Array.from({ length: Math.max(0, subjects) }, (_, i) => ({
    player: samplePlayer(i),
    team: SAMPLE_TEAM,
    side: i === 0 ? 'left' : i === 1 ? 'right' : 'center',
  }));
  return {
    subjects: refs,
    text: {},
    aspect,
    seed,
    palette: {
      left: '#E4322B',
      right: '#2B6BE4',
      accent: '#FFC63A',
      dark: '#0A0B10',
      light: '#F5F7FB',
    },
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Subjects, FX, backplates and decorative shapes may bleed off-canvas on
 * purpose — a diagonal versus divider or a full-bleed plate is only convincing
 * when it runs past the frame edge. Text and badges may never bleed, because a
 * clipped word is always a bug.
 */
const BLEED_MIN = -0.15;
const BLEED_MAX = 1.15;
/** Two blocks of copy may kiss, but 10% shared area is a collision. */
const MAX_TEXT_OVERLAP = 0.1;
/** Copy is allowed a hairline into a platform zone, nothing more. */
const MAX_HARD_ZONE_OVERLAP = 0.02;
const MIN_FOCAL_SEPARATION = 0.03;

function inRange(v: number, lo: number, hi: number): boolean {
  return Number.isFinite(v) && v >= lo && v <= hi;
}

function contains(r: { x: number; y: number; w: number; h: number }, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function checkGrade(style: StyleSpec, label: string, out: string[]): void {
  const g = style.grade;
  if (!g) {
    out.push(`${label}: style.grade is missing — every template must declare a grade.`);
    return;
  }
  if (g.lut !== undefined && !(BUILTIN_LUTS as readonly string[]).includes(g.lut)) {
    out.push(`${label}: unknown LUT "${g.lut}" (expected one of ${BUILTIN_LUTS.join(', ')}).`);
  }
  const unit: [string, number | undefined][] = [
    ['lutStrength', g.lutStrength],
    ['grain', g.grain],
    ['bloomThreshold', g.bloomThreshold],
    ['bloomIntensity', g.bloomIntensity],
    ['vignette', g.vignette],
    ['halation', g.halation],
    ['letterbox', g.letterbox],
    ['splitToneBalance', g.splitToneBalance],
  ];
  for (const [key, value] of unit) {
    if (value !== undefined && !inRange(value, 0, 1)) out.push(`${label}: grade.${key} must be 0–1, got ${value}.`);
  }
  if (g.contrast !== undefined && !inRange(g.contrast, 0.1, 3)) out.push(`${label}: grade.contrast out of range (${g.contrast}).`);
  if (g.saturation !== undefined && !inRange(g.saturation, 0, 3)) out.push(`${label}: grade.saturation out of range (${g.saturation}).`);
  if (g.exposure !== undefined && !inRange(g.exposure, -3, 3)) out.push(`${label}: grade.exposure out of range (${g.exposure}).`);

  if (style.brandStrength !== undefined && !inRange(style.brandStrength, 0, 1)) {
    out.push(`${label}: brandStrength must be 0–1, got ${style.brandStrength}.`);
  }
  const atmosphere = style.atmosphere;
  if (atmosphere) {
    if (atmosphere.haze !== undefined && !inRange(atmosphere.haze, 0, 1)) out.push(`${label}: atmosphere.haze must be 0–1.`);
    if (atmosphere.fog !== undefined && !inRange(atmosphere.fog, 0, 1)) out.push(`${label}: atmosphere.fog must be 0–1.`);
    if (atmosphere.particles && !inRange(atmosphere.particles.density, 0, 1)) {
      out.push(`${label}: atmosphere.particles.density must be 0–1.`);
    }
  }
}

function checkLayout(t: ThumbnailTemplate, layout: LayoutSpec, ctx: TemplateContext, out: string[]): void {
  const label = `${t.id}@${ctx.aspect}/${ctx.subjects.length}`;

  if (!layout.id) out.push(`${label}: layout.id is empty.`);
  if (!layout.name) out.push(`${label}: layout.name is empty.`);
  if (!(layout.designAspect > 0)) out.push(`${label}: layout.designAspect must be positive.`);

  // — slot identity and paint order —
  const seenIds = new Set<string>();
  const seenZ = new Map<number, string>();
  for (const slot of layout.slots) {
    if (seenIds.has(slot.id)) out.push(`${label}: duplicate slot id "${slot.id}".`);
    seenIds.add(slot.id);

    const owner = seenZ.get(slot.z);
    if (owner !== undefined) {
      out.push(`${label}: slots "${owner}" and "${slot.id}" share z=${slot.z} — paint order is ambiguous.`);
    }
    seenZ.set(slot.z, slot.id);

    const bands = KIND_BANDS[slot.kind];
    if (!bands.some((b) => slot.z >= b && slot.z < b + Z_BAND_WIDTH)) {
      out.push(
        `${label}: slot "${slot.id}" (${slot.kind}) has z=${slot.z}, outside its allowed band(s) ${bands.join('/')}.`,
      );
    }

    // — geometry —
    const { x, y, w, h } = slot.rect;
    if (!(w > 0) || !(h > 0)) out.push(`${label}: slot "${slot.id}" has a non-positive size (${w}×${h}).`);
    const bleedAllowed =
      slot.kind === 'subject' || slot.kind === 'fx' || slot.kind === 'shape' || slot.kind === 'backplate';
    const lo = bleedAllowed ? BLEED_MIN : 0;
    const hi = bleedAllowed ? BLEED_MAX : 1;
    if (!inRange(x, lo, hi) || !inRange(y, lo, hi) || !inRange(x + w, lo, hi) || !inRange(y + h, lo, hi)) {
      out.push(
        `${label}: slot "${slot.id}" (${slot.kind}) rect ${JSON.stringify(slot.rect)} escapes its allowed range ${lo}–${hi}.`,
      );
    }
    if (slot.opacity !== undefined && !inRange(slot.opacity, 0, 1)) {
      out.push(`${label}: slot "${slot.id}" opacity must be 0–1, got ${slot.opacity}.`);
    }
    if (slot.scale !== undefined && !inRange(slot.scale, 0.05, 4)) {
      out.push(`${label}: slot "${slot.id}" scale ${slot.scale} is implausible.`);
    }
    if (slot.focal && (!inRange(slot.focal.x, -0.5, 1.5) || !inRange(slot.focal.y, -0.5, 1.5))) {
      out.push(`${label}: slot "${slot.id}" focal point is far outside the slot.`);
    }
  }

  // — cast size —
  const subjectSlots = layout.slots.filter((s) => s.kind === 'subject');
  if (subjectSlots.length < t.subjects.min || subjectSlots.length > t.subjects.max) {
    out.push(
      `${label}: ${subjectSlots.length} subject slots, outside the declared bounds ${t.subjects.min}–${t.subjects.max}.`,
    );
  }
  if (typeof t.layout === 'function' && subjectSlots.length !== ctx.subjects.length) {
    out.push(
      `${label}: adaptive layout emitted ${subjectSlots.length} subject slots for ${ctx.subjects.length} subjects.`,
    );
  }

  // — focal hierarchy —
  if (layout.focalPoints.length < 2) {
    out.push(`${label}: focalPoints must express a hierarchy — at least two points.`);
  }
  layout.focalPoints.forEach((p, i) => {
    if (!inRange(p.x, 0, 1) || !inRange(p.y, 0, 1)) {
      out.push(`${label}: focalPoint ${i} (${p.x}, ${p.y}) is outside the canvas.`);
    }
    const prev = layout.focalPoints[i - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < MIN_FOCAL_SEPARATION) {
      out.push(`${label}: focalPoints ${i - 1} and ${i} are effectively the same point.`);
    }
  });

  // — safe zones —
  if (!layout.safeZones.length) out.push(`${label}: no safe zones declared.`);
  const zoneIds = new Set<string>();
  for (const zone of layout.safeZones) {
    if (zoneIds.has(zone.id)) out.push(`${label}: duplicate safe zone id "${zone.id}".`);
    zoneIds.add(zone.id);
    const { x, y, w, h } = zone.rect;
    if (!inRange(x, 0, 1) || !inRange(y, 0, 1) || !inRange(x + w, 0, 1) || !inRange(y + h, 0, 1)) {
      out.push(`${label}: safe zone "${zone.id}" is not inside the canvas.`);
    }
    if (!zone.reason) out.push(`${label}: safe zone "${zone.id}" has no reason — QA output would be useless.`);
  }

  // — text schema wiring —
  const byId = new Map(layout.slots.map((s) => [s.id, s]));
  for (const spec of t.textSlots) {
    const slot = byId.get(spec.slotId);
    if (!slot) {
      out.push(`${label}: text slot spec "${spec.role}" points at missing slot "${spec.slotId}".`);
      continue;
    }
    if (slot.kind !== 'text' && slot.kind !== 'badge') {
      out.push(`${label}: text role "${spec.role}" is bound to slot "${slot.id}" of kind ${slot.kind}.`);
    }
  }

  // — copy collisions —
  const copySlots = layout.slots.filter((s) => s.kind === 'text' || t.textSlots.some((x) => x.slotId === s.id));
  for (const slot of copySlots) {
    const { x, y, w, h } = slot.rect;
    if (!inRange(x, 0, 1) || !inRange(y, 0, 1) || !inRange(x + w, 0, 1) || !inRange(y + h, 0, 1)) {
      out.push(`${label}: copy slot "${slot.id}" leaves the canvas — text may never bleed.`);
    }
  }
  for (let i = 0; i < copySlots.length; i++) {
    for (let j = i + 1; j < copySlots.length; j++) {
      const a = copySlots[i]!;
      const b = copySlots[j]!;
      const ratio = overlapRatio(a.rect, b.rect);
      if (ratio > MAX_TEXT_OVERLAP) {
        out.push(`${label}: copy slots "${a.id}" and "${b.id}" overlap by ${(ratio * 100).toFixed(0)}%.`);
      }
    }
  }
  for (const slot of copySlots) {
    for (const zone of layout.safeZones) {
      if (zone.severity !== 'hard') continue;
      const ratio = overlapRatio(slot.rect, zone.rect);
      if (ratio > MAX_HARD_ZONE_OVERLAP) {
        out.push(
          `${label}: copy slot "${slot.id}" intrudes ${(ratio * 100).toFixed(0)}% into hard safe zone "${zone.id}".`,
        );
      }
    }
    for (const subject of subjectSlots) {
      if (contains(slot.rect, facePoint(subject))) {
        out.push(`${label}: copy slot "${slot.id}" sits on the face of subject "${subject.id}".`);
      }
    }
  }
}

/**
 * Integrity check for one template. Returns a list of problems; `[]` means the
 * template is sound. Adaptive templates are resolved across their whole subject
 * range and every declared aspect, so a grid that only breaks at n = 11 is
 * still caught.
 */
export function validateTemplate(t: ThumbnailTemplate): string[] {
  const out: string[] = [];

  if (!t.id) out.push('Template id is empty.');
  if (!t.name) out.push(`${t.id}: name is empty.`);
  if (!t.description) out.push(`${t.id}: description is empty.`);
  if (!t.whenToUse) out.push(`${t.id}: whenToUse is empty — template authors need the guidance.`);
  if (!t.tags.length) out.push(`${t.id}: no tags — the template is unfindable.`);

  if (!t.aspects.length) out.push(`${t.id}: aspects[] is empty.`);
  if (new Set(t.aspects).size !== t.aspects.length) out.push(`${t.id}: duplicate entries in aspects[].`);

  if (!(t.subjects.min >= 1)) out.push(`${t.id}: subjects.min must be at least 1.`);
  if (t.subjects.max < t.subjects.min) out.push(`${t.id}: subjects.max is below subjects.min.`);

  if (!t.textSlots.some((s) => s.required)) {
    out.push(`${t.id}: no required text slot — every template needs at least one guaranteed line of copy.`);
  }
  const roles = new Set<string>();
  const slotIds = new Set<string>();
  for (const spec of t.textSlots) {
    if (roles.has(spec.role)) out.push(`${t.id}: text role "${spec.role}" is declared twice.`);
    roles.add(spec.role);
    if (slotIds.has(spec.slotId)) out.push(`${t.id}: slot "${spec.slotId}" is bound to two text roles.`);
    slotIds.add(spec.slotId);
    if (spec.maxChars !== undefined && spec.maxChars < 1) out.push(`${t.id}: text role "${spec.role}" has maxChars < 1.`);
  }

  // The design aspect must correspond to at least one surface it claims.
  const layoutAspect = typeof t.layout === 'function' ? undefined : t.layout.designAspect;
  const designAspect = layoutAspect ?? resolveLayout(t, sampleContext(t.subjects.min, t.aspects[0] ?? 'youtube')).designAspect;
  if (t.aspects.length && !t.aspects.some((a) => Math.abs(aspectRatio(a) - designAspect) / designAspect < 0.15)) {
    out.push(
      `${t.id}: designAspect ${designAspect.toFixed(3)} matches none of the declared aspects (${t.aspects.join(', ')}).`,
    );
  }

  for (const ctx of validationContexts(t)) {
    let layout: LayoutSpec;
    let style: StyleSpec;
    try {
      layout = resolveLayout(t, ctx);
    } catch (err) {
      out.push(`${t.id}: layout threw for ${ctx.subjects.length} subjects — ${(err as Error).message}`);
      continue;
    }
    try {
      style = resolveStyle(t, ctx);
    } catch (err) {
      out.push(`${t.id}: style threw for ${ctx.subjects.length} subjects — ${(err as Error).message}`);
      continue;
    }
    checkLayout(t, layout, ctx, out);
    checkGrade(style, `${t.id}@${ctx.aspect}/${ctx.subjects.length}`, out);
  }

  // Same defect found at several sample sizes is still one defect.
  return [...new Set(out)];
}

function validationContexts(t: ThumbnailTemplate): TemplateContext[] {
  const adaptive = typeof t.layout === 'function' || typeof t.style === 'function';
  const counts: number[] = [];
  if (adaptive) {
    for (let n = t.subjects.min; n <= t.subjects.max && counts.length < 12; n++) counts.push(n);
  } else {
    counts.push(t.subjects.min);
    if (t.subjects.max !== t.subjects.min) counts.push(t.subjects.max);
  }
  const aspects = t.aspects.length ? t.aspects.slice(0, 3) : (['youtube'] as AspectPreset[]);
  const out: TemplateContext[] = [];
  for (const aspect of aspects) {
    for (const n of counts) out.push(sampleContext(n, aspect, 7));
  }
  return out;
}

/** Handy for tooling: every problem in the library, keyed by template id. */
export function validateLibrary(): Record<string, string[]> {
  const report: Record<string, string[]> = {};
  for (const t of TEMPLATES) {
    const problems = validateTemplate(t);
    if (problems.length) report[t.id] = problems;
  }
  return report;
}
