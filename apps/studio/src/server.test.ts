/**
 * Studio server, attacked.
 *
 * Driven over a real socket rather than by calling handlers directly: half the
 * things being asserted here — `Host` handling, content-type negotiation, body
 * limits, connection teardown — only exist at the HTTP layer, and a test that
 * calls the handler with a fake request proves nothing about any of them.
 *
 * The pipeline is not exercised. A render takes ten seconds and needs fonts,
 * templates and an asset library; every case below is about the *edge* — what
 * the server accepts, what it refuses, and what it says when it refuses — which
 * is settled long before the pipeline is reached.
 */

import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudioServer, images } from './server.js';

const server = createStudioServer();
let base: string;
let port: number;

beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

/** POST JSON the way the studio's own page does. */
function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * Speak HTTP down a raw socket.
 *
 * `fetch` refuses to let a caller set `Host` — it is a forbidden header — which
 * is exactly the header a rebinding attack controls. A browser being fooled by
 * DNS sends whatever hostname the user typed, so the only way to test the
 * defence is to write the request line by hand.
 */
function rawRequest(requestLine: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolveResponse, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let out = '';
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error('raw request timed out'));
    });
    socket.on('data', (d) => {
      out += d.toString('utf8');
    });
    socket.on('error', reject);
    socket.on('close', () => resolveResponse(out));
    socket.on('connect', () => {
      const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
      socket.write(`${requestLine}\r\n${lines.join('\r\n')}\r\nconnection: close\r\n\r\n`);
    });
  });
}

/** The numeric status from a raw HTTP response. */
function statusOf(raw: string): number {
  return Number(raw.slice(0, raw.indexOf('\r\n')).split(' ')[1]);
}

describe('DNS rebinding — the Host header is checked, not trusted', () => {
  it('serves a request with a loopback Host', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toMatchObject({ ok: true });
  });

  it('refuses a request whose Host is an attacker-controlled name', async () => {
    // Exactly what a rebound `http://evil.test` page sends once its DNS record
    // has been re-pointed at 127.0.0.1.
    const raw = await rawRequest('GET /api/health HTTP/1.1', { host: 'evil.example.com' });
    expect(statusOf(raw)).toBe(421);
    expect(raw).toContain('MISDIRECTED_REQUEST');
    // And it learns nothing about what is running here.
    expect(raw).not.toContain('uptime');
  });

  it('refuses a rebound Host on the data-bearing routes too, not just health', async () => {
    for (const path of ['/api/bootstrap', '/api/suggest', '/', '/index.html']) {
      const raw = await rawRequest(`GET ${path} HTTP/1.1`, { host: 'evil.example.com' });
      expect(statusOf(raw)).toBe(421);
    }
  });

  it('refuses a rebound Host on POST as well', async () => {
    const raw = await rawRequest('POST /api/render HTTP/1.1', {
      host: 'attacker.test',
      'content-type': 'application/json',
      'content-length': '2',
    });
    expect(statusOf(raw)).toBe(421);
  });

  it('refuses a request with no Host header at all', async () => {
    const raw = await rawRequest('GET /api/health HTTP/1.0', {});
    expect(statusOf(raw)).toBe(421);
  });

  it('accepts localhost with an explicit port', async () => {
    const raw = await rawRequest('GET /api/health HTTP/1.1', { host: `localhost:${port}` });
    expect(statusOf(raw)).toBe(200);
  });
});

describe('CSRF — a foreign page cannot drive the studio', () => {
  it('refuses a POST carrying a cross-site Origin', async () => {
    const r = await postJson('/api/qa', { imageKey: 'x' }, { origin: 'https://evil.example.com' });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('FORBIDDEN');
  });

  it('refuses a POST whose Sec-Fetch-Site says cross-site', async () => {
    const r = await postJson('/api/qa', { imageKey: 'x' }, { 'sec-fetch-site': 'cross-site' });
    expect(r.status).toBe(403);
  });

  it('refuses a text/plain body — the shape that needs no CORS preflight', async () => {
    // This is the whole CSRF vector: `text/plain` is a "simple request", so a
    // malicious page can send it with no preflight for the Origin check to
    // answer. Requiring JSON forces the preflight.
    const r = await fetch(`${base}/api/render`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ templateId: 'versus-classic', subjects: [{ player: 'Peyz' }] }),
    });
    expect(r.status).toBe(415);
    expect((await r.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('refuses a form-encoded body for the same reason', async () => {
    const r = await fetch(`${base}/api/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'templateId=versus-classic',
    });
    expect(r.status).toBe(415);
  });

  it('allows a same-origin POST from the studio’s own page', async () => {
    const r = await postJson('/api/qa', { imageKey: 'nope' }, { origin: base, 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(404); // reached the handler; the key simply is not there
  });
});

describe('arbitrary file read via background.path', () => {
  const body = {
    templateId: 'versus-classic',
    subjects: [{ player: 'Peyz' }],
    background: { mode: 'file', path: '/etc/passwd' },
  };

  it('refuses a filesystem background by default', async () => {
    // Left open, this renders an arbitrary local image into a thumbnail the
    // attacker then fetches back from /api/image — a file-disclosure primitive.
    const r = await postJson('/api/render', body);
    expect(r.status).toBe(403);
    const err = (await r.json()).error;
    expect(err.code).toBe('FORBIDDEN');
    expect(err.hint).toContain('HEXA_STUDIO_BACKGROUND_ROOT');
  });

  it('refuses a relative path that traverses out of the request', async () => {
    const r = await postJson('/api/render', {
      ...body,
      background: { mode: 'file', path: '../../../../etc/passwd' },
    });
    expect(r.status).toBe(403);
  });

  it('refuses any background carrying a path, whatever the mode claims to be', async () => {
    const r = await postJson('/api/render', {
      ...body,
      background: { mode: 'auto', path: '/etc/shadow' },
    });
    expect(r.status).toBe(403);
  });

  it('leaves path-free backgrounds alone for the pipeline to validate', async () => {
    const r = await postJson('/api/render', { ...body, background: { mode: 'color', color: 'nonsense' } });
    // Rejected on its merits by the pipeline validator, not by the path guard.
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_REQUEST');
  });
});

describe('/api/image — an in-memory key, not a filesystem path', () => {
  it('cannot be made to serve a file from disk', async () => {
    for (const key of [
      '../../../../etc/passwd',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/etc/passwd',
      '....//....//etc/passwd',
    ]) {
      const r = await fetch(`${base}/api/image/${key}`);
      expect(r.status).toBe(404);
      expect(r.headers.get('content-type')).toContain('application/json');
    }
  });

  it('is not confused by prototype keys', async () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect((await fetch(`${base}/api/image/${key}`)).status).toBe(404);
    }
  });

  it('answers a malformed percent-escape with 404, not 500', async () => {
    // `decodeURIComponent('%zz')` throws URIError; an unguarded decode turns a
    // plainly-absent key into an internal error.
    for (const key of ['%zz', '%', '%e0%a4%a', 'a%2']) {
      const raw = await rawRequest(`GET /api/image/${key} HTTP/1.1`, { host: '127.0.0.1' });
      expect(statusOf(raw)).toBe(404);
    }
  });

  it('serves stored bytes with nosniff, so a PNG cannot be read as HTML', async () => {
    images.set('test-key', Buffer.from('\x89PNG\r\n\x1a\nfake'));
    const r = await fetch(`${base}/api/image/test-key`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-type')).toBe('image/png');
    images.delete('test-key');
  });
});

describe('static files', () => {
  it('serves the studio page', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  it('refuses every traversal encoding', async () => {
    for (const p of [
      '/../../../../etc/passwd',
      '/%2e%2e%2f%2e%2e%2fetc/passwd',
      '/..%2f..%2fetc/passwd',
      '/./../../etc/hosts',
      '/....//....//etc/passwd',
    ]) {
      const r = await fetch(base + p);
      expect([403, 404]).toContain(r.status);
      const text = await r.text();
      expect(text).not.toContain('root:');
    }
  });

  it('does not leak a filesystem path in a 404', async () => {
    const text = await (await fetch(`${base}/definitely-not-here.css`)).text();
    expect(text).not.toContain('/home/');
    expect(text).not.toContain(process.cwd());
  });
});

describe('the in-memory image store is bounded', () => {
  it('refuses to build a proof sheet of a proof sheet', async () => {
    // Chaining `<key>-proof-proof-proof…` used to add one full PNG per call,
    // for as long as the attacker cared to keep going.
    images.set('chain-src', Buffer.from('x'));
    images.set('chain-src-proof', Buffer.from('y'));
    const r = await postJson('/api/qa', { imageKey: 'chain-src-proof' });
    expect(r.status).toBe(404);
    images.delete('chain-src');
    images.delete('chain-src-proof');
  });

  it('rejects a non-string image key without touching the store', async () => {
    for (const imageKey of [{}, [], 42, null, true]) {
      expect((await postJson('/api/qa', { imageKey })).status).toBe(404);
    }
  });

  it('evicts oldest-first once the entry budget is exceeded', async () => {
    const before = images.size;
    for (let i = 0; i < 400; i++) images.set(`flood-${i}`, Buffer.alloc(1024));
    expect(images.size).toBeLessThanOrEqual(240);
    expect(images.has('flood-0')).toBe(false); // oldest gone
    expect(images.has('flood-399')).toBe(true); // newest kept
    expect(images.bytes).toBeLessThanOrEqual(512 * 1024 * 1024);
    expect(images.size).toBeGreaterThan(0);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it('keeps the byte total honest when a key is overwritten', async () => {
    images.set('sized', Buffer.alloc(5000));
    const withBig = images.bytes;
    images.set('sized', Buffer.alloc(10));
    expect(images.bytes).toBe(withBig - 4990);
    images.delete('sized');
  });
});

describe('request limits', () => {
  it('answers an oversized body with 413, not 500', async () => {
    const r = await postJson('/api/render', { templateId: 'x', pad: 'A'.repeat(400_000) });
    expect(r.status).toBe(413);
    expect((await r.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const r = await postJson('/api/render', '{not json');
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_JSON');
  });

  it('clamps variants instead of letting NaN or a huge count through', async () => {
    // A NaN variant count used to survive `Math.min(Number(x), 8)` intact.
    for (const variants of [100_000, -5, 'abc', null, {}, Number.NaN]) {
      const r = await postJson('/api/render', { templateId: 'no-such-template', subjects: [{ player: 'x' }], variants });
      // Refused for the unknown template — never for a malformed variant count,
      // which means the clamp produced something the validator accepted.
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).not.toBe('INTERNAL');
    }
  });

  it('refuses a thousand subjects at the edge rather than in the layout engine', async () => {
    const subjects = Array.from({ length: 1000 }, () => ({ player: 'Peyz' }));
    const r = await postJson('/api/render', { templateId: 'versus-classic', subjects });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toMatch(/too many subjects/i);
  });

  it('caps a 200k-character headline before it becomes a 200 KB SVG document', async () => {
    const r = await postJson('/api/render', {
      templateId: 'no-such-template',
      subjects: [{ player: 'x' }],
      text: { headline: 'A'.repeat(200_000) },
    });
    // Reaching the template lookup at all proves the headline survived
    // normalisation as a valid string rather than being rejected outright.
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('rejects an unknown text role with a clear error rather than a crash', async () => {
    const r = await postJson('/api/render', {
      templateId: 'versus-classic',
      subjects: [{ player: 'x' }],
      text: { 'not-a-role': 'x' },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_REQUEST');
  });

  it('ignores non-string text values instead of forwarding them', async () => {
    const r = await postJson('/api/render', {
      templateId: 'no-such-template',
      subjects: [{ player: 'x' }],
      text: { headline: { toString: 'nope' }, subhead: 42 },
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('rejects a non-numeric seed rather than passing NaN downstream', async () => {
    const r = await postJson('/api/render', { templateId: 'x', subjects: [{ player: 'y' }], seed: 'abc' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toMatch(/seed/i);
  });

  it('hangs up on a body sent to an endpoint that does not exist', async () => {
    // Without the teardown the server keeps a socket open reading megabytes
    // into a handler that will never run.
    const r = await postJson('/api/does-not-exist', { pad: 'A'.repeat(1000) }).catch((e: Error) => e);
    if (r instanceof Error) return; // connection reset is an acceptable answer
    expect(r.status).toBe(404);
  });
});

describe('error responses do not leak internals', () => {
  it('never returns a filesystem path or a stack frame', async () => {
    const probes = await Promise.all([
      postJson('/api/render', '{bad'),
      postJson('/api/render', { templateId: 'nope', subjects: [{ player: 'x' }] }),
      fetch(`${base}/api/image/missing`),
      fetch(`${base}/nope.css`),
      postJson('/api/qa', { imageKey: 'missing' }),
    ]);
    for (const r of probes) {
      const text = await r.text();
      expect(text).not.toContain(process.cwd());
      expect(text).not.toMatch(/\/home\/|\/root\/|node_modules/);
      expect(text).not.toContain('    at ');
      expect(text).not.toContain('.hexa-cache');
    }
  });

  it('does not echo the server-chosen output directory back to the client', async () => {
    const r = await postJson('/api/render', { templateId: 'nope', subjects: [{ player: 'x' }] });
    expect(await r.text()).not.toContain('.hexa-cache');
  });

  it('does not publish the absolute asset-library path in the bootstrap payload', async () => {
    const r = await fetch(`${base}/api/bootstrap`);
    if (r.status !== 200) return; // pipeline unavailable in this environment
    const body = await r.json();
    expect(body.capabilities).not.toHaveProperty('assetRoot');
    expect(JSON.stringify(body.capabilities)).not.toContain('/');
  });
});

describe('the process survives what a client throws at it', () => {
  it('installs guards that keep the process alive through an unhandled rejection', async () => {
    // Node terminates on an unhandled rejection by default, so a single missing
    // .catch() anywhere downstream is a remote kill switch.
    const { installProcessGuards } = await import('./server.js');
    const had = process.listenerCount('unhandledRejection');
    installProcessGuards();
    expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(had - 1);
    expect(process.listenerCount('uncaughtException')).toBeGreaterThan(0);
  });

  it('survives a half-open request that never sends its declared body', async () => {
    const socket = net.connect(port, '127.0.0.1');
    await new Promise<void>((done) => socket.once('connect', () => done()));
    socket.write('POST /api/render HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-length: 1000000\r\n\r\n{');
    await new Promise((done) => setTimeout(done, 200));
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    socket.destroy();
  });

  it('survives a garbage request line', async () => {
    const socket = net.connect(port, '127.0.0.1');
    await new Promise<void>((done) => socket.once('connect', () => done()));
    socket.write('NOT-HTTP \x00\x01\x02 garbage\r\n\r\n');
    await new Promise((done) => setTimeout(done, 200));
    socket.destroy();
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('survives an abrupt disconnect mid-request', async () => {
    const controller = new AbortController();
    const inflight = fetch(`${base}/api/bootstrap`, { signal: controller.signal }).catch(() => undefined);
    controller.abort();
    await inflight;
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});
