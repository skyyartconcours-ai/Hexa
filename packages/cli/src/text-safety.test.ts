/**
 * The text → SVG → raster contract, end to end.
 *
 * `hexa gen --title "<whatever the user typed>"` is the shortest path from an
 * arbitrary string to a file on disk, and it crosses three package boundaries
 * to get there: the CLI reads the flag, `@hexa/type` turns it into SVG, and
 * librsvg (through sharp) rasterises it. Each of those packages tests its own
 * half; nobody tests the seam, which is exactly where an escaping bug hides —
 * markup that looks correctly escaped in a string assertion and still produces
 * a document the rasteriser reads differently.
 *
 * So this asserts the *whole* journey for every payload worth worrying about,
 * and lets librsvg have the final word. It lives in the CLI because the CLI is
 * the package that owns that journey and depends on both ends of it.
 *
 * The XXE cases matter most and are the least obvious: an SVG rasteriser is an
 * XML parser plus a resource loader, and the interesting question is not
 * whether Hexa escapes `<!ENTITY` (it does) but whether librsvg would act on
 * one if it ever arrived unescaped. That is a property of the linked library,
 * not of our code, so it is pinned here — if a future libvips upgrade turns
 * external entity loading back on, this fails.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { autoFit, preset, renderText } from '@hexa/type';

/** Payloads from the threat model, each named for what it attacks. */
const PAYLOADS: Record<string, string> = {
  'element break-out': '</text><script>alert(1)</script>',
  'attribute break-out': '" onload="alert(1)',
  'cdata terminator': ']]>',
  'entity reference': '&entity;',
  'numeric NUL reference': '&#x0;',
  'entity-encoded markup': '&lt;script&gt;alert(1)&lt;/script&gt;',
  'doctype with external entity': '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>&xxe;',
  'xlink image reference': '<image xlink:href="file:///etc/passwd" width="100" height="100"/>',
  'processing instruction': '<?xml-stylesheet href="http://evil.test/x.xsl"?>',
  'comment break-out': '--><script>alert(1)</script><!--',
  'raw NUL': 'PE\0YZ',
  'raw control characters': 'ABCD',
  'lone high surrogate': 'A\uD800B',
  'lone low surrogate': 'A\uDC00B',
  'BMP noncharacters': 'A￾B￿C',
  'RTL override': 'A‮bcd‭‏⁦x⁩',
  'combining mark bomb': `e${'́'.repeat(2000)}`,
  'ZWJ emoji sequence': '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'.repeat(20),
  'CJK and Hangul': '한국어 テスト 中文',
  'ampersand storm': '&'.repeat(500),
  'quote storm': `'"`.repeat(500),
};

const style = { ...preset('headline-condensed'), size: 48 };
const box = { x: 0, y: 0, w: 800, h: 200 };

/** Lay out one string exactly as the pipeline does. */
function layout(text: string): string {
  return renderText({ block: { text, style, align: 'center' }, box, anchor: 'center' }).markup;
}

let dir: string;
let marker: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hexa-xxe-'));
  marker = join(dir, 'secret.txt');
  writeFileSync(marker, 'HEXA-XXE-CANARY-9f2b');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('every payload produces well-formed, injection-free markup', () => {
  it.each(Object.entries(PAYLOADS))('%s', (_name, payload) => {
    const svg = layout(payload);

    // One document, one root.
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg /g)?.length).toBe(1);

    // Nothing the payload asked for became a node.
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<!DOCTYPE/i);
    expect(svg).not.toMatch(/<!ENTITY/i);
    expect(svg).not.toMatch(/<\?xml-stylesheet/i);
    expect(svg).not.toMatch(/<!--/);
    expect(svg).not.toMatch(/xlink:href="file:/i);
    // No event-handler attribute. The payload's *text* may still read
    // `ONLOAD=&quot;` inside an escaped run — that is content, not an
    // attribute, so the check is for an `on…=` followed by a real quote.
    expect(svg).not.toMatch(/\son[a-z]+\s*=\s*["']/i);

    // No character XML 1.0 forbids survived into the document.
    // eslint-disable-next-line no-control-regex
    expect(/[\0--￾￿]/.test(svg)).toBe(false);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(svg)).toBe(false);

    // Every `&` that remains opens a real entity reference, not a stray amp.
    const stray = svg.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
    expect(stray).not.toContain('&');
  });
});

describe('every payload rasterises', () => {
  // Some payloads are deliberately expensive to shape — twenty four-person ZWJ
  // emoji sequences take librsvg a little over five seconds here, which the
  // default per-test timeout cuts off. The point of these cases is that they
  // *finish*; the bound that matters (layout time) is asserted separately under
  // "resource bounds on hostile text".
  it.each(Object.entries(PAYLOADS))('%s', async (_name, payload) => {
    // librsvg is the real parser. A document it refuses is a document that
    // reaches production as RENDER_FAILED on somebody's headline.
    const png = await sharp(Buffer.from(layout(payload), 'utf8')).png().toBuffer();
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  }, 30_000);
});

describe('XXE — librsvg must not read files or reach the network', () => {
  /** Rasterise raw SVG and report whether it survived. */
  async function raster(svg: string): Promise<{ ok: boolean; bytes: number; error?: string }> {
    try {
      const out = await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
      return { ok: true, bytes: out.length };
    } catch (err) {
      return { ok: false, bytes: 0, error: (err as Error).message };
    }
  }

  it('refuses to resolve an external entity pointing at a local file', async () => {
    const svg =
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file://${marker}">]>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60">` +
      `<text x="0" y="30" font-size="12">&xxe;</text></svg>`;
    const result = await raster(svg);
    // libxml2 in this build does not load external entities, so the reference
    // is simply undefined and the parse fails. Either outcome is acceptable —
    // what must never happen is a successful render containing the file.
    if (result.ok) throw new Error('external entity was resolved; the canary may be in the output');
    expect(result.error).toMatch(/not defined|entity/i);
  });

  it('does not load a local file through xlink:href on an <image>', async () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">` +
      `<image xlink:href="file://${marker}" width="64" height="64"/></svg>`;
    const result = await raster(svg);
    // A loaded image would produce a materially larger PNG than a blank frame.
    expect(result.ok).toBe(true);
    expect(result.bytes).toBeLessThan(2_000);
  });

  it('does not load a local image file through xlink:href either', async () => {
    const image = join(dir, 'canary.png');
    writeFileSync(
      image,
      await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff00ff' } }).png().toBuffer(),
    );
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">` +
      `<image xlink:href="file://${image}" width="64" height="64"/></svg>`;
    const { data, info } = await sharp(Buffer.from(svg, 'utf8')).raw().toBuffer({ resolveWithObject: true });
    // Magenta would mean the file was loaded. A transparent frame means it was not.
    let magenta = 0;
    for (let i = 0; i + info.channels - 1 < data.length; i += info.channels) {
      if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! > 200) magenta++;
    }
    expect(magenta).toBe(0);
  });

  it('does not fetch a remote reference', async () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">` +
      `<image xlink:href="http://127.0.0.1:1/nothing.png" width="64" height="64"/></svg>`;
    const started = Date.now();
    const result = await raster(svg);
    expect(result.ok).toBe(true);
    expect(result.bytes).toBeLessThan(2_000);
    // A real connection attempt would show up as latency even against a closed port.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('stops an entity-expansion bomb instead of expanding it', async () => {
    const svg =
      `<?xml version="1.0"?><!DOCTYPE svg [` +
      `<!ENTITY a "aaaaaaaaaa">` +
      `<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">` +
      `<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">` +
      `<!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">` +
      `<!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">` +
      `<!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">]>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="0" y="30">&f;</text></svg>`;
    const started = Date.now();
    const result = await raster(svg);
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('resource bounds on hostile text', () => {
  it('lays out a 100k-character headline in bounded time and bounded markup', () => {
    const started = Date.now();
    const laid = renderText({
      block: { text: 'A'.repeat(100_000), style, align: 'left' },
      box,
      maxLines: 3,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    // maxLines is what keeps the document small: without it, 100k characters
    // become 100k characters of markup.
    expect(laid.lines.length).toBeLessThanOrEqual(3);
    expect(laid.markup.length).toBeLessThan(50_000);
  });

  it('autoFit terminates on a combining-mark bomb', () => {
    const started = Date.now();
    const laid = autoFit(
      { block: { text: `e${'́'.repeat(5_000)}`, style, align: 'center' }, box, maxLines: 2 },
      { min: 8, max: 200 },
    );
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(laid.markup.startsWith('<svg ')).toBe(true);
  });

  it('autoFit terminates on a box far too small for the text', () => {
    const laid = autoFit(
      { block: { text: 'IMPOSSIBLY LONG HEADLINE THAT CANNOT FIT', style, align: 'left' }, box: { x: 0, y: 0, w: 4, h: 4 } },
      { min: 8, max: 400 },
    );
    expect(laid.fontSize).toBeGreaterThan(0);
  });

  it('caps extrusion steps so a runaway depth cannot emit 100k copies', () => {
    const laid = renderText({
      block: {
        text: 'DEPTH',
        style: { ...style, extrude: { depth: 100_000, angle: 45, color: '#ff0000', fade: 0.5 } },
        align: 'left',
      },
      box,
    });
    const nodes = (laid.markup.match(/<text/g) ?? []).length;

    // The document is `steps × lines × passes` text nodes, and `steps` is
    // capped at 96 — without that cap this would be 100 000 copies.
    //
    // Worth knowing: the *other* factor is not capped. A depth this absurd
    // eats the whole line box through `decorationOverhang`, leaving ~1px of
    // usable width, so every character wraps onto its own line and the node
    // count becomes 96 × (one line per character). Bounded here only because
    // the headline is five characters long.
    expect(laid.lines.length).toBe('DEPTH'.length);
    expect(nodes).toBeLessThanOrEqual(96 * laid.lines.length + 2 * laid.lines.length);
    expect(nodes).toBeGreaterThan(96); // the cap is the binding constraint, not a no-op
  });

  it('bounds that amplification with maxLines, which is what callers should pass', () => {
    const laid = renderText({
      block: {
        text: 'A MUCH LONGER HEADLINE THAN THAT ONE',
        style: { ...style, extrude: { depth: 100_000, angle: 45, color: '#ff0000', fade: 0.5 } },
        align: 'left',
      },
      box,
      maxLines: 2,
    });
    expect(laid.lines.length).toBeLessThanOrEqual(2);
    expect((laid.markup.match(/<text/g) ?? []).length).toBeLessThanOrEqual(96 * 2 + 4);
  });

  it('refuses a non-finite or non-positive font size rather than looping', () => {
    for (const size of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => renderText({ block: { text: 'X', style: { ...style, size } }, box })).toThrow();
    }
  });

  it('refuses a non-finite or non-positive box rather than looping', () => {
    for (const bad of [{ x: 0, y: 0, w: 0, h: 100 }, { x: 0, y: 0, w: Number.NaN, h: 100 }, { x: 0, y: 0, w: 100, h: -5 }]) {
      expect(() => renderText({ block: { text: 'X', style }, box: bad })).toThrow();
    }
  });
});
