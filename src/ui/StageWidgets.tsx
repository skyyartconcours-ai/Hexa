/* ============================================================
   Hexa — éléments posés sur l'écran (brief §5.8)
   Grille et règle des tiers · chronos et comptes à rebours · notes.

   Règle d'or respectée à la lettre : AUCUNE boucle permanente.
   - la grille est du CSS pur (zéro image de rendu) ;
   - les notes ne s'animent jamais ;
   - une seule rAF, allumée quand une horloge tourne, éteinte dès que la
     dernière s'arrête — y compris toute seule quand un compte à rebours
     atteint zéro.
   ============================================================ */

import { useCallback, useEffect, useRef } from 'react'
import { useUiStore } from '../store'
import {
  COUNTDOWN_STEPS,
  NOTE_WIDTH,
  URGENT_MS,
  clampWidget,
  clockElapsed,
  clockRunning,
  clockValue,
  formatClock,
  gridLayers,
  placeWidget,
  widgetId,
  type StageClock,
  type StageNote,
} from '../engine/stream-fx'
import { IconCross, IconPause, IconPlay, IconReset } from './icons'
import './stage-widgets.css'

/* ------------------------------------------------------------------ *
 * Création (appelée par la barre d'outils et par le clavier)
 * ------------------------------------------------------------------ */

const viewport = (): { w: number; h: number } => ({ w: window.innerWidth, h: window.innerHeight })

/** au-dessus d'un élément posé, le curseur maison s'efface (comme sur la barre) */
const hover = (on: boolean): void => {
  document.body.classList.toggle('over-ui', on)
}

/** pose un chrono (ou un compte à rebours) libre à l'écran */
export function spawnClock(kind: StageClock['kind']): void {
  const st = useUiStore.getState()
  const taken = [...st.clocks, ...st.notes]
  const pos = placeWidget(taken, 250, 150, viewport())
  st.addClock({
    id: widgetId('clk'),
    kind,
    x: pos.x,
    y: pos.y,
    elapsed: 0,
    startedAt: null,
    duration: 60_000,
  })
}

/** pose une note vide, prête à être écrite */
export function spawnNote(): void {
  const st = useUiStore.getState()
  const taken = [...st.clocks, ...st.notes]
  const pos = placeWidget(taken, NOTE_WIDTH, 120, viewport())
  st.addNote({ id: widgetId('note'), x: pos.x, y: pos.y, text: '', color: st.color })
}

/* ------------------------------------------------------------------ *
 * Déplacement : clic droit n'importe où sur l'élément (comme les
 * annotations), ou clic gauche sur la poignée. Aucun listener global
 * n'est posé tant qu'aucun déplacement n'est en cours.
 * ------------------------------------------------------------------ */

function useDrag(
  id: string,
  pos: { x: number; y: number },
  commit: (id: string, x: number, y: number) => void,
) {
  const box = useRef<HTMLDivElement | null>(null)
  const start = useCallback(
    (e: React.PointerEvent) => {
      const el = box.current
      if (!el) return
      // Un bouton n'est JAMAIS une poignée : la croix de fermeture vit dans
      // l'en-tête, qui est justement la zone de préhension. Sans cette ligne,
      // vouloir fermer la carte la ferait glisser.
      if ((e.target as HTMLElement).closest('button')) return
      // le clic gauche ne déplace que par la poignée : ailleurs il sert à
      // écrire dans la note ou à presser un bouton
      const grip = (e.target as HTMLElement).closest('.sw-grip') != null
      if (e.button !== 2 && !(e.button === 0 && grip)) return
      e.preventDefault()
      e.stopPropagation()
      const dx = e.clientX - pos.x
      const dy = e.clientY - pos.y
      const rect = el.getBoundingClientRect()
      el.setPointerCapture(e.pointerId)
      el.classList.add('is-dragging')
      const move = (ev: PointerEvent) => {
        const p = clampWidget(ev.clientX - dx, ev.clientY - dy, rect.width, rect.height, viewport())
        el.style.left = `${p.x}px`
        el.style.top = `${p.y}px`
      }
      const end = (ev: PointerEvent) => {
        el.releasePointerCapture?.(ev.pointerId)
        el.classList.remove('is-dragging')
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        const p = clampWidget(ev.clientX - dx, ev.clientY - dy, rect.width, rect.height, viewport())
        commit(id, p.x, p.y)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
    },
    [id, pos.x, pos.y, commit],
  )
  return { box, start }
}

/* ------------------------------------------------------------------ *
 * Grille et règle des tiers (§5.8.1) — SOUS les annotations
 * ------------------------------------------------------------------ */

export function StageGrid() {
  const gridMode = useUiStore((s) => s.gridMode)
  const gridOpacity = useUiStore((s) => s.gridOpacity)
  const layers = gridLayers(gridMode, gridOpacity)
  if (!layers) return null
  return <div className="stage-grid" style={layers} aria-hidden />
}

/* ------------------------------------------------------------------ *
 * Chronos et comptes à rebours (§5.8.2)
 * ------------------------------------------------------------------ */

function ClockCard({ clock }: { clock: StageClock }) {
  const updateClock = useUiStore((s) => s.updateClock)
  const removeClock = useUiStore((s) => s.removeClock)
  const move = useCallback(
    (id: string, x: number, y: number) => updateClock(id, { x, y }),
    [updateClock],
  )
  const { box, start } = useDrag(clock.id, clock, move)
  const digits = useRef<HTMLDivElement | null>(null)

  // Affichage : écrit directement dans le DOM. React ne re-rend rien pendant
  // que le temps défile — le composant ne se reconstruit qu'aux vraies
  // décisions (démarrer, mettre en pause, remettre à zéro).
  useEffect(() => {
    const el = digits.current
    const card = box.current
    if (!el || !card) return
    let raf = 0
    let lastText = ''
    let lastState = ''
    const paint = (): boolean => {
      const now = Date.now()
      const v = clockValue(clock, now)
      const running = clockRunning(clock, now)
      // centièmes pour le chrono uniquement : un compte à rebours qui
      // clignote au centième est illisible en stream
      const text = formatClock(v, clock.kind === 'chrono')
      if (text !== lastText) {
        el.textContent = text
        lastText = text
      }
      const done = clock.kind === 'countdown' && v <= 0
      // La pulsation n'existe QUE pendant la marche : un compte à rebours mis
      // en pause à 7 s ne doit pas continuer de battre à l'écran (et donc
      // d'occuper le compositeur) pour rien.
      const urgent = running && clock.kind === 'countdown' && !done && v <= URGENT_MS
      const state = `${running ? 'r' : ''}${urgent ? 'u' : ''}${done ? 'd' : ''}`
      if (state !== lastState) {
        card.dataset.urgent = urgent ? '1' : '0'
        card.dataset.done = done ? '1' : '0'
        lastState = state
      }
      return running
    }
    if (!paint()) return
    const loop = () => {
      if (!paint()) {
        // Le compte à rebours vient d'atteindre zéro : on le RANGE dans l'état
        // (arrêté, cumul figé). Plus rien ne tourne ensuite.
        if (clock.startedAt != null) {
          updateClock(clock.id, { startedAt: null, elapsed: clock.duration })
        }
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [clock, updateClock, box])

  const running = clock.startedAt != null
  const toggle = () => {
    const now = Date.now()
    if (running) updateClock(clock.id, { elapsed: clockElapsed(clock, now), startedAt: null })
    else if (clock.kind === 'countdown' && clockValue(clock, now) <= 0) {
      updateClock(clock.id, { elapsed: 0, startedAt: now })
    } else updateClock(clock.id, { startedAt: now })
  }
  const reset = () => updateClock(clock.id, { elapsed: 0, startedAt: null })
  const setKind = (kind: StageClock['kind']) =>
    updateClock(clock.id, { kind, elapsed: 0, startedAt: null })

  return (
    <div
      ref={box}
      className="sw-card sw-clock"
      style={{ left: clock.x, top: clock.y }}
      data-kind={clock.kind}
      data-running={running ? '1' : '0'}
      onPointerDown={start}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="sw-head sw-grip">
        <span className="sw-title">{clock.kind === 'chrono' ? 'Chrono' : 'Compte à rebours'}</span>
        <button
          className="sw-close"
          title="Retirer — l'élément ne revient pas tout seul"
          onClick={() => {
            hover(false)
            removeClock(clock.id)
          }}
        >
          <IconCross />
        </button>
      </div>

      <div className="sw-digits" ref={digits}>
        {formatClock(clockValue(clock, Date.now()), clock.kind === 'chrono')}
      </div>

      {clock.kind === 'countdown' && !running && (
        <div className="sw-steps">
          {COUNTDOWN_STEPS.map((s) => (
            <button
              key={s}
              className={`sw-step ${clock.duration === s * 1000 ? 'active' : ''}`}
              onClick={() => updateClock(clock.id, { duration: s * 1000, elapsed: 0 })}
            >
              {s < 60 ? `${s}s` : `${s / 60}m`}
            </button>
          ))}
        </div>
      )}

      <div className="sw-actions">
        <button className="sw-btn primary" onClick={toggle} title={running ? 'Pause' : 'Démarrer'}>
          {running ? <IconPause /> : <IconPlay />}
          <span>{running ? 'Pause' : 'Démarrer'}</span>
        </button>
        <button className="sw-btn" onClick={reset} title="Remettre à zéro">
          <IconReset />
        </button>
        <button
          className="sw-btn sw-swap"
          onClick={() => setKind(clock.kind === 'chrono' ? 'countdown' : 'chrono')}
          title={
            clock.kind === 'chrono'
              ? 'Passer en compte à rebours'
              : 'Passer en chrono (temps qui monte)'
          }
        >
          {clock.kind === 'chrono' ? '↓' : '↑'}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Notes persistantes (§5.8.3)
 * ------------------------------------------------------------------ */

function NoteCard({ note }: { note: StageNote }) {
  const updateNote = useUiStore((s) => s.updateNote)
  const removeNote = useUiStore((s) => s.removeNote)
  const move = useCallback((id: string, x: number, y: number) => updateNote(id, { x, y }), [updateNote])
  const { box, start } = useDrag(note.id, note, move)
  const area = useRef<HTMLTextAreaElement | null>(null)

  // hauteur qui suit le texte : une note ne défile jamais, elle grandit
  const fit = useCallback(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(420, el.scrollHeight)}px`
  }, [])

  useEffect(() => {
    fit()
    // une note fraîchement posée attend qu'on écrive dedans
    if (note.text === '') area.current?.focus()
    // `note.text` en dépendance : la hauteur suit aussi un texte rechargé
  }, [fit, note.text])

  return (
    <div
      ref={box}
      className="sw-card sw-note"
      style={{ left: note.x, top: note.y, width: NOTE_WIDTH, '--c': note.color } as React.CSSProperties}
      onPointerDown={start}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="sw-note-grip sw-grip" title="Déplacer : clic droit (ou glisser cette barre)" />
      <button
        className="sw-close sw-note-close"
        title="Fermer cette note"
        onClick={() => {
          hover(false)
          removeNote(note.id)
        }}
      >
        <IconCross />
      </button>
      <textarea
        ref={area}
        className="sw-note-text"
        value={note.text}
        spellCheck={false}
        placeholder="Note…"
        onChange={(e) => {
          updateNote(note.id, { text: e.target.value })
          fit()
        }}
        onKeyDown={(e) => {
          // Échap rend le clavier à l'application sans fermer la note
          if (e.key === 'Escape') e.currentTarget.blur()
          e.stopPropagation()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Couche complète — AU-DESSUS des annotations, sous la barre d'outils
 * ------------------------------------------------------------------ */

export function StageWidgets() {
  const clocks = useUiStore((s) => s.clocks)
  const notes = useUiStore((s) => s.notes)
  const color = useUiStore((s) => s.color)
  // la couche disparaît complètement du DOM quand rien n'est posé : pas un
  // nœud, pas un style, pas une image de rendu
  if (clocks.length === 0 && notes.length === 0) return null
  return (
    <div className="stage-widgets" style={{ '--accent': color } as React.CSSProperties}>
      {clocks.map((c) => (
        <ClockCard key={c.id} clock={c} />
      ))}
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} />
      ))}
    </div>
  )
}
