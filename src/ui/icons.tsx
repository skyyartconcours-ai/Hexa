import type { ReactElement, SVGProps } from 'react'

function Svg(props: SVGProps<SVGSVGElement> & { children: ReactElement | ReactElement[] }) {
  const { children, ...rest } = props
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconPen = () => (
  <Svg>
    <path d="M12.5 18.5 19 12l-3-3-6.5 6.5L8 20l4.5-1.5z" />
    <path d="M16 6l2 2" />
    <path d="M4 20c1.5-.5 2.5-.5 4 0" opacity="0.5" />
  </Svg>
)

export const IconHighlight = () => (
  <Svg>
    <path d="m9 11 4 4" />
    <path d="M5 15 15 5l4 4L9 19H5v-4z" />
    <path d="M4 21h7" opacity="0.5" />
  </Svg>
)

export const IconLine = () => (
  <Svg>
    <path d="M5 19 19 5" />
  </Svg>
)

export const IconArrow = () => (
  <Svg>
    <path d="M5 19 17 7" />
    <path d="M10 7h7v7" />
  </Svg>
)

export const IconLaser = () => (
  <Svg>
    <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    <path d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20M6.4 6.4l1.7 1.7M15.9 15.9l1.7 1.7M17.6 6.4l-1.7 1.7M8.1 15.9l-1.7 1.7" />
  </Svg>
)

export const IconRect = () => (
  <Svg>
    <rect x="4" y="6" width="16" height="12" rx="2.5" />
  </Svg>
)

export const IconEllipse = () => (
  <Svg>
    <ellipse cx="12" cy="12" rx="8" ry="6" />
  </Svg>
)

export const IconText = () => (
  <Svg>
    <path d="M6 6.5h12" />
    <path d="M12 6.5V18" />
    <path d="M9 18h6" opacity="0.55" />
  </Svg>
)

/**
 * OBS — un écran et, dedans, la pastille « en direct ». C'est le bouton qui
 * copie l'adresse de la vue OBS : l'œil doit y reconnaître le logiciel de
 * diffusion avant même de lire l'infobulle.
 */
export const IconObs = () => (
  <Svg>
    <rect x="3" y="4.5" width="18" height="12" rx="2.2" />
    <circle cx="12" cy="10.5" r="2.6" />
    <path d="M8.5 20h7" />
  </Svg>
)

export const IconBadge = () => (
  <Svg>
    <circle cx="8.5" cy="8.5" r="4" />
    <circle cx="16" cy="16.5" r="4" />
    <path d="M11.4 11.2l2.2 2.4" opacity="0.6" strokeDasharray="1.6 2" />
  </Svg>
)

/**
 * JALONS — trois hexagones, aucun fil entre eux.
 *
 * C'est le contraire exact de l'icône du numéroteur, qui montre justement deux
 * pastilles RELIÉES par un pointillé : l'œil comprend la différence entre les
 * deux outils sans lire une seule étiquette.
 */
export const IconJalon = () => (
  <Svg>
    <path d="M8 3.6 11.4 5.6v4L8 11.6 4.6 9.6v-4z" />
    <path d="M17 7.6 20.4 9.6v4L17 15.6 13.6 13.6v-4z" opacity="0.85" />
    <path d="M9.5 15 12.9 17v4L9.5 23 6.1 21v-4z" opacity="0.7" />
  </Svg>
)

/** Calque fantôme : deux pages décalées, celle du dessous en pointillé. */
export const IconFantome = () => (
  <Svg>
    <rect x="7" y="7" width="13" height="13" rx="2" />
    <path d="M4 15V6a2 2 0 0 1 2-2h9" opacity="0.45" strokeDasharray="2.2 2" />
  </Svg>
)

export const IconMeasure = () => (
  <Svg>
    <path d="M4.5 19.5 19.5 4.5" />
    <path d="M3.4 17.2 6.8 20.6M7.6 13 10.4 15.8M11.8 8.8 15.2 12.2M16 4.6 19.4 8" opacity="0.75" />
  </Svg>
)

export const IconWand = () => (
  <Svg>
    <path d="M5 19 15.5 8.5" />
    <path d="m14 5.5 1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" />
    <path d="M19 14.4l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" opacity="0.7" />
  </Svg>
)

export const IconMagnet = () => (
  <Svg>
    <path d="M6 5v7a6 6 0 0 0 12 0V5" />
    <path d="M6 10.5h4M14 10.5h4" />
  </Svg>
)

export const IconEraser = () => (
  <Svg>
    <path d="M5.5 14.5 12 8a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L9.5 18.5H7l-1.5-1.5a2 2 0 0 1 0-2.5z" />
    <path d="M6 21h12" opacity="0.5" />
  </Svg>
)

/** Œil : les annotations sont à l'écran. */
export const IconEye = () => (
  <Svg>
    <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3.1" />
  </Svg>
)

/** Œil barré : les annotations sont masquées (rien n'est perdu). */
export const IconEyeOff = () => (
  <Svg>
    <path d="M4.2 8.4C3 9.9 2.5 12 2.5 12s3.5 5.5 9.5 5.5c1.5 0 2.8-.35 3.9-.87" />
    <path d="M9.3 7c.85-.32 1.75-.5 2.7-.5 6 0 9.5 5.5 9.5 5.5s-1 1.6-2.8 3.1" opacity="0.75" />
    <path d="M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3" />
    <path d="M4 4l16 16" />
  </Svg>
)

export const IconUndo = () => (
  <Svg>
    <path d="M8 7 4 11l4 4" />
    <path d="M4 11h10a6 6 0 0 1 6 6v1" />
  </Svg>
)

export const IconRedo = () => (
  <Svg>
    <path d="m16 7 4 4-4 4" />
    <path d="M20 11H10a6 6 0 0 0-6 6v1" />
  </Svg>
)

export const IconClear = () => (
  <Svg>
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="m6 7 1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" opacity="0.6" />
  </Svg>
)

export const IconTimer = () => (
  <Svg>
    <circle cx="12" cy="13" r="7" />
    <path d="M12 10v3l2 2" />
    <path d="M9.5 3h5" />
  </Svg>
)

export const IconInfinity = () => (
  <Svg>
    <path d="M6.2 12c0-1.7 1.2-2.9 2.8-2.9 2.7 0 3.3 5.8 6 5.8 1.6 0 2.8-1.2 2.8-2.9s-1.2-2.9-2.8-2.9c-2.7 0-3.3 5.8-6 5.8-1.6 0-2.8-1.2-2.8-2.9z" />
  </Svg>
)

export const IconSparkles = () => (
  <Svg>
    <path d="M12 5.5 13.3 9l3.5 1.3-3.5 1.3L12 15l-1.3-3.4L7.2 10.3 10.7 9z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" opacity="0.7" />
  </Svg>
)

export const IconGear = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
  </Svg>
)

export const IconExport = () => (
  <Svg>
    <path d="M12 14V4" />
    <path d="m8 8 4-4 4 4" />
    <path d="M5 15v4h14v-4" />
  </Svg>
)

export const IconPing = () => (
  <Svg>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="5.5" opacity="0.75" />
    <circle cx="12" cy="12" r="9" opacity="0.35" />
  </Svg>
)

export const IconSpotlight = () => (
  <Svg>
    <circle cx="12" cy="12" r="4.6" />
    <path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2" opacity="0.55" />
    <path
      d="M6.3 6.3 4.8 4.8M17.7 17.7l1.5 1.5M17.7 6.3l1.5-1.5M6.3 17.7l-1.5 1.5"
      opacity="0.35"
    />
  </Svg>
)

export const IconSound = () => (
  <Svg>
    <path d="M5 9.5h3l4-3.2v11.4l-4-3.2H5z" />
    <path d="M15.6 9.2a4 4 0 0 1 0 5.6" opacity="0.8" />
    <path d="M18 6.8a7.4 7.4 0 0 1 0 10.4" opacity="0.45" />
  </Svg>
)

export const IconMute = () => (
  <Svg>
    <path d="M5 9.5h3l4-3.2v11.4l-4-3.2H5z" />
    <path d="m16 10 4 4M20 10l-4 4" opacity="0.8" />
  </Svg>
)

/** Mode écriture : le gribouillis (la vague du bas) devient une capitale nette. */
export const IconScript = () => (
  <Svg>
    <path d="M4.2 16.4 10 4.6l5.8 11.8" />
    <path d="M6.6 12.2h6.8" />
    <path d="M3.6 21c1.8-1.7 3.6.9 5.4-.4s3.6 1.1 5.4-.6" opacity="0.55" />
    <path d="M19.4 3.6l.85 2.15 2.15.85-2.15.85-.85 2.15-.85-2.15L16.4 6.6l2.15-.85z" />
  </Svg>
)

/** Loupe (§6) : le disque grossissant et son manche. */
export const IconMagnifier = () => (
  <Svg>
    <circle cx="10.6" cy="10.6" r="6.4" />
    <path d="m15.4 15.4 4.4 4.4" />
    <path d="M8.4 10.6h4.4M10.6 8.4v4.4" opacity="0.6" />
  </Svg>
)

/** Gel d'image (§5.5) : un flocon posé sur un cadre photo. */
export const IconFreeze = () => (
  <Svg>
    <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4" />
    <path d="M12 8v8M8.6 9.9l6.8 4.2M15.4 9.9l-6.8 4.2" />
  </Svg>
)

/** Masque flou (§5.6) : un rectangle dont le contenu se dilue. */
export const IconBlur = () => (
  <Svg>
    <rect x="3.4" y="6" width="17.2" height="12" rx="2.2" />
    <path d="M6.4 10h11" opacity="0.85" />
    <path d="M6.4 13h11" opacity="0.55" />
    <path d="M6.4 16h7" opacity="0.3" />
  </Svg>
)

/** Avant/après (§5.7) : le curseur vertical entre deux moitiés. */
export const IconCompare = () => (
  <Svg>
    <rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.2" />
    <path d="M12 4v16" />
    <path d="M8.6 10.2 6.4 12l2.2 1.8M15.4 10.2 17.6 12l-2.2 1.8" opacity="0.75" />
  </Svg>
)

/* ---- éléments posés à l'écran (§5.8) : grille, chrono, notes ---- */

/** Grille et règle des tiers (§5.8.1). */
export const IconGrid = () => (
  <Svg>
    <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.2" />
    <path d="M9.1 3.6v16.8M14.9 3.6v16.8M3.6 9.1h16.8M3.6 14.9h16.8" opacity="0.72" />
  </Svg>
)

/** Chronomètre (§5.8.2) — distinct du sablier du fondu automatique. */
export const IconStopwatch = () => (
  <Svg>
    <circle cx="12" cy="13.6" r="7.2" />
    <path d="M12 10.2v3.4l2.2 1.6" />
    <path d="M9.6 2.8h4.8" />
    <path d="M18.4 6.6l1.4-1.4" opacity="0.7" />
  </Svg>
)

/** Note posée à l'écran (§5.8.3) : un coin replié. */
export const IconNote = () => (
  <Svg>
    <path d="M5 4.4h9.4L19 9v10.6H5V4.4z" />
    <path d="M14.2 4.6V9H19" opacity="0.75" />
    <path d="M8 12.4h7M8 15.6h4.6" opacity="0.6" />
  </Svg>
)

/** Croix de fermeture d'un élément posé — discrète, apparaît au survol. */
export const IconCross = () => (
  <Svg>
    <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" strokeWidth="2" />
  </Svg>
)

export const IconPlay = () => (
  <Svg>
    <path d="M8.4 5.6 18 12l-9.6 6.4V5.6z" fill="currentColor" strokeWidth="1.4" />
  </Svg>
)

export const IconPause = () => (
  <Svg>
    <path d="M9.2 5.4v13.2M14.8 5.4v13.2" strokeWidth="2.6" />
  </Svg>
)

export const IconReset = () => (
  <Svg>
    <path d="M4.6 12a7.4 7.4 0 1 0 2.3-5.4" />
    <path d="M4.4 4.6v4.2h4.2" />
  </Svg>
)

/** Aide (touche ?) — le seul bouton qu'on cherche quand on est perdu. */
export const IconHelp = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9.2a2.8 2.8 0 1 1 3.4 3.2c-.6.2-.9.7-.9 1.3v.5" strokeWidth="2" />
    <path d="M12 17.4v.2" strokeWidth="2.6" />
  </Svg>
)

export const HexaLogo = () => (
  <svg width="22" height="24" viewBox="0 0 32 34" fill="none" aria-hidden>
    <defs>
      <linearGradient id="hexa-g" x1="0" y1="0" x2="32" y2="34">
        <stop offset="0" style={{ stopColor: 'var(--logo-a, #00e5ff)' }} />
        <stop offset="1" style={{ stopColor: 'var(--logo-b, #b026ff)' }} />
      </linearGradient>
    </defs>
    <path
      d="M16 2 29 9.5v15L16 32 3 24.5v-15L16 2z"
      stroke="url(#hexa-g)"
      strokeWidth="2.4"
      strokeLinejoin="round"
    />
    <circle cx="16" cy="17" r="4" fill="url(#hexa-g)" opacity="0.9" />
  </svg>
)

/* ------------------------------------------------------------------ *
 * Pages, épinglage, export image, barre qui s'efface
 * ------------------------------------------------------------------ */

export const IconPin = () => (
  <Svg>
    <path d="M14.5 3.5 20.5 9.5l-2.2.8-3.6 3.6.4 3.6-2.1 2.1-4-4L4 20.5l-.5-.5 5-5-4-4 2.1-2.1 3.6.4 3.6-3.6z" />
  </Svg>
)

export const IconImage = () => (
  <Svg>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m4 17 5-5 3.5 3.5L15 13l5 4" />
  </Svg>
)

export const IconFadeBar = () => (
  <Svg>
    <rect x="4" y="5" width="16" height="14" rx="3" strokeDasharray="3 2.4" />
    <path d="M8 12h8" opacity="0.5" />
  </Svg>
)
