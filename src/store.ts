import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ToolId } from './engine/types'
import { GRID_MODES, type GridMode, type StageClock, type StageNote } from './engine/stream-fx'
import { OBS_DEFAULT_PORT, type ObsMode } from './obs/protocol'
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
  /** preset de raccourcis actif (Epic Pen par défaut, ou clavier maison Hexa) */
  keymapPreset: KeymapPresetId
  /** l'utilisateur a choisi son preset lui-même : on ne le lui reprend jamais */
  keymapPresetChosen: boolean
  /** remaps utilisateur par-dessus le preset — null = raccourci retiré */
  keymapOverrides: Partial<Record<KeymapAction, string | string[] | null>>
  /**
   * Raccourcis CONFISQUÉS au système entier (actifs même sans le focus).
   *
   * DÉSACTIVÉ PAR DÉFAUT, et ce n'est pas un détail : RegisterHotKey de Windows
   * est exclusif. Tant que Hexa tenait Ctrl+E et Ctrl+H, plus aucune autre
   * application ne les recevait — impossible de mettre en pause sur YouTube ou
   * dans VLC en commentant une vidéo. F8 et la touche panique restent globaux
   * en permanence (ALWAYS_GLOBAL) : ce sont les seuls indispensables.
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
  setTool: (tool: ToolId) => void
  setColor: (color: string) => void
  setSize: (size: number) => void
  setFadeDelay: (fadeDelay: number | null) => void
  cycleFade: () => void
  toggleSparkles: () => void
  toggleSmartShapes: () => void
  toggleGuides: () => void
  toggleLinkBadges: () => void
  toggleHandwriting: () => void
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
      handwriting: false,
      theme: 'neon-nuit',
      onboarded: false,
      effectIntensity: 1,
      arrowPulse: false,
      spotlightRadius: 180,
      // §16.7 : aucun son par défaut, c'est une option qu'on choisit d'allumer
      sound: false,
      soundVolume: 0.6,
      settingsOpen: false,
      cheatsheetOpen: false,
      replayOpen: false,
      toolbarVisible: true,
      toolbarEdge: DEFAULT_DOCK.edge,
      toolbarOffset: DEFAULT_DOCK.offset,
      toolbarOrientation: 'auto',
      toolbarDisplayId: null,
      ...OBS_DEFAULTS,
      keymapPreset: DEFAULT_PRESET,
      keymapPresetChosen: false,
      keymapOverrides: {},
      globalShortcutsOn: false,
      globalShortcutsChosen: false,
      profileId: DEFAULT_PROFILE_ID,
      customProfiles: [],
      gridMode: 'off',
      gridOpacity: 0.22,
      clocks: [],
      notes: [],
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
      toggleHandwriting: () => set((s) => ({ handwriting: !s.handwriting })),
      setTheme: (theme) => set({ theme }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setEffectIntensity: (value) =>
        set({ effectIntensity: Math.min(1.4, Math.max(0.4, Math.round(value * 20) / 20)) }),
      toggleArrowPulse: () => set((s) => ({ arrowPulse: !s.arrowPulse })),
      setSpotlightRadius: (r) => set({ spotlightRadius: Math.min(500, Math.max(80, Math.round(r))) }),
      toggleSound: () => set((s) => ({ sound: !s.sound })),
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
        handwriting: s.handwriting,
        theme: s.theme,
        onboarded: s.onboarded,
        effectIntensity: s.effectIntensity,
        arrowPulse: s.arrowPulse,
        spotlightRadius: s.spotlightRadius,
        sound: s.sound,
        soundVolume: s.soundVolume,
        toolbarVisible: s.toolbarVisible,
        toolbarEdge: s.toolbarEdge,
        toolbarOffset: s.toolbarOffset,
        toolbarOrientation: s.toolbarOrientation,
        toolbarDisplayId: s.toolbarDisplayId,
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
        if (merged.keymapPresetChosen !== true) merged.keymapPreset = DEFAULT_PRESET
        // Les premières versions confisquaient les raccourcis au système entier,
        // ce qui privait YouTube et VLC de Ctrl+E et Ctrl+H. On rend les touches
        // une bonne fois aux installations existantes ; si l'utilisateur
        // réactive l'option ensuite, son choix est marqué et jamais réécrasé.
        const p = (persisted ?? {}) as Partial<UiState> & { globalShortcutsChosen?: boolean }
        if (p.globalShortcutsChosen !== true) merged.globalShortcutsOn = false
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
        return merged
      },
      /** Conservé pour les futures versions : sans lui, zustand jetterait l'état. */
      migrate: (persisted) => persisted as UiState,
    },
  ),
)
