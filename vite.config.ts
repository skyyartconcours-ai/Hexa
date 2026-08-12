import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Chemin absolu d'un fichier du dépôt (module ESM : pas de __dirname). */
const at = (file: string) => fileURLToPath(new URL(file, import.meta.url))

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // CRUCIAL pour l'application empaquetée : Electron charge dist/index.html via
  // file://. Avec la base absolue par défaut ('/'), les scripts pointeraient vers
  // la racine du disque et la fenêtre resterait DÉSESPÉRÉMENT VIDE. En relatif,
  // ils sont résolus à côté du HTML. Le serveur de dev n'est pas affecté.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      // Deux pages : l'overlay (index.html) et la vue browser source OBS
      // (obs.html), qui partagent le même moteur de rendu (brief §10.2).
      input: {
        main: at('./index.html'),
        obs: at('./obs.html'),
      },
    },
  },
})
