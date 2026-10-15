/**
 * Hexa — journal de démarrage et de diagnostic.
 *
 * Pourquoi ce fichier existe : Hexa n'a AUCUNE fenêtre visible tant que
 * l'utilisateur ne dessine pas. Si quelque chose se passe mal au lancement
 * (renderer introuvable, GPU capricieux, écran fantôme), il ne voit RIEN et
 * conclut que « ça ne marche pas ». Un journal horodaté dans
 * `%APPDATA%/Hexa/hexa.log` transforme ce silence en une explication qu'on peut
 * lire — et, pour les pannes fatales, en une vraie boîte de dialogue française.
 *
 * Règles :
 *  - jamais de timer, jamais de boucle : on n'écrit que sur événement discret ;
 *  - jamais d'exception : un journal qui casse ne doit pas casser l'overlay ;
 *  - rien de sensible n'est écrit (ni mot de passe OBS, ni contenu dessiné).
 */
import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** Au-delà, le journal est archivé en hexa.log.old et on repart à zéro. */
const MAX_BYTES = 512 * 1024

/** Chemin résolu du journal ('' tant que l'initialisation n'a pas eu lieu). */
let filePath = ''
/** Lignes produites avant que le dossier utilisateur soit connu. */
const pending: string[] = []
/** Une seule boîte de dialogue fatale par session : on n'assomme personne. */
let fatalShown = false
/** L'interface s'est-elle affichée au moins une fois ? */
let started = false

/**
 * Comment prévenir l'utilisateur SANS bloquer, une fois l'application lancée.
 * Injecté par le processus principal (bandeau natif de welcome.ts) plutôt
 * qu'importé : le journal ne doit dépendre d'aucun autre module.
 */
let notifier: ((titre: string, explication: string) => void) | null = null

/** Branche le bandeau non bloquant utilisé après le démarrage. */
export function setFatalNotifier(fn: (titre: string, explication: string) => void): void {
  notifier = fn
}

function stamp(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** Rend n'importe quoi lisible sur une ligne, sans jamais lever d'exception. */
function readable(value: unknown): string {
  if (value === undefined) return ''
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Octets écrits dans le fichier depuis l'ouverture (rotation en cours de session). */
let written = 0
/** Dernière ligne écrite, SANS son horodatage, et ses répétitions avalées. */
let lastBody = ''
let repeats = 0
/** Fenêtre d'une seconde : au-delà de LINES_PER_SEC lignes, on se tait. */
let windowStart = 0
let windowLines = 0
let windowDropped = 0
const LINES_PER_SEC = 40

/**
 * ⚠️ Le journal écrit en SYNCHRONE sur le fil principal — celui qui porte aussi
 * le crochet souris de Windows. Une erreur répétée à chaque image (deux
 * écritures disque par image, pendant des heures) faisait donc ramer la souris
 * de tout le PC et gonfler le fichier sans fin : la rotation n'avait lieu qu'au
 * démarrage. Désormais : les lignes identiques consécutives sont comptées au
 * lieu d'être écrites, le débit est plafonné, et le fichier tourne dès qu'il
 * dépasse sa taille, même au milieu d'un direct.
 */
function write(line: string): void {
  const body = line.replace(/^\d\d:\d\d:\d\d\.\d{3} /, '')
  if (body === lastBody) {
    repeats++
    return
  }
  const now = Date.now()
  if (now - windowStart >= 1000) {
    if (windowDropped > 0) {
      const n = windowDropped
      windowDropped = 0
      windowStart = now
      windowLines = 0
      writeRaw(`${stamp()} [journal] ${n} ligne(s) omise(s) (débit plafonné)`)
    }
    windowStart = now
    windowLines = 0
  }
  if (++windowLines > LINES_PER_SEC) {
    windowDropped++
    return
  }
  if (repeats > 0) {
    writeRaw(`${stamp()} [journal] ligne précédente répétée ${repeats} fois`)
    repeats = 0
  }
  lastBody = body
  writeRaw(line)
}

function writeRaw(line: string): void {
  // Toujours sur la sortie standard : visible avec `npm run app` et dans les
  // tests automatisés, même si l'écriture disque échoue.
  try {
    process.stdout.write(`${line}\n`)
  } catch {
    /* flux fermé */
  }
  if (!filePath) {
    pending.push(line)
    // Garde-fou : si l'initialisation n'arrive jamais, on ne gonfle pas la RAM.
    if (pending.length > 500) pending.shift()
    return
  }
  try {
    if (written > MAX_BYTES * 4) {
      written = 0
      fs.renameSync(filePath, path.join(path.dirname(filePath), 'hexa.log.old'))
    }
    const out = `${line}\n`
    fs.appendFileSync(filePath, out, 'utf8')
    written += out.length
  } catch {
    /* disque plein ou dossier verrouillé : on continue sans journal */
  }
}

/**
 * Prépare le fichier journal. À appeler dès que possible dans le processus
 * principal (le chemin `userData` est déjà connu avant `whenReady`).
 * Renvoie le chemin, ou '' si le disque refuse.
 */
export function initLogger(): string {
  if (filePath) return filePath
  try {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, 'hexa.log')
    // Rotation : un seul fichier d'archive, jamais de croissance infinie.
    try {
      const st = fs.statSync(target)
      if (st.size > MAX_BYTES) fs.renameSync(target, path.join(dir, 'hexa.log.old'))
    } catch {
      /* pas encore de journal : parfait */
    }
    filePath = target
  } catch {
    return ''
  }
  const flush = pending.splice(0, pending.length)
  try {
    fs.appendFileSync(
      filePath,
      `\n${'='.repeat(64)}\n` +
        `${new Date().toLocaleString('fr-FR')} — démarrage de Hexa ${app.getVersion()}\n` +
        `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · ` +
        `${process.platform}/${process.arch} · empaqueté : ${app.isPackaged ? 'oui' : 'non'}\n` +
        `${'='.repeat(64)}\n` +
        (flush.length ? `${flush.join('\n')}\n` : ''),
      'utf8',
    )
  } catch {
    /* ignore */
  }
  return filePath
}

/** Chemin du journal, pour l'afficher à l'utilisateur (menu « À propos »). */
export function logFilePath(): string {
  return filePath
}

/** Une ligne d'information : `10:42:03.120 [écrans] 2 écran(s) détecté(s)`. */
export function log(scope: string, message: string, extra?: unknown): void {
  const tail = readable(extra)
  write(`${stamp()} [${scope}] ${message}${tail ? ` — ${tail}` : ''}`)
}

/** Une ligne d'erreur. Rien n'est jamais avalé en silence dans Hexa. */
export function logError(scope: string, message: string, err?: unknown): void {
  const tail = readable(err)
  write(`${stamp()} [${scope}] ERREUR ${message}${tail ? ` — ${tail}` : ''}`)
  if (err instanceof Error && err.stack) write(err.stack)
}

/**
 * Enveloppe une promesse dont l'échec ne doit pas casser l'application, mais
 * doit être JOURNALISÉ. Remplace les `.catch(() => undefined)` qui rendaient
 * les pannes de chargement totalement invisibles.
 */
export function logFailure<T>(scope: string, message: string, promise: Promise<T>): void {
  promise.catch((err: unknown) => logError(scope, message, err))
}

/**
 * Panne fatale : une VRAIE boîte de dialogue en français, avec l'emplacement du
 * journal. Mille fois mieux qu'une fenêtre vide et silencieuse.
 *
 * ⚠️ `dialog.showErrorBox` est BLOQUANT : il arrête la boucle d'événements du
 * processus principal jusqu'au clic de l'utilisateur. Au démarrage c'est ce
 * qu'on veut (rien d'autre ne tourne encore, et il faut absolument être lu).
 * Une fois Hexa lancé, ce serait un piège mortel : la boîte s'ouvre DERRIÈRE le
 * jeu en plein écran fenêtré, invisible, pendant que l'icône près de l'horloge,
 * les raccourcis globaux et le menu « Quitter » sont gelés — plus aucune sortie.
 * Après `markStarted()`, on passe donc par le bandeau non bloquant.
 */
export function fatalDialog(titre: string, explication: string): void {
  logError('fatal', `${titre} — ${explication}`)
  if (started && notifier) {
    try {
      notifier(titre, explication)
    } catch {
      /* le bandeau ne doit jamais aggraver une panne */
    }
    return
  }
  if (fatalShown) return
  fatalShown = true
  const ou = filePath || '(journal indisponible)'
  try {
    dialog.showErrorBox(
      `Hexa — ${titre}`,
      `${explication}\n\n` +
        `Journal de diagnostic :\n${ou}\n\n` +
        `Que faire : relance Hexa. Si le problème persiste, envoie ce fichier journal — ` +
        `il contient tout ce qu'il faut pour comprendre.`,
    )
  } catch {
    /* même la boîte de dialogue peut échouer : le journal reste */
  }
}

/**
 * À appeler dès que l'interface s'est affichée une première fois. Après ça, une
 * exception isolée n'a plus à interrompre l'utilisateur avec une boîte de
 * dialogue : elle part au journal, et le direct continue.
 */
export function markStarted(): void {
  started = true
}

/**
 * Filet de sécurité du processus principal : une exception non rattrapée ne
 * doit jamais laisser l'utilisateur devant un écran muet.
 */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    logError('processus', 'exception non rattrapée', err)
    // Pendant le démarrage, l'écran est vide : le silence serait interprété
    // comme « l'application ne se lance pas ». Une fois lancé, on ne coupe plus
    // jamais un direct pour une exception isolée — le journal suffit.
    if (started) return
    fatalDialog(
      'erreur au démarrage',
      'Hexa a rencontré une erreur inattendue pendant son lancement.',
    )
  })
  process.on('unhandledRejection', (reason) => {
    logError('processus', 'promesse rejetée sans traitement', reason)
  })
}
