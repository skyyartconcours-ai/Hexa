import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_DIR, config } from '../config.js';
import { log } from '../log.js';
import { cartesiaProvider } from './cartesia.js';
import { elevenLabsProvider } from './elevenlabs.js';
import type { TtsProvider } from './provider.js';

export type { TtsProvider } from './provider.js';

fs.mkdirSync(AUDIO_DIR, { recursive: true });

const PROVIDERS: Record<string, TtsProvider> = {
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
 * Retourne le chemin du fichier, ou null si le TTS est desactive (texte seul).
 */
export async function synthesise(id: string, text: string): Promise<string | null> {
  const provider = activeProvider();
  if (!provider) return null;

  const started = Date.now();
  const audio = await provider.synthesise(text);
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
