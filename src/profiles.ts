/**
 * Hexa — profils d'usage.
 *
 * Un profil est un jeu de réglages complet qu'on commute en un geste, parce
 * qu'analyser un rush de LoL et enregistrer une masterclass ne demandent pas du
 * tout le même comportement (§7 : hygiène à l'écran).
 *
 * Ce module est volontairement PUR (aucune dépendance au store) pour rester
 * importable de partout sans cycle d'import. C'est le store qui applique.
 */
import type { ToolId } from './engine/types'

/**
 * Réglages portés par un profil. Toutes les clés sont optionnelles : un profil
 * ne touche que ce qui le concerne.
 *
 * Certaines clés (formes intelligentes, niveau d'effets) appartiennent à des
 * modules livrés en parallèle : elles sont appliquées seulement si le store les
 * connaît déjà (voir applyProfileSettings). Le jour où elles arrivent, les
 * profils les pilotent sans une ligne de plus.
 */
export interface ProfileSettings {
  tool?: ToolId
  color?: string
  size?: number
  /** ms avant dissolution — null = les annotations restent (tableau blanc) */
  fadeDelay?: number | null
  sparkles?: boolean
  theme?: string
  /** redressement automatique des formes à main levée (§4.1) */
  smartShapes?: boolean
  /** densité globale des effets décoratifs */
  effects?: 'plein' | 'sobre' | 'minimal'
}

export interface HexaProfile {
  id: string
  name: string
  /** une ligne, en français, affichée sous le nom */
  description: string
  /** deux ou trois caractères affichés dans la pastille du profil */
  glyph: string
  builtin: boolean
  settings: ProfileSettings
}

/** Les quatre profils d'usine, dans l'ordre d'affichage. */
export const BUILTIN_PROFILES: readonly HexaProfile[] = [
  {
    id: 'lol',
    name: 'Analyse LoL',
    description: 'Rien ne s’efface, formes redressées : on décortique une phase image par image.',
    glyph: 'LoL',
    builtin: true,
    settings: {
      fadeDelay: null,
      smartShapes: true,
      sparkles: false,
      size: 6,
      tool: 'pen',
      effects: 'sobre',
    },
  },
  {
    id: 'masterclass',
    name: 'Masterclass',
    description: 'Fondu 8 s, tracé sobre : lisible au montage, sans distraction à l’image.',
    glyph: 'MC',
    builtin: true,
    settings: {
      fadeDelay: 8000,
      smartShapes: true,
      sparkles: false,
      size: 7,
      tool: 'pen',
      effects: 'sobre',
    },
  },
  {
    id: 'coaching',
    name: 'Coaching live',
    description: 'Fondu 4 s, laser en avant : on montre, on commente, l’écran reste propre.',
    glyph: 'LIVE',
    builtin: true,
    settings: {
      fadeDelay: 4000,
      smartShapes: false,
      sparkles: true,
      size: 6,
      tool: 'laser',
      effects: 'plein',
    },
  },
  {
    id: 'discret',
    name: 'Discret',
    description: 'Thème sombre minimal, effets réduits : l’outil se fait oublier.',
    glyph: '···',
    builtin: true,
    settings: {
      fadeDelay: 2000,
      smartShapes: false,
      sparkles: false,
      size: 4,
      theme: 'stealth',
      effects: 'minimal',
    },
  },
]

export const DEFAULT_PROFILE_ID = 'coaching'

/** Clés qu'un profil est autorisé à écrire dans le store. */
export const PROFILE_KEYS: readonly (keyof ProfileSettings)[] = [
  'tool',
  'color',
  'size',
  'fadeDelay',
  'sparkles',
  'theme',
  'smartShapes',
  'effects',
]

/** Extrait un instantané de profil depuis un état de store quelconque. */
export function snapshotSettings(state: Readonly<Record<string, unknown>>): ProfileSettings {
  const out: Record<string, unknown> = {}
  for (const key of PROFILE_KEYS) {
    if (key in state && state[key] !== undefined) out[key] = state[key]
  }
  return out as ProfileSettings
}

/**
 * Ne garde que les réglages que le store connaît réellement.
 * C'est ce filtre qui rend les profils tolérants aux modules encore à venir :
 * un réglage inconnu est ignoré au lieu de polluer l'état.
 */
export function pickKnownSettings(
  settings: ProfileSettings,
  state: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue
    if (key in state) patch[key] = value
  }
  return patch
}

/** Le profil courant décrit-il encore l'état affiché ? (sinon : « personnalisé ») */
export function settingsMatch(
  settings: ProfileSettings,
  state: Readonly<Record<string, unknown>>,
): boolean {
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue
    if (!(key in state)) continue
    if (state[key] !== value) return false
  }
  return true
}

export function findProfile(
  id: string,
  customProfiles: readonly HexaProfile[] = [],
): HexaProfile | undefined {
  return BUILTIN_PROFILES.find((p) => p.id === id) ?? customProfiles.find((p) => p.id === id)
}

/** Identifiant unique et lisible pour un profil créé par l'utilisateur. */
export function makeProfileId(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `perso-${slug || 'profil'}-${Date.now().toString(36)}`
}

/** Pastille : deux ou trois lettres tirées du nom. */
export function makeGlyph(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '••'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
