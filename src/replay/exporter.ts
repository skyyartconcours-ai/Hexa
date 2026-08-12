/**
 * Hexa — exports (brief §11.2).
 *
 *  - PNG TRANSPARENT haute résolution de la seule couche d'annotation. Les
 *    traits sont vectoriels : on rend dans un canvas hors écran à l'échelle
 *    1×, 2× ou 4× sans la moindre perte, même si la session a été faite en
 *    direct sur un écran 1080p.
 *  - JSON de session (format inchangé, compatible avec engine.loadSession).
 *  - Clip WebM du rejeu, avec un avertissement honnête sur la transparence.
 *
 * Aucune dépendance : canvas 2D, Blob, MediaRecorder natif.
 */
import type { SessionExport, Stroke } from '../engine/types'
import { paintStrokes, strokesBounds } from './paint'

export type PngScale = 1 | 2 | 4

export interface PngOptions {
  /** facteur d'échelle : 1×, 2× ou 4× la taille d'écran */
  scale: PngScale
  /** largeur/hauteur de la scène d'origine (par défaut : la fenêtre) */
  width?: number
  height?: number
  /** recadrer au contenu au lieu de garder tout l'écran */
  crop?: boolean
  /** fond opaque (par défaut : transparent, c'est tout l'intérêt) */
  background?: string | null
}

/** Aplatit une session : tout est posé, rien ne meurt, rien n'anime. */
export function flatten(session: SessionExport): Stroke[] {
  return session.strokes
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const c = structuredClone(s)
      c.dying = undefined
      c.anim = undefined
      c.dieAt = undefined
      c.done = true
      return c
    })
}

/**
 * Rend une session dans un canvas hors écran. Renvoie null si la session est
 * vide (rien à exporter, on ne fabrique pas un PNG transparent inutile).
 */
export function renderSessionToCanvas(
  session: SessionExport,
  opts: PngOptions,
): HTMLCanvasElement | null {
  const strokes = flatten(session)
  if (strokes.length === 0) return null

  const vw = opts.width ?? window.innerWidth
  const vh = opts.height ?? window.innerHeight
  let ox = 0
  let oy = 0
  let w = vw
  let h = vh
  if (opts.crop) {
    const b = strokesBounds(strokes)
    if (b) {
      ox = Math.floor(b.x)
      oy = Math.floor(b.y)
      w = Math.max(1, Math.ceil(b.w))
      h = Math.max(1, Math.ceil(b.h))
    }
  }

  const scale = opts.scale
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w * scale))
  cv.height = Math.max(1, Math.round(h * scale))
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  if (opts.background) {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, cv.width, cv.height)
  }
  ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale)
  // `now` très grand : aucune animation résiduelle, tout est à son état final
  paintStrokes(ctx, strokes, Number.MAX_SAFE_INTEGER, { ember: false })
  return cv
}

/** PNG transparent de la couche d'annotation, prêt à être téléchargé. */
export function exportSessionPng(session: SessionExport, opts: PngOptions): Promise<Blob | null> {
  const cv = renderSessionToCanvas(session, opts)
  if (!cv) return Promise.resolve(null)
  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'))
}

/** Télécharge un blob sous un nom donné (aucune écriture disque cachée). */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.click()
  // laisser le temps au navigateur de démarrer le téléchargement
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Nom de fichier horodaté, lisible et triable : hexa-2026-08-12_14-32-05. */
export function stampName(prefix: string, ext: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(
    d.getMinutes(),
  )}-${p(d.getSeconds())}`
  return `${prefix}-${stamp}.${ext}`
}

export function downloadSessionJson(session: SessionExport): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })
  download(blob, stampName('hexa-session', 'json'))
}

/** Lit un fichier .json de session et le valide sommairement. */
export async function readSessionFile(file: File): Promise<SessionExport | null> {
  try {
    const text = await file.text()
    const data = JSON.parse(text) as Partial<SessionExport>
    if (data.app !== 'hexa' || !Array.isArray(data.strokes)) return null
    return {
      app: 'hexa',
      version: 1,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
      strokes: data.strokes as Stroke[],
    }
  } catch {
    return null
  }
}

/** Ouvre le sélecteur de fichier et renvoie la session choisie (ou null). */
export function pickSessionFile(): Promise<SessionExport | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      void readSessionFile(f).then(resolve)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/* ------------------------------------------------------------------ *
 * Clip vidéo du rejeu
 *
 * HONNÊTETÉ : MediaRecorder ne conserve PAS le canal alpha. Le WebM produit
 * est donc sur fond noir. Deux usages valides :
 *   1. l'importer dans OBS/le montage avec un mode de fusion « Écran »
 *      (additif) : le noir devient invisible, les néons restent ;
 *   2. préférer l'export PNG transparent (ou une séquence) pour une vraie
 *      incrustation propre.
 * ------------------------------------------------------------------ */

export const CLIP_ALPHA_WARNING =
  'Le WebM ne conserve pas la transparence : le clip est sur fond noir. ' +
  'Dans OBS ou au montage, passe la source en mode de fusion « Écran » — ' +
  'le noir disparaît, les néons restent. Pour une incrustation parfaite, ' +
  'préfère le PNG transparent.'

export function canRecordClip(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

export interface ClipHandle {
  stop: () => Promise<Blob | null>
}

/** Démarre l'enregistrement d'un canvas (le canvas de rejeu). */
export function recordClip(canvas: HTMLCanvasElement, fps = 60): ClipHandle | null {
  if (!canRecordClip()) return null
  let rec: MediaRecorder
  try {
    const stream = canvas.captureStream(fps)
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : {})
  } catch {
    return null
  }
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  rec.start(250)
  return {
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        if (rec.state === 'inactive') return resolve(null)
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))
        try {
          rec.stop()
        } catch {
          resolve(null)
        }
      }),
  }
}
