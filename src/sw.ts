/// <reference lib="webworker" />
/**
 * Service worker propio:
 * - Precarga la app para que funcione sin conexión; la versión nueva espera al botón "Actualizar".
 * - Guarda en caché, la primera vez que se usan, los archivos pesados del lector de boletas.
 * - Recibe imágenes y textos compartidos desde otras apps ("Compartir → Mis Finanzas").
 * - Muestra recordatorios con la app cerrada: cuando llega un aviso del servidor (Web Push,
 *   supabase/functions/avisos) y con Periodic Background Sync (Chrome Android).
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { createStore, get, set } from 'idb-keyval'
import { computeReminders, NOTIFIED_DB, TIMED_KINDS } from './features/reminders/compute'
import { putSharedFile, putSharedText } from './lib/files'
import { toDateStr } from './lib/dates'
import type { FinanceData } from './lib/types'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

// La versión nueva espera a que toques "Actualizar" en el aviso de la app, así no se recarga de
// golpe a mitad de algo. Las versiones antiguas de la app no tienen ese aviso: con ellas se
// instala sola, como antes. La app crea esta caché para decir que sí lo tiene (src/lib/update.ts).
self.addEventListener('install', (event) => {
  event.waitUntil(caches.has('mf-aviso-actualizacion').then((prompt) => (prompt ? undefined : self.skipWaiting())))
})
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})
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
        if (file) {
          await putSharedFile(file)
          return Response.redirect(appUrl('./#/?accion=boleta-compartida'), 303)
        }
        // Texto: un correo o una notificación del banco compartida desde otra app
        const text = ['title', 'text', 'url']
          .map((k) => form.get(k))
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join('\n')
        if (text) {
          await putSharedText(text)
          return Response.redirect(appUrl('./#/?accion=texto-compartido'), 303)
        }
      } catch {
        /* si falla, la app abre igual */
      }
      return Response.redirect(appUrl('./'), 303)
    })(),
  )
})

// ── Recordatorios en segundo plano ──
const metaStore = createStore(NOTIFIED_DB.name, NOTIFIED_DB.store)
const NOTIFIED_KEY = NOTIFIED_DB.key

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
  // La hora decide si ya corresponde el aviso diario y los resúmenes
  const now = new Date()
  const today = toDateStr(now)
  const sent = (await get<Record<string, string>>(NOTIFIED_KEY, metaStore)) ?? {}
  let shown = 0
  for (const r of computeReminders(data, today, now)) {
    if (sent[r.id]) continue
    // Diario, semanal y del mes: una etiqueta por tipo, así el nuevo reemplaza al anterior (y vuelve a sonar)
    const timed = TIMED_KINDS.has(r.kind)
    const options: NotificationOptions & { renotify?: boolean } = {
      body: r.body,
      tag: timed ? `recordatorio-${r.kind}` : r.id,
      icon: appUrl('./pwa-192.png'),
      data: { url: appUrl(`./${r.url}`) },
      ...(timed ? { renotify: true } : {}),
    }
    await self.registration.showNotification(r.title, options)
    sent[r.id] = today
    shown++
  }
  // Olvida avisos de hace más de 60 días
  const cutoff = toDateStr(new Date(now.getTime() - 60 * 86_400_000))
  for (const [k, d] of Object.entries(sent)) if (d < cutoff) delete sent[k]
  await set(NOTIFIED_KEY, sent, metaStore)
  return shown
}

type PeriodicSyncEvent = ExtendableEvent & { tag: string }

self.addEventListener('periodicsync', ((event: PeriodicSyncEvent) => {
  if (event.tag === 'recordatorios') event.waitUntil(notifyReminders())
}) as EventListener)

// ── Avisos del servidor (Web Push) ──
// El servidor solo manda un "toque" a la hora elegida; el aviso se arma aquí con los datos del
// teléfono. Siempre hay que mostrar algo: si no, Safari deja de mandar avisos y Chrome muestra uno genérico.
const showFromPush = async (kind: string) => {
  const icon = appUrl('./pwa-192.png')
  if (kind === 'test') {
    await self.registration.showNotification('✅ ¡Funciona!', {
      body: 'Así te llegarán tus recordatorios, aunque la app esté cerrada.',
      tag: 'recordatorio-prueba',
      icon,
      data: { url: appUrl('./#/ajustes') },
    })
    return
  }
  if ((await notifyReminders()) > 0) return
  // Ya se habían mostrado (p. ej. abriste la app justo antes): se repone el más importante, sin sonar
  const data = await readData()
  const now = new Date()
  const top = data ? computeReminders(data, toDateStr(now), now)[0] : undefined
  await self.registration.showNotification(top?.title ?? 'Mis Finanzas', {
    body: top?.body ?? 'Todo en orden por hoy ✅',
    tag: top ? (TIMED_KINDS.has(top.kind) ? `recordatorio-${top.kind}` : top.id) : 'recordatorio-resumen',
    icon,
    silent: true,
    data: { url: appUrl(`./${top?.url ?? ''}`) },
  })
}

self.addEventListener('push', (event) => {
  let kind = 'check'
  try {
    kind = (event.data?.json() as { t?: string } | undefined)?.t ?? 'check'
  } catch {
    /* sin contenido: revisar */
  }
  event.waitUntil(showFromPush(kind))
})

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
