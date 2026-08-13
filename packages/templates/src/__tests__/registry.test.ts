import { describe, expect, it } from 'vitest';
import type { LayoutSpec, StyleSpec, TemplateCategory, ThumbnailTemplate } from '@hexa/core';
import { isHexaError } from '@hexa/core';

import {
  ASPECT_SIZES,
  TEMPLATES,
  getTemplate,
  listTemplates,
  requireTemplate,
  resolveLayout,
  resolveStyle,
  sampleContext,
  suggestTemplates,
  templatesForSubjectCount,
} from '../index.js';

const ALL_CATEGORIES: TemplateCategory[] = [
  'versus',
  'team-versus',
  'hero',
  'roster',
  'tierlist',
  'analysis',
  'drama',
  'stat',
  'tournament',
  'celebration',
  'shorts',
  'stream',
  'draft',
  'mvp',
];

describe('library shape', () => {
  it('ships at least 24 templates', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(24);
  });

  it('has unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case ids', () => {
    for (const t of TEMPLATES) expect(t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('covers every category with at least one template', () => {
    for (const category of ALL_CATEGORIES) {
      expect(listTemplates({ category }).length, `category ${category}`).toBeGreaterThan(0);
    }
  });

  it('declares the required signature templates', () => {
    const required = [
      'versus-classic',
      'versus-diagonal-shatter',
      'versus-clash',
      'versus-split-portrait',
      'versus-minimal',
      'versus-fire-ice',
      'lineup-5v5',
      'lineup-hero-flank',
      'crest-clash',
      'hero-portrait',
      'hero-fullbody',
      'hero-godray',
      'roster-reveal',
      'transfer-alert',
      'tierlist-grid',
      'ranking-podium',
      'analysis-callout',
      'breakdown-split',
      'drama-reaction',
      'controversy-split',
      'stat-record',
      'stat-compare',
      'tournament-preview',
      'bracket-clash',
      'trophy-lift',
      'shorts-versus',
      'shorts-hero',
      'pickban-duel',
      'mvp-card',
      'podcast-panel',
    ];
    for (const id of required) expect(getTemplate(id), id).toBeDefined();
  });

  it('exposes the canvas sizes', () => {
    expect(ASPECT_SIZES.youtube).toEqual({ width: 1280, height: 720 });
    expect(ASPECT_SIZES['youtube-hd']).toEqual({ width: 1920, height: 1080 });
    expect(ASPECT_SIZES.shorts).toEqual({ width: 1080, height: 1920 });
    expect(ASPECT_SIZES.twitch).toEqual({ width: 1920, height: 1080 });
    expect(ASPECT_SIZES.square).toEqual({ width: 1080, height: 1080 });
    expect(ASPECT_SIZES.twitter).toEqual({ width: 1600, height: 900 });
    expect(ASPECT_SIZES.banner).toEqual({ width: 2560, height: 1440 });
  });
});

describe('lookup', () => {
  it('finds a template by id', () => {
    expect(getTemplate('versus-classic')?.name).toBe('Versus Classic');
  });

  it('returns undefined for an unknown id', () => {
    expect(getTemplate('nope-not-real')).toBeUndefined();
  });

  it('requireTemplate throws a typed error with suggestions', () => {
    expect.assertions(4);
    try {
      requireTemplate('versus-clasic');
    } catch (err) {
      expect(isHexaError(err)).toBe(true);
      if (isHexaError(err)) {
        expect(err.code).toBe('TEMPLATE_NOT_FOUND');
        expect(err.hint).toContain('versus-classic');
        expect(err.details?.suggestions).toContain('versus-classic');
      }
    }
  });

  it('requireTemplate returns the template when it exists', () => {
    expect(requireTemplate('mvp-card').id).toBe('mvp-card');
  });
});

describe('filtering', () => {
  it('filters by category', () => {
    const versus = listTemplates({ category: 'versus' });
    expect(versus.length).toBeGreaterThanOrEqual(6);
    expect(versus.every((t) => t.category === 'versus')).toBe(true);
  });

  it('filters by aspect', () => {
    const vertical = listTemplates({ aspect: 'shorts' });
    expect(vertical.length).toBeGreaterThanOrEqual(2);
    expect(vertical.every((t) => t.aspects.includes('shorts'))).toBe(true);
  });

  it('filters by subject count', () => {
    for (const t of listTemplates({ subjects: 2 })) {
      expect(t.subjects.min).toBeLessThanOrEqual(2);
      expect(t.subjects.max).toBeGreaterThanOrEqual(2);
    }
    expect(listTemplates({ subjects: 10 }).map((t) => t.id)).toContain('lineup-5v5');
  });

  it('requires every requested tag', () => {
    const both = listTemplates({ tags: ['versus', 'minimal'] });
    expect(both.map((t) => t.id)).toEqual(['versus-minimal']);
    expect(listTemplates({ tags: ['versus', 'not-a-real-tag'] })).toEqual([]);
  });

  it('templatesForSubjectCount agrees with the declared bounds', () => {
    for (const n of [1, 2, 3, 5, 8, 10, 12]) {
      for (const t of templatesForSubjectCount(n)) {
        expect(n).toBeGreaterThanOrEqual(t.subjects.min);
        expect(n).toBeLessThanOrEqual(t.subjects.max);
      }
    }
  });

  it('every template is reachable for some subject count', () => {
    const reachable = new Set<string>();
    for (let n = 1; n <= 12; n++) for (const t of templatesForSubjectCount(n)) reachable.add(t.id);
    expect(reachable.size).toBe(TEMPLATES.length);
  });
});

describe('suggestion', () => {
  it('respects the subject count', () => {
    for (const t of suggestTemplates({ subjects: 2 }, 8)) {
      expect(t.subjects.min).toBeLessThanOrEqual(2);
      expect(t.subjects.max).toBeGreaterThanOrEqual(2);
    }
  });

  it('honours a hard category filter', () => {
    const picks = suggestTemplates({ subjects: 1, category: 'hero' }, 5);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((t) => t.category === 'hero')).toBe(true);
  });

  it('honours a hard aspect filter', () => {
    const picks = suggestTemplates({ subjects: 1, aspect: 'shorts' }, 5);
    expect(picks.every((t) => t.aspects.includes('shorts'))).toBe(true);
  });

  it('moves mood-matching templates to the top', () => {
    const minimal = suggestTemplates({ subjects: 2, mood: 'minimal premium' }, 3);
    expect(minimal[0]?.id).toBe('versus-minimal');

    const hype = suggestTemplates({ subjects: 2, mood: 'hype explosive clash' }, 3);
    expect(hype.map((t) => t.id)).toContain('versus-clash');
  });

  it('maps mood synonyms onto the tag vocabulary', () => {
    const picks = suggestTemplates({ subjects: 1, mood: 'celebration' }, 4).map((t) => t.id);
    expect(picks.some((id) => id === 'trophy-lift' || id === 'champion-crowned')).toBe(true);
  });

  it('is deterministic and respects the limit', () => {
    const a = suggestTemplates({ subjects: 2, mood: 'dark' }, 4).map((t) => t.id);
    const b = suggestTemplates({ subjects: 2, mood: 'dark' }, 4).map((t) => t.id);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(4);
  });

  it('still returns something when the mood matches nothing', () => {
    expect(suggestTemplates({ subjects: 2, mood: 'zzzzz' }, 3).length).toBe(3);
  });
});

describe('resolution', () => {
  const ctx = sampleContext(2, 'youtube');

  it('resolves the object form', () => {
    const t = requireTemplate('versus-classic');
    expect(typeof t.layout).toBe('object');
    expect(resolveLayout(t, ctx).id).toBe('versus-classic');
    expect(resolveStyle(t, ctx).lightRig).toBe('split-rim');
  });

  it('resolves the function form of layout', () => {
    const t = requireTemplate('tierlist-grid');
    expect(typeof t.layout).toBe('function');
    const three = resolveLayout(t, sampleContext(3, 'youtube'));
    const twelve = resolveLayout(t, sampleContext(12, 'youtube'));
    expect(three.slots.filter((s) => s.kind === 'subject')).toHaveLength(3);
    expect(twelve.slots.filter((s) => s.kind === 'subject')).toHaveLength(12);
  });

  it('resolves the function form of style', () => {
    const t = requireTemplate('versus-fire-ice');
    expect(typeof t.style).toBe('function');
    const warm = resolveStyle(t, ctx);
    expect(warm.lightRig).toBe('ember');
    expect(warm.grade.lut).toBe('ember');
    // Palette-driven: a different palette produces different split-tone values.
    const other = sampleContext(2, 'youtube');
    other.palette.left = '#22FF88';
    expect(resolveStyle(t, other).grade.highlightTint).not.toBe(warm.grade.highlightTint);
  });

  it('handles a hand-rolled template in both forms', () => {
    const layout: LayoutSpec = {
      id: 'inline',
      name: 'Inline',
      designAspect: 16 / 9,
      slots: [],
      safeZones: [],
      focalPoints: [{ x: 0.5, y: 0.5 }],
    };
    const style: StyleSpec = { lightRig: 'clean', grade: { contrast: 1 } };
    const base: ThumbnailTemplate = {
      id: 'inline',
      name: 'Inline',
      category: 'hero',
      description: 'inline',
      aspects: ['youtube'],
      subjects: { min: 1, max: 1 },
      layout,
      style,
      textSlots: [],
      tags: [],
    };
    expect(resolveLayout(base, ctx)).toBe(layout);
    expect(resolveStyle(base, ctx)).toBe(style);

    const dynamic: ThumbnailTemplate = { ...base, layout: () => layout, style: () => style };
    expect(resolveLayout(dynamic, ctx)).toBe(layout);
    expect(resolveStyle(dynamic, ctx)).toBe(style);
  });

  it('adaptive layouts stay stable across repeated resolution', () => {
    const t = requireTemplate('roster-reveal');
    const a = resolveLayout(t, sampleContext(4, 'youtube'));
    const b = resolveLayout(t, sampleContext(4, 'youtube'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
