import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ToolId } from './engine/types'
import { GRID_MODES, type GridMode, type StageClock, type StageNote } from './engine/stream-fx'
import { OBS_DEFAULT_PORT, type ObsMode } from './obs/protocol'
import { CATEGORIES_DEFAUT, type CategorieId } from './engine/handwriting/mots'
import { DEFAULT_PRESET, type KeymapAction, type KeymapPresetId } from './keymap'
import {
  DEFAULT_DOCK,
  isEdge,
  resolveOrientation,
  type ToolbarEdge,
  type ToolbarOrientationPref,
} from './ui/toolbar-dock'
import {
  DEFAULT_PROFILE_ID,
  findProfile,
  makeGlyph,
  makeProfileId,
  pickKnownSettings,
  snapshotSettings,
  type HexaProfile,
} from './profiles'

/**
 * La palette. BLEU CLAIR et ROUGE en tête, et comme duo par défaut : ce sont
 * les deux camps de League of Legends (blue side / red side), ce qu'un coach
 * annote quatre-vingt-dix-neuf fois sur cent. Le bleu clair est le cyan
 * historique d'Hexa — celui que l'utilisateur préfère au bleu soutenu, gardé
 * en troisième. Le reste garde la signature néon. Sept couleurs, pas une de
 * plus : la barre tient en largeur avec Fin tenu.
 */
export const COLORS = ['#00e5ff', '#ff3d3d', '#2f7cff', '#ff2d95', '#39ff14', '#ffe900', '#ffffff']

export const FADE_STEPS: (number | null)[] = [2000, 4000, 8000, null]

/** Réglages du miroir OBS (§10.2) et du client obs-websocket (§7.3). */
export interface ObsSettings {
  /** diffusion de l'état d'annotation vers la vue OBS */
  obsMirror: boolean
  /** « Écran » (défaut) ou « Stream seul » : l'écran du streamer reste propre */
  obsMode: ObsMode
  /** serveur local qui sert obs.html (overlay Electron uniquement) */
  obsServerOn: boolean
  /** port du serveur local, toujours sur 127.0.0.1 */
  obsPort: number
  /** client obs-websocket v5 : efface l'écran au changement de scène */
  obsWsEnabled: boolean
  obsWsHost: string
  obsWsPort: number
  /** mot de passe obs-websocket — jamais journalisé, jamais envoyé ailleurs */
  obsWsPassword: string
  obsClearOnScene: boolean
}

export const OBS_DEFAULTS: ObsSettings = {
  obsMirror: true,
  obsMode: 'screen',
  // ACTIF PAR DÉFAUT, et c'est un choix assumé : l'utilisateur ouvre OBS, colle
  // l'adresse affichée dans les réglages, et ça marche. Sans ça, il faudrait
  // penser à allumer un interrupteur qu'il ne connaît pas. L'écoute est
  // strictement limitée à 127.0.0.1 : rien ne sort de la machine, et le
  // pare-feu Windows ne demande RIEN pour la boucle locale.
  obsServerOn: true,
  obsPort: OBS_DEFAULT_PORT,
  obsWsEnabled: false,
  obsWsHost: '127.0.0.1',
  obsWsPort: 4455,
  obsWsPassword: '',
  obsClearOnScene: true,
}

export interface UiState extends ObsSettings {
  tool: ToolId
  color: string
  /** couleur précédente : Tab l'échange avec la courante (duo bleu / rouge) */
  prevColor: string
  /** version de la palette enregistrée — voir la migration dans `merge` */
  palette: 3
  /** calque fantôme : la page précédente en filigrane sous la courante */
  ghostPage: boolean
  size: number
  /** null = les annotations restent jusqu'au clear ("board" persistant) */
  fadeDelay: number | null
  sparkles: boolean
  /** formes intelligentes : redresser le tracé au stylo à la fin du geste (§4.1) */
  smartShapes: boolean
  /** guides magnétiques (angles remarquables, alignements, espacement égal) */
  guides: boolean
  /** numéroteur : relier automatiquement la pastille N à N+1 */
  linkBadges: boolean
  /** annotations masquées : rien n'est perdu, le fondu est suspendu, et la
   *  couche redevenue vide laisse la fenêtre se retirer (coût nul) */
  annotationsHidden: boolean
  /**
   * Menu radial : afficher les DOUZE outils au lieu des sept essentiels.
   *
   * COUPÉ par défaut. Une roue à douze secteurs demande de viser ; à sept,
   * chaque secteur est large et se prend sans regarder — ce qui est tout
   * l'intérêt du geste quand on annote en plein direct. Les cinq autres
   * restent accessibles au clavier et depuis la barre.
   */
  radialAllTools: boolean
  /** numéroteur : poursuivre la numérotation d'une couleur à l'autre
   *  (coupé = chaque couleur repart de 1, ce qui est le cas d'usage courant) */
  badgeContinuous: boolean
  /**
   * Mode écriture : chaque CAPITALE tracée à la main est reconnue et
   * retracée en typographie ~400 ms après avoir été finie, pendant qu'on
   * écrit déjà la suivante.
   *
   * DÉSACTIVÉ par défaut, et ce n'est pas de la timidité : dans ce mode, un
   * rond dessiné pour entourer un ennemi deviendrait un « O ». Or on dessine
   * bien plus souvent qu'on n'écrit. Le mode s'allume donc d'une touche (J)
   * ou d'un bouton, au moment où l'on veut écrire — et se coupe pareil.
   */
  handwriting: boolean
  /**
   * Correcteur lexical du mode écriture : à la fin d'un mot, la suite de
   * lettres lues est confrontée au lexique embarqué, et « SYNDRA » devient
   * « Syndra ». ACTIVÉ par défaut — c'est ce qui rend le mode écriture
   * utilisable en live, et il s'abstient dès qu'il doute (§ lexique.ts).
   */
  lexicon: boolean
  /** catégories du lexique effectivement chargées */
  lexiconCategories: CategorieId[]
  /** mots ajoutés par l'utilisateur : pseudos, équipes, jargon maison */
  lexiconWords: string[]
  /** identifiant du thème visuel (8 designs) */
  theme: string
  /** la séquence de découverte a déjà été jouée (premier lancement seulement) */
  onboarded: boolean
  /** intensité globale des halos et braises (0.4 sobre → 1.4 spectaculaire) */
  effectIntensity: number
  /** flèches pulsantes (mode « boucle ») — COUPÉ par défaut : une flèche qui
   *  respire garde la boucle de rendu allumée en permanence */
  arrowPulse: boolean
  /** rayon du disque du spotlight en px (§5.2) — réglé à la molette, persistant */
  spotlightRadius: number
  /** sons génératifs : COUPÉS par défaut (§16.7) */
  sound: boolean
  /** true dès que l'utilisateur a lui-même actionné l'interrupteur des sons */
  soundChosen: boolean
  /** volume des sons génératifs (0 → 1) */
  soundVolume: number
  settingsOpen: boolean
  /** aide-mémoire des raccourcis ouvert (touche ?) */
  cheatsheetOpen: boolean
  /** barre de rejeu de session ouverte (§11) — n'altère jamais la session vive */
  replayOpen: boolean
  /** barre d'outils visible — masquable au clavier (Ctrl+H en preset Epic Pen) */
  toolbarVisible: boolean
  /** bord d'ancrage de la barre (§S4) — gauche par défaut, donc verticale */
  toolbarEdge: ToolbarEdge
  /** position du centre de la barre le long de ce bord, en proportion 0 → 1 */
  toolbarOffset: number
  /** 'auto' = l'orientation suit le bord ; sinon choix explicite de l'utilisateur */
  toolbarOrientation: ToolbarOrientationPref
  /**
   * Écran qui porte la barre, mémorisé entre les sessions.
   * null = on suit la décision d'Electron (écran de droite en multi-écrans).
   */
  toolbarDisplayId: number | null
  /**
   * Masquer l'interface de Hexa dans les captures (§S11).
   *
   * ACTIVÉ PAR DÉFAUT, et c'est le réglage le plus important pour un streamer :
   * la barre d'outils, les panneaux, les bandeaux d'état et le curseur vivent
   * dans une SECONDE fenêtre, que Windows sait exclure de toute capture
   * (WDA_EXCLUDEFROMCAPTURE). Ils restent parfaitement visibles sur l'écran de
   * l'utilisateur et disparaissent d'OBS, de Discord et des impressions
   * d'écran. Les ANNOTATIONS, elles, restent toujours capturées : ce sont
   * elles que les spectateurs doivent voir.
   */
  hideUiFromCapture: boolean
  /** preset de raccourcis actif (Epic Pen par défaut, ou clavier maison Hexa) */
  keymapPreset: KeymapPresetId
  /** l'utilisateur a choisi son preset lui-même : on ne le lui reprend jamais */
  keymapPresetChosen: boolean
  /** remaps utilisateur par-dessus le preset — null = raccourci retiré */
  keymapOverrides: Partial<Record<KeymapAction, string | string[] | null>>
  /**
   * Raccourcis CONFISQUÉS au système entier (actifs même sans le focus).
   *
   * ACTIVÉ PAR DÉFAUT : c'est la demande centrale du projet — « les raccourcis
   * Epic Pen par défaut ». Un raccourci qui n'agit que lorsque la fenêtre d'Hexa
   * a le focus ne sert à rien quand on annote PAR-DESSUS un jeu : appuyer sur
   * Ctrl+Maj+3 doit sortir le stylo pendant qu'on joue, sans étape préalable.
   *
   * Le garde-fou n'est pas cet interrupteur, il est dans la table : RegisterHotKey
   * de Windows étant exclusif, `NEVER_GLOBAL` (src/keymap.ts) interdit de voler
   * au système les combinaisons universelles — Ctrl+Z, Ctrl+C… et Ctrl+E et
   * Ctrl+H, qui appartiennent au navigateur et à VLC. Ce qui part réellement au
   * système, ce sont les Ctrl+Maj+2…8, F8 et la touche panique, qu'aucun autre
   * logiciel n'utilise.
   */
  globalShortcutsOn: boolean
  /** true dès que l'utilisateur a lui-même touché à l'interrupteur ci-dessus :
   *  son choix prime alors sur toute migration future. */
  globalShortcutsChosen: boolean
  /** profil d'usage courant (Analyse LoL, Masterclass, Coaching live, Discret…) */
  profileId: string
  /** profils créés par l'utilisateur depuis l'état courant */
  customProfiles: HexaProfile[]
  /** superposition de cadrage (§5.8.1) : grille, règle des tiers, ou les deux */
  gridMode: GridMode
  /** discrétion de la superposition (0,03 → 0,3) */
  gridOpacity: number
  /** chronos et comptes à rebours posés à l'écran (§5.8.2) */
  clocks: StageClock[]
  /** notes persistantes posées à l'écran (§5.8.3) — hors fondu, hors panique */
  notes: StageNote[]
  /**
   * PAGES D'ANNOTATION. L'interface (barre, clavier) est la seule source de
   * vérité du numéro de page : chaque moteur — il y en a un par écran — suit
   * `pageIndex` et crée les pages qu'il ne connaît pas encore. Le compte est
   * tenu ici pour la même raison : deux moteurs qui annonceraient chacun leur
   * compte se disputeraient la barre. Rien n'est persisté : comme les
   * annotations, les pages vivent le temps d'une session.
   */
  pageIndex: number
  pageCount: number
  /** demande de duplication : compteur incrémenté à chaque « dupliquer », et
   *  page source — le moteur copie `pageDupFrom` dans `pageIndex` */
  pageDupSeq: number
  pageDupFrom: number
  /** plaque de lisibilité proposée par défaut aux nouveaux textes (Stroke.plate) */
  textPlate: boolean
  /**
   * BARRE QUI S'EFFACE : en mode dessin, après ce nombre de secondes sans
   * survol ni changement d'outil, la barre s'estompe (elle reste là, cliquable,
   * juste discrète) et revient dès que la souris s'en approche. 0 = jamais.
   * Un coach qui annote une vidéo n'a pas à garder un bandeau opaque sur le
   * bord de l'image pendant qu'il parle.
   */
  toolbarFade: number
  /**
   * Message éphémère à afficher (« PNG exporté », « Page 2 / 3 »…). Passe par
   * le store parce que le store VOYAGE entre les deux fenêtres : un geste fait
   * au clavier dans la couche encre doit s'annoncer dans la couche interface,
   * la seule que l'utilisateur voit hors caméra. `seq` rejoue l'animation
   * même si le texte est identique. Jamais persisté.
   */
  notice: { text: string; seq: number }
  setTool: (tool: ToolId) => void
  setColor: (color: string) => void
  /** Tab : échange couleur courante et précédente */
  swapColor: () => void
  toggleGhostPage: () => void
  setSize: (size: number) => void
  setFadeDelay: (fadeDelay: number | null) => void
  cycleFade: () => void
  toggleSparkles: () => void
  toggleSmartShapes: () => void
  toggleGuides: () => void
  toggleLinkBadges: () => void
  toggleAnnotationsHidden: () => void
  toggleBadgeContinuous: () => void
  toggleRadialAllTools: () => void
  toggleHandwriting: () => void
  toggleLexicon: () => void
  toggleLexiconCategory: (id: CategorieId) => void
  setLexiconWords: (words: string[]) => void
  setTheme: (theme: string) => void
  setOnboarded: (onboarded: boolean) => void
  setEffectIntensity: (value: number) => void
  toggleArrowPulse: () => void
  setSpotlightRadius: (r: number) => void
  toggleSound: () => void
  setSoundVolume: (v: number) => void
  setSettingsOpen: (open: boolean) => void
  setCheatsheetOpen: (open: boolean) => void
  setReplayOpen: (open: boolean) => void
  /** applique un sous-ensemble des réglages OBS */
  setObs: (patch: Partial<ObsSettings>) => void
  toggleToolbar: () => void
  /** ancre la barre à un bord, à telle proportion le long de ce bord */
  setToolbarDock: (edge: ToolbarEdge, offset: number) => void
  setToolbarOrientation: (pref: ToolbarOrientationPref) => void
  /** bascule rapide vertical ⇄ horizontal (bouton de la barre, réglages) */
  toggleToolbarOrientation: () => void
  /** « replacer la barre » : retour au bord gauche, orientation automatique */
  resetToolbarDock: () => void
  setToolbarDisplayId: (id: number | null) => void
  /** masquer (ou non) l'interface de Hexa dans les captures d'écran */
  setHideUiFromCapture: (on: boolean) => void
  setKeymapPreset: (preset: KeymapPresetId) => void
  setBinding: (action: KeymapAction, combo: string | null) => void
  resetBinding: (action: KeymapAction) => void
  resetAllBindings: () => void
  setGlobalShortcuts: (on: boolean) => void
  applyProfile: (id: string) => void
  saveCustomProfile: (name: string) => void
  deleteCustomProfile: (id: string) => void
  setGridMode: (mode: GridMode) => void
  cycleGrid: () => void
  setGridOpacity: (v: number) => void
  addClock: (clock: StageClock) => void
  updateClock: (id: string, patch: Partial<StageClock>) => void
  removeClock: (id: string) => void
  addNote: (note: StageNote) => void
  updateNote: (id: string, patch: Partial<StageNote>) => void
  removeNote: (id: string) => void
  /** page suivante / précédente (bornées), nouvelle page (à la fin), copie */
  nextPage: () => void
  prevPage: () => void
  newPage: () => void
  duplicatePage: () => void
  setPage: (index: number) => void
  setTextPlate: (on: boolean) => void
  setToolbarFade: (seconds: number) => void
  cycleToolbarFade: () => void
  notify: (text: string) => void
}

/* ------------------------------------------------------------------ *
 * ASSAINISSEMENT DE L'ÉTAT RELU
 *
 * ⚠️ LE MODE DE PANNE LE PLUS DANGEREUX DE TOUT LE PROJET, et il a déjà frappé
 * une fois (« l'application empaquetée affichait une fenêtre vide »).
 *
 * Hexa relit à chaque lancement un état qu'il a écrit lui-même. Cet état peut
 * être abîmé sans que l'utilisateur y soit pour rien : coupure de courant
 * pendant une écriture, plantage de la machine, retour à une version
 * antérieure, fichier recopié d'un autre poste. Or `clocks` et `notes` sont
 * les seules valeurs persistées qui sont PARCOURUES AU RENDU
 * (`clocks.length`, `clocks.map`, `note.id`). Une seule d'entre elles abîmée
 * et le rendu React lève — donc rien ne se monte, ni la scène, ni le moteur,
 * ni la barre. Et comme l'overlay est une fenêtre TRANSPARENTE, l'utilisateur
 * ne voit pas un message d'erreur : il ne voit RIEN, et n'a aucun moyen de
 * comprendre ni de s'en sortir.
 *
 * Mesuré sur la vraie application avant ce garde (§S20) : `clocks: null`,
 * `clocks: 'trois'` et une liste contenant un `null` donnaient chacune une
 * fenêtre entièrement vide — 0 canevas, aucun moteur, le stylo mort.
 *
 * On jette donc ce qui n'a pas de sens plutôt que de le propager. Une carte
 * perdue est un dommage minuscule ; une application muette en plein direct
 * n'en est pas un.
 * ------------------------------------------------------------------ */

/** Les seuls identifiants d'outil qui existent — voir ToolId. */
const KNOWN_TOOLS = new Set<string>([
  'pen',
  'highlight',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'badge',
  'marker',
  'measure',
  'stamp',
  'laser',
  'ping',
  'spotlight',
  'magnifier',
  'freeze',
  'blur',
  'eraser',
])

const nombre = (v: unknown, defaut: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : defaut

/** Ne garde que les chronos réellement exploitables par la carte qui les rend. */
function chronosSains(v: unknown): StageClock[] {
  if (!Array.isArray(v)) return []
  const out: StageClock[] = []
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const c = e as Partial<StageClock>
    if (typeof c.id !== 'string' || c.id === '') continue
    out.push({
      id: c.id,
      kind: c.kind === 'countdown' ? 'countdown' : 'chrono',
      x: nombre(c.x, 80),
      y: nombre(c.y, 80),
      elapsed: Math.max(0, nombre(c.elapsed, 0)),
      // Une horloge relue est TOUJOURS à l'arrêt (voir partialize) : un
      // `startedAt` non numérique ne doit surtout pas devenir un NaN qui
      // ferait afficher « NaN:NaN » et tourner la boucle pour rien.
      startedAt: typeof c.startedAt === 'number' && Number.isFinite(c.startedAt) ? c.startedAt : null,
      duration: Math.max(0, nombre(c.duration, 60_000)),
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * ⚠️ LES QUATRE CLÉS QUE L'ASSAINISSEMENT INITIAL AVAIT OUBLIÉES.
 *
 * La note ci-dessus affirmait que `clocks` et `notes` étaient « les seules
 * valeurs persistées parcourues au rendu ». C'ÉTAIT FAUX, et mesuré comme tel
 * (campagne §S21, sur la vraie application) :
 *
 *   · keymapOverrides — LE PIRE. Toolbar.tsx appelle resolveKeymap() dans un
 *     useMemo, qui descend jusqu'à normalizeCombo() → `combo.split('+')`. La
 *     barre est montée EN PERMANENCE. Mesure s21-1 avec
 *     `{'edit.clear': 42}` : « n.split is not a function », puis
 *     scène false · barre false · 0 canevas · moteur false. C'est-à-dire
 *     L'OVERLAY ENTIÈREMENT VIDE AU LANCEMENT — le défaut historique, intact.
 *   · lexiconCategories / lexiconWords — SettingsPanel les parcourt
 *     (`.includes`, `.length`, `.join`) et le reconnaisseur d'écriture fait
 *     `[...o.categories]` et `o.perso.join('')`. Mesures s21-5/6/7/8 :
 *     « a.categories is not iterable », « null (reading 'join') »,
 *     « a.toUpperCase is not a function ». À chaque fois, l'ouverture des
 *     réglages emportait TOUTE l'application : barre false, scène false,
 *     0 px peints. En clair : le streamer ouvre ses réglages en direct et son
 *     overlay meurt, sans un mot, sans rien à l'écran.
 *   · customProfiles — ProfilesPanel fait `[...BUILTIN_PROFILES, ...custom]`.
 *     Mesures s21-9/10 : « undefined (reading 'fadeDelay') » et
 *     « null (reading 'id') », même issue.
 *
 * Et il n'y a AUCUN error boundary React dans le projet : une levée au rendu
 * démonte l'arbre entier, et la fenêtre étant transparente, il ne reste
 * littéralement rien à voir. D'où la même règle que pour clocks/notes : ce qui
 * n'a pas de sens se jette ici, une fois, plutôt que de faire tomber le rendu.
 * ------------------------------------------------------------------ */

/** Les identifiants de catégories de lexique qui existent réellement. */
const CATEGORIES_CONNUES = new Set<string>(CATEGORIES_DEFAUT)

/** Catégories de lexique : des identifiants connus, sans doublon. */
function categoriesSaines(v: unknown): CategorieId[] {
  if (!Array.isArray(v)) return [...CATEGORIES_DEFAUT]
  const out: CategorieId[] = []
  for (const c of v) {
    if (typeof c === 'string' && CATEGORIES_CONNUES.has(c) && !out.includes(c as CategorieId)) {
      out.push(c as CategorieId)
    }
  }
  return out
}

/** Mots personnels : des chaînes non vides, rien d'autre. */
function motsSains(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
}

/**
 * Un override de raccourci : une chaîne, une liste de chaînes, ou `null`
 * (raccourci volontairement retiré). Tout le reste part à la poubelle —
 * c'est la valeur qui faisait `split` sur un nombre et vidait la fenêtre.
 */
function raccourcisSains(v: unknown): Partial<Record<KeymapAction, string | string[] | null>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Partial<Record<KeymapAction, string | string[] | null>> = {}
  for (const [action, valeur] of Object.entries(v as Record<string, unknown>)) {
    if (valeur === null) out[action as KeymapAction] = null
    else if (typeof valeur === 'string') out[action as KeymapAction] = valeur
    else if (Array.isArray(valeur)) {
      // Une seule entrée douteuse suffirait à faire lever la barre : on ne
      // garde que les chaînes, et on jette l'entrée si rien ne survit.
      const propres = valeur.filter((c): c is string => typeof c === 'string')
      if (propres.length > 0) out[action as KeymapAction] = propres
    }
  }
  return out
}

/** Profils personnels : seuls ceux que le panneau saura afficher ET appliquer. */
function profilsSains(v: unknown): HexaProfile[] {
  if (!Array.isArray(v)) return []
  const out: HexaProfile[] = []
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const p = e as Partial<HexaProfile>
    if (typeof p.id !== 'string' || p.id === '') continue
    // `settings` est déréférencé sans garde par le panneau (`.fadeDelay`) :
    // un profil sans réglages est un profil qui fait tomber le rendu.
    const reglages = p.settings && typeof p.settings === 'object' ? p.settings : {}
    out.push({
      id: p.id,
      name: typeof p.name === 'string' && p.name !== '' ? p.name : p.id,
      description: typeof p.description === 'string' ? p.description : '',
      glyph: typeof p.glyph === 'string' && p.glyph !== '' ? p.glyph : makeGlyph(p.id),
      // Un profil relu n'est JAMAIS d'usine : les profils d'usine viennent du
      // code, pas du disque. Le prétendre laisserait supprimer un builtin.
      builtin: false,
      settings: reglages,
    })
  }
  return out
}

/** Idem pour les notes posées à l'écran. */
function notesSaines(v: unknown): StageNote[] {
  if (!Array.isArray(v)) return []
  const out: StageNote[] = []
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const n = e as Partial<StageNote>
    if (typeof n.id !== 'string' || n.id === '') continue
    out.push({
      id: n.id,
      x: nombre(n.x, 90),
      y: nombre(n.y, 130),
      text: typeof n.text === 'string' ? n.text : '',
      color: typeof n.color === 'string' && n.color !== '' ? n.color : COLORS[0],
    })
  }
  return out
}

/** paliers de la barre qui s'efface : jamais, 3 s, 5 s, 10 s */
export const TOOLBAR_FADE_STEPS = [0, 3, 5, 10]

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      tool: 'pen',
      color: COLORS[0],
      prevColor: COLORS[1],
      palette: 3,
      ghostPage: false,
      size: 6,
      fadeDelay: 4000,
      sparkles: true,
      smartShapes: true,
      guides: true,
      linkBadges: true,
      annotationsHidden: false,
      badgeContinuous: false,
      radialAllTools: false,
      handwriting: false,
      lexicon: true,
      lexiconCategories: [...CATEGORIES_DEFAUT],
      lexiconWords: [],
      theme: 'neon-nuit',
      onboarded: false,
      effectIntensity: 1,
      arrowPulse: false,
      spotlightRadius: 180,
      // §16.7 : aucun son par défaut, c'est une option qu'on choisit d'allumer
      sound: false,
      soundChosen: false,
      soundVolume: 0.6,
      settingsOpen: false,
      cheatsheetOpen: false,
      replayOpen: false,
      toolbarVisible: true,
      toolbarEdge: DEFAULT_DOCK.edge,
      toolbarOffset: DEFAULT_DOCK.offset,
      toolbarOrientation: 'auto',
      toolbarDisplayId: null,
      // Personne ne devrait avoir à découvrir un interrupteur pour que sa barre
      // d'outils cesse de partir dans son direct : c'est vrai dès le premier
      // lancement.
      hideUiFromCapture: true,
      ...OBS_DEFAULTS,
      keymapPreset: DEFAULT_PRESET,
      keymapPresetChosen: false,
      keymapOverrides: {},
      globalShortcutsOn: true,
      globalShortcutsChosen: false,
      profileId: DEFAULT_PROFILE_ID,
      customProfiles: [],
      gridMode: 'off',
      gridOpacity: 0.22,
      clocks: [],
      notes: [],
      pageIndex: 0,
      pageCount: 1,
      pageDupSeq: 0,
      pageDupFrom: 0,
      textPlate: true,
      // 5 s par défaut : assez long pour ne jamais s'effacer sous la main qui
      // cherche un bouton, assez court pour dégager l'image pendant qu'on parle.
      toolbarFade: 5,
      notice: { text: '', seq: 0 },
      setTool: (tool) => set({ tool }),
      // La précédente n'est mémorisée que si la couleur CHANGE : recliquer la
      // même pastille ne doit pas écraser le duo.
      setColor: (color) =>
        set((s) => (color === s.color ? { color } : { color, prevColor: s.color })),
      swapColor: () => set((s) => ({ color: s.prevColor, prevColor: s.color })),
      toggleGhostPage: () => set((s) => ({ ghostPage: !s.ghostPage })),
      setSize: (size) => set({ size }),
      setFadeDelay: (fadeDelay) => set({ fadeDelay }),
      cycleFade: () =>
        set((s) => ({
          fadeDelay: FADE_STEPS[(FADE_STEPS.indexOf(s.fadeDelay) + 1) % FADE_STEPS.length],
        })),
      toggleSparkles: () => set((s) => ({ sparkles: !s.sparkles })),
      toggleSmartShapes: () => set((s) => ({ smartShapes: !s.smartShapes })),
      toggleGuides: () => set((s) => ({ guides: !s.guides })),
      toggleLinkBadges: () => set((s) => ({ linkBadges: !s.linkBadges })),
      toggleAnnotationsHidden: () =>
        set((s) => ({ annotationsHidden: !s.annotationsHidden })),
      toggleBadgeContinuous: () => set((s) => ({ badgeContinuous: !s.badgeContinuous })),
      toggleRadialAllTools: () => set((s) => ({ radialAllTools: !s.radialAllTools })),
      toggleHandwriting: () => set((s) => ({ handwriting: !s.handwriting })),
      toggleLexicon: () => set((s) => ({ lexicon: !s.lexicon })),
      toggleLexiconCategory: (id) =>
        set((s) => ({
          lexiconCategories: s.lexiconCategories.includes(id)
            ? s.lexiconCategories.filter((c) => c !== id)
            : [...s.lexiconCategories, id],
        })),
      setLexiconWords: (words) => set({ lexiconWords: words }),
      setTheme: (theme) => set({ theme }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setEffectIntensity: (value) =>
        set({ effectIntensity: Math.min(1.4, Math.max(0.4, Math.round(value * 20) / 20)) }),
      toggleArrowPulse: () => set((s) => ({ arrowPulse: !s.arrowPulse })),
      setSpotlightRadius: (r) => set({ spotlightRadius: Math.min(500, Math.max(80, Math.round(r))) }),
      toggleSound: () => set((s) => ({ sound: !s.sound, soundChosen: true })),
      setSoundVolume: (v) => set({ soundVolume: Math.min(1, Math.max(0, v)) }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setCheatsheetOpen: (cheatsheetOpen) => set({ cheatsheetOpen }),
      setReplayOpen: (replayOpen) => set({ replayOpen }),
      setObs: (patch) => set(patch as Partial<UiState>),
      toggleToolbar: () => set((s) => ({ toolbarVisible: !s.toolbarVisible })),

      // ---- placement de la barre (src/ui/toolbar-dock.ts) ----
      setToolbarDock: (toolbarEdge, offset) =>
        set({ toolbarEdge, toolbarOffset: Math.min(1, Math.max(0, offset)) }),
      setToolbarOrientation: (toolbarOrientation) => set({ toolbarOrientation }),
      // Bascule explicite : on écrit l'orientation VOULUE, jamais 'auto', sinon
      // le clic ne ferait rien tant que le bord impose déjà cette orientation.
      toggleToolbarOrientation: () =>
        set((s) => ({
          toolbarOrientation:
            resolveOrientation(s.toolbarEdge, s.toolbarOrientation) === 'vertical'
              ? 'horizontal'
              : 'vertical',
        })),
      resetToolbarDock: () =>
        set({
          toolbarEdge: DEFAULT_DOCK.edge,
          toolbarOffset: DEFAULT_DOCK.offset,
          toolbarOrientation: 'auto',
          toolbarDisplayId: null,
          toolbarVisible: true,
        }),
      setToolbarDisplayId: (toolbarDisplayId) => set({ toolbarDisplayId }),
      setHideUiFromCapture: (hideUiFromCapture) => set({ hideUiFromCapture }),

      // ---- raccourcis clavier (source de vérité : src/keymap.ts) ----
      // Choisir son preset est un acte volontaire : on le mémorise pour ne
      // jamais le lui reprendre lors d'une future mise à jour (voir migrate).
      setKeymapPreset: (keymapPreset) => set({ keymapPreset, keymapPresetChosen: true }),
      setBinding: (action, combo) =>
        set((s) => ({ keymapOverrides: { ...s.keymapOverrides, [action]: combo } })),
      resetBinding: (action) =>
        set((s) => {
          const next = { ...s.keymapOverrides }
          delete next[action]
          return { keymapOverrides: next }
        }),
      resetAllBindings: () => set({ keymapOverrides: {} }),
      setGlobalShortcuts: (globalShortcutsOn) =>
        set({ globalShortcutsOn, globalShortcutsChosen: true }),

      // ---- profils d'usage (src/profiles.ts) ----
      applyProfile: (id) =>
        set((s) => {
          const profile = findProfile(id, s.customProfiles)
          if (!profile) return {}
          // On n'écrit que les réglages que le store connaît : un profil peut
          // décrire des options livrées par un module encore absent.
          const patch = pickKnownSettings(profile.settings, s as unknown as Record<string, unknown>)
          return { ...(patch as Partial<UiState>), profileId: id }
        }),
      saveCustomProfile: (name) =>
        set((s) => {
          const trimmed = name.trim() || 'Mon profil'
          const profile: HexaProfile = {
            id: makeProfileId(trimmed),
            name: trimmed,
            description: 'Profil personnel enregistré depuis les réglages du moment.',
            glyph: makeGlyph(trimmed),
            builtin: false,
            settings: snapshotSettings(s as unknown as Record<string, unknown>),
          }
          return { customProfiles: [...s.customProfiles, profile], profileId: profile.id }
        }),
      deleteCustomProfile: (id) =>
        set((s) => ({
          customProfiles: s.customProfiles.filter((p) => p.id !== id),
          profileId: s.profileId === id ? DEFAULT_PROFILE_ID : s.profileId,
        })),

      // ---- éléments posés à l'écran (§5.8 : grille, chronos, notes) ----
      setGridMode: (gridMode) => set({ gridMode }),
      cycleGrid: () =>
        set((s) => ({ gridMode: GRID_MODES[(GRID_MODES.indexOf(s.gridMode) + 1) % GRID_MODES.length] })),
      setGridOpacity: (v) =>
        set({ gridOpacity: Math.min(0.5, Math.max(0.04, Math.round(v * 100) / 100)) }),
      addClock: (clock) => set((s) => ({ clocks: [...s.clocks, clock] })),
      updateClock: (id, patch) =>
        set((s) => ({ clocks: s.clocks.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeClock: (id) => set((s) => ({ clocks: s.clocks.filter((c) => c.id !== id) })),
      addNote: (note) => set((s) => ({ notes: [...s.notes, note] })),
      updateNote: (id, patch) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
      removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      // ---- pages d'annotation ----
      // Bornées : PageDown sur la dernière page ne crée rien — créer une page
      // est un acte voulu (Ctrl+Maj+N, ou le témoin de la barre), sinon un
      // coach qui « regarde s'il y a une suite » se retrouve avec une page vide.
      nextPage: () => set((s) => ({ pageIndex: Math.min(s.pageCount - 1, s.pageIndex + 1) })),
      prevPage: () => set((s) => ({ pageIndex: Math.max(0, s.pageIndex - 1) })),
      newPage: () => set((s) => ({ pageCount: s.pageCount + 1, pageIndex: s.pageCount })),
      duplicatePage: () =>
        set((s) => ({
          pageCount: s.pageCount + 1,
          pageIndex: s.pageCount,
          pageDupFrom: s.pageIndex,
          pageDupSeq: s.pageDupSeq + 1,
        })),
      setPage: (index) =>
        set((s) => ({ pageIndex: Math.max(0, Math.min(s.pageCount - 1, Math.floor(index))) })),
      setTextPlate: (textPlate) => set({ textPlate }),
      setToolbarFade: (seconds) => set({ toolbarFade: Math.max(0, Math.min(60, seconds)) }),
      cycleToolbarFade: () =>
        set((s) => {
          const i = TOOLBAR_FADE_STEPS.indexOf(s.toolbarFade)
          return { toolbarFade: TOOLBAR_FADE_STEPS[(i + 1) % TOOLBAR_FADE_STEPS.length] }
        }),
      notify: (text) => set((s) => ({ notice: { text, seq: s.notice.seq + 1 } })),
    }),
    {
      name: 'hexa-ui',
      partialize: (s) => ({
        tool: s.tool,
        color: s.color,
        prevColor: s.prevColor,
        /** version de la palette — voir la migration dans `merge` */
        palette: s.palette,
        ghostPage: s.ghostPage,
        size: s.size,
        fadeDelay: s.fadeDelay,
        sparkles: s.sparkles,
        smartShapes: s.smartShapes,
        guides: s.guides,
        linkBadges: s.linkBadges,
        badgeContinuous: s.badgeContinuous,
        radialAllTools: s.radialAllTools,
        handwriting: s.handwriting,
        lexicon: s.lexicon,
        lexiconCategories: s.lexiconCategories,
        lexiconWords: s.lexiconWords,
        theme: s.theme,
        onboarded: s.onboarded,
        effectIntensity: s.effectIntensity,
        arrowPulse: s.arrowPulse,
        spotlightRadius: s.spotlightRadius,
        sound: s.sound,
        soundChosen: s.soundChosen,
        soundVolume: s.soundVolume,
        toolbarVisible: s.toolbarVisible,
        toolbarEdge: s.toolbarEdge,
        toolbarOffset: s.toolbarOffset,
        toolbarOrientation: s.toolbarOrientation,
        toolbarDisplayId: s.toolbarDisplayId,
        hideUiFromCapture: s.hideUiFromCapture,
        // réglages OBS (le mot de passe reste strictement local, comme le reste
        // du store : aucune télémétrie, aucun envoi, aucun journal)
        obsMirror: s.obsMirror,
        obsMode: s.obsMode,
        obsServerOn: s.obsServerOn,
        obsPort: s.obsPort,
        obsWsEnabled: s.obsWsEnabled,
        obsWsHost: s.obsWsHost,
        obsWsPort: s.obsWsPort,
        obsWsPassword: s.obsWsPassword,
        obsClearOnScene: s.obsClearOnScene,
        keymapPreset: s.keymapPreset,
        keymapPresetChosen: s.keymapPresetChosen,
        keymapOverrides: s.keymapOverrides,
        globalShortcutsOn: s.globalShortcutsOn,
        globalShortcutsChosen: s.globalShortcutsChosen,
        profileId: s.profileId,
        customProfiles: s.customProfiles,
        gridMode: s.gridMode,
        gridOpacity: s.gridOpacity,
        textPlate: s.textPlate,
        toolbarFade: s.toolbarFade,
        // Les notes sont persistantes au sens fort : on les retrouve au
        // prochain lancement, à leur place (§5.8.3).
        notes: s.notes,
        // Une horloge est toujours ENREGISTRÉE À L'ARRÊT, avec son cumul figé :
        // sans cela, un chrono oublié en marche afficherait douze heures au
        // lancement du lendemain.
        clocks: s.clocks.map((c): StageClock => ({
          ...c,
          elapsed: c.elapsed + (c.startedAt == null ? 0 : Math.max(0, Date.now() - c.startedAt)),
          startedAt: null,
        })),
      }),
      // v2 : le preset Epic Pen devient le clavier par défaut.
      version: 2,
      /**
       * Reprise d'un état déjà enregistré.
       *
       * ⚠️ `migrate` n'est PAS appelé par zustand quand l'état stocké n'a pas de
       * champ `version` — c'est le cas de toutes les installations d'Hexa
       * antérieures à cette version, donc du poste de l'utilisateur. `merge`,
       * lui, est appelé à chaque chargement : c'est ici que la règle vit.
       *
       * Règle : le preset par défaut du moment s'applique TANT QUE l'utilisateur
       * n'a pas choisi lui-même (drapeau posé par setKeymapPreset). Un choix
       * personnel n'est donc jamais écrasé, et une ancienne installation reçoit
       * le clavier Epic Pen sans rien perdre — ce preset garde AUSSI les touches
       * maison (P, S, E, C, H…) en second. Les remaps personnels, eux, sont
       * conservés tels quels.
       */
      merge: (persisted, current) => {
        const merged = { ...current, ...((persisted ?? {}) as Partial<UiState>) }
        // ⚠️ AVANT TOUT LE RESTE : les deux listes que le RENDU parcourt. Voir
        // chronosSains/notesSaines — c'est le garde qui empêche une fenêtre
        // entièrement vide au lancement suivant une configuration abîmée.
        merged.clocks = chronosSains(merged.clocks)
        merged.notes = notesSaines(merged.notes)
        /*
         * ⚠️ ET LES QUATRE AUTRES — voir le grand commentaire au-dessus de
         * `categoriesSaines`. `keymapOverrides` est le plus urgent des quatre :
         * il est lu par la BARRE, montée en permanence, donc son abîmement ne
         * se manifeste pas à l'ouverture d'un panneau mais AU LANCEMENT, par
         * une fenêtre transparente entièrement vide (mesure s21-1).
         */
        merged.keymapOverrides = raccourcisSains(merged.keymapOverrides)
        merged.lexiconCategories = categoriesSaines(merged.lexiconCategories)
        merged.lexiconWords = motsSains(merged.lexiconWords)
        merged.customProfiles = profilsSains(merged.customProfiles)
        /*
         * Les valeurs SCALAIRES que le moteur consomme directement. Elles ne
         * font pas lever le rendu — elles font pire à leur façon : elles
         * laissent une application qui a l'air normale et qui ne marche pas.
         * Mesuré (§S20) avec `size: -9999` : le stylo peignait un cheveu de
         * 951 pixels au lieu d'un trait de 11 800, sans le moindre message.
         * L'utilisateur en conclut que le stylo est cassé, en plein direct.
         */
        if (!Number.isFinite(merged.size)) merged.size = 6
        else merged.size = Math.min(18, Math.max(2, Math.round(merged.size)))
        // Le fondu : soit ∞ (null), soit une durée qui a du sens.
        if (merged.fadeDelay != null) {
          merged.fadeDelay = Number.isFinite(merged.fadeDelay)
            ? Math.min(60_000, Math.max(500, merged.fadeDelay))
            : null
        }
        if (typeof merged.color !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(merged.color)) {
          merged.color = COLORS[0]
        }
        // Le duo : une couleur précédente abîmée retomberait sur Tab en `set({ color: undefined })`
        // et la barre n'aurait plus aucune pastille active. Même règle que la couleur.
        if (typeof merged.prevColor !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(merged.prevColor)) {
          merged.prevColor = merged.color === COLORS[1] ? COLORS[0] : COLORS[1]
        }
        /*
         * PALETTE 3 : bleu clair et rouge en tête — les deux camps de League
         * of Legends, demandés comme couleurs par défaut. Un état enregistré
         * par une version antérieure porte une `palette` plus ancienne (ou
         * aucune) : s'il en était resté au duo par défaut d'alors — cyan et
         * magenta avant la palette 2, bleu soutenu et rouge avec elle — il
         * passe au duo bleu clair/rouge. Une couleur choisie exprès (vert,
         * jaune…) est conservée telle quelle.
         */
        const ancien = (persisted ?? {}) as { palette?: unknown; color?: unknown; prevColor?: unknown }
        if (ancien.palette !== 3) {
          const duosAnciens = [
            ['#00e5ff', '#ff2d95'],
            ['#2f7cff', '#ff3d3d'],
          ]
          const c = String(ancien.color)
          const p = ancien.prevColor === undefined ? null : String(ancien.prevColor)
          const restaitAuDuo = duosAnciens.some(
            ([a, b]) => (c === a && (p === null || p === b)) || (c === b && p === a),
          )
          if (ancien.color === undefined || restaitAuDuo) {
            merged.color = COLORS[0]
            merged.prevColor = COLORS[1]
          }
        }
        merged.palette = 3
        if (typeof merged.ghostPage !== 'boolean') merged.ghostPage = false
        // Un outil inconnu laisserait la barre sans bouton actif et le moteur
        // sans geste : on revient au pinceau, qui est toujours le bon repli.
        if (!KNOWN_TOOLS.has(merged.tool as string)) merged.tool = 'pen'
        // Les deux réglages « coach » relus du disque : un délai qui n'est pas
        // un nombre donnerait `setTimeout(NaN)` — une barre qui s'estompe
        // aussitôt — et un libellé « après cinq s » dans la barre ; une plaque
        // qui n'est pas un booléen se propagerait telle quelle jusqu'au champ
        // de saisie. Mesuré (sE-12) avec « cinq » / « oui » : relus tels quels.
        merged.toolbarFade = TOOLBAR_FADE_STEPS.includes(merged.toolbarFade as number)
          ? merged.toolbarFade
          : Number.isFinite(merged.toolbarFade)
            ? Math.min(60, Math.max(0, Math.round(merged.toolbarFade)))
            : 5
        merged.textPlate = merged.textPlate !== false
        if (!GRID_MODES.includes(merged.gridMode)) merged.gridMode = 'off'
        if (merged.keymapPresetChosen !== true) merged.keymapPreset = DEFAULT_PRESET
        // Même règle que pour le preset : le défaut du moment s'applique TANT
        // QUE l'utilisateur n'a pas actionné l'interrupteur lui-même. Une
        // installation existante récupère donc les raccourcis Epic Pen actifs
        // en jeu, et un « non » explicite n'est jamais réécrasé. Ce qui protégeait
        // vraiment YouTube et VLC — Ctrl+E et Ctrl+H rendus au système — vit
        // désormais dans NEVER_GLOBAL (src/keymap.ts), donc quel que soit l'état
        // de cet interrupteur.
        const p = (persisted ?? {}) as Partial<UiState> & {
          globalShortcutsChosen?: boolean
          soundChosen?: boolean
        }
        if (p.globalShortcutsChosen !== true) merged.globalShortcutsOn = true
        // Sons : coupés, sauf si l'utilisateur les a lui-même allumés. Le défaut
        // du code l'a toujours été (§16.7), mais une configuration écrite par une
        // version antérieure pouvait porter « activé » sans que personne ne l'ait
        // demandé — et un outil qui fait du bruit en plein direct est
        // insupportable. On rend donc le silence une bonne fois.
        if (p.soundChosen !== true) merged.sound = false
        // Placement de la barre : un état écrit par une version antérieure (ou
        // trafiqué à la main) ne doit JAMAIS pouvoir envoyer la barre hors champ.
        // Le bornage à l'écran réel est fait au rendu ; ici on garantit juste
        // que les valeurs ont un sens.
        if (!isEdge(merged.toolbarEdge)) merged.toolbarEdge = DEFAULT_DOCK.edge
        if (!Number.isFinite(merged.toolbarOffset))
          merged.toolbarOffset = DEFAULT_DOCK.offset
        else merged.toolbarOffset = Math.min(1, Math.max(0, merged.toolbarOffset))
        if (
          merged.toolbarOrientation !== 'auto' &&
          merged.toolbarOrientation !== 'vertical' &&
          merged.toolbarOrientation !== 'horizontal'
        )
          merged.toolbarOrientation = 'auto'
        /*
         * Les scalaires numériques restants. Leurs SETTERS bornent déjà —
         * mais un état relu ne passe par aucun setter, et c'est précisément
         * le chemin qu'emprunte une configuration abîmée.
         *
         * Aucun de ces quatre-là ne fait LEVER le rendu : ils font pire à leur
         * façon, ils dégradent en silence. Mesure s21-11 avant bornage, avec
         * `effectIntensity: 'beaucoup'` : le même trait peignait 9 243 px au
         * lieu de 11 896 — les halos avaient disparu, sans un mot. Le streamer
         * conclut que son pinceau a changé tout seul et ne trouve rien dans
         * les réglages, puisque le curseur, lui, affiche une valeur normale.
         *
         * On reprend exactement les bornes des setters correspondants, pour
         * qu'un état relu et un état réglé à la main donnent le même Hexa.
         */
        const borne = (v: unknown, min: number, max: number, defaut: number): number =>
          typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaut
        merged.effectIntensity = borne(merged.effectIntensity, 0.4, 1.4, 1)
        merged.spotlightRadius = Math.round(borne(merged.spotlightRadius, 80, 500, 180))
        merged.soundVolume = borne(merged.soundVolume, 0, 1, 0.6)
        merged.gridOpacity = borne(merged.gridOpacity, 0.04, 0.5, 0.22)
        return merged
      },
      /** Conservé pour les futures versions : sans lui, zustand jetterait l'état. */
      migrate: (persisted) => persisted as UiState,
    },
  ),
)
