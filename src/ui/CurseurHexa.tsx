/**
 * Hexa — curseur personnalisé de la couche INTERFACE.
 *
 * La pastille de couleur qui montre l'outil, sa teinte et son épaisseur (§9.5)
 * est peinte par le moteur… donc dans la couche ENCRE, donc dans le direct. Or
 * c'est de l'interface : elle renseigne le streamer, pas ses spectateurs. Elle
 * est donc reprise ici, dans la fenêtre exclue des captures.
 *
 * La souris peut dessiner dans l'AUTRE fenêtre : la pastille doit quand même la
 * suivre. C'est possible parce que la fenêtre interface est traversante avec
 * `forward: true` — les clics partent ailleurs, les MOUVEMENTS arrivent quand
 * même (voir ui/interactivite.ts).
 *
 * Coût : une image de rendu par mouvement de souris, jamais plus (une seule rAF
 * en vol à la fois), plafonnée à 60 par seconde comme le moteur — cette fenêtre
 * couvre tout l'écran pendant le dessin, et à 240 Hz chaque déplacement de la
 * pastille recomposait 1920 × 1080 pixels. Strictement zéro au repos.
 */
import { useEffect, useRef } from 'react'
import { useUiStore } from '../store'
import { tropTot } from '../engine/cadence'

/** Même recette que le moteur (engine.syncCursor) : mêmes tailles, même rendu. */
function diametre(tool: string, size: number): number {
  if (tool === 'eraser') return 30
  if (tool === 'ping') return 26
  return Math.min(26, Math.max(8, size * 1.6))
}

export function CurseurHexa() {
  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let x = 0
    let y = 0
    let frame = 0
    let derniere = -Infinity
    const peindre = (t: number) => {
      // Trop tôt : on garde la rAF en vol, la position la plus récente sera
      // peinte à la prochaine image permise.
      if (tropTot(t, derniere)) {
        frame = requestAnimationFrame(peindre)
        return
      }
      frame = 0
      derniere = t
      const el = ref.current
      if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
    }
    const bouge = (e: MouseEvent) => {
      x = e.clientX
      y = e.clientY
      // Une seule image en vol : dix mouvements dans la même image ne coûtent
      // qu'un seul repositionnement.
      if (frame) return
      frame = requestAnimationFrame(peindre)
    }
    window.addEventListener('mousemove', bouge, { passive: true })
    return () => {
      window.removeEventListener('mousemove', bouge)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div
      ref={ref}
      className="cursor-dot"
      data-tool={tool}
      aria-hidden
      style={{
        // laser et spotlight ont leur propre signe à l'écran : pas de pastille
        opacity: tool === 'laser' || tool === 'spotlight' ? 0 : 1,
        ...({
          '--c': color,
          '--d': `${diametre(tool, size)}px`,
        } as React.CSSProperties),
      }}
    />
  )
}

export default CurseurHexa
