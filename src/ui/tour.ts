/**
 * Hexa — petit fil d'événements pour la découverte guidée.
 *
 * La règle de la séquence du premier lancement : une étape ne se valide QUE si
 * le geste a vraiment été fait. Certains gestes ne se devinent pas depuis le
 * DOM (la roue s'ouvre dans le moteur, « tout effacer » n'a pas d'état). Plutôt
 * que de les deviner à coups d'heuristiques fragiles, l'application les
 * annonce ici, en une ligne, et la découverte écoute.
 *
 * Coût au repos : zéro. Aucun timer, aucun abonné tant que la découverte n'est
 * pas à l'écran — `signalTour` n'écrit alors dans le vide.
 */

export type TourSignal =
  /** la roue d'outils vient de s'ouvrir (clic droit maintenu dans le vide) */
  | 'radial'
  /** de l'encre vient d'être retirée (annuler ou tout effacer) */
  | 'erase'
  /** la souris vient d'être rendue au jeu (mode traversant) */
  | 'passthrough'

const EVENT = 'hexa:tour'

/** L'application signale qu'un geste vient d'avoir lieu. */
export function signalTour(kind: TourSignal): void {
  window.dispatchEvent(new CustomEvent<TourSignal>(EVENT, { detail: kind }))
}

/** La découverte s'abonne ; la fonction rendue coupe l'abonnement. */
export function onTourSignal(cb: (kind: TourSignal) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<TourSignal>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
