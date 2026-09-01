/**
 * Hexa — sonde de performance et témoin de coût.
 *
 * Demande de l'utilisateur, mot pour mot : « j'aimerais être sûr que ça ne
 * prend pas beaucoup de ressources ». Le gestionnaire des tâches ne sait pas
 * répondre : il affichait Hexa à 0 % pendant que tout l'ordinateur saccadait,
 * parce que le coût d'un overlay n'est pas du calcul mais de la COMPOSITION —
 * un calque transparent plein écran empilé par Windows à chaque image. Il faut
 * donc mesurer les quatre choses qui coûtent vraiment, et les dire en français :
 *
 *  - la SURFACE composée : combien de pixels d'écran nos fenêtres occupent,
 *    et pendant combien de temps ;
 *  - les IMAGES réellement produites par chaque page (une page qui ne demande
 *    aucune image ne coûte rien au compositeur, ni au GPU) ;
 *  - le PROCESSEUR et la MÉMOIRE de chacun de nos processus (principal, rendu,
 *    GPU, utilitaires) — `app.getAppMetrics()` ;
 *  - ce qui s'agite autour : appels aux méthodes de fenêtre, flux de capture
 *    d'écran ouverts, octets partis vers OBS.
 *
 * Deux usages :
 *  1. `mesurerCout()` — un instantané léger pour le témoin « Coût actuel » des
 *     réglages, demandé par la page toutes les 2 s TANT QUE le panneau est
 *     ouvert. Ici : AUCUNE minuterie, aucun état qui survit à l'appel, hormis
 *     l'horodatage de la lecture précédente (nécessaire pour un débit d'images) ;
 *  2. `lancerSonde()` — 30 secondes de relevés, un fichier JSON et un résumé en
 *     français qui CONCLUT, écrits dans le dossier utilisateur, puis le dossier
 *     ouvert. Aucun envoi réseau : tout reste sur le disque de l'utilisateur.
 *
 * RÈGLE : la sonde n'ajoute rien à ce qu'elle mesure. Pas de capture d'image
 * (`beginFrameSubscription` copierait chaque image et fausserait tout), pas de
 * boucle rAF injectée (elle FORCERAIT des images). Le compteur d'images est un
 * simple enrobage de `requestAnimationFrame` dans la page : il ne compte que
 * les images que la page demande d'elle-même — et une page qui n'en demande
 * aucune ne produit aucune image, c'est précisément ce qu'on veut savoir.
 */
import { app, desktopCapturer, screen, shell, BrowserWindow, type WebContents } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { log, logError } from './logger'
import { obsServerStats } from './obs-server'

/* ------------------------------------------------------------------ *
 * Ce que le processus principal sait et que la sonde lui demande
 * ------------------------------------------------------------------ */

/** Une fenêtre d'Hexa, telle que le processus principal la connaît. */
export interface FenetreDecrite {
  win: BrowserWindow
  /** 'encre' | 'interface' | 'bandeau' | 'autre' */
  role: string
  displayId: number | null
  /** cette couche encre est-elle l'écran désigné pour l'annotation ? */
  annotation?: boolean
}

export interface SondeContexte {
  /** toutes les fenêtres vivantes, décrites */
  fenetres(): FenetreDecrite[]
  /** configuration lisible : écrans, écran d'annotation, réglages qui coûtent */
  configuration(): Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * Compteur d'images, posé dans la page
 * ------------------------------------------------------------------ */

/**
 * Enrobe `requestAnimationFrame` UNE fois par page et rend le nombre d'images
 * demandées depuis la lecture précédente. Idempotent : relancer le script ne
 * pose pas un second enrobage. Zéro coût au repos — un incrément par image, et
 * aucune image au repos.
 *
 * ⚠️ UN COMPTEUR PAR LECTEUR. Le témoin « Coût actuel » (panneau ouvert,
 * toutes les 2 s) et la sonde de 30 s lisaient le MÊME compteur, et chacun le
 * remettait à zéro : lancée depuis le panneau des réglages — le bouton est
 * là — la sonde se faisait voler ses images par le témoin. Mesuré sur la
 * vraie application (t-obs-4-eval.mjs, épreuve 6) : 465 images comptées
 * indépendamment dans la couche encre pendant douze secondes de dessin, 404
 * attribuées par la sonde, panneau ouvert — et la part volée dépend du
 * décalage entre les deux minuteries, donc du hasard. Chaque lecteur a
 * désormais sa propre case, remise à zéro par lui seul.
 */
const scriptImages = (lecteur: string): string => `(() => {
  const w = window;
  if (!w.__hexaImages) {
    w.__hexaImages = {};
    const orig = w.requestAnimationFrame.bind(w);
    w.requestAnimationFrame = (cb) => {
      for (const k in w.__hexaImages) w.__hexaImages[k]++;
      return orig(cb);
    };
  }
  const n = w.__hexaImages[${JSON.stringify(lecteur)}] ?? 0;
  w.__hexaImages[${JSON.stringify(lecteur)}] = 0;
  return n;
})()`

/** Ce que la couche encre sait de son contenu (moteur, archive, effets). */
const SCRIPT_ENCRE = `(() => {
  const out = { vivantes: null, archivees: null, fluxCapture: null, masques: null, gel: null };
  try {
    const e = window.hexaEngine;
    if (e && Array.isArray(e.strokes)) out.vivantes = e.strokes.length;
  } catch {}
  try {
    const d = window.__hexaDbg;
    if (d && typeof d.recCount === 'number') out.archivees = d.recCount;
  } catch {}
  try {
    const s = window.hexaFx && window.hexaFx.state();
    if (s) { out.fluxCapture = s.feed === true ? 1 : 0; out.masques = s.masks; out.gel = s.frozen; }
  } catch {}
  return out;
})()`

/** Horodatage de la dernière lecture du compteur, par lecteur et par page. */
const derniereLecture = new Map<string, number>()

async function lireImages(
  wc: WebContents,
  lecteur: 'temoin' | 'sonde',
): Promise<{ images: number; dt: number }> {
  const t = Date.now()
  const cle = `${lecteur}:${wc.id}`
  const avant = derniereLecture.get(cle) ?? t
  derniereLecture.set(cle, t)
  try {
    const n = await wc.executeJavaScript(scriptImages(lecteur), true)
    return { images: typeof n === 'number' ? n : 0, dt: Math.max(1, t - avant) }
  } catch {
    // page en cours de chargement, ou page native (bandeau) : rien à compter
    return { images: 0, dt: Math.max(1, t - avant) }
  }
}

/* ------------------------------------------------------------------ *
 * Instantané léger : le témoin « Coût actuel »
 * ------------------------------------------------------------------ */

export interface ProcessusCout {
  type: string
  nom: string
  pid: number
  /** % d'UN cœur, sur l'intervalle depuis la lecture précédente */
  cpu: number
  /** mémoire de travail, en Mo */
  memoireMo: number
}

export interface FenetreCout {
  titre: string
  role: string
  visible: boolean
  largeur: number
  hauteur: number
  /** % de la surface de son écran (0 si cachée) */
  surface: number
  imagesParSeconde: number
}

export interface Cout {
  /** % d'un cœur, tous processus Hexa confondus */
  cpuCoeur: number
  /** % du processeur ENTIER (tous cœurs) — ce que montre le gestionnaire des tâches */
  cpuTotal: number
  coeurs: number
  memoireMo: number
  /** images demandées par seconde, toutes pages confondues */
  imagesParSeconde: number
  /** % de la surface des écrans occupée par des fenêtres Hexa VISIBLES */
  surface: number
  fenetres: FenetreCout[]
  processus: ProcessusCout[]
}

function lireProcessus(): ProcessusCout[] {
  try {
    return app.getAppMetrics().map((m) => ({
      type: m.type,
      nom: m.name ?? '',
      pid: m.pid,
      cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
      memoireMo: Math.round(m.memory.workingSetSize / 1024),
    }))
  } catch {
    return []
  }
}

function surfaceEcran(displayId: number | null): number {
  try {
    const d = screen.getAllDisplays().find((x) => x.id === displayId) ?? screen.getPrimaryDisplay()
    return Math.max(1, d.bounds.width * d.bounds.height)
  } catch {
    return 1
  }
}

/**
 * L'instantané. Le premier appel après un long silence renvoie un processeur
 * à 0 : `percentCPUUsage` se calcule depuis l'appel précédent, c'est ainsi
 * qu'Electron le définit — la page le sait et n'affiche que le second relevé.
 */
export async function mesurerCout(ctx: SondeContexte): Promise<Cout> {
  const processus = lireProcessus()
  const cpuCoeur = processus.reduce((a, p) => a + p.cpu, 0)
  const coeurs = Math.max(1, os.cpus().length)
  const memoireMo = processus.reduce((a, p) => a + p.memoireMo, 0)
  const fenetres: FenetreCout[] = []
  let images = 0
  let surface = 0
  let ecrans = 0
  try {
    ecrans = screen.getAllDisplays().reduce((a, d) => a + d.bounds.width * d.bounds.height, 0)
  } catch {
    ecrans = 0
  }
  for (const f of ctx.fenetres()) {
    try {
      if (f.win.isDestroyed()) continue
      const b = f.win.getBounds()
      const visible = f.win.isVisible()
      const aire = visible ? b.width * b.height : 0
      const lu = await lireImages(f.win.webContents, 'temoin')
      const ips = Math.round((lu.images * 1000) / lu.dt)
      images += ips
      surface += aire
      fenetres.push({
        titre: f.win.getTitle(),
        role: f.role,
        visible,
        largeur: b.width,
        hauteur: b.height,
        surface: Math.round((1000 * aire) / surfaceEcran(f.displayId)) / 10,
        imagesParSeconde: ips,
      })
    } catch {
      /* fenêtre en cours de destruction */
    }
  }
  return {
    cpuCoeur: Math.round(cpuCoeur * 10) / 10,
    cpuTotal: Math.round((cpuCoeur / coeurs) * 10) / 10,
    coeurs,
    memoireMo,
    imagesParSeconde: images,
    surface: ecrans > 0 ? Math.round((1000 * surface) / ecrans) / 10 : 0,
    fenetres,
    processus,
  }
}

/* ------------------------------------------------------------------ *
 * La sonde de 30 secondes
 * ------------------------------------------------------------------ */

/** Méthodes de fenêtre comptées : celles qui font travailler le compositeur. */
const METHODES = [
  'show',
  'showInactive',
  'hide',
  'setBounds',
  'setAlwaysOnTop',
  'setIgnoreMouseEvents',
  'focus',
  'setOpacity',
  'setContentProtection',
] as const

/** Relevé périodique (toutes les 2 s). */
interface Releve {
  t: number
  cpuCoeur: number
  memoireMo: number
  surface: number
  images: number
  fenetres: { titre: string; visible: boolean; largeur: number; hauteur: number; images: number }[]
}

export interface SondeResultat {
  dossier: string
  json: string
  resume: string
}

const DUREE_MS = 30_000
const PAS_MS = 2000
/** Le bandeau « diagnostic en cours » s'efface avant que la mesure ne commence. */
const ATTENTE_BANDEAU_MS = 3500

let enCours: Promise<SondeResultat> | null = null
/** Secondes restantes, pour l'icône près de l'horloge (0 = rien en cours). */
let restant = 0

export function sondeEnCours(): boolean {
  return enCours != null
}

export function sondeRestant(): number {
  return restant
}

/** Version de Windows lisible (« Windows 11 (10.0.22631) »), sans dépendance. */
function versionSysteme(): string {
  try {
    const v = process.getSystemVersion()
    if (process.platform === 'win32') {
      const build = Number(v.split('.')[2] ?? 0)
      return `Windows ${build >= 22000 ? '11' : '10'} (${v})`
    }
    if (process.platform === 'darwin') return `macOS ${v}`
    return `${os.type()} ${os.release()}`
  } catch {
    return `${process.platform} ${os.release()}`
  }
}

/** Accélération matérielle : ce que Chromium a RÉELLEMENT obtenu. */
function accelerationMaterielle(): Record<string, string> {
  try {
    const s = app.getGPUFeatureStatus() as unknown as Record<string, string>
    return {
      compositionGpu: s.gpu_compositing ?? '?',
      canvas2d: s['2d_canvas'] ?? '?',
      rasterisation: s.rasterization ?? '?',
      webgl: s.webgl ?? '?',
    }
  } catch {
    return { compositionGpu: '?', canvas2d: '?', rasterisation: '?', webgl: '?' }
  }
}

function formatMo(n: number): string {
  return `${Math.round(n)} Mo`
}

function pct(n: number): string {
  return `${(Math.round(n * 10) / 10).toLocaleString('fr-FR')} %`
}

/**
 * Lance la sonde. Un seul relevé à la fois : un second appel pendant la mesure
 * rend la promesse déjà en cours.
 */
export function lancerSonde(ctx: SondeContexte, onTick?: () => void): Promise<SondeResultat> {
  if (enCours) return enCours
  enCours = executer(ctx, onTick).finally(() => {
    enCours = null
    restant = 0
    onTick?.()
  })
  return enCours
}

async function executer(ctx: SondeContexte, onTick?: () => void): Promise<SondeResultat> {
  const debutAbsolu = Date.now()
  log('sonde', `diagnostic de performance lancé (${DUREE_MS / 1000} s de relevés)`)

  /* --- espions posés le temps de la mesure, retirés ensuite ------------ */
  const appels: Record<string, number> = {}
  const restaurer: Array<() => void> = []
  const espionner = (w: BrowserWindow) => {
    for (const m of METHODES) {
      const cible = w as unknown as Record<string, (...a: unknown[]) => unknown>
      const orig = cible[m]
      if (typeof orig !== 'function') continue
      cible[m] = (...a: unknown[]) => {
        const cle = `${w.isDestroyed() ? '?' : w.getTitle()} · ${m}`
        appels[cle] = (appels[cle] ?? 0) + 1
        return orig.apply(w, a)
      }
      restaurer.push(() => {
        try {
          // On rend la méthode du prototype telle quelle : après la sonde, la
          // fenêtre ne porte plus AUCUNE propriété propre — c'est vérifiable,
          // et c'est ce que la campagne vérifie (t-obs-3-sonde.mjs).
          const proto = Object.getPrototypeOf(w) as Record<string, unknown>
          if (proto[m] === orig) delete cible[m]
          else if (cible[m] !== orig) cible[m] = orig
        } catch {
          /* fenêtre détruite entre-temps */
        }
      })
    }
  }
  for (const f of ctx.fenetres()) if (!f.win.isDestroyed()) espionner(f.win)
  const surCreation = (_e: unknown, w: BrowserWindow) => espionner(w)
  app.on('browser-window-created', surCreation)
  restaurer.push(() => app.removeListener('browser-window-created', surCreation))

  // captures d'écran demandées au système (loupe, gel, flou) pendant la mesure
  let capturesEcran = 0
  {
    const dc = desktopCapturer as unknown as { getSources: (...a: unknown[]) => Promise<unknown> }
    const orig = dc.getSources
    dc.getSources = (...a: unknown[]) => {
      capturesEcran++
      return orig.apply(desktopCapturer, a)
    }
    restaurer.push(() => {
      dc.getSources = orig
    })
  }

  const obsAvant = obsServerStats()

  // Le bandeau de lancement doit avoir disparu avant le premier relevé : ses
  // propres images fausseraient la mesure de la première seconde.
  await new Promise((r) => setTimeout(r, ATTENTE_BANDEAU_MS))
  // Premier appel « à blanc » : percentCPUUsage se mesure depuis l'appel
  // précédent, la première valeur ne veut rien dire. Même chose pour les
  // compteurs d'images : on les remet à zéro.
  lireProcessus()
  for (const f of ctx.fenetres()) if (!f.win.isDestroyed()) await lireImages(f.win.webContents, 'sonde')

  /* --- relevés ---------------------------------------------------------- */
  const releves: Releve[] = []
  const debut = Date.now()
  const ecrans = (() => {
    try {
      return screen.getAllDisplays().reduce((a, d) => a + d.bounds.width * d.bounds.height, 0)
    } catch {
      return 1
    }
  })()
  /** temps de visibilité cumulé et surface max, par titre de fenêtre */
  const parFenetre = new Map<
    string,
    { role: string; visibleMs: number; surfaceMax: number; images: number; largeurMax: number; hauteurMax: number }
  >()

  while (Date.now() - debut < DUREE_MS) {
    await new Promise((r) => setTimeout(r, PAS_MS))
    const t = Date.now() - debut
    restant = Math.max(0, Math.round((DUREE_MS - t) / 1000))
    onTick?.()
    const processus = lireProcessus()
    const fenetres: Releve['fenetres'] = []
    let surface = 0
    let images = 0
    for (const f of ctx.fenetres()) {
      try {
        if (f.win.isDestroyed()) continue
        const b = f.win.getBounds()
        const visible = f.win.isVisible()
        const lu = await lireImages(f.win.webContents, 'sonde')
        const titre = f.win.getTitle()
        fenetres.push({ titre, visible, largeur: b.width, hauteur: b.height, images: lu.images })
        images += lu.images
        const aire = visible ? b.width * b.height : 0
        surface += aire
        const acc = parFenetre.get(titre) ?? {
          role: f.role,
          visibleMs: 0,
          surfaceMax: 0,
          images: 0,
          largeurMax: 0,
          hauteurMax: 0,
        }
        if (visible) acc.visibleMs += PAS_MS
        acc.surfaceMax = Math.max(acc.surfaceMax, (100 * aire) / surfaceEcran(f.displayId))
        acc.images += lu.images
        if (visible) {
          acc.largeurMax = Math.max(acc.largeurMax, b.width)
          acc.hauteurMax = Math.max(acc.hauteurMax, b.height)
        }
        parFenetre.set(titre, acc)
      } catch {
        /* fenêtre en cours de destruction */
      }
    }
    releves.push({
      t,
      cpuCoeur: processus.reduce((a, p) => a + p.cpu, 0),
      memoireMo: processus.reduce((a, p) => a + p.memoireMo, 0),
      surface: (100 * surface) / ecrans,
      images,
      fenetres,
    })
  }
  const dureeReelle = Date.now() - debut

  /* --- fin de mesure : on retire tout, puis on lit ce qui reste --------- */
  for (const r of restaurer) r()
  const processusFin = lireProcessus()
  const obsApres = obsServerStats()

  // contenu des couches encre (traits vivants, archive, flux de capture)
  const encres: Record<string, unknown>[] = []
  for (const f of ctx.fenetres()) {
    if (f.role !== 'encre' || f.win.isDestroyed()) continue
    try {
      const r = (await f.win.webContents.executeJavaScript(SCRIPT_ENCRE, true)) as Record<
        string,
        unknown
      >
      encres.push({ titre: f.win.getTitle(), annotation: f.annotation === true, ...r })
    } catch {
      encres.push({ titre: f.win.getTitle(), annotation: f.annotation === true, illisible: true })
    }
  }

  /* --- synthèse --------------------------------------------------------- */
  const n = Math.max(1, releves.length)
  const moy = (sel: (r: Releve) => number) => releves.reduce((a, r) => a + sel(r), 0) / n
  const max = (sel: (r: Releve) => number) => releves.reduce((a, r) => Math.max(a, sel(r)), 0)
  const coeurs = Math.max(1, os.cpus().length)
  const cpuCoeurMoy = moy((r) => r.cpuCoeur)
  const cpuCoeurMax = max((r) => r.cpuCoeur)
  const memMoy = moy((r) => r.memoireMo)
  const memMax = max((r) => r.memoireMo)
  const surfaceMoy = moy((r) => r.surface)
  const surfaceMax = max((r) => r.surface)
  const imagesTotal = releves.reduce((a, r) => a + r.images, 0)
  const imagesParSeconde = (imagesTotal * 1000) / Math.max(1, dureeReelle)
  const appelsTotal = Object.values(appels).reduce((a, b) => a + b, 0)
  const octetsObs = obsApres.octetsEnvoyes - obsAvant.octetsEnvoyes
  const messagesObs = obsApres.messagesEnvoyes - obsAvant.messagesEnvoyes

  /**
   * CE QUI COÛTE LE PLUS CHER — la phrase que l'utilisateur attend. On classe
   * les postes par ce qu'ils pèsent réellement, dans l'ordre où ils font
   * saccader un jeu : la surface composée d'abord (c'est elle qui a fait ramer
   * OBS), puis les images produites, puis le processeur, puis les appels de
   * fenêtre. Un poste est cité s'il dépasse un seuil ; sinon la conclusion
   * dit que rien ne coûte.
   */
  const postes: string[] = []
  if (surfaceMoy > 5) {
    const pire = [...parFenetre.entries()].sort((a, b) => b[1].surfaceMax - a[1].surfaceMax)[0]
    postes.push(
      `la surface composée (${pct(surfaceMoy)} de l’écran en moyenne, jusqu’à ${pct(surfaceMax)}` +
        (pire ? ` — surtout « ${pire[0]} », ${pire[1].largeurMax}×${pire[1].hauteurMax}` : '') +
        ') : c’est ce que Windows empile par-dessus ton jeu à chaque image',
    )
  }
  if (imagesParSeconde > 2) {
    const pire = [...parFenetre.entries()].sort((a, b) => b[1].images - a[1].images)[0]
    postes.push(
      `les images demandées par les pages (${imagesParSeconde.toFixed(1)} par seconde` +
        (pire && pire[1].images > 0 ? `, surtout par « ${pire[0]} »` : '') +
        ') : une page qui redessine fait travailler le processeur graphique',
    )
  }
  if (cpuCoeurMoy > 3) {
    postes.push(`le processeur (${pct(cpuCoeurMoy)} d’un cœur en moyenne, pointe à ${pct(cpuCoeurMax)})`)
  }
  if (appelsTotal > 20) {
    const pire = Object.entries(appels).sort((a, b) => b[1] - a[1])[0]
    postes.push(`les manipulations de fenêtre (${appelsTotal} en ${Math.round(dureeReelle / 1000)} s, surtout ${pire[0]} × ${pire[1]})`)
  }
  if (capturesEcran > 0) postes.push(`${capturesEcran} capture(s) d’écran demandée(s) au système (loupe, gel ou flou)`)
  if (octetsObs > 512 * 1024) postes.push(`le miroir OBS (${formatMo(octetsObs / 1024 / 1024)} envoyés en ${messagesObs} messages)`)

  const conclusion =
    `Pendant ces ${Math.round(dureeReelle / 1000)} s, Hexa a occupé ${pct(cpuCoeurMoy / coeurs)} de ton processeur ` +
    `(${pct(cpuCoeurMoy)} d’un cœur sur ${coeurs}) et ${formatMo(memMoy)} de mémoire (pointe à ${formatMo(memMax)}) ; ` +
    `sa surface composée valait ${pct(surfaceMoy)} de l’écran en moyenne (au plus ${pct(surfaceMax)} — ` +
    `fenêtres visibles additionnées, 200 % = deux calques plein écran) et ses pages ont produit ` +
    `${imagesTotal} image${imagesTotal > 1 ? 's' : ''} en tout (${imagesParSeconde.toFixed(1)}/s). ` +
    (postes.length === 0
      ? 'Rien ne coûte : pas une image produite au-delà du bruit, une surface composée nulle ou négligeable, un processeur au repos. Si ton jeu saccade, ce n’est pas Hexa.'
      : `Ce qui coûte le plus cher est ${postes[0]}${postes.length > 1 ? ` ; ensuite ${postes.slice(1).join(' ; ')}` : ''}.`)

  const configuration = ctx.configuration()
  const rapport = {
    app: 'hexa',
    version: app.getVersion(),
    date: new Date(debutAbsolu).toISOString(),
    dureeMs: dureeReelle,
    pasMs: PAS_MS,
    systeme: {
      plateforme: process.platform,
      version: versionSysteme(),
      coeurs,
      memoireMachineMo: Math.round(os.totalmem() / 1024 / 1024),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      accelerationMaterielle: accelerationMaterielle(),
    },
    configuration,
    synthese: {
      cpuCoeurMoyen: Math.round(cpuCoeurMoy * 10) / 10,
      cpuCoeurMax: Math.round(cpuCoeurMax * 10) / 10,
      cpuTotalMoyen: Math.round((cpuCoeurMoy / coeurs) * 100) / 100,
      memoireMoMoyenne: Math.round(memMoy),
      memoireMoMax: Math.round(memMax),
      surfaceMoyenne: Math.round(surfaceMoy * 10) / 10,
      surfaceMax: Math.round(surfaceMax * 10) / 10,
      imagesTotal,
      imagesParSeconde: Math.round(imagesParSeconde * 10) / 10,
      appelsFenetre: appelsTotal,
      capturesEcran,
      obs: {
        vuesConnectees: obsApres.clients,
        octetsEnvoyes: octetsObs,
        messagesEnvoyes: messagesObs,
        serveur: obsApres.running ? `127.0.0.1:${obsApres.port}` : 'arrêté',
      },
      postes,
      conclusion,
    },
    fenetres: [...parFenetre.entries()].map(([titre, f]) => ({
      titre,
      role: f.role,
      visiblePourcent: Math.round((100 * f.visibleMs) / Math.max(1, dureeReelle)),
      surfaceMaxPourcent: Math.round(f.surfaceMax * 10) / 10,
      tailleMax: `${f.largeurMax}×${f.hauteurMax}`,
      images: f.images,
    })),
    processus: processusFin,
    appelsFenetre: appels,
    couchesEncre: encres,
    releves,
  }

  /* --- écriture --------------------------------------------------------- */
  const dossier = path.join(app.getPath('userData'), 'diagnostics')
  fs.mkdirSync(dossier, { recursive: true })
  const horodatage = new Date(debutAbsolu).toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const json = path.join(dossier, `hexa-diagnostic-${horodatage}.json`)
  const resume = path.join(dossier, `hexa-diagnostic-${horodatage}.txt`)
  fs.writeFileSync(json, JSON.stringify(rapport, null, 2), 'utf8')
  fs.writeFileSync(resume, redigerResume(rapport), 'utf8')
  log('sonde', 'diagnostic écrit', { json, resume })
  try {
    shell.showItemInFolder(resume)
  } catch (err) {
    logError('sonde', 'ouverture du dossier impossible', err)
  }
  return { dossier, json, resume }
}

/**
 * Le résumé pour un non-développeur : phrases courtes, chiffres arrondis,
 * et la conclusion en premier — c'est la seule ligne que la plupart liront.
 */
function redigerResume(r: Record<string, unknown>): string {
  const s = r.synthese as Record<string, unknown> & { obs: Record<string, unknown>; postes: string[] }
  const sys = r.systeme as Record<string, unknown> & { accelerationMaterielle: Record<string, string> }
  const cfg = r.configuration as Record<string, unknown>
  const fen = r.fenetres as Array<Record<string, unknown>>
  const proc = r.processus as ProcessusCout[]
  const encres = r.couchesEncre as Array<Record<string, unknown>>
  const l: string[] = []
  l.push('HEXA — DIAGNOSTIC DE PERFORMANCE')
  l.push(`${new Date(String(r.date)).toLocaleString('fr-FR')} · Hexa ${r.version} · ${Math.round(Number(r.dureeMs) / 1000)} s de relevés, un toutes les ${Number(r.pasMs) / 1000} s`)
  l.push('')
  l.push('CONCLUSION')
  l.push(String(s.conclusion))
  l.push('')
  l.push('EN CHIFFRES')
  l.push(`- Processeur : ${pct(Number(s.cpuTotalMoyen))} du processeur entier en moyenne (${pct(Number(s.cpuCoeurMoyen))} d’un cœur, pointe à ${pct(Number(s.cpuCoeurMax))}).`)
  l.push(`- Mémoire : ${s.memoireMoMoyenne} Mo en moyenne, ${s.memoireMoMax} Mo au plus, tous processus Hexa confondus.`)
  l.push(`- Surface composée (fenêtres Hexa visibles additionnées ; 100 % = un calque plein écran, 200 % = deux) : ${pct(Number(s.surfaceMoyenne))} en moyenne, ${pct(Number(s.surfaceMax))} au plus.`)
  l.push(`- Images demandées par les pages (requestAnimationFrame — les animations CSS de la barre n’y figurent pas) : ${s.imagesTotal} en tout, soit ${s.imagesParSeconde} par seconde (0 = rien ne redessine).`)
  l.push(`- Manipulations de fenêtre : ${s.appelsFenetre}. Captures d’écran demandées au système : ${s.capturesEcran}.`)
  l.push(`- OBS : serveur ${s.obs.serveur}, ${s.obs.vuesConnectees} source(s) navigateur connectée(s), ${Math.round(Number(s.obs.octetsEnvoyes) / 1024)} Ko envoyés en ${s.obs.messagesEnvoyes} messages.`)
  l.push('')
  l.push('FENÊTRES')
  for (const f of fen) {
    l.push(`- « ${f.titre} » (${f.role}) : visible ${f.visiblePourcent} % du temps, jusqu’à ${f.tailleMax} px soit ${f.surfaceMaxPourcent} % de son écran, ${f.images} image(s) demandée(s).`)
  }
  l.push('')
  l.push('PROCESSUS (fin de mesure)')
  for (const p of proc) l.push(`- ${p.type}${p.nom ? ` « ${p.nom} »` : ''} (pid ${p.pid}) : ${pct(p.cpu)} d’un cœur, ${p.memoireMo} Mo.`)
  l.push('')
  l.push('ANNOTATIONS')
  if (encres.length === 0) l.push('- aucune couche encre lisible.')
  for (const e of encres) {
    l.push(
      `- « ${e.titre} »${e.annotation ? ' (écran d’annotation)' : ''} : ${e.vivantes ?? '?'} annotation(s) à l’écran, ${e.archivees ?? '?'} archivée(s) pour le rejeu, flux de capture d’écran ouvert : ${e.fluxCapture === 1 ? 'oui' : 'non'}, masques flous : ${e.masques ?? 0}, gel d’image : ${e.gel ? 'oui' : 'non'}.`,
    )
  }
  l.push('')
  l.push('CONFIGURATION')
  l.push(`- Système : ${sys.version} · ${sys.coeurs} cœurs · ${sys.memoireMachineMo} Mo · Electron ${sys.electron} / Chromium ${sys.chromium}.`)
  l.push(`- Accélération matérielle : composition ${sys.accelerationMaterielle.compositionGpu}, canvas 2D ${sys.accelerationMaterielle.canvas2d}, rastérisation ${sys.accelerationMaterielle.rasterisation}.`)
  for (const [k, v] of Object.entries(cfg)) {
    l.push(`- ${k} : ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  l.push('')
  l.push('Ce fichier n’a été envoyé nulle part : il n’existe que sur cet ordinateur. Le JSON voisin contient le détail relevé par relevé.')
  return l.join('\n')
}
