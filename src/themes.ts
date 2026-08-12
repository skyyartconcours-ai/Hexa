/* ============================================================
   Hexa — les 8 thèmes
   Ce fichier est un CONTRAT : d'autres modules (galerie de thèmes,
   onboarding, panneau réglages) lisent THEMES et ThemeDef.
   La peau visuelle vit dans src/themes.css, un bloc par identifiant.
   ============================================================ */

export interface ThemeDef {
  /** identifiant technique, posé sur <html data-theme='…'> */
  id: string
  /** nom affiché */
  label: string
  /** une ligne de caractère, en français */
  tagline: string
  /** les deux couleurs de marque du thème (--logo-a / --logo-b) */
  accents: [string, string]
  /** couleurs du fond de démo, pour dessiner un aperçu miniature sans changer de thème */
  demo: { wall1: string; wall2: string; wall3: string }
}

export const THEMES: ThemeDef[] = [
  {
    id: 'neon-nuit',
    label: 'Néon nuit',
    tagline: 'Verre dépoli, halos cyan et violet. La signature Hexa.',
    accents: ['#00e5ff', '#b026ff'],
    demo: { wall1: '#0b0f1c', wall2: '#0e1224', wall3: '#120b26' },
  },
  {
    id: 'glacier',
    label: 'Glacier',
    tagline: 'Clair, givré, minimal. Pour les fonds lumineux et les captures propres.',
    accents: ['#1f6feb', '#59a8ff'],
    demo: { wall1: '#eef3fb', wall2: '#e3ecf9', wall3: '#dae6f6' },
  },
  {
    id: 'holo-iris',
    label: 'Holo iris',
    tagline: 'Nuit profonde et bordures irisées qui tournent lentement.',
    accents: ['#ff5fd2', '#5ce1ff'],
    demo: { wall1: '#0a0714', wall2: '#150a26', wall3: '#06101f' },
  },
  {
    id: 'phosphore',
    label: 'Phosphore',
    tagline: 'Terminal cathodique, vert sur noir, angles droits, scanlines.',
    accents: ['#7dff9b', '#25d366'],
    demo: { wall1: '#020604', wall2: '#04120a', wall3: '#010805' },
  },
  {
    id: 'sakura',
    label: 'Sakura',
    tagline: 'Pastel rose et lavande, tout en rondeurs et ombres douces.',
    accents: ['#ff86b3', '#b79cff'],
    demo: { wall1: '#fff6f9', wall2: '#fdeef7', wall3: '#f2ecff' },
  },
  {
    id: 'royal',
    label: 'Royal',
    tagline: 'Marine profond, filets dorés et empattements. Le ton masterclass.',
    accents: ['#e8c46a', '#c9a227'],
    demo: { wall1: '#060d1c', wall2: '#0b1730', wall3: '#07101f' },
  },
  {
    id: 'toon',
    label: 'Toon',
    tagline: 'Aplats criards, contours épais, ombres dures. Esprit bande dessinée.',
    accents: ['#ff2e63', '#ffd400'],
    demo: { wall1: '#ffd166', wall2: '#ff9f1c', wall3: '#ffe9a8' },
  },
  {
    id: 'stealth',
    label: 'Stealth',
    tagline: 'Monochrome quasi invisible, ultra compact, zéro halo. Ne montre rien.',
    accents: ['#9aa3ad', '#6b7280'],
    demo: { wall1: '#0d0d0f', wall2: '#141417', wall3: '#0a0a0c' },
  },
]

export const DEFAULT_THEME = THEMES[0].id

/** Retrouve un thème par identifiant (utile pour les aperçus et le libellé). */
export function findTheme(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id)
}

/**
 * Lit ?theme=<id> dans l'URL et le valide contre THEMES.
 * Sert aux captures d'écran et aux démos : `?theme=phosphore`.
 * Renvoie null si absent ou inconnu — l'appelant garde alors le thème du store.
 */
export function themeFromQuery(): string | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = new URLSearchParams(window.location.search).get('theme')
  } catch {
    return null
  }
  if (!raw) return null
  const id = raw.trim().toLowerCase()
  return THEMES.some((t) => t.id === id) ? id : null
}

/** Lit ?onboarding=1 : force la séquence de découverte (captures, démos). */
export function onboardingFromQuery(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const v = new URLSearchParams(window.location.search).get('onboarding')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}
