/**
 * Hexa — la fenêtre INTERFACE et la souris.
 *
 * LE PROBLÈME. Deux fenêtres plein écran superposées se disputent le pointeur.
 * Celle du dessus (l'interface) doit laisser passer TOUT ce qui ne la concerne
 * pas — les clics vont alors au jeu, ou à la couche encre en mode dessin — mais
 * recevoir les clics qui visent vraiment un bouton. Une fenêtre est cliquable ou
 * ne l'est pas : il n'y a pas de demi-mesure côté système.
 *
 * LA MÉCANIQUE. La fenêtre est traversante en permanence
 * (`setIgnoreMouseEvents(true, { forward: true })`). `forward` est la clé : les
 * CLICS partent ailleurs, mais Chromium continue de livrer les mouvements de
 * souris à la page. À chaque mouvement, on demande au DOM ce qui se trouve sous
 * le pointeur (`elementFromPoint`) : si c'est un élément d'interface, on rend
 * brièvement la fenêtre cliquable, le temps du survol.
 *
 * POURQUOI `elementFromPoint` ET PAS UNE LISTE DE ZONES. La méthode ignore
 * d'elle-même tout ce qui porte `pointer-events: none` — bandeaux d'état,
 * indicateur d'outil, liseré, curseur. La règle « la fenêtre est cliquable là où
 * l'interface est réellement cliquable » devient donc exacte par construction,
 * sans liste à tenir à jour : un panneau ajouté demain fonctionne sans rien
 * changer ici, et un décor oublié ne peut pas voler un clic au jeu.
 *
 * COÛT. Aucun. Trois écouteurs passifs, un appel de test de collision par
 * mouvement de souris, et un message IPC uniquement quand la réponse CHANGE.
 * Rien ne tourne au repos.
 */
import { useEffect, useRef } from 'react'
import { bridge } from '../bridge'
import { coucheSeparee, porteInterface } from '../couches'

/**
 * @param modale Un panneau (réglages, aide, rejeu, découverte) est ouvert : la
 * fenêtre reste cliquable ET focusable partout, sans dépendre du survol —
 * sinon on ne pourrait pas taper dans un champ de saisie.
 */
export function useInterfaceCliquable(modale: boolean): void {
  const cliquable = useRef(false)
  const enfonce = useRef(false)
  const modaleRef = useRef(modale)
  modaleRef.current = modale

  useEffect(() => {
    if (!coucheSeparee || !porteInterface) return

    const appliquer = (valeur: boolean) => {
      if (valeur === cliquable.current) return
      cliquable.current = valeur
      bridge.setInterfaceCliquable(valeur)
    }

    /** Y a-t-il un élément d'interface RÉELLEMENT cliquable sous ce point ? */
    const surInterface = (x: number, y: number): boolean => {
      const el = document.elementFromPoint(x, y)
      if (!el || el === document.documentElement || el === document.body) return false
      // La racine `.app` couvre tout l'écran : la toucher signifie « rien ».
      return !el.classList.contains('app')
    }

    /** dernière position connue du pointeur, pour revérifier une « sortie » */
    let dernierX = -1
    let dernierY = -1

    const bouge = (e: MouseEvent) => {
      dernierX = e.clientX
      dernierY = e.clientY
      // Bouton enfoncé = geste en cours. On ne touche à rien tant que la souris
      // n'est pas relâchée : basculer au milieu du geste le couperait net.
      //
      // `enfonce` ne suffit PAS, et c'est le piège qui a été trouvé à l'audit :
      // il n'est armé que par un appui reçu PAR CETTE FENÊTRE. Or `forward:true`
      // ne lui livre que les mouvements, jamais les appuis — un trait commencé
      // dans la couche encre lui est donc invisible. En traversant l'écran, ce
      // trait passait sur la barre, la fenêtre se rendait cliquable, et le trait
      // était coupé en deux. `e.buttons` porte l'état réel des boutons dans le
      // message transmis par le système : c'est lui qui dit la vérité.
      if (enfonce.current || e.buttons !== 0 || modaleRef.current) return
      appliquer(surInterface(e.clientX, e.clientY))
    }
    const enfoncer = () => {
      enfonce.current = true
    }
    const relacher = (e: MouseEvent) => {
      enfonce.current = false
      if (!modaleRef.current) appliquer(surInterface(e.clientX, e.clientY))
    }
    /**
     * La souris quitte la fenêtre… ou pas.
     *
     * PIÈGE VÉRIFIÉ EN CONDITIONS RÉELLES : au moment précis où l'on rend la
     * fenêtre cliquable, Chromium refait sa détection de survol et émet un
     * `mouseleave` — alors que le pointeur est bel et bien posé sur le bouton.
     * Le croire sur parole rendrait la fenêtre traversante dans la même
     * milliseconde, et le clic partirait dans le jeu au lieu d'atteindre le
     * bouton visé. On revérifie donc la dernière position connue au lieu de
     * conclure aveuglément.
     */
    const sortir = () => {
      if (enfonce.current || modaleRef.current) return
      appliquer(dernierX >= 0 && surInterface(dernierX, dernierY))
    }

    window.addEventListener('mousemove', bouge, { passive: true })
    window.addEventListener('mousedown', enfoncer, { passive: true })
    window.addEventListener('mouseup', relacher, { passive: true })
    document.addEventListener('mouseleave', sortir)
    return () => {
      window.removeEventListener('mousemove', bouge)
      window.removeEventListener('mousedown', enfoncer)
      window.removeEventListener('mouseup', relacher)
      document.removeEventListener('mouseleave', sortir)
      appliquer(false)
    }
  }, [])

  useEffect(() => {
    if (!coucheSeparee || !porteInterface) return
    // Un panneau ouvert doit pouvoir recevoir la frappe clavier : la fenêtre
    // interface, normalement JAMAIS focusable (§12.2 — un overlay dans l'Alt+Tab
    // fait perdre des parties), le devient le temps du panneau.
    bridge.setInterfaceModale(modale)
    cliquable.current = modale
    bridge.setInterfaceCliquable(modale)
  }, [modale])
}
