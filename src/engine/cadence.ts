/**
 * Hexa — PLAFOND DE CADENCE : 60 images par seconde, jamais plus.
 *
 * `requestAnimationFrame` suit la fréquence de l'écran. Sur l'écran principal
 * de l'utilisateur, c'est 240 Hz : pendant un trait, la couche encre et le
 * curseur de la couche interface produisaient 240 images par seconde, chacune
 * recomposée par dwm.exe sur deux calques plein écran transparents — par-dessus
 * un jeu qui tourne lui aussi à 240 Hz. Le brief le disait dès le départ
 * (§2.3) : l'overlay n'a aucune raison de tourner à 240.
 *
 * `webContents.setFrameRate()` ne sert à rien ici : Electron ne l'applique
 * qu'au rendu HORS ÉCRAN. Le plafond se pose donc dans les boucles elles-mêmes :
 * un rappel arrivé trop tôt ne peint rien — et une page qui ne peint rien ne
 * présente aucune image au compositeur.
 *
 * La marge de 1,5 ms absorbe le battement des horloges : à 240 Hz, quatre
 * intervalles font 16,7 ms et passent, trois font 12,5 ms et attendent ; à
 * 120 Hz, une image sur deux ; à 60 Hz, toutes. Sur 144 Hz on tombe à 48
 * images par seconde, ce qui reste fluide pour un trait.
 */
export const IMAGES_PAR_SECONDE_MAX = 60

export const INTERVALLE_MIN_MS = 1000 / IMAGES_PAR_SECONDE_MAX - 1.5

/** Trop tôt pour peindre une nouvelle image depuis `derniere` ? */
export function tropTot(maintenant: number, derniere: number): boolean {
  return maintenant - derniere < INTERVALLE_MIN_MS
}
