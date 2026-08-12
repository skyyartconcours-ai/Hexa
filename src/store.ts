import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ToolId } from './engine/types'
import { OBS_DEFAULT_PORT, type ObsMode } from './obs/protocol'
import { DEFAULT_PRESET, type KeymapAction, type KeymapPresetId } from './keymap'
import {
  DEFAULT_PROFILE_ID,
  findProfile,
  makeGlyph,
  makeProfileId,
  pickKnownSettings,
  snapshotSettings,
  type HexaProfile,
} from './profiles'

export const COLORS = ['#00e5ff', '#ff2d95', '#b026ff', '#39ff14', '#ffe900', '#ff6b35', '#ffffff']

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
  obsServerOn: false,
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
  /** identifiant du thème visuel (8 designs) */
  theme: string
  /** la séquence de découverte a déjà été jouée (premier lancement seulement) */
  onboarded: boolean
  /** intensité globale des halos et braises (0.4 sobre → 1.4 spectaculaire) */
  effectIntensity: number
  settingsOpen: boolean
  /** barre de rejeu de session ouverte (§11) — n'altère jamais la session vive */
  replayOpen: boolean
  /** barre d'outils visible — masquable au clavier (Ctrl+H en preset Epic Pen) */
  toolbarVisible: boolean
  /** preset de raccourcis actif (Hexa ou compatibilité Epic Pen) */
  keymapPreset: KeymapPresetId
  /** remaps utilisateur par-dessus le preset — null = raccourci retiré */
  keymapOverrides: Partial<Record<KeymapAction, string | string[] | null>>
  /** profil d'usage courant (Analyse LoL, Masterclass, Coaching live, Discret…) */
  profileId: string
  /** profils créés par l'utilisateur depuis l'état courant */
  customProfiles: HexaProfile[]
  setTool: (tool: ToolId) => void
  setColor: (color: string) => void
  setSize: (size: number) => void
  setFadeDelay: (fadeDelay: number | null) => void
  cycleFade: () => void
  toggleSparkles: () => void
  toggleSmartShapes: () => void
  toggleGuides: () => void
  toggleLinkBadges: () => void
  setTheme: (theme: string) => void
  setOnboarded: (onboarded: boolean) => void
  setEffectIntensity: (value: number) => void
  setSettingsOpen: (open: boolean) => void
  setReplayOpen: (open: boolean) => void
  /** applique un sous-ensemble des réglages OBS */
  setObs: (patch: Partial<ObsSettings>) => void
  toggleToolbar: () => void
  setKeymapPreset: (preset: KeymapPresetId) => void
  setBinding: (action: KeymapAction, combo: string | null) => void
  resetBinding: (action: KeymapAction) => void
  resetAllBindings: () => void
  applyProfile: (id: string) => void
  saveCustomProfile: (name: string) => void
  deleteCustomProfile: (id: string) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      tool: 'pen',
      color: COLORS[0],
      size: 6,
      fadeDelay: 4000,
      sparkles: true,
      smartShapes: true,
      guides: true,
      linkBadges: true,
      theme: 'neon-nuit',
      onboarded: false,
      effectIntensity: 1,
      settingsOpen: false,
      replayOpen: false,
      toolbarVisible: true,
      ...OBS_DEFAULTS,
      keymapPreset: DEFAULT_PRESET,
      keymapOverrides: {},
      profileId: DEFAULT_PROFILE_ID,
      customProfiles: [],
      setTool: (tool) => set({ tool }),
      setColor: (color) => set({ color }),
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
      setTheme: (theme) => set({ theme }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setEffectIntensity: (value) =>
        set({ effectIntensity: Math.min(1.4, Math.max(0.4, Math.round(value * 20) / 20)) }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setReplayOpen: (replayOpen) => set({ replayOpen }),
      setObs: (patch) => set(patch as Partial<UiState>),
      toggleToolbar: () => set((s) => ({ toolbarVisible: !s.toolbarVisible })),

      // ---- raccourcis clavier (source de vérité : src/keymap.ts) ----
      setKeymapPreset: (keymapPreset) => set({ keymapPreset }),
      setBinding: (action, combo) =>
        set((s) => ({ keymapOverrides: { ...s.keymapOverrides, [action]: combo } })),
      resetBinding: (action) =>
        set((s) => {
          const next = { ...s.keymapOverrides }
          delete next[action]
          return { keymapOverrides: next }
        }),
      resetAllBindings: () => set({ keymapOverrides: {} }),

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
    }),
    {
      name: 'hexa-ui',
      partialize: (s) => ({
        tool: s.tool,
        color: s.color,
        size: s.size,
        fadeDelay: s.fadeDelay,
        sparkles: s.sparkles,
        smartShapes: s.smartShapes,
        guides: s.guides,
        linkBadges: s.linkBadges,
        theme: s.theme,
        onboarded: s.onboarded,
        effectIntensity: s.effectIntensity,
        toolbarVisible: s.toolbarVisible,
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
        keymapOverrides: s.keymapOverrides,
        profileId: s.profileId,
        customProfiles: s.customProfiles,
      }),
    },
  ),
)
