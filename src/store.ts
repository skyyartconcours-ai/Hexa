import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ToolId } from './engine/types'

export const COLORS = ['#00e5ff', '#ff2d95', '#b026ff', '#39ff14', '#ffe900', '#ff6b35', '#ffffff']

export const FADE_STEPS: (number | null)[] = [2000, 4000, 8000, null]

export interface UiState {
  tool: ToolId
  color: string
  size: number
  /** null = les annotations restent jusqu'au clear ("board" persistant) */
  fadeDelay: number | null
  sparkles: boolean
  /** identifiant du thème visuel (8 designs) */
  theme: string
  settingsOpen: boolean
  setTool: (tool: ToolId) => void
  setColor: (color: string) => void
  setSize: (size: number) => void
  setFadeDelay: (fadeDelay: number | null) => void
  cycleFade: () => void
  toggleSparkles: () => void
  setTheme: (theme: string) => void
  setSettingsOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      tool: 'pen',
      color: COLORS[0],
      size: 6,
      fadeDelay: 4000,
      sparkles: true,
      theme: 'neon-nuit',
      settingsOpen: false,
      setTool: (tool) => set({ tool }),
      setColor: (color) => set({ color }),
      setSize: (size) => set({ size }),
      setFadeDelay: (fadeDelay) => set({ fadeDelay }),
      cycleFade: () =>
        set((s) => ({
          fadeDelay: FADE_STEPS[(FADE_STEPS.indexOf(s.fadeDelay) + 1) % FADE_STEPS.length],
        })),
      toggleSparkles: () => set((s) => ({ sparkles: !s.sparkles })),
      setTheme: (theme) => set({ theme }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    }),
    {
      name: 'hexa-ui',
      partialize: (s) => ({
        tool: s.tool,
        color: s.color,
        size: s.size,
        fadeDelay: s.fadeDelay,
        sparkles: s.sparkles,
        theme: s.theme,
      }),
    },
  ),
)
