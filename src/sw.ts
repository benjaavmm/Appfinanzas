/// <reference lib="webworker" />
/**
 * Service worker propio:
 * - Precarga la app para que funcione sin conexión y se actualiza sola.
 * - Guarda en caché, la primera vez que se usan, los archivos pesados del lector de boletas.
 * - Recibe imágenes compartidas desde otras apps ("Compartir → Mis Finanzas").
 * - Muestra recordatorios en segundo plano (Periodic Background Sync, Chrome Android).
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { createStore, get, set } from 'idb-keyval'
import { computeReminders } from './features/reminders/compute'
import { putSharedFile } from './lib/files'
import { toDateStr } from './lib/dates'
import type { FinanceData } from './lib/types'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// La app usa rutas con # (HashRouter): cualquier navegación sirve index.html
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Lector de boletas (OCR y códigos de barra): pesado, se descarga solo si se usa y queda guardado
registerRoute(
  ({ url }) => url.origin === self.location.origin && (url.pathname.includes('/ocr/') || url.pathname.endsWith('.wasm')),
  new CacheFirst({ cacheName: 'lector-boletas', plugins: [new ExpirationPlugin({ maxEntries: 30 })] }),
)

const appUrl = (path: string) => new URL(path, self.registration.scope).href

// ── Compartir una imagen hacia la app (Web Share Target) ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/compartir')) return
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData()
        const file = form.getAll('boleta').find((f): f is File => f instanceof File && f.size > 0)
        if (file) await putSharedFile(file)
      } catch {
        /* si falla, la app abre igual */
      }
      return Response.redirect(appUrl('./#/?accion=boleta-compartida'), 303)
    })(),
  )
})

// ── Recordatorios en segundo plano ──
const metaStore = createStore('mis-finanzas-meta', 'meta')
const NOTIFIED_KEY = 'recordatorios-enviados'

const readData = async (): Promise<FinanceData | null> => {
  try {
    const raw = await get<string>('mis-finanzas')
    if (!raw) return null
    return (JSON.parse(raw) as { state: FinanceData }).state
  } catch {
    return null
  }
}

/** Muestra los recordatorios de hoy que aún no se hayan enviado. Devuelve cuántos mostró. */
const notifyReminders = async (): Promise<number> => {
  const data = await readData()
  if (!data?.settings?.reminders?.enabled) return 0
  const today = toDateStr(new Date())
  const sent = (await get<Record<string, string>>(NOTIFIED_KEY, metaStore)) ?? {}
  let shown = 0
  for (const r of computeReminders(data, today)) {
    if (sent[r.id]) continue
    await self.registration.showNotification(r.title, {
      body: r.body,
      tag: r.id,
      icon: appUrl('./pwa-192.png'),
      data: { url: appUrl(`./${r.url}`) },
    })
    sent[r.id] = today
    shown++
  }
  // Olvida avisos de hace más de 60 días
  const cutoff = toDateStr(new Date(Date.now() - 60 * 86_400_000))
  for (const [k, d] of Object.entries(sent)) if (d < cutoff) delete sent[k]
  await set(NOTIFIED_KEY, sent, metaStore)
  return shown
}

type PeriodicSyncEvent = ExtendableEvent & { tag: string }

self.addEventListener('periodicsync', ((event: PeriodicSyncEvent) => {
  if (event.tag === 'recordatorios') event.waitUntil(notifyReminders())
}) as EventListener)

// La app puede pedir una revisión inmediata (al abrirse o al activar los recordatorios)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'revisar-recordatorios') event.waitUntil(notifyReminders())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data?.url as string | undefined) ?? appUrl('./')
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (existing) {
        await existing.focus()
        await existing.navigate(target).catch(() => undefined)
      } else {
        await self.clients.openWindow(target)
      }
    })(),
  )
})
