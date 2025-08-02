import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.js',
        onstart: (options) => {
          if (options.startup) {
            options.startup()
          }
        },
      },
      {
        entry: 'electron/preload.js',
        onstart: (options) => {
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
  server: {
    port: 3000,
    open: false, // Prevent Vite from opening browser automatically
  },
  build: {
    outDir: 'dist',
  },
})