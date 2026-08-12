/**
 * Hexa — DEUX FENÊTRES, DEUX COUCHES.
 *
 * POURQUOI. Windows sait exclure une fenêtre ENTIÈRE des captures d'écran
 * (WDA_EXCLUDEFROMCAPTURE, piloté par `win.setContentProtection(true)`) : la
 * fenêtre reste parfaitement visible pour l'utilisateur, mais DISPARAÎT d'OBS,
 * du partage d'écran Discord et des impressions d'écran. C'est une propriété de
 * FENÊTRE, jamais d'élément : tant que la barre d'outils et les annotations
 * vivent dans la même fenêtre, on ne peut pas cacher l'une sans cacher l'autre.
 * D'où la séparation :
 *
 *   • couche ENCRE     — les canvas d'annotation, la grille, les éléments posés.
 *                        Protection DÉSACTIVÉE : les spectateurs doivent la voir.
 *   • couche INTERFACE — barre d'outils, panneaux, bandeaux d'état, roue,
 *                        curseur personnalisé. Protection ACTIVÉE : visible pour
 *                        le streamer, invisible dans son direct.
 *
 * En démo navigateur (`npm run dev`) il n'y a qu'une seule page : les deux
 * couches y cohabitent comme avant (mode 'complet'). C'est là que se font la
 * plupart des vérifications — ce mode ne doit jamais régresser.
 *
 * SYNCHRONISATION. Deux fenêtres = deux processus de rendu = deux instances du
 * store. Le choix retenu (option c du cahier des charges) : chaque fenêtre garde
 * SON store, et toute mutation est diffusée à l'autre par un canal IPC dédié,
 * le processus principal servant de concentrateur.
 *
 *   - Pourquoi pas le store dans le main (option a) ? Il faudrait réécrire tout
 *     le store et faire un aller-retour IPC pour CHAQUE lecture : c'est le seul
 *     schéma qui peut introduire une latence visible au changement d'outil.
 *   - Pourquoi pas l'événement `storage` (option b) ? Il n'est émis que par les
 *     autres contextes de la MÊME origine, il passe par un stockage sur disque,
 *     et zustand/persist n'écrit qu'après coup : latence non maîtrisée, et rien
 *     ne garantit sa propagation entre BrowserWindows en file://. Trop fragile
 *     pour un outil où une divergence d'état est un défaut bloquant.
 *   - Ici : mutation locale immédiate (zéro latence perçue pour celui qui
 *     clique) + un saut IPC (quelques dixièmes de milliseconde) pour l'autre
 *     couche. Anti-boucle par drapeau d'application : un patch reçu ne repart
 *     jamais d'où il vient, et le concentrateur ne renvoie rien à l'émetteur.
 */
import { bridge, isElectron, type CommandeEncre, type EtatEncre } from './bridge'
import { useUiStore, type UiState } from './store'

/** Quelle couche cette page porte-t-elle ? */
export type HexaCouche = 'complet' | 'encre' | 'interface'

function estCouche(valeur: unknown): valeur is HexaCouche {
  return valeur === 'encre' || valeur === 'interface' || valeur === 'complet'
}

function lireCouche(): HexaCouche {
  if (typeof window === 'undefined') return 'complet'
  try {
    // ?couche=interface — pour les tests, les captures et la démo navigateur.
    const force = new URLSearchParams(window.location.search).get('couche')
    if (estCouche(force)) return force
  } catch {
    /* URL exotique : on continue */
  }
  // Déclaration du processus principal : c'est LUI qui sait ce qu'il a créé,
  // et c'est aussi lui qui impose le mode fusionné (HEXA_FUSION=1), où les
  // deux couches cohabitent dans une seule fenêtre.
  const declare = bridge.couche
  if (estCouche(declare)) return declare
  try {
    // Repli : la fenêtre interface charge ui.html, l'encre index.html.
    if (/ui\.html$/i.test(window.location.pathname)) return 'interface'
  } catch {
    /* ignore */
  }
  // Application Electron : index.html ne porte QUE l'encre. Navigateur : tout.
  return isElectron ? 'encre' : 'complet'
}

export const couche: HexaCouche = lireCouche()

// Repère pour la feuille de style : `hexa-encre` (le curseur personnalisé est
// rendu par l'autre fenêtre), `hexa-interface` (la barre reste visible même
// quand la souris est rendue au jeu), `hexa-complet` (démo navigateur).
if (typeof document !== 'undefined' && document.body) {
  document.body.classList.add(`hexa-${couche}`)
}

/** Cette page monte-t-elle le moteur et ses canvas ? */
export const porteEncre = couche !== 'interface'
/** Cette page monte-t-elle la barre, les panneaux, les bandeaux ? */
export const porteInterface = couche !== 'encre'
/** Les deux couches sont-elles dans des fenêtres SÉPARÉES ? */
export const coucheSeparee = couche !== 'complet'

/* ------------------------------------------------------------------ *
 * Synchronisation d'état entre les deux fenêtres
 * ------------------------------------------------------------------ */

/** Patch reçu de l'autre fenêtre en cours d'application : on ne le renvoie pas. */
let applicationDistante = false

/** Les fonctions du store ne se sérialisent pas (et n'ont pas à voyager). */
function estDonnee(valeur: unknown): boolean {
  return typeof valeur !== 'function'
}

/**
 * Ce qui NE voyage PAS d'une fenêtre à l'autre.
 *
 * Les chronos et les notes (§5.8) ne sont pas de l'état d'interface : ce sont
 * des objets POSÉS à un endroit précis d'un écran précis, et ils sont peints
 * par la couche encre. Les diffuser aurait deux défauts : ils se
 * dédoubleraient sur chaque écran d'un montage multi-écrans, et déplacer une
 * note à la souris enverrait un message par image de déplacement.
 */
const HORS_SYNCHRO = new Set(['clocks', 'notes'])

/**
 * Différence superficielle entre deux états. Les valeurs du store sont soit des
 * primitives, soit des objets remplacés en entier à chaque mutation (zustand ne
 * mute jamais en place) : une comparaison par référence est donc exacte, et
 * elle coûte une poignée de comparaisons — rien au repos, puisque tout part
 * d'un abonnement.
 */
function difference(etat: UiState, precedent: UiState): Record<string, unknown> | null {
  let patch: Record<string, unknown> | null = null
  for (const [cle, valeur] of Object.entries(etat)) {
    if (!estDonnee(valeur) || HORS_SYNCHRO.has(cle)) continue
    if (valeur === (precedent as unknown as Record<string, unknown>)[cle]) continue
    if (!patch) patch = {}
    patch[cle] = valeur
  }
  return patch
}

/**
 * Branche les deux stores l'un sur l'autre. Sans effet en démo navigateur (une
 * seule page, donc un seul store) et sans effet hors Electron.
 */
export function demarrerSynchro(): () => void {
  if (!coucheSeparee || !isElectron) return () => undefined

  const desabonner = useUiStore.subscribe((etat, precedent) => {
    // Un patch qu'on vient de RECEVOIR ne doit jamais repartir : c'est la
    // boucle infinie classique de ce genre de miroir.
    if (applicationDistante) return
    const patch = difference(etat, precedent)
    if (!patch) return
    bridge.pousserSynchro(patch)
  })

  const stop = bridge.on('sync', (patch) => {
    if (!patch || typeof patch !== 'object') return
    applicationDistante = true
    try {
      useUiStore.setState(patch as Partial<UiState>)
    } finally {
      applicationDistante = false
    }
  })

  return () => {
    desabonner()
    stop()
  }
}

/* ------------------------------------------------------------------ *
 * Commandes interface → encre, états encre → interface
 * ------------------------------------------------------------------ */

/**
 * La barre d'outils vit dans la fenêtre interface, le moteur dans la fenêtre
 * encre : « annuler » ne peut plus être un appel de fonction. En mode 'complet'
 * (démo navigateur) et dans la couche encre elle-même, la commande est exécutée
 * SUR PLACE — aucun IPC, aucune latence, aucun changement de comportement.
 */
export function envoyerCommande(commande: CommandeEncre): void {
  if (!coucheSeparee) {
    executerLocalement?.(commande)
    return
  }
  bridge.envoyerCommande(commande)
}

/** Exécuteur local, posé par la couche encre au montage du moteur. */
let executerLocalement: ((commande: CommandeEncre) => void) | null = null

/** La couche encre déclare comment exécuter une commande reçue. */
export function brancherExecuteur(fn: ((commande: CommandeEncre) => void) | null): void {
  executerLocalement = fn
}

/** La couche encre annonce un état que l'interface doit refléter. */
export function annoncerEtatEncre(message: EtatEncre): void {
  if (!coucheSeparee) {
    ecouteursEtat.forEach((cb) => cb(message))
    return
  }
  bridge.annoncerEtatEncre(message)
}

const ecouteursEtat = new Set<(message: EtatEncre) => void>()

/** L'interface écoute les états de l'encre (gel, avant/après, roue, session). */
export function ecouterEtatEncre(cb: (message: EtatEncre) => void): () => void {
  ecouteursEtat.add(cb)
  const stop = coucheSeparee ? bridge.on('etat-encre', (m) => cb(m)) : () => undefined
  return () => {
    ecouteursEtat.delete(cb)
    stop()
  }
}
