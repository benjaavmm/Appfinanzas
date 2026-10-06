/**
 * Respaldo en la nube: una fila `user_data` por usuario con todos los datos (menos el PIN,
 * que es de cada dispositivo, y las fotos de boletas, que quedan en el teléfono).
 * Sube los cambios unos segundos después de hacerlos y baja lo nuevo al volver a la app.
 */
import { create } from 'zustand'
import { selectData, useStore } from '../store'
import { ask } from '../ui'
import { DATA_VERSION } from '../defaults'
import { sanitizeData } from '../sanitize'
import type { FinanceData } from '../types'
import { cloudError, supabase } from './client'
import { onUserChange, useAuth } from './auth'
import { decideSync, type SyncMeta } from './reconcile'

const META_KEY = 'mf-sync-meta'
const PUSH_DELAY = 4000
const DATA_KEYS = ['settings', 'accounts', 'categories', 'transactions', 'loans', 'subscriptions', 'goals'] as const

interface SyncState {
  state: 'idle' | 'syncing' | 'error'
  lastSync: string | null
  error: string | null
}

export const useSync = create<SyncState>()(() => ({ state: 'idle', lastSync: readMeta()?.syncedAt ?? null, error: null }))

function readMeta(): SyncMeta | null {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? 'null') as SyncMeta | null
  } catch {
    return null
  }
}
const writeMeta = (m: SyncMeta) => {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m))
  } catch {
    /* sin espacio: se vuelve a intentar en el próximo cambio */
  }
}

const snapshot = (): FinanceData => {
  const d = selectData(useStore.getState())
  const { pinHash: _pin, ...settings } = d.settings
  return { ...d, settings: settings as FinanceData['settings'] }
}

let applying = false
let running: Promise<void> | null = null
let again = false
let timer = 0

/** Otro dispositivo subió cambios mientras este sincronizaba: hay que volver a decidir */
class SyncConflict extends Error {}

/**
 * Sube los datos solo si la nube sigue en la versión que acabamos de leer (`expectedAt`).
 * Así, si dos dispositivos suben casi a la vez, el segundo no pisa al primero: reintenta.
 */
const push = async (userId: string, expectedAt: string | null) => {
  const sb = await supabase()
  const row = { data: snapshot(), updated_at: new Date().toISOString(), device: navigator.userAgent.slice(0, 120) }
  const query = expectedAt
    ? sb.from('user_data').update(row).eq('user_id', userId).eq('updated_at', expectedAt)
    : sb.from('user_data').insert({ user_id: userId, ...row })
  const { data, error } = await query.select('updated_at')
  if (error) {
    // 23505: otro dispositivo creó la fila primero
    if (!expectedAt && (error as { code?: string }).code === '23505') throw new SyncConflict()
    throw error
  }
  const saved = data?.[0]?.updated_at as string | undefined
  if (!saved) throw new SyncConflict()
  writeMeta({ userId, syncedAt: saved, dirty: false })
  return saved
}

const apply = (userId: string, remote: { data: FinanceData; updated_at: string }) => {
  const pinHash = useStore.getState().settings.pinHash
  // Lo que baja de la nube pasa por la misma limpieza que un respaldo: un dato dañado no rompe la app
  const { data } = sanitizeData(remote.data as unknown as Record<string, unknown>, DATA_VERSION)
  applying = true
  try {
    useStore.getState().importData({ ...data, settings: { ...data.settings, pinHash } })
  } finally {
    applying = false
  }
  writeMeta({ userId, syncedAt: remote.updated_at, dirty: false })
  return remote.updated_at
}

const MAX_CONFLICT_RETRIES = 2

const runSync = async (userId: string, retries = MAX_CONFLICT_RETRIES): Promise<void> => {
  const sb = await supabase()
  const { data: remote, error } = await sb.from('user_data').select('data, updated_at').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const meta = readMeta()
  let decision = decideSync(useStore.getState(), remote, meta, userId)
  if (decision === 'ask') {
    const useCloud = await ask({
      title: 'Tienes datos aquí y en tu cuenta',
      message:
        'Los de este dispositivo y los guardados en la nube son distintos. Elige con cuáles quedarte: los otros se reemplazan.',
      confirmLabel: 'Usar los de la nube',
      cancelLabel: 'Usar los de aquí',
    })
    decision = useCloud ? 'pull' : 'push'
  }
  let at = meta?.syncedAt ?? null
  if (decision === 'push') {
    try {
      at = await push(userId, (remote as { updated_at: string } | null)?.updated_at ?? null)
    } catch (e) {
      if (!(e instanceof SyncConflict)) throw e
      // Cambió en otro dispositivo: se vuelve a leer y decidir (pregunta si hay datos distintos)
      if (retries > 0) return runSync(userId, retries - 1)
      throw new Error('Tus datos cambiaron en otro dispositivo. Intenta sincronizar de nuevo.')
    }
  } else if (decision === 'pull' && remote) at = apply(userId, remote as { data: FinanceData; updated_at: string })
  else if (meta?.userId !== userId) writeMeta({ userId, syncedAt: remote?.updated_at ?? null, dirty: false })
  useSync.setState({ state: 'idle', lastSync: at, error: null })
}

/** Sincroniza ahora (si ya hay una en curso, se repite al terminar) */
export const syncNow = (): Promise<void> => {
  const userId = useAuth.getState().userId
  if (!userId) return Promise.resolve()
  window.clearTimeout(timer)
  if (running) {
    again = true
    return running
  }
  useSync.setState({ state: 'syncing' })
  running = runSync(userId)
    .catch((e: unknown) => useSync.setState({ state: 'error', error: cloudError(e) }))
    .finally(() => {
      running = null
      if (again) {
        again = false
        void syncNow()
      }
    })
  return running
}

let started = false

/** Activa el respaldo automático (una vez, al abrir la app) */
export const startSync = () => {
  if (started) return
  started = true
  useStore.subscribe((s, prev) => {
    const userId = useAuth.getState().userId
    if (applying || !userId) return
    if (!DATA_KEYS.some((k) => s[k] !== prev[k])) return
    const meta = readMeta()
    writeMeta({ userId, syncedAt: meta?.userId === userId ? meta.syncedAt : null, dirty: true })
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void syncNow(), PUSH_DELAY)
  })
  onUserChange((userId) => {
    if (userId) void syncNow()
  })
  document.addEventListener('visibilitychange', () => {
    if (useAuth.getState().userId) void syncNow()
  })
  window.addEventListener('online', () => void syncNow())
}
