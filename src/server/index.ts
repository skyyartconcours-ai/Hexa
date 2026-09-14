import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { AUDIO_DIR, PUBLIC_DIR, config } from '../config.js';
import { chatStats, findUserByLogin, listOptedOut } from '../db.js';
import { log } from '../log.js';
import type { RoastQueue } from '../roast/queue.js';
import type { RoastTrigger } from '../types.js';

const TEST_TYPES = ['sub', 'resub', 'gift', 'gift_recipient', 'cheer', 'donation'] as const;
type TestType = (typeof TEST_TYPES)[number];

function isTestType(value: string): value is TestType {
  return (TEST_TYPES as readonly string[]).includes(value);
}

function buildTestTrigger(
  type: TestType,
  base: Pick<RoastTrigger, 'userId' | 'userLogin' | 'userName'>,
): RoastTrigger {
  switch (type) {
    case 'resub':
      return { ...base, type, tier: '1000', cumulativeMonths: 14, streakMonths: 3, message: 'toujours la, toujours en retard' };
    case 'gift':
      return { ...base, type, tier: '1000', giftCount: 5, giftTotal: 42 };
    case 'gift_recipient':
      return { ...base, type, tier: '1000', gifterName: 'un_genereux' };
    case 'cheer':
      return { ...base, type, bits: 500, message: 'tiens, pour le cafe' };
    case 'donation':
      return { ...base, type, amount: 10, currency: 'EUR', message: 'pour la soupe' };
    case 'sub':
      return { ...base, type, tier: '1000' };
  }
}

export interface ServerHandle {
  server: http.Server;
  /** Signale a la regie que des souscriptions Twitch ont echoue. */
  setDegraded(failed: string[]): void;
}

export function startServer(queue: RoastQueue): ServerHandle {
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

  app.post('/api/roast/skip', (_req, res) => {
    res.json({ ok: queue.skipCurrent() });
  });

  app.post('/api/roast/:id/reroll', (req, res) => {
    const id = queue.reroll(String(req.params.id));
    res.status(id ? 200 : 404).json({ id });
  });

  /**
   * Genere une vanne de test sans attendre un vrai evenement, pour chacun des
   * six declencheurs. Les valeurs sont volontairement realistes (un message de
   * resub, un vrai nombre de gifts) : un test "sub tier 1 sans rien" ne montre
   * ni la personnalisation ni ce que donne l'evenement a l'antenne.
   * On resout le pseudo vers son vrai user_id : sinon `buildProfile` ne trouve
   * jamais rien et le test ne montre jamais la personnalisation.
   */
  app.post('/api/test', (req, res) => {
    const name = String(req.body?.user ?? '').trim();
    if (!name) return res.status(400).json({ error: 'pseudo manquant' });
    const type = String(req.body?.type ?? 'sub');
    if (!isTestType(type)) return res.status(400).json({ error: `type inconnu : ${type}` });

    const known = findUserByLogin(name);
    const trigger = buildTestTrigger(type, {
      userId: known?.userId ?? `test:${name.toLowerCase()}`,
      userLogin: name.toLowerCase(),
      userName: known?.userName ?? name,
    });
    const id = queue.submit(trigger, { force: true });
    return res.json({ id, known: known !== null });
  });

  /**
   * Dons hors Twitch (Tipeee, StreamElements, Streamlabs...).
   *
   * Ces services ne passent pas par EventSub et ne savent pas joindre une
   * machine chez toi : c'est a un petit script local, branche sur leur API ou
   * leur websocket, de poster ici. L'endpoint fait exister le type "donation"
   * de bout en bout — prompt, regie, overlay — pour que ce branchement soit
   * trivial. Meme niveau de confiance que /api/test : ecoute locale seulement.
   * Pas de `force` : un vrai don respecte la session, le cooldown et l'opt-out.
   */
  app.post('/api/donation', (req, res) => {
    const name = String(req.body?.userName ?? req.body?.user ?? '').trim();
    const amount = Number(req.body?.amount);
    if (!name) return res.status(400).json({ error: 'userName manquant' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount invalide' });

    const known = findUserByLogin(name);
    const trigger: RoastTrigger = {
      type: 'donation',
      userId: known?.userId ?? `donation:${name.toLowerCase()}`,
      userLogin: name.toLowerCase(),
      userName: known?.userName ?? name,
      amount,
      currency: String(req.body?.currency ?? 'EUR').slice(0, 5),
      message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 300) : undefined,
    };
    const id = queue.submit(trigger);
    return res.json({ id, known: known !== null });
  });

  // ── WebSocket ──────────────────────────────────────────────────────────

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();
  /** Seuls les overlays peuvent declarer une vanne terminee (voir plus bas). */
  const overlays = new Set<WebSocket>();
  let degradedReason: string[] = [];

  function overlayCount(): number {
    let n = 0;
    for (const socket of overlays) if (socket.readyState === socket.OPEN) n += 1;
    return n;
  }

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

        // L'overlay s'annonce a la connexion. Sans ca, un onglet de regie ou un
        // second overlay pouvait declarer une vanne terminee a la place d'OBS —
        // et on se retrouvait avec deux voix simultanees a l'antenne.
        if (message.type === 'hello_overlay') {
          overlays.add(socket);
          broadcast({ type: 'health', overlays: overlayCount(), degraded: degradedReason });
          return;
        }

        // L'overlay signale la fin de lecture : c'est ce qui debloque la vanne suivante.
        if (message.type === 'ended' && message.id && overlays.has(socket)) {
          queue.finishPlayback(message.id);
        }
      } catch {
        /* message ignore */
      }
    });

    const forget = (): void => {
      clients.delete(socket);
      if (overlays.delete(socket)) {
        broadcast({ type: 'health', overlays: overlayCount(), degraded: degradedReason });
      }
    };
    socket.on('close', forget);
    socket.on('error', forget);

    socket.send(JSON.stringify({ type: 'health', overlays: overlayCount(), degraded: degradedReason }));
  });

  queue.on('state', (payload) => broadcast({ type: 'state', ...payload }));
  queue.on('play', (payload) => broadcast({ type: 'play', ...payload }));
  queue.on('cut', (payload) => broadcast({ type: 'cut', ...payload }));

  /** Remonte a la regie que des souscriptions Twitch ont echoue. */
  function setDegraded(failed: string[]): void {
    degradedReason = failed;
    broadcast({ type: 'health', overlays: overlayCount(), degraded: degradedReason });
  }

  // Ecoute uniquement en local : l'API de regie n'a pas d'authentification, et
  // /api/test peut faire prononcer un texte arbitraire a l'antenne.
  server.listen(config.server.port, '127.0.0.1', () => {
    log.ok(`Panneau de controle : http://localhost:${config.server.port}/control`);
    log.ok(`Source navigateur OBS : http://localhost:${config.server.port}/overlay`);
  });

  return { server, setDegraded };
}
