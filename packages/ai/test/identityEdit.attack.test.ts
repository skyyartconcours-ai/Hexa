/**
 * Adversarial suite for the identity-edit path.
 *
 * `guardIdentityEdit` is a synchronous shape check — it cannot see pixels. That
 * left two holes that both worked: a `preserve` box that does not correspond to
 * anything in the image, and a *mask* that hands the face to the model as an
 * editable region while `preserve` politely claims otherwise. The mask is the
 * dangerous one: OpenAI's edit endpoint repaints wherever the mask is
 * transparent and Stability/Replicate repaint wherever it is white, so a mask
 * that says "the face is editable" beats any instruction in the prompt.
 *
 * `assertIdentityEditSafe` is the async guard that closes both.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assertIdentityEditSafe, guardIdentityEdit } from '../src/guard.js';

const W = 512;
const H = 512;
const FACE = { x: 180, y: 120, w: 160, h: 190 };

async function plate(): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 3, background: '#404050' } }).png().toBuffer();
}

/** Mask whose `editable` rects are transparent (OpenAI convention). */
async function alphaMask(editable: Array<{ x: number; y: number; w: number; h: number }>): Promise<Buffer> {
  // Opaque black everywhere, then punch fully transparent holes.
  const base = await sharp({ create: { width: W, height: H, channels: 4, background: '#000000ff' } }).png().toBuffer();
  if (editable.length === 0) return base;
  const holes = editable
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#ffffff"/>`)
    .join('');
  const cut = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${holes}</svg>`);
  return sharp(base)
    .composite([{ input: cut, blend: 'dest-out' }])
    .png()
    .toBuffer();
}

/** Mask whose `editable` rects are white (Stability/SD convention). */
async function lumaMask(editable: Array<{ x: number; y: number; w: number; h: number }>): Promise<Buffer> {
  const rects = editable
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#ffffff"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000000"/>${rects}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('attack: a mask that repaints the face while `preserve` claims to protect it', () => {
  it('refuses an alpha mask that makes the face editable', async () => {
    const image = await plate();
    const mask = await alphaMask([FACE]);
    await expect(
      assertIdentityEditSafe({ image, mask, prompt: 'cool the background', strength: 0.6, preserve: [FACE] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('refuses a luma mask that makes the face editable', async () => {
    const image = await plate();
    const mask = await lumaMask([FACE]);
    await expect(
      assertIdentityEditSafe({ image, mask, prompt: 'cool the background', strength: 0.6, preserve: [FACE] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('refuses a mask that only clips a corner of the preserved region', async () => {
    const image = await plate();
    // A quarter of the face is enough to change who somebody is.
    const mask = await lumaMask([{ x: FACE.x, y: FACE.y, w: Math.round(FACE.w / 2), h: Math.round(FACE.h / 2) }]);
    await expect(
      assertIdentityEditSafe({ image, mask, prompt: 'relight', strength: 0.5, preserve: [FACE] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('accepts a mask that edits only around the face', async () => {
    const image = await plate();
    const mask = await lumaMask([{ x: 0, y: 400, w: W, h: 112 }]);
    await expect(
      assertIdentityEditSafe({ image, mask, prompt: 'relight the floor', strength: 0.5, preserve: [FACE] }),
    ).resolves.toBeUndefined();
  });

  it('accepts an edit with no mask at all', async () => {
    const image = await plate();
    await expect(
      assertIdentityEditSafe({ image, prompt: 'cool the background', strength: 0.5, preserve: [FACE] }),
    ).resolves.toBeUndefined();
  });

  it('refuses a mask whose dimensions do not match the image', async () => {
    const image = await plate();
    const mask = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000000' } }).png().toBuffer();
    await expect(
      assertIdentityEditSafe({ image, mask, prompt: 'relight', strength: 0.5, preserve: [FACE] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('attack: preserve regions measured against the real image', () => {
  it('refuses a preserve box that falls outside the image', async () => {
    const image = await plate();
    await expect(
      assertIdentityEditSafe({ image, prompt: 'relight', strength: 0.5, preserve: [{ x: 900, y: 900, w: 60, h: 60 }] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('refuses a preserve box that runs off the right edge', async () => {
    const image = await plate();
    await expect(
      assertIdentityEditSafe({ image, prompt: 'relight', strength: 0.5, preserve: [{ x: 480, y: 100, w: 200, h: 200 }] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('refuses an image the decoder cannot read rather than editing it blind', async () => {
    await expect(
      assertIdentityEditSafe({
        image: Buffer.from('not-really-a-png-but-non-empty'),
        prompt: 'relight',
        strength: 0.5,
        preserve: [FACE],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('keeps every synchronous refusal the sync guard already made', async () => {
    const image = await plate();
    await expect(
      assertIdentityEditSafe({ image, prompt: 'relight', strength: 0.9, preserve: [FACE] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      assertIdentityEditSafe({ image, prompt: 'relight', strength: 0.5 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(() => guardIdentityEdit({ image, prompt: 'relight', strength: 0.5, preserve: [FACE] })).not.toThrow();
  });
});
