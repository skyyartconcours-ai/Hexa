import type { CSSProperties } from 'react'
import { useUiStore } from '../store'
import { THEMES } from '../themes'

/* ============================================================
   Galerie des 8 thèmes — autonome (aucune prop obligatoire).
   Utilisée par la découverte guidée ET par la feuille de réglages :
   un seul rendu, une seule vérité visuelle.
   L'aperçu est dessiné en CSS avec les couleurs déclarées dans
   src/themes.ts : cliquer applique le thème immédiatement.
   ============================================================ */

export function ThemeGallery({ heading }: { heading?: string }) {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const current = THEMES.find((t) => t.id === theme)

  return (
    <div className="theme-gallery">
      {heading && <div className="theme-gallery-head">{heading}</div>}
      <div className="onb-gallery">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`onb-prev${theme === t.id ? ' is-on' : ''}`}
            data-t={t.id}
            style={
              {
                '--pa': t.accents[0],
                '--pb': t.accents[1],
                '--w1': t.demo.wall1,
                '--w2': t.demo.wall2,
                '--w3': t.demo.wall3,
              } as CSSProperties
            }
            title={t.tagline}
            onClick={() => setTheme(t.id)}
          >
            <span className="onb-prev-scene">
              <span className="onb-prev-bar">
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="onb-prev-name">{t.label}</span>
          </button>
        ))}
      </div>
      <p className="onb-tagline">{current?.tagline ?? ''}</p>
    </div>
  )
}
