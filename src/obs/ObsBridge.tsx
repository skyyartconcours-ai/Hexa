/**
 * Hexa — pont OBS monté une fois par l'application.
 *
 * Quatre responsabilités, aucune interface lourde :
 *  1. brancher/débrancher le miroir d'annotations (§10.2) ;
 *  2. démarrer le serveur local qui sert obs.html (overlay Electron) ;
 *  3. répondre aux sources navigateur qui réclament l'état complet ;
 *  4. tenir la connexion obs-websocket v5 et effacer l'écran au changement de
 *     scène (§7.3).
 *
 * Le seul pixel qu'il dessine est une pastille d'état minuscule en bas à droite,
 * visible uniquement quand l'utilisateur a activé quelque chose. Hexa doit
 * rester parfait sans OBS.
 *
 * Un garde-fou compte plus que tout le reste : en mode « Stream seul », les
 * annotations n'existent QUE dans la source navigateur. Si personne n'est
 * connecté, le streamer dessine dans le vide sans le savoir. La pastille passe
 * alors en alerte, et le mode force l'allumage du miroir et du serveur.
 */
import { useEffect, useState } from 'react'
import { useUiStore } from '../store'
import { obsLink } from './link'
import { obsWsClient, statusLabel, type ObsWsStatus } from './client'
import { obsServerInfo, setObsClients, setObsServerInfo, subscribeObsServer } from './status'
import './obs-bridge.css'

/** Surface Electron ajoutée par le preload (voir electron/preload.ts). */
interface ObsServerHost {
  obsServer?: (cfg: { enabled: boolean; port: number }) => Promise<unknown>
  obsStatus?: () => Promise<unknown>
  on?: (channel: string, cb: (...args: unknown[]) => void) => () => void
}

function host(): ObsServerHost | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { hexa?: ObsServerHost }).hexa
}

/** Vues connectées d'après un état de serveur brut (0 si le serveur est éteint). */
function nombreDeVues(info: unknown): number {
  if (typeof info !== 'object' || info === null) return 0
  const r = info as { running?: unknown; clients?: unknown }
  if (r.running !== true) return 0
  return typeof r.clients === 'number' && r.clients > 0 ? Math.round(r.clients) : 0
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
  const setObs = useUiStore((s) => s.setObs)

  const [status, setStatus] = useState<ObsWsStatus>('off')
  const [scene, setScene] = useState('')
  const [clients, setClients] = useState(0)

  const isElectron = !!host()?.obsServer

  // 1. miroir d'annotations — forcé en mode « Stream seul », sinon le streamer
  //    dessinerait dans le vide.
  useEffect(() => {
    obsLink.setEnabled(mirror || mode === 'stream')
  }, [mirror, mode])

  useEffect(() => {
    obsLink.setMode(mode)
    // « Stream seul » : l'écran du streamer reste propre, seule la source
    // navigateur affiche les annotations (§10.2)
    document.body.classList.toggle('obs-stream-only', mode === 'stream')
  }, [mode])

  // Choisir « Stream seul » allume ce qu'il faut pour que ça marche vraiment.
  useEffect(() => {
    if (mode !== 'stream') return
    if (!mirror) setObs({ obsMirror: true })
    if (isElectron && !serverOn) setObs({ obsServerOn: true })
  }, [mode, mirror, serverOn, isElectron, setObs])

  // 2. serveur local (no-op en démo navigateur : BroadcastChannel suffit)
  useEffect(() => {
    const h = host()
    if (!h?.obsServer) return
    void h.obsServer({ enabled: serverOn, port }).then((info) => {
      setObsServerInfo(info)
      // Serveur éteint = plus aucune vue possible : le miroir se tait.
      obsLink.setViewers(nombreDeVues(info))
    })
  }, [serverOn, port])

  // État réel du serveur au montage (l'application a pu être rechargée).
  useEffect(() => {
    const h = host()
    if (!h?.obsStatus) return
    void h.obsStatus().then((info) => {
      setObsServerInfo(info)
      const n = nombreDeVues(info)
      setClients(n)
      obsLink.setViewers(n)
    })
  }, [])

  // 3. canaux poussés par le processus principal
  useEffect(() => {
    const h = host()
    if (!h?.on) return
    const offClients = h.on('obs-clients', (...args: unknown[]) => {
      const n = args[0]
      const count = typeof n === 'number' ? n : 0
      setClients(count)
      setObsClients(count)
      // C'EST L'INTERRUPTEUR GÉNÉRAL DU MIROIR. Tant qu'il est à zéro, le
      // miroir ne balaie rien, ne clone rien, n'envoie rien. Passer au-dessus
      // de zéro déclenche l'envoi de l'état complet : une vue ajoutée en pleine
      // session voit l'écran tel qu'il est, sans attendre le trait suivant.
      obsLink.setViewers(count)
      // Ceinture et bretelles avec le « obs:hello » de la vue.
      if (count > 0) obsLink.requestFull()
    })
    const offFull = h.on('obs-full-request', () => obsLink.requestFull())
    const offStatus = h.on('obs-status', (...args: unknown[]) => setObsServerInfo(args[0]))
    return () => {
      offClients()
      offFull()
      offStatus()
    }
  }, [])

  // L'erreur du serveur (port occupé…) doit remonter jusqu'à la pastille.
  const [serverError, setServerError] = useState<string | undefined>(obsServerInfo().error)
  useEffect(() => subscribeObsServer(() => setServerError(obsServerInfo().error)), [])

  // 4. client obs-websocket
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

  const streamOnly = mode === 'stream'
  const blind = streamOnly && clients === 0
  const show = wsEnabled || streamOnly || (serverOn && clients > 0) || !!serverError
  if (!show) return null

  const state = blind || serverError ? 'alert' : wsEnabled ? status : 'mirror'
  const title = blind
    ? "Mode « Stream seul » : aucune source navigateur connectée. Rien ne part à l'antenne."
    : serverError
      ? `Serveur de la vue OBS : ${serverError}`
      : (wsEnabled ? `OBS ${statusLabel(status)}${scene ? ` · scène « ${scene} »` : ''}` : 'Miroir OBS') +
        (clients > 0 ? ` · ${clients} vue${clients > 1 ? 's' : ''}` : '')

  const label = blind
    ? 'Stream seul · aucune vue'
    : serverError
      ? 'OBS · erreur'
      : streamOnly
        ? 'Stream seul'
        : 'OBS'

  return (
    <div className="obs-pill" data-status={state} title={title}>
      <span className="obs-pill-dot" />
      <span className="obs-pill-text">
        {label}
        {!blind && clients > 0 ? ` · ${clients}` : ''}
      </span>
    </div>
  )
}

export default ObsBridge
