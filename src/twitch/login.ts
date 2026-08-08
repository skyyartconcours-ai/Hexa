/**
 * Script autonome : `npm run login`
 * Ouvre le flux Device Code et stocke le token dans la base locale.
 */
import { loginInteractive } from './auth.js';
import { getUserByLogin } from './api.js';
import { config } from '../config.js';
import { log } from '../log.js';

async function main(): Promise<void> {
  await loginInteractive();

  const user = await getUserByLogin(config.twitch.channel);
  if (!user) {
    log.warn(
      `Connecte, mais la chaine "${config.twitch.channel}" est introuvable. Verifie TWITCH_CHANNEL dans .env.`,
    );
    return;
  }
  log.ok(`Pret pour la chaine ${user.display_name} (id ${user.id}). Lance maintenant \`npm start\`.`);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
