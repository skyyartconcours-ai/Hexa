/**
 * Hexa — vue OBS (page obs.html, à mettre dans une browser source).
 *
 * Fond 100 % transparent, aucune interface, aucun clic : uniquement les
 * annotations, rendues par le moteur de Hexa (§10.2). Deux sources possibles :
 *
 *  1. WebSocket vers le serveur local d'Hexa (overlay Electron). L'URL est
 *     injectée par le serveur dans la page (window.__HEXA_OBS_WS) et peut être
 *     forcée avec ?ws=ws://127.0.0.1:4787 ;
 *  2. BroadcastChannel, en démo navigateur : ouvre simplement obs.html dans un
 *     second onglet du même serveur, c'est synchronisé sans rien installer.
 *
 * Un voile d'attente très discret s'affiche tant qu'aucun état n'est arrivé,
 * puis disparaît définitivement (jamais visible à l'antenne). ?bare=1 le retire.
 */
import { useEffect, useRef, useState } from 'react'
import type { Stroke } from '../engine/types'
import { ObsMirror } from './mirror'
import { isObsMessage, OBS_CHANNEL, OBS_HELLO, parseObsMessage, type ObsMessage } from './protocol'

/** Reconnexion WebSocket : progressive, bornée, jamais agressive. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 12_000]

function query(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

function wsUrl(): string | null {
  const forced = query('ws')
  if (forced) return forced
  const injected = (window as unknown as { __HEXA_OBS_WS?: string }).__HEXA_OBS_WS
  return typeof injected === 'string' && injected ? injected : null
}

export function ObsView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mirrorRef = useRef<ObsMirror | null>(null)
  const [live, setLive] = useState(false)
  const [linked, setLinked] = useState(false)
  // Filet de sécurité pour l'antenne : même si Hexa n'est jamais joignable, la
  // carte d'attente s'efface toute seule. Rien d'Hexa ne doit rester affiché
  // devant les spectateurs.
  const [expired, setExpired] = useState(false)
  const bare = query('bare') === '1'

  useEffect(() => {
    const t = setTimeout(() => setExpired(true), 20_000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const mirror = new ObsMirror(canvas)
    mirrorRef.current = mirror
    mirror.onFirstState = () => setLive(true)

    const onResize = () => mirror.resize()
    window.addEventListener('resize', onResize)

    /* --- injection directe : tests, captures, démonstrations ----------- */
    const inject = (payload: unknown): void => {
      if (isObsMessage(payload)) {
        mirror.apply(payload)
        return
      }
      // tolérance : on accepte une session brute { strokes: [...] }
      const strokes = (payload as { strokes?: Stroke[] } | null)?.strokes
      if (Array.isArray(strokes)) {
        mirror.apply({ t: 'state:full', now: performance.now(), strokes, mode: 'screen' })
      }
    }
    ;(window as unknown as { __hexaObsInject?: (p: unknown) => void }).__hexaObsInject = inject

    /* --- transport 1 : WebSocket (overlay Electron) --------------------- */
    const url = wsUrl()
    let socket: WebSocket | null = null
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = (): void => {
      if (closed || !url) return
      try {
        socket = new WebSocket(url)
      } catch {
        schedule()
        return
      }
      socket.onmessage = (e: MessageEvent) => {
        const msg = typeof e.data === 'string' ? parseObsMessage(e.data) : null
        if (msg) mirror.apply(msg)
      }
      socket.onopen = () => {
        retry = 0
        setLinked(true)
        // « Je viens d'ouvrir, envoie-moi tout. » C'est CE message qui fait
        // qu'une source navigateur ajoutée en pleine session — ou rechargée par
        // OBS au changement de scène — affiche les annotations déjà présentes
        // au lieu de rester vide jusqu'au trait suivant.
        try {
          socket?.send(JSON.stringify(OBS_HELLO))
        } catch {
          /* le serveur renverra de toute façon son dernier état complet */
        }
      }
      socket.onclose = () => {
        socket = null
        setLinked(false)
        schedule()
      }
      socket.onerror = () => {
        try {
          socket?.close()
        } catch {
          /* ignore */
        }
      }
    }

    const schedule = (): void => {
      if (closed || retryTimer) return
      const delay = BACKOFF[Math.min(retry++, BACKOFF.length - 1)]
      retryTimer = setTimeout(() => {
        retryTimer = null
        connect()
      }, delay)
    }

    if (url) connect()

    /* --- transport 2 : BroadcastChannel (démo navigateur) --------------- */
    let channel: BroadcastChannel | null = null
    if (!url && typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(OBS_CHANNEL)
        channel.onmessage = (e: MessageEvent) => {
          const data: unknown = e.data
          if (isObsMessage(data)) mirror.apply(data as ObsMessage)
        }
        // « je viens d'ouvrir, envoie-moi tout »
        channel.postMessage({ t: 'obs:hello' })
      } catch {
        channel = null
      }
    }

    return () => {
      closed = true
      window.removeEventListener('resize', onResize)
      if (retryTimer) clearTimeout(retryTimer)
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
      channel?.close()
      mirror.destroy()
      mirrorRef.current = null
      delete (window as unknown as { __hexaObsInject?: unknown }).__hexaObsInject
    }
  }, [])

  return (
    <div className="obs-root">
      <canvas ref={canvasRef} className="obs-canvas" />
      {!bare && !live && !expired && (
        <div className="obs-wait" data-linked={linked ? 'oui' : 'non'}>
          <span className="obs-dot" />
          <div>
            <b>Hexa · vue OBS</b>
            {linked ? (
              <p>
                Connexion établie. Dessine sur ton écran : les annotations arrivent ici. Cette carte
                disparaît toute seule.
              </p>
            ) : (
              <p>
                En attente d'Hexa. Vérifie qu'Hexa est lancé et que l'adresse est bien celle
                affichée dans ses réglages, section OBS. Cette carte s'efface au bout de 20 s.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ObsView
