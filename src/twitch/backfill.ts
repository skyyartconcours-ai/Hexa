/**
 * Script autonome : `npm run backfill [-- --vods 10]`
 *
 * Importe le chat des VODs de rediffusion de la chaine dans la base locale,
 * pour donner de la matiere aux vannes sans attendre des semaines de log en
 * direct.
 *
 * Lis l'avertissement en tete de src/twitch/vod.ts : cet import passe par
 * l'API GraphQL interne de Twitch, pas par l'API officielle.
 */
import { config } from '../config.js';
import { chatStats, isVodImported, markVodImported, recordMessages } from '../db.js';
import { log } from '../log.js';
import { getUserByLogin, listArchiveVideos } from './api.js';
import { hasStoredToken } from './auth.js';
import { fetchVodChat } from './vod.js';

function parseArgs(): { vods: number; force: boolean } {
  const args = process.argv.slice(2);
  const vodsIndex = args.indexOf('--vods');
  const vods = vodsIndex >= 0 ? Number.parseInt(args[vodsIndex + 1] ?? '', 10) : Number.NaN;
  return {
    vods: Number.isFinite(vods) && vods > 0 ? vods : 20,
    force: args.includes('--force'),
  };
}

async function main(): Promise<void> {
  if (!hasStoredToken()) {
    log.error('Aucun token Twitch. Lance `npm run login` d\'abord.');
    process.exitCode = 1;
    return;
  }

  const { vods: limit, force } = parseArgs();

  const channel = await getUserByLogin(config.twitch.channel);
  if (!channel) throw new Error(`Chaine Twitch introuvable : ${config.twitch.channel}`);

  const videos = await listArchiveVideos(channel.id, limit);
  if (videos.length === 0) {
    log.warn(
      'Aucune VOD de rediffusion trouvee. Verifie que les rediffusions sont activees ' +
        'dans les parametres de ta chaine — sans elles, il n\'y a pas d\'historique a importer.',
    );
    return;
  }

  log.info(`${videos.length} VOD(s) trouvee(s) sur ${channel.display_name}.`);
  const before = chatStats();

  let imported = 0;
  let skipped = 0;

  for (const [index, video] of videos.entries()) {
    const position = `[${index + 1}/${videos.length}]`;

    if (!force && isVodImported(video.id)) {
      skipped += 1;
      continue;
    }

    const label = video.title.slice(0, 60);
    process.stdout.write(`${position} ${video.id} — ${label} … `);

    try {
      let count = 0;
      await fetchVodChat(video.id, (records) => {
        recordMessages(records);
        count += records.length;
        process.stdout.write('.');
      });
      markVodImported(video.id, video.title, count);
      imported += 1;
      process.stdout.write(` ${count} messages\n`);
    } catch (error) {
      process.stdout.write('\n');
      log.error(
        `VOD ${video.id} ignoree :`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const after = chatStats();
  log.ok(
    `Import termine : ${imported} VOD(s) importee(s), ${skipped} deja faite(s). ` +
      `+${after.messages - before.messages} messages, +${after.users - before.users} viewers.`,
  );
  if (skipped > 0) {
    log.info('Utilise `--force` pour reimporter une VOD deja traitee.');
  }
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
