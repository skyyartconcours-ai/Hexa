import { config, missingConfig } from './config.js';
import { openDb } from './db.js';
import { TwitchClient } from './twitch.js';
import { PushService } from './push.js';
import { GiveawayService } from './giveaway.js';
import { sessions as makeSessions } from './session.js';
import { createApp } from './app.js';

const logger = console;
const missing = missingConfig();
if (missing.length) logger.warn(`⚠️  Configuration incomplète, à remplir dans .env : ${missing.join(', ')}`);
if (!config.sessionSecret) {
  logger.error('SESSION_SECRET est obligatoire.');
  process.exit(1);
}

const db = openDb(config.dbPath);
const twitch = new TwitchClient({ config, db });
const push = new PushService({ db, vapid: config.vapid, logger });
const extensionReady = Boolean(config.extension.clientId && config.extension.secret);

const service = new GiveawayService({
  db,
  logger,
  broadcast: extensionReady ? (msg) => twitch.broadcastToExtension(msg) : async () => {},
  fetchSubscribers: (ids) => twitch.getSubscribers(ids),
  lookupUser: (id) => twitch.getUser(id),
});

async function onStreamOnline(event) {
  let g = service.active();
  if (!g && service.settings().autoStart) g = service.start();
  const result = await push.sendAll({
    title: `🔴 ${event.broadcaster_user_name} est en live !`,
    body: g
      ? `🎁 Giveaway en cours : ${g.prize}. Reste sur le live pour cumuler des tickets !`
      : 'Viens passer dire bonjour 👋',
    url: `https://twitch.tv/${event.broadcaster_user_login}`,
  });
  logger.info(`Live démarré → ${result.sent} notification(s) envoyée(s).`);
}

const app = createApp({ config, db, service, twitch, push, sessions: makeSessions({
  secret: config.sessionSecret,
  secure: config.publicUrl.startsWith('https://'),
}), onStreamOnline, logger });

app.listen(config.port, () => logger.info(`Serveur prêt sur ${config.publicUrl} (port ${config.port})`));

setInterval(() => service.tick().catch((err) => logger.error('tick failed:', err)), 5000);

// EventSub webhooks require a public HTTPS URL; register (idempotently) on boot.
if (config.publicUrl.startsWith('https://') && config.twitch.clientSecret && config.eventsubSecret && config.broadcasterId) {
  twitch.ensureStreamOnlineSub()
    .then((s) => logger.info(`Notification "live démarré" : ${s.status}`))
    .catch((err) => logger.warn('Impossible de s\'abonner à stream.online :', err.message));
}
