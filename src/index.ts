import { config } from './config.js';
import { purgeOldMessages, recordMessage, setOptOut } from './db.js';
import { log } from './log.js';
import { RoastQueue } from './roast/queue.js';
import { loadCustomBlocklist, sanitiseChatMessage } from './roast/safety.js';
import { startServer } from './server/index.js';
import { clearAudioDir } from './tts/index.js';
import { getCurrentUser, getUserByLogin, sendChatMessage } from './twitch/api.js';
import { hasStoredToken } from './twitch/auth.js';
import { EventSubClient } from './twitch/eventsub.js';

const OPT_OUT_COMMAND = '!noroast';
const OPT_IN_COMMAND = '!roastme';

async function main(): Promise<void> {
  if (!hasStoredToken()) {
    log.error('Aucun token Twitch. Lance `npm run login` avant `npm start`.');
    process.exitCode = 1;
    return;
  }
  if (!config.anthropic.apiKey && !process.env['ANTHROPIC_API_KEY']) {
    log.warn('ANTHROPIC_API_KEY absent : la generation des vannes va echouer.');
  }

  loadCustomBlocklist();
  clearAudioDir();
  purgeOldMessages();
  setInterval(purgeOldMessages, 6 * 3600_000);

  const channel = await getUserByLogin(config.twitch.channel);
  if (!channel) throw new Error(`Chaine Twitch introuvable : ${config.twitch.channel}`);

  const me = await getCurrentUser();
  if (me.id !== channel.id) {
    log.warn(
      `Le token appartient a ${me.login} mais la chaine visee est ${channel.login}. ` +
        'Les evenements de sub demandent le token du broadcaster.',
    );
  }
  log.ok(`Chaine ciblee : ${channel.display_name} (${channel.id})`);

  const queue = new RoastQueue();
  queue.run();
  startServer(queue);

  if (config.echoInChat) {
    queue.on('spoken', (item) => {
      sendChatMessage(channel.id, me.id, `🔥 ${item.text}`).catch((error: unknown) => {
        log.warn('Echo chat impossible :', error instanceof Error ? error.message : error);
      });
    });
  }

  const eventsub = new EventSubClient(channel.id);

  // Le nom du dernier donateur, pour l'attacher aux receveurs qui arrivent juste apres.
  let lastGifter: { name: string; at: number } | null = null;

  eventsub.on('chat', (message) => {
    const lower = message.text.trim().toLowerCase();

    if (lower === OPT_OUT_COMMAND) {
      setOptOut(message.userId, message.userLogin, message.userName, true);
      queue.purgeUser(message.userId);
      log.info(`${message.userName} s'est retire des roasts.`);
      return;
    }
    if (lower === OPT_IN_COMMAND) {
      setOptOut(message.userId, message.userLogin, message.userName, false);
      log.info(`${message.userName} accepte de nouveau les roasts.`);
      return;
    }

    const clean = sanitiseChatMessage(message.text);
    if (!clean) return;
    recordMessage(message.userId, message.userLogin, message.userName, clean);
  });

  eventsub.on('sub', (trigger) => {
    if (trigger.type === 'gift' && !trigger.anonymous) {
      lastGifter = { name: trigger.userName, at: Date.now() };
    }
    if (trigger.type === 'gift_recipient' && lastGifter && Date.now() - lastGifter.at < 60_000) {
      trigger.gifterName = lastGifter.name;
    }
    queue.submit(trigger);
  });

  eventsub.on('ready', () => log.ok('En ecoute. Ouvre le panneau de controle pour lancer une session.'));
  eventsub.start();

  const shutdown = (): void => {
    log.info('Arret...');
    eventsub.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
