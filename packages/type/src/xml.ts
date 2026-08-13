/**
 * XML/SVG serialisation primitives.
 *
 * Every string that reaches the output — player names, team tags, hex colours
 * pasted from a brand deck — is attacker-shaped as far as this package is
 * concerned. `escapeXml` is the single choke point, and nothing in this package
 * concatenates user text into markup without going through it.
 */

/** Characters XML 1.0 forbids outright: C0 controls other than tab/LF/CR,
 *  plus the two permanently-unassigned noncharacters at the end of the BMP. */
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
/** Halves of a surrogate pair with no partner — legal JS, illegal XML. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Escape text for use in either element content or a double/single quoted
 * attribute value. Well-formed astral characters (emoji, CJK) pass through
 * untouched — they are legal XML; lone surrogates become U+FFFD because they
 * would otherwise produce a document no parser will accept.
 */
export function escapeXml(input: unknown): string {
  const s = input === null || input === undefined ? '' : String(input);
  return s
    .replace(LONE_SURROGATE, '�')
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format a number for an SVG attribute: 3 decimal places, no exponent
 * notation, no `-0`. Keeping this deterministic is what makes two renders of
 * the same input byte-identical.
 */
export function n(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  if (Object.is(r, -0) || r === 0) return '0';
  return Math.abs(r) < 1e-6 ? '0' : String(r);
}

/** Build an attribute list, dropping undefined/null values. */
export function attrs(map: Record<string, string | number | undefined | null>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || v === null || v === '') continue;
    out.push(`${k}="${escapeXml(typeof v === 'number' ? n(v) : v)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/** Wrap a body in a standalone, self-contained SVG document. */
export function svgDocument(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">` +
    body +
    `</svg>`
  );
}

/** `translate(cx,cy) skewX(-deg) translate(-cx,-cy)` — skew about a pivot. */
export function skewAbout(deg: number, cx: number, cy: number): string {
  if (!deg) return '';
  return `translate(${n(cx)},${n(cy)}) skewX(${n(-deg)}) translate(${n(-cx)},${n(-cy)})`;
}
