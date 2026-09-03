/**
 * Pont renderer ↔ processus principal Electron.
 * En démo navigateur, toutes les fonctions sont des no-op : l'app reste testable partout.
 * Le preload Electron expose `window.hexa` (voir electron/preload.ts).
 */
/** Événements poussés par le processus principal vers la page. */
export interface BridgeEvents {
  /** raccourci global « mode dessin » : bascule demandée sur CET écran */
  'toggle-draw': () => void
  /** touche panique : tout effacer */
  'panic-clear': () => void
  /** état de mode dessin imposé par le main (ex. autre écran devenu actif) */
  'set-draw': (drawing: boolean) => void
  /** position du curseur pendant le Spike 0 (§14) */
  'spike-cursor': (point: { x: number; y: number }) => void
  /** « Réglages… » choisi dans le menu de l'icône près de l'horloge */
  'open-settings': () => void
  /**
   * Action déclenchée par un raccourci GLOBAL (Ctrl+Maj+3, Ctrl+E…) alors que
   * le jeu avait le focus. La charge utile est un identifiant d'action de
   * src/keymap.ts — typée `string` ici pour ne pas coupler le pont à la table.
   */
  action: (action: string) => void
  /**
   * Cet écran vient de devenir — ou de cesser d'être — L'ÉCRAN D'ANNOTATION.
   *
   * L'utilisateur le désigne dans le menu de l'icône système, et la topologie
   * peut le changer toute seule (écran débranché). Les couches des autres
   * écrans s'éteignent alors complètement : sans ça, le moteur du deuxième
   * écran continuait de recevoir les mouvements de souris et de tracer une
   * traînée que personne ne regardait — au prix fort pour OBS.
   */
  'ecran-annotation': (actif: boolean) => void
  /**
   * L'écran porteur a changé de taille, d'échelle (100 % → 125 %) ou de
   * rotation. Il faut recalibrer les canvas : leur fond de rendu est en pixels
   * PHYSIQUES et un changement d'échelle ne produit pas toujours d'événement
   * `resize` côté page (§12.3).
   */
  'display-changed': (info: HexaDisplayInfo) => void
  /**
   * « Replacer la barre d'outils » demandé depuis l'icône près de l'horloge
   * (§S4.3) : dernier recours quand la barre a fini hors champ.
   */
  'toolbar-reset': () => void
  /**
   * Patch d'état d'interface venu de L'AUTRE fenêtre (§S11 — séparation en deux
   * couches). Le processus principal ne fait que relayer : il ne renvoie jamais
   * un patch à son émetteur, ce qui interdit la boucle.
   */
  sync: (patch: Record<string, unknown>) => void
  /** État annoncé par la couche encre à la couche interface. */
  'etat-encre': (message: EtatEncre) => void
  /** la fenêtre clavier a perdu le focus : rejoué en `blur` sur la page */
  'clavier-perdu': () => void
  /** Commande adressée par la couche interface au moteur (couche encre). */
  commande: (message: CommandeEncre) => void
}

export type BridgeChannel = keyof BridgeEvents

/**
 * Ce que la barre d'outils demande au MOTEUR, qui vit désormais dans l'autre
 * fenêtre. Volontairement minuscule et fermé : un canal de commandes ouvert
 * serait une porte d'entrée dans le moteur.
 */
export type CommandeEncre =
  | { nom: 'undo' }
  | { nom: 'redo' }
  | { nom: 'clear' }
  | { nom: 'export' }
  | { nom: 'freeze' }
  | { nom: 'compare' }
  /** la roue s'est refermée côté interface : le moteur doit oublier le geste */
  | { nom: 'radial-close' }
  /** l'interface réclame un instantané de la session (panneau de réglages) */
  | { nom: 'session-get' }
  | { nom: 'session-load'; session: unknown }
  /**
   * L'interface réclame l'état de l'ARCHIVE de session (§11).
   *
   * L'enregistreur vit avec le moteur, donc dans la couche encre ; le panneau
   * de réglages, lui, est dans la fenêtre d'interface. Sans ce couple de
   * messages, le panneau affichait « 0 trait archivé » toute la session — et
   * l'avertissement « l'archive est pleine » ne s'affichait JAMAIS, alors que le
   * plafond évince réellement des traits.
   */
  | { nom: 'archive-etat' }
  /**
   * L'interface réclame la SESSION ARCHIVÉE elle-même, pour un export réel.
   *
   * Coûteux (un clone complet + une traversée IPC) : à n'envoyer qu'au clic sur
   * un bouton d'export, jamais à l'ouverture du panneau. `plat` demande la
   * variante « tout est vivant et terminé » utilisée par l'export PNG.
   */
  | { nom: 'archive-session'; plat: boolean }
  /**
   * « Rejouer CE fichier » : la session choisie dans les réglages est mise en
   * file d'attente du côté du moteur, qui est aussi celui de l'enregistreur et
   * de la barre de rejeu (§11).
   */
  | { nom: 'replay-queue'; session: unknown }

/** Ce que la couche encre annonce à la couche interface. */
export type EtatEncre =
  /** gel d'image et comparateur avant/après : les boutons doivent s'allumer */
  | { quoi: 'fx'; frozen: boolean; compare: boolean }
  /** clic droit maintenu dans le vide : la roue s'ouvre à ce point */
  | { quoi: 'radial'; x: number; y: number }
  /** le geste de la roue continue dans l'autre fenêtre (souris, relâché) */
  | { quoi: 'radial-move'; x: number; y: number }
  | { quoi: 'radial-up' }
  /** un geste vient d'avoir lieu : la découverte guidée valide son étape */
  | { quoi: 'tour'; signal: string }
  /**
   * Touche Fin MAINTENUE : la barre affiche le raccourci de chaque outil.
   *
   * La barre vit dans la couche interface, qui n'a JAMAIS le focus clavier
   * (§12.2 : un overlay focusable entre dans l'Alt+Tab et fait perdre des
   * parties). La frappe arrive donc dans la couche encre, et il faut la lui
   * relayer — sans quoi la touche ne fait rien du tout en mode deux fenêtres.
   */
  | { quoi: 'hints'; on: boolean }
  /** instantané de session, en réponse à { nom: 'session-get' } */
  | { quoi: 'session'; session: unknown }
  /** état de l'archive de session : compteur et traits évincés faute de place */
  | { quoi: 'archive'; traits: number; oublies: number }
  /** session archivée, en réponse à { nom: 'archive-session' } */
  | { quoi: 'archive-session'; session: unknown }

/**
 * Résultat de la demande de protection de contenu, pour le dire HONNÊTEMENT
 * dans les réglages : promettre une invisibilité qui n'existe pas serait le
 * pire service à rendre à quelqu'un qui est en direct.
 */
export interface ProtectionCapture {
  /** la protection a réellement été appliquée aux fenêtres d'interface */
  applique: boolean
  /** la plateforme sait-elle exclure une fenêtre des captures ? */
  supporte: boolean
  /** 'win32' | 'darwin' | 'linux' — pour l'explication affichée */
  plateforme: string
}

/** Infos de l'écran porteur : bounds logiques + facteur DPI (§12.3). */
export interface HexaDisplayInfo {
  id: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  primary: boolean
  /**
   * Cette fenêtre porte-t-elle la BARRE D'OUTILS (§S4.2) ?
   *
   * Il y a une fenêtre par écran et chacune monte l'interface complète : sans
   * ce drapeau, la barre s'afficherait sur TOUS les écrans, donc par-dessus ce
   * que les spectateurs regardent. Le processus principal en désigne un seul
   * (le plus à droite, sinon l'écran principal) et redit son choix par
   * 'display-changed' quand la topologie bouge.
   * Absent = démo navigateur : la barre s'affiche, évidemment.
   */
  toolbarHost?: boolean
}

/**
 * Raccourcis GLOBAUX à réserver auprès du système : identifiant d'action
 * (src/keymap.ts) → accélérateur Electron.
 * Ex. { 'mode.draw': 'F8', 'tool.pen': 'Control+Shift+3' }
 */
export type GlobalShortcuts = Record<string, string>

/** résultat d'une copie de l'adresse OBS : l'adresse, et si le presse-papiers l'a prise */
export interface AdresseObs {
  adresse: string
  copie: boolean
}

export interface HexaBridgeApi {
  /** écran porteur au moment de la création de la fenêtre (null en démo) */
  display: HexaDisplayInfo | null
  /**
   * Couche portée par cette fenêtre, déclarée par le processus principal
   * (§S11) : 'encre', 'interface', ou 'complet' quand les deux cohabitent
   * (mode fusionné). null en démo navigateur.
   */
  couche: string | null
  /** écran porteur relu à l'instant : seule valeur fiable après un changement
   *  de résolution ou de mise à l'échelle Windows */
  displayInfo(): Promise<HexaDisplayInfo | null>
  /** active/désactive le clic traversant (setIgnoreMouseEvents + forward) */
  setPassthrough(v: boolean): void
  /** signale au main process si la couche contient quelque chose d'actif —
   *  règle §2.5 du brief : fenêtre cachée quand vide = zéro coût compositeur */
  notifyActivity(active: boolean): void
  /** s'abonner à un canal du main process ; renvoie la fonction de désabonnement */
  on<K extends BridgeChannel>(channel: K, cb: BridgeEvents[K]): () => void
  /** capture d'écran de l'affichage courant (loupe, gel d'image, flou) */
  captureScreen(): Promise<string | null>
  /** id de source desktopCapturer pour getUserMedia (flux continu, §6.1) */
  getScreenSourceId(): Promise<string | null>
  /** (ré)enregistre les raccourcis globaux ; renvoie ce qui a été pris ou refusé */
  /**
   * Cet écran est-il l'écran d'annotation ? Valeur INITIALE : la suite arrive
   * par le canal 'ecran-annotation'. Vrai hors Electron et en démo navigateur
   * (un seul écran : tout est l'écran d'annotation).
   */
  ecranAnnotation: boolean
  /** version de l'application telle que le processus principal la connaît ('' en démo) */
  version: string
  /**
   * Copie l'adresse de la vue OBS (source « Navigateur ») dans le presse-papiers.
   * Sous Electron c'est le processus principal qui copie — fiable même quand
   * l'interface n'a pas le focus. Revient avec l'adresse, copiée ou non.
   */
  copierAdresseObs(): Promise<AdresseObs | null>
  /** un clic chez nous : reprendre le clavier s'il est parti ailleurs (voir electron/clavier.ts) */
  reprendreClavier(): void
  setShortcuts(map: GlobalShortcuts): Promise<unknown>
  /**
   * Niveau de privilège d'Hexa sous Windows. Décide si un raccourci global est
   * livré PENDANT une partie : un jeu lancé en administrateur retient les
   * touches d'un programme ordinaire (voir electron/elevation.ts).
   */
  privileges(): Promise<{ windows: boolean; eleve: boolean } | null>
  /** Relance Hexa en administrateur (Windows affiche sa demande de consentement). */
  relancerAdmin(): Promise<{ lance: boolean; raison?: string } | null>
  /** écrit une ligne dans le journal de diagnostic (hexa.log) */
  log(scope: string, message: string): void
  /** emplacement du journal, à montrer à l'utilisateur ('' en démo navigateur) */
  logPath(): Promise<string>
  /**
   * Dessine-t-on en ce moment sur cet écran ? (null en démo navigateur)
   * À demander au DÉMARRAGE de la couche : le mode n'est diffusé qu'à ses
   * changements, et une fenêtre relancée après une panne repartait sinon en
   * croyant qu'on dessinait, alors que l'utilisateur jouait.
   */
  modeDessin(): Promise<boolean | null>

  /* ---- séparation en deux couches (§S11) ---- */
  /** diffuse un patch d'état d'interface à l'autre fenêtre */
  pousserSynchro(patch: Record<string, unknown>): void
  /** la couche interface commande le moteur */
  envoyerCommande(commande: CommandeEncre): void
  /** la couche encre annonce un état à l'interface */
  annoncerEtatEncre(message: EtatEncre): void
  /**
   * La fenêtre interface devient cliquable (survol d'un bouton) ou redevient
   * traversante. Appelé UNIQUEMENT sur changement d'état.
   */
  setInterfaceCliquable(value: boolean): void
  /** un panneau est ouvert : la fenêtre interface accepte la frappe clavier */
  setInterfaceModale(value: boolean): void
  /**
   * Taille voulue pour la FENÊTRE d'interface (§S12).
   *
   * Un rectangle en pixels LOGIQUES, relatif à l'écran de la fenêtre : « réduis
   * ma fenêtre à ce cadre-là », le cadre de la barre d'outils quand elle est
   * seule à l'écran. `null` = « remets-moi en plein écran ».
   *
   * C'est LA mesure de performance de la vague : un calque transparent plein
   * écran coûte au compositeur à chaque image, même vide et à 0 % de processeur.
   * Réduit à la barre, il ne coûte plus rien — et l'utilisateur garde ses outils.
   */
  setInterfaceRect(rect: { x: number; y: number; width: number; height: number } | null): void
  /**
   * Masquer l'interface de Hexa dans les captures (OBS, Discord, impressions
   * d'écran). Renvoie ce qui a RÉELLEMENT été appliqué.
   */
  setProtectionCapture(on: boolean): Promise<ProtectionCapture | null>
}

declare global {
  interface Window {
    hexa?: Partial<HexaBridgeApi>
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.hexa

/**
 * Cet écran est-il l'écran d'annotation ?
 *
 * Priorité à `?annotation=0|1` dans l'adresse : c'est le point d'entrée des
 * campagnes de test et de la démo navigateur, sur le modèle de `?couche=`
 * (src/couches.ts). Sinon, la déclaration du processus principal, qui est le
 * seul à savoir quel écran l'utilisateur a désigné. Défaut VRAI : mieux vaut un
 * écran de trop qui annote qu'un utilisateur qui ne peut plus rien tracer.
 */
function lireEcranAnnotation(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const force = new URLSearchParams(window.location.search).get('annotation')
    if (force === '0') return false
    if (force === '1') return true
  } catch {
    /* adresse exotique : on continue */
  }
  return window.hexa?.ecranAnnotation !== false
}

export const bridge: HexaBridgeApi = {
  display: (typeof window !== 'undefined' && window.hexa?.display) || null,
  couche: (typeof window !== 'undefined' && window.hexa?.couche) || null,
  ecranAnnotation: lireEcranAnnotation(),
  version: (typeof window !== 'undefined' && window.hexa?.version) || '',
  copierAdresseObs: async () => {
    if (window.hexa?.copierAdresseObs) {
      const r = (await window.hexa.copierAdresseObs()) as AdresseObs | null
      return r && typeof r.adresse === 'string' ? { adresse: r.adresse, copie: !!r.copie } : null
    }
    // démo navigateur : la vue OBS est servie par le même serveur que la page
    const adresse = `${location.origin}/obs.html`
    try {
      await navigator.clipboard.writeText(adresse)
      return { adresse, copie: true }
    } catch {
      return { adresse, copie: false }
    }
  },
  reprendreClavier: () => window.hexa?.reprendreClavier?.(),
  displayInfo: async () => (window.hexa?.displayInfo ? window.hexa.displayInfo() : null),
  setPassthrough: (v) => window.hexa?.setPassthrough?.(v),
  notifyActivity: (active) => window.hexa?.notifyActivity?.(active),
  on: (channel, cb) => window.hexa?.on?.(channel, cb) ?? (() => undefined),
  captureScreen: async () => (window.hexa?.captureScreen ? window.hexa.captureScreen() : null),
  getScreenSourceId: async () =>
    window.hexa?.getScreenSourceId ? window.hexa.getScreenSourceId() : null,
  setShortcuts: async (map) =>
    window.hexa?.setShortcuts ? window.hexa.setShortcuts(map) : Promise.resolve(null),
  privileges: async () =>
    window.hexa?.privileges
      ? ((await window.hexa.privileges()) as { windows: boolean; eleve: boolean } | null)
      : null,
  relancerAdmin: async () =>
    window.hexa?.relancerAdmin
      ? ((await window.hexa.relancerAdmin()) as { lance: boolean; raison?: string } | null)
      : null,
  log: (scope, message) => window.hexa?.log?.(scope, message),
  logPath: async () => (window.hexa?.logPath ? window.hexa.logPath() : ''),
  modeDessin: async () => (window.hexa?.modeDessin ? window.hexa.modeDessin() : null),
  pousserSynchro: (patch) => window.hexa?.pousserSynchro?.(patch),
  envoyerCommande: (commande) => window.hexa?.envoyerCommande?.(commande),
  annoncerEtatEncre: (message) => window.hexa?.annoncerEtatEncre?.(message),
  setInterfaceCliquable: (value) => window.hexa?.setInterfaceCliquable?.(value),
  setInterfaceModale: (value) => window.hexa?.setInterfaceModale?.(value),
  setInterfaceRect: (rect) => window.hexa?.setInterfaceRect?.(rect),
  setProtectionCapture: async (on) =>
    window.hexa?.setProtectionCapture ? window.hexa.setProtectionCapture(on) : null,
}

/**
 * Une erreur de la page finit dans hexa.log, aux côtés des journaux du processus
 * principal. C'est ce qui permet de comprendre « ça ne marche pas » chez un
 * utilisateur qui n'ouvrira jamais une console de développement.
 * Aucun coût au repos : deux écouteurs passifs, rien de plus.
 */
if (isElectron && typeof window !== 'undefined') {
  /*
   * LE CLAVIER PASSE PAR UNE FENÊTRE OPAQUE (electron/clavier.ts) : cette page
   * n'a jamais le focus système, elle est en focus émulé. Deux conséquences :
   *  - quand la fenêtre clavier perd le focus (Alt+Tab, clic dans le jeu),
   *    aucun `blur` n'arrive ici de lui-même. On le rejoue, pour que les
   *    touches maintenues (laser, spotlight, rappels) se relâchent ;
   *  - un clic dans cette page doit RAMENER le clavier s'il est parti : une
   *    fenêtre transparente ne s'active pas au clic, c'est voulu.
   */
  bridge.on('clavier-perdu', () => window.dispatchEvent(new Event('blur')))
  window.addEventListener('pointerdown', () => bridge.reprendreClavier(), { capture: true, passive: true })
  window.addEventListener('error', (e) => {
    bridge.log('page', `erreur : ${e.message} (${e.filename}:${e.lineno})`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    bridge.log('page', `promesse rejetée : ${String(e.reason)}`)
  })
}

/**
 * LE NUMÉRO DE BUILD, LISIBLE. La fabrication GitHub numérote chaque version
 * 0.1.<numéro d'exécution> — celui-là même qui nomme la Release (« build 37 »).
 * L'utilisateur doit pouvoir le lire dans l'interface, sans ouvrir un menu :
 * c'est ce qui permet de savoir, en direct, si la version installée est bien
 * la dernière. Une version locale (0.1.0) ou une démo ('') n'en a pas.
 */
export function numeroBuild(version: string = bridge.version): number | null {
  const m = /^0\.1\.(\d+)$/.exec(version)
  return m && Number(m[1]) > 0 ? Number(m[1]) : null
}

/** « build 37 », sinon « v0.1.0 » (fabrication locale), sinon '' (démo) */
export function libelleBuild(version: string = bridge.version): string {
  if (!version) return ''
  const n = numeroBuild(version)
  return n != null ? `build ${n}` : `v${version}`
}

/** « v0.1.37 · build 37 » pour l'en-tête des réglages */
export function libelleVersion(version: string = bridge.version): string {
  if (!version) return ''
  const n = numeroBuild(version)
  return n != null ? `v${version} · build ${n}` : `v${version}`
}
