/**
 * Hexa — LA FENÊTRE D'INTERFACE À LA TAILLE DE LA BARRE (§S12).
 *
 * LE PROBLÈME, VÉCU. Tout l'ordinateur saccadait, jeu compris, alors que le
 * gestionnaire des tâches affichait Hexa à 0 % de processeur. Ce n'est pas du
 * calcul : c'est de la COMPOSITION. Une fenêtre transparente, plein écran et
 * toujours au-dessus oblige le compositeur de Windows à empiler un calque de
 * 1920 × 1080 À CHAQUE IMAGE, par-dessus le jeu, pour n'afficher qu'une barre
 * d'outils de 117 × 671. On paie 1 920 × 1 080 pixels de mélange pour en
 * montrer 78 000 : quarante fois trop.
 *
 * LA PREMIÈRE PARADE ÉTAIT TROP BRUTALE. Cacher la fenêtre d'interface pendant
 * le jeu supprimait bien les saccades… et la barre d'outils avec : « je n'ai
 * plus la liste des outils, comment faire ? ». Inacceptable.
 *
 * LA PARADE JUSTE. Quand la barre est la SEULE chose à montrer, sa fenêtre est
 * réduite au rectangle de la barre (plus une marge d'ombre) et posée à
 * l'endroit exact où la barre se trouvait. Le calque composé tombe de 2,07
 * millions de pixels à moins de 100 000 — négligeable — et l'utilisateur garde
 * ses outils sous les yeux. Dès qu'autre chose doit s'afficher (un panneau, la
 * roue, la découverte guidée, un message, un glisser d'ancrage) ou dès qu'on
 * repasse en MODE DESSIN (le curseur personnalisé vit dans cette fenêtre et
 * doit suivre la souris partout), on revient au plein écran.
 *
 * CE MODULE EST L'ARBITRE, et il tient deux choses :
 *   • les RAISONS de rester en plein écran, déclarées par qui de droit
 *     (App pour les panneaux et le mode dessin, la barre pour son glisser, le
 *     bandeau d'état pour ses messages) ;
 *   • le RECTANGLE de la barre, publié par la barre elle-même, en coordonnées
 *     ÉCRAN.
 *
 * Il n'envoie un message au processus principal que lorsque la cible CHANGE
 * réellement : un `setBounds` par image coûterait plus cher que le calque qu'on
 * cherche à supprimer. Aucune boucle, aucun intervalle, rien au repos.
 */
import { bridge, isElectron } from '../bridge'
import { coucheSeparee, porteInterface } from '../couches'
import { memeRect, type RectEcran } from './toolbar-dock'

/**
 * Le mode compact n'a de sens que dans la VRAIE fenêtre d'interface d'Electron.
 * En démo navigateur et en mode fusionné (une seule fenêtre pour tout), la page
 * ne pilote aucune fenêtre à elle : le module est alors entièrement inerte.
 */
export const compactPossible = isElectron && coucheSeparee && porteInterface

/** Raisons de rester en plein écran. Vide = la barre est seule à l'écran. */
const raisons = new Set<string>()

/** Rectangle voulu pour la fenêtre quand la barre est seule (coordonnées écran). */
let rectBarre: RectEcran | null = null

/** Dernière cible RÉELLEMENT envoyée au processus principal. */
let envoye: RectEcran | null = null
let envoyeUneFois = false

let compacte = false
const abonnes = new Set<(valeur: boolean) => void>()

function recalculer(): void {
  if (!compactPossible) return
  const cible = raisons.size === 0 ? rectBarre : null
  // ⚠️ LE GARDE-FOU : on ne parle au processus principal que si la cible a
  // changé. Sans lui, chaque rendu de React reposerait la fenêtre.
  if (!envoyeUneFois || !memeRect(cible, envoye)) {
    envoyeUneFois = true
    envoye = cible
    bridge.setInterfaceRect(cible)
  }
  const valeur = cible !== null
  if (valeur === compacte) return
  compacte = valeur
  // Repère pour la feuille de style : en fenêtre compacte, `100vw` et `100vh`
  // valent la taille de la BARRE. Toutes les règles qui s'en servent doivent
  // repasser sur la taille de l'écran (voir styles.css, §S12).
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('fenetre-compacte', valeur)
  }
  for (const cb of abonnes) cb(valeur)
}

/**
 * « Tant que ceci est vrai, la fenêtre doit couvrir l'écran entier. »
 * Chaque appelant possède sa propre clé : personne ne peut effacer la raison
 * d'un autre, et une raison oubliée se voit (la fenêtre reste grande).
 */
export function exigerPleinEcran(cle: string, valeur: boolean): void {
  if (!compactPossible) return
  const avant = raisons.size
  if (valeur) raisons.add(cle)
  else raisons.delete(cle)
  if (raisons.size === avant) return
  recalculer()
}

/**
 * Rectangle que la fenêtre doit occuper quand la barre est seule à montrer, en
 * pixels LOGIQUES relatifs à l'écran porteur. `null` = pas de barre à l'écran
 * (masquée, ou fenêtre d'un écran qui ne porte pas la barre).
 */
export function publierRectBarre(rect: RectEcran | null): void {
  if (!compactPossible) return
  if (memeRect(rect, rectBarre)) return
  rectBarre = rect
  recalculer()
}

/** La fenêtre est-elle réduite à la barre en ce moment ? */
export function estCompacte(): boolean {
  return compacte
}

/** Abonnement pour React (`useSyncExternalStore`). */
export function abonnerCompacte(cb: (valeur: boolean) => void): () => void {
  abonnes.add(cb)
  return () => {
    abonnes.delete(cb)
  }
}
