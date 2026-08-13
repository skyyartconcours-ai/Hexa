import { config } from './config.js';
import {
  forgetUser,
  isOptedOut,
  isSubscriber,
  noteSubMonths,
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
const INFO_COMMAND = '!hexa';

/**
 * Reponse a `!hexa`. Elle doit se suffire a elle-meme : un lien vers une page
 * servie sur localhost ne veut rien dire pour un viewer. Limite Twitch : 500
 * caracteres.
 */
const INFO_TEXT =
  '🤖 Hexa : pendant les sessions de roast, chaque sub passe à l\'antenne avec ' +
  'une vanne écrite et lue par une IA. Ce qui est gardé : ton pseudo et tes ' +
  'messages du chat, 30 jours maximum, sur le PC du stream — rien n\'est revendu. ' +
  `${OPT_OUT_COMMAND} = aucune vanne sur toi, avant comme après. ` +
  `${FORGET_COMMAND} = tout ce qui te concerne est effacé sur-le-champ.`;

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
   * L'annonce de la fenetre.
   *
   * Tout le format repose la-dessus : ce qui rend la vanne legitime, ce n'est
   * pas qu'elle soit gentille, c'est que la personne qui s'abonne sache qu'elle
   * va passer a l'antenne. Annoncer une fois au lancement ne suffit pas — un
   * raid a la douzieme minute amene des gens qui n'ont rien entendu. D'ou le
   * rappel periodique, qui coute quatre messages sur une fenetre de 20 minutes.
   */
  const ANNOUNCE_EVERY_MS = 5 * 60_000;
  const INFO_COOLDOWN_MS = 30_000;
  let announceTimer: NodeJS.Timeout | null = null;
  let lastInfoAt = 0;

  const announce = (text: string): void => {
    sendChatMessage(channel.id, me.id, text).catch((error: unknown) => {
      log.warn('Annonce en chat impossible :', error instanceof Error ? error.message : error);
    });
  };

  queue.on('session', (payload) => {
    if (announceTimer) clearInterval(announceTimer);
    announceTimer = null;

    if (!payload.active) {
      announce('🎤 Session de roast terminée. Merci à tous ceux qui sont passés !');
      return;
    }

    const open = (): void =>
      announce(
        `🎤 SESSION DE ROAST OUVERTE${payload.minutes ? ` pour ${payload.minutes} min` : ''} — ` +
          "chaque sub passe à l'antenne avec une vanne écrite et lue par une IA. " +
          `Tu ne veux pas ? Tape ${OPT_OUT_COMMAND} et tu es exclu, avant comme après. ` +
          `Détails : ${INFO_COMMAND}`,
      );

    open();
    announceTimer = setInterval(open, ANNOUNCE_EVERY_MS);
  });

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
    if (lower === INFO_COMMAND) {
      // N'importe qui peut declencher cette reponse : sans garde-fou, deux
      // trolls suffisent a faire rate-limiter le compte du stream.
      if (Date.now() - lastInfoAt > INFO_COOLDOWN_MS) {
        lastInfoAt = Date.now();
        announce(INFO_TEXT);
      }
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
    if (!clean) {
      // Message jete (emote seule, lien, commande) mais badge exploitable :
      // on garde l'anciennete, qui vaut souvent plus qu'un message de plus.
      if (message.subMonths !== null) {
        noteSubMonths(message.userId, message.userLogin, message.userName, message.subMonths);
      }
      return;
    }
    recordMessage(message.userId, message.userLogin, message.userName, clean, message.subMonths);
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
