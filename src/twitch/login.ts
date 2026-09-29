/**
 * Script autonome : `npm run login`
 * Ouvre le flux Device Code et stocke le token dans la base locale.
 */
import { loginInteractive } from './auth.js';
import { getCurrentUser, getUserByLogin } from './api.js';
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
  // Navigateur connecte au compte modo : token valide, mais aucun sub ni bit
  // de la chaine n'arrivera jamais.
  const me = await getCurrentUser();
  if (me.id !== user.id) {
    log.error(
      `Connecte avec le compte ${me.login}, pas avec la chaine ${user.login} : les subs et les bits n'arriveront pas. ` +
        `Deconnecte-toi de Twitch dans le navigateur, reconnecte-toi en ${user.login}, puis relance \`npm run login\`.`,
    );
    process.exitCode = 1;
    return;
  }
  log.ok(`Pret pour la chaine ${user.display_name} (id ${user.id}). Lance maintenant \`npm start\`.`);
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
