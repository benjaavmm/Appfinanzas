/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

// BASE_PATH lo define el workflow de GitHub Pages ("/Appfinanzas/").
// En local se sirve desde la raíz.
const base = process.env.BASE_PATH ?? '/'

// Identifica la versión publicada (se muestra en Ajustes)
const build = { sha: (process.env.GITHUB_SHA ?? 'local').slice(0, 7), time: new Date().toISOString() }

/**
 * Seguridad del HTML publicado (GitHub Pages no deja poner cabeceras propias):
 * - Política de seguridad de contenido (CSP): solo se ejecutan los scripts de la app y solo se
 *   conecta con la propia app y con Supabase. Los scripts en línea van con su huella (hash).
 * - Freno para que otra página no pueda meter la app dentro de un marco (clickjacking).
 * - Que no aparezca en buscadores y que el link se vea bien al compartirlo.
 */
const securityHtml = (): Plugin => ({
  name: 'mis-finanzas-security-html',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      const cloud = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
      const cloudWs = cloud.replace(/^https:/, 'wss:')
      const owner = process.env.GITHUB_REPOSITORY_OWNER
      const site = owner ? `https://${owner.toLowerCase()}.github.io${base}` : ''
      const frameGuard =
        'if (window.top !== window.self) { document.documentElement.style.display = "none"; try { window.top.location = window.self.location } catch (e) {} }'
      let out = html.replace('<title>', `<script>${frameGuard}</script>\n    <title>`)
      const hashes = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
      )
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')} 'wasm-unsafe-eval'`,
        "worker-src 'self' blob:",
        `connect-src 'self'${cloud ? ` ${cloud} ${cloudWs}` : ''}`,
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      const meta = [
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        '<meta name="referrer" content="strict-origin-when-cross-origin" />',
        '<meta name="robots" content="noindex, nofollow" />',
        '<meta property="og:title" content="Mis Finanzas" />',
        '<meta property="og:description" content="Ordena tu plata: gastos, cuotas, préstamos, grupos y metas." />',
        ...(site
          ? [`<meta property="og:image" content="${site}pwa-512.png" />`, `<meta property="og:url" content="${site}" />`]
          : []),
      ].join('\n    ')
      return out.replace(/<meta charset="UTF-8" \/>/, (m) => `${m}\n    ${meta}`)
    },
  },
})

export default defineConfig({
  base,
  define: {
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [
    securityHtml(),
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
      // La versión nueva espera a que el usuario toque "Actualizar" (src/lib/update.ts)
      registerType: 'prompt',
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
        // "Compartir → Mis Finanzas": la foto de una boleta, o el texto de un correo o notificación del banco
        share_target: {
          action: './compartir',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'boleta', accept: ['image/*'] }] },
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
