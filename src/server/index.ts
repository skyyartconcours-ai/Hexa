import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { AUDIO_DIR, PUBLIC_DIR, config } from '../config.js';
import { chatStats, findUserByLogin, isOptedOutName, listOptedOut, nameKey } from '../db.js';
import { log } from '../log.js';
import type { RoastQueue } from '../roast/queue.js';
import { clearAudioDir } from '../tts/index.js';
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
  /** Connexion EventSub coupee / retablie. */
  setTwitchDown(down: boolean): void;
  /** Alerte nommee affichee en regie (annonce non postee, token refuse) ; null l'efface. */
  setProblem(key: string, message: string | null): void;
}

/**
 * Le serveur n'ecoute que sur 127.0.0.1, mais le navigateur du streamer, lui,
 * visite d'autres sites. Sans ces controles, une page quelconque ouverte dans
 * un autre onglet pouvait envoyer un POST "simple" (text/plain, sans preflight
 * CORS) sur /api/session/start, ou ouvrir le WebSocket — le WebSocket n'est pas
 * couvert par CORS. On n'accepte donc que ce qui vient de nos propres pages.
 */
function isLocalHost(host: string | undefined): boolean {
  // Contre le DNS rebinding : un domaine externe qui se resout en 127.0.0.1
  // arrive avec SON nom dans Host, pas le notre.
  if (!host) return false;
  return host === `localhost:${config.server.port}` || host === `127.0.0.1:${config.server.port}`;
}

function isLocalOrigin(origin: string | undefined): boolean {
  // Pas d'Origin : navigation directe, OBS, curl. Une page d'un autre site en
  // envoie toujours un sur un POST ou une ouverture de WebSocket.
  if (!origin) return true;
  return origin === `http://localhost:${config.server.port}` || origin === `http://127.0.0.1:${config.server.port}`;
}

export function startServer(queue: RoastQueue): ServerHandle {
  const app = express();

  app.use((req, res, next) => {
    if (!isLocalHost(req.headers.host)) return res.status(403).send('Hote refuse.');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!isLocalOrigin(req.headers.origin)) return res.status(403).json({ error: 'origine refusee' });
      // Exiger du JSON force un preflight CORS pour toute requete venue d'ailleurs,
      // preflight auquel on ne repond jamais favorablement.
      if (!req.is('application/json')) return res.status(415).json({ error: 'JSON attendu' });
    }
    return next();
  });
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
      generation: queue.getGenerationHealth(),
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
    // `test` : archivee a part, elle ne met pas le vrai viewer en cooldown.
    const id = queue.submit({ ...trigger, test: true }, { force: true });
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
    // Le nom vient du service de dons : tape librement, jamais verifie. Il ne
    // doit ni emprunter l'identite (et l'historique de chat) d'un viewer, ni
    // contourner son !noroast, ni porter de l'invisible jusqu'au prompt.
    const name = String(req.body?.userName ?? req.body?.user ?? '')
      .normalize('NFKC')
      .replace(/[\p{Cc}\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]/gu, '')
      // S'affiche en gros sur l'overlay : lettres, chiffres, espace et _-.' seulement.
      .replace(/[^\p{L}\p{N}\s_\-.']/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 25);
    const amount = Number(req.body?.amount);
    if (!name) return res.status(400).json({ error: 'userName manquant' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount invalide' });
    if (isOptedOutName(name)) return res.json({ id: null, known: false, skipped: 'opt-out' });

    // Le NOM ne relie jamais le don a un viewer (profil, historique de chat) : n'importe
    // qui peut taper n'importe quel nom. Seul l'identifiant Twitch transmis par le
    // service de dons (donateur connecte via Twitch) le fait.
    const key = nameKey(name) || 'anonyme';
    const verifiedId = typeof req.body?.twitchUserId === 'string' && req.body.twitchUserId ? req.body.twitchUserId : null;
    const trigger: RoastTrigger = {
      type: 'donation',
      userId: verifiedId ?? `donation:${key}`,
      userLogin: key,
      userName: name,
      // Meme personne probable : le cooldown du compte Twitch de ce login s'applique (pas son profil).
      cooldownIds: (() => {
        const twin = findUserByLogin(key);
        return twin && twin.userId !== verifiedId ? [twin.userId] : undefined;
      })(),
      // Les services de dons remplacent le nom d'un don anonyme par un libelle.
      anonymous: req.body?.anonymous === true || /^(anonym(e|ous)?|anon)$/i.test(name),
      amount,
      currency: String(req.body?.currency ?? 'EUR').slice(0, 5),
      message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 300) : undefined,
    };
    const id = queue.submit(trigger);
    return res.json({ id, known: false });
  });

  // ── WebSocket ──────────────────────────────────────────────────────────

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    // Meme regle que pour l'API : seules nos pages (regie, overlay OBS) parlent au WebSocket.
    verifyClient: ({ origin, req }: { origin: string; req: http.IncomingMessage }) =>
      isLocalHost(req.headers.host) && isLocalOrigin(origin || undefined),
  });
  const clients = new Set<WebSocket>();
  /** Seuls les overlays peuvent declarer une vanne terminee (voir plus bas). */
  const overlays = new Set<WebSocket>();
  let degradedReason: string[] = [];
  /** EventSub coupe (reseau, panne Twitch) : les subs ne sont PAS recus. */
  let twitchDown = false;
  const problems = new Map<string, string>();
  const health = () => ({
    type: 'health',
    overlays: overlayCount(),
    degraded: degradedReason,
    twitchDown,
    problems: [...problems.values()],
  });

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
      JSON.stringify({
        type: 'state',
        session: queue.getState(),
        queue: queue.getQueue(),
        generation: queue.getGenerationHealth(),
      }),
    );

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; id?: string; failed?: boolean };

        // L'overlay s'annonce a la connexion. Sans ca, un onglet de regie ou un
        // second overlay pouvait declarer une vanne terminee a la place d'OBS —
        // et on se retrouvait avec deux voix simultanees a l'antenne.
        if (message.type === 'hello_overlay') {
          overlays.add(socket);
          queue.setOutputReady(true);
          broadcast(health());
          return;
        }

        // L'overlay signale la fin de lecture : c'est ce qui debloque la vanne suivante.
        if (message.type === 'ended' && message.id && overlays.has(socket)) {
          queue.finishPlayback(message.id, message.failed === true);
        }
      } catch {
        /* message ignore */
      }
    });

    const forget = (): void => {
      clients.delete(socket);
      if (overlays.delete(socket)) {
        queue.setOutputReady(overlayCount() > 0);
        broadcast(health());
      }
    };
    socket.on('close', forget);
    socket.on('error', forget);

    socket.send(JSON.stringify(health()));
  });

  queue.on('state', (payload) => broadcast({ type: 'state', ...payload }));
  queue.on('play', (payload) => broadcast({ type: 'play', ...payload }));
  queue.on('cut', (payload) => broadcast({ type: 'cut', ...payload }));

  /** Remonte a la regie que des souscriptions Twitch ont echoue. */
  function setDegraded(failed: string[]): void {
    degradedReason = failed;
    broadcast(health());
  }

  function setProblem(key: string, message: string | null): void {
    if (message === null ? !problems.delete(key) : problems.get(key) === message) return;
    if (message !== null) problems.set(key, message);
    broadcast(health());
  }

  function setTwitchDown(down: boolean): void {
    if (twitchDown === down) return;
    twitchDown = down;
    broadcast(health());
  }

  // Ecoute uniquement en local : l'API de regie n'a pas d'authentification, et
  // /api/test peut faire prononcer un texte arbitraire a l'antenne.
  // Un deuxieme `npm start` : message clair plutot qu'une pile d'appels.
  wss.on('error', () => {});
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      log.error(`Le port ${config.server.port} est deja pris : Hexa tourne sans doute deja dans une autre fenetre.`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(config.server.port, '127.0.0.1', () => {
    // Seulement une fois le port obtenu : un deuxieme `npm start` effacait
    // l'audio des vannes en attente de l'instance deja lancee avant d'echouer.
    clearAudioDir();
    log.ok(`Panneau de controle : http://localhost:${config.server.port}/control`);
    log.ok(`Source navigateur OBS : http://localhost:${config.server.port}/overlay`);
  });

  return { server, setDegraded, setTwitchDown, setProblem };
}
