/**
 * Showcase — render the whole template library and judge it.
 *
 * This is the adversarial counterpart to `scripts/smoke.ts`. Smoke asks "does
 * anything come out?". Showcase asks "would you put this on a channel?".
 *
 * It renders every template in @hexa/templates across a realistic cast of
 * players, in the aspect each template was designed for, writes one contact
 * sheet per category so the designs can be judged side by side, and records
 * every QA finding, warning and timing into out/showcase/index.json.
 *
 *   npx tsx scripts/showcase.ts               # everything
 *   npx tsx scripts/showcase.ts versus hero   # only these categories
 *
 * Nothing here is a test. It produces evidence.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AspectPreset, SubjectRequest, TextRole } from '@hexa/core';

const ROOT = process.cwd();
const OUT = join(ROOT, 'out', 'showcase');
const SHEETS = join(OUT, 'sheets');

// ── the cast ─────────────────────────────────────────────────────────────────

const T1 = ['Doran', 'Oner', 'Faker', 'Peyz', 'Keria'];
const GEN = ['Kiin', 'Canyon', 'Chovy', 'Ruler', 'Duro'];
const KC = ['Canna', 'Yike', 'kyeahoo', 'Caliste', 'Busio'];
const G2 = ['BrokenBlade', 'SkewMond', 'Caps', 'Hans Sama', 'Labrov'];

function pair(left: string, right: string): SubjectRequest[] {
  return [
    { player: left, side: 'left' },
    { player: right, side: 'right' },
  ];
}

function team(players: string[], side: 'left' | 'right'): SubjectRequest[] {
  return players.map((player) => ({ player, side }));
}

interface Case {
  /** File-safe id; also the basename of the render. */
  id: string;
  templateId: string;
  category: string;
  subjects: SubjectRequest[];
  text: Partial<Record<TextRole, string>>;
  aspect?: AspectPreset;
  variants?: number;
  seed: number;
  /** One-line note about what this case is meant to prove. */
  probes: string;
}

const CASES: Case[] = [
  // ── versus ────────────────────────────────────────────────────────────────
  {
    id: 'versus-classic-peyz-viper',
    templateId: 'versus-classic',
    category: 'versus',
    subjects: pair('Peyz', 'Viper'),
    text: { headline: 'RIVALS', kicker: 'LCK FINALS' },
    seed: 1337,
    variants: 4,
    probes: 'the headline pairing from the README, plus variant diversity',
  },
  {
    id: 'versus-diagonal-shatter-faker-chovy',
    templateId: 'versus-diagonal-shatter',
    category: 'versus',
    subjects: pair('Faker', 'Chovy'),
    text: { kicker: 'GAME 5', badge: 'LIVE' },
    seed: 2001,
    probes: 'red vs gold — the two biggest names, strong brand separation',
  },
  {
    id: 'versus-clash-caps-faker',
    templateId: 'versus-clash',
    category: 'versus',
    subjects: pair('Caps', 'Faker'),
    text: { kicker: 'WEST vs EAST' },
    seed: 2002,
    probes: 'cross-region matchup; G2 white/black against T1 red',
  },
  {
    id: 'versus-split-portrait-zeus-kiin',
    templateId: 'versus-split-portrait',
    category: 'versus',
    subjects: pair('Zeus', 'Kiin'),
    text: { kicker: 'TOP LANE WAR' },
    seed: 2003,
    probes: 'hard centre split with two long names',
  },
  {
    id: 'versus-minimal-ruler-gumayusi',
    templateId: 'versus-minimal',
    category: 'versus',
    subjects: pair('Ruler', 'Gumayusi'),
    text: { kicker: 'ADC SUMMIT', date: 'AUG 30' },
    seed: 2004,
    probes: 'editorial restraint — and a 9-character handle in a small slot',
  },
  {
    id: 'versus-fire-ice-canyon-oner',
    templateId: 'versus-fire-ice',
    category: 'versus',
    subjects: pair('Canyon', 'Oner'),
    text: { kicker: 'JUNGLE DIFF' },
    seed: 2005,
    probes: 'opposing temperature grade',
  },

  // ── team-versus ───────────────────────────────────────────────────────────
  {
    id: 'lineup-5v5-t1-geng',
    templateId: 'lineup-5v5',
    category: 'team-versus',
    subjects: [...team(T1, 'left'), ...team(GEN, 'right')],
    text: { headline: 'THE CLASSICO', kicker: 'LCK SUMMER FINAL' },
    seed: 3001,
    probes: 'ten subjects — does anyone read at all?',
  },
  {
    id: 'lineup-hero-flank-kc-g2',
    templateId: 'lineup-hero-flank',
    category: 'team-versus',
    subjects: [...team(KC.slice(0, 4), 'left'), ...team(G2.slice(0, 4), 'right')],
    text: { kicker: 'LEC PLAYOFFS' },
    seed: 3002,
    probes: 'the KC vs G2 derby — two stars large, six small',
  },
  {
    id: 'crest-clash-kc-g2',
    templateId: 'crest-clash',
    category: 'team-versus',
    subjects: pair('Caliste', 'Caps'),
    text: { headline: 'DERBY', kicker: 'LEC WEEK 6' },
    seed: 3003,
    probes: 'crest-led layout — the one design that needs no photograph',
  },

  // ── hero ──────────────────────────────────────────────────────────────────
  {
    id: 'hero-portrait-faker',
    templateId: 'hero-portrait',
    category: 'hero',
    subjects: [{ player: 'Faker', side: 'right' }],
    text: { headline: 'THE GOAT', kicker: 'T1 MID', subhead: 'FIVE WORLDS TITLES' },
    seed: 4001,
    probes: 'the single-subject baseline; every other hero layout is judged against it',
  },
  {
    id: 'hero-fullbody-chovy',
    templateId: 'hero-fullbody',
    category: 'hero',
    subjects: [{ player: 'Chovy', side: 'left' }],
    text: { headline: 'UNTOUCHABLE', kicker: 'GEN.G', subhead: 'LANING MASTERCLASS' },
    seed: 4002,
    probes: 'full-height figure — the placeholder has no legs to stand on',
  },
  {
    id: 'hero-godray-keria',
    templateId: 'hero-godray',
    category: 'hero',
    subjects: [{ player: 'Keria', side: 'center' }],
    text: { headline: 'SILENCE', kicker: 'THE SUPPORT' },
    seed: 4003,
    probes: 'near-silhouette — the one treatment where a placeholder is legitimate',
  },

  // ── roster ────────────────────────────────────────────────────────────────
  {
    id: 'roster-reveal-kc',
    templateId: 'roster-reveal',
    category: 'roster',
    subjects: team(KC, 'center'),
    text: { headline: 'THE 2026 ROSTER', kicker: 'KARMINE CORP', subhead: 'FULL LINEUP REVEALED', date: 'NOV 20' },
    seed: 5001,
    probes: 'five faces in a row at announcement size',
  },
  {
    id: 'transfer-alert-peyz',
    templateId: 'transfer-alert',
    category: 'roster',
    subjects: [{ player: 'Peyz', side: 'left' }],
    text: { headline: 'PEYZ TO T1', kicker: 'OFFICIAL', subhead: 'THE BIGGEST MOVE OF THE WINDOW', badge: 'BREAKING' },
    seed: 5002,
    probes: 'breaking-news geometry with a long subhead',
  },

  // ── tierlist ──────────────────────────────────────────────────────────────
  {
    id: 'tierlist-grid-mids',
    templateId: 'tierlist-grid',
    category: 'tierlist',
    subjects: [
      { player: 'Faker' },
      { player: 'Chovy' },
      { player: 'Caps' },
      { player: 'Zeka' },
      { player: 'Bdd' },
      { player: 'ShowMaker' },
      { player: 'kyeahoo' },
      { player: 'Ruler' },
    ],
    text: { headline: 'MID LANE TIER LIST', kicker: '2026 SPRING', subhead: 'EVERY STARTER RANKED', caption: 'S / A / B' },
    seed: 6001,
    probes: 'eight subjects on a grid — the classic YouTube tier-list format',
  },
  {
    id: 'ranking-podium-top3',
    templateId: 'ranking-podium',
    category: 'tierlist',
    subjects: [{ player: 'Chovy' }, { player: 'Faker' }, { player: 'Caps' }],
    text: { headline: 'TOP 3 MIDS', subhead: 'RANKED', rank: '1', caption: 'NO DEBATE' },
    seed: 6002,
    probes: 'a ceremony layout with a hierarchy of three',
  },

  // ── analysis ──────────────────────────────────────────────────────────────
  {
    id: 'analysis-callout-bdd',
    templateId: 'analysis-callout',
    category: 'analysis',
    subjects: [{ player: 'Bdd', side: 'left' }],
    text: {
      headline: 'HOW BDD BROKE THE MAP',
      kicker: 'ANALYSIS',
      subhead: 'THE 14-MINUTE ROTATION',
      caption: 'FRAME BY FRAME',
      stat: '+3.2K',
    },
    seed: 7001,
    probes: 'the densest text load in the library — five slots on one canvas',
  },
  {
    id: 'breakdown-split-showmaker',
    templateId: 'breakdown-split',
    category: 'analysis',
    subjects: [{ player: 'ShowMaker', side: 'left' }],
    text: { headline: 'WHAT WENT WRONG', stat: '0-7', kicker: 'BREAKDOWN', subhead: 'DPLUS KIA GAME 3' },
    seed: 7002,
    probes: 'horizontal division with a big number',
  },

  // ── drama ─────────────────────────────────────────────────────────────────
  {
    id: 'drama-reaction-faker',
    templateId: 'drama-reaction',
    category: 'drama',
    subjects: [{ player: 'Faker', side: 'center' }],
    text: { headline: 'HE SAID WHAT?!', kicker: 'POST-GAME', badge: 'DRAMA' },
    seed: 8001,
    probes: 'the highest-CTR format on YouTube, and the one that lives or dies on the face',
  },
  {
    id: 'controversy-split-faker-chovy',
    templateId: 'controversy-split',
    category: 'drama',
    subjects: pair('Faker', 'Chovy'),
    text: { headline: 'THE FALLOUT', kicker: 'WHAT REALLY HAPPENED', badge: 'EXCLUSIVE' },
    seed: 8002,
    probes: 'two subjects turned away from each other',
  },

  // ── stat ──────────────────────────────────────────────────────────────────
  {
    id: 'stat-record-ruler',
    templateId: 'stat-record',
    category: 'stat',
    subjects: [{ player: 'Ruler', side: 'right' }],
    text: { stat: '10,000', caption: 'CAREER KILLS', kicker: 'RECORD', subhead: 'FIRST IN LCK HISTORY' },
    seed: 9001,
    probes: 'an enormous number next to a subject',
  },
  {
    id: 'stat-compare-peyz-viper',
    templateId: 'stat-compare',
    category: 'stat',
    subjects: pair('Peyz', 'Viper'),
    text: { headline: 'BY THE NUMBERS', stat: '4.8 / 3.1', kicker: 'KDA' },
    seed: 9002,
    probes: 'two columns of figures — does the divider hold?',
  },

  // ── tournament ────────────────────────────────────────────────────────────
  {
    id: 'tournament-preview-worlds',
    templateId: 'tournament-preview',
    category: 'tournament',
    subjects: [{ player: 'Faker' }, { player: 'Chovy' }, { player: 'Caps' }, { player: 'Zeus' }],
    text: { headline: 'WORLDS 2026', kicker: 'THE FAVOURITES', subhead: 'EVERY CONTENDER RANKED', date: 'OCT 3' },
    seed: 10001,
    probes: 'event key art — four subjects behind a centred type block',
  },
  {
    id: 'bracket-clash-faker-caps',
    templateId: 'bracket-clash',
    category: 'tournament',
    subjects: pair('Faker', 'Caps'),
    text: { kicker: 'SEMI-FINAL', badge: 'BO5' },
    seed: 10002,
    probes: 'bracket ladder plus two contenders',
  },

  // ── celebration ───────────────────────────────────────────────────────────
  {
    id: 'trophy-lift-keria',
    templateId: 'trophy-lift',
    category: 'celebration',
    subjects: [{ player: 'Keria', side: 'right' }],
    text: { headline: 'CHAMPIONS', kicker: 'T1', subhead: 'BACK ON TOP', date: '2026' },
    seed: 11001,
    probes: 'low-angle lift — needs a full body the placeholder does not have',
  },
  {
    id: 'champion-crowned-faker',
    templateId: 'champion-crowned',
    category: 'celebration',
    subjects: [{ player: 'Faker', side: 'center' }],
    text: { headline: 'CROWNED', subhead: 'SIX TIME WORLD CHAMPION', kicker: 'WORLDS 2026' },
    seed: 11002,
    probes: 'dead-centre bust with a halo ring',
  },

  // ── shorts ────────────────────────────────────────────────────────────────
  {
    id: 'shorts-versus-peyz-viper',
    templateId: 'shorts-versus',
    category: 'shorts',
    subjects: pair('Peyz', 'Viper'),
    text: { headline: 'WHO WINS?', kicker: 'ADC 1v1', badge: 'VOTE' },
    aspect: 'shorts',
    seed: 12001,
    probes: 'the vertical format — 1080x1920, judged on a phone at arm’s length',
  },
  {
    id: 'shorts-hero-faker',
    templateId: 'shorts-hero',
    category: 'shorts',
    subjects: [{ player: 'Faker', side: 'center' }],
    text: { headline: 'THE LAST PENTAKILL', kicker: 'CLIP OF THE WEEK' },
    aspect: 'shorts',
    seed: 12002,
    probes: 'one face filling the top half of a vertical',
  },

  // ── draft ─────────────────────────────────────────────────────────────────
  {
    id: 'pickban-duel-chovy-faker',
    templateId: 'pickban-duel',
    category: 'draft',
    subjects: pair('Chovy', 'Faker'),
    text: { kicker: 'DRAFT WAR', badge: 'GAME 5' },
    seed: 13001,
    probes: 'two champion pick panels — the only layout with product art slots',
  },
  {
    id: 'champion-pool-caps',
    templateId: 'champion-pool',
    category: 'draft',
    subjects: [{ player: 'Caps', side: 'left' }],
    text: { headline: 'THE CAPS POOL', kicker: 'EVERY PICK', caption: '17 CHAMPIONS' },
    seed: 13002,
    probes: 'one player against a wall of champions',
  },

  // ── mvp ───────────────────────────────────────────────────────────────────
  {
    id: 'mvp-card-peyz',
    templateId: 'mvp-card',
    category: 'mvp',
    subjects: [{ player: 'Peyz', side: 'left' }],
    text: { headline: 'MVP', stat: '11/0/6', caption: 'GAME 5', subhead: 'PLAYER OF THE SERIES', kicker: 'LCK FINAL' },
    seed: 14001,
    probes: 'the card frame — a portrait treatment with a stat block',
  },

  // ── stream ────────────────────────────────────────────────────────────────
  {
    id: 'podcast-panel-three',
    templateId: 'podcast-panel',
    category: 'stream',
    subjects: [{ player: 'Caps' }, { player: 'Faker' }, { player: 'Chovy' }],
    text: { headline: 'THE OFFSEASON POD', caption: 'EP 42', kicker: 'EVERY TRANSFER EXPLAINED' },
    seed: 15001,
    probes: 'three seated panellists — a talking-head format',
  },
  {
    id: 'watchparty-live-caps',
    templateId: 'watchparty-live',
    category: 'stream',
    subjects: [{ player: 'Caps', side: 'center' }],
    text: { headline: 'WATCHING LEC', subhead: 'WITH CHAT', caption: 'LIVE NOW', kicker: 'CO-STREAM', date: 'TODAY' },
    seed: 15002,
    probes: 'a live card — the most text-heavy stream layout',
  },
];

// ── recording ────────────────────────────────────────────────────────────────

interface Record_ {
  id: string;
  templateId: string;
  category: string;
  aspect: string;
  cast: string[];
  probes: string;
  ok: boolean;
  error?: string;
  ms?: number;
  bestPath?: string;
  qaScore?: number;
  qaPassed?: boolean;
  appeal?: number;
  gateScores?: Record<string, number>;
  findings?: { gate: string; severity: string; message: string; suggestion?: string }[];
  warnings?: string[];
  variantPaths?: string[];
  bytes?: number;
  dims?: string;
}

/** A contact sheet with labels that are actually given room to be read. */
async function sheet(
  cells: { buffer: Buffer; label: string; sub: string }[],
  cols: number,
  width = 1800,
): Promise<Buffer> {
  const pad = 16;
  const gap = 14;
  const labelH = 46;
  const cellW = Math.floor((width - pad * 2 - gap * (cols - 1)) / cols);

  const tiles = await Promise.all(
    cells.map(async (c) => {
      const meta = await sharp(c.buffer).metadata();
      const h = Math.max(1, Math.round((cellW * (meta.height ?? 1)) / (meta.width ?? 1)));
      return {
        ...c,
        h,
        png: await sharp(c.buffer).resize(cellW, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer(),
      };
    }),
  );

  const rows = Math.ceil(tiles.length / cols);
  const rowH: number[] = [];
  for (let r = 0; r < rows; r++) {
    let tallest = 0;
    for (let c = 0; c < cols; c++) tallest = Math.max(tallest, tiles[r * cols + c]?.h ?? 0);
    rowH.push(tallest + labelH);
  }
  const height = pad * 2 + rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1);

  const composites: sharp.OverlayOptions[] = [];
  const svg: string[] = [];
  let y = pad;
  for (let r = 0; r < rows; r++) {
    let x = pad;
    for (let c = 0; c < cols; c++) {
      const t = tiles[r * cols + c];
      if (t) {
        composites.push({ input: t.png, left: x, top: y });
        svg.push(
          `<rect x="${x - 0.5}" y="${y - 0.5}" width="${cellW + 1}" height="${t.h + 1}" fill="none" stroke="#33333F" stroke-width="1"/>`,
          `<text x="${x}" y="${y + t.h + 20}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#F2F2F8">${esc(t.label)}</text>`,
          `<text x="${x}" y="${y + t.h + 38}" font-family="sans-serif" font-size="13" fill="#9A9AAA">${esc(t.sub)}</text>`,
        );
      }
      x += cellW + gap;
    }
    y += rowH[r]! + gap;
  }

  return sharp({ create: { width, height, channels: 3, background: '#141419' } })
    .composite([
      ...composites,
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg.join('')}</svg>`), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const filter = process.argv.slice(2);
  const selected = filter.length
    ? CASES.filter((c) => filter.includes(c.category) || filter.includes(c.id) || filter.includes(c.templateId))
    : CASES;

  await mkdir(OUT, { recursive: true });
  await mkdir(SHEETS, { recursive: true });

  const { generateThumbnail } = await import('@hexa/pipeline');
  const records: Record_[] = [];

  console.log(`\nHexa showcase — ${selected.length} cases → ${OUT}\n`);

  for (const c of selected) {
    const dir = join(OUT, c.category);
    await mkdir(dir, { recursive: true });
    const t0 = performance.now();
    try {
      const res = await generateThumbnail({
        templateId: c.templateId,
        subjects: c.subjects,
        text: c.text,
        aspect: c.aspect ?? 'youtube',
        variants: c.variants ?? 1,
        seed: c.seed,
        output: { dir, name: c.id, emitPlan: false, contactSheet: (c.variants ?? 1) > 1 },
      });
      const ms = performance.now() - t0;
      const best = res.variants[res.bestIndex] ?? res.variants[0];
      if (!best) throw new Error('no variants produced');
      const meta = await sharp(best.path).metadata();
      const stat = await sharp(best.path).stats();
      records.push({
        id: c.id,
        templateId: c.templateId,
        category: c.category,
        aspect: c.aspect ?? 'youtube',
        cast: c.subjects.map((s) => s.player),
        probes: c.probes,
        ok: true,
        ms: Math.round(ms),
        bestPath: best.path,
        qaScore: Math.round(best.qa.score),
        qaPassed: best.qa.passed,
        appeal: Math.round(best.appeal),
        gateScores: Object.fromEntries(Object.entries(best.qa.gateScores).map(([k, v]) => [k, Number(v.toFixed(3))])),
        findings: best.qa.findings.map((f) => ({ gate: f.gate, severity: f.severity, message: f.message, ...(f.suggestion ? { suggestion: f.suggestion } : {}) })),
        warnings: [...new Set(res.warnings)],
        variantPaths: res.variants.map((v) => v.path),
        dims: `${meta.width}x${meta.height}`,
        bytes: meta.size,
      });
      const worst = best.qa.findings.filter((f) => f.severity !== 'pass').length;
      console.log(
        `  ok  ${c.id.padEnd(36)} qa=${String(Math.round(best.qa.score)).padStart(3)} appeal=${String(Math.round(best.appeal)).padStart(3)} ` +
          `${worst} finding(s) ${(ms / 1000).toFixed(1)}s ${stat.channels.map((ch) => ch.mean.toFixed(0)).join('/')}`,
      );
    } catch (err) {
      records.push({
        id: c.id,
        templateId: c.templateId,
        category: c.category,
        aspect: c.aspect ?? 'youtube',
        cast: c.subjects.map((s) => s.player),
        probes: c.probes,
        ok: false,
        error: err instanceof Error ? `${err.message}` : String(err),
        ms: Math.round(performance.now() - t0),
      });
      console.log(`  FAIL ${c.id.padEnd(36)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── per-category contact sheets ────────────────────────────────────────────
  const byCategory = new Map<string, Record_[]>();
  for (const r of records) {
    if (!r.ok || !r.bestPath) continue;
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  for (const [category, list] of byCategory) {
    const cells = await Promise.all(
      list.map(async (r) => ({
        buffer: await sharp(r.bestPath!).png().toBuffer(),
        label: r.templateId,
        sub: `qa ${r.qaScore} · appeal ${r.appeal} · ${r.cast.slice(0, 3).join(' / ')}${r.cast.length > 3 ? ` +${r.cast.length - 3}` : ''}`,
      })),
    );
    const cols = category === 'shorts' ? Math.min(4, cells.length) : Math.min(2, cells.length);
    const buf = await sheet(cells, cols);
    const dest = join(SHEETS, `${category}.png`);
    await writeFile(dest, buf);
    console.log(`  sheet ${category} → ${dest} (${cells.length} tile(s))`);
  }

  // ── one master sheet: best render of every template ────────────────────────
  const all = records.filter((r) => r.ok && r.bestPath);
  if (all.length) {
    const cells = await Promise.all(
      all.map(async (r) => ({
        buffer: await sharp(r.bestPath!).resize(640, 360, { fit: 'contain', background: '#141419' }).png().toBuffer(),
        label: r.templateId,
        sub: `${r.category} · qa ${r.qaScore} · appeal ${r.appeal}`,
      })),
    );
    await writeFile(join(SHEETS, 'all-templates.png'), await sheet(cells, 4, 2000));
    console.log(`  sheet ALL → ${join(SHEETS, 'all-templates.png')}`);
  }

  await writeFile(join(OUT, 'index.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);

  const ok = records.filter((r) => r.ok);
  const scores = ok.map((r) => r.qaScore ?? 0);
  const appeals = ok.map((r) => r.appeal ?? 0);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  console.log(
    `\n${ok.length}/${records.length} rendered · qa mean ${mean(scores).toFixed(1)} ` +
      `[${Math.min(...scores)}–${Math.max(...scores)}] · appeal mean ${mean(appeals).toFixed(1)} ` +
      `[${Math.min(...appeals)}–${Math.max(...appeals)}] · ` +
      `${ok.filter((r) => r.qaPassed === false).length} failed QA · total ${(ok.reduce((a, r) => a + (r.ms ?? 0), 0) / 1000).toFixed(0)}s`,
  );
  console.log(`index → ${join(OUT, 'index.json')}\n`);
  if (records.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
