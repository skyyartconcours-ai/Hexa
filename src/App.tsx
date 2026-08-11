import { useEffect, useRef, useState } from 'react'
import { HexaEngine } from './engine/engine'
import type { ToolId } from './engine/types'
import { COLORS, useUiStore } from './store'
import { Toolbar } from './ui/Toolbar'
import { bridge, isElectron } from './bridge'

const TOOL_LABELS: Record<string, string> = {
  pen: 'Pinceau',
  highlight: 'Surligneur',
  line: 'Ligne',
  arrow: 'Flèche',
  laser: 'Laser',
  eraser: 'Gomme',
}

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const staticRef = useRef<HTMLCanvasElement | null>(null)
  const liveRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<HexaEngine | null>(null)
  const heldToolRef = useRef<ToolId | null>(null)

  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const theme = useUiStore((s) => s.theme)
  const settingsOpen = useUiStore((s) => s.settingsOpen)

  const [indicator, setIndicator] = useState<string | null>(null)
  const [passthrough, setPassthrough] = useState(false)

  // création du moteur (une seule fois)
  useEffect(() => {
    const engine = new HexaEngine(stageRef.current!, staticRef.current!, liveRef.current!)
    engineRef.current = engine
    engine.onActivity = (has) => bridge.notifyActivity(has)
    engine.onWheelCb = (e) => {
      e.preventDefault()
      const st = useUiStore.getState()
      st.setSize(Math.min(18, Math.max(2, st.size + (e.deltaY < 0 ? 1 : -1))))
    }
    bridge.on('panic-clear', () => engine.clear())
    bridge.on('toggle-draw', () => setPassthrough((p) => !p))
    return () => engine.destroy()
  }, [])

  // synchronisation store → moteur
  useEffect(() => {
    engineRef.current?.setOptions({ tool, color, size, fadeDelay, sparkles })
  }, [tool, color, size, fadeDelay, sparkles])

  // thème (8 designs, appliqués par attribut sur <html>)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // mode traversant : la fenêtre laisse passer les clics vers le jeu
  useEffect(() => {
    document.body.classList.toggle('passthrough', passthrough)
    bridge.setPassthrough(passthrough)
  }, [passthrough])

  // indicateur discret au changement d'outil (brief §9.6)
  useEffect(() => {
    setIndicator(TOOL_LABELS[tool] ?? tool)
    const t = setTimeout(() => setIndicator(null), 850)
    return () => clearTimeout(t)
  }, [tool])

  // raccourcis clavier
  useEffect(() => {
    const st = () => useUiStore.getState()
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const eng = engineRef.current
      if (!eng) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) eng.redo()
        else eng.undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        eng.redo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'p') st().setTool('pen')
      else if (k === 's') st().setTool('highlight')
      else if (k === 'l') st().setTool('line')
      else if (k === 'f') st().setTool('arrow')
      else if (k === 'e') st().setTool('eraser')
      else if (k === 'z' && !e.repeat) {
        // outil momentané (brief §8.5) : maintenir Z = laser, relâcher = outil précédent
        if (heldToolRef.current == null) {
          heldToolRef.current = st().tool
          st().setTool('laser')
        }
      } else if (k === 'c') eng.clear()
      else if (k === 'd') st().cycleFade()
      else if (k === '[') st().setSize(Math.max(2, st().size - 2))
      else if (k === ']') st().setSize(Math.min(18, st().size + 2))
      else if (k === 'escape') st().setSettingsOpen(false)
      else if (/^[1-7]$/.test(k)) st().setColor(COLORS[parseInt(k, 10) - 1])
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'z' && heldToolRef.current != null) {
        st().setTool(heldToolRef.current)
        heldToolRef.current = null
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const exportSession = () => {
    const eng = engineRef.current
    if (!eng) return
    const data = JSON.stringify(eng.exportSession(), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hexa-session-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={isElectron ? 'app' : 'app demo'}>
      {!isElectron && (
        <div className="wallpaper" aria-hidden>
          <div className="hint-card">
            <div className="hint-title">
              <span className="hexa-mark" /> Hexa · démo navigateur
            </div>
            <p>
              Dessine n'importe où. En version overlay (Electron), cette couche est transparente
              au-dessus de ton écran ou de ton jeu.
            </p>
            <ul>
              <li>
                <b>Clic droit</b> : attraper une annotation pour la déplacer
              </li>
              <li>
                <b>Molette</b> : taille · <b>1–7</b> : couleurs
              </li>
              <li>
                <b>D</b> : durée du fondu (2s/4s/8s/∞) · <b>C</b> : tout effacer
              </li>
              <li>
                <b>Maintenir Z</b> : laser momentané · <b>Shift</b> : angles 15°
              </li>
            </ul>
          </div>
        </div>
      )}

      <div ref={stageRef} className="stage" data-tool={tool}>
        <canvas ref={staticRef} />
        <canvas ref={liveRef} />
      </div>

      {/* liseré lumineux : seul repère indiquant que le mode dessin est actif (brief §9.7) */}
      {!passthrough && <div className="edge-glow" aria-hidden />}

      {indicator && (
        <div className="tool-indicator" key={indicator}>
          {indicator}
        </div>
      )}

      <Toolbar
        onUndo={() => engineRef.current?.undo()}
        onRedo={() => engineRef.current?.redo()}
        onClear={() => engineRef.current?.clear()}
        onExport={exportSession}
      />

      {settingsOpen && (
        <div className="settings-stub">
          <div className="settings-head">
            <b>Réglages</b>
            <button className="tbtn" onClick={() => useUiStore.getState().setSettingsOpen(false)}>
              ✕
            </button>
          </div>
          <p>Le panneau complet (8 thèmes, raccourcis, export) arrive dans la vague design.</p>
        </div>
      )}
    </div>
  )
}
