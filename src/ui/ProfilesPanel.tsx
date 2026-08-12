/**
 * Hexa — sélecteur de profils d'usage.
 *
 * Composant AUTONOME, sans prop, à poser dans le panneau de réglages :
 *
 *     import { ProfilesPanel } from './ProfilesPanel'
 *     …
 *     <ProfilesPanel />
 *
 * Un clic sur une carte applique tout le jeu de réglages du profil. Le bouton
 * « Enregistrer » fige l'état courant dans un nouveau profil personnel.
 */
import { useMemo, useState } from 'react'
import { BUILTIN_PROFILES, settingsMatch, type HexaProfile } from '../profiles'
import { useUiStore } from '../store'
import './keymap-editor.css'

/** Résumé lisible d'un profil : trois puces maximum, jamais de jargon. */
function chipsFor(profile: HexaProfile): string[] {
  const chips: string[] = []
  const fade = profile.settings.fadeDelay
  if (fade === null) chips.push('fondu ∞')
  else if (typeof fade === 'number') chips.push(`fondu ${Math.round(fade / 1000)} s`)
  if (profile.settings.smartShapes) chips.push('formes intelligentes')
  if (profile.settings.effects === 'minimal') chips.push('effets minimaux')
  else if (profile.settings.effects === 'sobre') chips.push('rendu sobre')
  if (profile.settings.tool === 'laser') chips.push('laser en avant')
  return chips.slice(0, 3)
}

export function ProfilesPanel() {
  const profileId = useUiStore((s) => s.profileId)
  const customProfiles = useUiStore((s) => s.customProfiles)
  const applyProfile = useUiStore((s) => s.applyProfile)
  const saveCustomProfile = useUiStore((s) => s.saveCustomProfile)
  const deleteCustomProfile = useUiStore((s) => s.deleteCustomProfile)

  // On observe les réglages pilotés par un profil pour savoir si l'état courant
  // correspond encore au profil sélectionné.
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const theme = useUiStore((s) => s.theme)
  const size = useUiStore((s) => s.size)

  const [name, setName] = useState('')

  const profiles = useMemo(
    () => [...BUILTIN_PROFILES, ...customProfiles],
    [customProfiles],
  )

  const current = profiles.find((p) => p.id === profileId)
  const drifted = current
    ? !settingsMatch(current.settings, { fadeDelay, sparkles, theme, size })
    : false

  return (
    <div className="profiles">
      <div className="profiles-head">
        <div>
          <div className="profiles-title">Profils d’usage</div>
          <div className="profiles-sub">
            Un geste pour passer de l’analyse au direct : durée du fondu, densité des effets, thème.
          </div>
        </div>
        <div className="kme-spacer" />
        {drifted && <span className="kme-badge">réglages modifiés</span>}
      </div>

      <div className="profiles-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className="profile-card"
            data-on={p.id === profileId && !drifted ? '1' : '0'}
            onClick={() => applyProfile(p.id)}
            title={p.description}
          >
            {!p.builtin && (
              <span
                className="profile-del"
                role="button"
                tabIndex={-1}
                title="Supprimer ce profil"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteCustomProfile(p.id)
                }}
              >
                ✕
              </span>
            )}
            <span className="profile-top">
              <span className="profile-glyph">{p.glyph}</span>
              <span className="profile-name">{p.name}</span>
            </span>
            <span className="profile-desc">{p.description}</span>
            <span className="profile-meta">
              {chipsFor(p).map((c) => (
                <span className="profile-chip" key={c}>
                  {c}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      <div className="profile-save">
        <input
          className="profile-input"
          placeholder="Nom du profil à créer depuis les réglages actuels"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !name.trim()) return
            saveCustomProfile(name)
            setName('')
          }}
        />
        <button
          className="kme-ghost"
          disabled={!name.trim()}
          onClick={() => {
            if (!name.trim()) return
            saveCustomProfile(name)
            setName('')
          }}
        >
          Enregistrer
        </button>
      </div>
    </div>
  )
}

export default ProfilesPanel
