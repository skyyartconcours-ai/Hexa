import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_DIR, config } from '../config.js';
import { log } from '../log.js';
import { cartesiaProvider } from './cartesia.js';
import { elevenLabsProvider } from './elevenlabs.js';
import { fishAudioProvider } from './fishaudio.js';
import type { Delivery, TtsProvider } from './provider.js';

export { DELIVERIES, isDelivery } from './provider.js';
export type { Delivery, TtsProvider } from './provider.js';

fs.mkdirSync(AUDIO_DIR, { recursive: true });

const PROVIDERS: Record<string, TtsProvider> = {
  fishaudio: fishAudioProvider,
  elevenlabs: elevenLabsProvider,
  cartesia: cartesiaProvider,
};

export function activeProvider(): TtsProvider | null {
  if (config.tts.provider === 'none') return null;

  const provider = PROVIDERS[config.tts.provider];
  if (!provider) {
    throw new Error(
      `TTS_PROVIDER inconnu : "${config.tts.provider}". ` +
        `Valeurs acceptees : ${[...Object.keys(PROVIDERS), 'none'].join(', ')}.`,
    );
  }
  return provider;
}

/**
 * Genere le fichier audio d'une vanne.
 *
 * `direction` est une didascalie de jeu ("deadpan", "laughing"...). Elle n'est
 * transmise qu'aux fournisseurs qui la comprennent : ailleurs elle est retiree,
 * sinon la voix annonce "crochet laughing crochet" en plein live.
 *
 * Retourne le chemin du fichier, ou null si le TTS est desactive (texte seul).
 */
export async function synthesise(
  id: string,
  text: string,
  direction?: Delivery,
  pseudo?: string,
): Promise<string | null> {
  const provider = activeProvider();
  if (!provider) return null;

  const clean = toSpeech(text, pseudo);
  const spoken =
    direction && provider.supportsInlineDirections ? `[${direction}] ${clean}` : clean;

  const started = Date.now();
  const audio = await provider.synthesise(spoken);
  const filePath = path.join(AUDIO_DIR, `${id}.${provider.extension}`);
  await fs.promises.writeFile(filePath, audio);

  log.info(
    `Voix generee via ${provider.name} en ${Date.now() - started} ms ` +
      `(${text.length} caracteres, ${Math.round(audio.length / 1024)} Ko).`,
  );
  return filePath;
}

export function deleteAudio(filePath: string | null): void {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {
    /* deja supprime, sans importance */
  });
}

/** Vide le dossier audio au demarrage : ces fichiers sont jetables. */
export function clearAudioDir(): void {
  let removed = 0;
  for (const entry of fs.readdirSync(AUDIO_DIR)) {
    if (!/\.(mp3|wav)$/.test(entry)) continue;
    fs.rmSync(path.join(AUDIO_DIR, entry), { force: true });
    removed += 1;
  }
  if (removed) log.info(`${removed} fichier(s) audio residuel(s) supprime(s).`);
}

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

/** "xX_D4rkS0ul_Xx" -> "Dark Soul". La voix lit ceci ; l'overlay garde le pseudo brut. */
export function spokenPseudo(name: string): string {
  const s = name
    .replace(/^(?:[xX]{1,3}[_\-.~]+)+/, '') // "xX_" en tete
    .replace(/(?:[_\-.~]+[xX]{1,3})+$/, '') // "_Xx" en queue
    // chiffres colles entre une lettre et une minuscule : leetspeak (D4rk, S0ul, N00b)
    .replace(/(?<=\p{L})\d+(?=\p{Ll})/gu, (d) => [...d].map((c) => LEET[c] ?? c).join(''))
    .replace(/[_\-.~]+/g, ' ')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2') // CamelCase
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return s || name;
}

/** Texte envoye au TTS : pseudo prononcable, sans emoji (lus ou avales selon le modele). */
export function toSpeech(text: string, pseudo?: string): string {
  const withPseudo = pseudo ? text.split(pseudo).join(spokenPseudo(pseudo)) : text;
  return withPseudo
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F\u20E3]+/gu, '')
    .replace(/\s+([,.…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
