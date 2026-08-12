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

export const IconBadge = () => (
  <Svg>
    <circle cx="8.5" cy="8.5" r="4" />
    <circle cx="16" cy="16.5" r="4" />
    <path d="M11.4 11.2l2.2 2.4" opacity="0.6" strokeDasharray="1.6 2" />
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
