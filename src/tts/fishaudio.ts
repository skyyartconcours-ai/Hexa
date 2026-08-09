import { config } from '../config.js';
import type { TtsProvider } from './provider.js';

const ENDPOINT = 'https://api.fish.audio/v1/tts';

/**
 * Fish Audio — le meilleur rapport qualite/prix du lot sur ce cas d'usage.
 * Environ 4 a 5 fois moins cher qu'ElevenLabs en francais, et il gagne les
 * comparaisons a l'aveugle face a lui plus souvent qu'il ne les perd.
 *
 * Deux particularites de leur API a connaitre :
 *
 * 1. Le modele se passe dans un EN-TETE HTTP `model`, pas dans le corps JSON.
 *    C'est inhabituel et c'est la premiere source d'erreur 400 quand on porte
 *    du code depuis un autre fournisseur.
 *
 * 2. La facturation se fait a l'octet UTF-8, pas au caractere : chaque lettre
 *    accentuee compte double. Certains comparatifs en concluent que le francais
 *    coute deux fois le tarif affiche — c'est faux. Mesure sur un echantillon
 *    de vannes reelles : +3,4 % d'octets seulement, parce que les accents
 *    representent quelques pourcents des caracteres, pas la majorite.
 */
export const fishAudioProvider: TtsProvider = {
  name: 'fishaudio',
  extension: 'mp3',
  // S2.1 Pro accepte des didascalies libres entre crochets — `[laughing]`,
  // `[deadpan]`. C'est la fonctionnalite qui compte le plus ici : une vanne
  // dite pince-sans-rire et la meme dite en riant ne font pas le meme effet.
  supportsInlineDirections: true,

  async synthesise(text: string): Promise<Buffer> {
    const { apiKey, voiceId, modelId, speed } = config.tts.fishaudio;

    if (!apiKey) throw new Error('FISHAUDIO_API_KEY manquant.');
    if (!voiceId) throw new Error('FISHAUDIO_VOICE_ID manquant (le reference_id de la voix).');

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        // Oui, dans l'en-tete. Voir le commentaire en tete de fichier.
        model: modelId,
      },
      body: JSON.stringify({
        text,
        reference_id: voiceId,
        format: 'mp3',
        mp3_bitrate: 128,
        // "normal" plutot que "balanced" : on genere la vanne pendant que la
        // precedente passe a l'antenne, donc on prend la qualite plutot que la
        // latence.
        latency: 'normal',
        // Developpe les nombres et abreviations avant la synthese ("t1" -> "tier un").
        normalize: true,
        prosody: { speed, volume: 0 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Fish Audio ${response.status} : ${(await response.text()).slice(0, 300)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  },
};
