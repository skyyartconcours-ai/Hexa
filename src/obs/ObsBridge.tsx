/**
 * Hexa — pont OBS monté une fois par l'application.
 *
 * Trois responsabilités, aucune interface lourde :
 *  1. brancher/débrancher le miroir d'annotations (§10.2) ;
 *  2. démarrer le serveur local qui sert obs.html (overlay Electron) ;
 *  3. tenir la connexion obs-websocket v5 et effacer l'écran au changement de
 *     scène (§7.3).
 *
 * Le seul pixel qu'il dessine est un point d'état minuscule en bas à droite,
 * visible uniquement quand l'utilisateur a activé quelque chose. Hexa doit
 * rester parfait sans OBS.
 */
import { useEffect, useState } from 'react'
import { useUiStore } from '../store'
import { obsLink } from './link'
import { obsWsClient, statusLabel, type ObsWsStatus } from './client'
import './obs-bridge.css'

/** Surface Electron ajoutée par le preload (voir electron/preload.ts). */
interface ObsServerHost {
  obsServer?: (cfg: { enabled: boolean; port: number }) => Promise<unknown>
  on?: (channel: string, cb: (...args: unknown[]) => void) => () => void
}

function host(): ObsServerHost | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { hexa?: ObsServerHost }).hexa
}

export interface ObsBridgeProps {
  /** appelé au changement de scène OBS : l'app efface la couche */
  onSceneChange: () => void
}

export function ObsBridge({ onSceneChange }: ObsBridgeProps) {
  const mirror = useUiStore((s) => s.obsMirror)
  const mode = useUiStore((s) => s.obsMode)
  const serverOn = useUiStore((s) => s.obsServerOn)
  const port = useUiStore((s) => s.obsPort)
  const wsEnabled = useUiStore((s) => s.obsWsEnabled)
  const wsHost = useUiStore((s) => s.obsWsHost)
  const wsPort = useUiStore((s) => s.obsWsPort)
  const wsPassword = useUiStore((s) => s.obsWsPassword)
  const clearOnScene = useUiStore((s) => s.obsClearOnScene)

  const [status, setStatus] = useState<ObsWsStatus>('off')
  const [scene, setScene] = useState('')
  const [clients, setClients] = useState(0)

  // 1. miroir d'annotations
  useEffect(() => {
    obsLink.setEnabled(mirror)
  }, [mirror])

  useEffect(() => {
    obsLink.setMode(mode)
    // « Stream seul » : l'écran du streamer reste propre, seule la browser
    // source affiche les annotations (§10.2)
    document.body.classList.toggle('obs-stream-only', mode === 'stream')
  }, [mode])

  // 2. serveur local (no-op en démo navigateur : BroadcastChannel suffit)
  useEffect(() => {
    const h = host()
    if (!h?.obsServer) return
    void h.obsServer({ enabled: serverOn, port })
  }, [serverOn, port])

  useEffect(() => {
    const h = host()
    if (!h?.on) return
    return h.on('obs-clients', (...args: unknown[]) => {
      const n = args[0]
      setClients(typeof n === 'number' ? n : 0)
    })
  }, [])

  // 3. client obs-websocket
  useEffect(() => {
    obsWsClient.onStatus = (s, sc) => {
      setStatus(s)
      setScene(sc)
    }
    obsWsClient.onSceneChange = () => onSceneChange()
    obsWsClient.configure({
      enabled: wsEnabled,
      host: wsHost,
      port: wsPort,
      password: wsPassword,
      clearOnScene,
    })
  }, [wsEnabled, wsHost, wsPort, wsPassword, clearOnScene, onSceneChange])

  const show = wsEnabled || mode === 'stream' || (serverOn && clients > 0)
  if (!show) return null

  const title =
    (wsEnabled ? `OBS ${statusLabel(status)}${scene ? ` · scène « ${scene} »` : ''}` : 'Miroir OBS') +
    (clients > 0 ? ` · ${clients} vue${clients > 1 ? 's' : ''}` : '')

  return (
    <div className="obs-pill" data-status={wsEnabled ? status : 'mirror'} title={title}>
      <span className="obs-pill-dot" />
      <span className="obs-pill-text">
        {mode === 'stream' ? 'Stream seul' : 'OBS'}
        {clients > 0 ? ` · ${clients}` : ''}
      </span>
    </div>
  )
}

export default ObsBridge
