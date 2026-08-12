/**
 * Point d'entrée de ui.html — la COUCHE INTERFACE (barre d'outils, panneaux,
 * bandeaux, roue, curseur), dans une fenêtre exclue des captures d'écran.
 *
 * C'est le même composant App que la couche encre : il lit `couche` (voir
 * src/couches.ts) et ne monte que ce qui le concerne. Une seule interface à
 * maintenir, deux fenêtres à l'écran.
 */
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
// les 8 peaux visuelles, chargées après styles.css pour pouvoir la surcharger
import './themes.css'
import './ui/onboarding.css'

// Pas de StrictMode : le double montage de dev doublerait les abonnements IPC.
createRoot(document.getElementById('root')!).render(<App />)
