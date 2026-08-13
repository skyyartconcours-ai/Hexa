import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { log } from '../log.js';

const CHANNEL_FILE = path.join(DATA_DIR, 'channel.md');

/**
 * Le contexte de la chaine, ecrit a la main par le streamer.
 *
 * C'est de loin le plus gros levier de qualite du produit, et le seul que le
 * code ne peut pas fournir. Un modele qui ne connait que le pseudo et
 * l'historique de chat produit une vanne generique et correcte. Le meme modele
 * qui sait que "la soupe" est une private joke de la chaine depuis deux ans
 * produit une vanne que le chat reconnait — et c'est toute la difference entre
 * un bot et un membre de la communaute.
 *
 * Volontairement un fichier plutot qu'une variable d'environnement : ca se
 * relit, ca s'edite entre deux sessions, et ca peut faire trois pages.
 */
let cached: string | null = null;

export function reloadChannelContext(): string | null {
  try {
    const raw = fs.readFileSync(CHANNEL_FILE, 'utf8').trim();
    // Un fichier qui ne contient que le gabarit d'exemple n'apporte rien et
    // couterait des tokens a chaque vanne.
    const useful = raw
      .split('\n')
      .filter((line) => line.trim() && !line.trimStart().startsWith('<!--'))
      .join('\n');
    cached = useful.length > 40 ? useful : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function channelContext(): string | null {
  return cached;
}

/** Trace au demarrage : sans ca, un fichier mal place passe inapercu. */
export function reportChannelContext(): void {
  const text = reloadChannelContext();
  if (text) {
    log.ok(`Contexte de chaine charge (${text.length} caracteres) depuis data/channel.md`);
  } else {
    log.warn(
      'Aucun contexte de chaine. Les vannes seront generiques. ' +
        'Copie channel.example.md vers data/channel.md et remplis-le : ' +
        "c'est le reglage qui change le plus la qualite.",
    );
  }
}
