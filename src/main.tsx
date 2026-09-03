import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

import { getCurrentWindow } from '@tauri-apps/api/window'

// Electron used the 'ready-to-show' event; Tauri's window starts hidden
// (visible: false in tauri.conf.json) and we reveal it once React has painted.
getCurrentWindow().show().catch((error) => {
  console.warn('Could not show window:', error)
})