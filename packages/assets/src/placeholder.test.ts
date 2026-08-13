import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { isHexaError } from '@hexa/core';
import { buildPlaceholderSvg, generatePlaceholder } from './placeholder.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function pixels(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    info,
    at(x: number, y: number) {
      const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
      return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
    },
    data,
  };
}

describe('generatePlaceholder', () => {
  it('returns a real PNG with a genuine alpha channel', async () => {
    const buf = await generatePlaceholder({ width: 400, height: 600, label: 'Peyz', accent: '#FF6B1A' });
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

    const md = await sharp(buf).metadata();
    expect(md.format).toBe('png');
    expect(md.channels).toBe(4);
    expect(md.hasAlpha).toBe(true);
    expect(md.width).toBe(400);
    expect(md.height).toBe(600);
  });

  it('is a cutout: transparent background, opaque silhouette', async () => {
    const buf = await generatePlaceholder({ width: 400, height: 600, label: 'Peyz', accent: '#FF6B1A', kind: 'portrait' });
    const px = await pixels(buf);

    // The very corner sits outside the dashed frame — nothing is drawn there.
    expect(px.at(0, 0).a).toBe(0);
    expect(px.at(399, 599).a).toBe(0);

    // The head sits at ~30% height on the centre line and must be solid, so a
    // matting-aware compositor sees a real shape.
    expect(px.at(200, 180).a).toBe(255);
    // …as do the shoulders, which bleed off the bottom edge.
    expect(px.at(200, 595).a).toBe(255);
  });

  it('gives the layout engine a measurable alpha shape (a minority of the frame)', async () => {
    const buf = await generatePlaceholder({ width: 200, height: 300, label: 'Zeus', accent: '#1AA7FF' });
    const px = await pixels(buf);
    let opaque = 0;
    for (let i = 3; i < px.data.length; i += px.info.channels) if (px.data[i]! > 200) opaque++;
    const coverage = opaque / (px.info.width * px.info.height);
    expect(coverage).toBeGreaterThan(0.1); // there is a body
    expect(coverage).toBeLessThan(0.8); // but it is a cutout, not a filled card
  });

  it('varies the silhouette by seed and is byte-identical for the same seed', async () => {
    const opts = { width: 240, height: 320, label: 'Player', accent: '#8A2BE2' } as const;
    const a1 = await generatePlaceholder({ ...opts, seed: 1 });
    const a2 = await generatePlaceholder({ ...opts, seed: 1 });
    const b = await generatePlaceholder({ ...opts, seed: 2 });

    expect(a1.equals(a2)).toBe(true); // deterministic ⇒ renders stay cacheable
    expect(a1.equals(b)).toBe(false); // seeded variety ⇒ a row of placeholders is not rubber-stamped
  });

  it('defaults the seed from the label, so one player always gets one shape', async () => {
    const base = { width: 240, height: 320, accent: '#00B37A' } as const;
    const peyz1 = await generatePlaceholder({ ...base, label: 'Peyz' });
    const peyz2 = await generatePlaceholder({ ...base, label: 'Peyz' });
    const zeus = await generatePlaceholder({ ...base, label: 'Zeus' });
    expect(peyz1.equals(peyz2)).toBe(true);
    expect(peyz1.equals(zeus)).toBe(false);
  });

  it('renders a full-bleed opaque plate for backplates and a mark for logos', async () => {
    const back = await pixels(await generatePlaceholder({ width: 320, height: 180, label: 'Arena', accent: '#6C4CFF', kind: 'backplate' }));
    expect(back.at(2, 2).a).toBe(255);
    expect(back.at(318, 178).a).toBe(255);

    const logo = await pixels(await generatePlaceholder({ width: 300, height: 300, label: 'HLE', accent: '#FF6B1A', kind: 'logo' }));
    expect(logo.at(150, 150).a).toBe(255); // the mark
    expect(logo.at(1, 1).a).toBe(0); // still a cutout
  });

  it('tints with the accent colour', async () => {
    const orange = await pixels(await generatePlaceholder({ width: 200, height: 300, label: 'A', accent: '#FF6B1A', seed: 7 }));
    const blue = await pixels(await generatePlaceholder({ width: 200, height: 300, label: 'A', accent: '#1A6BFF', seed: 7 }));
    const o = orange.at(100, 90);
    const b = blue.at(100, 90);
    expect(o.r).toBeGreaterThan(o.b);
    expect(b.b).toBeGreaterThan(b.r);
  });

  it('rejects nonsense dimensions and colours with INVALID_REQUEST', async () => {
    for (const bad of [
      { width: 0, height: 100, label: 'x', accent: '#fff' },
      { width: 100, height: -3, label: 'x', accent: '#fff' },
      { width: 99999, height: 100, label: 'x', accent: '#fff' },
      { width: 100, height: 100, label: 'x', accent: 'not-a-colour' },
    ]) {
      await expect(generatePlaceholder(bad)).rejects.toSatisfy(
        (err: unknown) => isHexaError(err) && err.code === 'INVALID_REQUEST',
      );
    }
  });
});

describe('buildPlaceholderSvg', () => {
  it('states that it is a placeholder and never draws a face', () => {
    const svg = buildPlaceholderSvg({ width: 400, height: 600, label: 'Peyz', accent: '#FF6B1A' });
    expect(svg).toContain('NO LICENSED REFERENCE');
    expect(svg).toContain('PEYZ');
    // No eyes, nose or mouth geometry — the head carries a crosshair and a "?".
    expect(svg).toContain('>?<');
  });

  it('escapes hostile labels rather than injecting markup', () => {
    const svg = buildPlaceholderSvg({ width: 200, height: 200, label: '<script>alert(1)</script>', accent: '#fff' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;SCRIPT&gt;');
  });

  it('falls back to a readable label when none is given', () => {
    expect(buildPlaceholderSvg({ width: 200, height: 200, label: '   ', accent: '#fff' })).toContain('UNKNOWN');
  });
});
