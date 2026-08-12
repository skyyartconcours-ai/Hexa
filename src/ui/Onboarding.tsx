import { useCallback, useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store'
import { onboardingFromQuery } from '../themes'
import { ThemeGallery } from './ThemeGallery'

/* ============================================================
   Séquence de découverte — premier lancement seulement.
   Règle : chaque étape se valide sur le GESTE RÉELLEMENT FAIT
   par l'utilisateur, jamais sur un bouton « j'ai compris ».
   Aucun timer permanent : on écoute des événements, c'est tout.
   ============================================================ */

type StepId = 'trait' | 'grab' | 'fade' | 'radial' | 'theme'

interface Step {
  id: StepId
  title: string
  text: string
  /** ce qu'on attend, formulé comme une consigne courte */
  cue: string
}

const STEPS: Step[] = [
  {
    id: 'trait',
    title: 'Trace ton premier trait',
    text: "Appuie et dessine n'importe où sur l'écran. Le trait s'épaissit quand tu ralentis : c'est un feutre, pas un tuyau.",
    cue: 'Dessine un trait',
  },
  {
    id: 'grab',
    title: 'Attrape une annotation',
    text: 'Clic droit sur un trait et fais-le glisser. Rien n’est figé : tout ce que tu poses reste déplaçable.',
    cue: 'Clic droit sur ton trait, puis glisse',
  },
  {
    id: 'fade',
    title: 'Règle le fondu',
    text: 'La touche D fait tourner la durée de vie : 2s, 4s, 8s, puis ∞. En ∞, tout reste jusqu’au nettoyage — parfait pour un tableau d’analyse.',
    cue: 'Appuie sur D',
  },
  {
    id: 'radial',
    title: 'Le menu radial',
    text: 'Maintiens le clic droit : la roue d’outils apparaît sous ton curseur. Tu glisses, tu relâches, c’est choisi. Jamais besoin de viser un coin de l’écran.',
    cue: 'Maintiens le clic droit une seconde',
  },
  {
    id: 'theme',
    title: 'Choisis ta peau',
    text: 'Huit designs, huit personnalités. Clique pour essayer en direct : tout change immédiatement, tu peux en changer quand tu veux dans les réglages.',
    cue: 'Choisis un thème',
  },
]

/** pictogrammes animés, un par étape (SVG maison, aucune ressource externe) */
function StepGlyph({ id }: { id: StepId }) {
  if (id === 'trait')
    return (
      <svg viewBox="0 0 36 36" className="onb-svg" aria-hidden>
        <path
          className="onb-draw"
          d="M5 25c4-12 8 6 12-4s6 8 14-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    )
  if (id === 'grab')
    return (
      <svg viewBox="0 0 36 36" className="onb-svg" aria-hidden>
        <path
          d="M6 22c5-9 11-9 16-2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.45"
        />
        <g className="onb-slide">
          <path
            d="M12 24c5-9 11-9 16-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path d="M20 14l9 3.5-3.8 1.4-1.4 3.8z" fill="currentColor" />
        </g>
      </svg>
    )
  if (id === 'fade')
    return (
      <svg viewBox="0 0 36 36" className="onb-svg" aria-hidden>
        <g className="onb-fadey" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6">
          <path d="M8 12h20" />
          <path d="M8 18h20" opacity="0.6" />
          <path d="M8 24h20" opacity="0.28" />
        </g>
      </svg>
    )
  if (id === 'radial')
    return (
      <svg viewBox="0 0 36 36" className="onb-svg" aria-hidden>
        <circle cx="18" cy="18" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.4" />
        <g className="onb-spin">
          <circle cx="18" cy="7.5" r="2.4" fill="currentColor" />
          <circle cx="27" cy="12.7" r="2" fill="currentColor" opacity="0.55" />
          <circle cx="27" cy="23.3" r="2" fill="currentColor" opacity="0.4" />
          <circle cx="18" cy="28.5" r="2" fill="currentColor" opacity="0.55" />
          <circle cx="9" cy="23.3" r="2" fill="currentColor" opacity="0.4" />
          <circle cx="9" cy="12.7" r="2" fill="currentColor" opacity="0.55" />
        </g>
        <circle cx="18" cy="18" r="2.8" fill="currentColor" />
      </svg>
    )
  return (
    <svg viewBox="0 0 36 36" className="onb-svg" aria-hidden>
      <g className="onb-pulse">
        <path d="M10 4l7 4v8l-7 4-7-4V8z" transform="translate(4 6)" fill="currentColor" opacity="0.9" />
        <circle cx="26" cy="12" r="5" fill="currentColor" opacity="0.5" />
        <rect x="20" y="20" width="10" height="10" rx="3" fill="currentColor" opacity="0.35" />
      </g>
    </svg>
  )
}

export function Onboarding() {
  const forced = onboardingFromQuery()
  const [visible, setVisible] = useState(() => forced || !useUiStore.getState().onboarded)
  const [index, setIndex] = useState(0)
  const [ok, setOk] = useState(false)
  const [closing, setClosing] = useState(false)
  const timers = useRef<number[]>([])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    },
    [],
  )

  const finish = useCallback(() => {
    setClosing(true)
    later(() => {
      setVisible(false)
      if (!forced) useUiStore.getState().setOnboarded(true)
    }, 420)
  }, [forced, later])

  /** l'étape est réussie : petite fanfare, puis on avance */
  const validate = useCallback(() => {
    setOk((already) => {
      if (already) return already
      later(() => {
        setOk(false)
        setIndex((i) => Math.min(i + 1, STEPS.length - 1))
      }, 900)
      return true
    })
  }, [later])

  const step = STEPS[index]

  // ---- détection des gestes réels (aucun setInterval, aucune rAF) ----
  useEffect(() => {
    if (!visible || closing) return
    const id = step.id
    if (id === 'theme') return

    if (id === 'fade') {
      // couvre la touche D comme le bouton de la barre d'outils
      return useUiStore.subscribe((s, prev) => {
        if (s.fadeDelay !== prev.fadeDelay) validate()
      })
    }

    let down = false
    let button = -1
    let startX = 0
    let startY = 0
    let travel = 0
    let holdId = 0

    const clearHold = () => {
      if (holdId) {
        window.clearTimeout(holdId)
        holdId = 0
      }
    }

    const onDown = (e: PointerEvent) => {
      // on ignore les gestes faits sur l'interface (barre d'outils, carte)
      if ((e.target as HTMLElement | null)?.closest('.toolbar, .onb-card, .kme-sheet')) return
      down = true
      button = e.button
      startX = e.clientX
      startY = e.clientY
      travel = 0
      if (id === 'radial' && e.button === 2) {
        holdId = window.setTimeout(() => {
          if (down && travel < 18) validate()
        }, 420)
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!down) return
      travel = Math.hypot(e.clientX - startX, e.clientY - startY)
      if (id === 'grab' && button === 2 && travel > 26) validate()
      if (id === 'radial' && travel > 18) clearHold()
    }

    const onUp = () => {
      if (down && id === 'trait' && button === 0 && travel > 80) validate()
      down = false
      clearHold()
    }

    const opts = { capture: true, passive: true } as const
    window.addEventListener('pointerdown', onDown, opts)
    window.addEventListener('pointermove', onMove, opts)
    window.addEventListener('pointerup', onUp, opts)
    window.addEventListener('pointercancel', onUp, opts)
    return () => {
      clearHold()
      window.removeEventListener('pointerdown', onDown, opts)
      window.removeEventListener('pointermove', onMove, opts)
      window.removeEventListener('pointerup', onUp, opts)
      window.removeEventListener('pointercancel', onUp, opts)
    }
  }, [step.id, visible, closing, validate])

  // Échap : on saute le guide
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, finish])

  if (!visible) return null

  const last = index === STEPS.length - 1

  return (
    <div className="onb-root" aria-live="polite">
      <div
        key={step.id}
        className={`onb-card${last ? ' is-wide' : ''}${ok ? ' is-ok' : ''}${closing ? ' is-out' : ''}`}
        onPointerEnter={() => document.body.classList.add('over-ui')}
        onPointerLeave={() => document.body.classList.remove('over-ui')}
      >
        <button className="onb-skip" title="Passer le guide (Échap)" onClick={finish}>
          ✕
        </button>

        <div className="onb-head">
          <span className="onb-glyph">
            <StepGlyph id={step.id} />
          </span>
          <div className="onb-headtext">
            <div className="onb-eyebrow">
              Découverte · {index + 1} sur {STEPS.length}
            </div>
            <h3 className="onb-title">{step.title}</h3>
          </div>
        </div>

        <p className="onb-text">{step.text}</p>

        {last && <ThemeGallery />}

        <div className="onb-foot">
          <div className="onb-rail">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`onb-pip${i === index ? ' is-now' : ''}${i < index ? ' is-done' : ''}`}
              />
            ))}
          </div>
          <div className="onb-cue">{ok ? 'Bien joué' : step.cue}</div>
          {last ? (
            <button className="onb-next is-primary" onClick={finish}>
              Terminer
            </button>
          ) : (
            <button
              className="onb-next"
              onClick={() => setIndex((i) => Math.min(i + 1, STEPS.length - 1))}
            >
              Passer ›
            </button>
          )}
        </div>

        <span className="onb-check" aria-hidden>
          <svg viewBox="0 0 24 24">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </div>
  )
}
