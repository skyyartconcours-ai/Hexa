/**
 * Minimal ambient types for opentype.js.
 *
 * opentype.js 1.3.x ships no declarations of its own, and `@types/opentype.js`
 * is a separate, occasionally-stale package. This declares exactly the surface
 * `fonts.ts` touches, so a drift in the upstream typings can never break our
 * build — and so the dependency stays genuinely optional.
 */
declare module 'opentype.js' {
  export interface OTGlyph {
    index: number;
    advanceWidth?: number;
    unicode?: number;
  }

  export interface OTFont {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    charToGlyph(c: string): OTGlyph | undefined;
    getAdvanceWidth(text: string, size?: number, options?: unknown): number;
    tables?: {
      os2?: { sCapHeight?: number; sxHeight?: number; usWeightClass?: number };
      head?: { unitsPerEm?: number };
      [key: string]: unknown;
    };
  }

  export function parse(buffer: ArrayBuffer | Uint8Array, opt?: unknown): OTFont;
}
