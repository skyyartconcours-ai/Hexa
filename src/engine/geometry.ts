export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export const easeInQuad = (t: number): number => t * t

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

export function pointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist(px, py, ax, ay)
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1)
  return dist(px, py, ax + t * dx, ay + t * dy)
}

const hexCache = new Map<string, [number, number, number]>()

export function hexToRgb(hex: string): [number, number, number] {
  let c = hexCache.get(hex)
  if (!c) {
    const n = parseInt(hex.slice(1), 16)
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    hexCache.set(hex, c)
  }
  return c
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/** mélange la couleur avec du blanc (t = part de blanc) — le cœur chaud des traits néon */
export function whiteMix(hex: string, t: number, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${Math.round(lerp(r, 255, t))},${Math.round(lerp(g, 255, t))},${Math.round(
    lerp(b, 255, t),
  )},${a})`
}
