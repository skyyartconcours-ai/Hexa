import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_DIR, config } from '../config.js';
import { log } from '../log.js';
import { synthesiseElevenLabs } from './elevenlabs.js';

fs.mkdirSync(AUDIO_DIR, { recursive: true });

/**
 * Genere le fichier audio d'une vanne.
 * Retourne le chemin du mp3, ou null si le TTS est desactive (mode texte seul).
 */
export async function synthesise(id: string, text: string): Promise<string | null> {
  if (config.tts.provider === 'none') return null;

  const audio = await synthesiseElevenLabs(text);
  const filePath = path.join(AUDIO_DIR, `${id}.mp3`);
  await fs.promises.writeFile(filePath, audio);
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
    if (!entry.endsWith('.mp3')) continue;
    fs.rmSync(path.join(AUDIO_DIR, entry), { force: true });
    removed += 1;
  }
  if (removed) log.info(`${removed} fichier(s) audio residuel(s) supprime(s).`);
}
