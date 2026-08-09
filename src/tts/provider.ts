/**
 * Contrat commun a tous les fournisseurs de voix.
 *
 * Le marche du TTS bouge vite et les prix varient d'un facteur 10 entre
 * fournisseurs a qualite comparable. Le reste du code ne connait que cette
 * interface : changer de fournisseur, c'est ajouter un fichier d'une trentaine
 * de lignes et changer une variable dans .env, sans toucher a la file d'attente
 * ni a l'overlay.
 */
export interface TtsProvider {
  /** Nom affiche dans les logs et la regie. */
  readonly name: string;
  /** Extension du fichier produit : conditionne l'URL servie a l'overlay. */
  readonly extension: 'mp3' | 'wav';
  /**
   * Le fournisseur comprend-il les didascalies en ligne facon `[laughing]` ?
   * Si non, il faut les retirer du texte : sinon il les lit a voix haute.
   */
  readonly supportsInlineDirections: boolean;
  synthesise(text: string): Promise<Buffer>;
}

/**
 * Liste fermee de didascalies. Volontairement courte : le modele choisit
 * dedans, et tout ce qui sort de la liste est jete plutot que transmis au TTS.
 * Une balise inventee qui passe en production, c'est le mot "[sarcastique]"
 * lu a voix haute a l'antenne.
 */
export const DELIVERIES = [
  'deadpan',
  'amused',
  'laughing',
  'mock serious',
  'warm',
  'excited',
] as const;

export type Delivery = (typeof DELIVERIES)[number];

export function isDelivery(value: unknown): value is Delivery {
  return typeof value === 'string' && (DELIVERIES as readonly string[]).includes(value);
}
