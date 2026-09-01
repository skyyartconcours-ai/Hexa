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
// `isElectron` est déjà calculé localement plus bas dans ce fichier.
import { bridge, type ProtectionCapture } from '../bridge'
import { FADE_STEPS, useUiStore } from '../store'
import { THEMES } from '../themes'
import { CATEGORIES } from '../engine/handwriting/mots'
import { tailleLexique } from '../engine/handwriting/lexique'
import { KeymapEditor } from './KeymapEditor'
import { ProfilesPanel } from './ProfilesPanel'
import { EDGE_LABELS } from './toolbar-dock'
import {
  demanderSessionArchivee,
  etatArchive,
  queueReplay,
  rafraichirArchive,
  souscrireArchive,
} from '../replay/recorder'
import {
  download,
  downloadSessionJson,
  exportSessionPng,
  pickSessionFile,
  stampName,
  type PngScale,
} from '../replay/exporter'
import { OBS_DEFAULT_PORT, suggestedCanvasSize } from '../obs/protocol'
import { obsWsClient, statusLabel, type ObsWsStatus } from '../obs/client'
import { obsServerInfo, setObsClients, setObsServerInfo, subscribeObsServer } from '../obs/status'
import './settings.css'

export interface SettingsPanelProps {
  /**
   * Session VIVE du moteur (ce qui est à l'écran maintenant).
   *
   * ⚠️ ASYNCHRONE, ET DEMANDÉE AU CLIC SEULEMENT. La scène vit dans l'autre
   * fenêtre : la lire, c'est un `structuredClone` complet suivi d'une traversée
   * IPC — jusqu'à 139 ms sur une longue session, prélevées sur la couche qui est
   * à l'antenne. Le panneau ne la réclame donc qu'au moment où un bouton en a
   * réellement besoin, jamais à son ouverture.
   */
  getSession: () => Promise<SessionExport | null>
  /** recharge une session dans le moteur (import JSON) */
  loadSession: (session: SessionExport) => void
  onClose: () => void
}

const SCALES: PngScale[] = [1, 2, 4]

/**
 * Canaux d'état du serveur de la vue OBS (voir electron/preload.ts).
 *
 * Typés ici plutôt que dans le pont : ce sont des canaux de service, pas des
 * commandes de l'application.
 */
interface HoteObs {
  obsStatus?: () => Promise<unknown>
  on?: (channel: string, cb: (...args: unknown[]) => void) => () => void
  /** instantané du coût (processeur, mémoire, images/s, surface) — electron/sonde.ts */
  cout?: () => Promise<unknown>
  /** diagnostic de 30 s ; revient avec les chemins écrits */
  lancerSonde?: () => Promise<unknown>
  /** « Garder la fenêtre capturable par OBS » : lecture sans argument */
  captureFenetre?: (on?: boolean) => Promise<unknown>
}

/** Ce que renvoie `hexa.cout()`, revalidé ici : la page n'affiche jamais un chiffre qu'elle n'a pas compris. */
interface CoutLu {
  cpuTotal: number
  cpuCoeur: number
  coeurs: number
  memoireMo: number
  imagesParSeconde: number
  surface: number
  fenetres: { titre: string; visible: boolean; largeur: number; hauteur: number; surface: number; imagesParSeconde: number }[]
}

function lireCout(raw: unknown): CoutLu | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const fenetres = Array.isArray(r.fenetres)
    ? (r.fenetres as Record<string, unknown>[]).map((f) => ({
        titre: typeof f.titre === 'string' ? f.titre : '?',
        visible: f.visible === true,
        largeur: n(f.largeur),
        hauteur: n(f.hauteur),
        surface: n(f.surface),
        imagesParSeconde: n(f.imagesParSeconde),
      }))
    : []
  return {
    cpuTotal: n(r.cpuTotal),
    cpuCoeur: n(r.cpuCoeur),
    coeurs: Math.max(1, n(r.coeurs)),
    memoireMo: n(r.memoireMo),
    imagesParSeconde: n(r.imagesParSeconde),
    surface: n(r.surface),
    fenetres,
  }
}

/** État du réglage « Garder la fenêtre capturable par OBS », tel que le principal le dit. */
interface CaptureFenetreLue {
  on: boolean
  titre: string
  reduitPx: number
}

function lireCaptureFenetre(raw: unknown): CaptureFenetreLue | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  return {
    on: r.on === true,
    titre: typeof r.titre === 'string' ? r.titre : 'Hexa Overlay',
    reduitPx: typeof r.reduitPx === 'number' ? r.reduitPx : 8,
  }
}

function hoteObs(): HoteObs | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { hexa?: HoteObs }).hexa
}

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
  const radialAllTools = useUiStore((s) => s.radialAllTools)
  const toggleRadialAllTools = useUiStore((s) => s.toggleRadialAllTools)
  const toggleLinkBadges = useUiStore((s) => s.toggleLinkBadges)
  const effectIntensity = useUiStore((s) => s.effectIntensity)
  const setEffectIntensity = useUiStore((s) => s.setEffectIntensity)
  const arrowPulse = useUiStore((s) => s.arrowPulse)
  const toggleArrowPulse = useUiStore((s) => s.toggleArrowPulse)
  const lexicon = useUiStore((s) => s.lexicon)
  const toggleLexicon = useUiStore((s) => s.toggleLexicon)
  const lexiconCategories = useUiStore((s) => s.lexiconCategories)
  const toggleLexiconCategory = useUiStore((s) => s.toggleLexiconCategory)
  const lexiconWords = useUiStore((s) => s.lexiconWords)
  const setLexiconWords = useUiStore((s) => s.setLexiconWords)
  const toolbarEdge = useUiStore((s) => s.toolbarEdge)
  const toolbarOrientation = useUiStore((s) => s.toolbarOrientation)
  const setToolbarDock = useUiStore((s) => s.setToolbarDock)
  const setToolbarOrientation = useUiStore((s) => s.setToolbarOrientation)
  const resetToolbarDock = useUiStore((s) => s.resetToolbarDock)
  const setReplayOpen = useUiStore((s) => s.setReplayOpen)
  const hideUiFromCapture = useUiStore((s) => s.hideUiFromCapture)
  const setHideUiFromCapture = useUiStore((s) => s.setHideUiFromCapture)

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

  /**
   * Ce que le système a RÉELLEMENT accordé pour la protection de capture. On
   * demande l'état à l'ouverture du panneau : promettre une invisibilité qui
   * n'existe pas serait le pire service à rendre à quelqu'un en direct.
   */
  const [protection, setProtection] = useState<ProtectionCapture | null>(null)
  useEffect(() => {
    if (!isElectron) return
    let vivant = true
    void bridge.setProtectionCapture(useUiStore.getState().hideUiFromCapture).then((r) => {
      if (vivant) setProtection(r)
    })
    return () => {
      vivant = false
    }
  }, [])

  const panelRef = useRef<HTMLElement | null>(null)
  const [scale, setScale] = useState<PngScale>(2)
  const [crop, setCrop] = useState(false)
  const [source, setSource] = useState<'live' | 'all'>('live')
  /**
   * ⚠️ CE COMPTEUR NE VIENT PAS DU `recorder` LOCAL.
   *
   * En deux fenêtres, l'enregistreur vit avec le moteur, dans l'AUTRE fenêtre :
   * celui d'ici est vide pour toujours, et le panneau affichait « 0 trait
   * archivé » toute la session. Il vient donc de la couche encre, par le canal
   * d'état (voir src/replay/recorder.ts).
   */
  const [archive, setArchive] = useState(etatArchive)
  const archived = archive.traits
  /** traits sortis de l'archive faute de place : on le dit, on ne le cache pas */
  const forgotten = archive.oublies
  const [flash, setFlash] = useState<string | null>(null)
  const [wsStatus, setWsStatus] = useState<ObsWsStatus>(obsWsClient.status)
  const [showPassword, setShowPassword] = useState(false)
  const isElectron = typeof window !== 'undefined' && !!(window as { hexa?: unknown }).hexa

  // compteur de traits archivés — poussé par la couche encre, jamais sondé.
  // Une seule demande à l'ouverture : le reste arrive tout seul, à chaque
  // changement, et rien du tout quand l'archive ne bouge pas.
  useEffect(() => {
    const stop = souscrireArchive(() => setArchive(etatArchive()))
    rafraichirArchive()
    return stop
  }, [])

  // état RÉEL du serveur de la vue OBS (port écouté, vues connectées, erreur) :
  // poussé par le processus principal, jamais deviné.
  const [serverInfo, setServerInfo] = useState(obsServerInfo)
  useEffect(() => subscribeObsServer(() => setServerInfo(obsServerInfo())), [])

  /**
   * ⚠️ ET IL FAUT ALLER LE CHERCHER : IL N'ARRIVE PAS TOUT SEUL ICI.
   *
   * Le pont OBS (src/obs/ObsBridge.tsx) est monté avec le MOTEUR, donc dans la
   * fenêtre encre : c'est lui qui alimente src/obs/status.ts… dans SA fenêtre.
   * Celui de la fenêtre d'interface, où vit ce panneau, n'était jamais nourri.
   * Mesuré en deux fenêtres : la phrase d'état restait bloquée sur
   * « Démarrage… » toute la session, serveur allumé comme éteint, et le nombre
   * de sources connectées affichait toujours zéro — y compris avec une source
   * en train de recevoir les annotations.
   *
   * On s'abonne donc aux mêmes canaux, mais seulement tant que le panneau est
   * ouvert : à sa fermeture il ne reste rien, et rien ne tourne au repos.
   */
  useEffect(() => {
    const h = hoteObs()
    if (!h?.on) return
    let vivant = true
    void h.obsStatus?.().then((info) => {
      if (vivant) setObsServerInfo(info)
    })
    const offStatus = h.on('obs-status', (...args: unknown[]) => setObsServerInfo(args[0]))
    const offClients = h.on('obs-clients', (...args: unknown[]) => {
      const n = args[0]
      setObsClients(typeof n === 'number' ? n : 0)
    })
    return () => {
      vivant = false
      offStatus()
      offClients()
    }
  }, [])

  // état obs-websocket — le client pousse, on affiche.
  // Un ABONNEMENT, pas une prise de contrôle de `onStatus` : le pont OBS est le
  // propriétaire de cette propriété, et le moindre re-rendu de sa part écrasait
  // la chaîne que ce panneau installait — le voyant restait figé.
  useEffect(() => {
    setWsStatus(obsWsClient.status)
    return obsWsClient.souscrire((s) => setWsStatus(s))
  }, [])

  /**
   * « GARDER LA FENÊTRE CAPTURABLE PAR OBS » — un réglage du processus
   * principal, pas du store : il gouverne la fenêtre d'ENCRE, que cette page ne
   * voit pas. Lu à l'ouverture, écrit au clic, et toujours affiché d'après ce
   * que le principal répond — jamais d'après ce qu'on vient de demander.
   */
  const [captureFenetre, setCaptureFenetre] = useState<CaptureFenetreLue | null>(null)
  useEffect(() => {
    const h = hoteObs()
    if (!h?.captureFenetre) return
    let vivant = true
    void h.captureFenetre().then((r) => {
      if (vivant) setCaptureFenetre(lireCaptureFenetre(r))
    })
    return () => {
      vivant = false
    }
  }, [])
  const basculerCaptureFenetre = () => {
    const h = hoteObs()
    if (!h?.captureFenetre || !captureFenetre) return
    void h.captureFenetre(!captureFenetre.on).then((r) => setCaptureFenetre(lireCaptureFenetre(r)))
  }

  /**
   * « COÛT ACTUEL » — la réponse à « ça prend combien de ressources ? ».
   *
   * Demandé au processus principal toutes les 2 s, UNIQUEMENT tant que ce
   * panneau est monté : la minuterie naît ici et meurt avec le panneau
   * (nettoyage de l'effet). Panneau fermé, il ne reste rien — ni ici, ni dans
   * le principal, qui ne fait que répondre. Le premier relevé est jeté : le
   * processeur s'y mesure « depuis l'appel précédent », il ne veut rien dire.
   */
  const [cout, setCout] = useState<CoutLu | null>(null)
  useEffect(() => {
    const h = hoteObs()
    if (!h?.cout) return
    let vivant = true
    let premier = true
    const relever = () =>
      void h.cout?.().then((r) => {
        if (!vivant) return
        if (premier) {
          premier = false
          return
        }
        setCout(lireCout(r))
      })
    relever()
    const minuterie = setInterval(relever, 2000)
    return () => {
      vivant = false
      clearInterval(minuterie)
    }
  }, [])

  /** diagnostic de 30 s : lancé d'ici ou depuis l'icône près de l'horloge */
  const [sonde, setSonde] = useState<'repos' | 'en cours' | 'fini'>('repos')
  const [sondeChemin, setSondeChemin] = useState('')
  const lancerDiagnostic = () => {
    const h = hoteObs()
    if (!h?.lancerSonde || sonde === 'en cours') return
    setSonde('en cours')
    void h.lancerSonde().then((r) => {
      const chemin =
        typeof r === 'object' && r !== null && typeof (r as { resume?: unknown }).resume === 'string'
          ? (r as { resume: string }).resume
          : ''
      setSondeChemin(chemin)
      setSonde(chemin ? 'fini' : 'repos')
    })
  }

  // fermeture : Échap, clic extérieur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: PointerEvent) => {
      const el = panelRef.current
      if (!el || !(e.target instanceof Node) || el.contains(e.target)) return
      // la barre d'outils garde la main : sinon le bouton « Réglages »
      // fermerait puis rouvrirait le panneau dans le même geste
      if (e.target instanceof Element && e.target.closest('.toolbar')) return
      onClose()
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

  // Adresse EXACTE à coller dans la source navigateur. On affiche le port
  // RÉELLEMENT écouté : si 4787 était pris, Hexa a glissé sur le suivant, et
  // c'est celui-là qu'il faut copier — pas celui du champ.
  const obsUrl = useMemo(() => {
    if (isElectron) return `http://127.0.0.1:${serverInfo.port || obsPort}/obs.html`
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/obs.html`
  }, [isElectron, obsPort, serverInfo.port])

  const canvas = useMemo(() => suggestedCanvasSize(), [])

  /** Phrase d'état du serveur, en français, sans jargon. */
  const serverLine = useMemo(() => {
    if (!isElectron) return "Démo navigateur : ouvre obs.html dans un second onglet."
    if (!obsServerOn) return 'Serveur arrêté : la source navigateur ne recevra rien.'
    if (serverInfo.error) return `Problème : ${serverInfo.error}.`
    if (!serverInfo.running) return 'Démarrage…'
    const moved =
      serverInfo.wantedPort && serverInfo.port !== serverInfo.wantedPort
        ? ` (le port ${serverInfo.wantedPort} était occupé)`
        : ''
    if (serverInfo.clients === 0) {
      return `En écoute sur le port ${serverInfo.port}${moved} · aucune source connectée pour l'instant.`
    }
    return `En écoute sur le port ${serverInfo.port}${moved} · ${serverInfo.clients} source${
      serverInfo.clients > 1 ? 's' : ''
    } connectée${serverInfo.clients > 1 ? 's' : ''}.`
  }, [isElectron, obsServerOn, serverInfo])

  const serverTone =
    !isElectron || !obsServerOn
      ? 'off'
      : serverInfo.error
        ? 'retry'
        : serverInfo.clients > 0
          ? 'connected'
          : 'connecting'

  const VIDE: SessionExport = { app: 'hexa', version: 1, exportedAt: '', strokes: [] }

  const pickSession = async (): Promise<SessionExport> => {
    // « Toute la session » vit dans la couche encre : un aller-retour, mais
    // seulement ici, au clic sur un bouton d'export.
    if (source === 'all') return (await demanderSessionArchivee(true)) ?? VIDE
    return (await getSession()) ?? VIDE
  }

  const doExportJson = async () => {
    const s = source === 'all' ? await demanderSessionArchivee(false) : await getSession()
    if (!s || s.strokes.length === 0) {
      setFlash('Rien à exporter : la couche est vide.')
      return
    }
    downloadSessionJson(s)
    setFlash(`Session exportée (${s.strokes.length} traits, JSON vectoriel).`)
  }

  const doExportPng = async () => {
    const blob = await exportSessionPng(await pickSession(), { scale, crop })
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
                <i>
                  Halos néon, allumage du trait, braises de dissolution, étincelles. À gauche :
                  sobre et professionnel. À droite : spectaculaire pour le stream.
                </i>
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
              <Switch
                label="Tous les outils dans la roue"
                hint="Coupé, la roue n’affiche que les 7 essentiels — pinceau, ligne, rectangle, ellipse, texte, numéroteur, gomme — en secteurs larges, qu’on vise sans regarder. Activé, elle en affiche 12."
                on={radialAllTools}
                onChange={toggleRadialAllTools}
              />
              <Switch
                label="Flèches pulsantes"
                hint="Une flèche posée respire. Superbe pour insister… mais elle occupe le processeur en continu."
                on={arrowPulse}
                onChange={toggleArrowPulse}
              />
            </div>
          </Section>

          {/* ---------------- Écriture manuscrite (§S3) ---------------- */}
          <Section
            title="Écriture manuscrite"
            hint="En mode écriture (touche J), chaque capitale tracée est reconnue et retracée. À la fin du mot, le lexique le devine et rétablit son orthographe : « SYNDRA » devient « Syndra », « KAISA » devient « Kai'Sa »."
          >
            <Switch
              label="Corriger les mots avec le lexique"
              hint="En cas de doute, le mot est laissé tel qu'il a été lu : jamais de correction hasardeuse en plein direct."
              on={lexicon}
              onChange={toggleLexicon}
            />

            <div className="hx-field">
              <div className="hx-field-text">
                <b>Vocabulaires chargés</b>
                <i>
                  {lexicon
                    ? `${tailleLexique({ actif: true, categories: lexiconCategories, perso: lexiconWords })} mots reconnus.`
                    : 'Le correcteur est éteint.'}
                </i>
              </div>
            </div>

            <div className="hx-grid2">
              {CATEGORIES.map((c) => (
                <Switch
                  key={c.id}
                  label={c.nom}
                  hint={c.id === 'perso' ? `${lexiconWords.length} mot(s) à vous.` : c.detail}
                  on={lexiconCategories.includes(c.id)}
                  onChange={() => toggleLexiconCategory(c.id)}
                />
              ))}
            </div>

            <label className="hx-labeled">
              <span>Mes mots — un par ligne (pseudos, équipes, jargon)</span>
              <textarea
                className="hx-input hx-area"
                rows={4}
                spellCheck={false}
                placeholder={'Caps\nKarmine\nDouble kill'}
                value={lexiconWords.join('\n')}
                onChange={(e) =>
                  setLexiconWords(
                    e.target.value
                      .split('\n')
                      .map((w) => w.trim())
                      .filter((w) => w.length > 0),
                  )
                }
              />
            </label>
          </Section>

          {/* ---------------- Barre d'outils (§S4) ---------------- */}
          <Section
            title="Barre d'outils"
            hint="Sur deux écrans, la barre ne vit que sur celui de droite, collée à son bord gauche : à portée de souris, jamais par-dessus ce que les spectateurs regardent."
          >
            <div className="hx-field">
              <div className="hx-field-text">
                <b>Orientation</b>
                <i>
                  « Automatique » suit le bord d'ancrage : verticale à gauche et à droite,
                  horizontale en haut et en bas.
                </i>
              </div>
              <Segmented
                options={['auto', 'vertical', 'horizontal'] as const}
                value={toolbarOrientation}
                onChange={(v) => setToolbarOrientation(v)}
                render={(v) =>
                  v === 'auto' ? 'Automatique' : v === 'vertical' ? 'Verticale' : 'Horizontale'
                }
              />
            </div>

            <div className="hx-field">
              <div className="hx-field-text">
                <b>Bord d'ancrage</b>
                <i>
                  On peut aussi saisir la barre par son logo et la faire glisser : elle s'aimante
                  au bord le plus proche.
                </i>
              </div>
              <Segmented
                options={['left', 'top', 'bottom', 'right'] as const}
                value={toolbarEdge}
                onChange={(v) => setToolbarDock(v, 0.5)}
                render={(v) => EDGE_LABELS[v]}
              />
            </div>

            <div className="hx-field">
              <div className="hx-field-text">
                <b>Replacer la barre</b>
                <i>
                  Retour au bord gauche, à mi-hauteur, et barre visible. À utiliser si elle a fini
                  hors champ — un écran débranché, une résolution divisée par deux. La même
                  commande existe dans le menu de l'icône près de l'horloge.
                </i>
              </div>
              <button className="hx-btn" onClick={resetToolbarDock}>
                Replacer
              </button>
            </div>
          </Section>

          {/* ---------------- Direct et captures (§S11) ---------------- */}
          <Section
            title="Direct et captures"
            hint="Hexa affiche deux couches : tes ANNOTATIONS, que tes spectateurs doivent voir, et l'INTERFACE (barre, panneaux, curseur), qui ne regarde que toi."
          >
            <Switch
              label="Masquer l'interface de Hexa dans les captures"
              hint="Barre d'outils, panneaux, bandeaux d'état et curseur restent parfaitement visibles sur ton écran, mais disparaissent d'OBS, du partage d'écran Discord et des impressions d'écran. Tes annotations, elles, restent toujours visibles pour tes spectateurs."
              on={hideUiFromCapture}
              onChange={() => {
                const on = !hideUiFromCapture
                setHideUiFromCapture(on)
                if (isElectron) void bridge.setProtectionCapture(on).then(setProtection)
              }}
            />
            <div className="hx-note">
              {!isElectron ? (
                <>
                  Démo navigateur : les deux couches cohabitent dans la même page. Le masquage
                  n'existe que dans l'application Hexa.
                </>
              ) : protection && !protection.supporte ? (
                <>
                  <b>Sans effet sur cette plateforme</b> ({protection.plateforme}) : ton système ne
                  sait pas exclure une fenêtre des captures, l'interface y restera donc visible.
                  Sous Windows 10 (2004 et au-delà) et sur macOS, elle disparaît réellement.
                </>
              ) : hideUiFromCapture ? (
                <>
                  <b>Actif</b> : la fenêtre d'interface est exclue des captures. Restent visibles
                  dans ton direct — et c'est voulu — tes traits, flèches, formes et textes, le
                  spotlight, le gel d'image, les masques flous, la grille, les chronos et les notes
                  posées à l'écran.
                </>
              ) : (
                <>
                  <b>Désactivé</b> : ta barre d'outils et tes panneaux repartent dans le direct,
                  exactement comme n'importe quelle fenêtre. À n'utiliser que si tu veux justement
                  montrer l'interface (tutoriel, démonstration de Hexa).
                </>
              )}
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
                  {archived > 1 ? 's' : ''} archivé{archived > 1 ? 's' : ''}
                  {forgotten > 0 ? '' : ' depuis le lancement'}, fondus compris.
                  {forgotten > 0
                    ? ` L'archive est pleine : les ${forgotten} plus anciens en sont sortis pour que le direct reste fluide.`
                    : ''}
                </i>
              </div>
              <Segmented
                options={['live', 'all'] as const}
                value={source}
                onChange={setSource}
                render={(v) => (v === 'live' ? 'À l’écran' : 'Toute la session')}
              />
            </div>

            {/* L'archive évince pour de vrai : le dire, et le dire EN CLAIR.
                Un streamer qui croit tout garder et qui découvre après coup
                qu'il manque la première heure, c'est un enregistrement perdu. */}
            {forgotten > 0 && (
              <p className="hx-note hx-note-alerte">
                ⚠ L'archive a atteint son plafond : {forgotten} trait
                {forgotten > 1 ? 's' : ''} parmi les plus anciens en {forgotten > 1 ? 'sont' : 'est'}{' '}
                sorti{forgotten > 1 ? 's' : ''} pour que le direct reste fluide. « Toute la session »
                repart donc du plus ancien trait encore gardé. Exporte le JSON dès maintenant si tu
                veux conserver la suite.
              </p>
            )}

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
              <button className="hx-btn" onClick={() => void doExportJson()}>
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
            hint="Une source navigateur rendue par le même moteur qu'à l'écran, et un écran qui se nettoie au changement de scène."
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
                  {obsMode === 'screen'
                    ? 'Écran : tu vois tes annotations sur ton écran, et OBS les capture avec lui. Choisis une source « Capture d’écran » dans OBS — la « Capture de jeu » ne les verra pas.'
                    : 'Stream seul : ton écran reste propre (tes annotations n’y sont plus peintes), elles ne partent que dans la source navigateur ci-dessous. Utile en jeu, ou pour ne pas gêner ce que tu lis.'}
                </i>
              </div>
              <Segmented
                options={['screen', 'stream'] as const}
                value={obsMode}
                onChange={(v) => setObs({ obsMode: v })}
                render={(v) => (v === 'screen' ? 'Écran' : 'Stream seul')}
              />
            </div>

            <p className="hx-note">
              <b>Le piège à connaître :</b> une « Capture de jeu » (Game Capture) accroche le rendu
              du jeu et ne voit AUCUN outil d'annotation — ni Hexa, ni Epic Pen. Deux solutions :
              garder une source « Capture d'écran » (Display Capture), ou ajouter la source
              navigateur ci-dessous, qui marche dans tous les cas. Détails dans docs/OBS.md.
            </p>

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

            {/* ---- L'ASSISTANT : trois gestes, dix secondes, aucun réseau à comprendre ---- */}
            <div className="hx-field hx-obs-assistant">
              <div className="hx-field-text">
                <b>Brancher OBS en trois gestes</b>
                <i>
                  <strong>1.</strong> Copie l'adresse ci-dessous. <strong>2.</strong> Dans OBS : <strong>+</strong> sous
                  « Sources » → <strong>Navigateur</strong> (Browser) → colle l'adresse → Largeur{' '}
                  <strong>{canvas.width}</strong>, Hauteur <strong>{canvas.height}</strong> → OK. <strong>3.</strong> Regarde le
                  témoin juste en dessous : il passe tout seul à « source connectée » dès
                  qu'OBS est branché. Le fond est déjà transparent, rien d'autre à cocher.
                </i>
              </div>
            </div>
            <div className="hx-url">
              <code>{obsUrl}</code>
              <button className="hx-btn hx-btn-small" onClick={() => void copyUrl()}>
                Copier
              </button>
            </div>
            <p className="hx-note">
              Témoin :{' '}
              <span className="hx-chip-status hx-obs-temoin" data-status={serverTone}>
                {serverLine}
              </span>{' '}
              {isElectron && obsServerOn && serverInfo.running && serverInfo.clients === 0
                ? "— si OBS est censé être branché, vérifie l'adresse collée (le port a pu changer) et que la source n'est pas désactivée dans OBS."
                : ''}
            </p>

            {isElectron && (
              <>
                <Switch
                  label="Garder la fenêtre d'encre capturable par OBS"
                  hint={
                    captureFenetre
                      ? `Vide, la fenêtre « ${captureFenetre.titre} » est réduite à ${captureFenetre.reduitPx} × ${captureFenetre.reduitPx} pixels dans le coin de l'écran au lieu de disparaître : OBS la garde dans sa liste et ne la perd plus. Coût : ${captureFenetre.reduitPx * captureFenetre.reduitPx} pixels composés, aucune image.`
                      : 'Lecture du réglage…'
                  }
                  on={captureFenetre?.on ?? true}
                  onChange={basculerCaptureFenetre}
                />
                <p className="hx-note">
                  {captureFenetre?.on === false ? (
                    <>
                      <b>Coupé</b> : la fenêtre d'encre est cachée dès qu'elle est vide. Une
                      « Capture de fenêtre » d'OBS ne la trouve alors plus dans sa liste, et une
                      source déjà réglée reste vide jusqu'au prochain trait — sur les anciens OBS,
                      elle peut même basculer sur une autre fenêtre du même type (ton navigateur).
                      À ne couper que si tu n'utilises jamais la « Capture de fenêtre ».
                    </>
                  ) : (
                    <>
                      <b>Actif</b> : pour capturer Hexa par « Capture de fenêtre », choisis
                      « {captureFenetre?.titre ?? 'Hexa Overlay'} » dans la liste d'OBS — c'est le
                      seul nom qui compte, il ne change jamais. La capture d'écran et la source
                      navigateur, elles, n'ont pas besoin de ce réglage.
                    </>
                  )}
                </p>
              </>
            )}

            <div className="hx-field">
              <div className="hx-field-text">
                <b>obs-websocket</b>
                <i>
                  Optionnel. Hexa est parfait sans OBS : s'il n'est pas là, on retente doucement,
                  rien ne bloque.{' '}
                  <span className="hx-chip-status" data-status={wsStatus}>
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

          {/* ---------------- Ressources ---------------- */}
          {isElectron && (
            <Section
              title="Ressources"
              hint="Ce que Hexa coûte à ton ordinateur, maintenant — et un diagnostic de 30 s qui l'écrit noir sur blanc."
            >
              <div className="hx-field">
                <div className="hx-field-text">
                  <b>Coût actuel</b>
                  <i className="hx-cout">
                    {cout ? (
                      <>
                        Processeur <strong>{cout.cpuTotal.toLocaleString('fr-FR')} %</strong> (
                        {cout.cpuCoeur.toLocaleString('fr-FR')} % d'un cœur sur {cout.coeurs}) ·
                        Mémoire <strong>{Math.round(cout.memoireMo)} Mo</strong> · Images demandées{' '}
                        <strong>{cout.imagesParSeconde}/s</strong> · Surface composée{' '}
                        <strong>{cout.surface.toLocaleString('fr-FR')} %</strong> de l'écran
                        {cout.fenetres.length > 0 && (
                          <>
                            {' — '}
                            {cout.fenetres
                              .filter((f) => f.visible)
                              .map((f) => `${f.titre} ${f.largeur}×${f.hauteur}`)
                              .join(', ') || 'aucune fenêtre visible'}
                          </>
                        )}
                      </>
                    ) : (
                      'Mesure en cours (mise à jour toutes les 2 secondes tant que ce panneau est ouvert)…'
                    )}
                  </i>
                </div>
              </div>
              <p className="hx-note">
                Lecture : 0 image/s et une surface composée nulle ou minuscule = Hexa ne coûte rien
                à ton jeu, quoi qu'affiche le gestionnaire des tâches. La surface, c'est ce que
                Windows empile par-dessus le jeu à chaque image (fenêtres visibles additionnées :
                100 % = un calque plein écran, 200 % = deux — normal en mode dessin, panneau
                ouvert) : c'est elle qui fait saccader, pas le processeur. En jeu, écran vide, elle
                doit retomber sous 1 %. Ce témoin ne tourne que panneau ouvert.
              </p>
              <div className="hx-inline hx-inline-wrap">
                <button
                  className="hx-btn hx-sonde"
                  disabled={sonde === 'en cours'}
                  onClick={lancerDiagnostic}
                >
                  {sonde === 'en cours' ? 'Diagnostic en cours… (30 s)' : 'Diagnostic de performance (30 s)'}
                </button>
                <span className="hx-note">
                  {sonde === 'fini'
                    ? `Résumé écrit et dossier ouvert : ${sondeChemin}`
                    : "Trente secondes de relevés sans rien changer, un résumé en français, le dossier s'ouvre. Rien n'est envoyé nulle part."}
                </span>
              </div>
            </Section>
          )}

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
