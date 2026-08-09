import { config } from '../config.js';
import type { TtsProvider } from './provider.js';

const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';

/**
 * ElevenLabs multilingual : la reference en qualite FR, et le fournisseur qui
 * "joue" le mieux une vanne plutot que de la lire. C'est aussi le plus cher du
 * lot — voir src/tts/cartesia.ts pour l'option economique.
 *
 * On reste en HTTP simple plutot qu'en streaming : la vanne fait six secondes
 * et elle est generee pendant que la precedente passe a l'antenne, donc la
 * latence de generation ne s'entend pas.
 */
export const elevenLabsProvider: TtsProvider = {
  name: 'elevenlabs',
  extension: 'mp3',
  // eleven_multilingual_v2 lirait "[laughing]" a voix haute.
  supportsInlineDirections: false,

  async synthesise(text: string): Promise<Buffer> {
    const { apiKey, voiceId, modelId } = config.tts.elevenlabs;

    if (!apiKey) throw new Error('ELEVENLABS_API_KEY manquant.');
    if (!voiceId) throw new Error('ELEVENLABS_VOICE_ID manquant.');

    const response = await fetch(`${ENDPOINT}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          // Assez bas pour que la voix joue la vanne au lieu de la reciter,
          // assez haut pour rester intelligible en direct.
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs ${response.status} : ${(await response.text()).slice(0, 300)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  },
};
