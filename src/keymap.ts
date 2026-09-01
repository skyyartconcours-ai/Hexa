/**
 * Hexa — table de raccourcis centralisée.
 *
 * UNE seule source de vérité pour tout le clavier de l'application : action,
 * combinaison par défaut, description en français, catégorie. Plus aucun
 * `if (e.key === 'p')` en dur ailleurs dans le code.
 *
 * Deux presets livrés :
 *  - « Hexa » : le clavier maison, pensé pour la main gauche pendant qu'on joue.
 *  - « Compatibilité Epic Pen » : pour ne pas avoir à réapprendre ses réflexes.
 *
 * Tout est remappable, et les conflits sont détectés (voir findConflicts).
 */

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export type KeymapAction =
  // outils de tracé
  | 'tool.pen'
  | 'tool.highlight'
  | 'tool.line'
  | 'tool.arrow'
  | 'tool.rect'
  | 'tool.ellipse'
  | 'tool.text'
  | 'tool.badge'
  | 'tool.marker'
  | 'tool.measure'
  | 'tool.stamp'
  | 'tool.blur'
  | 'tool.eraser'
  // outils momentanés (maintien de touche, §8.5)
  | 'hold.laser'
  | 'hold.spotlight'
  | 'hold.ping'
  | 'hold.magnifier'
  | 'hold.freeze'
  // couleurs
  | 'color.1'
  | 'color.2'
  | 'color.3'
  | 'color.4'
  | 'color.5'
  | 'color.6'
  | 'color.7'
  // édition
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.clear'
  | 'edit.deleteHovered'
  | 'edit.pin'
  | 'size.dec'
  | 'size.inc'
  | 'fade.cycle'
  | 'toggle.smartShapes'
  | 'toggle.guides'
  | 'toggle.linkBadges'
  | 'toggle.handwriting'
  // pages d'annotation (plan / réalité / comparaison)
  | 'page.next'
  | 'page.prev'
  | 'page.new'
  | 'page.dup'
  | 'page.ghost'
  // dévoilement pas à pas (tableau tactique)
  | 'reveal.toggle'
  | 'reveal.next'
  | 'reveal.prev'
  // duo de couleurs : la précédente revient d'une touche
  | 'color.swap'
  // export en un geste
  | 'export.png'
  // écran et cadrage (§5.7, §5.8)
  | 'fx.compare'
  | 'stage.grid'
  | 'stage.clock'
  | 'stage.note'
  // interface
  | 'ui.hideInk'
  | 'ui.toolbar'
  | 'ui.toolbar.orient'
  | 'ui.hints'
  | 'ui.settings'
  | 'ui.cheatsheet'
  | 'ui.close'
  // système (enregistrés côté Electron)
  | 'mode.draw'
  | 'mode.cursor'
  | 'app.panic'

export type KeymapCategory =
  | 'outils'
  | 'momentanes'
  | 'couleurs'
  | 'edition'
  | 'pages'
  | 'ecran'
  | 'interface'
  | 'systeme'

export const CATEGORY_LABELS: Record<KeymapCategory, string> = {
  outils: 'Outils',
  momentanes: 'Outils momentanés (maintien)',
  couleurs: 'Couleurs',
  edition: 'Édition',
  pages: 'Pages d’annotation',
  ecran: 'Écran et cadrage',
  interface: 'Interface',
  systeme: 'Système (raccourcis globaux)',
}

/**
 * Ordre d'affichage des catégories — UNE seule fois pour tout le projet.
 * L'éditeur, l'aide et la fiche imprimable en tenaient chacun une copie : trois
 * listes à mettre à jour pour une seule catégorie ajoutée, donc trois occasions
 * d'en oublier une.
 */
export const CATEGORY_ORDER: readonly KeymapCategory[] = [
  'outils',
  'momentanes',
  'couleurs',
  'edition',
  'pages',
  'ecran',
  'interface',
  'systeme',
]

export interface KeymapEntry {
  action: KeymapAction
  /** description courte affichée dans l'éditeur */
  label: string
  category: KeymapCategory
  /** true = l'action vit tant que la touche est maintenue (§8.5) */
  hold?: boolean
  /**
   * true = Hexa tente de l'enregistrer côté Electron via globalShortcut, donc
   * elle marche MÊME quand le jeu a le focus. Seules les combinaisons avec
   * modificateur (ou F6–F12) sont réellement confisquées au système : voir
   * `isRegistrableCombo`. Une lettre nue reste locale, sinon on volerait la
   * touche à tous les autres logiciels.
   */
  global?: boolean
  /** précision optionnelle affichée en petit sous le libellé */
  hint?: string
}

/** L'ordre de ce tableau est l'ordre d'affichage dans l'éditeur. */
export const KEYMAP_ENTRIES: readonly KeymapEntry[] = [
  { action: 'tool.pen', label: 'Pinceau', category: 'outils', global: true },
  { action: 'tool.highlight', label: 'Surligneur', category: 'outils', global: true },
  { action: 'tool.line', label: 'Ligne droite', category: 'outils', hint: 'Maj : angles de 15°' },
  { action: 'tool.arrow', label: 'Flèche', category: 'outils' },
  { action: 'tool.rect', label: 'Rectangle', category: 'outils' },
  { action: 'tool.ellipse', label: 'Ellipse', category: 'outils' },
  { action: 'tool.text', label: 'Texte', category: 'outils' },
  { action: 'tool.badge', label: 'Numéroteur', category: 'outils', hint: 'Pastilles 1, 2, 3…' },
  {
    action: 'tool.marker',
    label: 'Jalons',
    category: 'outils',
    global: true,
    hint: 'Des 1, 2, 3… posés SANS être reliés — le numéroteur, lui, trace le parcours',
  },
  { action: 'tool.measure', label: 'Règle de mesure', category: 'outils' },
  {
    action: 'tool.stamp',
    label: 'Tampon d’image',
    category: 'outils',
    hint: 'Ctrl+V colle directement une image du presse-papier',
  },
  {
    action: 'tool.blur',
    label: 'Masque flou',
    category: 'outils',
    hint: 'Cache une information à l’écran · appui court : bascule vers le pinceau',
  },
  { action: 'tool.eraser', label: 'Gomme', category: 'outils', global: true },

  // ⚠️ Ces quatre-là demandent le MODE DESSIN : ce sont des lettres nues, donc
  // des touches que Hexa ne confisque pas au système (voir isRegistrableCombo).
  // Pendant qu'on joue, le clavier part au jeu — il faut d'abord revenir au
  // dessin (F8, ou un outil en Ctrl+Maj+…, qui y ramène tout seul). Le dire ici
  // plutôt que de laisser l'utilisateur marteler une touche morte.
  {
    action: 'hold.laser',
    label: 'Laser',
    category: 'momentanes',
    hold: true,
    hint: 'Le trait s’efface derrière le curseur · demande le mode dessin',
  },
  {
    action: 'hold.spotlight',
    label: 'Spotlight',
    category: 'momentanes',
    hold: true,
    hint: 'Molette : rayon du disque · demande le mode dessin',
  },
  {
    action: 'hold.ping',
    label: 'Ping',
    category: 'momentanes',
    hold: true,
    hint: 'Un repère qui bat, posé sous le curseur',
  },
  {
    action: 'hold.magnifier',
    label: 'Loupe',
    category: 'momentanes',
    hold: true,
    hint: 'Molette : grossissement · la touche « gel » fige le disque sur place',
  },
  {
    action: 'hold.freeze',
    label: 'Gel d’image',
    category: 'momentanes',
    hold: true,
    hint: 'L’écran se fige, on annote la photo · appui court : bascule',
  },

  // Les couleurs sont nommées : « Couleur 4 » ne dit rien à personne, « Vert »
  // se retrouve d'un coup d'œil dans la liste comme dans la barre.
  { action: 'color.1', label: 'Couleur 1 · cyan', category: 'couleurs' },
  { action: 'color.2', label: 'Couleur 2 · magenta', category: 'couleurs' },
  { action: 'color.3', label: 'Couleur 3 · violet', category: 'couleurs' },
  { action: 'color.4', label: 'Couleur 4 · vert', category: 'couleurs' },
  { action: 'color.5', label: 'Couleur 5 · jaune', category: 'couleurs' },
  { action: 'color.6', label: 'Couleur 6 · orange', category: 'couleurs' },
  { action: 'color.7', label: 'Couleur 7 · blanc', category: 'couleurs' },

  { action: 'edit.undo', label: 'Annuler', category: 'edition', global: true },
  { action: 'edit.redo', label: 'Rétablir', category: 'edition' },
  {
    action: 'edit.clear',
    label: 'Tout effacer',
    category: 'edition',
    global: true,
    hint: 'Nettoie tous les écrans d’un coup',
  },
  {
    action: 'edit.deleteHovered',
    label: 'Supprimer l’annotation sous le curseur',
    category: 'edition',
    hint: 'Vise, appuie : le trait visé part seul, sans changer d’outil',
  },
  {
    action: 'edit.pin',
    label: 'Épingler / détacher l’annotation sous le curseur',
    category: 'edition',
    hint: 'Épinglée, elle survit à « tout effacer », au fondu, au changement de page et à Ctrl+Z · Ctrl + clic droit fait pareil',
  },
  {
    action: 'size.dec',
    label: 'Trait plus fin',
    category: 'edition',
    global: true,
    hint: 'La molette de la souris fait la même chose',
  },
  {
    action: 'size.inc',
    label: 'Trait plus épais',
    category: 'edition',
    global: true,
    hint: 'La molette de la souris fait la même chose',
  },
  {
    action: 'fade.cycle',
    label: 'Durée du fondu',
    category: 'edition',
    hint: '2 s → 4 s → 8 s → ∞',
  },
  {
    action: 'toggle.smartShapes',
    label: 'Formes intelligentes',
    category: 'edition',
    hint: 'Redresse le tracé à main levée (§4.1)',
  },
  { action: 'toggle.guides', label: 'Guides magnétiques', category: 'edition' },
  { action: 'toggle.linkBadges', label: 'Relier les pastilles numérotées', category: 'edition' },
  {
    action: 'toggle.handwriting',
    label: 'Mode écriture',
    category: 'edition',
    hint: 'Tes CAPITALES manuscrites sont retracées en typographie (§S3)',
  },

  {
    action: 'page.next',
    label: 'Page suivante',
    category: 'pages',
    hint: 'Chaque page garde ses annotations ; le fondu est suspendu sur les pages qu’on ne regarde pas',
  },
  { action: 'page.prev', label: 'Page précédente', category: 'pages' },
  {
    action: 'page.new',
    label: 'Nouvelle page',
    category: 'pages',
    hint: 'Une page vierge à la fin — les annotations épinglées y sont déjà',
  },
  {
    action: 'page.dup',
    label: 'Dupliquer la page',
    category: 'pages',
    hint: 'Le plan reste intact sur sa page, on montre « ce qui s’est passé » sur la copie',
  },
  {
    action: 'page.ghost',
    label: 'Calque fantôme',
    category: 'pages',
    hint: 'La page précédente en filigrane sous la courante : on dessine l’écart par-dessus',
  },
  {
    action: 'reveal.toggle',
    label: 'Dévoilement pas à pas',
    category: 'pages',
    hint: 'Tout se cache ; Espace révèle une annotation à la fois, dans l’ordre du tracé',
  },
  {
    action: 'reveal.next',
    label: 'Révéler la suivante',
    category: 'pages',
    hint: 'Pendant un dévoilement. La dernière révélée termine le mode',
  },
  { action: 'reveal.prev', label: 'Cacher la dernière révélée', category: 'pages' },
  {
    action: 'color.swap',
    label: 'Revenir à la couleur précédente',
    category: 'couleurs',
    hint: 'Bleu, rouge, bleu… chaque couleur garde sa propre numérotation',
  },
  {
    action: 'export.png',
    label: 'Exporter la page en image PNG transparente',
    category: 'edition',
    hint: 'Les annotations seules, sans le fond ni la barre — pour une miniature ou une VOD',
  },
  {
    action: 'fx.compare',
    label: 'Avant / après',
    category: 'ecran',
    hint: 'À gauche l’écran photographié, à droite le direct',
  },
  {
    action: 'stage.grid',
    label: 'Cadrage : grille et règle des tiers',
    category: 'ecran',
    hint: 'Molette sur le bouton de la barre : discrétion du tracé',
  },
  { action: 'stage.clock', label: 'Poser un chrono', category: 'ecran' },
  {
    action: 'stage.note',
    label: 'Poser une note',
    category: 'ecran',
    hint: 'Elle reste à l’écran, même après un « tout effacer »',
  },

  {
    action: 'ui.hideInk',
    label: 'Masquer / remontrer les annotations',
    category: 'interface',
    global: true,
  },
  { action: 'ui.toolbar', label: 'Afficher/masquer la barre', category: 'interface', global: true },
  {
    action: 'ui.toolbar.orient',
    label: 'Barre verticale / horizontale',
    category: 'interface',
    hint: 'La barre se retourne, et l’ancrage suit',
  },
  {
    action: 'ui.hints',
    label: 'Voir les raccourcis sur la barre',
    category: 'interface',
    hold: true,
    hint: 'MAINTENIR : chaque outil affiche son raccourci entre parenthèses',
  },
  { action: 'ui.settings', label: 'Réglages', category: 'interface' },
  {
    action: 'ui.cheatsheet',
    label: 'Aide',
    category: 'interface',
    hint: 'Les gestes, tout le clavier, le stream et le dépannage',
  },
  { action: 'ui.close', label: 'Fermer le panneau ouvert', category: 'interface' },

  {
    action: 'mode.draw',
    label: 'Mode dessin / mode jeu',
    category: 'systeme',
    global: true,
    hint: 'Bascule. Évite F1–F5 : ce sont les sorts alliés dans League of Legends',
  },
  {
    action: 'mode.cursor',
    label: 'Curseur : rendre la souris au jeu',
    category: 'systeme',
    global: true,
    hint: 'L’équivalent de l’outil « curseur » d’Epic Pen',
  },
  {
    action: 'app.panic',
    label: 'Touche panique (tout effacer)',
    category: 'systeme',
    global: true,
    hint: 'Fonctionne même quand le jeu a le focus',
  },
]

export const KEYMAP_BY_ACTION: Record<KeymapAction, KeymapEntry> = Object.fromEntries(
  KEYMAP_ENTRIES.map((e) => [e.action, e]),
) as Record<KeymapAction, KeymapEntry>

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

export type KeymapPresetId = 'hexa' | 'epicpen'

/** Une action peut avoir plusieurs combinaisons (ex. Ctrl+Y et Ctrl+Maj+Z). */
export type Bindings = Partial<Record<KeymapAction, string | string[]>>
export type ResolvedBindings = Record<KeymapAction, string[]>

export interface KeymapPreset {
  id: KeymapPresetId
  name: string
  description: string
  /** preset dont on hérite avant d'appliquer ses propres combinaisons */
  extends?: KeymapPresetId
  bindings: Bindings
}

/** Preset maison — reproduit exactement le clavier historique d'Hexa. */
const HEXA_BINDINGS: Bindings = {
  'tool.pen': 'p',
  'tool.highlight': 's',
  'tool.line': 'l',
  'tool.arrow': 'f',
  'tool.rect': 'r',
  'tool.ellipse': 'o',
  'tool.text': 't',
  'tool.badge': 'n',
  'tool.marker': 'y',
  'tool.measure': 'm',
  'tool.stamp': 'i',
  'tool.blur': 'b',
  'tool.eraser': 'e',

  'hold.laser': 'z',
  'hold.spotlight': 'x',
  'hold.ping': 'q',
  'hold.magnifier': 'a',
  'hold.freeze': 'v',

  'color.1': '1',
  'color.2': '2',
  'color.3': '3',
  'color.4': '4',
  'color.5': '5',
  'color.6': '6',
  'color.7': '7',

  'edit.undo': 'ctrl+z',
  'edit.redo': ['ctrl+y', 'ctrl+shift+z'],
  'edit.clear': 'c',
  // Ctrl+D est volontairement LOCAL (il n'est pas marqué « global ») : c'est le
  // « ajouter un favori » de tous les navigateurs, et le confisquer au système
  // le retirerait à Chrome, à Firefox et à YouTube. En mode dessin — le seul
  // moment où l'on supprime une annotation — il nous revient de toute façon.
  'edit.deleteHovered': 'ctrl+d',
  // Même logique que Ctrl+D : local (en mode dessin), jamais confisqué au
  // système — Ctrl+Maj+P appartient aux navigateurs (impression système).
  'edit.pin': 'ctrl+shift+p',
  'size.dec': '[',
  'size.inc': ']',
  'fade.cycle': 'd',
  'toggle.smartShapes': 'w',
  'toggle.guides': 'g',
  'toggle.linkBadges': 'k',
  'toggle.handwriting': 'j',

  'fx.compare': 'u',
  // PAGES — Page ↑ / Page ↓ : les touches de la présentation, à l'écart des
  // lettres du dessin et des sorts de League of Legends. Créer et dupliquer
  // demandent Ctrl+Maj : on ne fabrique pas une page par accident.
  'page.next': 'pagedown',
  'page.prev': 'pageup',
  'page.new': 'ctrl+shift+n',
  'page.dup': 'ctrl+shift+d',
  'page.ghost': 'ctrl+shift+f',
  // Espace : la touche du présentateur. Nue, donc jamais confisquée au système,
  // et sans effet hors dévoilement.
  'reveal.toggle': 'ctrl+shift+r',
  'reveal.next': 'space',
  'reveal.prev': 'shift+space',
  // Tab : le « X » de Photoshop — l'échange de deux couleurs, sous le doigt.
  'color.swap': 'tab',
  // Export image en un geste : local, comme tous les Ctrl+lettre.
  'export.png': 'ctrl+shift+e',
  // §5.8 — éléments posés à l'écran. Volontairement à l'écart des réflexes
  // Epic Pen (Ctrl+Maj+2…8) et des lettres nues : on ne pose pas un chrono par
  // accident en pleine partie.
  'stage.grid': 'ctrl+shift+g',
  'stage.clock': 'ctrl+shift+y',
  'stage.note': 'ctrl+shift+b',

  // Masquer / remontrer TOUTES les annotations sans rien perdre.
  'ui.hideInk': 'ctrl+shift+m',
  'ui.toolbar': 'h',
  'ui.toolbar.orient': 'ctrl+shift+h',
  // « Fin » : touche isolée, à l'écart de tout ce qu'un jeu utilise, et que
  // personne n'atteint par accident en pleine partie de League of Legends.
  // MAINTENUE, elle révèle le raccourci de chaque outil sur la barre.
  'ui.hints': 'end',
  'ui.settings': 'ctrl+,',
  // « ? » : sur un clavier français il s'obtient avec Maj+, — sur un QWERTY
  // avec Maj+/. On accepte les deux, la touche d'aide doit marcher partout.
  'ui.cheatsheet': ['shift+,', 'shift+/'],
  'ui.close': 'esc',

  'mode.draw': 'f8',
  // « Rendre la souris au jeu » DOIT avoir une touche dans les deux presets :
  // sans elle, le clavier maison n'offrait aucun moyen direct de sortir du mode
  // dessin autre que la bascule F8 — et l'aide affichait « aucune touche » en
  // face de la carte « Rendre la souris au jeu ». On reprend la combinaison
  // d'Epic Pen : elle ne gêne rien et ne change pas d'un preset à l'autre.
  'mode.cursor': 'ctrl+shift+2',
  'app.panic': 'ctrl+shift+x',
}

/**
 * Preset « Compatibilité Epic Pen » — LE PRESET PAR DÉFAUT.
 *
 * Quelqu'un qui arrive d'Epic Pen doit pouvoir dessiner à la seconde où Hexa
 * démarre, sans rien réapprendre : sa mémoire musculaire est le vrai produit.
 *
 * ⚠️ Ces combinaisons proviennent de la documentation publique d'Epic Pen
 * (source tierce, non vérifiable hors ligne) : elles sont fournies pour
 * retrouver ses réflexes, et TOUTES remappables depuis l'éditeur.
 *
 * Chaque ligne garde EN SECOND la touche maison d'Hexa : basculer de preset ne
 * fait donc jamais perdre un raccourci, il en ajoute.
 * Le reste du clavier (couleurs, formes, fondu…) hérite du preset Hexa.
 */
const EPICPEN_BINDINGS: Bindings = {
  // outils — Ctrl+Maj+3/4/5 comme Epic Pen
  'tool.pen': ['ctrl+shift+3', 'p'],
  'tool.highlight': ['ctrl+shift+4', 's'],
  'tool.eraser': ['ctrl+shift+5', 'e'],
  // Les jalons prolongent la série des doigts d'Epic Pen là où elle s'arrête.
  'tool.marker': ['ctrl+shift+9', 'y'],
  // édition
  'edit.undo': ['ctrl+shift+6', 'ctrl+z'],
  'edit.clear': ['ctrl+e', 'c'],
  // épaisseur du trait : Epic Pen la règle depuis sa barre ; on prolonge la
  // série Ctrl+Maj+7/8 pour rester dans la même logique de doigts.
  'size.dec': ['ctrl+shift+7', '['],
  'size.inc': ['ctrl+shift+8', ']'],
  // interface
  'ui.toolbar': ['ctrl+h', 'h'],
  // système : chez Epic Pen, Ctrl+Maj+2 sélectionne l'outil « curseur »,
  // c'est-à-dire qu'il rend la souris au jeu. F8 reste la bascule maison.
  'mode.cursor': ['ctrl+shift+2'],
  'mode.draw': ['f8'],
}

/** Le preset par défaut est le PREMIER : c'est celui que l'œil lit en premier. */
export const KEYMAP_PRESETS: readonly KeymapPreset[] = [
  {
    id: 'epicpen',
    name: 'Epic Pen',
    description:
      'Par défaut. Reprend les combinaisons d’Epic Pen (Ctrl+Maj+2/3/4/5/6, Ctrl+E, Ctrl+H) en gardant celles d’Hexa en second.',
    extends: 'hexa',
    bindings: EPICPEN_BINDINGS,
  },
  {
    id: 'hexa',
    name: 'Hexa',
    description: 'Le clavier maison : une lettre par outil, tout sous la main gauche.',
    bindings: HEXA_BINDINGS,
  },
]

/**
 * PAR DÉFAUT : Epic Pen. Demande explicite et répétée : « les raccourcis Epic
 * Pen par défaut, customisable ». Ce preset étant un sur-ensemble du clavier
 * maison, personne n'y perd une touche.
 */
export const DEFAULT_PRESET: KeymapPresetId = 'epicpen'

function presetById(id: KeymapPresetId): KeymapPreset {
  return KEYMAP_PRESETS.find((p) => p.id === id) ?? KEYMAP_PRESETS[0]
}

function asList(value: string | string[] | null | undefined): string[] {
  if (value == null) return []
  return (Array.isArray(value) ? value : [value]).map(normalizeCombo).filter((c) => c.length > 0)
}

/**
 * Fusionne preset (+ héritage) et personnalisations utilisateur.
 * Une entrée d'override à `null` = raccourci volontairement retiré.
 */
export function resolveKeymap(
  presetId: KeymapPresetId,
  overrides?: Partial<Record<KeymapAction, string | string[] | null>>,
): ResolvedBindings {
  const preset = presetById(presetId)
  const merged: Bindings = {}
  if (preset.extends) Object.assign(merged, presetById(preset.extends).bindings)
  Object.assign(merged, preset.bindings)

  const out = {} as ResolvedBindings
  for (const entry of KEYMAP_ENTRIES) {
    const custom = overrides ? overrides[entry.action] : undefined
    out[entry.action] = custom === undefined ? asList(merged[entry.action]) : asList(custom)
  }
  return out
}

/** Table inversée combinaison → action, pour une résolution en O(1) au clavier. */
export function buildLookup(bindings: ResolvedBindings): Map<string, KeymapAction> {
  const map = new Map<string, KeymapAction>()
  for (const entry of KEYMAP_ENTRIES) {
    for (const combo of bindings[entry.action]) {
      if (!map.has(combo)) map.set(combo, entry.action)
    }
  }
  return map
}

/** Actions qui se disputent la même combinaison. */
export function findConflicts(bindings: ResolvedBindings): Map<string, KeymapAction[]> {
  const byCombo = new Map<string, KeymapAction[]>()
  for (const entry of KEYMAP_ENTRIES) {
    for (const combo of bindings[entry.action]) {
      const list = byCombo.get(combo)
      if (list) list.push(entry.action)
      else byCombo.set(combo, [entry.action])
    }
  }
  const conflicts = new Map<string, KeymapAction[]>()
  for (const [combo, actions] of byCombo) if (actions.length > 1) conflicts.set(combo, actions)
  return conflicts
}

/* ------------------------------------------------------------------ *
 * Normalisation des combinaisons
 * ------------------------------------------------------------------ */

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const

const CODE_MAP: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Escape: 'esc',
  Space: 'space',
  Tab: 'tab',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const KEY_MAP: Record<string, string> = {
  escape: 'esc',
  ' ': 'space',
  spacebar: 'space',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  del: 'delete',
}

/** Nom canonique d'une touche depuis `event.code` (position physique). */
function tokenFromCode(code: string): string | null {
  if (!code) return null
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase()
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  const numpad = /^Numpad(\d)$/.exec(code)
  if (numpad) return `num${numpad[1]}`
  const fkey = /^F(\d{1,2})$/.exec(code)
  if (fkey) return `f${fkey[1]}`
  return CODE_MAP[code] ?? null
}

/** Nom canonique d'une touche depuis `event.key` (caractère produit). */
function tokenFromKey(key: string): string | null {
  if (!key) return null
  const lower = key.toLowerCase()
  if (KEY_MAP[lower]) return KEY_MAP[lower]
  if (/^f\d{1,2}$/.test(lower)) return lower
  if (lower.length === 1) return lower
  if (['control', 'alt', 'shift', 'meta', 'os', 'altgraph'].includes(lower)) return null
  return lower
}

/** Met une combinaison écrite à la main sous forme canonique (`Ctrl+Maj+X` → `ctrl+shift+x`). */
export function normalizeCombo(combo: string): string {
  if (!combo) return ''
  const parts = combo
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  const mods = new Set<string>()
  let key = ''
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control' || p === 'cmdorctrl') mods.add('ctrl')
    else if (p === 'alt' || p === 'option') mods.add('alt')
    else if (p === 'shift' || p === 'maj') mods.add('shift')
    else if (p === 'meta' || p === 'cmd' || p === 'super' || p === 'win') mods.add('meta')
    else key = KEY_MAP[p] ?? p
  }
  if (!key) return ''
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+')
}

function modifierPrefix(e: KeyboardEvent): string[] {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  if (e.metaKey) mods.push('meta')
  return mods
}

/**
 * Toutes les écritures possibles de l'événement.
 * On teste la touche PHYSIQUE et le CARACTÈRE produit : c'est ce qui fait
 * marcher Ctrl+Maj+3 sur un clavier AZERTY (où Maj+3 produit un « " ») aussi
 * bien que « p » sur un QWERTY.
 */
export function eventCombos(e: KeyboardEvent): string[] {
  const mods = modifierPrefix(e)
  const out: string[] = []
  for (const token of [tokenFromCode(e.code), tokenFromKey(e.key)]) {
    if (!token) continue
    const combo = [...mods, token].join('+')
    if (!out.includes(combo)) out.push(combo)
    // Un symbole obtenu avec Maj (ex. « ] » sur certains claviers) doit aussi
    // matcher une liaison écrite sans Maj.
    if (e.shiftKey && token.length === 1 && !/[a-z0-9]/.test(token)) {
      const bare = [...mods.filter((m) => m !== 'shift'), token].join('+')
      if (!out.includes(bare)) out.push(bare)
    }
  }
  return out
}

/** Action correspondant à un événement clavier, ou null. */
export function matchAction(
  lookup: Map<string, KeymapAction>,
  e: KeyboardEvent,
): { action: KeymapAction; combo: string } | null {
  for (const combo of eventCombos(e)) {
    const action = lookup.get(combo)
    if (action) return { action, combo }
  }
  return null
}

/**
 * Combinaison à ENREGISTRER pour un événement capturé dans l'éditeur.
 * On privilégie la touche physique : c'est la seule stable d'un clavier à l'autre.
 * Renvoie null tant que l'utilisateur n'appuie que sur des modificateurs.
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const token = tokenFromCode(e.code) ?? tokenFromKey(e.key)
  if (!token) return null
  return [...modifierPrefix(e), token].join('+')
}

/* ------------------------------------------------------------------ *
 * Affichage
 * ------------------------------------------------------------------ */

const DISPLAY_MODS: Record<string, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Maj',
  meta: 'Cmd',
}

const DISPLAY_KEYS: Record<string, string> = {
  esc: 'Échap',
  space: 'Espace',
  enter: 'Entrée',
  backspace: 'Retour',
  delete: 'Suppr',
  tab: 'Tab',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  pageup: 'Page ↑',
  pagedown: 'Page ↓',
  home: 'Début',
  end: 'Fin',
  insert: 'Inser',
}

/** Rendu lisible d'une combinaison : `ctrl+shift+3` → `Ctrl + Maj + 3`. */
export function formatCombo(combo: string): string {
  if (!combo) return '—'
  return combo
    .split('+')
    .map((part) => {
      if (DISPLAY_MODS[part]) return DISPLAY_MODS[part]
      if (DISPLAY_KEYS[part]) return DISPLAY_KEYS[part]
      if (/^f\d{1,2}$/.test(part)) return part.toUpperCase()
      if (/^num\d$/.test(part)) return `Pavé ${part.slice(3)}`
      return part.length === 1 ? part.toUpperCase() : part
    })
    .join(' + ')
}

/** Traduction vers le format des accélérateurs Electron (globalShortcut). */
export function toAccelerator(combo: string): string {
  const parts = normalizeCombo(combo).split('+')
  const out: string[] = []
  for (const part of parts) {
    if (part === 'ctrl') out.push('Control')
    else if (part === 'alt') out.push('Alt')
    else if (part === 'shift') out.push('Shift')
    else if (part === 'meta') out.push('Super')
    else if (/^f\d{1,2}$/.test(part)) out.push(part.toUpperCase())
    else if (part === 'esc') out.push('Escape')
    else if (part === 'space') out.push('Space')
    else if (part === 'up' || part === 'down' || part === 'left' || part === 'right')
      out.push(part[0].toUpperCase() + part.slice(1))
    else if (/^num\d$/.test(part)) out.push(`num${part.slice(3)}`)
    else out.push(part.toUpperCase())
  }
  return out.join('+')
}

/* ------------------------------------------------------------------ *
 * Raccourcis GLOBAUX (enregistrés par Electron)
 * ------------------------------------------------------------------ */

/**
 * Actions qu'Hexa tente de confisquer au système. On annote PAR-DESSUS un jeu :
 * si la combinaison ne marche que quand notre fenêtre a le focus, elle ne sert
 * à rien. Dérivé de la table : `global: true` est la seule source de vérité.
 */
export const GLOBAL_ACTIONS: readonly KeymapAction[] = KEYMAP_ENTRIES.filter((e) => e.global).map(
  (e) => e.action,
)

/**
 * Combinaisons qu'on n'a PAS le droit de confisquer au système : ce sont les
 * réflexes universels. `RegisterHotKey` de Windows est EXCLUSIF — un raccourci
 * global est pris à toutes les autres applications, jamais partagé. Confisquer
 * Ctrl+Z, ce serait casser l'annulation dans Word, Photoshop et le navigateur
 * de l'utilisateur : le genre de dégât qui fait désinstaller un logiciel.
 *
 * Ctrl+E et Ctrl+H sont dans la liste POUR LA MÊME RAISON, et c'est un retour
 * d'usage réel : Ctrl+E ouvre la recherche de la barre d'adresse et Ctrl+H
 * l'historique dans tous les navigateurs, et l'utilisateur commente aussi des
 * vidéos sur YouTube et VLC. Tant qu'Hexa les tenait, ces touches ne leur
 * arrivaient plus du tout.
 *
 * Toutes restent PARFAITEMENT actives dans Hexa, simplement en local — donc dès
 * que le mode dessin est allumé, qui est le seul moment où l'on annote. Pour
 * nettoyer l'écran pendant que le jeu a le focus, c'est la touche panique
 * (Ctrl+Maj+X), globale en permanence.
 */
const NEVER_GLOBAL = new Set([
  'ctrl+z',
  'ctrl+y',
  'ctrl+c',
  'ctrl+v',
  'ctrl+x',
  'ctrl+a',
  'ctrl+s',
  'ctrl+p',
  'ctrl+f',
  'ctrl+w',
  'ctrl+n',
  'ctrl+t',
  'ctrl+e',
  'ctrl+h',
])

/**
 * Cette combinaison est-elle volontairement laissée au système ? L'interface
 * s'en sert pour expliquer POURQUOI une ligne n'est pas réservée auprès de
 * Windows — « pas de modificateur » et « on refuse de te la voler » sont deux
 * raisons très différentes, et l'utilisateur a le droit de savoir laquelle.
 */
export function isNeverGlobal(combo: string): boolean {
  return NEVER_GLOBAL.has(normalizeCombo(combo))
}

/**
 * Une combinaison peut-elle être enregistrée au niveau du SYSTÈME sans nuire ?
 *
 * Règle de sécurité : il faut un vrai modificateur (Ctrl, Alt ou Windows). Une
 * lettre nue enregistrée globalement serait volée à Word, au chat Twitch et au
 * jeu lui-même — c'est inacceptable. Les touches de fonction F6 à F12 passent
 * seules (F1–F5 restent les sorts alliés de League of Legends).
 */
export function isRegistrableCombo(combo: string): boolean {
  const c = normalizeCombo(combo)
  const parts = c.split('+').filter(Boolean)
  if (parts.length === 0) return false
  if (NEVER_GLOBAL.has(c)) return false
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (mods.includes('ctrl') || mods.includes('alt') || mods.includes('meta')) return true
  return /^f([6-9]|1[0-2])$/.test(key)
}

/**
 * Accélérateurs Electron à enregistrer : action → accélérateur.
 * On garde la PREMIÈRE combinaison enregistrable de chaque action (les autres
 * restent gérées par la page, quand elle a le focus).
 */
export function globalAccelerators(
  bindings: ResolvedBindings,
): Partial<Record<KeymapAction, string>> {
  const out: Partial<Record<KeymapAction, string>> = {}
  const taken = new Set<string>()
  for (const action of GLOBAL_ACTIONS) {
    for (const combo of bindings[action]) {
      if (!isRegistrableCombo(combo)) continue
      const accel = toAccelerator(combo)
      // Deux actions sur la même combinaison : la première gagne, sinon
      // globalShortcut.register refuserait la seconde en silence.
      if (taken.has(accel)) continue
      taken.add(accel)
      out[action] = accel
      break
    }
  }
  return out
}

/** Accélérateurs par défaut (preset Epic Pen), pour le tout premier démarrage. */
export function defaultGlobalAccelerators(): Partial<Record<KeymapAction, string>> {
  return globalAccelerators(resolveKeymap(DEFAULT_PRESET))
}

/* ------------------------------------------------------------------ *
 * Sécurité d'usage : combinaisons refusées ou déconseillées
 * ------------------------------------------------------------------ */

export interface ComboRisk {
  /** 'refus' = Hexa n'assigne pas ; 'attention' = on assigne mais on prévient */
  level: 'refus' | 'attention'
  message: string
}

/**
 * Combinaisons que Windows garde pour lui et qui feraient des dégâts : les
 * assigner ne servirait à rien (le système les intercepte avant nous) et
 * pourrait fermer l'application en plein direct.
 */
const FORBIDDEN: Record<string, string> = {
  'alt+f4': 'Alt+F4 ferme la fenêtre active : Windows la garde pour lui.',
  'ctrl+alt+delete': 'Ctrl+Alt+Suppr appartient à Windows et ne peut pas être intercepté.',
  'ctrl+shift+esc': 'Ctrl+Maj+Échap ouvre le gestionnaire des tâches de Windows.',
  'alt+tab': 'Alt+Tab est la bascule de fenêtres de Windows.',
  'meta+tab': 'Windows+Tab ouvre l’affichage des tâches.',
  'alt+esc': 'Alt+Échap appartient au gestionnaire de fenêtres.',
  'meta+l': 'Windows+L verrouille la session : ton direct s’arrêterait net.',
  'meta+d': 'Windows+D réduit toutes les fenêtres.',
  'ctrl+alt+backspace': 'Combinaison réservée par le système.',
}

/**
 * Verdict sur une combinaison qu'on s'apprête à assigner.
 * `global` : l'action est censée marcher même hors focus (raccourci système).
 */
export function comboSafety(combo: string, global = false): ComboRisk | null {
  const c = normalizeCombo(combo)
  if (!c) return null
  const forbidden = FORBIDDEN[c]
  if (forbidden) return { level: 'refus', message: forbidden }

  const parts = c.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)

  if (/^f[1-5]$/.test(key)) {
    return {
      level: 'attention',
      message: 'F1 à F5 sont les sorts alliés dans League of Legends : à éviter en jeu.',
    }
  }
  if (mods.includes('meta')) {
    return {
      level: 'attention',
      message:
        'Windows garde la main sur la plupart des combinaisons Windows+… : elle peut ne jamais arriver jusqu’à Hexa.',
    }
  }
  if (global && NEVER_GLOBAL.has(c)) {
    return {
      level: 'attention',
      message:
        'Hexa refuse de confisquer cette combinaison à tout ton ordinateur : elle casserait Word, ton navigateur ou VLC. Elle marchera donc quand Hexa a le focus, c’est-à-dire en mode dessin.',
    }
  }
  if (global && !isRegistrableCombo(c)) {
    return {
      level: 'attention',
      message:
        'Sans Ctrl, Alt ou une touche F6–F12, ce raccourci ne marchera que si la fenêtre d’Hexa a le focus — pas par-dessus un jeu.',
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Capture : neutraliser le clavier global pendant l'enregistrement
 * ------------------------------------------------------------------ */

let captureActive = false

/** Vrai pendant qu'on enregistre une nouvelle combinaison dans l'éditeur. */
export function isKeyCaptureActive(): boolean {
  return captureActive
}

export function setKeyCaptureActive(active: boolean): void {
  captureActive = active
}
