import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'
import App from './App'
import { initPwa } from './lib/pwa'

initPwa()

// Service worker: la app funciona sin conexión y se actualiza sola
// VITE_NO_SW=1 desactiva el service worker (para vistas previas alojadas donde no está permitido)
if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_NO_SW) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
