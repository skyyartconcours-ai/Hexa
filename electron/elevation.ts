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
 * LA CLÉ DE REGISTRE QUI REND L'ÉLÉVATION PERMANENTE.
 *
 * ⚠️ POURQUOI CE RÉGLAGE EXISTE, ET POURQUOI IL EST INDISPENSABLE ICI.
 *
 * Retour d'usage, mot pour mot : « j'ai installé en administrateur, après j'ai
 * pas fait grand-chose de plus ». C'est LE malentendu, et il est parfaitement
 * légitime : lancer l'INSTALLATEUR en administrateur n'élève que l'installation.
 * L'application, elle, redémarre ensuite avec des privilèges ordinaires — et
 * les raccourcis continuent de ne pas répondre pendant les parties.
 *
 * Or ce qu'il faut, c'est que l'APPLICATION soit élevée À CHAQUE LANCEMENT.
 * Windows prévoit exactement ça : la couche de compatibilité `RUNASADMIN`,
 * posée par utilisateur dans HKCU (donc SANS avoir besoin de droits
 * administrateur pour l'écrire). C'est le même interrupteur que « Exécuter ce
 * programme en tant qu'administrateur » dans les propriétés du raccourci —
 * sauf qu'ici, Hexa le pose lui-même, en un clic, au lieu de demander à
 * quelqu'un de traverser trois menus de Windows pendant son direct.
 */
const CLE_LAYERS = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'

/** Dernier état connu, relu au démarrage puis à chaque bascule. */
let toujoursAdmin: boolean | null = null

export function lireToujoursAdmin(): boolean | null {
  return toujoursAdmin
}

/** Interroge le registre une fois. Sans effet hors Windows. */
export function chargerToujoursAdmin(): Promise<boolean> {
  if (!elevationPertinente()) {
    toujoursAdmin = false
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    try {
      execFile(
        'reg',
        ['query', CLE_LAYERS, '/v', process.execPath],
        { windowsHide: true, timeout: 4000 },
        (err, stdout) => {
          // `reg query` sort en erreur quand la valeur n'existe pas : ce n'est
          // pas une panne, c'est la réponse « non ».
          toujoursAdmin = !err && /RUNASADMIN/i.test(String(stdout))
          resolve(toujoursAdmin)
        },
      )
    } catch {
      toujoursAdmin = false
      resolve(false)
    }
  })
}

/**
 * Pose ou retire la couche de compatibilité. Renvoie l'état RÉELLEMENT obtenu :
 * on ne se contente pas d'annoncer un succès, on relit le registre.
 */
export function definirToujoursAdmin(actif: boolean): Promise<boolean> {
  if (!elevationPertinente()) return Promise.resolve(false)
  const args = actif
    ? ['add', CLE_LAYERS, '/v', process.execPath, '/t', 'REG_SZ', '/d', '~ RUNASADMIN', '/f']
    : ['delete', CLE_LAYERS, '/v', process.execPath, '/f']
  return new Promise((resolve) => {
    try {
      execFile('reg', args, { windowsHide: true, timeout: 6000 }, (err) => {
        if (err && actif) {
          logError('privilèges', 'écriture de la couche RUNASADMIN impossible', err)
        }
        void chargerToujoursAdmin().then((etat) => {
          log(
            'privilèges',
            etat
              ? 'Hexa se lancera désormais en administrateur à chaque démarrage'
              : 'Hexa se lancera désormais avec des privilèges ordinaires',
          )
          resolve(etat)
        })
      })
    } catch (err) {
      logError('privilèges', 'bascule RUNASADMIN impossible', err)
      resolve(toujoursAdmin === true)
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
  /**
   * ⚠️ `--hexa-eleve` N'EST PAS DÉCORATIF. C'est ce drapeau qui permet à la
   * nouvelle instance de RECONNAÎTRE qu'elle est le relais d'une élévation, et
   * donc d'ATTENDRE que l'ancienne lâche le verrou d'instance unique au lieu de
   * se retirer immédiatement. Sans lui, la nouvelle instance mourait dans la
   * seconde et l'utilisateur n'était jamais administrateur — tout en croyant
   * l'être. Voir `relaisElevation` dans electron/main.ts.
   */
  const args = (app.isPackaged ? [] : [app.getAppPath()]).concat('--hexa-eleve')
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
        // On se retire SANS TARDER : la nouvelle instance attend précisément
        // que ce verrou se libère pour prendre la main (voir relaisElevation).
        // `exit` plutôt que `quit` — une fenêtre qui traîne à se fermer
        // rallongerait l'attente d'autant, et l'utilisateur regarde son écran
        // en se demandant si ça a marché.
        app.exit(0)
      },
    )
  } catch (err) {
    logError('privilèges', 'relance en administrateur impossible', err)
    onEchec('Windows a refusé la relance en administrateur.')
  }
}
