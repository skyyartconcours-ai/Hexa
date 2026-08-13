/**
 * @hexa/type adapter — typography.
 *
 * Text comes back as a complete, self-contained `<svg>` document that becomes a
 * `{type:'svg'}` layer. The other half of the return matters just as much: the
 * *resolved* rect, colour and font size are recorded into `plan.meta.textRects`
 * so the QA contrast and legibility gates measure the type that was actually
 * drawn rather than the slot it was asked to fill.
 *
 * The translations here are the role→preset and the axis→style mappings. The
 * pipeline speaks in `TextRole` ('headline', 'left-name') and in variant axes
 * ('clash', 'stencil'); @hexa/type speaks in preset names ('headline-heavy') and
 * its own seven VS treatments. Both mappings live here, in one table each,
 * rather than being spelled out at call sites.
 */

import type { PixelRect, TextRole } from '@hexa/core';
import { HexaError } from '@hexa/core';
import { loadModule } from './load.js';
import {
  TYPE_EXPORTS,
  type LayoutTextInput,
  type PresetName,
  type TextStyle,
  type TypeModule,
  type VersusStyle,
} from './contracts.js';

const SPEC = '@hexa/type';
const HINT = 'The typography package is not built. Run: pnpm --filter @hexa/type build';

async function mod(): Promise<TypeModule> {
  return loadModule<TypeModule>(SPEC, { needs: TYPE_EXPORTS, hint: HINT });
}

/**
 * Which preset each text role reaches for.
 *
 * A headline is a hero line with an outline that survives being shrunk to
 * 210px; a player name is a nameplate; a team tag is a compact monospaced mark.
 * Getting this table right is most of what makes generated type look designed.
 */
export const ROLE_PRESETS: Readonly<Record<TextRole, PresetName>> = {
  headline: 'headline-heavy',
  subhead: 'headline-condensed',
  kicker: 'stat-label',
  vs: 'vs-mark',
  'left-name': 'player-name',
  'right-name': 'player-name',
  'left-team': 'team-tag',
  'right-team': 'team-tag',
  badge: 'date-badge',
  stat: 'stat-value',
  caption: 'stat-label',
  rank: 'rank-number',
  date: 'date-badge',
};

/** Variant versus-mark axis → the treatments @hexa/type actually ships. */
const VERSUS_STYLES: Readonly<Record<string, VersusStyle>> = {
  slash: 'slash',
  bolt: 'bolt',
  hex: 'hex',
  clash: 'blade',
  stencil: 'shield',
  minimal: 'plain',
  template: 'slash',
};

export function versusStyleFor(axis: string | undefined): VersusStyle {
  return VERSUS_STYLES[axis ?? 'template'] ?? 'slash';
}

/** What the compiler needs back from a text fit. */
export interface TextFit {
  markup: string;
  /** The rect the glyphs actually occupy. */
  rect: PixelRect;
  fontSize: number;
  color: string;
  lines: string[];
}

export interface FitTextInput {
  text: string;
  rect: PixelRect;
  role: TextRole;
  color: string;
  align?: 'left' | 'center' | 'right';
  anchor?: LayoutTextInput['anchor'];
  maxLines?: number;
  /** Extra style overrides layered on the role's preset. */
  style?: Partial<TextStyle>;
}

/**
 * Fit copy inside a rect, shrinking and wrapping until it fits.
 *
 * Autofit rather than a fixed size because thumbnail copy is user-supplied:
 * "RIVALS" and "THE GREATEST UPSET IN LCK HISTORY" go into the same slot and
 * both have to look deliberate.
 */
export async function fitText(input: FitTextInput): Promise<TextFit> {
  const m = await mod();

  let style: TextStyle;
  try {
    style = m.preset(ROLE_PRESETS[input.role] ?? 'headline-heavy', {
      fill: input.color,
      ...(input.style ?? {}),
    });
  } catch (cause) {
    throw new HexaError('FONT_MISSING', `No typographic preset for role "${input.role}"`, {
      hint: 'The preset table in @hexa/type has changed — update ROLE_PRESETS in packages/pipeline/src/adapters/type.ts.',
      cause,
    });
  }

  const laid = m.autoFit({
    block: { text: input.text, style, align: input.align ?? 'center' },
    box: input.rect,
    anchor: input.anchor ?? 'center',
    maxLines: input.maxLines ?? 2,
  });

  if (!laid?.markup) {
    throw new HexaError('FONT_MISSING', `autoFit("${input.text.slice(0, 24)}") produced no SVG markup`, {
      hint: 'Fonts may be missing — run `hexa doctor`. If fonts are fine, @hexa/type\'s return shape has drifted; fix packages/pipeline/src/adapters/type.ts.',
    });
  }

  return {
    markup: laid.markup,
    rect: laid.box ?? input.rect,
    fontSize: laid.fontSize ?? 0,
    color: input.color,
    lines: laid.lines ?? [input.text],
  };
}

export interface VersusInput {
  rect: PixelRect;
  text?: string;
  style?: string;
  left: string;
  right: string;
  accent: string;
}

/**
 * The versus mark — the graphic device that makes a 1v1 read as a clash.
 *
 * The mark is square and sized by its height, so it is centred inside the slot
 * rect rather than stretched to fill it: a stretched VS is the tell of a
 * generated thumbnail.
 */
export async function versusMark(input: VersusInput): Promise<TextFit> {
  const m = await mod();
  const size = Math.max(24, Math.min(input.rect.w, input.rect.h));

  const mark = m.versusMark({
    size,
    style: versusStyleFor(input.style),
    leftColor: input.left,
    rightColor: input.right,
    text: input.text,
    strokeColor: input.accent,
    glow: true,
  });

  if (!mark?.markup) {
    throw new HexaError('FONT_MISSING', 'versusMark produced no SVG markup', {
      hint: 'Fonts may be missing — run `hexa doctor`.',
    });
  }

  const w = mark.width || size;
  const h = mark.height || size;
  return {
    markup: mark.markup,
    rect: {
      x: Math.round(input.rect.x + (input.rect.w - w) / 2),
      y: Math.round(input.rect.y + (input.rect.h - h) / 2),
      w: Math.round(w),
      h: Math.round(h),
    },
    fontSize: size,
    color: input.accent,
    lines: [input.text ?? 'VS'],
  };
}

/**
 * Load/verify the font stack.
 *
 * Never throws — `hexa doctor` wants the diagnosis, not an exception. Note that
 * @hexa/type is designed to work without fonts installed (it falls back to
 * calibrated metrics), so a failure here is a quality warning, not a blocker.
 */
export async function ensureFonts(): Promise<{ ok: boolean; exact: boolean; error?: string }> {
  try {
    const m = await mod();
    await m.ensureFonts();
    const exact = typeof m.exactMeasurementAvailable === 'function' ? m.exactMeasurementAvailable() : true;
    return { ok: true, exact };
  } catch (e) {
    return { ok: false, exact: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fontStack(family?: string): Promise<string> {
  try {
    return (await mod()).fontStack(family) ?? '';
  } catch {
    return '';
  }
}

export async function presetNames(): Promise<string[]> {
  try {
    return Object.keys((await mod()).PRESETS ?? {}).sort();
  } catch {
    return [];
  }
}

export type { TextStyle };
