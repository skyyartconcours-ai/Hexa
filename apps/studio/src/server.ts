/**
 * Hexa Studio — a local HTTP server wrapping the pipeline.
 *
 * Deliberately dependency-free on the client side: no bundler, no framework,
 * one self-contained HTML file. A thumbnail tool whose own dev server needs a
 * ten-second cold build is a thumbnail tool people stop opening.
 *
 *   npx tsx apps/studio/src/server.ts        # or: pnpm studio
 *   → http://127.0.0.1:4600
 *
 * ## Threat model
 *
 * "It only binds 127.0.0.1" is not a security boundary, and treating it as one
 * is how local dev servers become the soft underbelly of a developer machine.
 * Two attacks reach a loopback listener from an ordinary web page:
 *
 *  - **CSRF.** Any site the user visits can POST here. The browser will not let
 *    that site *read* the reply without CORS, but it will happily let it fire
 *    the request — enough to drive renders, burn CPU and fill memory.
 *  - **DNS rebinding.** A hostname the attacker controls, re-pointed at
 *    127.0.0.1 after the page loads, is same-origin as far as the browser is
 *    concerned. CORS stops mattering entirely and every response becomes
 *    readable — which is why the `Host` header is checked rather than trusted.
 *
 * So requests must arrive with a loopback `Host`, state-changing ones must not
 * carry a foreign `Origin`, and everything the pipeline can be pointed at from
 * an HTTP body — filesystem paths above all — is denied unless explicitly
 * opted in. The render request is a *nominated* set of fields, never a spread
 * of the body, so a field added to `ThumbnailRequest` later cannot silently
 * become remotely reachable.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, sep, isAbsolute } from 'node:path';
import { MAX_TEXT_LENGTH, clampInt, createLogger, isHexaError, type LogLevel } from '@hexa/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

const log = createLogger((process.env.HEXA_LOG as LogLevel) || 'info', 'studio');

const PORT = Number(process.env.HEXA_STUDIO_PORT ?? 4600);
const HOST = process.env.HEXA_STUDIO_HOST ?? '127.0.0.1';

/** Renders are expensive; keep the last N so the gallery can page back. */
const RENDER_HISTORY_LIMIT = 40;

/** Largest JSON body accepted on any route. A render request is ~1 KB. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Ceiling on the in-memory image store, in bytes and in entries.
 *
 * Both are needed. The entry cap alone lets 40 4K PNGs sit in memory; the byte
 * cap alone lets a flood of tiny images grow the Map without bound. 512 MB is
 * roughly 40 full-size renders plus their proof sheets.
 */
const MAX_IMAGE_BYTES = 512 * 1024 * 1024;
const MAX_IMAGE_ENTRIES = 240;

/** Concurrent renders. Each holds a full canvas plus layers; two is plenty. */
const MAX_CONCURRENT_RENDERS = 2;

/** Variants per request from the HTTP surface — lower than the pipeline's own cap. */
const MAX_VARIANTS = 8;
/** Subjects per request. The pipeline caps at 12; refuse earlier and cheaper. */
const MAX_SUBJECTS = 12;
/** Longest string accepted for any text role — the shared bound from core. */
const MAX_TEXT_CHARS = MAX_TEXT_LENGTH;

/**
 * Directory that `background.path` may point inside, or undefined to refuse
 * filesystem backgrounds altogether (the default).
 *
 * Without this, `{"background":{"mode":"file","path":"/home/you/private.png"}}`
 * makes the server read an arbitrary local image and composite it into a
 * thumbnail it then serves back over HTTP — a file-disclosure primitive handed
 * to anything that can reach the port. The studio is a UI over the pipeline,
 * not a file browser, so the safe default is "no paths at all" and an operator
 * who genuinely wants one names the directory.
 */
const BACKGROUND_ROOT = process.env.HEXA_STUDIO_BACKGROUND_ROOT
  ? resolve(process.env.HEXA_STUDIO_BACKGROUND_ROOT)
  : undefined;

interface HistoryEntry {
  id: string;
  createdAt: string;
  request: unknown;
  variants: { id: string; url: string; qaScore: number; appeal: number; seed: number; passed: boolean }[];
  bestIndex: number;
  warnings: string[];
  totalMs: number;
}

const history: HistoryEntry[] = [];

/**
 * In-memory image store so the browser can fetch renders without touching disk.
 *
 * Bounded, because "in-memory cache" and "memory leak" are the same data
 * structure until someone writes the eviction. Insertion-ordered eviction
 * (oldest first) matches how the gallery is read: the newest render is the one
 * on screen, and the ones that fall off the end are the ones already paged past.
 */
class ImageStore {
  readonly #images = new Map<string, Buffer>();
  #bytes = 0;

  get size(): number {
    return this.#images.size;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get(key: string): Buffer | undefined {
    return this.#images.get(key);
  }

  has(key: string): boolean {
    return this.#images.has(key);
  }

  set(key: string, buf: Buffer): void {
    this.delete(key);
    this.#images.set(key, buf);
    this.#bytes += buf.length;
    // Evict oldest-first until both budgets are satisfied. `keys()` on a Map is
    // insertion-ordered, so this is an LRU-by-insertion with no bookkeeping.
    while (this.#images.size > MAX_IMAGE_ENTRIES || this.#bytes > MAX_IMAGE_BYTES) {
      const oldest = this.#images.keys().next();
      if (oldest.done || oldest.value === key) break;
      this.delete(oldest.value);
    }
  }

  delete(key: string): void {
    const existing = this.#images.get(key);
    if (existing === undefined) return;
    this.#bytes -= existing.length;
    this.#images.delete(key);
  }
}

const images = new ImageStore();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Headers on every response.
 *
 * `X-Content-Type-Options` matters more than it looks: `/api/image/:key` serves
 * attacker-influenced bytes, and without it a browser is free to sniff a PNG
 * that happens to start with `<script>` as HTML. The CSP is the belt to that
 * brace — the studio's own page is self-contained, so it costs nothing.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// ── origin / host checks ────────────────────────────────────────────────────

/** Hostnames this server will answer to, lowercase, port stripped. */
const ALLOWED_HOSTS = new Set(
  [
    '127.0.0.1',
    'localhost',
    '::1',
    '[::1]',
    HOST,
    ...(process.env.HEXA_STUDIO_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()),
  ]
    .filter(Boolean)
    .map((h) => h.toLowerCase()),
);

/** Strip the port and any IPv6 brackets from a `Host`/`Origin` authority. */
function hostnameOf(authority: string | undefined): string | undefined {
  if (!authority) return undefined;
  const a = authority.trim().toLowerCase();
  if (a.startsWith('[')) return a.slice(0, a.indexOf(']') + 1);
  const at = a.lastIndexOf(':');
  return at > 0 ? a.slice(0, at) : a;
}

/**
 * Reject a request whose `Host` is not one this server owns.
 *
 * This is the DNS-rebinding defence: a page on `http://evil.test` whose DNS has
 * been re-pointed at 127.0.0.1 sends `Host: evil.test`, and there is no other
 * signal that distinguishes it from the real UI.
 */
function hostAllowed(req: IncomingMessage): boolean {
  const host = hostnameOf(req.headers.host);
  return host !== undefined && ALLOWED_HOSTS.has(host);
}

/**
 * Reject a cross-site request. `Origin` is set by the browser on every
 * state-changing fetch and cannot be forged by page script; `Sec-Fetch-Site`
 * says the same thing more directly where it is available.
 */
function sameSite(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;

  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true; // non-browser client
  try {
    return ALLOWED_HOSTS.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// ── responses ───────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return; // a second send would throw
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/**
 * A request that failed in a way the caller should be told about, with a status
 * to match. Used instead of a bare Error so `sendError` does not have to guess.
 */
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly hint?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Turn a thrown value into a response.
 *
 * `HexaError` messages are authored for humans and safe to forward — they are
 * the product's own diagnostics. Everything else is not: an `ENOENT` carries an
 * absolute path, a sharp failure carries a temp filename, a TypeError carries
 * internals. Those get a correlation id and nothing more, with the detail going
 * to the operator's log where it belongs.
 */
function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) {
    log.warn(`${err.code}: ${err.message}`);
    sendJson(res, err.status, { error: { code: err.code, message: err.message, hint: err.hint } });
    return;
  }
  if (isHexaError(err)) {
    log.warn(`${err.code}: ${err.message}`);
    sendJson(res, 400, { error: { code: err.code, message: err.message, hint: err.hint } });
    return;
  }
  const errorId = randomUUID().slice(0, 8);
  log.error(`unhandled [${errorId}]:`, err);
  sendJson(res, 500, {
    error: {
      code: 'INTERNAL',
      message: `Something went wrong (reference ${errorId}). Check the studio log for details.`,
      errorId,
    },
  });
}

/**
 * Read and parse a JSON body.
 *
 * Requires `application/json`, which is not decoration: a body sent as
 * `text/plain` is a CORS "simple request" and needs no preflight, so accepting
 * one hands every website on the internet a working POST into this server.
 * Requiring JSON forces a preflight the `Origin` check then answers.
 */
async function readJsonBody(req: IncomingMessage, limitBytes = MAX_BODY_BYTES): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') {
    throw new HttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'This endpoint accepts application/json only',
      'Send the body with `content-type: application/json`.',
    );
  }

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limitBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${limitBytes} bytes`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limitBytes) {
      // Stop reading *and* stop the peer sending: without the destroy the
      // client keeps streaming into a socket nobody is draining.
      req.destroy();
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${limitBytes} bytes`);
    }
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}

/** Serve a static file, refusing anything that escapes PUBLIC_DIR. */
async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const target = resolve(PUBLIC_DIR, rel);
  if (!containedIn(PUBLIC_DIR, target)) {
    sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'path escapes public root' } });
    return;
  }
  try {
    // The lexical check above cannot see a symlink inside `public/`; resolve the
    // real path before reading so a link out of the tree is refused too.
    const real = await realpath(target);
    if (!containedIn(await realpath(PUBLIC_DIR), real)) {
      sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'path escapes public root' } });
      return;
    }
    const buf = await readFile(real);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[extname(real)] ?? 'application/octet-stream',
      'content-length': buf.length,
    });
    res.end(buf);
  } catch {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } });
  }
}

/** True when `target` is `root` itself or lives under it. Separator-aware, so
 *  `/public-evil` never counts as inside `/public`. */
function containedIn(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}

// ── request normalisation ───────────────────────────────────────────────────

/**
 * A text map with non-strings dropped and every value length-capped.
 *
 * Unknown roles are *kept* and left for the pipeline to reject by name —
 * silently dropping them would turn a typo'd role into a thumbnail that
 * mysteriously lacks its headline, which is worse than an error.
 */
function safeText(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [role, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    // Own-property iteration only, so `__proto__` from a JSON body lands as a
    // plain key on a fresh object and never reaches Object.prototype.
    out[role] = v.length > MAX_TEXT_CHARS ? v.slice(0, MAX_TEXT_CHARS) : v;
  }
  return out;
}

/**
 * Validate a background block from an HTTP body.
 *
 * `mode: 'file'` is the dangerous one and is refused outright unless an
 * operator has named a directory to allow. Everything else is forwarded for the
 * pipeline's own validator to check.
 */
function safeBackground(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'background must be an object');
  }
  const bg = { ...(value as Record<string, unknown>) };
  const path = bg['path'];

  if (bg['mode'] !== 'file' && path === undefined) return bg;

  if (typeof path !== 'string' || path === '') {
    throw new HttpError(400, 'INVALID_REQUEST', 'background.mode is "file" but no path was given', 'Pass background.path, or use mode "auto".');
  }
  if (BACKGROUND_ROOT === undefined) {
    throw new HttpError(
      403,
      'FORBIDDEN',
      'Filesystem backgrounds are disabled in the studio',
      'Start the studio with HEXA_STUDIO_BACKGROUND_ROOT=<dir> to allow images from that directory.',
    );
  }
  if (path.includes('\0')) {
    throw new HttpError(400, 'INVALID_REQUEST', 'background.path contains an illegal NUL byte');
  }
  const abs = isAbsolute(path) ? resolve(path) : resolve(BACKGROUND_ROOT, path);
  if (!containedIn(BACKGROUND_ROOT, abs)) {
    throw new HttpError(403, 'FORBIDDEN', 'background.path is outside the permitted background directory');
  }
  bg['path'] = abs;
  return bg;
}

/**
 * Build a render request from a body.
 *
 * Every field is named explicitly. Spreading the body would mean any field the
 * pipeline learns to accept — an output directory, a font path, a provider
 * override — becomes remotely settable the day it is added, which is precisely
 * the class of bug that is invisible in review.
 */
function buildRenderRequest(body: Record<string, unknown>, id: string): Record<string, unknown> {
  const subjects = Array.isArray(body['subjects']) ? body['subjects'] : [];
  if (subjects.length > MAX_SUBJECTS) {
    throw new HttpError(400, 'INVALID_REQUEST', `Too many subjects (${subjects.length}); the maximum is ${MAX_SUBJECTS}`);
  }

  const seedRaw = body['seed'];
  const seed = seedRaw === undefined || seedRaw === null ? undefined : Number(seedRaw);
  if (seed !== undefined && !Number.isFinite(seed)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'seed must be a number');
  }

  return {
    templateId: String(body['templateId'] ?? 'versus-classic').slice(0, 128),
    subjects,
    text: safeText(body['text']),
    aspect: body['aspect'] ?? 'youtube',
    // clampInt, not Math.min: `Math.min(Number("abc"), 8)` is NaN, and NaN
    // propagates into the pipeline as a variant count nobody validated.
    variants: clampInt(body['variants'], 1, MAX_VARIANTS, 1),
    ...(seed === undefined ? {} : { seed }),
    grade: body['grade'] ?? undefined,
    background: safeBackground(body['background']),
    palette: body['palette'] ?? undefined,
    // The studio renders to memory; nothing is written to the user's disk
    // until they explicitly download a variant. The path is server-chosen —
    // `output` is never read from the body.
    output: { dir: join(process.cwd(), '.hexa-cache', 'studio', id), name: 'v' },
    qa: body['qa'] ?? { legibility: true, safeZones: true },
  };
}

/** The request as echoed back: server-chosen paths stripped. */
function publicRequest(request: Record<string, unknown>): Record<string, unknown> {
  const { output: _output, ...rest } = request;
  return rest;
}

// ── lazy dependency loading ─────────────────────────────────────────────────
// The studio must start instantly and report a broken pipeline as a friendly
// banner rather than a stack trace at boot, so heavy packages load on demand.

let depsPromise: Promise<Awaited<ReturnType<typeof loadDeps>>> | null = null;

async function loadDeps() {
  const [pipeline, data, templates] = await Promise.all([
    import('@hexa/pipeline'),
    import('@hexa/data'),
    import('@hexa/templates'),
  ]);
  const deps = await pipeline.createDeps({
    assetRoot: process.env.HEXA_ASSETS,
    visionEndpoint: process.env.HEXA_VISION_URL,
  });
  return { pipeline, data, templates, deps };
}

function deps() {
  // A rejected promise must not be cached, or one transient failure at boot
  // makes every later request fail with the same stale error forever.
  depsPromise ??= loadDeps().catch((err) => {
    depsPromise = null;
    throw err;
  });
  return depsPromise;
}

// ── routes ──────────────────────────────────────────────────────────────────

let activeRenders = 0;

const routes: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>> = {
  'GET /api/bootstrap': async (_req, res) => {
    const { data, templates, deps: d } = await deps();
    const vision = await d.vision.available().catch(() => false);
    sendJson(res, 200, {
      teams: data.TEAMS.map((t) => ({
        id: t.id, tag: t.tag, name: t.name, shortName: t.shortName,
        league: t.league, colors: t.colors,
      })),
      players: data.PLAYERS.map((p) => ({
        id: p.id, handle: p.handle, fullName: p.fullName, role: p.role,
        teamId: p.teamId, active: p.active, nativeName: p.nativeName,
      })),
      templates: templates.TEMPLATES.map((t) => ({
        id: t.id, name: t.name, category: t.category, description: t.description,
        subjects: t.subjects, aspects: t.aspects, tags: t.tags, whenToUse: t.whenToUse,
      })),
      textRoles: [
        'headline', 'subhead', 'kicker', 'vs', 'left-name', 'right-name',
        'left-team', 'right-team', 'badge', 'stat', 'caption', 'rank', 'date',
      ],
      // Whether a library is configured, never where it is: the absolute path
      // is exactly the reconnaissance a rebound page would want.
      capabilities: { vision, assetLibrary: Boolean(d.library.root) },
      history: history.slice(-RENDER_HISTORY_LIMIT).map((h) => ({ ...h, request: publicRequest(h.request as Record<string, unknown>) })),
    });
  },

  'POST /api/render': async (req, res) => {
    const body = (await readJsonBody(req)) as Record<string, unknown>;

    // Renders are the expensive operation and the one an attacker wants to
    // spam. Refusing past a small concurrency beats queueing: a queue just
    // moves unbounded work from CPU to memory.
    if (activeRenders >= MAX_CONCURRENT_RENDERS) {
      throw new HttpError(503, 'BUSY', 'Too many renders in flight; try again in a moment');
    }

    const { pipeline, deps: d } = await deps();
    const id = `r${Date.now().toString(36)}`;
    const request = buildRenderRequest(body, id);

    const t0 = performance.now();
    activeRenders++;
    let result: Awaited<ReturnType<typeof pipeline.generateThumbnail>>;
    try {
      result = await pipeline.generateThumbnail(request as never, d);
    } finally {
      activeRenders--;
    }

    // The client hung up while we rendered. Storing the result would grow the
    // image map for a browser that will never ask for it — which is the whole
    // fire-and-forget amplification an aborted-request flood relies on.
    if (req.destroyed || res.writableEnded) {
      log.debug(`client disconnected before ${id} finished; discarding ${result.variants.length} variant(s)`);
      return;
    }

    const entry: HistoryEntry = {
      id,
      createdAt: new Date().toISOString(),
      request,
      bestIndex: result.bestIndex,
      warnings: result.warnings,
      totalMs: Math.round(performance.now() - t0),
      variants: [],
    };

    for (const [i, v] of result.variants.entries()) {
      const key = `${id}-${i}`;
      images.set(key, await readFile(v.path));
      entry.variants.push({
        id: v.id,
        url: `/api/image/${key}`,
        qaScore: v.qa.score,
        appeal: v.appeal,
        seed: v.seed,
        passed: v.qa.passed,
      });
    }

    history.push(entry);
    while (history.length > RENDER_HISTORY_LIMIT) {
      const dropped = history.shift();
      // Drop the proof sheet with its image: keying it off the image meant it
      // outlived every eviction and accumulated one full PNG per QA call.
      dropped?.variants.forEach((v) => {
        const key = v.url.split('/').pop();
        if (!key) return;
        images.delete(key);
        images.delete(proofKeyFor(key));
      });
    }

    sendJson(res, 200, {
      ...entry,
      request: publicRequest(request),
      qa: result.variants.map((v) => ({ id: v.id, report: v.qa })),
    });
  },

  'POST /api/qa': async (req, res) => {
    const body = (await readJsonBody(req)) as { imageKey?: unknown };
    const imageKey = typeof body.imageKey === 'string' ? body.imageKey : undefined;
    // A proof sheet of a proof sheet is not a feature. Allowing it let a caller
    // chain `<key>-proof-proof-proof…` forever, one full PNG per link.
    const buf = imageKey && !isProofKey(imageKey) ? images.get(imageKey) : undefined;
    if (!buf) {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'unknown image key' } });
      return;
    }
    const qa = await import('@hexa/qa');
    const sizes = await qa.simulateSizes(buf);
    const sheetKey = proofKeyFor(imageKey!);
    images.set(sheetKey, await qa.proofSheet(buf));
    sendJson(res, 200, {
      proofSheetUrl: `/api/image/${sheetKey}`,
      sizes: sizes.map((s) => ({ label: s.label, width: s.width, height: s.height, legible: s.legible, notes: s.notes })),
    });
  },

  'GET /api/suggest': async (_req, res, url) => {
    const { templates } = await deps();
    const n = clampInt(url.searchParams.get('subjects'), 1, MAX_SUBJECTS, 2);
    const category = url.searchParams.get('category') ?? undefined;
    const suggestions = templates.suggestTemplates(
      { subjects: n, category: category as never, mood: url.searchParams.get('mood') ?? undefined },
      8,
    );
    sendJson(res, 200, { templates: suggestions.map((t) => ({ id: t.id, name: t.name, whenToUse: t.whenToUse })) });
  },

  'GET /api/health': async (_req, res) => {
    sendJson(res, 200, {
      ok: true,
      renders: history.length,
      images: images.size,
      imageBytes: images.bytes,
      activeRenders,
      uptime: process.uptime(),
    });
  },
};

/** Percent-decode, or return the raw text when the escape is malformed. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Namespaced so a proof sheet can never be mistaken for a render, or chained. */
const PROOF_SUFFIX = '-proof';
const proofKeyFor = (key: string): string => `${key}${PROOF_SUFFIX}`;
const isProofKey = (key: string): boolean => key.endsWith(PROOF_SUFFIX);

// ── dispatch ────────────────────────────────────────────────────────────────

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!hostAllowed(req)) {
      // Deliberately terse: a rebound page learns nothing about what is here.
      sendJson(res, 421, { error: { code: 'MISDIRECTED_REQUEST', message: 'unrecognised Host header' } });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameSite(req)) {
      sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'cross-site request refused' } });
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/api/image/')) {
      // `decodeURIComponent` throws URIError on a malformed escape like `%zz`,
      // which would otherwise surface as a 500 for what is plainly a 404.
      const key = safeDecode(url.pathname.slice('/api/image/'.length));
      // Map lookup only — the key indexes an in-memory store and is never
      // joined onto a filesystem path, so there is nothing here to traverse.
      const buf = images.get(key);
      if (!buf) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'unknown image key' } });
        return;
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': 'image/png',
        'content-length': buf.length,
        'cache-control': 'no-store',
      });
      res.end(buf);
      return;
    }

    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) {
      await handler(req, res, url);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(res, url.pathname);
      return;
    }

    // Unrouted request with a body: answer, then hang up rather than draining
    // megabytes into a handler that does not exist.
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'no such endpoint' } });
    if (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']) req.destroy();
  } catch (err) {
    sendError(res, err);
  }
}

export function createStudioServer(): Server {
  const server = createServer((req, res) => {
    // A socket error after the response has been handed off (client hangs up
    // mid-write) must not become an unhandled 'error' event.
    req.on('error', (err) => log.debug(`request stream error: ${(err as Error).message}`));
    res.on('error', (err) => log.debug(`response stream error: ${(err as Error).message}`));
    void handleRequest(req, res).catch((err) => sendError(res, err));
  });

  // Node's defaults are generous enough that a handful of half-open sockets can
  // sit on the listener for five minutes each. A local tool needs neither.
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 10_000;

  server.on('clientError', (err, socket) => {
    log.debug(`client error: ${(err as Error).message}`);
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    else socket.destroy();
  });

  return server;
}

/**
 * Keep serving after a bug.
 *
 * A studio that dies on one bad request is a studio that an attacker — or a
 * merely unlucky user — can turn off from a browser tab, taking any in-flight
 * work with it. Node's default for an unhandled rejection is to terminate the
 * process, and a single missing `.catch()` anywhere in the pipeline is enough
 * to trigger it, so the failure mode is one forgotten line away at all times.
 *
 * Logged loudly rather than swallowed: this is a safety net, not a licence to
 * leave rejections unhandled, and the log line is what makes the underlying bug
 * findable.
 */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled promise rejection (server continues):', reason);
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception (server continues):', err);
  });
}

const isEntrypoint = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const server = createStudioServer();

if (isEntrypoint) {
  installProcessGuards();
  server.on('error', (err) => {
    log.error(`studio server error: ${(err as Error).message}`);
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    log.info(`Hexa Studio → http://${HOST}:${PORT}`);
    if (BACKGROUND_ROOT) log.info(`Filesystem backgrounds permitted from ${BACKGROUND_ROOT}`);
  });
}

export { server, images, history, HttpError };
