import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
// les 8 peaux visuelles, chargées après styles.css pour pouvoir la surcharger
import './themes.css'
import './ui/onboarding.css'

// Pas de StrictMode : le double montage de dev créerait deux moteurs canvas.
createRoot(document.getElementById('root')!).render(<App />)
