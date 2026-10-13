/**
 * Avisos con la app cerrada (Web Push). Con los recordatorios activos y la sesión iniciada, el
 * teléfono se suscribe y deja en Supabase su dirección de avisos, la hora elegida y los días con
 * algo que avisar. La función "avisos" (supabase/functions/avisos) le manda un toque a esa hora y
 * el service worker arma el aviso con los datos del teléfono (src/sw.ts). Montos y movimientos no
 * salen del teléfono por esto.
 */
import { create } from 'zustand'
import { createStore, get } from 'idb-keyval'
import { NOTIFIED_DB, pushDays, reminderSettings } from '../../features/reminders/compute'
import { todayStr } from '../dates'
import { selectData, useStore } from '../store'
import { onUserChange, useAuth } from './auth'
import { cloudConfigured, cloudError, supabase, supabaseAnonKey, supabaseUrl } from './client'
import { deviceLabel } from './sync'

export type PushStatus =
  /** Revisando */
  | 'checking'
  /** Este navegador no tiene Web Push (o no hay service worker) */
  | 'unsupported'
  /** Sin cuenta: se necesita para que el servidor sepa a quién avisar */
  | 'no-account'
  /** Recordatorios apagados o sin permiso */
  | 'off'
  /** Falta instalar la función "avisos" en Supabase */
  | 'no-server'
  /** Funcionando: llegan con la app cerrada */
  | 'on'
  | 'error'

interface PushState {
  status: PushStatus
  error?: string
}

export const usePush = create<PushState>()(() => ({ status: 'checking' }))

const setStatus = (status: PushStatus, error?: string) => usePush.setState({ status, error })

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'

/** La función que manda los avisos */
export const functionUrl = () => `${supabaseUrl}/functions/v1/avisos`

const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const current = sub.options?.applicationServerKey
  if (!current) return false
  const a = new Uint8Array(current)
  return a.length === key.length && a.every((v, i) => v === key[i])
}

/** Errores en palabras simples */
export const pushError = (e: unknown): string => {
  const msg = (e as { message?: string })?.message ?? String(e)
  if (/schema cache|does not exist|could not find/i.test(msg))
    return 'Falta actualizar la base de datos: vuelve a correr supabase/schema.sql en Supabase (SQL Editor).'
  if (/not_authenticated/.test(msg)) return 'Inicia sesión para recibir avisos con la app cerrada.'
  return cloudError(e)
}

interface FunctionReply {
  status: number
  ok?: boolean
  publicKey?: string
  error?: string
}

/** Llama a la función: la primera vez crea las claves de envío y siempre manda lo pendiente */
const callFunction = async (): Promise<FunctionReply> => {
  const headers: Record<string, string> = { apikey: supabaseAnonKey, 'Content-Type': 'application/json' }
  // Las claves antiguas (JWT) también sirven si quedó activado "Verify JWT"
  if (supabaseAnonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${supabaseAnonKey}`
  try {
    const res = await fetch(functionUrl(), { method: 'POST', headers, body: '{}' })
    const body = (await res.json().catch(() => ({}))) as Omit<FunctionReply, 'status'>
    return { ...body, status: res.status }
  } catch {
    return { status: 0 }
  }
}

const rpc = async <T>(fn: string, args?: Record<string, unknown>) => {
  const sb = await supabase()
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** Clave pública de envío (si la función nunca ha corrido, se le pide que la cree) */
const publicKey = async (): Promise<string | null> => {
  const key = await rpc<string | null>('push_public_key')
  if (key) return key
  return (await callFunction()).publicKey ?? null
}

let metaStore: ReturnType<typeof createStore> | null = null
/** Avisos que el service worker ya mostró (para no pedirle al servidor que despierte por ellos) */
const readSent = async (): Promise<Set<string>> => {
  try {
    metaStore ??= createStore(NOTIFIED_DB.name, NOTIFIED_DB.store)
    return new Set(Object.keys((await get<Record<string, string>>(NOTIFIED_DB.key, metaStore)) ?? {}))
  } catch {
    return new Set()
  }
}

const LAST_KEY = 'mf-push-guardado'
/** Se vuelve a guardar aunque nada cambie cada 6 horas (por si el servidor la borró) */
const RESAVE_MS = 6 * 60 * 60 * 1000

const readLast = (): { fp: string; at: number } | null => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as { fp: string; at: number } | null
  } catch {
    return null
  }
}
const writeLast = (v: { fp: string; at: number } | null) => {
  try {
    if (v) localStorage.setItem(LAST_KEY, JSON.stringify(v))
    else localStorage.removeItem(LAST_KEY)
  } catch {
    /* sin almacenamiento: se guarda de nuevo la próxima vez */
  }
}

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santiago'
  } catch {
    return 'America/Santiago'
  }
}

const registration = async () => {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

const doSync = async (force: boolean): Promise<void> => {
  if (!pushSupported()) return setStatus('unsupported')
  if (!cloudConfigured) return setStatus('no-account')
  const reg = await registration()
  if (!reg?.pushManager) return setStatus('unsupported')
  const me = useAuth.getState().userId
  if (!me) return setStatus(useAuth.getState().status === 'loading' ? 'checking' : 'no-account')

  const state = useStore.getState()
  const prefs = reminderSettings(state.settings.reminders)
  const existing = await reg.pushManager.getSubscription().catch(() => null)
  if (!prefs.enabled || Notification.permission !== 'granted') {
    if (existing) {
      await rpc('push_remove', { p_endpoint: existing.endpoint }).catch(() => undefined)
      await existing.unsubscribe().catch(() => undefined)
    }
    writeLast(null)
    return setStatus('off')
  }

  const key = await publicKey()
  if (!key) return setStatus('no-server')
  const keyBytes = fromB64url(key)
  let sub = existing
  if (sub && !sameKey(sub, keyBytes)) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes })
  const { keys } = sub.toJSON()
  if (!keys?.p256dh || !keys.auth) throw new Error('El navegador no entregó las claves del aviso')

  const args = {
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_hour: prefs.dailyHour,
    p_tz: timeZone(),
    p_daily: prefs.daily,
    p_days: pushDays(selectData(state), todayStr(), await readSent()),
    p_device: deviceLabel(),
  }
  const fp = JSON.stringify([me, args])
  const last = readLast()
  if (force || !last || last.fp !== fp || Date.now() - last.at > RESAVE_MS) {
    await rpc('push_save', args)
    writeLast({ fp, at: Date.now() })
  }
  setStatus('on')
}

let running: Promise<void> | null = null
/** Pedido mientras otro corría: se hace al terminar (null: ninguno) */
let queued: boolean | null = null

/** Deja al día la suscripción de este teléfono (se puede llamar seguido: no repite lo mismo) */
export const syncPush = (force = false): Promise<void> => {
  if (running) {
    queued = (queued ?? false) || force
    return running.then(() => running ?? undefined)
  }
  running = doSync(force)
    .catch((e) => setStatus('error', pushError(e)))
    .finally(() => {
      running = null
      if (queued !== null) {
        const next = queued
        queued = null
        void syncPush(next)
      }
    })
  return running
}

export type PushTestResult = 'sent' | 'no-device' | 'jwt' | 'error'

/** Pide al servidor un aviso de prueba ahora, a todos tus teléfonos */
export const testPush = async (): Promise<{ result: PushTestResult; error?: string }> => {
  await syncPush(true)
  if (usePush.getState().status !== 'on') return { result: 'error', error: usePush.getState().error }
  try {
    const n = await rpc<number>('push_test')
    if (!n) return { result: 'no-device' }
  } catch (e) {
    return { result: 'error', error: pushError(e) }
  }
  const reply = await callFunction()
  if (reply.status === 401) return { result: 'jwt' }
  if (!reply.ok) return { result: 'error', error: reply.error ?? 'El servidor de avisos no respondió' }
  return { result: 'sent' }
}

let started = false
let timer: number | undefined

/** Mantiene la suscripción al día: al iniciar sesión, al volver a la app y al cambiar los datos */
export const startPush = () => {
  if (started) return
  started = true
  if (!pushSupported() || !cloudConfigured) return setStatus(pushSupported() ? 'no-account' : 'unsupported')
  onUserChange(() => void syncPush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncPush()
  })
  // Cobros, préstamos y ajustes nuevos cambian los días con avisos
  useStore.subscribe((s, prev) => {
    if (
      s.settings.reminders === prev.settings.reminders &&
      s.subscriptions === prev.subscriptions &&
      s.loans === prev.loans &&
      s.accounts === prev.accounts &&
      s.categories === prev.categories
    )
      return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void syncPush(), 3000)
  })
  void syncPush()
}
