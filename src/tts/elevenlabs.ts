import { config } from '../config.js';

const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';

/**
 * ElevenLabs multilingual : la meilleure qualite FR aujourd'hui, et le seul
 * fournisseur qui rend une vanne "jouee" plutot que lue. On reste en HTTP
 * simple (pas de streaming) : la vanne fait 6 secondes, elle est generee
 * pendant que la precedente passe, la latence ne se voit pas a l'antenne.
 */
export async function synthesiseElevenLabs(text: string): Promise<Buffer> {
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
        // Assez bas pour que la voix "joue" la vanne au lieu de la reciter,
        // assez haut pour rester intelligible en direct.
        stability: 0.4,
        similarity_boost: 0.75,
        style: 0.35,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs ${response.status} : ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
