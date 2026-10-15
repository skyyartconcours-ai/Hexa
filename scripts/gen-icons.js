// Generates the PWA icons (purple square with a white gift) without any image library.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../server/public/icons/', import.meta.url);

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PURPLE = [0x91, 0x46, 0xff, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function inGift(x, y) {
  const box = x > 0.26 && x < 0.74 && y > 0.44 && y < 0.78;
  const lid = x > 0.22 && x < 0.78 && y > 0.32 && y < 0.44;
  const ribbon = Math.abs(x - 0.5) < 0.035 && y > 0.32 && y < 0.78;
  const bowL = (x - 0.42) ** 2 / 0.006 + (y - 0.25) ** 2 / 0.003 < 1;
  const bowR = (x - 0.58) ** 2 / 0.006 + (y - 0.25) ** 2 / 0.003 < 1;
  const gap = y > 0.425 && y < 0.455;
  return { solid: (box || lid || bowL || bowR) && !gap, ribbon };
}

const icon = (x, y) => {
  const { solid, ribbon } = inGift(x, y);
  if (ribbon && solid) return PURPLE;
  return solid ? WHITE : PURPLE;
};

// Monochrome badge for Android's status bar: white gift on transparent.
const badge = (x, y) => {
  const { solid, ribbon } = inGift(x, y);
  return solid && !ribbon ? WHITE : CLEAR;
};

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('icon-192.png', OUT), png(192, icon));
writeFileSync(new URL('icon-512.png', OUT), png(512, icon));
writeFileSync(new URL('badge-96.png', OUT), png(96, badge));
console.log('Icons written to server/public/icons/');
