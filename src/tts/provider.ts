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
  synthesise(text: string): Promise<Buffer>;
}
