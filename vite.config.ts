import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Config pensée pour Tauri : port fixe, pas de clearScreen pour garder les logs Rust visibles.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
