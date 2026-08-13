import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { HexaError } from '@hexa/core';
import { exportImage, contactSheet, toRaw } from '../src/index.js';

async function swatch(color: { r: number; g: number; b: number }, w = 64, h = 40): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { ...color, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe('exportImage', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('encodes %s', async (format) => {
    const out = await exportImage(await swatch({ r: 200, g: 60, b: 30 }), format, 82);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe(format);
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(40);
  });

  it('preserves colour through a lossless round trip', async () => {
    const out = await exportImage(await swatch({ r: 12, g: 200, b: 90 }), 'png');
    const img = await toRaw(out);
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([12, 200, 90]);
  });

  it('flattens transparency for JPEG rather than producing garbage', async () => {
    const transparent = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const jpeg = await exportImage(transparent, 'jpeg', 90);
    const img = await toRaw(jpeg);
    expect(img.data[0]!).toBeLessThan(10); // flattened onto black
    expect(img.data[3]).toBe(255);
  });

  it('rejects an unknown format with a typed error', async () => {
    await expect(exportImage(await swatch({ r: 0, g: 0, b: 0 }), 'gif')).rejects.toThrow(HexaError);
    await expect(exportImage(await swatch({ r: 0, g: 0, b: 0 }), 'gif')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe('contactSheet', () => {
  it('tiles images on a column grid with labels', async () => {
    const images = [
      { buffer: await swatch({ r: 255, g: 0, b: 0 }), label: 'red' },
      { buffer: await swatch({ r: 0, g: 255, b: 0 }), label: 'green' },
      { buffer: await swatch({ r: 0, g: 0, b: 255 }), label: 'blue' },
      { buffer: await swatch({ r: 255, g: 255, b: 0 }), label: 'yellow' },
    ];
    const sheet = await contactSheet(images, { cols: 2, width: 800, background: '#000000' });
    const img = await toRaw(sheet);
    expect(img.width).toBe(800);

    const cellW = Math.floor((800 - 2 * Math.round(800 * 0.012) - Math.round(800 * 0.01)) / 2);
    const pad = Math.round(800 * 0.012);
    const at = (x: number, y: number): number[] => {
      const p = (y * img.width + x) * 4;
      return [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!];
    };
    // Row 1: red on the left, green on the right.
    expect(at(pad + 5, pad + 5)[0]).toBeGreaterThan(200);
    expect(at(pad + cellW + Math.round(800 * 0.01) + 5, pad + 5)[1]).toBeGreaterThan(200);
    // Row 2 exists below, and the sheet is taller than one row.
    expect(img.height).toBeGreaterThan(pad * 2 + (cellW * 40) / 64);
  });

  it('keeps aspect ratios and stacks rows by tallest cell', async () => {
    const wide = await swatch({ r: 255, g: 0, b: 0 }, 200, 50);
    const tall = await swatch({ r: 0, g: 0, b: 255 }, 50, 200);
    const sheet = await contactSheet(
      [
        { buffer: wide, label: 'wide' },
        { buffer: tall, label: 'tall' },
      ],
      { cols: 2, width: 600 },
    );
    const meta = await sharp(sheet).metadata();
    const cellW = Math.floor((600 - 2 * Math.round(600 * 0.012) - Math.round(600 * 0.01)) / 2);
    // The row is as tall as the tall cell (4:1 portrait) plus its label.
    expect(meta.height!).toBeGreaterThan(cellW * 3.5);
  });

  it('defaults to three columns', async () => {
    const images = Array.from({ length: 6 }, (_, i) => ({
      buffer: swatch({ r: i * 40, g: 20, b: 20 }),
      label: `v${i}`,
    }));
    const sheet = await contactSheet(
      await Promise.all(images.map(async (i) => ({ buffer: await i.buffer, label: i.label }))),
    );
    const meta = await sharp(sheet).metadata();
    expect(meta.width).toBe(1600);
    // 6 images / 3 cols = 2 rows.
    const cellW = Math.floor((1600 - 2 * Math.round(1600 * 0.012) - 2 * Math.round(1600 * 0.01)) / 3);
    expect(meta.height!).toBeGreaterThan(((cellW * 40) / 64) * 2);
  });

  it('rejects an empty list', async () => {
    await expect(contactSheet([])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
