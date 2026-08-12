/**
 * Point d'entrée de la page obs.html (browser source OBS).
 * Volontairement minuscule : pas de store, pas de thème, pas d'interface.
 */
import { createRoot } from 'react-dom/client'
import ObsView from './ObsView'
import './obs.css'

createRoot(document.getElementById('root')!).render(<ObsView />)
