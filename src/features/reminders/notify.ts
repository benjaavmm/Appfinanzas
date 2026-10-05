/**
 * Lado de la app de los recordatorios: permisos, registro de la revisión periódica y
 * revisión inmediata al abrir. Los avisos en sí los muestra el service worker (src/sw.ts),
 * que lee los datos guardados y usa computeReminders.
 *
 * Todo tolera navegadores sin soporte: nada lanza errores hacia la interfaz.
 */
import { useStore } from '../../lib/store'
import { reminderSettings } from './compute'
import type { NotifyPermission, ReminderCapabilities } from './support'

export type { NotifyPermission, ReminderCapabilities } from './support'

/** Etiqueta de la revisión periódica (la escucha src/sw.ts) */
export const SYNC_TAG = 'recordatorios'
/** Chrome decide cuándo correrla; esto es solo el mínimo entre revisiones */
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
/** Al abrir o volver a la app se revisa a lo más una vez cada 30 min */
export const CHECK_EVERY_MS = 30 * 60 * 1000
const LAST_CHECK_KEY = 'mis-finanzas-recordatorios-revision'
/** Tiempo para que el cambio de ajustes quede guardado en IndexedDB (el service worker lee de ahí) */
const SAVE_DELAY_MS = 800

interface PeriodicSyncManager {
  register: (tag: string, options?: { minInterval?: number }) => Promise<void>
  unregister: (tag: string) => Promise<void>
  getTags: () => Promise<string[]>
}

type SyncRegistration = ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }

const wait = (ms: number) => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))

const hasNotifications = () => typeof Notification !== 'undefined'

const currentPermission = (): NotifyPermission => (hasNotifications() ? Notification.permission : 'unsupported')

/** Registro del service worker activo, o undefined si no hay (modo desarrollo, navegador sin soporte) */
const getRegistration = async (timeoutMs = 4000): Promise<SyncRegistration | undefined> => {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return undefined
    if (reg.active) return reg
    // Recién instalado: espera a que quede activo (con tope, `ready` puede no resolverse nunca)
    return await Promise.race([navigator.serviceWorker.ready, wait(timeoutMs)])
  } catch {
    return undefined
  }
}

const supportsPeriodicSync = (reg?: SyncRegistration) => {
  if (reg) return 'periodicSync' in reg
  return typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype
}

const isStandalone = () => {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) return true
  } catch {
    /* sin matchMedia */
  }
  return typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true
}

const isIOSDevice = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent ?? ''
  // iPadOS se presenta como Mac, pero con pantalla táctil
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
}

/** Lo que se puede saber al instante (sin consultar el service worker) */
export const initialCapabilities = (): ReminderCapabilities => ({
  notifications: hasNotifications(),
  permission: currentPermission(),
  background: supportsPeriodicSync(),
  backgroundActive: false,
  standalone: isStandalone(),
  ios: isIOSDevice(),
})

/** Qué permite este navegador y qué quedó activo */
export const capabilities = async (): Promise<ReminderCapabilities> => {
  const base = initialCapabilities()
  const reg = await getRegistration(1500)
  const background = supportsPeriodicSync(reg)
  let backgroundActive = false
  if (background && reg?.periodicSync) {
    try {
      backgroundActive = (await reg.periodicSync.getTags()).includes(SYNC_TAG)
    } catch {
      backgroundActive = false
    }
  }
  return { ...base, background, backgroundActive }
}

const requestPermission = async (): Promise<NotifyPermission> => {
  if (!hasNotifications()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    // Safari antiguo usa un callback y devuelve undefined
    const result = await Notification.requestPermission()
    return result ?? Notification.permission
  } catch {
    return Notification.permission
  }
}

/** Registra la revisión en segundo plano. Devuelve si quedó activa. */
const registerBackground = async (reg?: SyncRegistration): Promise<boolean> => {
  const sync = reg?.periodicSync
  if (!sync) return false
  try {
    const status = await navigator.permissions?.query({ name: 'periodic-background-sync' as PermissionName })
    // Chrome solo la concede a apps instaladas
    if (status?.state === 'denied') return false
  } catch {
    /* la consulta de ese permiso puede no existir: se intenta registrar igual */
  }
  try {
    await sync.register(SYNC_TAG, { minInterval: MIN_INTERVAL_MS })
    return true
  } catch {
    return false
  }
}

export interface EnableResult {
  permission: NotifyPermission
  /** Quedó registrada la revisión con la app cerrada */
  background: boolean
}

/** Pide permiso para notificar y, si se puede, registra la revisión en segundo plano */
export const enableReminders = async (): Promise<EnableResult> => {
  const permission = await requestPermission()
  if (permission !== 'granted') return { permission, background: false }
  return { permission, background: await registerBackground(await getRegistration()) }
}

/** Quita la revisión en segundo plano (el permiso de notificaciones lo maneja el navegador) */
export const disableReminders = async (): Promise<void> => {
  const reg = await getRegistration(1500)
  try {
    await reg?.periodicSync?.unregister(SYNC_TAG)
  } catch {
    /* nada que quitar */
  }
}

let lastCheck = 0

const readLastCheck = () => {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY)) || 0
  } catch {
    return 0
  }
}

const saveLastCheck = (t: number) => {
  lastCheck = t
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(t))
  } catch {
    /* almacenamiento no disponible: queda en memoria */
  }
}

/** Solo para pruebas */
export const resetCheckThrottle = () => {
  lastCheck = 0
  try {
    localStorage.removeItem(LAST_CHECK_KEY)
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Se llama al abrir la app y al volver a ella: pide al service worker revisar si hay
 * avisos pendientes (él evita repetir los que ya mostró). A lo más una vez cada 30 min,
 * salvo con `force`.
 */
export const checkRemindersNow = async ({ force = false }: { force?: boolean } = {}): Promise<void> => {
  try {
    const prefs = reminderSettings(useStore.getState().settings.reminders)
    if (!prefs.enabled || currentPermission() !== 'granted') return
    const now = Date.now()
    const elapsed = now - Math.max(lastCheck, readLastCheck())
    // elapsed < 0: el reloj del teléfono retrocedió; se revisa igual
    if (!force && elapsed >= 0 && elapsed < CHECK_EVERY_MS) return
    // Se marca antes de esperar al service worker: al abrir la app llegan dos llamadas casi juntas
    saveLastCheck(now)
    const reg = await getRegistration()
    if (!reg?.active) return
    // Si la app se instaló después de activar los avisos, ahora Chrome puede permitir la revisión en segundo plano
    if (reg.periodicSync) {
      const tags = await reg.periodicSync.getTags().catch(() => [] as string[])
      if (!tags.includes(SYNC_TAG)) await registerBackground(reg)
    }
    reg.active.postMessage({ type: 'revisar-recordatorios' })
  } catch {
    /* sin service worker o sin soporte: no hay nada que revisar */
  }
}

/** Revisión inmediata tras cambiar los ajustes (espera a que queden guardados) */
export const checkRemindersSoon = async (): Promise<void> => {
  await wait(SAVE_DELAY_MS)
  await checkRemindersNow({ force: true })
}

export type TestResult = 'shown' | 'default' | 'denied' | 'unsupported' | 'error'

const appUrl = (hash: string) => {
  try {
    return new URL(`${import.meta.env.BASE_URL}${hash}`, location.origin).href
  } catch {
    return hash
  }
}

/** Muestra una notificación de ejemplo para ver cómo se verán los avisos */
export const sendTestNotification = async (): Promise<TestResult> => {
  const permission = await requestPermission()
  if (permission !== 'granted') return permission
  const title = 'Así se verán tus recordatorios'
  const options: NotificationOptions = {
    body: 'Por ejemplo: “Mañana se cobra Netflix”. Toca aquí para abrir la app.',
    icon: appUrl('pwa-192.png'),
    tag: 'recordatorio-prueba',
    data: { url: appUrl('#/ajustes') },
  }
  try {
    const reg = await getRegistration(3000)
    if (reg) await reg.showNotification(title, options)
    else new Notification(title, options)
    return 'shown'
  } catch {
    return 'error'
  }
}
