/**
 * Colour utilities.
 *
 * Thumbnail work lives or dies on contrast, so the primitives here are built
 * around perceptual measures (relative luminance, OKLab) rather than naive RGB
 * arithmetic. Mixing two team colours in sRGB produces mud; mixing in OKLab
 * produces the vivid midpoint a designer would pick by hand.
 */

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

/**
 * Parse any colour this codebase produces.
 *
 * `withAlpha` emits `rgba(…)` because that is what SVG and CSS accept, so a
 * strict hex-only parser would refuse core's own output — which is exactly the
 * kind of seam that only shows up once two packages meet. Be liberal in what
 * you accept: hex (3/6/8 digit), `rgb()`, `rgba()`, and the CSS keywords that
 * mean "nothing here".
 */
export function parseColor(input: string): RGB & { a: number } {
  const s = input.trim();
  if (s === 'transparent' || s === 'none') return { r: 0, g: 0, b: 0, a: 0 };

  const rgb = RGB_RE.exec(s);
  if (rgb) {
    const alpha = rgb[4];
    const a = alpha === undefined
      ? 1
      : alpha.endsWith('%')
        ? Number.parseFloat(alpha) / 100
        : Number.parseFloat(alpha);
    return {
      r: Math.max(0, Math.min(255, Number.parseFloat(rgb[1]!))),
      g: Math.max(0, Math.min(255, Number.parseFloat(rgb[2]!))),
      b: Math.max(0, Math.min(255, Number.parseFloat(rgb[3]!))),
      a: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1,
    };
  }

  const m = HEX_RE.exec(s);
  if (!m) throw new Error(`Invalid colour: ${input}`);
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = Number.parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a };
}

/**
 * Alias of {@link parseColor}, kept because most call sites genuinely are
 * parsing hex. The permissive behaviour is deliberate — a stricter variant
 * would break the moment a gradient stop carries an alpha.
 */
export const parseHex = parseColor;

export function toHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB channel → linear light. */
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return v * 255;
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio, 1–21. Text over busy art wants ≥ 4.5. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick whichever of `light`/`dark` reads better on `bg`. */
export function readableOn(bg: string, light = '#FFFFFF', dark = '#0B0B0F'): string {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}

// ── OKLab ────────────────────────────────────────────────────────────────────
// Perceptually uniform space. Interpolating here keeps chroma alive instead of
// dragging blends through grey.

export interface OKLab { L: number; a: number; b: number }

export function hexToOklab(hex: string): OKLab {
  const { r, g, b } = parseHex(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToHex({ L, a, b }: OKLab): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return toHex({
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  });
}

/** Perceptual blend. `t` = 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToOklab(a);
  const B = hexToOklab(b);
  return oklabToHex({
    L: A.L + (B.L - A.L) * t,
    a: A.a + (B.a - A.a) * t,
    b: A.b + (B.b - A.b) * t,
  });
}

/** Scale lightness in OKLab. `amount` > 0 lightens, < 0 darkens. */
export function shade(hex: string, amount: number): string {
  const c = hexToOklab(hex);
  return oklabToHex({ ...c, L: Math.max(0, Math.min(1, c.L + amount)) });
}

/** Multiply chroma — pushes a colour toward neon without shifting hue. */
export function saturate(hex: string, factor: number): string {
  const c = hexToOklab(hex);
  return oklabToHex({ L: c.L, a: c.a * factor, b: c.b * factor });
}

/** Rotate hue by `deg` degrees in OKLab's a/b plane. */
export function rotateHue(hex: string, deg: number): string {
  const c = hexToOklab(hex);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return oklabToHex({ L: c.L, a: c.a * cos - c.b * sin, b: c.a * sin + c.b * cos });
}

/**
 * Ensure two colours are visually distinguishable side by side — critical when
 * both teams brand in similar reds. Returns an adjusted `b`.
 */
export function ensureDistinct(a: string, b: string, minDelta = 0.12): string {
  const A = hexToOklab(a);
  let B = hexToOklab(b);
  const dist = Math.hypot(A.a - B.a, A.b - B.b) + Math.abs(A.L - B.L) * 0.5;
  if (dist >= minDelta) return b;
  // Rotate away from `a` until separated, then push lightness apart as backup.
  for (let step = 20; step <= 180; step += 20) {
    const cand = hexToOklab(rotateHue(b, step));
    const d = Math.hypot(A.a - cand.a, A.b - cand.b) + Math.abs(A.L - cand.L) * 0.5;
    if (d >= minDelta) return oklabToHex(cand);
  }
  B = { ...B, L: A.L > 0.5 ? Math.max(0, A.L - 0.35) : Math.min(1, A.L + 0.35) };
  return oklabToHex(B);
}

/** Complementary colour — the natural choice for an opposing rim light. */
export function complement(hex: string): string {
  return rotateHue(hex, 180);
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
