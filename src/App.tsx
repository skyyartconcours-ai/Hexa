import { useEffect, useRef, useState } from 'react'
import { HexaEngine } from './engine/engine'
import type { ToolId } from './engine/types'
import { COLORS, useUiStore } from './store'
import { Toolbar } from './ui/Toolbar'
import { SettingsPanel } from './ui/SettingsPanel'
import { ReplayBar } from './ui/ReplayBar'
import { Onboarding } from './ui/Onboarding'
import { ObsBridge } from './obs/ObsBridge'
import { recorder } from './replay/recorder'
import { obsLink } from './obs/link'
import { setFxIntensity } from './replay/paint'
import { themeFromQuery } from './themes'
import { bridge, isElectron } from './bridge'
import {
  buildLookup,
  isKeyCaptureActive,
  matchAction,
  resolveKeymap,
  type KeymapAction,
} from './keymap'

const TOOL_LABELS: Record<string, string> = {
  pen: 'Pinceau',
  highlight: 'Surligneur',
  line: 'Ligne',
  arrow: 'Flèche',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Texte',
  badge: 'Numéroteur',
  measure: 'Mesure',
  stamp: 'Tampon d’image',
  laser: 'Laser',
  eraser: 'Gomme',
}

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const staticRef = useRef<HTMLCanvasElement | null>(null)
  const liveRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<HexaEngine | null>(null)
  const heldToolRef = useRef<ToolId | null>(null)
  /** touche physique qui tient l'outil momentané, pour le relâcher au bon keyup */
  const heldKeyRef = useRef<{ key: string; code: string } | null>(null)

  const tool = useUiStore((s) => s.tool)
  const color = useUiStore((s) => s.color)
  const size = useUiStore((s) => s.size)
  const fadeDelay = useUiStore((s) => s.fadeDelay)
  const sparkles = useUiStore((s) => s.sparkles)
  const smartShapes = useUiStore((s) => s.smartShapes)
  const guides = useUiStore((s) => s.guides)
  const linkBadges = useUiStore((s) => s.linkBadges)
  const theme = useUiStore((s) => s.theme)
  const effectIntensity = useUiStore((s) => s.effectIntensity)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const replayOpen = useUiStore((s) => s.replayOpen)
  const toolbarVisible = useUiStore((s) => s.toolbarVisible)
  const keymapPreset = useUiStore((s) => s.keymapPreset)
  const keymapOverrides = useUiStore((s) => s.keymapOverrides)

  const [indicator, setIndicator] = useState<string | null>(null)
  const [passthrough, setPassthrough] = useState(false)

  // création du moteur (une seule fois)
  useEffect(() => {
    const engine = new HexaEngine(stageRef.current!, staticRef.current!, liveRef.current!)
    engineRef.current = engine
    engine.onActivity = (has) => bridge.notifyActivity(has)
    // collage d'une image (§4.10) : le moteur demande le passage au tampon
    engine.onRequestTool = (t) => useUiStore.getState().setTool(t)
    engine.onWheelCb = (e) => {
      e.preventDefault()
      const st = useUiStore.getState()
      st.setSize(Math.min(18, Math.max(2, st.size + (e.deltaY < 0 ? 1 : -1))))
    }
    // §11 + §10.2 : l'enregistreur de session et le miroir OBS regardent le
    // moteur travailler. Appelé uniquement pendant une image active, donc
    // strictement rien au repos.
    engine.onMirror = (strokes, current) => {
      recorder.observe(strokes, current)
      obsLink.publish(strokes, current)
    }
    bridge.on('panic-clear', () => engine.clear())
    // 'toggle-draw' : bascule relative (compatibilité) — 'set-draw' : valeur
    // absolue envoyée par le processus principal, seule source fiable quand
    // plusieurs écrans se passent le mode dessin (§8.8).
    bridge.on('toggle-draw', () => setPassthrough((p) => !p))
    bridge.on('set-draw', (drawing) => setPassthrough(!drawing))
    return () => engine.destroy()
  }, [])

  // synchronisation store → moteur
  useEffect(() => {
    engineRef.current?.setOptions({
      tool,
      color,
      size,
      fadeDelay,
      sparkles,
      smartShapes,
      guides,
      linkBadges,
      effects: effectIntensity,
    })
  }, [tool, color, size, fadeDelay, sparkles, smartShapes, guides, linkBadges, effectIntensity])

  // intensité des effets : le moteur (halos), et aussi le rejeu, les exports
  // et la vue OBS, qui partagent la même recette de rendu
  useEffect(() => {
    setFxIntensity(effectIntensity)
    document.documentElement.style.setProperty('--fx-intensity', String(effectIntensity))
  }, [effectIntensity])

  // thème (8 designs, appliqués par attribut sur <html>)
  useEffect(() => {
    // ?theme=<id> impose un thème (démos, captures) et court-circuite le store
    document.documentElement.dataset.theme = themeFromQuery() ?? theme
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

  // ---------------------------------------------------------------
  // Clavier — TOUT passe par la table centralisée (src/keymap.ts).
  // Aucune touche n'est écrite en dur ici : le preset (Hexa ou
  // compatibilité Epic Pen) et les remaps utilisateur pilotent tout.
  // ---------------------------------------------------------------
  useEffect(() => {
    const bindings = resolveKeymap(keymapPreset, keymapOverrides)
    const lookup = buildLookup(bindings)
    const st = () => useUiStore.getState()

    /** outils momentanés : action → outil pris tant que la touche est tenue (§8.5) */
    const HOLD_TOOLS: Partial<Record<KeymapAction, ToolId>> = {
      'hold.laser': 'laser',
      'hold.spotlight': 'spotlight',
      'hold.magnifier': 'magnifier',
      'hold.freeze': 'freeze',
    }

    const TOOL_ACTIONS: Partial<Record<KeymapAction, ToolId>> = {
      'tool.pen': 'pen',
      'tool.highlight': 'highlight',
      'tool.line': 'line',
      'tool.arrow': 'arrow',
      'tool.rect': 'rect',
      'tool.ellipse': 'ellipse',
      'tool.text': 'text',
      'tool.badge': 'badge',
      'tool.measure': 'measure',
      'tool.stamp': 'stamp',
      'tool.eraser': 'eraser',
    }

    /** Raccourcis de la vague « formes » pas encore décrits par la table
     *  centrale. On ne les traite que si la touche n'est prise par personne :
     *  le jour où keymap.ts les intègre, ce repli devient inerte tout seul. */
    const extraKey = (e: KeyboardEvent): boolean => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
      const k = e.key.toLowerCase()
      if (k === 'm') st().setTool('measure')
      else if (k === 'w') st().toggleSmartShapes()
      else if (k === 'g') st().toggleGuides()
      else return false
      e.preventDefault()
      return true
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // saisie en cours (nom de profil, texte) ou capture d'un raccourci :
      // le clavier de l'app se tait complètement.
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (target?.isContentEditable) return
      if (isKeyCaptureActive()) return

      const eng = engineRef.current
      if (!eng) return
      const hit = matchAction(lookup, e)
      if (!hit) {
        extraKey(e)
        return
      }
      const { action } = hit

      // outil momentané : on mémorise l'outil courant, on le rend au relâchement
      const holdTool = HOLD_TOOLS[action]
      if (holdTool) {
        e.preventDefault()
        if (e.repeat || heldToolRef.current != null) return
        heldToolRef.current = st().tool
        heldKeyRef.current = { key: e.key.toLowerCase(), code: e.code }
        st().setTool(holdTool)
        return
      }

      const tool = TOOL_ACTIONS[action]
      if (tool) {
        e.preventDefault()
        st().setTool(tool)
        return
      }

      const color = /^color\.([1-7])$/.exec(action)
      if (color) {
        e.preventDefault()
        st().setColor(COLORS[parseInt(color[1], 10) - 1])
        return
      }

      switch (action) {
        case 'edit.undo':
          e.preventDefault()
          eng.undo()
          break
        case 'edit.redo':
          e.preventDefault()
          eng.redo()
          break
        case 'edit.clear':
          e.preventDefault()
          eng.clear()
          break
        case 'size.dec':
          e.preventDefault()
          st().setSize(Math.max(2, st().size - 2))
          break
        case 'size.inc':
          e.preventDefault()
          st().setSize(Math.min(18, st().size + 2))
          break
        case 'fade.cycle':
          e.preventDefault()
          st().cycleFade()
          break
        case 'toggle.smartShapes':
          e.preventDefault()
          st().toggleSmartShapes()
          break
        case 'toggle.guides':
          e.preventDefault()
          st().toggleGuides()
          break
        case 'toggle.linkBadges':
          e.preventDefault()
          st().toggleLinkBadges()
          break
        case 'ui.toolbar':
          e.preventDefault()
          st().toggleToolbar()
          break
        case 'ui.settings':
          e.preventDefault()
          st().setSettingsOpen(!st().settingsOpen)
          break
        case 'ui.close':
          st().setSettingsOpen(false)
          break
        case 'mode.draw':
          // En overlay, c'est Electron qui capte ce raccourci (globalShortcut) :
          // il doit marcher même quand le jeu a le focus. On ne le double pas ici,
          // sinon la bascule se ferait deux fois.
          if (!isElectron) {
            e.preventDefault()
            setPassthrough((p) => !p)
          }
          break
        case 'app.panic':
          if (!isElectron) {
            e.preventDefault()
            eng.clear()
          }
          break
        default:
          break
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const held = heldKeyRef.current
      if (!held || heldToolRef.current == null) return
      if (e.key.toLowerCase() !== held.key && e.code !== held.code) return
      st().setTool(heldToolRef.current)
      heldToolRef.current = null
      heldKeyRef.current = null
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [keymapPreset, keymapOverrides])

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
                <b>Formes intelligentes</b> : dessine un rectangle, un cercle ou une flèche à main
                levée, Hexa le redresse (Ctrl+Z rend le tracé brut)
              </li>
              <li>
                <b>R</b> rectangle · <b>O</b> ellipse · <b>T</b> texte · <b>N</b> numéroteur ·{' '}
                <b>M</b> mesure
              </li>
              <li>
                <b>Shift</b> : carré/cercle et angles 15° · <b>Alt</b> : forme remplie, guides
                suspendus
              </li>
              <li>
                <b>Ctrl+V</b> : coller une image, la molette la redimensionne
              </li>
              <li>
                <b>Clic droit</b> : attraper une annotation · <b>Molette</b> : taille · <b>1–7</b> :
                couleurs
              </li>
              <li>
                <b>D</b> : fondu (2s/4s/8s/∞) · <b>C</b> : tout effacer · <b>Maintenir Z</b> : laser
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

      {toolbarVisible && (
        <Toolbar
          onUndo={() => engineRef.current?.undo()}
          onRedo={() => engineRef.current?.redo()}
          onClear={() => engineRef.current?.clear()}
          onExport={exportSession}
        />
      )}

      {/* Réglages complets : thèmes, hygiène à l'écran, session et exports,
          OBS, profils, raccourcis. Le panneau embarque ProfilesPanel et
          KeymapEditor, qui sont autonomes. */}
      {settingsOpen && (
        <SettingsPanel
          getSession={() => engineRef.current?.exportSession() ?? null}
          loadSession={(s) => engineRef.current?.loadSession(s)}
          onClose={() => useUiStore.getState().setSettingsOpen(false)}
        />
      )}

      {/* Rejeu de session (§11) : calque dédié, la session vive reste intacte */}
      {replayOpen && <ReplayBar onClose={() => useUiStore.getState().setReplayOpen(false)} />}

      {/* Miroir OBS + obs-websocket (§10.2, §7.3) — silencieux par défaut */}
      <ObsBridge onSceneChange={() => engineRef.current?.clear()} />

      {/* Découverte guidée — premier lancement seulement (ou ?onboarding=1) */}
      <Onboarding />
    </div>
  )
}
