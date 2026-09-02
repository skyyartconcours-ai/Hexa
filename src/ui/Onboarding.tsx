import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../store'
import { onboardingFromQuery } from '../themes'
import { formatCombo, resolveKeymap, type KeymapAction } from '../keymap'
import { onTourSignal } from './tour'

/* ============================================================
   Séquence de découverte — premier lancement seulement.

   Cinq étapes, pas une de plus, et à la fin l'utilisateur sait :
   dessiner · changer de couleur · effacer · déplacer une annotation
   (et ouvrir la roue) · rendre la souris au jeu, plus comment ses
   viewers verront tout ça.

   Règle : chaque étape se valide sur le GESTE RÉELLEMENT FAIT, jamais
   sur un bouton « j'ai compris ». Aucun timer permanent : on écoute des
   événements, c'est tout. Les touches affichées sortent du clavier ACTIF
   (preset Epic Pen par défaut, remaps compris) — jamais écrites en dur.
   ============================================================ */

type StepId = 'trait' | 'couleur' | 'effacer' | 'souris' | 'stream'

interface Step {
  id: StepId
  title: string
  /** texte principal, en français d'utilisateur */
  text: string
  /** consigne courte, affichée en pied de carte tant que ce n'est pas fait */
  cue: string
  /** actions dont on affiche la touche réelle sous le texte */
  keys?: { action: KeymapAction; label: string }[]
}

const STEPS: Step[] = [
  {
    id: 'trait',
    title: 'Dessine ton premier trait',
    text: 'Appuie sur le bouton gauche de la souris et trace, n’importe où sur l’écran. Le trait s’épaissit quand tu ralentis : c’est un feutre, pas un tuyau. La molette change son épaisseur.',
    cue: 'Trace un trait',
    keys: [
      { action: 'tool.pen', label: 'pinceau' },
      { action: 'tool.highlight', label: 'surligneur' },
    ],
  },
  {
    id: 'couleur',
    title: 'Change de couleur',
    text: 'Clique une pastille de la barre en bas, ou appuie sur un chiffre. Sept couleurs, choisies pour rester lisibles sur n’importe quel jeu.',
    cue: 'Change de couleur',
    keys: [
      { action: 'color.1', label: 'bleu clair' },
      { action: 'color.2', label: 'magenta' },
      { action: 'color.4', label: 'vert' },
    ],
  },
  {
    id: 'effacer',
    title: 'Efface',
    text: 'Une touche enlève tout, une autre revient en arrière d’un trait. Et si tu préfères effacer à la main, la gomme retire le trait entier que tu survoles, clic maintenu.',
    cue: 'Efface ou annule',
    keys: [
      { action: 'edit.clear', label: 'tout effacer' },
      { action: 'edit.undo', label: 'annuler' },
      { action: 'tool.eraser', label: 'gomme' },
    ],
  },
  {
    id: 'souris',
    title: 'Le clic droit fait deux choses',
    text: 'Sur une annotation, il l’attrape : tu la fais glisser où tu veux. Dans le vide, maintiens-le un quart de seconde : la roue des outils et des couleurs éclot sous ton curseur — tu glisses, tu relâches, c’est choisi. Relâche au centre et rien n’est pris. Plus jamais besoin de viser un coin de l’écran.',
    cue: 'Fais un clic droit',
  },
  {
    id: 'stream',
    title: 'Et sur ton stream ?',
    text: 'Dans OBS, une source « Capture d’écran » suffit : tes annotations sont posées par-dessus le bureau, elles partent dans le direct comme le reste. Attention, une source « Capture de jeu » filme l’intérieur du jeu et ne les verra jamais.',
    cue: 'Rends la souris au jeu',
    keys: [
      { action: 'mode.cursor', label: 'rendre la souris au jeu' },
      { action: 'mode.draw', label: 'revenir dessiner' },
    ],
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
  if (id === 'couleur')
    return (
      <svg viewBox="0 0 36 36" className="onb-svg" aria-hidden>
        <g className="onb-pulse">
          <circle cx="14" cy="14" r="7" fill="currentColor" opacity="0.9" />
          <circle cx="24" cy="19" r="7" fill="currentColor" opacity="0.5" />
          <circle cx="16" cy="25" r="6" fill="currentColor" opacity="0.28" />
        </g>
      </svg>
    )
  if (id === 'effacer')
    return (
      <svg viewBox="0 0 36 36" className="onb-svg" aria-hidden>
        <g className="onb-fadey" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6">
          <path d="M8 12h20" />
          <path d="M8 19h20" opacity="0.6" />
          <path d="M8 26h20" opacity="0.28" />
        </g>
      </svg>
    )
  if (id === 'souris')
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
        <rect x="4" y="7" width="28" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M12 30h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="10" cy="12.5" r="2" fill="currentColor" />
        <path d="M15 20l5-7 4 5 3-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
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
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)

  // Les touches montrées sont celles qui marchent VRAIMENT sur cette machine :
  // preset actif (Epic Pen par défaut) et remaps de l'utilisateur compris.
  const bindings = useMemo(
    () => resolveKeymap(keymapPreset, keymapOverrides),
    [keymapPreset, keymapOverrides],
  )

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

  // « Rejouer la découverte guidée » (bouton du panneau d'aide) : le drapeau
  // repasse à faux dans le store, la séquence repart du début. Personne n'a
  // besoin de connaître un paramètre d'URL pour revoir la présentation.
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        if (prev.onboarded && !s.onboarded) {
          setIndex(0)
          setOk(false)
          setClosing(false)
          setVisible(true)
        }
      }),
    [],
  )

  const step = STEPS[index]
  const last = index === STEPS.length - 1

  /** l'étape est réussie : petite fanfare, puis on avance (ou on termine) */
  const validate = useCallback(() => {
    setOk((already) => {
      if (already) return already
      later(() => {
        if (last) {
          finish()
          return
        }
        setOk(false)
        setIndex((i) => Math.min(i + 1, STEPS.length - 1))
      }, 900)
      return true
    })
  }, [later, last, finish])

  // ---- détection des gestes réels (aucun setInterval, aucune rAF) ----
  useEffect(() => {
    if (!visible || closing) return
    const id = step.id

    // Étape « couleur » : la barre d'outils comme le clavier passent tous les
    // deux par le store, donc un seul abonnement couvre les deux.
    if (id === 'couleur') {
      return useUiStore.subscribe((s, prev) => {
        if (s.color !== prev.color) validate()
      })
    }

    // Étape « effacer » : l'application signale elle-même qu'elle a retiré de
    // l'encre (touche, bouton de la barre ou raccourci global). En prime, on
    // accepte le simple fait de prendre la gomme : c'est le même apprentissage.
    if (id === 'effacer') {
      const offSignal = onTourSignal((kind) => {
        if (kind === 'erase') validate()
      })
      const offStore = useUiStore.subscribe((s, prev) => {
        if (s.tool === 'eraser' && prev.tool !== 'eraser') validate()
      })
      return () => {
        offSignal()
        offStore()
      }
    }

    // Étape finale : rendre la souris au jeu. Dès que c'est fait, la découverte
    // se termine d'elle-même — sinon la carte deviendrait inaccessible, la
    // fenêtre laissant désormais passer les clics.
    if (id === 'stream') {
      return onTourSignal((kind) => {
        if (kind === 'passthrough') validate()
      })
    }

    let down = false
    let button = -1
    let startX = 0
    let startY = 0
    let travel = 0

    const onDown = (e: PointerEvent) => {
      // on ignore les gestes faits sur l'interface (barre d'outils, carte)
      if ((e.target as HTMLElement | null)?.closest('.toolbar, .onb-card, .kme-sheet')) return
      down = true
      button = e.button
      startX = e.clientX
      startY = e.clientY
      travel = 0
    }

    const onMove = (e: PointerEvent) => {
      if (!down) return
      travel = Math.hypot(e.clientX - startX, e.clientY - startY)
      // déplacement d'une annotation au clic droit
      if (id === 'souris' && button === 2 && travel > 26) validate()
    }

    const onUp = () => {
      if (down && id === 'trait' && button === 0 && travel > 80) validate()
      down = false
    }

    const opts = { capture: true, passive: true } as const
    window.addEventListener('pointerdown', onDown, opts)
    window.addEventListener('pointermove', onMove, opts)
    window.addEventListener('pointerup', onUp, opts)
    window.addEventListener('pointercancel', onUp, opts)
    // …et l'autre moitié de l'étape « clic droit » : la roue s'est ouverte.
    // C'est le moteur qui le dit, au moment exact où elle éclot : impossible
    // de le deviner ici, l'utilisateur bouge la souris juste après.
    const offRadial =
      id === 'souris'
        ? onTourSignal((kind) => {
            if (kind === 'radial') validate()
          })
        : null
    return () => {
      offRadial?.()
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

  return (
    <div className="onb-root" aria-live="polite">
      <div
        key={step.id}
        className={`onb-card${ok ? ' is-ok' : ''}${closing ? ' is-out' : ''}`}
        onPointerEnter={() => document.body.classList.add('over-ui')}
        onPointerLeave={() => document.body.classList.remove('over-ui')}
      >
        <button className="onb-skip" title="Passer la découverte (Échap)" onClick={finish}>
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

        {step.keys && (
          <p className="onb-keys">
            {step.keys.map((k) => {
              const combo = bindings[k.action]?.[0]
              if (!combo) return null
              return (
                <span className="onb-key" key={k.action}>
                  <kbd>{formatCombo(combo)}</kbd> {k.label}
                </span>
              )
            })}
          </p>
        )}

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
              C’est parti
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
