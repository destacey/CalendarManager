import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Tauri shows its own build output; don't let Vite wipe it
  clearScreen: false,
  server: {
    port: 3000,
    // Tauri needs a known port — fail loudly rather than silently moving to 3001
    strictPort: true,
    open: false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: 'dist',
  },
})
