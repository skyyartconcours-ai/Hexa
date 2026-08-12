/**
 * Hexa — panneau de réglages.
 *
 * Tout ce qui se règle est ici, et NULLE PART ailleurs : thèmes, hygiène à
 * l'écran (§7), session et exports (§11), miroir OBS (§10.2), obs-websocket
 * (§7.3), profils et raccourcis. En direct on n'ouvre pas de panneau — il
 * existe pour la découverte et la configuration, pas pour l'usage quotidien
 * (§8.9).
 *
 * Design : 100 % tokens, donc juste dans les 8 thèmes. Entrée à ressort,
 * fermeture par ✕, Échap ou clic extérieur, scroll interne à 70 % de la
 * hauteur d'écran.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SessionExport } from '../engine/types'
import { FADE_STEPS, useUiStore } from '../store'
import { THEMES } from '../themes'
import { KeymapEditor } from './KeymapEditor'
import { ProfilesPanel } from './ProfilesPanel'
import { recorder, queueReplay } from '../replay/recorder'
import {
  download,
  downloadSessionJson,
  exportSessionPng,
  pickSessionFile,
  stampName,
  type PngScale,
} from '../replay/exporter'
import { OBS_DEFAULT_PORT } from '../obs/protocol'
import { obsWsClient, statusLabel, type ObsWsStatus } from '../obs/client'
import './settings.css'

export interface SettingsPanelProps {
  /** session VIVE du moteur (ce qui est à l'écran maintenant) */
  getSession: () => SessionExport | null
  /** recharge une session dans le moteur (import JSON) */
  loadSession: (session: SessionExport) => void
  onClose: () => void
}

const SCALES: PngScale[] = [1, 2, 4]

function fadeLabel(v: number | null): string {
  return v == null ? '∞' : `${Math.round(v / 1000)} s`
}

/* ------------------------------------------------------------------ *
 * Petits composants d'interface, tous en tokens
 * ------------------------------------------------------------------ */

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="hx-sec">
      <div className="hx-sec-head">
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Switch({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint?: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      className="hx-switch"
      data-on={on ? '1' : undefined}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="hx-switch-text">
        <b>{label}</b>
        {hint && <i>{hint}</i>}
      </span>
      <span className="hx-switch-track">
        <span className="hx-switch-knob" />
      </span>
    </button>
  )
}

function Segmented<T extends string | number | null>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  render: (v: T) => string
}) {
  return (
    <div className="hx-seg" role="group">
      {options.map((o, i) => (
        <button
          key={i}
          className="hx-seg-item"
          data-on={o === value ? '1' : undefined}
          onClick={() => onChange(o)}
        >
          {render(o)}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Panneau
 * ------------------------------------------------------------------ */

export function SettingsPanel({ getSession, loadSession, onClose }: SettingsPanelProps) {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const setFadeDelay = useUiStore((s) => s.setFadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const toggleSparkles = useUiStore((s) => s.toggleSparkles)
  const smartShapes = useUiStore((s) => s.smartShapes)
  const toggleSmartShapes = useUiStore((s) => s.toggleSmartShapes)
  const guides = useUiStore((s) => s.guides)
  const toggleGuides = useUiStore((s) => s.toggleGuides)
  const linkBadges = useUiStore((s) => s.linkBadges)
  const toggleLinkBadges = useUiStore((s) => s.toggleLinkBadges)
  const effectIntensity = useUiStore((s) => s.effectIntensity)
  const setEffectIntensity = useUiStore((s) => s.setEffectIntensity)
  const setReplayOpen = useUiStore((s) => s.setReplayOpen)

  const obsMirror = useUiStore((s) => s.obsMirror)
  const obsMode = useUiStore((s) => s.obsMode)
  const obsServerOn = useUiStore((s) => s.obsServerOn)
  const obsPort = useUiStore((s) => s.obsPort)
  const obsWsEnabled = useUiStore((s) => s.obsWsEnabled)
  const obsWsHost = useUiStore((s) => s.obsWsHost)
  const obsWsPort = useUiStore((s) => s.obsWsPort)
  const obsWsPassword = useUiStore((s) => s.obsWsPassword)
  const obsClearOnScene = useUiStore((s) => s.obsClearOnScene)
  const setObs = useUiStore((s) => s.setObs)

  const panelRef = useRef<HTMLElement | null>(null)
  const [scale, setScale] = useState<PngScale>(2)
  const [crop, setCrop] = useState(false)
  const [source, setSource] = useState<'live' | 'all'>('live')
  const [archived, setArchived] = useState(recorder.count)
  const [flash, setFlash] = useState<string | null>(null)
  const [wsStatus, setWsStatus] = useState<ObsWsStatus>(obsWsClient.status)
  const [showPassword, setShowPassword] = useState(false)
  const isElectron = typeof window !== 'undefined' && !!(window as { hexa?: unknown }).hexa

  // compteur de traits archivés — poussé par l'enregistreur, jamais sondé
  useEffect(() => recorder.subscribe(() => setArchived(recorder.count)), [])

  // état obs-websocket — le client pousse, on affiche
  useEffect(() => {
    const previous = obsWsClient.onStatus
    obsWsClient.onStatus = (s, scene) => {
      previous?.(s, scene)
      setWsStatus(s)
    }
    setWsStatus(obsWsClient.status)
    return () => {
      obsWsClient.onStatus = previous
    }
  }, [])

  // fermeture : Échap, clic extérieur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: PointerEvent) => {
      const el = panelRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) onClose()
    }
    window.addEventListener('keydown', onKey)
    // capture : on ferme avant que le moteur ne prenne le clic pour un trait
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 5000)
    return () => clearTimeout(t)
  }, [flash])

  const obsUrl = useMemo(() => {
    if (isElectron) return `http://127.0.0.1:${obsPort}/obs.html`
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/obs.html`
  }, [isElectron, obsPort])

  const pickSession = (): SessionExport => {
    if (source === 'all') return recorder.flatSession()
    return getSession() ?? { app: 'hexa', version: 1, exportedAt: '', strokes: [] }
  }

  const doExportJson = () => {
    const s = source === 'all' ? recorder.session() : (getSession() ?? null)
    if (!s || s.strokes.length === 0) {
      setFlash('Rien à exporter : la couche est vide.')
      return
    }
    downloadSessionJson(s)
    setFlash(`Session exportée (${s.strokes.length} traits, JSON vectoriel).`)
  }

  const doExportPng = async () => {
    const blob = await exportSessionPng(pickSession(), { scale, crop })
    if (!blob) {
      setFlash('Rien à exporter : la couche est vide.')
      return
    }
    download(blob, stampName(`hexa-${scale}x`, 'png'))
    setFlash(`PNG transparent ${scale}× exporté${crop ? ' (recadré au contenu)' : ''}.`)
  }

  const doImport = async () => {
    const s = await pickSessionFile()
    if (!s) {
      setFlash('Fichier illisible ou annulé.')
      return
    }
    loadSession(s)
    setFlash(`Session importée : ${s.strokes.length} traits reposés sur la couche.`)
  }

  const doImportAndReplay = async () => {
    const s = await pickSessionFile()
    if (!s) {
      setFlash('Fichier illisible ou annulé.')
      return
    }
    queueReplay(s)
    setReplayOpen(true)
    onClose()
  }

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(obsUrl)
      setFlash('Adresse copiée : colle-la dans une source « Navigateur » d’OBS.')
    } catch {
      setFlash(obsUrl)
    }
  }

  return (
    <>
      <div className="hx-scrim" aria-hidden />
      <aside
        ref={panelRef}
        className="hx-settings"
        role="dialog"
        aria-label="Réglages de Hexa"
        onPointerEnter={() => document.body.classList.add('over-ui')}
        onPointerLeave={() => document.body.classList.remove('over-ui')}
      >
        <header className="hx-top">
          <span className="hx-top-mark" aria-hidden />
          <div className="hx-top-text">
            <b>Réglages</b>
            <i>Tout se règle ici. En direct, tout se fait au clavier.</i>
          </div>
          <button className="hx-close" onClick={onClose} title="Fermer (Échap)">
            ✕
          </button>
        </header>

        <div className="hx-scroll">
          {/* ---------------- Thèmes ---------------- */}
          <Section title="Thème" hint="Huit peaux, un seul moteur. Le choix est immédiat.">
            <div className="hx-themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className="hx-theme"
                  data-on={t.id === theme ? '1' : undefined}
                  onClick={() => setTheme(t.id)}
                  title={t.tagline}
                >
                  <span
                    className="hx-theme-demo"
                    style={{
                      background: `linear-gradient(150deg, ${t.demo.wall1} 0%, ${t.demo.wall2} 55%, ${t.demo.wall3} 100%)`,
                    }}
                  >
                    <span
                      className="hx-theme-ink"
                      style={{
                        background: `linear-gradient(120deg, ${t.accents[0]}, ${t.accents[1]})`,
                      }}
                    />
                    <span className="hx-theme-dots">
                      <i style={{ background: t.accents[0] }} />
                      <i style={{ background: t.accents[1] }} />
                    </span>
                  </span>
                  <span className="hx-theme-name">
                    {t.label}
                    {t.id === theme && <em>actif</em>}
                  </span>
                  <span className="hx-theme-tag">{t.tagline}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* ---------------- Hygiène ---------------- */}
          <Section
            title="Hygiène à l'écran"
            hint="Le vrai défaut d'Epic Pen : l'écran finit sale. Ici, il se nettoie tout seul."
          >
            <div className="hx-field">
              <div className="hx-field-text">
                <b>Fondu automatique</b>
                <i>Durée de vie d'une annotation avant sa dissolution.</i>
              </div>
              <Segmented
                options={FADE_STEPS}
                value={fadeDelay}
                onChange={(v) => setFadeDelay(v)}
                render={fadeLabel}
              />
            </div>

            <div className="hx-field">
              <div className="hx-field-text">
                <b>Intensité des effets</b>
                <i>Halos néon, braises, étincelles. À gauche : sobre. À droite : spectaculaire.</i>
              </div>
              <div className="hx-slider">
                <input
                  type="range"
                  min={0.4}
                  max={1.4}
                  step={0.05}
                  value={effectIntensity}
                  onChange={(e) => setEffectIntensity(Number(e.target.value))}
                />
                <span>{Math.round(effectIntensity * 100)} %</span>
              </div>
            </div>

            <div className="hx-grid2">
              <Switch
                label="Étincelles"
                hint="Petites braises au bout du pinceau."
                on={sparkles}
                onChange={toggleSparkles}
              />
              <Switch
                label="Formes intelligentes"
                hint="Le tracé à main levée est redressé."
                on={smartShapes}
                onChange={toggleSmartShapes}
              />
              <Switch
                label="Guides magnétiques"
                hint="Angles remarquables et alignements."
                on={guides}
                onChange={toggleGuides}
              />
              <Switch
                label="Relier les pastilles"
                hint="Le numéroteur trace 1 → 2 → 3."
                on={linkBadges}
                onChange={toggleLinkBadges}
              />
            </div>
          </Section>

          {/* ---------------- Profils (le composant porte son propre titre) ---- */}
          <section className="hx-sec">
            <ProfilesPanel />
          </section>

          {/* ---------------- Session ---------------- */}
          <Section
            title="Session, rejeu et exports"
            hint="Tout est vectoriel et horodaté : rejouable, réexportable en 4K, des semaines après."
          >
            <div className="hx-field">
              <div className="hx-field-text">
                <b>Contenu à traiter</b>
                <i>
                  À l'écran = ce qui est visible maintenant. Toute la session = {archived} trait
                  {archived > 1 ? 's' : ''} archivé{archived > 1 ? 's' : ''} depuis le lancement,
                  fondus compris.
                </i>
              </div>
              <Segmented
                options={['live', 'all'] as const}
                value={source}
                onChange={setSource}
                render={(v) => (v === 'live' ? 'À l’écran' : 'Toute la session')}
              />
            </div>

            <div className="hx-field">
              <div className="hx-field-text">
                <b>PNG transparent</b>
                <i>Couche d'annotation seule, à superposer au montage.</i>
              </div>
              <div className="hx-inline">
                <Segmented
                  options={SCALES}
                  value={scale}
                  onChange={setScale}
                  render={(v) => `${v}×`}
                />
                <Switch label="Recadrer" on={crop} onChange={setCrop} />
              </div>
            </div>

            <div className="hx-actions">
              <button className="hx-btn hx-btn-primary" onClick={() => void doExportPng()}>
                Exporter le PNG
              </button>
              <button className="hx-btn" onClick={doExportJson}>
                Exporter le JSON
              </button>
              <button className="hx-btn" onClick={() => void doImport()}>
                Importer un JSON
              </button>
              <button className="hx-btn" onClick={() => void doImportAndReplay()}>
                Importer et rejouer
              </button>
              <button
                className="hx-btn hx-btn-accent"
                onClick={() => {
                  queueReplay(null)
                  setReplayOpen(true)
                  onClose()
                }}
              >
                Rejouer la session
              </button>
            </div>
          </Section>

          {/* ---------------- OBS ---------------- */}
          <Section
            title="OBS"
            hint="Une vue browser source rendue par le même moteur, et un écran qui se nettoie au changement de scène."
          >
            <div className="hx-grid2">
              <Switch
                label="Miroir OBS"
                hint="Diffuse les annotations vers la vue."
                on={obsMirror}
                onChange={(v) => setObs({ obsMirror: v })}
              />
              <Switch
                label="Effacer au changement de scène"
                hint="Via obs-websocket (§7.3)."
                on={obsClearOnScene}
                onChange={(v) => setObs({ obsClearOnScene: v })}
              />
            </div>

            <div className="hx-field">
              <div className="hx-field-text">
                <b>Sortie</b>
                <i>
                  Écran : OBS capture ton écran, l'overlay est visible. Stream seul : ton écran
                  reste propre, seules les annotations partent à l'antenne.
                </i>
              </div>
              <Segmented
                options={['screen', 'stream'] as const}
                value={obsMode}
                onChange={(v) => setObs({ obsMode: v })}
                render={(v) => (v === 'screen' ? 'Écran' : 'Stream seul')}
              />
            </div>

            {isElectron && (
              <div className="hx-field">
                <div className="hx-field-text">
                  <b>Serveur local</b>
                  <i>Écoute sur 127.0.0.1 uniquement. Jamais exposé au réseau.</i>
                </div>
                <div className="hx-inline">
                  <Switch
                    label="Actif"
                    on={obsServerOn}
                    onChange={(v) => setObs({ obsServerOn: v })}
                  />
                  <input
                    className="hx-input hx-input-num"
                    type="number"
                    min={1024}
                    max={65535}
                    value={obsPort}
                    onChange={(e) =>
                      setObs({ obsPort: Number(e.target.value) || OBS_DEFAULT_PORT })
                    }
                  />
                </div>
              </div>
            )}

            <div className="hx-url">
              <code>{obsUrl}</code>
              <button className="hx-btn hx-btn-small" onClick={() => void copyUrl()}>
                Copier
              </button>
            </div>
            <p className="hx-note">
              Dans OBS : + → <b>Navigateur</b> → colle cette adresse, largeur et hauteur = celles de
              ta scène. Le fond est déjà transparent.
            </p>

            <div className="hx-field">
              <div className="hx-field-text">
                <b>obs-websocket</b>
                <i>
                  Optionnel. Hexa est parfait sans OBS : s'il n'est pas là, on retente doucement,
                  rien ne bloque.{' '}
                  <span className="hx-status" data-status={wsStatus}>
                    {statusLabel(wsStatus)}
                  </span>
                </i>
              </div>
              <Switch
                label="Connecter"
                on={obsWsEnabled}
                onChange={(v) => setObs({ obsWsEnabled: v })}
              />
            </div>

            {obsWsEnabled && (
              <div className="hx-inline hx-inline-wrap">
                <label className="hx-labeled">
                  <span>Hôte</span>
                  <input
                    className="hx-input"
                    value={obsWsHost}
                    onChange={(e) => setObs({ obsWsHost: e.target.value.trim() || '127.0.0.1' })}
                  />
                </label>
                <label className="hx-labeled">
                  <span>Port</span>
                  <input
                    className="hx-input hx-input-num"
                    type="number"
                    value={obsWsPort}
                    onChange={(e) => setObs({ obsWsPort: Number(e.target.value) || 4455 })}
                  />
                </label>
                <label className="hx-labeled hx-labeled-grow">
                  <span>Mot de passe</span>
                  <span className="hx-pass">
                    <input
                      className="hx-input"
                      type={showPassword ? 'text' : 'password'}
                      value={obsWsPassword}
                      autoComplete="off"
                      onChange={(e) => setObs({ obsWsPassword: e.target.value })}
                    />
                    <button
                      className="hx-btn hx-btn-small"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? 'Masquer' : 'Voir'}
                    </button>
                  </span>
                </label>
              </div>
            )}
          </Section>

          {/* ---------------- Raccourcis (titre porté par l'éditeur) ---------- */}
          <section className="hx-sec">
            <KeymapEditor />
          </section>
        </div>

        {flash && <div className="hx-flash">{flash}</div>}
      </aside>
    </>
  )
}

export default SettingsPanel
