/**
 * Hexa — la recette de la DISSOLUTION, écrite une seule fois.
 *
 * Un trait qui meurt doit mourir EXACTEMENT au même instant sur l'écran du
 * streamer, dans la vue OBS, dans le rejeu et dans l'export : c'est la même
 * annotation vue de quatre endroits. Tant que la formule était recopiée dans
 * `engine.ts`, dans `replay/paint.ts` et dans `obs/mirror.ts`, un réglage
 * modifié d'un seul côté faisait persister l'encre chez le spectateur après
 * qu'elle avait disparu chez le coach. Une seule source, donc, ici.
 *
 * Aucun état, aucune boucle, aucune dépendance : de la géométrie temporelle.
 */
import type { Stroke } from './types'
import { clamp } from './geometry'

/** durée minimale d'une dissolution (trait court) */
export const DISSOLVE_MIN = 420
/** durée maximale d'une dissolution (trait très long) */
export const DISSOLVE_MAX = 1200

/**
 * Touche panique (§169 du brief) : « efface tout instantanément, avec un fondu
 * de 200 ms ». Le décalage en cascade est PLAFONNÉ — il est là pour le plaisir
 * de l'œil, jamais pour retarder la disparition. Un tableau de 150 annotations
 * doit quitter l'écran aussi vite qu'un tableau de 3 : c'est toute la raison
 * d'être de cette touche.
 */
export const PANIC_FADE_MS = 200
const PANIC_STEP_MS = 45
const PANIC_MAX_STEPS = 6
/** pire cas, du bout du doigt à l'écran net */
export const PANIC_TOTAL_MS = PANIC_MAX_STEPS * PANIC_STEP_MS + PANIC_FADE_MS

/** Un trait long met un peu plus de temps à se dissoudre qu'un point. */
export function dissolveDuration(s: Stroke): number {
  return clamp(DISSOLVE_MIN + s.points.length * 2.2, DISSOLVE_MIN, DISSOLVE_MAX)
}

/**
 * Braise de tête, au fil de la dissolution (0 → 1).
 *
 * ⚠️ ELLE DOIT S'ÉTEINDRE AVEC LE TRAIT. Son intensité était figée à
 * `1 - p * 0.4` : à la toute fin, le trait avait complètement disparu et il
 * restait une bille lumineuse à 60 % d'opacité, seule sur un écran vide, qui
 * s'éteignait d'un coup à l'image suivante. Sur un ralenti c'est la première
 * chose qu'on voit — la dissolution finissait sur une tache, pas sur un souffle.
 * Ici la braise perd sa force et se referme sur le dernier quart, exactement là
 * où le micro-éclat final (`paintLastFlash`) prend le relais.
 */
export function emberAt(p: number): { alpha: number; scale: number } {
  const q = clamp(p, 0, 1)
  const fade = q < 0.7 ? 1 - q * 0.25 : (1 - q) * 2.75
  return { alpha: clamp(fade, 0, 1), scale: 0.62 + 0.38 * (1 - q) }
}

/**
 * État de mort à poser sur le `i`-ème trait effacé par la touche panique.
 * `i` est le rang dans la cascade : au-delà du plafond, tout part ensemble.
 */
export function panicDying(i: number, now: number): NonNullable<Stroke['dying']> {
  return {
    start: now + Math.min(i, PANIC_MAX_STEPS) * PANIC_STEP_MS,
    duration: PANIC_FADE_MS,
    mode: 'dissolve',
    cause: 'panic',
  }
}
