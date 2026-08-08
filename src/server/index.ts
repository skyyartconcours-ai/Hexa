import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { AUDIO_DIR, PUBLIC_DIR, config } from '../config.js';
import { chatStats, listOptedOut } from '../db.js';
import { log } from '../log.js';
import type { RoastQueue } from '../roast/queue.js';
import type { RoastTrigger } from '../types.js';

export function startServer(queue: RoastQueue): http.Server {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));
  app.use('/audio', express.static(AUDIO_DIR, { maxAge: 0 }));

  app.get('/', (_req, res) => res.redirect('/control'));
  app.get('/control', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'control.html')));
  app.get('/overlay', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlay.html')));

  // ── API ────────────────────────────────────────────────────────────────

  app.get('/api/state', (_req, res) => {
    res.json({
      session: queue.getState(),
      queue: queue.getQueue(),
      settings: {
        model: config.anthropic.model,
        tts: config.tts.provider,
        maxSeverity: config.session.maxSeverity,
        minIntervalSeconds: config.session.minIntervalMs / 1000,
        defaultMinutes: config.session.defaultMinutes,
      },
      chat: chatStats(),
      optedOut: listOptedOut(),
    });
  });

  app.post('/api/session/start', (req, res) => {
    const minutes = Number(req.body?.minutes) || config.session.defaultMinutes;
    res.json(queue.start(minutes));
  });

  app.post('/api/session/stop', (_req, res) => {
    res.json(queue.stop());
  });

  app.post('/api/session/autoplay', (req, res) => {
    queue.setAutoPlay(Boolean(req.body?.value));
    res.json(queue.getState());
  });

  app.post('/api/roast/:id/approve', (req, res) => {
    const ok = queue.approve(String(req.params.id));
    res.status(ok ? 200 : 404).json({ ok });
  });

  app.post('/api/roast/:id/reject', (req, res) => {
    const ok = queue.reject(String(req.params.id));
    res.status(ok ? 200 : 404).json({ ok });
  });

  /** Genere une vanne de test sans attendre un vrai sub. */
  app.post('/api/test', (req, res) => {
    const name = String(req.body?.user ?? '').trim();
    if (!name) return res.status(400).json({ error: 'pseudo manquant' });

    const trigger: RoastTrigger = {
      type: 'sub',
      userId: `test:${name.toLowerCase()}`,
      userLogin: name.toLowerCase(),
      userName: name,
      tier: '1000',
    };
    const id = queue.submit(trigger, { force: true });
    return res.json({ id });
  });

  // ── WebSocket ──────────────────────────────────────────────────────────

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  function broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  }

  wss.on('connection', (socket) => {
    clients.add(socket);
    socket.send(
      JSON.stringify({ type: 'state', session: queue.getState(), queue: queue.getQueue() }),
    );

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; id?: string };
        // L'overlay signale la fin de lecture : c'est ce qui debloque la vanne suivante.
        if (message.type === 'ended' && message.id) queue.finishPlayback(message.id);
      } catch {
        /* message ignore */
      }
    });

    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  queue.on('state', (payload) => broadcast({ type: 'state', ...payload }));
  queue.on('play', (payload) => broadcast({ type: 'play', ...payload }));

  server.listen(config.server.port, () => {
    log.ok(`Panneau de controle : http://localhost:${config.server.port}/control`);
    log.ok(`Source navigateur OBS : http://localhost:${config.server.port}/overlay`);
  });

  return server;
}
