/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lo define el workflow de GitHub Pages ("/Appfinanzas/").
// En local se sirve desde la raíz.
const base = process.env.BASE_PATH ?? '/'

// Identifica la versión publicada (se muestra en Ajustes)
const build = { sha: (process.env.GITHUB_SHA ?? 'local').slice(0, 7), time: new Date().toISOString() }

export default defineConfig({
  base,
  define: {
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // El registro se hace en src/main.tsx
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Mis Finanzas',
        short_name: 'Finanzas',
        description: 'Ordena tu dinero: gastos, ingresos, préstamos, suscripciones, presupuestos y metas.',
        lang: 'es',
        theme_color: '#0d0d14',
        background_color: '#0d0d14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  build: {
    // Recharts + motion pesan; todo queda cacheado por el service worker
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
  },
})
