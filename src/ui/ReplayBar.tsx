/**
 * Hexa — barre de transport du rejeu de session (brief §11).
 *
 * « On peut rejouer une session d'annotations au montage, en 4K, en vectoriel
 * propre, alors qu'elle a été faite en direct à l'arrache. » C'est l'argument
 * qui transforme l'outil de gadget de stream en outil de production vidéo — et
 * c'est hypnotique à regarder, donc c'est soigné en conséquence.
 *
 * Le rejeu vit sur SON canvas. La session en cours n'est jamais touchée : on
 * peut rejouer, exporter, puis reprendre le direct exactement où on en était.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionExport } from '../engine/types'
import { ReplayPlayer, type ReplayState } from '../replay/player'
import { recorder, takeQueuedReplay } from '../replay/recorder'
import {
  canRecordClip,
  CLIP_ALPHA_WARNING,
  download,
  exportSessionPng,
  recordClip,
  stampName,
  type ClipHandle,
} from '../replay/exporter'
import '../replay/replay.css'

const SPEEDS = [0.5, 1, 2]
const BUCKETS = 96

/** 0:03,4 — lisible d'un coup d'œil, à la française. */
function timecode(ms: number): string {
  const total = Math.max(0, ms) / 1000
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const d = Math.floor((total * 10) % 10)
  return `${m}:${String(s).padStart(2, '0')},${d}`
}

const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M8 5.6v12.8l10-6.4z" fill="currentColor" />
  </svg>
)

const IconPause = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
  </svg>
)

const IconLoop = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path
      d="M5 9a6 6 0 0 1 10-2m1.6 2.6L19 7m0 8a6 6 0 0 1-10 2m-1.6-2.6L5 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const IconCamera = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path
      d="M4 8.5h3l1.4-2h7.2L17 8.5h3v10H4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="13" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
  </svg>
)

export interface ReplayBarProps {
  onClose: () => void
}

export function ReplayBar({ onClose }: ReplayBarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const playerRef = useRef<ReplayPlayer | null>(null)
  const clipRef = useRef<ClipHandle | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const [state, setState] = useState<ReplayState>({
    t: 0,
    duration: 0,
    playing: false,
    speed: 1,
    loop: true,
  })
  const [density, setDensity] = useState<number[]>([])
  const [count, setCount] = useState(0)
  const [recording, setRecording] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const player = new ReplayPlayer()
    playerRef.current = player
    player.onState = setState
    player.attach(canvas)

    // session importée depuis les réglages, sinon tout ce que l'enregistreur
    // a vu passer depuis le lancement (§11)
    const session: SessionExport = takeQueuedReplay() ?? recorder.session()
    player.load(session)
    setCount(session.strokes.length)
    setDensity(player.density(BUCKETS))
    document.body.classList.add('replay-on')
    if (session.strokes.length > 0) player.play()

    const onResize = () => player.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      document.body.classList.remove('replay-on')
      player.detach()
      playerRef.current = null
    }
  }, [])

  // raccourcis locaux : espace, flèches, Échap — capturés avant l'app
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = playerRef.current
      if (!p) return
      if (e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        p.toggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        p.seek(p.state.t - 1000)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        p.seek(p.state.t + 1000)
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const progress = state.duration > 0 ? state.t / state.duration : 0

  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current
    const p = playerRef.current
    if (!el || !p) return
    const r = el.getBoundingClientRect()
    const k = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)))
    p.seek(k * p.state.duration)
  }

  const bars = useMemo(
    () =>
      density.map((v, i) => (
        <span
          key={i}
          className="rp-bar"
          style={{ height: `${8 + v * 92}%`, opacity: 0.25 + v * 0.75 }}
        />
      )),
    [density],
  )

  const shot = async () => {
    const p = playerRef.current
    if (!p) return
    const strokes = p.project(p.state.t)
    const blob = await exportSessionPng(
      { app: 'hexa', version: 1, exportedAt: new Date().toISOString(), strokes },
      { scale: 2 },
    )
    if (!blob) {
      setNotice('Rien à exporter à cet instant du rejeu.')
      return
    }
    download(blob, stampName('hexa-rejeu', 'png'))
    setNotice('PNG transparent 2× exporté.')
  }

  const toggleClip = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (clipRef.current) {
      const blob = await clipRef.current.stop()
      clipRef.current = null
      setRecording(false)
      if (blob) download(blob, stampName('hexa-rejeu', 'webm'))
      setNotice(CLIP_ALPHA_WARNING)
      return
    }
    const handle = recordClip(canvas)
    if (!handle) {
      setNotice("Ce navigateur ne sait pas enregistrer de clip. L'export PNG, si.")
      return
    }
    clipRef.current = handle
    setRecording(true)
    playerRef.current?.seek(0)
    playerRef.current?.play()
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <>
      <canvas ref={canvasRef} className="rp-canvas" />
      <div
        className="rp-bar-root"
        onPointerEnter={() => document.body.classList.add('over-ui')}
        onPointerLeave={() => document.body.classList.remove('over-ui')}
      >
        <div className="rp-head">
          <span className="rp-tag">Rejeu</span>
          <span className="rp-count">
            {count} trait{count > 1 ? 's' : ''} · la session en cours reste intacte
          </span>
          <span className="rp-spacer" />
          <button className="rp-close" onClick={onClose} title="Quitter le rejeu (Échap)">
            ✕
          </button>
        </div>

        <div className="rp-row">
          <button
            className="rp-play"
            onClick={() => playerRef.current?.toggle()}
            title={state.playing ? 'Pause (Espace)' : 'Lecture (Espace)'}
          >
            {state.playing ? <IconPause /> : <IconPlay />}
          </button>

          <div
            ref={trackRef}
            className="rp-track"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              seekFromEvent(e.clientX)
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) seekFromEvent(e.clientX)
            }}
          >
            <div className="rp-bars">{bars}</div>
            <div className="rp-fill" style={{ width: `${progress * 100}%` }} />
            <div className="rp-knob" style={{ left: `${progress * 100}%` }} />
          </div>

          <div className="rp-time">
            <b>{timecode(state.t)}</b>
            <span>/ {timecode(state.duration)}</span>
          </div>

          <div className="rp-speeds" role="group" aria-label="Vitesse de rejeu">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className="rp-speed"
                data-on={state.speed === s ? '1' : undefined}
                onClick={() => playerRef.current?.setSpeed(s)}
              >
                {s === 0.5 ? '0,5' : s}×
              </button>
            ))}
          </div>

          <button
            className="rp-ghost"
            data-on={state.loop ? '1' : undefined}
            onClick={() => playerRef.current?.setLoop(!state.loop)}
            title="Lecture en boucle"
          >
            <IconLoop />
          </button>

          <button className="rp-ghost" onClick={() => void shot()} title="PNG transparent 2× de cet instant">
            <IconCamera />
          </button>

          {canRecordClip() && (
            <button
              className="rp-ghost rp-rec"
              data-on={recording ? '1' : undefined}
              onClick={() => void toggleClip()}
              title="Enregistrer un clip WebM du rejeu (fond noir, voir l'info)"
            >
              {recording ? 'Stop' : 'REC'}
            </button>
          )}
        </div>

        {notice && <div className="rp-notice">{notice}</div>}
      </div>
    </>
  )
}

export default ReplayBar
