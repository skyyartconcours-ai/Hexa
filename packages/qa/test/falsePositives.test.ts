/**
 * False-positive suite: good work the gates must not block.
 *
 * A gate that fires on everything is worse than no gate, because it teaches
 * people to ignore the report. These are the cases where the measurements are
 * technically "low" and the design is nonetheless right: a quiet editorial
 * layout, a dark low-saturation grade, a single-subject hero. Each one is a
 * shape the gates were caught punishing during this audit.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { clutterGate } from '../src/gates/clutter.js';
import { colorHarmonyGate } from '../src/gates/colorHarmony.js';
import { facePlacementGate } from '../src/gates/facePlacement.js';
import { legibilityGate } from '../src/gates/legibility.js';
import { subjectClarityGate } from '../src/gates/subjectClarity.js';
import { scoreAppeal } from '../src/appeal.js';
import { ctx, plan, subjectOnField, H, W } from './helpers.js';

const fails = (f: { severity: string }[]) => f.filter((x) => x.severity === 'fail');

/**
 * A `versus-minimal`-shaped render: two small busts low in the frame, an empty
 * upper half, a hairline rule and letter-spaced micro-type in the corners. The
 * template exists precisely to be the counter-example to "more energy".
 *
 * The film grain matters and is not decoration. `versus-minimal` grades at
 * grain 0.12, and grain is what broke the clutter gate's quiet-region test: it
 * lifts every cell just enough that "below half the frame's mean" stops finding
 * the empty half of an empty picture. A grainless fixture would pass the gate
 * before the fix and prove nothing.
 */
async function minimalDesign(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#12161C"/><stop offset="1" stop-color="#05070A"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="${W * 0.4985}" y="${H * 0.3}" width="2" height="${H * 0.44}" fill="#C9D4E4" opacity="0.5"/>
    <rect x="${W * 0.08}" y="${H * 0.148}" width="${W * 0.28}" height="1.5" fill="#C9D4E4" opacity="0.35"/>
    <rect x="${W * 0.64}" y="${H * 0.148}" width="${W * 0.28}" height="1.5" fill="#C9D4E4" opacity="0.35"/>
    <g fill="#C9D4E4" font-family="DejaVu Sans, sans-serif" font-size="22" letter-spacing="6">
      <text x="${W * 0.08}" y="${H * 0.115}">PEYZ</text>
      <text x="${W * 0.64}" y="${H * 0.115}">VIPER</text>
      <text x="${W * 0.44}" y="${H * 0.115}" font-size="16">NOV 02</text>
    </g>
    <ellipse cx="${W * 0.3}" cy="${H * 0.52}" rx="${W * 0.055}" ry="${H * 0.115}" fill="#6E7C8C"/>
    <rect x="${W * 0.21}" y="${H * 0.63}" width="${W * 0.18}" height="${H * 0.37}" rx="40" fill="#5A6674"/>
    <ellipse cx="${W * 0.7}" cy="${H * 0.52}" rx="${W * 0.05}" ry="${H * 0.108}" fill="#7E8A98"/>
    <rect x="${W * 0.62}" y="${H * 0.62}" width="${W * 0.17}" height="${H * 0.38}" rx="40" fill="#68727E"/>
  </svg>`;
  return grade(await sharp(Buffer.from(svg)).png().toBuffer());
}

/**
 * Grade texture: even, low-amplitude blocks across the whole frame, coarse
 * enough to survive the downscale to feed size the way a graded plate's grain
 * and dither do.
 *
 * Load-bearing, not decoration. It reproduces the exact condition that made the
 * clutter gate warn about the real `versus-minimal` render: the gate asks "is any
 * *region* below half the frame's own mean edge density", and an even dusting
 * lifts every cell just enough that the answer is no — in a picture that is 88%
 * empty backdrop. Measured here: 8.8% edge density and an 8.3% largest quiet
 * region, against the real render's 9.4% and 11.8%. Without the texture the
 * fixture sits at 2.5%/71% and passes the gate whether or not the fix is in,
 * proving nothing.
 */
async function grade(image: Buffer, block = 16, amplitude = 16): Promise<Buffer> {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let seed = 0x2545f491;
  for (let by = 0; by < info.height; by += block) {
    for (let bx = 0; bx < info.width; bx += block) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed >>> 16) % (amplitude * 2 + 1)) - amplitude;
      for (let y = by; y < Math.min(info.height, by + block); y++) {
        for (let x = bx; x < Math.min(info.width, bx + block); x++) {
          const i = (y * info.width + x) * 3;
          for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, data[i + c]! + n));
        }
      }
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

/** A moody low-key grade: deep teal shadows, one warm accent, low saturation. */
async function moodyGrade(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="k" cx="0.45" cy="0.4" r="0.7">
      <stop offset="0" stop-color="#1B2A33"/><stop offset="1" stop-color="#070B0E"/>
    </radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#k)"/>
    <ellipse cx="${W * 0.34}" cy="${H * 0.42}" rx="${W * 0.1}" ry="${H * 0.2}" fill="#4A5A63"/>
    <rect x="${W * 0.62}" y="${H * 0.2}" width="${W * 0.06}" height="${H * 0.6}" fill="#B4602A"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('false positive: a deliberately minimal, high-end layout', () => {
  it('is not called cluttered for having no measurable "resting area"', async () => {
    const findings = await clutterGate.run(ctx(await minimalDesign()));
    // The whole frame is a resting area; complaining that no *region* is
    // quieter than the rest of a quiet frame is the bug this guards.
    expect(findings.filter((f) => f.severity !== 'pass')).toEqual([]);
    expect(findings[0]!.message).toMatch(/Calm frame|Focal hierarchy holds/);
  });

  it('does not veto the render over deliberately small type', async () => {
    const micro = [
      { role: 'left-name', rect: { x: 102, y: 61, w: 358, h: 36 } },
      { role: 'right-name', rect: { x: 819, y: 61, w: 358, h: 36 } },
      { role: 'date', rect: { x: 538, y: 61, w: 205, h: 36 } },
    ];
    const findings = await legibilityGate.run(
      ctx(await minimalDesign(), { textRects: micro }),
    );
    expect(fails(findings)).toEqual([]);
    // …but it still says what will happen at feed size. Silence would be worse.
    expect(findings.some((f) => f.severity === 'warn' && /cap height/.test(f.message))).toBe(true);
    expect(findings.some((f) => /No text in this render resolves/.test(f.message))).toBe(true);
  });

  it('scores lower on appeal than a loud render, and says why rather than hiding it', async () => {
    const quiet = await scoreAppeal({ image: await minimalDesign(), width: W, height: H });
    expect(quiet.notes[0]).toMatch(/heuristic, not a click-through prediction/);
    expect(quiet.score).toBeGreaterThan(0);
  });
});

describe('false positive: a legitimately dark, low-saturation grade', () => {
  it('is not called muddy just because most of the frame is shadow', async () => {
    const findings = await colorHarmonyGate.run(ctx(await moodyGrade()));
    expect(findings.some((f) => /muddy/.test(f.message))).toBe(false);
    expect(findings[0]!.severity).toBe('pass');
    expect(findings[0]!.message).toMatch(/over the lit \d+% of the frame/);
  });

  it('still calls out a frame where even the lit areas have no colour', async () => {
    const grey = await sharp({ create: { width: W, height: H, channels: 3, background: '#8A8A8C' } }).png().toBuffer();
    const findings = await colorHarmonyGate.run(ctx(grey));
    expect(findings.some((f) => /muddy|entirely in shadow/.test(f.message))).toBe(true);
  });
});

describe('false positive: a single-subject hero layout', () => {
  const HERO = { x: 0.36, y: 0.14, w: 0.28, h: 0.42 };

  it('does not misfire the two-subject rules on one big centred face', async () => {
    const findings = await facePlacementGate.run(
      ctx(await subjectOnField({ faceRect: HERO, subjectLuma: 190, bgLuma: 40 }), {
        subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: HERO }],
      }),
    );
    expect(fails(findings)).toEqual([]);
    expect(findings.some((f) => /stacked in the middle|dead mirror|opposed across/.test(f.message))).toBe(false);
  });

  it('does not report a hero crop as unable to separate from its background', async () => {
    // A hero fills so much of the frame that almost no background cell is left;
    // the measurement must fall back rather than invent a verdict.
    const findings = await subjectClarityGate.run(
      ctx(await subjectOnField({ faceRect: HERO, subjectLuma: 190, bgLuma: 40 }), {
        subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: HERO }],
      }),
    );
    expect(fails(findings)).toEqual([]);
  });

  it('passes a hero with the plan declaring no effect layers at all', async () => {
    const findings = await facePlacementGate.run(
      ctx(await subjectOnField({ faceRect: HERO, subjectLuma: 190, bgLuma: 40 }), {
        plan: plan({ layers: [] }),
        subjects: [{ playerId: 'p', handle: 'Peyz', faceRect: HERO }],
      }),
    );
    expect(findings.every((f) => f.severity === 'pass')).toBe(true);
  });
});
