/**
 * `npm run preview` — des vannes d'exemple sur les vrais viewers de ton chat,
 * pour juger le ton avant le live.
 *
 * Meme chaine que le direct : profil tire du chat enregistre (log en direct et
 * VODs importees), ecriture, filtre, juge, et la voix avec --voix. Mais rien ne
 * part vers Twitch : pas de session, pas d'annonce, pas d'overlay, rien dans
 * l'historique des vannes ni dans les cooldowns. Seuls sortent de la machine
 * les appels a Anthropic (et au TTS avec --voix), comme pour une vraie vanne.
 * Les viewers qui ont tape !noroast sont ignores, comme en direct.
 *
 *   npm run preview                       5 viewers parmi les plus bavards
 *   npm run preview -- --viewers 10       10 viewers
 *   npm run preview -- pseudo1 pseudo2    ces viewers-la
 *   npm run preview -- --voix             ecrit aussi l'audio dans data/preview/
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, config } from './config.js';
import {
  buildProfile,
  chatStats,
  findUserByLogin,
  isOptedOut,
  pastRoastsFor,
  subscriberFacts,
  topChatters,
} from './db.js';
import { setQuiet } from './log.js';
import { reloadChannelContext } from './roast/channel.js';
import { RefusedError, generateRoast } from './roast/generator.js';
import { judgeRoast } from './roast/judge.js';
import { ANGLES } from './roast/prompt.js';
import { screenDraft } from './roast/queue.js';
import { checkName, loadCustomBlocklist } from './roast/safety.js';
import { activeProvider, spokenPseudo, synthesise } from './tts/index.js';
import type { RoastTrigger } from './types.js';

const PREVIEW_DIR = path.join(DATA_DIR, 'preview');
/** Tirage parmi les plus bavards : de la matiere, et de la variete d'un lancement a l'autre. */
const POOL = 30;
const MAX_VIEWERS = 20;

interface Viewer {
  userId: string;
  userLogin: string;
  userName: string;
}

interface Args {
  names: string[];
  count: number;
  voice: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { names: [], count: 5, voice: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--voix') args.voice = true;
    else if (arg === '--viewers') args.count = Math.max(1, Math.min(MAX_VIEWERS, Number(argv[++i]) || 5));
    else if (!arg.startsWith('--')) args.names.push(arg.replace(/^@/, ''));
  }
  return args;
}

function shuffle<T>(items: T[]): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool;
}

const quote = (text: string, max = 90): string =>
  `« ${text.length > max ? `${text.slice(0, max - 1)}…` : text} »`;

function chooseViewers(args: Args): Viewer[] {
  if (!args.names.length) return shuffle(topChatters(POOL, config.twitch.channel)).slice(0, args.count);

  const viewers: Viewer[] = [];
  for (const name of args.names) {
    const known = findUserByLogin(name);
    if (!known) {
      console.log(`${name} : jamais vu dans le chat enregistre, ignore.`);
    } else if (isOptedOut(known.userId)) {
      console.log(`${name} : a tape !noroast, ignore.`);
    } else {
      viewers.push({ userId: known.userId, userLogin: name.toLowerCase(), userName: known.userName });
    }
  }
  return viewers;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!config.anthropic.apiKey && !process.env['ANTHROPIC_API_KEY']) {
    console.error("ANTHROPIC_API_KEY absent dans .env : impossible d'ecrire une vanne.");
    process.exitCode = 1;
    return;
  }

  setQuiet(true);
  loadCustomBlocklist();
  reloadChannelContext();

  const stats = chatStats();
  const viewers = chooseViewers(args);
  if (!viewers.length) {
    console.log(
      stats.messages
        ? 'Aucun viewer a montrer.'
        : 'Le chat enregistre est vide. Lance `npm run backfill` pour importer le chat de tes VODs, ' +
            'ou laisse `npm start` tourner pendant un live.',
    );
    return;
  }

  console.log(
    `\nApercu Hexa : ${viewers.length} viewer(s) tire(s) du chat enregistre ` +
      `(${stats.messages} messages, ${stats.users} viewers connus).`,
  );
  console.log(
    "Rien n'est poste dans le chat, diffuse ni enregistre. Chaque vanne coute un appel au modele " +
      `(${config.anthropic.model}) et un au juge.\n`,
  );

  const angles: string[] = [];
  const tally = { passe: 0, filtre: 0, juge: 0, erreur: 0, pseudo: 0 };

  for (const [index, viewer] of viewers.entries()) {
    const profile = buildProfile(viewer.userId, viewer.userLogin, viewer.userName);
    const facts = subscriberFacts(viewer.userId);
    const months = profile.subMonths;
    // Un abonne de longue date qui revient, c'est un resub : on le simule tel quel.
    const resubMonths = months !== null && months >= 2 ? months : null;
    const trigger: RoastTrigger = {
      type: resubMonths ? 'resub' : 'sub',
      userId: viewer.userId,
      userLogin: viewer.userLogin,
      userName: viewer.userName,
      tier: facts?.tier ?? '1000',
      ...(resubMonths ? { cumulativeMonths: resubMonths } : {}),
    };

    const about = [
      `${profile.messageCount} message(s)` + (profile.daysKnown ? ` sur ${profile.daysKnown} jour(s)` : ''),
    ];
    if (months) about.push(`abonne depuis ${months} mois (badge)`);
    console.log(`${index + 1}/${viewers.length}  ${viewer.userName} — ${about.join(' · ')}`);
    for (const message of profile.recentMessages.slice(0, 3)) console.log(`      ${quote(message)}`);
    console.log(`      simule : ${resubMonths ? `resub, ${resubMonths} mois` : 'nouveau sub'}`);

    const name = checkName(viewer.userName, spokenPseudo(viewer.userName));
    if (!name.ok) {
      tally.pseudo += 1;
      console.log(`   ✕ ${name.reason}. En direct, ce viewer serait ignore.\n`);
      continue;
    }

    try {
      const draft = await generateRoast(trigger, profile, pastRoastsFor(viewer.userId), facts, angles);
      const verdict = screenDraft(trigger, profile, draft);
      const judged = verdict.ok ? await judgeRoast(viewer.userName, draft.roast) : null;
      const passes = judged !== null && (judged.ok || judged.unavailable === true);

      console.log(`   ${passes ? '✓' : '✕'} ${quote(draft.roast, 400)}`);
      console.log(
        `      ton : ${draft.delivery ?? 'neutre'} · angle : ${draft.angle || '—'} · severite ${draft.severity}/5`,
      );
      if (!verdict.ok) {
        tally.filtre += 1;
        console.log(`      jetee par le filtre : ${verdict.reason}`);
      } else if (judged && !passes) {
        tally.juge += 1;
        console.log(`      jetee par le juge : ${judged.verdict} (${judged.reason})`);
      } else if (judged?.unavailable) {
        tally.passe += 1;
        console.log('      juge injoignable : en direct, elle attendrait ta relecture en regie');
      } else {
        tally.passe += 1;
        console.log(`      filtre : ok · juge : ${judged?.verdict} (${judged?.reason})`);
      }

      if (passes) {
        const angle = draft.angle.trim().toLowerCase();
        if ((ANGLES as readonly string[]).includes(angle)) angles.push(angle);
      }

      if (passes && args.voice) {
        if (!activeProvider()) {
          console.log('      voix : TTS_PROVIDER=none, pas de voix');
        } else {
          try {
            const file = await synthesise(randomUUID(), draft.roast, draft.delivery, viewer.userName);
            if (file) {
              fs.mkdirSync(PREVIEW_DIR, { recursive: true });
              const target = path.join(PREVIEW_DIR, `${viewer.userLogin}${path.extname(file)}`);
              fs.renameSync(file, target);
              console.log(`      voix : ${path.relative(process.cwd(), target)}`);
            }
          } catch (error) {
            console.log(`      voix impossible : ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } catch (error) {
      tally.erreur += 1;
      const reason =
        error instanceof RefusedError ? 'refus du modele' : error instanceof Error ? error.message : String(error);
      console.log(`   ✕ generation impossible : ${reason}`);
    }
    console.log('');
  }

  const parts = [`${tally.passe} ${tally.passe > 1 ? 'passeraient' : 'passerait'} a l'antenne`];
  if (tally.filtre) parts.push(`${tally.filtre} jetee(s) par le filtre`);
  if (tally.juge) parts.push(`${tally.juge} par le juge`);
  if (tally.pseudo) parts.push(`${tally.pseudo} pseudo(s) refuse(s)`);
  if (tally.erreur) parts.push(`${tally.erreur} en erreur`);
  console.log(`Bilan : ${parts.join(', ')}.`);
  if (!args.voice) console.log('Ajoute --voix pour entendre celles qui passent (fichiers dans data/preview/).');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
