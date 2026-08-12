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
  | 'tool.measure'
  | 'tool.stamp'
  | 'tool.eraser'
  // outils momentanés (maintien de touche, §8.5)
  | 'hold.laser'
  | 'hold.spotlight'
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
  | 'size.dec'
  | 'size.inc'
  | 'fade.cycle'
  | 'toggle.smartShapes'
  | 'toggle.guides'
  | 'toggle.linkBadges'
  // interface
  | 'ui.toolbar'
  | 'ui.settings'
  | 'ui.close'
  // système (enregistrés côté Electron)
  | 'mode.draw'
  | 'app.panic'

export type KeymapCategory = 'outils' | 'momentanes' | 'couleurs' | 'edition' | 'interface' | 'systeme'

export const CATEGORY_LABELS: Record<KeymapCategory, string> = {
  outils: 'Outils',
  momentanes: 'Outils momentanés (maintien)',
  couleurs: 'Couleurs',
  edition: 'Édition',
  interface: 'Interface',
  systeme: 'Système (raccourcis globaux)',
}

export interface KeymapEntry {
  action: KeymapAction
  /** description courte affichée dans l'éditeur */
  label: string
  category: KeymapCategory
  /** true = l'action vit tant que la touche est maintenue (§8.5) */
  hold?: boolean
  /** true = enregistré par Electron via globalShortcut, actif même hors focus */
  global?: boolean
  /** précision optionnelle affichée en petit sous le libellé */
  hint?: string
}

/** L'ordre de ce tableau est l'ordre d'affichage dans l'éditeur. */
export const KEYMAP_ENTRIES: readonly KeymapEntry[] = [
  { action: 'tool.pen', label: 'Pinceau', category: 'outils' },
  { action: 'tool.highlight', label: 'Surligneur', category: 'outils' },
  { action: 'tool.line', label: 'Ligne droite', category: 'outils', hint: 'Maj : angles de 15°' },
  { action: 'tool.arrow', label: 'Flèche', category: 'outils' },
  { action: 'tool.rect', label: 'Rectangle', category: 'outils' },
  { action: 'tool.ellipse', label: 'Ellipse', category: 'outils' },
  { action: 'tool.text', label: 'Texte', category: 'outils' },
  { action: 'tool.badge', label: 'Numéroteur', category: 'outils', hint: 'Pastilles 1, 2, 3…' },
  { action: 'tool.measure', label: 'Règle de mesure', category: 'outils' },
  {
    action: 'tool.stamp',
    label: 'Tampon d’image',
    category: 'outils',
    hint: 'Ctrl+V colle directement une image du presse-papier',
  },
  { action: 'tool.eraser', label: 'Gomme', category: 'outils' },

  {
    action: 'hold.laser',
    label: 'Laser',
    category: 'momentanes',
    hold: true,
    hint: 'Marche aussi en clic traversant, donc en pleine partie',
  },
  { action: 'hold.spotlight', label: 'Spotlight', category: 'momentanes', hold: true },
  { action: 'hold.magnifier', label: 'Loupe', category: 'momentanes', hold: true },
  { action: 'hold.freeze', label: 'Gel d’image', category: 'momentanes', hold: true },

  { action: 'color.1', label: 'Couleur 1', category: 'couleurs' },
  { action: 'color.2', label: 'Couleur 2', category: 'couleurs' },
  { action: 'color.3', label: 'Couleur 3', category: 'couleurs' },
  { action: 'color.4', label: 'Couleur 4', category: 'couleurs' },
  { action: 'color.5', label: 'Couleur 5', category: 'couleurs' },
  { action: 'color.6', label: 'Couleur 6', category: 'couleurs' },
  { action: 'color.7', label: 'Couleur 7', category: 'couleurs' },

  { action: 'edit.undo', label: 'Annuler', category: 'edition' },
  { action: 'edit.redo', label: 'Rétablir', category: 'edition' },
  { action: 'edit.clear', label: 'Tout effacer', category: 'edition' },
  { action: 'size.dec', label: 'Épaisseur —', category: 'edition', hint: 'Molette aussi' },
  { action: 'size.inc', label: 'Épaisseur +', category: 'edition', hint: 'Molette aussi' },
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

  { action: 'ui.toolbar', label: 'Afficher/masquer la barre', category: 'interface' },
  { action: 'ui.settings', label: 'Réglages', category: 'interface' },
  { action: 'ui.close', label: 'Fermer le panneau ouvert', category: 'interface' },

  {
    action: 'mode.draw',
    label: 'Mode dessin / mode jeu',
    category: 'systeme',
    global: true,
    hint: 'Évite F1–F5 : ce sont les sorts alliés dans League of Legends',
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
  'tool.measure': 'm',
  'tool.stamp': 'i',
  'tool.eraser': 'e',

  'hold.laser': 'z',
  'hold.spotlight': 'x',
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
  'size.dec': '[',
  'size.inc': ']',
  'fade.cycle': 'd',
  'toggle.smartShapes': 'w',
  'toggle.guides': 'g',
  'toggle.linkBadges': 'k',

  'ui.toolbar': 'h',
  'ui.settings': 'ctrl+,',
  'ui.close': 'esc',

  'mode.draw': 'f8',
  'app.panic': 'ctrl+shift+x',
}

/**
 * Preset « Compatibilité Epic Pen ».
 *
 * ⚠️ Ces combinaisons proviennent de la documentation publique d'Epic Pen
 * (source tierce, non vérifiable hors ligne) : elles sont fournies pour
 * retrouver ses réflexes, et TOUTES remappables depuis l'éditeur.
 * Le reste du clavier (couleurs, épaisseur, fondu…) hérite du preset Hexa.
 */
const EPICPEN_BINDINGS: Bindings = {
  'tool.pen': ['ctrl+shift+3', 'p'],
  'tool.highlight': ['ctrl+shift+4', 's'],
  'tool.eraser': ['ctrl+shift+5', 'e'],
  'edit.undo': ['ctrl+shift+6', 'ctrl+z'],
  'mode.draw': ['ctrl+shift+2', 'f8'],
  'edit.clear': ['ctrl+e', 'c'],
  'ui.toolbar': ['ctrl+h', 'h'],
}

export const KEYMAP_PRESETS: readonly KeymapPreset[] = [
  {
    id: 'hexa',
    name: 'Hexa',
    description: 'Le clavier maison : une lettre par outil, tout sous la main gauche.',
    bindings: HEXA_BINDINGS,
  },
  {
    id: 'epicpen',
    name: 'Compatibilité Epic Pen',
    description:
      'Reprend les combinaisons d’Epic Pen (Ctrl+Maj+3/4/5/6, Ctrl+E, Ctrl+H) en gardant celles d’Hexa en second.',
    extends: 'hexa',
    bindings: EPICPEN_BINDINGS,
  },
]

export const DEFAULT_PRESET: KeymapPresetId = 'hexa'

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
