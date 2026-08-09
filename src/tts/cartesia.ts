import { config } from '../config.js';
import type { TtsProvider } from './provider.js';

const ENDPOINT = 'https://api.cartesia.ai/tts/bytes';

/**
 * Cartesia Sonic : l'option economique credible face a ElevenLabs sur ce cas
 * d'usage precis — un ordre de grandeur moins cher par minute d'audio a
 * l'echelle, latence de premiere frame nettement plus basse, francais natif.
 *
 * Ce qu'on perd : ElevenLabs reste au-dessus sur le jeu d'acteur, et une vanne
 * vit surtout de son intonation. A tester sur ta propre voix de bot avant de
 * trancher — le bouton "Tester une vanne" de la regie est fait pour ca.
 *
 * L'API attend un en-tete de version date : elle est versionnee, donc figer la
 * date protege d'un changement de schema cote fournisseur.
 */
export const cartesiaProvider: TtsProvider = {
  name: 'cartesia',
  extension: 'mp3',
  supportsInlineDirections: false,

  async synthesise(text: string): Promise<Buffer> {
    const { apiKey, voiceId, modelId, version } = config.tts.cartesia;

    if (!apiKey) throw new Error('CARTESIA_API_KEY manquant.');
    if (!voiceId) throw new Error('CARTESIA_VOICE_ID manquant.');

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': version,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model_id: modelId,
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        language: 'fr',
        output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Cartesia ${response.status} : ${(await response.text()).slice(0, 300)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  },
};
