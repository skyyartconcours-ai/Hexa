import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Pas de StrictMode : le double montage de dev créerait deux moteurs canvas.
createRoot(document.getElementById('root')!).render(<App />)
