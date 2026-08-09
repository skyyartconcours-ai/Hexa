import { config } from './config.js';
import {
  forgetUser,
  isOptedOut,
  isSubscriber,
  purgeOldMessages,
  recordMessage,
  setOptOut,
  syncSubscribers,
} from './db.js';
import { log } from './log.js';
import { RoastQueue } from './roast/queue.js';
import { loadCustomBlocklist, sanitiseChatMessage } from './roast/safety.js';
import { startServer } from './server/index.js';
import { clearAudioDir } from './tts/index.js';
import { getCurrentUser, getUserByLogin, listSubscribers, sendChatMessage } from './twitch/api.js';
import { hasStoredToken } from './twitch/auth.js';
import { EventSubClient } from './twitch/eventsub.js';

const OPT_OUT_COMMAND = '!noroast';
const OPT_IN_COMMAND = '!roastme';
const FORGET_COMMAND = '!forgetme';

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
  const { setDegraded } = startServer(queue);

  if (config.echoInChat) {
    queue.on('spoken', (item) => {
      sendChatMessage(channel.id, me.id, `🔥 ${item.text}`).catch((error: unknown) => {
        log.warn('Echo chat impossible :', error instanceof Error ? error.message : error);
      });
    });
  }

  /**
   * Photo des abonnes, via l'API officielle.
   *
   * Twitch donne ici QUI est abonne, a quel palier, et qui lui a offert son sub.
   * Il ne donne NI l'anciennete d'abonnement, NI le moindre message : aucun
   * endpoint n'expose l'historique de chat, cette liste ne le debloque pas.
   * Ce qu'elle apporte : de la matiere a vanne des le premier jour, sans
   * attendre d'avoir loggue quoi que ce soit.
   */
  const syncSubs = async (): Promise<void> => {
    try {
      const rows = await listSubscribers(channel.id);
      const result = syncSubscribers(
        rows.map((row) => ({
          userId: row.user_id,
          userLogin: row.user_login,
          userName: row.user_name,
          tier: row.tier,
          isGift: row.is_gift,
          gifterName: row.gifter_name,
        })),
      );
      if (result.suspicious) {
        log.warn(
          `Liste des abonnes anormalement courte (${result.total}) : reponse Twitch ` +
            'probablement tronquee. Aucun abonne retire par securite.',
        );
      } else {
        log.twitch(
          `Abonnes synchronises : ${result.total} actifs` +
            (result.gone ? `, ${result.gone} parti(s) depuis la derniere passe.` : '.'),
        );
      }
    } catch (error) {
      log.warn(
        'Synchronisation des abonnes impossible :',
        error instanceof Error ? error.message : error,
      );
    }
  };

  await syncSubs();
  setInterval(() => void syncSubs(), 30 * 60_000);

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
    if (lower === FORGET_COMMAND) {
      queue.purgeUser(message.userId);
      const removed = forgetUser(message.userId);
      log.info(`${message.userName} : ${removed} ligne(s) effacee(s) a sa demande.`);
      return;
    }

    // Quelqu'un qui s'est oppose ne doit plus etre enregistre du tout, pas
    // seulement epargne par les vannes : c'est le meme droit.
    if (isOptedOut(message.userId)) return;

    // Desactive par defaut, et il faut savoir pourquoi avant de l'activer :
    // voir le commentaire de `subscribersOnly` dans config.ts. Filtrer sur les
    // abonnes supprime la matiere sur les NOUVEAUX abonnes, qui sont la cible
    // principale — au moment ou ils parlaient, ils n'etaient pas encore abonnes.
    if (config.chat.subscribersOnly && !isSubscriber(message.userId)) return;

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

  eventsub.on('ready', () => {
    setDegraded([]);
    log.ok('En ecoute. Ouvre le panneau de controle pour lancer une session.');
  });

  eventsub.on('degraded', (failed) => {
    setDegraded(failed);
    log.error(
      `NE PAS LANCER DE SESSION : ${failed.length} souscription(s) Twitch ont echoue ` +
        `(${failed.join(', ')}). Relance \`npm run login\` puis \`npm start\`.`,
    );
  });

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
