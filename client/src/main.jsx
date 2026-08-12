import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './lib/auth.jsx'
import { ChannelsProvider } from './lib/channels.jsx'
import { ContextMenuProvider } from './components/ContextMenu.jsx'
import Toasts from './components/Toasts.jsx'
import { applyTextSize } from './lib/textSize.js'
import { applyTheme } from './lib/theme.js'
import './styles.css'

applyTextSize() // the remembered Small / Medium / Large, before first paint
applyTheme()    // the remembered Light / Dark / System — no white flash at night

// Pages load on demand, so a tab that outlived a deploy can ask for a chunk
// that no longer exists. Vite reports that as vite:preloadError — one reload
// fetches the current build (guarded so a truly broken network can't loop).
window.addEventListener('vite:preloadError', (e) => {
  const last = Number(sessionStorage.getItem('satashkent_chunk_reload') || 0)
  if (Date.now() - last < 30000) return // still failing after a reload — don't loop
  sessionStorage.setItem('satashkent_chunk_reload', String(Date.now()))
  e.preventDefault()
  location.reload()
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ChannelsProvider>
          <ContextMenuProvider>
            <App />
            <Toasts />
          </ContextMenuProvider>
        </ChannelsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
