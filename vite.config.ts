/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'

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
    // Lector de boletas (OCR): se sirve desde la propia app, sin depender de CDNs.
    // No se precarga: se descarga la primera vez que se escanea y queda en caché (ver src/sw.ts).
    viteStaticCopy({
      targets: [
        { src: 'node_modules/tesseract.js/dist/worker.min.js', dest: 'ocr', rename: { stripBase: true } },
        {
          src: [
            'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
            'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
            'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
          ],
          dest: 'ocr/core',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz',
          dest: 'ocr/lang',
          rename: { stripBase: true },
        },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      // El registro se hace en src/main.tsx
      injectRegister: false,
      // Service worker propio (recordatorios y "compartir hacia la app"): src/sw.ts
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['ocr/**'],
      },
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
        // Mantener presionado el ícono de la app
        shortcuts: [
          {
            name: 'Nuevo gasto',
            short_name: 'Gasto',
            url: './#/?accion=gasto',
            icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
          },
          {
            name: 'Escanear boleta',
            short_name: 'Boleta',
            url: './#/?accion=boleta',
            icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
          },
          {
            name: 'Dividir una cuenta',
            short_name: 'Dividir',
            url: './#/?accion=dividir',
            icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
          },
          { name: 'Préstamos', short_name: 'Préstamos', url: './#/prestamos', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
        ],
        // "Compartir → Mis Finanzas" desde la galería o WhatsApp con la foto de una boleta
        share_target: {
          action: './compartir',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'boleta', accept: ['image/*'] }] },
        },
      },
    }),
  ],
  build: {
    // Recharts + motion pesan; todo queda cacheado por el service worker
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    // Copias de trabajo temporales de agentes (git worktrees) dentro del repo
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
})
