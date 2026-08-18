/**
 * Hexa — NIVEAU DE PRIVILÈGE, et pourquoi il décide si les raccourcis marchent
 * pendant une partie.
 *
 * LE PROBLÈME, EN UNE PHRASE. Windows refuse de livrer un raccourci global à un
 * programme ordinaire tant que la fenêtre au premier plan appartient à un
 * programme lancé EN ADMINISTRATEUR. League of Legends en fait partie (son
 * anti-triche démarre le client avec des privilèges élevés), comme Valorant,
 * comme la plupart des jeux compétitifs.
 *
 * CE QUE ÇA DONNE POUR L'UTILISATEUR, MOT POUR MOT : « je dois alt-tab pour que
 * les raccourcis marchent ; si je suis sur le jeu ça ne marche pas ». Le
 * raccourci EST réservé auprès de Windows — le journal le dit — mais la touche
 * ne nous est pas remise tant que le jeu a le premier plan. Dès qu'on bascule
 * sur une fenêtre ordinaire (Alt+Tab), tout refonctionne. C'est exactement la
 * signature de ce blocage, et c'est pour ça qu'Epic Pen demande lui aussi d'être
 * lancé en administrateur.
 *
 * LA SEULE PARADE possible côté logiciel : tourner au même niveau que le jeu.
 * On ne l'IMPOSE pas — exiger l'élévation au démarrage ferait apparaître une
 * demande de Windows à chaque lancement, y compris pour quelqu'un qui annote un
 * navigateur et n'en a aucun besoin. On la PROPOSE, on l'explique, et on relance
 * proprement sur demande.
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { log, logError } from './logger'

/** Résultat connu, ou null tant qu'on n'a pas encore regardé. */
let eleve: boolean | null = null

/** Windows uniquement : ailleurs la question n'a pas de sens. */
export function elevationPertinente(): boolean {
  return process.platform === 'win32'
}

/** Dernier verdict connu. `null` = pas encore déterminé. */
export function estEleve(): boolean | null {
  return eleve
}

/**
 * Détermine une fois pour toutes si Hexa tourne en administrateur.
 *
 * `net session` est le test canonique : il n'a AUCUN effet de bord et ne réussit
 * qu'avec des privilèges élevés. On le lance une seule fois, au démarrage, hors
 * du chemin critique, et on garde la réponse.
 */
export function detecterElevation(): Promise<boolean> {
  if (!elevationPertinente()) {
    eleve = false
    return Promise.resolve(false)
  }
  if (eleve !== null) return Promise.resolve(eleve)
  return new Promise((resolve) => {
    try {
      execFile('net', ['session'], { windowsHide: true, timeout: 4000 }, (err) => {
        eleve = !err
        log(
          'privilèges',
          eleve
            ? 'Hexa tourne en administrateur : les raccourcis passent même pendant une partie'
            : 'Hexa tourne en utilisateur : un jeu lancé en administrateur peut retenir les raccourcis',
        )
        resolve(eleve)
      })
    } catch (err) {
      logError('privilèges', 'test d’élévation impossible', err)
      eleve = false
      resolve(false)
    }
  })
}

/**
 * Relance Hexa en administrateur, puis quitte l'instance courante.
 *
 * `Start-Process -Verb RunAs` est la seule façon documentée de demander
 * l'élévation à Windows : c'est LUI qui affiche la demande de consentement, pas
 * nous. Si l'utilisateur refuse, PowerShell rend la main en erreur et Hexa
 * continue de tourner exactement comme avant — on ne quitte QUE si le relais a
 * bien démarré.
 */
export function relancerEnAdministrateur(onEchec: (raison: string) => void): void {
  if (!elevationPertinente()) return
  const exe = process.execPath
  // En développement (`electron .`), il faut repasser le dossier du projet,
  // sinon la nouvelle instance ouvrirait l'application de démonstration
  // d'Electron.
  const args = app.isPackaged ? [] : [app.getAppPath()]
  const liste = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const commande =
    `Start-Process -FilePath '${exe.replace(/'/g, "''")}'` +
    (liste ? ` -ArgumentList ${liste}` : '') +
    ' -Verb RunAs'
  try {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', commande],
      { windowsHide: true, timeout: 60000 },
      (err) => {
        if (err) {
          // Cas de loin le plus fréquent : l'utilisateur a répondu « Non » à
          // Windows. Ce n'est pas une panne, et Hexa doit rester utilisable.
          log('privilèges', 'relance en administrateur abandonnée')
          onEchec(
            'La relance en administrateur a été refusée. Hexa continue de fonctionner ' +
              'normalement — seuls les raccourcis pendant une partie restent concernés.',
          )
          return
        }
        log('privilèges', 'relance en administrateur acceptée : fermeture de l’instance ordinaire')
        app.quit()
      },
    )
  } catch (err) {
    logError('privilèges', 'relance en administrateur impossible', err)
    onEchec('Windows a refusé la relance en administrateur.')
  }
}
