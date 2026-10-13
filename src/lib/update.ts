/**
 * Versiones nuevas de la app: cuando una está lista, se avisa con un botón "Actualizar"
 * en vez de recargar de golpe (podía pasar a mitad de un movimiento).
 */
import { create } from 'zustand'
import { forceUpdate } from './pwa'

interface UpdateState {
  /** Hay una versión nueva descargada, esperando */
  ready: boolean
  /** Se tocó "Actualizar" y se está recargando */
  updating: boolean
  /** "Ahora no": se oculta hasta la próxima vez que se abra la app */
  dismissed: boolean
}

export const useUpdate = create<UpdateState>()(() => ({ ready: false, updating: false, dismissed: false }))

/**
 * La app crea esta caché para decirle al service worker que sabe mostrar el aviso.
 * Con versiones antiguas (sin aviso) la actualización se instala sola, como antes. Ver src/sw.ts.
 */
export const UPDATE_PROMPT_CACHE = 'mf-aviso-actualizacion'

type Apply = (reload?: boolean) => Promise<void>
let apply: Apply | null = null

/** Lo llama main.tsx cuando el service worker tiene una versión nueva esperando */
export const onUpdateReady = (updateSW: Apply) => {
  apply = updateSW
  useUpdate.setState({ ready: true, dismissed: false })
}

/** Instala la versión nueva y recarga (los datos no se tocan) */
export const applyUpdate = () => {
  if (useUpdate.getState().updating) return
  useUpdate.setState({ updating: true })
  // Recarga apenas la versión nueva toma el control (también si es la primera vez que se abre la app)
  navigator.serviceWorker?.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  // Si por algo el cambio no se completa, se recarga igual desde internet
  window.setTimeout(() => void forceUpdate(), 8000)
  if (apply) apply(true).catch(() => forceUpdate())
  else void forceUpdate()
}

/** ¿Se abrió una versión distinta a la de la última vez? (la primera vez no cuenta) */
export const wasUpdated = (prev: string | null, current: string) => !!prev && prev !== current

const VERSION_KEY = 'mf-version'

/** Al abrir: anota la versión y dice si cambió desde la última vez */
export const checkUpdated = (current = `${__APP_BUILD__.sha}·${__APP_BUILD__.time}`): boolean => {
  try {
    const prev = localStorage.getItem(VERSION_KEY)
    localStorage.setItem(VERSION_KEY, current)
    return wasUpdated(prev, current)
  } catch {
    return false
  }
}
