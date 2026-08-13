/**
 * Hexa Studio — a local HTTP server wrapping the pipeline.
 *
 * Deliberately dependency-free on the client side: no bundler, no framework,
 * one self-contained HTML file. A thumbnail tool whose own dev server needs a
 * ten-second cold build is a thumbnail tool people stop opening.
 *
 *   npx tsx apps/studio/src/server.ts        # or: pnpm studio
 *   → http://127.0.0.1:4600
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { createLogger, isHexaError, type LogLevel } from '@hexa/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

const log = createLogger((process.env.HEXA_LOG as LogLevel) || 'info', 'studio');

const PORT = Number(process.env.HEXA_STUDIO_PORT ?? 4600);
const HOST = process.env.HEXA_STUDIO_HOST ?? '127.0.0.1';

/** Renders are expensive; keep the last N so the gallery can page back. */
const RENDER_HISTORY_LIMIT = 40;

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
/** In-memory image store so the browser can fetch renders without touching disk. */
const images = new Map<string, Buffer>();

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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendError(res: ServerResponse, err: unknown): void {
  if (isHexaError(err)) {
    log.warn(`${err.code}: ${err.message}`);
    sendJson(res, 400, { error: { code: err.code, message: err.message, hint: err.hint } });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  log.error(`unhandled: ${message}`);
  sendJson(res, 500, { error: { code: 'INTERNAL', message } });
}

async function readBody(req: IncomingMessage, limitBytes = 2_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limitBytes) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Serve a static file, refusing anything that escapes PUBLIC_DIR. */
async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const target = resolve(PUBLIC_DIR, rel);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'path escapes public root' } });
    return;
  }
  try {
    const buf = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'content-length': buf.length,
    });
    res.end(buf);
  } catch {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: rel } });
  }
}

// ── Lazy dependency loading ─────────────────────────────────────────────────
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
  depsPromise ??= loadDeps();
  return depsPromise;
}

// ── Routes ──────────────────────────────────────────────────────────────────

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
      capabilities: { vision, assetRoot: d.library.root },
      history: history.slice(-RENDER_HISTORY_LIMIT),
    });
  },

  'POST /api/render': async (req, res) => {
    const body = (await readBody(req)) as Record<string, unknown>;
    const { pipeline } = await deps();
    const d = (await deps()).deps;

    const id = `r${Date.now().toString(36)}`;
    const request = {
      templateId: String(body.templateId ?? 'versus-classic'),
      subjects: Array.isArray(body.subjects) ? body.subjects : [],
      text: (body.text ?? {}) as Record<string, string>,
      aspect: body.aspect ?? 'youtube',
      variants: Math.min(Number(body.variants ?? 1), 8),
      seed: body.seed === undefined || body.seed === null ? undefined : Number(body.seed),
      grade: body.grade ?? undefined,
      background: body.background ?? undefined,
      palette: body.palette ?? undefined,
      // The studio renders to memory; nothing is written to the user's disk
      // until they explicitly download a variant.
      output: { dir: join(process.cwd(), '.hexa-cache', 'studio', id), name: 'v' },
      qa: body.qa ?? { legibility: true, safeZones: true },
    };

    const t0 = performance.now();
    const result = await pipeline.generateThumbnail(request as never, d);

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
      dropped?.variants.forEach((v) => images.delete(v.url.split('/').pop()!));
    }

    sendJson(res, 200, {
      ...entry,
      qa: result.variants.map((v) => ({ id: v.id, report: v.qa })),
    });
  },

  'POST /api/qa': async (req, res) => {
    const body = (await readBody(req)) as { imageKey?: string };
    const buf = body.imageKey ? images.get(body.imageKey) : undefined;
    if (!buf) {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'unknown image key' } });
      return;
    }
    const qa = await import('@hexa/qa');
    const sizes = await qa.simulateSizes(buf);
    const sheetKey = `${body.imageKey}-proof`;
    images.set(sheetKey, await qa.proofSheet(buf));
    sendJson(res, 200, {
      proofSheetUrl: `/api/image/${sheetKey}`,
      sizes: sizes.map((s) => ({ label: s.label, width: s.width, height: s.height, legible: s.legible, notes: s.notes })),
    });
  },

  'GET /api/suggest': async (_req, res, url) => {
    const { templates } = await deps();
    const n = Number(url.searchParams.get('subjects') ?? 2);
    const category = url.searchParams.get('category') ?? undefined;
    const suggestions = templates.suggestTemplates(
      { subjects: n, category: category as never, mood: url.searchParams.get('mood') ?? undefined },
      8,
    );
    sendJson(res, 200, { templates: suggestions.map((t) => ({ id: t.id, name: t.name, whenToUse: t.whenToUse })) });
  },

  'GET /api/health': async (_req, res) => {
    sendJson(res, 200, { ok: true, renders: history.length, images: images.size, uptime: process.uptime() });
  },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  void (async () => {
    try {
      if (url.pathname.startsWith('/api/image/')) {
        const key = url.pathname.slice('/api/image/'.length);
        const buf = images.get(key);
        if (!buf) {
          sendJson(res, 404, { error: { code: 'NOT_FOUND', message: key } });
          return;
        }
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, 'cache-control': 'no-store' });
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

      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: url.pathname } });
    } catch (err) {
      sendError(res, err);
    }
  })();
});

server.listen(PORT, HOST, () => {
  log.info(`Hexa Studio → http://${HOST}:${PORT}`);
});

export { server };
